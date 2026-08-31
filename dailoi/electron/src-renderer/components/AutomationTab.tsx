import React, { useState, useEffect, useCallback } from 'react';
import { User, UserCourse } from '../types';

const { ipcRenderer } = window.require('electron');
const SKIPPED_COURSE_NAME = 'KIEN THUC MOI VE XE NANG HANG';

type AutomationStatus = {
  phase: string;
  step: string;
  message: string;
  progress?: number;
  courseId?: number;
  ts: number;
};

const normalizeCourseName = (name?: string | null) =>
  (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();

const shouldSkipCourse = (name?: string | null) => normalizeCourseName(name) === SKIPPED_COURSE_NAME;

const VI = {
  title: 'T\u1ef1 \u0111\u1ed9ng h\u00f3a h\u1ecdc t\u1eadp',
  runAll: 'Ch\u1ea1y t\u1ea5t c\u1ea3',
  stopAll: 'D\u1eebng t\u1ea5t c\u1ea3',
  noAutoUsers: 'Ch\u01b0a c\u00f3 ng\u01b0\u1eddi d\u00f9ng n\u00e0o b\u1eadt auto-run.',
  totalCourses: 'T\u1ed5ng kh\u00f3a',
  doneCourses: '\u0110\u00e3 xong',
  learningCourses: '\u0110ang h\u1ecdc',
  todayHours: 'Gi\u1edd h\u1ecdc h\u00f4m nay',
  avgProgress: 'Ti\u1ebfn \u0111\u1ed9 trung b\u00ecnh',
  start: 'B\u1eaft \u0111\u1ea7u',
  stop: 'D\u1eebng',
  closeBrowser: '\u0110\u00f3ng browser',
  learningList: 'Kh\u00f3a \u0111ang h\u1ecdc',
  showCourses: 'Xem kh\u00f3a',
  hideCourses: '\u1ea8n kh\u00f3a',
  noIncomplete: 'Kh\u00f4ng c\u00f2n kh\u00f3a ch\u01b0a ho\u00e0n th\u00e0nh',
  noCourses: 'Ch\u01b0a c\u00f3 kh\u00f3a h\u1ecdc n\u00e0o',
  auto: 'Auto',
  manual: 'Manual',
  err: 'L\u1ed7i: ',
  alertNoIncomplete: 'Kh\u00f4ng c\u00f3 kh\u00f3a h\u1ecdc ch\u01b0a ho\u00e0n th\u00e0nh!',
  alertStopped: '\u0110\u00e3 d\u1eebng h\u1ecdc!',
  alertClosed: '\u0110\u00e3 \u0111\u00f3ng tr\u00ecnh duy\u1ec7t!',
  confirmRunAll: 'B\u1ea1n c\u00f3 ch\u1eafc mu\u1ed1n ch\u1ea1y t\u1ea5t c\u1ea3 ng\u01b0\u1eddi d\u00f9ng?',
  alertStopAll: '\u0110\u00e3 d\u1eebng t\u1ea5t c\u1ea3!',
  debugStatus: 'Tr\u1ea1ng th\u00e1i ch\u1ea1y (debug)',
  debugCourseId: 'courseId',
  debugProgress: 'ti\u1ebfn \u0111\u1ed9',
  manualToggleShow: 'H\u1ecdc ch\u1ec9 \u0111\u1ecbnh',
  manualToggleHide: '\u1ea8n ch\u1ecdn kh\u00f3a',
  manualRun: 'Ch\u1ea1y kh\u00f3a',
  manualEmpty: 'Kh\u00f4ng c\u00f3 kh\u00f3a \u0111\u1ec3 ch\u1ecdn',
  manualClearCheckpoint: 'Xoa checkpoint'
};

const AutomationTab: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [userCourses, setUserCourses] = useState<Map<number, UserCourse[]>>(new Map());
  const [studyHours, setStudyHours] = useState<Map<number, number>>(new Map());
  const [expandedUsers, setExpandedUsers] = useState<Map<number, boolean>>(new Map());
  const [automationStatusByUser, setAutomationStatusByUser] = useState<Map<number, AutomationStatus>>(new Map());
  const [manualCourseSelectionByUser, setManualCourseSelectionByUser] = useState<Map<number, number>>(new Map());
  const [manualPickerOpenByUser, setManualPickerOpenByUser] = useState<Map<number, boolean>>(new Map());

  const updateCourseProgress = useCallback((userId: number, courseId: number, progress: number) => {
    setUserCourses((prev) => {
      const newMap = new Map(prev);
      const courses = newMap.get(userId) || [];
      const updatedCourses = courses.map((course) =>
        course.course_id === courseId ? { ...course, progress } : course
      );
      newMap.set(userId, updatedCourses);
      return newMap;
    });
  }, []);

  useEffect(() => {
    loadUsers();

    const handleAutomationStatus = (_: unknown, data: AutomationStatus) => {
      setAutomationStatusByUser((prev) => new Map(prev).set(data.userId, data));
      if (data.step === 'progress' && data.courseId != null && typeof data.progress === 'number') {
        updateCourseProgress(data.userId, data.courseId, data.progress);
      }
    };

    ipcRenderer.on('automation-status', handleAutomationStatus);

    const interval = setInterval(() => {
      loadStudyHours();
    }, 60000);

    return () => {
      ipcRenderer.removeListener('automation-status', handleAutomationStatus);
      clearInterval(interval);
    };
  }, [updateCourseProgress]);

  const loadUsers = async () => {
    try {
      const data = await ipcRenderer.invoke('get-users');
      setUsers(data);
      for (const user of data) {
        loadUserCourses(user.id);
      }
      loadStudyHours();
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadStudyHours = async () => {
    try {
      const hoursMap = new Map<number, number>();
      const currentUsers = users.length > 0 ? users : await ipcRenderer.invoke('get-users');
      for (const user of currentUsers) {
        try {
          const hours = await ipcRenderer.invoke('get-today-study-hours', user.id);
          hoursMap.set(user.id, hours);
        } catch {
          hoursMap.set(user.id, 0);
        }
      }
      setStudyHours(hoursMap);
    } catch (error) {
      console.error('Error loading study hours:', error);
    }
  };

  const loadUserCourses = async (userId: number) => {
    try {
      const courses = await ipcRenderer.invoke('get-user-courses', userId);
      setUserCourses((prev) => new Map(prev).set(userId, courses));
    } catch (error) {
      console.error('Error loading user courses:', error);
    }
  };

  const startUserLearning = async (userId: number) => {
    await ipcRenderer.invoke('sync-courses', userId);
    const syncedCourses = await ipcRenderer.invoke('get-incomplete-courses', userId);
    const incompleteCourses = syncedCourses
      .filter((c: UserCourse) => c.progress < 100 && !shouldSkipCourse(c.course_name))
      .sort((a: UserCourse, b: UserCourse) => a.course_id - b.course_id);
    await loadUserCourses(userId);
    if (incompleteCourses.length === 0) {
      alert(VI.alertNoIncomplete);
      return;
    }
    try {
      for (const course of incompleteCourses) {
        await ipcRenderer.invoke('start-learning', userId, course.course_id);
      }
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const setManualCourseSelection = (userId: number, courseId: number) => {
    setManualCourseSelectionByUser((prev) => {
      const next = new Map(prev);
      next.set(userId, courseId);
      return next;
    });
  };

  const toggleManualPicker = (userId: number) => {
    setManualPickerOpenByUser((prev) => {
      const next = new Map(prev);
      next.set(userId, !next.get(userId));
      return next;
    });
  };

  const startSelectedCourse = async (userId: number) => {
    try {
      await ipcRenderer.invoke('sync-courses', userId);
      const syncedCourses = await ipcRenderer.invoke('get-incomplete-courses', userId);
      const candidateCourses = syncedCourses
        .filter((course: UserCourse) => course.progress < 100 && !shouldSkipCourse(course.course_name))
        .sort((a: UserCourse, b: UserCourse) => a.course_id - b.course_id);

      await loadUserCourses(userId);

      if (candidateCourses.length === 0) {
        alert(VI.alertNoIncomplete);
        return;
      }

      const selectedCourseId = manualCourseSelectionByUser.get(userId);
      const selectedCourse = candidateCourses.find((course: UserCourse) => course.course_id === selectedCourseId) || candidateCourses[0];

      setManualCourseSelection(userId, selectedCourse.course_id);
      await ipcRenderer.invoke('start-learning', userId, selectedCourse.course_id);
      await loadUserCourses(userId);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const clearSelectedCourseCheckpoint = async (userId: number) => {
    try {
      const selectedCourseId = manualCourseSelectionByUser.get(userId);
      if (!selectedCourseId) {
        alert(VI.manualEmpty);
        return;
      }

      const result = await ipcRenderer.invoke('clear-course-checkpoint', userId, selectedCourseId);
      if (!result?.success) {
        throw new Error(result?.message || 'Clear checkpoint failed');
      }

      alert('Da xoa checkpoint khoa da chon');
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const stopUserLearning = async (userId: number) => {
    try {
      await ipcRenderer.invoke('stop-learning', userId);
      alert(VI.alertStopped);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const closeBrowser = async (userId: number) => {
    try {
      await ipcRenderer.invoke('close-browser', userId);
      alert(VI.alertClosed);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const startAllUsers = async () => {
    if (!confirm(VI.confirmRunAll)) return;
    try {
      await loadUsers();
      const userIds = users.map((u) => u.id);
      await ipcRenderer.invoke('start-multiple-learning', userIds);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const stopAllUsers = async () => {
    try {
      for (const user of users) {
        await ipcRenderer.invoke('stop-learning', user.id);
      }
      alert(VI.alertStopAll);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const toggleRunning = async (userId: number, currentStatus: boolean) => {
    try {
      await ipcRenderer.invoke('update-user', userId, { is_running: !currentStatus });
      loadUsers();
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const toggleExpand = (userId: number) => {
    setExpandedUsers((prev) => {
      const next = new Map(prev);
      next.set(userId, !next.get(userId));
      return next;
    });
  };

  const getUserStats = (courses: UserCourse[]) => {
    const total = courses.length;
    const completed = courses.filter((c) => c.progress >= 100).length;
    const incomplete = total - completed;
    const avgProgress = total > 0 ? Math.round(courses.reduce((sum, c) => sum + (c.progress || 0), 0) / total) : 0;
    const topIncomplete = courses.filter((c) => c.progress < 100).sort((a, b) => (b.progress || 0) - (a.progress || 0)).slice(0, 3);
    return { total, completed, incomplete, avgProgress, topIncomplete };
  };

  const activeUsers = users.filter((user) => user.is_running);

  return (
    <div>
      <div className="section-header automation-header-row">
        <h2>{VI.title}</h2>
        <div className="automation-global-controls">
          <button className="btn btn-success" onClick={startAllUsers}>{VI.runAll}</button>
          <button className="btn btn-danger" onClick={stopAllUsers}>{VI.stopAll}</button>
        </div>
      </div>

      {activeUsers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">Auto</div>
          <div className="empty-state-text">{VI.noAutoUsers}</div>
        </div>
      ) : (
        <div className="automation-grid">
          {activeUsers.map((user) => {
            const courses = userCourses.get(user.id) || [];
            const manualCandidateCourses = courses
              .filter((course) => course.progress < 100 && !shouldSkipCourse(course.course_name))
              .sort((a, b) => a.course_id - b.course_id);
            const selectedManualCourseId = manualCourseSelectionByUser.get(user.id) ?? manualCandidateCourses[0]?.course_id;
            const manualPickerOpen = manualPickerOpenByUser.get(user.id) || false;
            const stats = getUserStats(courses);
            const expanded = expandedUsers.get(user.id) || false;
            const hours = studyHours.get(user.id) || 0;
            const reachedLimit = hours >= 10;
            const runStatus = automationStatusByUser.get(user.id);

            return (
              <div key={user.id} className="automation-card">
                <div className="automation-card-head">
                  <div className="automation-user-meta">
                    <div className="automation-user-name">{user.name || user.username}</div>
                    <div className="automation-user-sub">@{user.username}</div>
                  </div>
                  <button className={`btn btn-sm ${user.is_running ? 'btn-success' : 'btn-secondary'}`} onClick={() => toggleRunning(user.id, user.is_running)}>
                    {user.is_running ? VI.auto : VI.manual}
                  </button>
                </div>

                <div className="automation-metrics">
                  <div className="metric-box"><span className="metric-label">{VI.totalCourses}</span><span className="metric-value">{stats.total}</span></div>
                  <div className="metric-box"><span className="metric-label">{VI.doneCourses}</span><span className="metric-value">{stats.completed}</span></div>
                  <div className="metric-box"><span className="metric-label">{VI.learningCourses}</span><span className="metric-value">{stats.incomplete}</span></div>
                </div>

                <div className="automation-hour-row">
                  <span className="hour-label">{VI.todayHours}</span>
                  <span className={`hour-value ${reachedLimit ? 'hour-limit' : ''}`}>{hours.toFixed(2)} / 10h</span>
                </div>

                <div className="progress-bar-compact automation-progress-overview"><div className="progress-fill" style={{ width: `${stats.avgProgress}%` }}></div></div>
                <div className="automation-progress-text">{VI.avgProgress}: {stats.avgProgress}%</div>

                <div className="automation-controls compact-controls">
                  <button className="btn btn-success btn-sm" onClick={() => startUserLearning(user.id)}>{VI.start}</button>
                  <button className="btn btn-danger btn-sm" onClick={() => stopUserLearning(user.id)}>{VI.stop}</button>
                  <button className="btn btn-secondary btn-sm" onClick={() => closeBrowser(user.id)}>{VI.closeBrowser}</button>
                </div>

                <div className="manual-run-wrap">
                  <button
                    className="btn btn-secondary btn-sm manual-toggle-btn"
                    onClick={() => toggleManualPicker(user.id)}
                  >
                    {manualPickerOpen ? VI.manualToggleHide : VI.manualToggleShow}
                  </button>

                  {manualPickerOpen && (
                    <div className="manual-run-panel">
                      <select
                        className="manual-course-select"
                        value={selectedManualCourseId ?? ''}
                        onChange={(event) => setManualCourseSelection(user.id, Number(event.target.value))}
                        disabled={manualCandidateCourses.length === 0}
                      >
                        {manualCandidateCourses.length === 0 ? (
                          <option value="">{VI.manualEmpty}</option>
                        ) : (
                          manualCandidateCourses.map((course) => (
                            <option key={course.course_id} value={course.course_id}>
                              {course.course_name} ({course.progress}%)
                            </option>
                          ))
                        )}
                      </select>
                      <button
                        className="btn btn-secondary btn-sm manual-run-btn"
                        onClick={() => startSelectedCourse(user.id)}
                        disabled={manualCandidateCourses.length === 0}
                      >
                        {VI.manualRun}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm manual-clear-btn"
                        onClick={() => clearSelectedCourseCheckpoint(user.id)}
                        disabled={manualCandidateCourses.length === 0}
                      >
                        {VI.manualClearCheckpoint}
                      </button>
                    </div>
                  )}
                </div>

                {runStatus && (
                  <div className="automation-debug-status" title={VI.debugStatus}>
                    <div>
                      <span className="debug-phase">{runStatus.phase}</span>
                      <span className="debug-step">{runStatus.step}</span>
                    </div>
                    <span className="debug-msg">{runStatus.message}</span>
                    <div className="debug-meta">
                      {runStatus.courseId != null && (
                        <span>
                          {VI.debugCourseId}={runStatus.courseId}
                          {typeof runStatus.progress === 'number' ? ` · ${VI.debugProgress} ${runStatus.progress}%` : ''}
                          {' · '}
                        </span>
                      )}
                      {new Date(runStatus.ts).toLocaleTimeString()}
                    </div>
                  </div>
                )}

                <div className="course-preview-section">
                  <div className="course-preview-header">
                    <span>{VI.learningList}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => toggleExpand(user.id)}>{expanded ? VI.hideCourses : VI.showCourses}</button>
                  </div>

                  {!expanded && (
                    <div className="course-preview-list">
                      {stats.topIncomplete.length === 0 ? (
                        <div className="course-preview-empty">{VI.noIncomplete}</div>
                      ) : (
                        stats.topIncomplete.map((course) => (
                          <div key={course.course_id} className="course-preview-item">
                            <span className="course-preview-name" title={course.course_name}>{course.course_name}</span>
                            <span className="course-preview-progress">{course.progress}%</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {expanded && (
                    <div className="courses-compact expanded-course-list">
                      {courses.length > 0 ? (
                        courses.map((course) => (
                          <div key={course.course_id} className="course-compact-item">
                            <div className="course-compact-info">
                              <span className="course-compact-name" title={course.course_name}>{course.course_name}</span>
                              <span className="course-compact-progress" style={{ color: course.progress >= 100 ? '#1f8f42' : '#1f4f7a' }}>{course.progress}%</span>
                            </div>
                            <div className="progress-bar-compact">
                              <div className="progress-fill" style={{ width: `${course.progress}%`, background: course.progress >= 100 ? 'linear-gradient(90deg, #1f8f42 0%, #37b24d 100%)' : 'linear-gradient(90deg, #1d4ed8 0%, #0ea5e9 100%)' }}></div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="empty-state-text">{VI.noCourses}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AutomationTab;
