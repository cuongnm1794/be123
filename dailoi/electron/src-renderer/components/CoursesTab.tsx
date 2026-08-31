import React, { useState, useEffect } from 'react';
import { Course } from '../types';

const { ipcRenderer } = window.require('electron');

const CoursesTab: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    course_name: '',
    description: '',
    link: ''
  });

  useEffect(() => {
    loadCourses();
  }, []);

  const loadCourses = async () => {
    try {
      const data = await ipcRenderer.invoke('get-courses');
      setCourses(data);
    } catch (error) {
      console.error('Error loading courses:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ipcRenderer.invoke('create-course', formData);
      setShowForm(false);
      setFormData({ course_name: '', description: '', link: '' });
      loadCourses();
      alert('\u2705 T\u1ea1o kh\u00f3a h\u1ecdc th\u00e0nh c\u00f4ng!');
    } catch (error: any) {
      alert('\u274c L\u1ed7i: ' + error.message);
    }
  };

  return (
    <div>
      <div className="section-header">
        <h2>{'Qu\u1ea3n l\u00fd kh\u00f3a h\u1ecdc'}</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          {'+ Th\u00eam kh\u00f3a h\u1ecdc'}
        </button>
      </div>

      {showForm && (
        <div className="form-container">
          <h3>{'Th\u00eam kh\u00f3a h\u1ecdc m\u1edbi'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{'T\u00ean kh\u00f3a h\u1ecdc:'}</label>
              <input
                type="text"
                value={formData.course_name}
                onChange={(e) => setFormData({ ...formData, course_name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>{'M\u00f4 t\u1ea3:'}</label>
              <textarea
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label>Link:</label>
              <input
                type="url"
                value={formData.link}
                onChange={(e) => setFormData({ ...formData, link: e.target.value })}
                required
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">{'L\u01b0u'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                {'H\u1ee7y'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="data-list">
        {courses.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">Khoa hoc</div>
            <div className="empty-state-text">{'Ch\u01b0a c\u00f3 kh\u00f3a h\u1ecdc n\u00e0o. H\u00e3y th\u00eam kh\u00f3a h\u1ecdc m\u1edbi!'} </div>
          </div>
        ) : (
          courses.map(course => (
            <div key={course.id} className="card">
              <div className="card-header">
                <div className="card-title">{course.course_name}</div>
              </div>
              <div className="card-body">
                <p>{course.description || 'Kh\u00f4ng c\u00f3 m\u00f4 t\u1ea3'}</p>
                <p>
                  <strong>Link:</strong>{' '}
                  <a href={course.link} target="_blank" rel="noopener noreferrer">
                    {course.link}
                  </a>
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CoursesTab;
