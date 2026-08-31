# Electron Auto Learning System

Hệ thống tự động hóa học tập sử dụng Electron, TypeScript, PostgreSQL và Playwright.

## Tính năng

- ✅ Quản lý nhiều người dùng với Chrome profile riêng biệt
- ✅ Tự động đăng nhập vào website học tập
- ✅ Theo dõi tiến độ học của từng khóa học
- ✅ Hỗ trợ chạy nhiều người dùng đồng thời
- ✅ Hỗ trợ chạy nhiều trình duyệt cùng lúc
- ✅ Lưu lại tiến độ khi dừng giữa chừng
- ✅ Ghi log tất cả hoạt động
- ✅ Giao diện người dùng thân thiện

## Yêu cầu hệ thống

- Node.js 18 trở lên
- PostgreSQL 12 trở lên
- Chrome hoặc Chromium browser

## Cài đặt

### 1. Clone hoặc tải project

```bash
cd d:\2025\Linh\Electron
```

### 2. Cài đặt dependencies

```bash
npm install
```

### 3. Cài đặt Playwright browsers

```bash
npx playwright install chromium
# Hoặc sử dụng Chrome
npx playwright install chrome
```

### 4. Cấu hình Database

Tạo database PostgreSQL:

```sql
CREATE DATABASE auto_learning;
```

Tạo file `.env` trong thư mục gốc:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auto_learning
DB_USER=postgres
DB_PASSWORD=your_password
```

### 5. Biên dịch TypeScript

```bash
npm run build
```

## Cấu trúc Database

Hệ thống sẽ tự động tạo các bảng sau:

### Table: users
- `id` (SERIAL PRIMARY KEY)
- `username` (VARCHAR)
- `password` (VARCHAR)
- `is_finish` (BOOLEAN)

### Table: courses
- `id` (SERIAL PRIMARY KEY)
- `course_name` (VARCHAR)
- `description` (TEXT)
- `link` (VARCHAR)

### Table: user_courses
- `id` (SERIAL PRIMARY KEY)
- `user_id` (INTEGER FK)
- `course_id` (INTEGER FK)
- `progress` (FLOAT)
- `time` (TIMESTAMP)

### Table: logs
- `id` (SERIAL PRIMARY KEY)
- `user_id` (INTEGER FK)
- `action` (TEXT)
- `timestamp` (TIMESTAMP)

## Sử dụng

### Chạy ứng dụng

```bash
npm start
```

Hoặc chế độ development với auto-reload:

```bash
npm run watch
# Trong terminal khác:
npm start
```

### Quy trình sử dụng

1. **Thêm người dùng:**
   - Click tab "Người dùng"
   - Click "Thêm người dùng"
   - Nhập username và password
   - Click "Lưu"

2. **Đăng nhập:**
   - Click nút "Đăng nhập" bên cạnh người dùng
   - Nhập URL trang đăng nhập
   - Hệ thống sẽ tự động đăng nhập (hoặc bạn có thể đăng nhập thủ công)

3. **Thêm khóa học:**
   - Click tab "Khóa học"
   - Click "Thêm khóa học"
   - Nhập thông tin khóa học
   - Click "Lưu"

4. **Chạy tự động:**
   - Click tab "Tự động hóa"
   - Click "Bắt đầu" cho người dùng muốn chạy
   - Hoặc click "Chạy tất cả" để chạy tất cả người dùng

5. **Xem log:**
   - Click tab "Nhật ký"
   - Chọn người dùng hoặc xem tất cả

## Tùy chỉnh Automation

File `src/automation/index.ts` chứa logic automation. Bạn cần tùy chỉnh các selector và logic dựa trên website cụ thể:

### Tùy chỉnh Login

Sửa hàm `login()` trong `src/automation/index.ts`:

```typescript
// Thay đổi selector phù hợp với website của bạn
await page.fill('input[name="username"]', config.username);
await page.fill('input[name="password"]', config.password);
await page.click('button[type="submit"]');
```

### Tùy chỉnh Course Learning

Sửa hàm `startLearning()` trong `src/automation/index.ts`:

```typescript
// Thêm logic cụ thể cho việc học tập
// Ví dụ: click video, đợi video phát hết, click next, etc.
```

## Cấu trúc thư mục

```
Electron/
├── .github/
│   └── copilot-instructions.md
├── src/
│   ├── database/
│   │   └── index.ts          # Database operations
│   ├── automation/
│   │   └── index.ts          # Playwright automation
│   └── main.ts               # Electron main process
├── renderer/
│   ├── index.html            # UI layout
│   ├── styles.css            # UI styles
│   └── renderer.js           # UI logic
├── chrome-profiles/          # Chrome user profiles (auto-created)
├── dist/                     # Compiled JavaScript (auto-created)
├── package.json
├── tsconfig.json
└── README.md
```

## Scripts

- `npm start` - Chạy ứng dụng
- `npm run dev` - Build và chạy
- `npm run build` - Biên dịch TypeScript
- `npm run watch` - Watch mode cho TypeScript
- `npm run clean` - Xóa thư mục dist

## Troubleshooting

### Lỗi kết nối Database

Kiểm tra:
- PostgreSQL đang chạy
- Thông tin trong file `.env` đúng
- Database đã được tạo

### Lỗi Playwright

Cài đặt lại browsers:
```bash
npx playwright install
```

### Lỗi biên dịch TypeScript

Xóa và build lại:
```bash
npm run clean
npm run build
```

## Lưu ý

- Chrome profiles được lưu trong thư mục `chrome-profiles/`
- Mỗi user có 1 profile riêng để tránh bị logout
- Nên chạy login thủ công lần đầu để đảm bảo session được lưu
- Có thể dừng giữa chừng và tiếp tục sau, tiến độ được lưu trong database

## Phát triển thêm

- Thêm xác thực 2FA
- Thêm schedule tự động chạy theo lịch
- Thêm thông báo khi hoàn thành
- Thêm export báo cáo
- Thêm hỗ trợ proxy

## License

ISC

## Tác giả

Linh - 2025
