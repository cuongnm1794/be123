import { chromium, Browser, BrowserContext, Page } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export interface AutomationConfig {
  userId: number;
  username: string;
  password: string;
  courseLink: string;
  loginUrl: string;
  profilePath: string;
}

/**
 * @param step Use `'progress'` only when `progress` is the real course % to save to DB.
 *             Any other value is status-only for debugging (UI / logs).
 */
export type ProgressCallback = (progress: number, message: string, step?: string) => void;

export interface LoginResult {
  success: boolean;
  userId?: number;
  name?: string;
}

export interface LessonCheckpointData {
  lastSlideId: number;
  lastLessonName?: string;
  lastLessonIndex?: number;
}

interface LearningCheckpointCallbacks {
  getCheckpoint?: () => Promise<LessonCheckpointData | null>;
  saveCheckpoint?: (checkpoint: LessonCheckpointData) => Promise<void>;
  clearCheckpoint?: () => Promise<void>;
}

interface LessonData {
  name: string;
  link: string;
  progress: number;
  index: number;
  slideId: string;
  listItemXPath: string;
}

class AutomationService {
  private readonly browsers: Map<number, Browser> = new Map();
  private readonly contexts: Map<number, BrowserContext> = new Map();
  private readonly pages: Map<number, Page> = new Map();
  private readonly stopFlags: Map<number, boolean> = new Map();
  private static readonly SITE_RETRY_DELAY_MS = 5000;

  constructor(private readonly baseProfilePath: string = './chrome-profiles') {
    if (!fs.existsSync(this.baseProfilePath)) {
      fs.mkdirSync(this.baseProfilePath, { recursive: true });
    }
  }

  private getUserProfilePath(userId: number): string {
    const profilePath = path.join(this.baseProfilePath, `user-${userId}`);
    if (!fs.existsSync(profilePath)) {
      fs.mkdirSync(profilePath, { recursive: true });
    }
    return profilePath;
  }

  private isContextUsable(context?: BrowserContext): context is BrowserContext {
    if (!context) return false;
    try {
      context.pages();
      return true;
    } catch {
      return false;
    }
  }

  private isPageUsable(page?: Page): page is Page {
    if (!page) return false;
    try {
      return !page.isClosed();
    } catch {
      return false;
    }
  }

  async launchBrowser(userId: number): Promise<Browser> {
    const existingContext = this.contexts.get(userId);
    if (this.isContextUsable(existingContext)) {
      return existingContext as any;
    }

    this.browsers.delete(userId);
    this.contexts.delete(userId);
    this.pages.delete(userId);

    const profilePath = this.getUserProfilePath(userId);

    const browser = await chromium.launchPersistentContext(profilePath, {
      headless: false,
      channel: 'chrome',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });

    this.browsers.set(userId, browser as any);
    this.contexts.set(userId, browser as any);
    this.stopFlags.set(userId, false);

    return browser as any;
  }

  private static readonly SITE_HOST = 'hoclythuyetlaixe.eco-tek.com.vn';

  /** Avoid using tabs()[0] alone: restored sessions often leave newtab or unrelated pages first. */
  private pickInitialPage(context: BrowserContext): Page | null {
    const pages = context.pages();
    const host = AutomationService.SITE_HOST;
    const onSite = pages.filter((p) => {
      try {
        const u = p.url();
        return u.includes(host) && !u.startsWith('about:');
      } catch {
        return false;
      }
    });
    if (onSite.length === 1) return onSite[0];
    if (onSite.length > 1) {
      const sorted = [...onSite].sort((a, b) => b.url().length - a.url().length);
      return sorted[0];
    }
    return null;
  }

  async getPage(userId: number): Promise<Page> {
    const cachedPage = this.pages.get(userId);
    if (this.isPageUsable(cachedPage)) {
      return cachedPage;
    }

    this.pages.delete(userId);

    let context = this.contexts.get(userId);
    if (!this.isContextUsable(context)) {
      await this.launchBrowser(userId);
      context = this.contexts.get(userId);
    }

    if (!context) {
      throw new Error(`No browser context for user ${userId}`);
    }

    let page: Page;
    const preferred = this.pickInitialPage(context);
    if (preferred) {
      page = preferred;
    } else if (context.pages().length > 0) {
      page = context.pages()[0];
    } else {
      page = await context.newPage();
    }

    this.pages.set(userId, page);
    return page;
  }

