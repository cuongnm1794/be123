import React from 'react';

interface Props {
  show: boolean;
  title: string;
  progress: number;
  message: string;
}

const ProgressModal: React.FC<Props> = ({ show, title, progress, message }) => {
  if (!show) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>{title}</h3>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }}>
            {progress > 10 && `${progress}%`}
          </div>
        </div>
        <p>{message}</p>
      </div>
    </div>
  );
};

export default ProgressModal;
