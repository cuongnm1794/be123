import React, { useEffect, useMemo, useRef, useState } from 'react';
import { User } from '../types';

const { ipcRenderer } = window.require('electron');

interface Props {
  showInputDialog: (title: string, defaultValue: string, onSubmit: (value: string) => void) => void;
}

const VI = {
  title: 'Qu\u1ea3n l\u00fd ng\u01b0\u1eddi d\u00f9ng',
  addUser: 'Th\u00eam ng\u01b0\u1eddi d\u00f9ng',
  search: 'T\u00ecm theo username ho\u1eb7c t\u00ean hi\u1ec3n th\u1ecb...',
  all: 'T\u1ea5t c\u1ea3',
  status: 'Tr\u1ea1ng th\u00e1i',
  personal: 'Th\u00f4ng tin c\u00e1 nh\u00e2n',
  doneCourses: 'Kh\u00f3a h\u1ecdc \u0111\u00e3 xong',
  studyHours: 'Gi\u1edd \u0111\u00e3 h\u1ecdc h\u00f4m nay',
  actions: 'Thao t\u00e1c',
  autoOn: '\u0110ang Auto',
  manual: 'Manual',
  login: '\u0110\u0103ng nh\u1eadp',
  sync: '\u0110\u1ed3ng b\u1ed9',
  openResult: 'M\u1edf trang k\u1ebft qu\u1ea3',
  takeScreenshot: 'Ch\u1ee5p \u1ea3nh',
  captured: '\u0110\u00e3 ch\u1ee5p',
  moreActions: 'Thao t\u00e1c \u25bc',
  edit: 'S\u1eeda',
  remove: 'X\u00f3a',
  noUsers: 'Kh\u00f4ng c\u00f3 ng\u01b0\u1eddi d\u00f9ng ph\u00f9 h\u1ee3p v\u1edbi b\u1ed9 l\u1ecdc.',
  createOk: '\u2705 T\u1ea1o ng\u01b0\u1eddi d\u00f9ng th\u00e0nh c\u00f4ng!',
  updateOk: '\u2705 C\u1eadp nh\u1eadt ng\u01b0\u1eddi d\u00f9ng th\u00e0nh c\u00f4ng!',
  deleteOk: '\u2705 X\u00f3a ng\u01b0\u1eddi d\u00f9ng th\u00e0nh c\u00f4ng!',
  err: '\u274c L\u1ed7i: ',
  confirmDelete: 'B\u1ea1n c\u00f3 ch\u1eafc mu\u1ed1n x\u00f3a ng\u01b0\u1eddi d\u00f9ng n\u00e0y?',
  formEdit: 'Ch\u1ec9nh s\u1eeda ng\u01b0\u1eddi d\u00f9ng',
  formCreate: 'Th\u00eam ng\u01b0\u1eddi d\u00f9ng m\u1edbi',
  displayName: 'T\u00ean hi\u1ec3n th\u1ecb',
  pass: 'M\u1eadt kh\u1ea9u',
  passKeep: '(\u0111\u1ec3 tr\u1ed1ng n\u1ebfu kh\u00f4ng \u0111\u1ed5i)',
  save: 'L\u01b0u',
  cancel: 'H\u1ee7y',
  update: 'C\u1eadp nh\u1eadt',
  noName: 'Ch\u01b0a \u0111\u1eb7t t\u00ean',
  noWebId: 'Ch\u01b0a c\u00f3 Web ID',
  hours: 'gi\u1edd',
};

