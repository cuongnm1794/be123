import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import Database, { User, Course } from './database';
import AutomationService from './automation';

// Hot reload in development
try {
  if (!app.isPackaged) {
    require('electron-reloader')(module, {
      debug: true,
      watchRenderer: false
    });
  }
} catch (error) {
  if (!app.isPackaged) {
    console.warn('[MAIN] electron-reloader unavailable:', error);
  }
}

let mainWindow: BrowserWindow | null = null;
let database: Database;
let automationService: AutomationService;

const runningAutomations: Map<number, boolean> = new Map();
const stopRequests: Map<number, boolean> = new Map();
const MULTI_LEARNING_CONCURRENCY = 10;
const MULTI_LEARNING_START_STAGGER_MS = 3000;
const SKIPPED_COURSE_NAME = 'KIEN THUC MOI VE XE NANG HANG';

type AutomationStatusPayload = {
  userId: number;
  courseId?: number;
  phase: 'learn' | 'sync' | 'login';
  step: string;
  message: string;
  progress?: number;
  ts: number;
};

type LearningRunState = {
  lastStep?: string;
  lastMessage?: string;
  lastProgress?: number;
};

function broadcastAutomationStatus(payload: Omit<AutomationStatusPayload, 'ts'>) {
  const full: AutomationStatusPayload = { ...payload, ts: Date.now() };
  mainWindow?.webContents.send('automation-status', full);
  if (!app.isPackaged) {
    console.log(`[automation] ${full.phase} ${full.step}: ${full.message}`);
  }
}

function makeLearningProgressHandler(userId: number, courseId: number) {
  return async (progress: number, message: string, step?: string) => {
    if (step === 'progress') {
      await database.updateCourseProgress(userId, courseId, progress);
    }
    broadcastAutomationStatus({
      userId,
      courseId,
      phase: 'learn',
      step: step ?? 'status',
      message,
      progress,
    });
  };
}

function makeTrackedLearningProgressHandler(userId: number, courseId: number, state: LearningRunState) {
  const baseHandler = makeLearningProgressHandler(userId, courseId);
  return async (progress: number, message: string, step?: string) => {
    state.lastStep = step ?? 'status';
    state.lastMessage = message;
    state.lastProgress = progress;
    await baseHandler(progress, message, step);
  };
}

function normalizeCourseName(name?: string | null): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function shouldSkipCourse(courseName?: string | null): boolean {
  return normalizeCourseName(courseName) === SKIPPED_COURSE_NAME;
}

async function persistSyncedCourses(
  userId: number,
  courses: Array<{ course_name: string; description: string; link: string; progress: number }>
) {
  const existingCourses = await database.getAllCourses();
  const courseByLink = new Map(existingCourses.map((course) => [course.link, course]));

  let createdCount = 0;
  let updatedCount = 0;

  for (const courseData of courses) {
    let dbCourse = courseByLink.get(courseData.link);
    if (!dbCourse) {
      dbCourse = await database.createCourse({
        course_name: courseData.course_name,
        description: courseData.description,
        link: courseData.link,
      });
      courseByLink.set(courseData.link, dbCourse);
      createdCount++;
    }

    await database.createUserCourse({
      user_id: userId,
      course_id: dbCourse.id!,
      progress: courseData.progress,
      time: new Date(),
    });
    updatedCount++;
  }

  return { createdCount, updatedCount };
}

async function syncUserCoursesForRun(userId: number) {
  const user = await database.getUserById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  if (!user.user_id) {
    return { synced: false, courses: 0, createdCount: 0, updatedCount: 0 };
  }

  await automationService.launchBrowser(userId);

  const courses = await automationService.syncCourses(userId, user.user_id, (progress, message, step) => {
    mainWindow?.webContents.send('sync-progress', { userId, progress, message, step: step ?? 'sync' });
    broadcastAutomationStatus({
      userId,
      phase: 'sync',
      step: step ?? 'sync:status',
      message,
      progress,
    });
  });

  const persisted = await persistSyncedCourses(userId, courses);
  return { synced: true, courses: courses.length, ...persisted };
}

async function getActionableIncompleteCourses(userId: number) {
  const incompleteCourses = await database.getIncompleteCourses(userId);
  return incompleteCourses.filter((course: any) => !shouldSkipCourse(course.course_name));
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const consume = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => consume()));
  return results;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5174';
    console.log('[MAIN] Loading dev server from:', devUrl);
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow?.loadURL('http://localhost:5175').catch(() => {
        mainWindow?.loadURL('http://localhost:5176');
      });
    });
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer-dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function initializeApp() {
  database = new Database();
  await database.initialize();

  automationService = new AutomationService();

  setupIpcHandlers();
}

