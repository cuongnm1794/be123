import React, { useState, useEffect } from 'react';
import { Log, User } from '../types';

const { ipcRenderer } = window.require('electron');

const LogsTab: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  useEffect(() => {
    loadLogs();
    loadUsers();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [selectedUserId]);

  const loadLogs = async () => {
    try {
      const userId = selectedUserId ? parseInt(selectedUserId, 10) : undefined;
      const data = await ipcRenderer.invoke('get-logs', userId);
      setLogs(data);
    } catch (error) {
      console.error('Error loading logs:', error);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await ipcRenderer.invoke('get-users');
      setUsers(data);
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const formatTimestamp = (timestamp: Date) => new Date(timestamp).toLocaleString('vi-VN');

  return (
    <div>
      <div className="section-header">
        <h2>{'Nh\u1eadt k\u00fd ho\u1ea1t \u0111\u1ed9ng'}</h2>
        <div className="log-filter">
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">{'T\u1ea5t c\u1ea3 ng\u01b0\u1eddi d\u00f9ng'}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary" onClick={loadLogs}>
            {'L\u00e0m m\u1edbi'}
          </button>
        </div>
      </div>

      <div className="logs-list">
        {logs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">Log</div>
            <div className="empty-state-text">{'Ch\u01b0a c\u00f3 nh\u1eadt k\u00fd n\u00e0o.'}</div>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="log-item">
              <div className="log-header">
                <div className="log-user">{log.username || `User ${log.user_id}`}</div>
                <div className="log-time">{formatTimestamp(log.timestamp)}</div>
              </div>
              <div className="log-action">{log.action}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogsTab;