const UsersTab: React.FC<Props> = ({ showInputDialog: _showInputDialog }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [userStats, setUserStats] = useState<Map<number, { completed: number; total: number }>>(new Map());
  const [studyHours, setStudyHours] = useState<Map<number, number>>(new Map());

  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', name: '' });

  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'auto' | 'manual'>('all');
  const [openDropdown, setOpenDropdown] = useState<number | null>(null);
  const [capturedUsers, setCapturedUsers] = useState<Set<number>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const data = await ipcRenderer.invoke('get-users');
      setUsers(data);

      const statsMap = new Map<number, { completed: number; total: number }>();
      const hoursMap = new Map<number, number>();

      for (const user of data) {
        try {
          const stats = await ipcRenderer.invoke('get-user-course-stats', user.id);
          statsMap.set(user.id, stats);
        } catch {
          statsMap.set(user.id, { completed: 0, total: 0 });
        }

        try {
          const hours = await ipcRenderer.invoke('get-today-study-hours', user.id);
          hoursMap.set(user.id, hours);
        } catch {
          hoursMap.set(user.id, 0);
        }
      }

      setUserStats(statsMap);
      setStudyHours(hoursMap);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingUser) {
        const updateData: any = {};
        if (formData.username) updateData.username = formData.username;
        if (formData.password) updateData.password = formData.password;
        if (formData.name) updateData.name = formData.name;

        await ipcRenderer.invoke('update-user', editingUser.id, updateData);
        alert(VI.updateOk);
      } else {
        await ipcRenderer.invoke('create-user', {
          ...formData,
          is_finish: false,
          is_running: false,
        });
        alert(VI.createOk);
      }

      setShowForm(false);
      setEditingUser(null);
      setFormData({ username: '', password: '', name: '' });
      loadUsers();
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const editUser = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, password: '', name: user.name || '' });
    setShowForm(true);
  };

  const cancelEdit = () => {
    setShowForm(false);
    setEditingUser(null);
    setFormData({ username: '', password: '', name: '' });
  };

  const toggleRunning = async (userId: number, currentStatus: boolean) => {
    try {
      await ipcRenderer.invoke('update-user', userId, { is_running: !currentStatus });
      loadUsers();
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm(VI.confirmDelete)) return;
    try {
      await ipcRenderer.invoke('delete-user', userId);
      loadUsers();
      alert(VI.deleteOk);
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const loginUser = async (user: User) => {
    try {
      await ipcRenderer.invoke('login', user.id, user.username, user.password);
      loadUsers();
    } catch (error: any) {
      alert(VI.err + error.message);
      loadUsers();
    }
  };

  const syncCourses = async (userId: number) => {
    try {
      const result = await ipcRenderer.invoke('sync-courses', userId);
      if (result.success) {
        alert('\u2705 ' + result.message);
      } else {
        alert('\u274c ' + result.message);
      }
      loadUsers();
    } catch (error: any) {
      alert(VI.err + error.message);
      loadUsers();
    }
  };

  const openResultPage = async (user: User) => {
    setOpenDropdown(null);
    try {
      const result = await ipcRenderer.invoke('open-result-page', user.id);
      if (!result.success) {
        alert('\u274c ' + result.message);
      }
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const takeScreenshot = async (user: User) => {
    setOpenDropdown(null);
    try {
      const result = await ipcRenderer.invoke('take-screenshot', user.id);
      if (result.success) {
        setCapturedUsers((prev) => new Set(prev).add(user.id));
        alert(`\u2705 \u0110\u00e3 ch\u1ee5p \u1ea3nh: ${result.filePath}`);
      } else {
        alert('\u274c ' + result.message);
      }
    } catch (error: any) {
      alert(VI.err + error.message);
    }
  };

  const filteredUsers = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return users.filter((user) => {
      if (filterMode === 'auto' && !user.is_running) return false;
      if (filterMode === 'manual' && user.is_running) return false;
      if (!keyword) return true;
      return user.username.toLowerCase().includes(keyword) || (user.name || '').toLowerCase().includes(keyword);
    });
  }, [users, query, filterMode]);

  const getCourseSummary = (userId: number) => {
    const stats = userStats.get(userId) || { completed: 0, total: 0 };
    const percent = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    return `${stats.completed}/${stats.total} (${percent}%)`;
  };

  return (
    <div>
      <div className="section-header users-header-row">
        <h2>{VI.title}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>{'+ ' + VI.addUser}</button>
      </div>

      <div className="users-toolbar">
        <input
          type="text"
          className="form-control users-search"
          placeholder={VI.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="users-filter-group">
          <button className={`btn btn-sm ${filterMode === 'all' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterMode('all')}>{VI.all}</button>
          <button className={`btn btn-sm ${filterMode === 'auto' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterMode('auto')}>Auto</button>
          <button className={`btn btn-sm ${filterMode === 'manual' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilterMode('manual')}>{VI.manual}</button>
        </div>
      </div>

      {showForm && (
        <div className="form-container users-form-modern">
          <h3>{editingUser ? VI.formEdit : VI.formCreate}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username</label>
              <input type="text" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} required={!editingUser} disabled={!!editingUser} />
            </div>
            <div className="form-group">
              <label>{VI.displayName}</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder={VI.displayName} />
            </div>
            <div className="form-group">
              <label>{VI.pass + ' ' + (editingUser ? VI.passKeep : '')}</label>
              <input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} required={!editingUser} />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{editingUser ? VI.update : VI.save}</button>
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>{VI.cancel}</button>
            </div>
          </form>
        </div>
      )}

      {filteredUsers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">Users</div>
          <div className="empty-state-text">{VI.noUsers}</div>
        </div>
      ) : (
        <div className="users-table-wrap">
          <table className="users-table">
            <thead>
              <tr>
                <th>{VI.personal}</th>
                <th>{VI.status}</th>
                <th>{VI.doneCourses}</th>
                <th>{VI.studyHours}</th>
                <th>{VI.actions}</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell-main">{user.name || VI.noName}</div>
                    <div className="user-cell-sub">@{user.username}</div>
                    <div className="user-cell-sub">{user.user_id ? `Web ID: ${user.user_id}` : VI.noWebId}</div>
                  </td>
                  <td>
                    <button className={`btn btn-sm ${user.is_running ? 'btn-success' : 'btn-secondary'}`} onClick={() => toggleRunning(user.id, user.is_running)}>
                      {user.is_running ? VI.autoOn : VI.manual}
                    </button>
                  </td>
                  <td>{getCourseSummary(user.id)}</td>
                  <td><span className={(studyHours.get(user.id) || 0) >= 10 ? 'hour-limit' : ''}>{(studyHours.get(user.id) || 0).toFixed(2)} {VI.hours}</span></td>
                  <td>
                    <div className="user-actions-dropdown" ref={openDropdown === user.id ? dropdownRef : undefined}>
                      <button className="btn btn-sm btn-primary" onClick={() => setOpenDropdown(openDropdown === user.id ? null : user.id)}>
                        {VI.moreActions}
                      </button>
                      {capturedUsers.has(user.id) && <span className="captured-badge">{VI.captured}</span>}
                      {openDropdown === user.id && (
                        <div className="dropdown-menu-custom">
                          <button className="dropdown-item-custom" onClick={() => { setOpenDropdown(null); loginUser(user); }}>{VI.login}</button>
                          <button className="dropdown-item-custom" onClick={() => { setOpenDropdown(null); syncCourses(user.id); }}>{VI.sync}</button>
                          <div className="dropdown-divider-custom" />
                          <button className="dropdown-item-custom" onClick={() => openResultPage(user)}>{VI.openResult}</button>
                          <button className="dropdown-item-custom" onClick={() => takeScreenshot(user)}>{VI.takeScreenshot}</button>
                          <div className="dropdown-divider-custom" />
                          <button className="dropdown-item-custom" onClick={() => { setOpenDropdown(null); editUser(user); }}>{VI.edit}</button>
                          <button className="dropdown-item-custom dropdown-item-danger" onClick={() => { setOpenDropdown(null); deleteUser(user.id); }}>{VI.remove}</button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default UsersTab;
