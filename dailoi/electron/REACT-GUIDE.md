# React Development Guide

## 🚀 Dự án đã chuyển sang React!

### Cấu trúc mới:

```
Electron/
├── src/                          # Main process (Electron backend)
│   ├── database/
│   │   └── index.ts
│   ├── automation/
│   │   └── index.ts
│   └── main.ts
├── src-renderer/                 # React frontend
│   ├── components/
│   │   ├── UsersTab.tsx
│   │   ├── CoursesTab.tsx
│   │   ├── AutomationTab.tsx
│   │   ├── LogsTab.tsx
│   │   ├── ProgressModal.tsx
│   │   └── InputDialog.tsx
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   └── types.ts
├── renderer-dist/                # Build output
├── index.html                    # Entry HTML
└── vite.config.ts                # Vite configuration
```

## 📦 Development Scripts

### Development Mode (Khuyến nghị)

Chạy 2 terminal riêng biệt:

**Terminal 1 - Vite Dev Server (Hot Reload):**
```bash
npm run dev:renderer
```

**Terminal 2 - Electron:**
```bash
npm start
```

Với cách này, mỗi khi bạn sửa code React, nó sẽ tự động reload mà không cần restart Electron!

### Production Build

```bash
# Build cả main và renderer
npm run build

# Hoặc build riêng lẻ
npm run build:main      # Build Electron main process
npm run build:renderer  # Build React app

# Sau đó chạy
npm start
```

## 🎨 Làm việc với React Components

### 1. UsersTab Component
Quản lý CRUD users:
- Thêm user
- Xóa user
- Đăng nhập
- Đồng bộ courses

### 2. CoursesTab Component
Quản lý khóa học:
- Thêm course
- Hiển thị danh sách

### 3. AutomationTab Component
Tự động hóa:
- Chạy/dừng learning cho từng user
- Chạy/dừng tất cả
- Hiển thị progress realtime
- Listen IPC events

### 4. LogsTab Component
Xem logs:
- Filter theo user
- Auto-format timestamp
- Refresh

### 5. Shared Components
- **ProgressModal**: Hiển thị tiến trình
- **InputDialog**: Input dialog thay thế prompt()

## 🔧 Thêm Component Mới

1. Tạo file trong `src-renderer/components/`:
```tsx
import React from 'react';

const MyComponent: React.FC = () => {
  return (
    <div>
      {/* Your component */}
    </div>
  );
};

export default MyComponent;
```

2. Import vào App.tsx hoặc component khác:
```tsx
import MyComponent from './components/MyComponent';
```

## 🎯 IPC Communication

### Gọi từ React → Main Process:
```tsx
const { ipcRenderer } = window.require('electron');

const result = await ipcRenderer.invoke('handler-name', ...args);
```

### Lắng nghe event từ Main Process:
```tsx
useEffect(() => {
  const { ipcRenderer } = window.require('electron');
  
  const handler = (_: any, data: any) => {
    // Handle event
  };
  
  ipcRenderer.on('event-name', handler);
  
  return () => {
    ipcRenderer.removeListener('event-name', handler);
  };
}, []);
```

## 💡 React Hooks Patterns

### State Management:
```tsx
const [data, setData] = useState<Type[]>([]);
```

### Effect for loading data:
```tsx
useEffect(() => {
  loadData();
}, []); // Empty array = chỉ chạy 1 lần khi mount
```

### Effect với dependencies:
```tsx
useEffect(() => {
  loadData();
}, [userId]); // Chạy lại khi userId thay đổi
```

## 🎨 Styling

CSS được import vào `main.tsx`:
```tsx
import './index.css';
```

Tất cả styles từ vanilla version đã được giữ nguyên, components dùng cùng class names.

## 🔥 Hot Module Replacement (HMR)

Khi chạy `npm run dev:renderer`:
- Vite dev server chạy ở port 5173
- Mọi thay đổi code tự động reload
- Không mất state (trong hầu hết trường hợp)

## 🚨 Common Issues

### "Cannot find module 'electron'"
Cài lại dependencies:
```bash
npm install
```

### Build lỗi
Xóa cache và build lại:
```bash
npm run clean
npm run build
```

### Electron không load React app
Check `src/main.ts`:
- Development: Load `http://localhost:5173`
- Production: Load từ `renderer-dist/index.html`

## 📚 Learning Resources

- React Docs: https://react.dev
- TypeScript: https://www.typescriptlang.org
- Vite: https://vitejs.dev
- Electron IPC: https://www.electronjs.org/docs/latest/api/ipc-renderer

## ✨ Benefits of React

1. **Component Reusability** - Tái sử dụng components
2. **State Management** - Quản lý state dễ dàng với hooks
3. **TypeScript Support** - Type safety tốt hơn
4. **Hot Reload** - Dev experience tốt hơn
5. **Ecosystem** - Nhiều libraries hỗ trợ
6. **Easier Testing** - Test components dễ dàng
7. **Better Performance** - Virtual DOM optimization

## 🎓 Next Steps

Bạn có thể mở rộng:
- Thêm React Router cho multi-page
- Thêm State Management (Redux, Zustand)
- Thêm UI Library (Material-UI, Ant Design)
- Thêm Form Validation (React Hook Form, Formik)
- Thêm Charts (Recharts, Chart.js)
- Thêm Notifications (react-toastify)

Happy coding! 🚀
