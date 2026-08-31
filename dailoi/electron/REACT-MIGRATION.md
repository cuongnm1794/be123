# Hướng dẫn Chuyển sang React

## ✅ Đã chuẩn bị sẵn:

1. **Package.json** đã cập nhật với React dependencies
2. **Vite config** để build React
3. **TypeScript configs** cho cả main process và renderer
4. **Cấu trúc thư mục mới**:
   - `src/` - Main process (Electron backend)
   - `src-renderer/` - React frontend
   - `renderer-dist/` - Build output

## 🚀 Cách triển khai:

### Bước 1: Cài đặt dependencies (đã xong)
```bash
npm install
```

### Bước 2: Tạo cấu trúc React components

Tạo thư mục và files:
```
src-renderer/
├── main.tsx              # Entry point
├── App.tsx               # Main app component
├── index.css             # Global styles
├── types.ts              # TypeScript types
└── components/
    ├── UsersTab.tsx
    ├── CoursesTab.tsx
    ├── AutomationTab.tsx
    ├── LogsTab.tsx
    ├── ProgressModal.tsx
    ├── InputDialog.tsx
    └── ...
```

### Bước 3: Copy CSS hiện tại

Copy toàn bộ nội dung từ `renderer/styles.css` sang `src-renderer/index.css`

### Bước 4: Tạo types.ts

```typescript
export interface User {
  id: number;
  username: string;
  password: string;
  is_finish: boolean;
}

export interface Course {
  id: number;
  course_name: string;
  description: string;
  link: string;
}

export interface UserCourse {
  id: number;
  user_id: number;
  course_id: number;
  progress: number;
  time: Date;
  course_name?: string;
  description?: string;
  link?: string;
}

export interface Log {
  id: number;
  user_id: number;
  username?: string;
  action: string;
  timestamp: Date;
}

// Electron IPC Renderer type
declare global {
  interface Window {
    require: any;
  }
}
```

### Bước 5: Convert component từ vanilla JS sang React

**Ví dụ UsersTab.tsx**:

```typescript
import React, { useState, useEffect } from 'react';
import { User } from '../types';

const { ipcRenderer } = window.require('electron');

interface Props {
  showInputDialog: (title: string, defaultValue: string, onSubmit: (value: string) => void) => void;
}

const UsersTab: React.FC<Props> = ({ showInputDialog }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ username: '', password: '' });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    const data = await ipcRenderer.invoke('get-users');
    setUsers(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await ipcRenderer.invoke('create-user', {
        ...formData,
        is_finish: false
      });
      setShowForm(false);
      setFormData({ username: '', password: '' });
      loadUsers();
      alert('✅ Tạo người dùng thành công!');
    } catch (error: any) {
      alert('❌ Lỗi: ' + error.message);
    }
  };

  const deleteUser = async (userId: number) => {
    if (!confirm('Bạn có chắc muốn xóa người dùng này?')) return;
    
    try {
      await ipcRenderer.invoke('delete-user', userId);
      loadUsers();
      alert('✅ Xóa người dùng thành công!');
    } catch (error: any) {
      alert('❌ Lỗi: ' + error.message);
    }
  };

  const loginUser = async (user: User) => {
    showInputDialog('Nhập URL trang đăng nhập', 'https://example.com/login', async (loginUrl) => {
      try {
        const success = await ipcRenderer.invoke('login', {
          userId: user.id,
          username: user.username,
          password: user.password,
          loginUrl,
        });
        
        if (success) {
          alert('✅ Đăng nhập thành công!');
        } else {
          alert('⚠️ Vui lòng kiểm tra trình duyệt và đăng nhập thủ công nếu cần.');
        }
      } catch (error: any) {
        alert('❌ Lỗi: ' + error.message);
      }
    });
  };

  return (
    <div>
      <div className="section-header">
        <h2>Quản lý người dùng</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          ➕ Thêm người dùng
        </button>
      </div>

      {showForm && (
        <div className="form-container">
          <h3>Thêm người dùng mới</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Username:</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Password:</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary">Lưu</button>
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="data-list">
        {users.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <div className="empty-state-text">Chưa có người dùng nào. Hãy thêm người dùng mới!</div>
          </div>
        ) : (
          users.map(user => (
            <div key={user.id} className="card">
              <div className="card-header">
                <div className="card-title">👤 {user.username}</div>
                <div className="card-actions">
                  <button className="btn btn-info" onClick={() => loginUser(user)}>
                    🔑 Đăng nhập
                  </button>
                  <button className="btn btn-danger" onClick={() => deleteUser(user.id)}>
                    🗑️ Xóa
                  </button>
                </div>
              </div>
              <div className="card-body">
                <p>
                  <strong>Trạng thái:</strong>{' '}
                  {user.is_finish ? (
                    <span className="badge badge-success">Hoàn thành</span>
                  ) : (
                    <span className="badge badge-warning">Đang học</span>
                  )}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default UsersTab;
```

## 📋 Checklist chuyển đổi:

- [ ] Copy CSS từ `renderer/styles.css` sang `src-renderer/index.css`
- [ ] Tạo `src-renderer/types.ts`
- [ ] Tạo `src-renderer/components/UsersTab.tsx` (theo mẫu trên)
- [ ] Tạo `src-renderer/components/CoursesTab.tsx` (tương tự)
- [ ] Tạo `src-renderer/components/AutomationTab.tsx` (tương tự)
- [ ] Tạo `src-renderer/components/LogsTab.tsx` (tương tự)
- [ ] Tạo `src-renderer/components/ProgressModal.tsx`
- [ ] Tạo `src-renderer/components/InputDialog.tsx`
- [ ] Update `src-renderer/App.tsx` (đã tạo sẵn)
- [ ] Update `src-renderer/main.tsx` (đã tạo sẵn)

## 🏃 Chạy development:

```bash
# Terminal 1: Watch TypeScript main process
npm run watch:main

# Terminal 2: Run Vite dev server
npm run dev:renderer

# Terminal 3: Run Electron
npm start
```

## 🔨 Build production:

```bash
npm run build
npm start
```

## 💡 Lợi ích của React:

1. **State Management** dễ dàng với hooks
2. **Component Reusability** - tái sử dụng components
3. **Better TypeScript** support
4. **Hot Module Replacement** - thay đổi code không cần reload
5. **Easier Testing** với React Testing Library
6. **Better Developer Experience** với DevTools

## ⚠️ Lưu ý:

- IPC communication vẫn giữ nguyên
- Main process (Electron backend) không thay đổi
- Chỉ frontend được chuyển sang React
- Tất cả logic automation và database vẫn hoạt động như cũ

## 🎯 Tiếp theo:

Bạn có muốn tôi:
1. Tạo tất cả React components ngay bây giờ?
2. Tạo từng component một để giải thích chi tiết?
3. Giữ nguyên vanilla JS và chỉ optimize code hiện tại?

Cho tôi biết lựa chọn của bạn!
