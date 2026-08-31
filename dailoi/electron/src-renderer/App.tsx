import React, { useState, useEffect } from 'react';
import UsersTab from './components/UsersTab';
import CoursesTab from './components/CoursesTab';
import AutomationTab from './components/AutomationTab';
import LogsTab from './components/LogsTab';
import ProgressModal from './components/ProgressModal';
import InputDialog from './components/InputDialog';

type TabName = 'users' | 'courses' | 'automation' | 'logs';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabName>('users');
  const [progressData] = useState({
    show: false,
    title: '',
    progress: 0,
    message: ''
  });

  const [inputDialog, setInputDialog] = useState({
    show: false,
    title: '',
    defaultValue: '',
    onSubmit: (_value: string) => {}
  });

  useEffect(() => {
    return () => {
      // Cleanup if needed
    };
  }, []);

  const showInputDialog = (title: string, defaultValue: string, onSubmit: (value: string) => void) => {
    setInputDialog({ show: true, title, defaultValue, onSubmit });
  };

  const hideInputDialog = () => {
    setInputDialog((prev) => ({ ...prev, show: false }));
  };

  const refreshAll = () => {
    window.location.reload();
  };

  return (
    <div className="container">
      <header>
        <h1>{'H\u1ec7 th\u1ed1ng h\u1ecdc t\u1ef1 \u0111\u1ed9ng'}</h1>
        <div className="header-actions">
          <button className="btn btn-secondary" onClick={refreshAll}>
            {'L\u00e0m m\u1edbi'}
          </button>
        </div>
      </header>

      <div className="tabs">
        <button
          className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          {'Ng\u01b0\u1eddi d\u00f9ng'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'courses' ? 'active' : ''}`}
          onClick={() => setActiveTab('courses')}
        >
          {'Kh\u00f3a h\u1ecdc'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'automation' ? 'active' : ''}`}
          onClick={() => setActiveTab('automation')}
        >
          {'T\u1ef1 \u0111\u1ed9ng h\u00f3a'}
        </button>
        <button
          className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          {'Nh\u1eadt k\u00fd'}
        </button>
      </div>

      <div className="tab-content">
        {activeTab === 'users' && <UsersTab showInputDialog={showInputDialog} />}
        {activeTab === 'courses' && <CoursesTab />}
        {activeTab === 'automation' && <AutomationTab />}
        {activeTab === 'logs' && <LogsTab />}
      </div>

      <ProgressModal
        show={progressData.show}
        title={progressData.title}
        progress={progressData.progress}
        message={progressData.message}
      />

      <InputDialog
        show={inputDialog.show}
        title={inputDialog.title}
        defaultValue={inputDialog.defaultValue}
        onSubmit={(value: string) => {
          inputDialog.onSubmit(value);
          hideInputDialog();
        }}
        onCancel={hideInputDialog}
      />
    </div>
  );
};

export default App;
