# ⚡ Quick Start - React Version

## Chạy ngay (Production)

```bash
npm install
npm run build
npm start
```

## Development với Hot Reload

### Terminal 1:
```bash
npm run dev:renderer
```

### Terminal 2 (đợi Vite chạy xong):
```bash
npm start  
```

## File quan trọng

- `src-renderer/components/` - Tất cả React components
- `src-renderer/App.tsx` - Main app
- `src/main.ts` - Electron backend
- `src/database/index.ts` - PostgreSQL
- `src/automation/index.ts` - Playwright

## Sửa code ở đâu?

### Thêm/sửa UI:
→ `src-renderer/components/`

### Sửa automation logic:
→ `src/automation/index.ts`

### Sửa database:
→ `src/database/index.ts`

### Sửa IPC handlers:
→ `src/main.ts`

### Sửa CSS:
→ `src-renderer/index.css`

## Docs

- `REACT-DONE.md` - Tổng quan hoàn thành
- `REACT-GUIDE.md` - Hướng dẫn chi tiết React
- `README.md` - Tài liệu project
- `HUONG-DAN.md` - Hướng dẫn tiếng Việt

Enjoy! 🚀