  async login(config: AutomationConfig, onProgress?: ProgressCallback): Promise<LoginResult> {
    try {
      onProgress?.(10, 'Launching browser...', 'login:launch_browser');
      await this.launchBrowser(config.userId);

      onProgress?.(20, 'Checking login status...', 'login:check_session');
      const page = await this.getPage(config.userId);

      await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn/my/home');
      await page.waitForTimeout(2000);

      const currentUrl = page.url();
      if (!currentUrl.includes('login') && !currentUrl.includes('signin')) {
        onProgress?.(90, 'Already logged in, getting user info...', 'login:read_user_id');
        const webUserId = await this.getUserIdFromPage(config.userId);
        const userName = await this.getUserNameFromPage(config.userId);
        onProgress?.(100, 'Already logged in', 'login:done_cached');
        return { success: true, userId: webUserId, name: userName };
      }

      onProgress?.(50, 'Entering credentials...', 'login:fill_form');
      try {
        await page.waitForSelector('input[name="login"], input[type="text"]', { timeout: 5000 });
        await page.fill('input[name="login"], input[type="text"]', config.username);

        onProgress?.(60, 'Entering password...', 'login:fill_password');
        await page.fill('input[name="password"], input[type="password"]', config.password);

        onProgress?.(70, 'Submitting login form...', 'login:submit');
        await page.click('button[type="submit"]');

        onProgress?.(80, 'Waiting for navigation...', 'login:wait_navigation');
        await page.waitForLoadState('networkidle', { timeout: 10000 });

        onProgress?.(90, 'Getting user info...', 'login:goto_home');
        await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn');
        await page.waitForTimeout(2000);

        const webUserId = await this.getUserIdFromPage(config.userId);
        const userName = await this.getUserNameFromPage(config.userId);

        onProgress?.(100, 'Login successful', 'login:done');
        return { success: true, userId: webUserId, name: userName };
      } catch {
        onProgress?.(0, 'Login failed: Please login manually', 'login:failed_form');
        return { success: false };
      }
    } catch (error) {
      onProgress?.(0, `Login error: ${error}`, 'login:error');
      return { success: false };
    }
  }

  async getCourseInfo(userId: number, courseLink: string): Promise<any> {
    const page = await this.getPage(userId);
    await page.goto(courseLink);
    await page.waitForTimeout(2000);

    return {
      title: await page.title(),
      url: page.url(),
    };
  }

  private parseProgressText(progressText?: string | null): number | undefined {
    if (!progressText) return undefined;

    const normalized = progressText.trim().toLowerCase();
    if (!normalized) return undefined;

    if (/completed|complete|done|finished|hoan thanh/.test(normalized)) {
      return 100;
    }

    const percentMatch = /(\d{1,3})\s*%/.exec(normalized);
    if (percentMatch) {
      return Math.max(0, Math.min(100, Number.parseInt(percentMatch[1], 10)));
    }

    const numberMatch = /\b(\d{1,3})\b/.exec(normalized);
    if (numberMatch) {
      return Math.max(0, Math.min(100, Number.parseInt(numberMatch[1], 10)));
    }

    return undefined;
  }

  private async readCourseProgress(page: Page): Promise<number | undefined> {
    try {
      const text = await page.locator('//span[@class="o_wslides_progress_percentage"]').textContent();
      return this.parseProgressText(text);
    } catch {
      return undefined;
    }
  }

  private async waitForLesson(
    userId: number,
    waitSeconds: number,
    startProgress: number,
    onProgress?: ProgressCallback,
    checkStudyHours?: () => Promise<number>,
    addStudyHours?: (hours: number) => Promise<void>
  ): Promise<boolean> {
    const randomExtra = Math.floor(Math.random() * 6) + 5;
    const totalWait = Math.max(0, waitSeconds) + randomExtra;

    onProgress?.(startProgress, `Cho countdown bai hoc ~${totalWait}s...`, 'learn:countdown_wait');

    const chunkSize = 5000;
    const chunks = Math.ceil((totalWait * 1000) / chunkSize);
    const waitStartTime = Date.now();

    for (let chunk = 0; chunk < chunks; chunk++) {
      if (this.stopFlags.get(userId)) {
        return false;
      }

      if (chunk % 12 === 0 && checkStudyHours) {
        const todayHours = await checkStudyHours();
        if (todayHours >= 10) {
          onProgress?.(startProgress, 'Da dat 10 gio hoc trong ngay, dung lai', 'learn:stop_daily_limit');
          if (addStudyHours) {
            const timeSpent = (Date.now() - waitStartTime) / 3600000;
            await addStudyHours(timeSpent);
          }
          return false;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, Math.min(chunkSize, totalWait * 1000 - chunk * chunkSize)));
    }

    if (addStudyHours) {
      await addStudyHours(totalWait / 3600);
    }

    return true;
  }

  private async goNextAndReport(page: Page, lesson: LessonData, onProgress?: ProgressCallback): Promise<number | undefined> {
    try {
      onProgress?.(
        0,
        `Cho nut tiep theo (#next-slide-button), URL: ${page.url()} — ${lesson.name}`,
        'learn:wait_next_button'
      );
      await page.waitForSelector('#next-slide-button', { timeout: 5000 });
      await page.click('#next-slide-button');
      await page.waitForTimeout(3000);

      const currentProgress = await this.readCourseProgress(page);
      if (currentProgress !== undefined) {
        onProgress?.(currentProgress, `Progress: ${currentProgress}% - Completed: ${lesson.name}`, 'progress');
      }
      return currentProgress;
    } catch {
      return undefined;
    }
  }

