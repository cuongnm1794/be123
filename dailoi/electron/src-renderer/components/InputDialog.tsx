import React, { useState, useEffect } from 'react';

interface Props {
  show: boolean;
  title: string;
  defaultValue: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const InputDialog: React.FC<Props> = ({ show, title, defaultValue, onSubmit, onCancel }) => {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue, show]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value.trim());
    }
  };

  if (!show) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h3>{title}</h3>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <input
              type="text"
              className="form-control"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              OK
            </button>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              {'H\u1ee7y'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InputDialog;