function buildCheckpointCallbacks(userId: number, courseId: number) {
  return {
    getCheckpoint: async () => {
      const checkpoint = await database.getLessonCheckpoint(userId, courseId);
      if (!checkpoint) return null;
      return {
        lastSlideId: checkpoint.last_slide_id,
        lastLessonName: checkpoint.last_lesson_name,
        lastLessonIndex: checkpoint.last_lesson_index,
      };
    },
    saveCheckpoint: async (checkpoint: {
      lastSlideId: number;
      lastLessonName?: string;
      lastLessonIndex?: number;
    }) => {
      await database.upsertLessonCheckpoint({
        user_id: userId,
        course_id: courseId,
        last_slide_id: checkpoint.lastSlideId,
        last_lesson_name: checkpoint.lastLessonName,
        last_lesson_index: checkpoint.lastLessonIndex,
      });
    },
    clearCheckpoint: async () => {
      await database.clearLessonCheckpoint(userId, courseId);
    }
  };
}

function setupIpcHandlers() {
  // User management
  ipcMain.handle('get-users', async () => database.getAllUsers());

  ipcMain.handle('create-user', async (_event, user: User) => {
    const newUser = await database.createUser(user);
    await database.createLog({
      user_id: newUser.id!,
      action: 'User created',
      timestamp: new Date(),
    });
    return newUser;
  });

  ipcMain.handle('update-user', async (_event, id: number, user: Partial<User>) => {
    const updated = await database.updateUser(id, user);
    if (updated) {
      await database.createLog({
        user_id: id,
        action: 'User updated',
        timestamp: new Date(),
      });
    }
    return updated;
  });

  ipcMain.handle('delete-user', async (_event, id: number) => {
    const success = await database.deleteUser(id);
    if (success) {
      await database.createLog({
        user_id: id,
        action: 'User deleted',
        timestamp: new Date(),
      });
    }
    return success;
  });

  // Course management
  ipcMain.handle('get-courses', async () => database.getAllCourses());
  ipcMain.handle('create-course', async (_event, course: Course) => database.createCourse(course));
  ipcMain.handle('get-user-courses', async (_event, userId: number) => database.getUserCourses(userId));
  ipcMain.handle('get-incomplete-courses', async (_event, userId: number) => database.getIncompleteCourses(userId));
  ipcMain.handle('get-user-course-stats', async (_event, userId: number) => database.getUserCourseStats(userId));
  ipcMain.handle('get-today-study-hours', async (_event, userId: number) => database.getTodayStudyHours(userId));

  // Automation
  ipcMain.handle('login', async (_event, userId: number, username: string, password: string) => {
    const loginUrl = 'https://hoclythuyetlaixe.eco-tek.com.vn/web/login';
    await automationService.launchBrowser(userId);

    const result = await automationService.login(
      {
        userId,
        username,
        password,
        loginUrl,
        courseLink: '',
        profilePath: ''
      },
      (progress, message, step) => {
        broadcastAutomationStatus({
          userId,
          phase: 'login',
          step: step ?? 'login:status',
          message,
          progress,
        });
      }
    );

    if (result.success) {
      const updates: any = {};
      if (result.userId) updates.user_id = result.userId;
      if (result.name) updates.name = result.name;

      if (Object.keys(updates).length > 0) {
        await database.updateUser(userId, updates);
      }

      let logMessage = 'Login successful';
      if (result.userId) {
        const nameSuffix = result.name ? `, name: ${result.name}` : '';
        logMessage = `Login successful (web user_id: ${result.userId}${nameSuffix})`;
      }

      await database.createLog({
        user_id: userId,
        action: logMessage,
        timestamp: new Date(),
      });
    }

    return result.success;
  });

  ipcMain.handle('start-learning', async (_event, userId: number, courseId: number) => {
    if (runningAutomations.get(userId)) {
      return { success: false, message: 'User is already learning' };
    }

    const todayHours = await database.getTodayStudyHours(userId);
    if (todayHours >= 10) {
      return { success: false, message: 'Da dat 10 gio hoc trong ngay' };
    }

    runningAutomations.set(userId, true);
    stopRequests.set(userId, false);

    try {
      const syncResult = await syncUserCoursesForRun(userId);
      if (syncResult.synced) {
        await database.createLog({
          user_id: userId,
          action: `Pre-run sync: ${syncResult.courses} courses (${syncResult.createdCount} new, ${syncResult.updatedCount} updated)`,
          timestamp: new Date(),
        });
      }

      const user = await database.getUserById(userId);
      const course = await database.getCourseById(courseId);

      if (!user || !course) {
        throw new Error('User or course not found');
      }

      if (shouldSkipCourse(course.course_name)) {
        await database.createLog({
          user_id: userId,
          action: `Skipped blocked course: ${course.course_name}`,
          timestamp: new Date(),
        });
        runningAutomations.set(userId, false);
        stopRequests.set(userId, false);
        broadcastAutomationStatus({
          userId,
          courseId,
          phase: 'learn',
          step: 'learn:skip_blocked_course',
          message: `Bo qua khoa khong hoc: ${course.course_name}`,
        });
        return { success: true, message: 'Blocked course skipped' };
      }

      const userCourses = await database.getUserCourses(userId);
      const userCourse = userCourses.find((uc: any) => uc.course_id === courseId);
      const startProgress = userCourse?.progress || 0;
      if (startProgress >= 100) {
        await database.createLog({
          user_id: userId,
          action: `Skipped completed course: ${course.course_name}`,
          timestamp: new Date(),
        });
        runningAutomations.set(userId, false);
        stopRequests.set(userId, false);
        return { success: true, message: 'Course already completed' };
      }

      await database.createLog({
        user_id: userId,
        action: `Started learning: ${course.course_name}`,
        timestamp: new Date(),
      });

      const learningState: LearningRunState = {};

      const success = await automationService.startLearning(
        userId,
        courseId,
        course.link,
        startProgress,
        makeTrackedLearningProgressHandler(userId, courseId, learningState),
        async () => database.getTodayStudyHours(userId),
        async (hours: number) => {
          await database.addStudyHours(userId, hours);
        },
        buildCheckpointCallbacks(userId, courseId)
      );

      if (success) {
        await database.updateUser(userId, { is_finish: true });
        await database.createLog({
          user_id: userId,
          action: `Completed course: ${course.course_name}`,
          timestamp: new Date(),
        });
      }

      runningAutomations.set(userId, false);
      stopRequests.set(userId, false);
      const stopMessage = success
        ? 'Ket thuc hoc (IPC)'
        : `Dung hoc (IPC)${learningState.lastStep ? ` - ${learningState.lastStep}` : ''}${learningState.lastMessage ? `: ${learningState.lastMessage}` : ''}`;
      broadcastAutomationStatus({
        userId,
        courseId,
        phase: 'learn',
        step: success ? 'learn:session_done' : 'learn:session_stopped',
        message: stopMessage,
        progress: success ? 100 : undefined,
      });
      return { success, message: success ? 'Course completed' : (learningState.lastMessage || 'Course stopped') };
    } catch (error: any) {
      runningAutomations.set(userId, false);
      stopRequests.set(userId, false);
      broadcastAutomationStatus({
        userId,
        courseId,
        phase: 'learn',
        step: 'learn:ipc_error',
        message: error.message,
      });
      await database.createLog({
        user_id: userId,
        action: `Learning error: ${error.message}`,
        timestamp: new Date(),
      });
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('start-multiple-learning', async (_event, _userIds: number[]) => {
    const allUsers = await database.getAllUsers();
    const requestedIds = Array.isArray(_userIds) && _userIds.length > 0 ? new Set(_userIds) : null;
    const autoUsers = allUsers.filter((u) => u.is_running && (!requestedIds || requestedIds.has(u.id!)));

    if (autoUsers.length === 0) {
      return { success: false, message: 'Khong co tai khoan duoc bat auto-run' };
    }

    autoUsers.forEach((user, index) => {
      broadcastAutomationStatus({
        userId: user.id!,
        phase: 'learn',
        step: 'multi:queued',
        message: `Xep hang auto-run ${index + 1}/${autoUsers.length} (toi da ${MULTI_LEARNING_CONCURRENCY} user song song)`,
      });
    });

    const results = await runWithConcurrency(autoUsers, MULTI_LEARNING_CONCURRENCY, async (user, index) => {
      const userId = user.id!;

      try {
        if (runningAutomations.get(userId)) {
          return { userId, success: false, message: 'User is already learning' };
        }

        runningAutomations.set(userId, true);
        stopRequests.set(userId, false);

        broadcastAutomationStatus({
          userId,
          phase: 'learn',
          step: 'multi:dequeued',
          message: 'Bat dau phien auto-run cho user nay',
        });

        if (index > 0) {
          const staggerMs = Math.min(index * MULTI_LEARNING_START_STAGGER_MS, 15000);
          broadcastAutomationStatus({
            userId,
            phase: 'learn',
            step: 'multi:stagger_wait',
            message: `Cho gian cach khoi dong ${Math.round(staggerMs / 1000)}s de giam tai server`,
          });
          await delay(staggerMs);
        }

        const todayHours = await database.getTodayStudyHours(userId);
        if (todayHours >= 10) {
          runningAutomations.set(userId, false);
          return { userId, success: false, message: 'Da dat 10 gio hoc trong ngay' };
        }

        if (user.user_id) {
          await syncUserCoursesForRun(userId);
        }

        const incompleteCourses = await getActionableIncompleteCourses(userId);
        if (incompleteCourses.length === 0) {
          const blockedIncomplete = (await database.getIncompleteCourses(userId)).filter((course: any) => shouldSkipCourse(course.course_name));
          runningAutomations.set(userId, false);
          broadcastAutomationStatus({
            userId,
            phase: 'learn',
            step: 'multi:no_incomplete',
            message: blockedIncomplete.length > 0
              ? `Khong con khoa hop le nao can hoc. Dang bo qua ${blockedIncomplete.length} khoa bi chan.`
              : 'Khong co khoa nao progress < 100 trong DB (truoc vong hoc).',
          });
          return { userId, success: true, message: 'Khong co khoa hoc hop le chua hoan thanh' };
        }

        type MultiLoopExit = 'finished_list' | 'user_stopped' | 'daily_hour_limit';
        let multiLoopExit: MultiLoopExit = 'finished_list';

        let learnAttempted = 0;
        let learnSucceeded = 0;
        let learnFailed = 0;
        let skippedMissingCourseRow = 0;
        let skippedAlreadyCompleteInLoop = 0;
        let skippedBlockedCourse = 0;
        const failedCourseReasons: string[] = [];

        for (const uc of incompleteCourses) {
          if (stopRequests.get(userId)) {
            multiLoopExit = 'user_stopped';
            break;
          }

          const hoursNow = await database.getTodayStudyHours(userId);
          if (hoursNow >= 10) {
            multiLoopExit = 'daily_hour_limit';
            break;
          }

          const courseData = await database.getCourseById(uc.course_id);
          if (!courseData) {
            skippedMissingCourseRow++;
            continue;
          }

          if (shouldSkipCourse(courseData.course_name)) {
            skippedBlockedCourse++;
            broadcastAutomationStatus({
              userId,
              courseId: uc.course_id,
              phase: 'learn',
              step: 'multi:skip_blocked_course',
              message: `Bo qua khoa khong hoc: ${courseData.course_name}`,
            });
            await database.createLog({
              user_id: userId,
              action: `[multi] skipped blocked course: ${courseData.course_name}`,
              timestamp: new Date(),
            });
            continue;
          }

          const userCourses = await database.getUserCourses(userId);
          const userCourse = userCourses.find((item: any) => item.course_id === uc.course_id);
          const startProgress = userCourse?.progress || 0;
          if (startProgress >= 100) {
            skippedAlreadyCompleteInLoop++;
            continue;
          }

          learnAttempted++;
          const learningState: LearningRunState = {};
          const success = await automationService.startLearning(
            userId,
            uc.course_id,
            courseData.link,
            startProgress,
            makeTrackedLearningProgressHandler(userId, uc.course_id, learningState),
            async () => database.getTodayStudyHours(userId),
            async (hours: number) => {
              await database.addStudyHours(userId, hours);
            },
            buildCheckpointCallbacks(userId, uc.course_id)
          );

          if (success) {
            learnSucceeded++;
          } else {
            learnFailed++;
            const failureReason = `${courseData.course_name}${learningState.lastStep ? ` [${learningState.lastStep}]` : ''}${learningState.lastMessage ? ` ${learningState.lastMessage}` : ''}`;
            failedCourseReasons.push(failureReason);
            await database.createLog({
              user_id: userId,
              action: `[multi] failed course: ${failureReason}`,
              timestamp: new Date(),
            });
            const finalHours = await database.getTodayStudyHours(userId);
            if (finalHours >= 10 || stopRequests.get(userId)) {
              multiLoopExit = finalHours >= 10 ? 'daily_hour_limit' : 'user_stopped';
              break;
            }
            broadcastAutomationStatus({
              userId,
              courseId: uc.course_id,
              phase: 'learn',
              step: 'multi:skip_failed_continue',
              message: `Khoa "${courseData.course_name}" loi${learningState.lastStep ? ` (${learningState.lastStep})` : ''} — ${learningState.lastMessage || 'da bo qua, tiep tuc khoa tiep theo'} (chi dung ca batch khi du 10h/ngay hoac bam Dung).`,
            });
          }
        }

        if (user.user_id) {
          await syncUserCoursesForRun(userId);
        }

        const stillIncompleteAll = await database.getIncompleteCourses(userId);
        const stillIncomplete = stillIncompleteAll.filter((course: any) => !shouldSkipCourse(course.course_name));
        const blockedRemaining = stillIncompleteAll.length - stillIncomplete.length;
        const remaining = stillIncomplete.length;

        runningAutomations.set(userId, false);
        stopRequests.set(userId, false);

        let multiStep: string;
        let multiMessage: string;
        if (multiLoopExit === 'user_stopped') {
          multiStep = 'multi:stopped';
          multiMessage = `Da dung theo yeu cau. Con ${remaining} khoa progress < 100 trong DB.`;
        } else if (multiLoopExit === 'daily_hour_limit') {
          multiStep = 'multi:hour_limit';
          multiMessage = `Het 10 gio hoc hom nay. Con ${remaining} khoa chua xong trong DB.`;
        } else if (remaining === 0) {
          multiStep = 'multi:all_done';
          multiMessage = 'Da het khoa chua hoan thanh trong DB (sau dong bo cuoi).';
        } else {
          multiStep = 'multi:remaining_courses';
          const nameList = stillIncomplete
            .map((c: any) => (c.course_name ? String(c.course_name).trim() : '') || `course_id=${c.course_id}`)
            .filter(Boolean);
          const maxNames = 6;
          const shown = nameList.slice(0, maxNames).join(' | ');
          const more = nameList.length > maxNames ? ` (+${nameList.length - maxNames} khoa nua)` : '';

          const stats = `Trong vong lap: da hoc ${learnAttempted} khoa (${learnSucceeded} OK, ${learnFailed} loi).`;
          const skips =
            (skippedMissingCourseRow ? ` Thieu dong course: ${skippedMissingCourseRow}.` : '') +
            (skippedAlreadyCompleteInLoop ? ` Bo qua da 100% luc chay: ${skippedAlreadyCompleteInLoop}.` : '') +
            (skippedBlockedCourse ? ` Bo qua khoa bi chan: ${skippedBlockedCourse}.` : '');

          let hint: string;
          if (learnFailed > 0 && learnSucceeded > 0) {
            hint =
              ` Co ${learnFailed} khoa loi (da bo qua, van hoc tiep cac khoa sau). ` +
              `Co ${learnSucceeded} lan automation bao thanh cong; neu sau DONG BO CUOI van thay ${remaining} khoa <100% trong DB thi do buoc sync ghi de % theo TRANG HO SO WEB — web co the chua cap nhat kip, hoac bai chua that su xong tren site (khong phai do batch dung sai). ` +
              `Xem learn:error / learn:wait_* cho khoa loi. Chay lai "Chay tat ca" hoac hoc thu cong khoa con thieu.`;
          } else if (learnFailed > 0) {
            hint =
              ' Loi tung khoa da duoc bo qua de hoc tiep cac khoa sau (khong dung batch). Xem learn:error / learn:wait_* de sua khoa con loi. Chay lai "Chay tat ca" khi san sang.';
          } else if (learnAttempted > 0) {
            hint =
              ' Moi lan goi deu bao thanh cong nhung sau dong bo cuoi DB van <100% — % trong DB = % lay tu web khi sync, co the site chua ghi nhan xong. Chay lai "Chay tat ca" hoac kiem tra tren web.';
          } else {
            hint = ' Khong goi startLearning (tat ca bi bo qua?) — kiem tra user_id / dong bo khoa.';
          }

          const blockedHint = blockedRemaining > 0 ? ` Dang bo qua them ${blockedRemaining} khoa bi chan.` : '';
          const failedHint = failedCourseReasons.length > 0
            ? ` Loi cu the: ${failedCourseReasons.slice(0, 2).join(' | ')}${failedCourseReasons.length > 2 ? ` (+${failedCourseReasons.length - 2} khoa loi nua)` : ''}.`
            : '';
          multiMessage = `${stats}${skips} Sau dong bo cuoi DB con ${remaining} khoa <100%: ${shown}${more}.${hint}${failedHint}${blockedHint}`;
        }

        broadcastAutomationStatus({
          userId,
          phase: 'learn',
          step: multiStep,
          message: multiMessage,
        });

        await database.createLog({
          user_id: userId,
          action: `[multi] ${multiStep}: ${multiMessage}`,
          timestamp: new Date(),
        });

        return {
          userId,
          success: remaining === 0,
          message: remaining === 0 ? 'Hoan thanh tat ca khoa trong DB' : multiMessage,
          remainingIncomplete: remaining,
          exitReason: multiLoopExit,
          learnStats: {
            attempted: learnAttempted,
            succeeded: learnSucceeded,
            failed: learnFailed,
            skippedMissingCourse: skippedMissingCourseRow,
            skippedAlreadyComplete: skippedAlreadyCompleteInLoop,
            skippedBlockedCourse,
          },
        };
      } catch (error: any) {
        runningAutomations.set(userId, false);
        stopRequests.set(userId, false);
        broadcastAutomationStatus({
          userId,
          phase: 'learn',
          step: 'multi:ipc_error',
          message: error.message,
        });
        return { userId, success: false, message: error.message };
      }
    });
    return { success: true, results };
  });

  ipcMain.handle('stop-learning', async (_event, userId: number) => {
    stopRequests.set(userId, true);
    automationService.stopLearning(userId);
    runningAutomations.set(userId, false);

    broadcastAutomationStatus({
      userId,
      phase: 'learn',
      step: 'learn:stopped_user',
      message: 'Nguoi dung bam dung hoc',
    });

    await database.createLog({
      user_id: userId,
      action: 'Learning stopped by user',
      timestamp: new Date(),
    });

    return true;
  });

  ipcMain.handle('close-browser', async (_event, userId: number) => {
    stopRequests.set(userId, true);
    await automationService.closeBrowser(userId);
    runningAutomations.set(userId, false);
    return true;
  });

  ipcMain.handle('get-logs', async (_event, userId?: number) => {
    if (userId) {
      return database.getUserLogs(userId);
    }
    return database.getAllLogs();
  });

  ipcMain.handle('sync-courses', async (_event, userId: number) => {
    try {
      const user = await database.getUserById(userId);
      if (!user) throw new Error('User not found');

      if (!user.user_id) {
        return {
          success: false,
          message: 'Vui long dang nhap truoc de lay user_id!'
        };
      }

      const { courses, createdCount, updatedCount } = await syncUserCoursesForRun(userId);

      await database.createLog({
        user_id: userId,
        action: `Synced ${courses} courses (${createdCount} new, ${updatedCount} updated)`,
        timestamp: new Date(),
      });

      return {
        success: true,
        message: `Dong bo thanh cong: ${courses} khoa hoc (${createdCount} moi, ${updatedCount} cap nhat)`,
        courses
      };
    } catch (error: any) {
      await database.createLog({
        user_id: userId,
        action: `Sync failed: ${error.message}`,
        timestamp: new Date(),
      });
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('clear-course-checkpoint', async (_event, userId: number, courseId: number) => {
    try {
      await database.clearLessonCheckpoint(userId, courseId);
      await database.createLog({
        user_id: userId,
        action: `Checkpoint cleared for course_id=${courseId}`,
        timestamp: new Date(),
      });
      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('open-result-page', async (_event, userId: number) => {
    try {
      await automationService.launchBrowser(userId);

      await automationService.openResultPage(
        userId,
        (progress, message, step) => {
          broadcastAutomationStatus({
            userId,
            phase: 'sync',
            step: step ?? 'capture:status',
            message,
            progress,
          });
        }
      );

      return { success: true };
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('take-screenshot', async (_event, userId: number) => {
    try {
      await automationService.launchBrowser(userId);

      const filePath = await automationService.takeScreenshot(
        userId,
        (progress, message, step) => {
          broadcastAutomationStatus({
            userId,
            phase: 'sync',
            step: step ?? 'capture:status',
            message,
            progress,
          });
        }
      );

      await database.createLog({
        user_id: userId,
        action: `Screenshot captured: ${filePath}`,
        timestamp: new Date(),
      });

      return { success: true, filePath };
    } catch (error: any) {
      await database.createLog({
        user_id: userId,
        action: `Screenshot failed: ${error.message}`,
        timestamp: new Date(),
      });
      return { success: false, message: error.message };
    }
  });
}

app.on('ready', async () => {
  await initializeApp();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  await automationService.closeAllBrowsers();
  await database.close();
});