  private resolveStartIndex(allLessons: LessonData[], checkpoint: LessonCheckpointData | null): number {
    let startIndex = allLessons.findIndex((lesson) => lesson.progress < 100);
    if (startIndex < 0) startIndex = 0;

    if (!checkpoint) return startIndex;

    const bySlideId = allLessons.findIndex((lesson) => Number(lesson.slideId) === checkpoint.lastSlideId);
    if (bySlideId >= 0) {
      return Math.min(bySlideId + 1, allLessons.length - 1);
    }

    return startIndex;
  }

  private findNextActionableLessonIndex(allLessons: LessonData[], fromIndex: number): number {
    const normalizedFromIndex = Math.max(0, Math.min(fromIndex, Math.max(0, allLessons.length - 1)));

    for (let index = normalizedFromIndex; index < allLessons.length; index++) {
      const lesson = allLessons[index];
      if (this.isLessonActionable(lesson)) {
        return index;
      }
    }

    for (let index = 0; index < normalizedFromIndex; index++) {
      const lesson = allLessons[index];
      if (this.isLessonActionable(lesson)) {
        return index;
      }
    }

    return -1;
  }

  private coursePathKey(link: string): string {
    try {
      const trimmed = link.trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return new URL(trimmed).pathname.replace(/\/$/, '') || '/';
      }
      const p = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
      return p.split('?')[0].replace(/\/$/, '') || '/';
    } catch {
      return link.split('?')[0];
    }
  }

  private isMatchingCourseUrl(urlString: string, courseLink: string): boolean {
    try {
      const u = new URL(urlString);
      if (!u.hostname.includes(AutomationService.SITE_HOST)) return false;

      const currentKey = this.coursePathKey(u.toString());
      const targetKey = this.coursePathKey(courseLink);
      if (!currentKey || !targetKey) return false;

      return currentKey === targetKey || currentKey.startsWith(`${targetKey}/`);
    } catch {
      return false;
    }
  }

  /** e.g. /profile/user or /profile/user/ — missing numeric id, site cannot show course cards. */
  private isIncompleteProfileUserUrl(urlString: string): boolean {
    try {
      const u = new URL(urlString);
      if (!u.hostname.includes(AutomationService.SITE_HOST)) return false;
      return /^\/profile\/user\/?$/.test(u.pathname);
    } catch {
      return false;
    }
  }

  private isProfileUserAreaUrl(urlString: string): boolean {
    try {
      const u = new URL(urlString);
      return u.hostname.includes(AutomationService.SITE_HOST) && u.pathname.startsWith('/profile/user');
    } catch {
      return false;
    }
  }

  private absoluteCourseUrl(courseLink: string): string {
    if (courseLink.startsWith('http://') || courseLink.startsWith('https://')) {
      return courseLink;
    }
    const path = courseLink.startsWith('/') ? courseLink : `/${courseLink}`;
    return `https://${AutomationService.SITE_HOST}${path}`;
  }

  private normalizeSiteUrl(rawUrl?: string | null): string {
    if (!rawUrl) return '';
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)) {
      return '';
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    const normalizedPath = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
    return `https://${AutomationService.SITE_HOST}${normalizedPath}`;
  }

  private isLessonActionable(lesson: LessonData): boolean {
    return lesson.progress < 100 && !!lesson.link;
  }

  private isLessonPageUrl(urlString: string, slideId?: string): boolean {
    try {
      const u = new URL(urlString);
      if (!u.hostname.includes(AutomationService.SITE_HOST)) return false;
      if (!u.pathname.includes('/slides/slide/')) return false;
      if (!slideId) return true;

      return u.pathname.includes(`-${slideId}`) || u.pathname.endsWith(`/${slideId}`);
    } catch {
      return false;
    }
  }

  private async waitUntilLessonOpened(page: Page, slideId?: string, timeoutMs: number = 12000): Promise<boolean> {
    if (this.isLessonPageUrl(page.url(), slideId)) {
      return true;
    }

    try {
      await Promise.race([
        page.waitForURL((url) => this.isLessonPageUrl(url.toString(), slideId), { timeout: timeoutMs }),
        page.waitForSelector('#next-slide-button', { timeout: timeoutMs }),
      ]);
      return true;
    } catch {
      return this.isLessonPageUrl(page.url(), slideId);
    }
  }

  private async openLesson(page: Page, courseLink: string, lesson: LessonData, startProgress: number, onProgress?: ProgressCallback): Promise<boolean> {
    if (!lesson.link) {
      return false;
    }

    onProgress?.(
      startProgress,
      `Mo bai ${lesson.name} bang link truc tiep: ${lesson.link}`,
      'learn:lesson_open_direct_link'
    );

    await page.goto(lesson.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);
    return this.waitUntilLessonOpened(page, lesson.slideId || undefined, 12000);
  }

  /** On profile course list, open the row that matches our stored course URL. */
  private async enterCourseFromProfileCards(page: Page, courseLink: string): Promise<boolean> {
    const targetKey = this.coursePathKey(courseLink);
    const host = AutomationService.SITE_HOST;

    try {
      await page.waitForSelector('.o_wprofile_slides_course_card_body', { timeout: 15000 });
    } catch {
      return false;
    }

    const navigated = await page.evaluate(
      ({ targetKey: tk, host: h }) => {
        const norm = (raw: string) => {
          if (!raw) return '';
          try {
            if (raw.startsWith('http://') || raw.startsWith('https://')) {
              return new URL(raw).pathname.replace(/\/$/, '') || '/';
            }
            const p = (raw.startsWith('/') ? raw : `/${raw}`).split('?')[0];
            return p.replace(/\/$/, '') || '/';
          } catch {
            return '';
          }
        };

        const doc = (globalThis as any).document;
        const cards = Array.from(doc.querySelectorAll('.o_wprofile_slides_course_card_body')) as any[];

        for (const card of cards) {
          const oc = card.getAttribute('onclick') || '';
          const m = /location\.href\s*=\s*['"]([^'"]+)['"]/i.exec(oc);
          let raw = m ? m[1] : '';
          if (!raw) {
            const a = card.querySelector('a[href]');
            raw = a?.getAttribute('href') || '';
          }
          if (!raw) continue;

          const key = norm(raw);
          const relativePath = raw.startsWith('/') ? raw : `/${raw}`;
          const fullUrl = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${h}${relativePath}`;

          if (
            key === tk ||
            (tk.length > 2 && (key.includes(tk) || tk.includes(key))) ||
            norm(fullUrl) === tk
          ) {
            (globalThis as any).location.href = fullUrl;
            return true;
          }
        }
        return false;
      },
      { targetKey, host }
    );

    if (navigated) {
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
      } catch {
        await page.waitForTimeout(3000);
      }
      await page.waitForTimeout(1500);
      return true;
    }

    return false;
  }

  /**
   * Redirect from bare /profile/user or stay on /profile/user/:id with course grid — enter the target course.
   */
  private async recoverIfStuckOnProfileUserPage(
    userId: number,
    page: Page,
    courseLink: string,
    startProgress: number,
    onProgress?: ProgressCallback
  ): Promise<boolean> {
    if (!this.isProfileUserAreaUrl(page.url())) {
      return this.isMatchingCourseUrl(page.url(), courseLink);
    }

    onProgress?.(
      startProgress,
      `Phat hien trang profile user (${page.url()}), dang vao khoa hoc...`,
      'learn:recover_profile_detected'
    );

    if (this.isIncompleteProfileUserUrl(page.url())) {
      onProgress?.(startProgress, 'Dang lay user_id va mo profile day du...', 'learn:recover_profile_resolve_id');
      const webUserId = await this.getUserIdFromPage(userId);
      if (webUserId) {
        await page.goto(`https://${AutomationService.SITE_HOST}/profile/user/${webUserId}`, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });
        await page.waitForTimeout(2000);
      } else {
        onProgress?.(startProgress, 'Khong lay duoc user_id tu profile, se fallback goto link khoa', 'learn:recover_profile_missing_id');
      }
    }

    onProgress?.(startProgress, 'Tim the khoa hoc tren luoi profile...', 'learn:recover_click_course_card');
    const entered = await this.enterCourseFromProfileCards(page, courseLink);
    if (entered) {
      onProgress?.(startProgress, `Da chuyen tu profile vao khoa, URL: ${page.url()}`, 'learn:recover_opened_course');
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const matched = this.isMatchingCourseUrl(page.url(), courseLink);
      onProgress?.(
        startProgress,
        matched ? `Da xac nhan dung khoa sau recover: ${page.url()}` : `Da roi profile nhung URL chua khop khoa muc tieu: ${page.url()}`,
        matched ? 'learn:recover_verified_course' : 'learn:recover_wrong_course'
      );
      if (matched) {
        return true;
      }
    }

    onProgress?.(startProgress, 'Khong click duoc the khoa, goto truc tiep link khoa...', 'learn:recover_force_goto');
    await page.goto(this.absoluteCourseUrl(courseLink), {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const matched = this.isMatchingCourseUrl(page.url(), courseLink);
    onProgress?.(
      startProgress,
      matched ? `Da goto truc tiep dung khoa: ${page.url()}` : `Goto truc tiep xong nhung URL van khong khop khoa: ${page.url()}`,
      matched ? 'learn:recover_force_verified' : 'learn:recover_force_mismatch'
    );
    return matched;
  }

  async startLearning(
    userId: number,
    courseId: number,
    courseLink: string,
    startProgress: number,
    onProgress?: ProgressCallback,
    checkStudyHours?: () => Promise<number>,
    addStudyHours?: (hours: number) => Promise<void>,
    checkpointCallbacks?: LearningCheckpointCallbacks
  ): Promise<boolean> {
    try {
      this.stopFlags.set(userId, false);

      onProgress?.(startProgress, 'Bat dau phien hoc...', 'learn:start');

      if (checkStudyHours) {
        const todayHours = await checkStudyHours();
        if (todayHours >= 10) {
          onProgress?.(startProgress, 'Da dat 10 gio hoc trong ngay, dung lai', 'learn:stop_daily_limit');
          return false;
        }
      }

      onProgress?.(startProgress, 'Lay tab Playwright / Chrome...', 'learn:get_page');
      const page = await this.getPage(userId);

      const lessonListSel = '//*[@id="home"]//ul//ul//li[@data-slide-id]';
      const lessonListMaxAttempts = 5;
      const lessonListRetryGapMs = AutomationService.SITE_RETRY_DELAY_MS;

      let lessonListFound = false;
      for (let attempt = 1; attempt <= lessonListMaxAttempts; attempt++) {
        if (this.stopFlags.get(userId)) {
          onProgress?.(startProgress, 'Dung hoc truoc khi tim duoc danh sach bai', 'learn:stopped');
          return false;
        }

        if (attempt > 1) {
          onProgress?.(
            startProgress,
            `Chua thay danh sach bai — cho ${lessonListRetryGapMs / 1000}s roi tai lai khoa (lan ${attempt}/${lessonListMaxAttempts})...`,
            'learn:wait_lesson_list_retry'
          );
          await page.waitForTimeout(lessonListRetryGapMs);
        }

        onProgress?.(
          startProgress,
          `Goto khoa hoc (lan ${attempt}/${lessonListMaxAttempts}): ${this.absoluteCourseUrl(courseLink)}`,
          'learn:goto_course'
        );
        await page.goto(this.absoluteCourseUrl(courseLink), { waitUntil: 'domcontentloaded', timeout: 60000 });
        onProgress?.(startProgress, `Cho network idle (URL: ${page.url()})...`, 'learn:network_idle');
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        onProgress?.(startProgress, 'Pause sau tai trang...', 'learn:after_goto_pause');
        await page.waitForTimeout(2000);

        let recoveredIntoCourse = await this.recoverIfStuckOnProfileUserPage(userId, page, courseLink, startProgress, onProgress);
        if (this.isProfileUserAreaUrl(page.url())) {
          onProgress?.(startProgress, 'Van o profile sau lan recover dau, thu recover lan 2...', 'learn:recover_profile_retry');
          recoveredIntoCourse = await this.recoverIfStuckOnProfileUserPage(userId, page, courseLink, startProgress, onProgress);
        }

        if (this.isProfileUserAreaUrl(page.url())) {
          onProgress?.(
            startProgress,
            `Khong thoat duoc khoi profile sau recover, URL hien tai: ${page.url()}`,
            'learn:recover_profile_unresolved'
          );
        } else if (!recoveredIntoCourse && !this.isMatchingCourseUrl(page.url(), courseLink)) {
          onProgress?.(
            startProgress,
            `Dang o URL khong khop khoa muc tieu sau goto/recover: ${page.url()}`,
            'learn:unexpected_course_url'
          );
        }

        onProgress?.(
          startProgress,
          `Cho danh sach bai (//*[@id="home"]//ul//ul//li[@data-slide-id]) lan ${attempt}/${lessonListMaxAttempts}, URL: ${page.url()}`,
          'learn:wait_lesson_list'
        );
        try {
          await page.waitForSelector(lessonListSel, { timeout: 30000 });
          lessonListFound = true;
          break;
        } catch {
          /* thu lan tiep theo sau delay + goto */
        }
      }

      if (!lessonListFound) {
        const at = page.url();
        onProgress?.(
          startProgress,
          `Khong tim thay danh sach bai sau ${lessonListMaxAttempts} lan (moi lan cho 30s, giua cac lan cach ${lessonListRetryGapMs / 1000}s + tai lai khoa). URL: ${at}. Kiem tra dang nhap / link khoa hoc hoac dong tab thua trong Chrome.`,
          'learn:error_lesson_list'
        );
        return false;
      }

      const lessonItems = await page.$$(lessonListSel);
      onProgress?.(startProgress, `Doc ${lessonItems.length} bai trong khoa...`, 'learn:parse_lesson_list');

      const allLessons: LessonData[] = [];

      for (let i = 0; i < lessonItems.length; i++) {
        const item = lessonItems[i];
        const nameEl = await item.$('a.o_wslides_js_slides_list_slide_link span');
        const lessonName = nameEl ? await nameEl.textContent() : `Lesson ${i + 1}`;

        const linkEl = await item.$('a.o_wslides_js_slides_list_slide_link');
        const directHref = linkEl ? await linkEl.getAttribute('href') : null;
        const directOnclick = linkEl ? await linkEl.getAttribute('onclick') : null;
        const itemOnclick = await item.getAttribute('onclick');
        const slideIdAttr = await item.getAttribute('data-slide-id');

        const badgeEl = await item.$('span.badge');
        let progress = 0;
        if (badgeEl) {
          const badgeText = await badgeEl.textContent();
          const parsed = this.parseProgressText(badgeText);
          if (parsed !== undefined) progress = parsed;
        }

        const onclickSource = directOnclick || itemOnclick || '';
        const onclickMatch = /location\.href\s*=\s*['"]([^'"]+)['"]/i.exec(onclickSource);
        const lessonUrl = this.normalizeSiteUrl(directHref) || this.normalizeSiteUrl(onclickMatch?.[1]);
        const slideIdFromLink = lessonUrl?.split('/').pop()?.split('-').pop()?.split('?')[0] || '';
        const slideId = slideIdAttr || slideIdFromLink;
        const listItemXPath = `//*[@id="home"]//ul//ul//li[@data-slide-id="${slideId}"]`;

        allLessons.push({
          name: lessonName?.trim() || `Lesson ${i + 1}`,
          link: lessonUrl,
          progress,
          index: i,
          slideId,
          listItemXPath,
        });
      }

      // Quet tat ca bai hoc, loc ra nhung bai < 100% co link
      const actionableLessons = allLessons.filter((lesson) => this.isLessonActionable(lesson));

      onProgress?.(
        startProgress,
        `Quet ${allLessons.length} bai, tim thay ${actionableLessons.length} bai chua hoan thanh co link`,
        'learn:scan_lessons'
      );

      if (actionableLessons.length === 0) {
        // Tat ca bai deu 100% hoac khong co link
        const allDone = allLessons.every((lesson) => lesson.progress >= 100);
        if (allDone) {
          await checkpointCallbacks?.clearCheckpoint?.();
          onProgress?.(100, 'Course already completed, skipping', 'progress');
          return true;
        }
        onProgress?.(
          startProgress,
          `Khong tim thay bai nao co link de vao hoc (tong=${allLessons.length})`,
          'learn:no_actionable_lesson'
        );
        return false;
      }

      let attemptedLessons = 0;

      for (const lesson of actionableLessons) {
        if (this.stopFlags.get(userId)) {
          onProgress?.(startProgress, 'Dung theo yeu cau (stop flag)', 'learn:stopped');
          return false;
        }

        onProgress?.(
          startProgress,
          `Mo bai ${lesson.index + 1}/${allLessons.length}: ${lesson.name} (${lesson.progress}%) -> ${lesson.link}`,
          'learn:lesson_goto'
        );
        const opened = await this.openLesson(page, courseLink, lesson, startProgress, onProgress);
        if (!opened) {
          onProgress?.(
            startProgress,
            `Khong mo duoc bai ${lesson.name} vi thieu link va slide_id hop le`,
            'learn:lesson_open_failed'
          );
          continue;
        }
        if (this.isProfileUserAreaUrl(page.url())) {
          onProgress?.(
            startProgress,
            `Mo bai hoc bi redirect ve profile (${page.url()}), dang thu vao lai khoa...`,
            'learn:lesson_redirect_profile'
          );
          const recovered = await this.recoverIfStuckOnProfileUserPage(userId, page, courseLink, startProgress, onProgress);
          if (!recovered) {
            onProgress?.(
              startProgress,
              `Khong phuc hoi duoc tu redirect profile khi mo bai ${lesson.name}`,
              'learn:lesson_redirect_unresolved'
            );
            return false;
          }
          const reopened = await this.openLesson(page, courseLink, lesson, startProgress, onProgress);
          if (!reopened) {
            onProgress?.(
              startProgress,
              `Khong mo lai duoc bai ${lesson.name} sau khi recover tu profile`,
              'learn:lesson_reopen_failed'
            );
            return false;
          }
        }

        const verifiedLessonPage = await this.waitUntilLessonOpened(page, lesson.slideId, 6000);
        if (!verifiedLessonPage) {
          onProgress?.(
            startProgress,
            `Da click bai ${lesson.name} nhung van chua vao trang hoc (URL: ${page.url()})`,
            'learn:lesson_not_opened'
          );
          continue;
        }

        attemptedLessons++;

        onProgress?.(startProgress, 'Cho trang bai hoc on dinh...', 'learn:lesson_settle');
        await page.waitForTimeout(4000);

        onProgress?.(startProgress, `Goi countdown API (slide_id=${lesson.slideId})...`, 'learn:countdown_api');
        const countdownResult: any = await page.evaluate(async ({ slideId }) => {
          try {
            const response = await fetch('https://hoclythuyetlaixe.eco-tek.com.vn/slide/countdown-start/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: 0,
                jsonrpc: '2.0',
                method: 'call',
                params: { slide_id: Number(slideId) },
              }),
            });

            if (!response.ok) {
              return { success: false, error: `HTTP ${response.status}` };
            }

            const result: any = await response.json();
            if (result?.result?.end_time) {
              const endTime = result.result.end_time;
              const currentTime = Math.floor(Date.now() / 1000);
              return {
                success: true,
                timeRemaining: Math.max(0, endTime - currentTime),
              };
            }

            return { success: false, error: 'No end_time in response' };
          } catch (error: any) {
            return { success: false, error: error?.message || 'fetch failed' };
          }
        }, { slideId: lesson.slideId });

        const timeRemaining = Number(countdownResult?.timeRemaining || 0);
        if (!countdownResult?.success) {
          onProgress?.(
            startProgress,
            `Countdown API: ${countdownResult?.error || 'unknown'} — tiep tuc khong cho`,
            'learn:countdown_api_skip'
          );
        }
        if (countdownResult?.success && timeRemaining > 0) {
          const canContinue = await this.waitForLesson(
            userId,
            timeRemaining,
            startProgress,
            onProgress,
            checkStudyHours,
            addStudyHours
          );
          if (!canContinue) return false;
        }

        const currentProgress = await this.goNextAndReport(page, lesson, onProgress);

        await checkpointCallbacks?.saveCheckpoint?.({
          lastSlideId: Number(lesson.slideId) || 0,
          lastLessonName: lesson.name,
          lastLessonIndex: lesson.index,
        });

        if ((currentProgress ?? 0) >= 100) {
          await checkpointCallbacks?.clearCheckpoint?.();
          onProgress?.(100, 'Course completed! Final progress: 100%', 'progress');
          break;
        }
      }

      if (attemptedLessons === 0) {
        onProgress?.(
          startProgress,
          'Da doc danh sach bai nhung khong mo duoc bai nao de hoc. Kiem tra checkpoint, progress tren web, hoac link bai hoc.',
          'learn:no_lesson_attempted'
        );
        return false;
      }

      try {
        onProgress?.(startProgress, 'Quay lai trang khoa de doc % cuoi...', 'learn:final_goto_course');
        await page.goto(this.absoluteCourseUrl(courseLink));
        await page.waitForTimeout(2000);
        const finalProgress = await this.readCourseProgress(page);
        if ((finalProgress ?? 0) >= 100) {
          await checkpointCallbacks?.clearCheckpoint?.();
          onProgress?.(100, `Course completed! Final progress: ${finalProgress ?? 100}%`, 'progress');
          return true;
        }
        onProgress?.(
          finalProgress ?? startProgress,
          `Ket thuc phien hoc nhung khoa van chua xong (${finalProgress ?? startProgress}%). Se can chay tiep o lan sau.`,
          'learn:session_incomplete'
        );
        return false;
      } catch {
        onProgress?.(startProgress, 'Khong doc duoc % cuoi cua khoa sau khi hoc xong phien nay', 'learn:final_progress_unknown');
        return false;
      }
    } catch (error) {
      onProgress?.(startProgress, `Error: ${error}`, 'learn:error');
      return false;
    }
  }

  stopLearning(userId: number) {
    this.stopFlags.set(userId, true);
  }

  async getUserIdFromPage(userId: number): Promise<number | undefined> {
    try {
      const page = await this.getPage(userId);
      const webUserId = await page.evaluate(() => {
        // @ts-ignore - browser context
        const bodyText = document.body.innerHTML;
        const match = /"user_id"\s*:\s*(\d+)/.exec(bodyText);
        if (match) return Number.parseInt(match[1], 10);

        // @ts-ignore - browser context
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts as any[]) {
          const scriptMatch = /"user_id"\s*:\s*(\d+)/.exec(script.textContent || '');
          if (scriptMatch) return Number.parseInt(scriptMatch[1], 10);
        }

        return undefined;
      });

      return webUserId;
    } catch {
      return undefined;
    }
  }

  async getUserNameFromPage(userId: number): Promise<string | undefined> {
    try {
      const page = await this.getPage(userId);
      await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn/my/home');
      await page.waitForTimeout(2000);

      const userName = await page.evaluate(() => {
        // @ts-ignore - browser context
        const nameElement = document.querySelector('span[itemprop="name"]');
        return nameElement?.textContent?.trim();
      });

      return userName;
    } catch {
      return undefined;
    }
  }

  async closeBrowser(userId: number) {
    this.stopFlags.set(userId, true);

    const page = this.pages.get(userId);
    if (page) {
      this.pages.delete(userId);
    }

    const browser = this.browsers.get(userId);
    if (browser) {
      await browser.close();
      this.browsers.delete(userId);
      this.contexts.delete(userId);
    }
  }

  async closeAllBrowsers() {
    const userIds = Array.from(this.browsers.keys());
    await Promise.all(userIds.map((userId) => this.closeBrowser(userId)));
  }

  async openResultPage(userId: number, onProgress?: ProgressCallback): Promise<void> {
    onProgress?.(10, 'Dang mo trang ket qua hoc tap...', 'capture:navigate');
    const page = await this.getPage(userId);

    await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn/slides/all?my=1', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await page.waitForTimeout(3000);

    onProgress?.(50, 'Dang tim khu vuc khoa hoc...', 'capture:find_element');

    const container = page.locator('//*[@class="container o_wslides_home_main pb-5"]').first();
    await container.waitFor({ state: 'visible', timeout: 15000 });

    await container.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollBy(0, -100));
    await page.waitForTimeout(500);

    onProgress?.(100, 'Da mo trang ket qua', 'capture:page_ready');
  }

  async takeScreenshot(userId: number, onProgress?: ProgressCallback): Promise<string> {
    onProgress?.(30, 'Dang chup anh...', 'capture:screenshot');
    const page = await this.getPage(userId);

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const fileName = `Screenshot_${timestamp}_user${userId}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, fileName);

    await page.screenshot({ path: filePath, fullPage: false });

    onProgress?.(100, `Da luu anh: ${fileName}`, 'capture:done');
    return filePath;
  }

  async syncCourses(userId: number, webUserId: number, onProgress?: ProgressCallback): Promise<any[]> {
    const page = await this.getPage(userId);
    const courseCardSelector = '.o_wprofile_slides_course_card_body';

    onProgress?.(10, 'Opening profile page...', 'sync:open_profile');
    const profileUrl = `https://hoclythuyetlaixe.eco-tek.com.vn/profile/user/${webUserId}`;
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    onProgress?.(15, `Profile loaded, URL: ${page.url()}`, 'sync:profile_loaded');
      await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);

    if (this.isIncompleteProfileUserUrl(page.url())) {
      onProgress?.(22, 'Thu lai trang profile (dang thieu user id)...', 'sync:retry_profile_incomplete');
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
    }
    if (this.isIncompleteProfileUserUrl(page.url())) {
      onProgress?.(24, 'Thu my/home roi quay lai profile...', 'sync:detour_home');
      await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn/my/home', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
      await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
    }

    onProgress?.(30, 'Finding courses (cho .o_wprofile_slides_course_card_body)...', 'sync:wait_course_cards');

    const courses: any[] = [];

    let courseCardsReady = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.waitForSelector(courseCardSelector, { timeout: 10000 });
        courseCardsReady = true;
        break;
      } catch {
        onProgress?.(
          30,
          `Chua thay course card tren profile (lan ${attempt}/3, URL: ${page.url()})`,
          'sync:wait_course_cards_retry'
        );
        if (attempt < 3) {
          await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
          await page.goto('https://hoclythuyetlaixe.eco-tek.com.vn/my/home', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
          });
          await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
          await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(AutomationService.SITE_RETRY_DELAY_MS);
        }
      }
    }

    if (!courseCardsReady) {
      throw new Error(`Khong tim thay danh sach khoa tren profile ${page.url()}`);
    }

    const courseCards = await page.$$(courseCardSelector);

    onProgress?.(50, `Found ${courseCards.length} courses, extracting info...`, 'sync:parse_cards');

    for (let i = 0; i < courseCards.length; i++) {
      const card = courseCards[i];
      const onclick = await card.getAttribute('onclick');
      let courseUrl = '';

      if (onclick) {
        const match = /location\.href\s*=\s*['"]([^'"]+)['"]/i.exec(onclick);
        if (match) {
          courseUrl = match[1];
          if (!courseUrl.startsWith('http')) {
            courseUrl = `https://hoclythuyetlaixe.eco-tek.com.vn${courseUrl}`;
          }
        }
      }

      if (!courseUrl) continue;

      const nameEl = await card.$('h5');
      const courseName = nameEl ? await nameEl.textContent() : `Course ${i + 1}`;

      const progressEl = await card.$('.progress + small span, small span');
      let progress = 0;
      if (progressEl) {
        const progressText = await progressEl.textContent();
        const parsedProgress = this.parseProgressText(progressText);
        if (parsedProgress !== undefined) {
          progress = parsedProgress;
        }
      }

      if (progress === 0) {
        const cardText = await card.textContent();
        const parsedFromCard = this.parseProgressText(cardText);
        if (parsedFromCard !== undefined) {
          progress = parsedFromCard;
        }
      }

      courses.push({
        course_name: courseName?.trim() || `Course ${i + 1}`,
        link: courseUrl,
        progress,
        description: ''
      });

      onProgress?.(
        50 + (i / courseCards.length) * 40,
        `Processing course ${i + 1}/${courseCards.length}`,
        'sync:course_row'
      );
    }

    onProgress?.(100, `Found ${courses.length} courses`, 'sync:done');
    return courses;
  }
}

export default AutomationService;
