# Fix: window.require is not a function

## Vấn đề
Khi chạy `npm run dev` hoặc `npm start`, bạn gặp lỗi:
```
UsersTab.tsx:19 Uncaught TypeError: window.require is not a function
```

## Nguyên nhân
- `nodeIntegration` và `contextIsolation` cần được cấu hình đúng
- Vite dev server và production build cần load URL khác nhau
- Preload script giúp expose Electron API an toàn hơn

## Giải pháp đã áp dụng

### 1. Tạo Preload Script (`src/preload.ts`)
Expose `ipcRenderer` ra window object một cách an toàn.

### 2. Update Main Process (`src/main.ts`)
- Thêm preload script vào webPreferences
- Sửa logic load URL cho dev và production

### 3. Build lại
```bash
npm run build:main
npm start
```

## Kết quả
✅ App chạy bình thường
✅ `window.require('electron')` hoạt động
✅ IPC communication hoạt động

## Lưu ý
- Sau khi sửa `src/main.ts` hoặc `src/preload.ts`, cần chạy `npm run build:main`
- Chỉ cần build renderer khi sửa React code: `npm run build:renderer`

Happy coding! 🚀
