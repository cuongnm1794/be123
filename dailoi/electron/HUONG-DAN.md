# Hướng dẫn Cài đặt và Sử dụng Nhanh

## Bước 1: Chuẩn bị

### 1.1. Cài đặt Node.js
- Tải và cài đặt Node.js từ https://nodejs.org/ (phiên bản 18 trở lên)
- Kiểm tra: `node --version`

### 1.2. Cài đặt PostgreSQL
- Tải và cài đặt PostgreSQL từ https://www.postgresql.org/download/
- Ghi nhớ mật khẩu postgres khi cài đặt

### 1.3. Cài đặt Chrome
- Đảm bảo có Google Chrome đã cài đặt trên máy

## Bước 2: Cài đặt Project

### 2.1. Mở PowerShell tại thư mục project
```powershell
cd d:\2025\Linh\Electron
```

### 2.2. Cài đặt dependencies
```powershell
npm install
```

### 2.3. Cài đặt Playwright browsers
```powershell
npx playwright install chromium
```

## Bước 3: Cấu hình Database

### 3.1. Tạo database
Mở pgAdmin hoặc psql và chạy:
```sql
CREATE DATABASE auto_learning;
```

### 3.2. Tạo file .env
Copy file `.env.example` thành `.env` và sửa thông tin:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=auto_learning
DB_USER=postgres
DB_PASSWORD=mat_khau_cua_ban
```

### 3.3. Khởi tạo tables
Các bảng sẽ tự động được tạo khi chạy ứng dụng lần đầu.
Hoặc bạn có thể chạy file `database-setup.sql` trong pgAdmin/psql.

## Bước 4: Chạy Ứng dụng

### 4.1. Build project
```powershell
npm run build
```

### 4.2. Chạy ứng dụng
```powershell
npm start
```

## Bước 5: Sử dụng

### 5.1. Thêm người dùng
1. Click tab "Người dùng"
2. Click "➕ Thêm người dùng"
3. Nhập username và password (của tài khoản học tập)
4. Click "Lưu"

### 5.2. Đăng nhập
1. Click nút "🔑 Đăng nhập" bên cạnh người dùng
2. Nhập URL trang đăng nhập (ví dụ: https://example.com/login)
3. Hệ thống sẽ mở trình duyệt và cố gắng đăng nhập tự động
4. Nếu không thành công, hãy đăng nhập thủ công
5. Chrome profile sẽ được lưu lại, lần sau không cần đăng nhập lại

### 5.3. Thêm khóa học
1. Click tab "Khóa học"
2. Click "➕ Thêm khóa học"
3. Nhập:
   - Tên khóa học
   - Mô tả (optional)
   - Link khóa học
4. Click "Lưu"

### 5.4. Đồng bộ khóa học với user
1. Ở tab "Người dùng"
2. Click nút "🔄 Đồng bộ" để thêm khóa học vào user
3. Hoặc tự động thêm vào database bằng SQL/code

### 5.5. Chạy tự động
1. Click tab "Tự động hóa"
2. Chọn một trong các cách:
   - Click "▶️ Bắt đầu" cho từng user
   - Click "▶️ Chạy tất cả" để chạy tất cả user cùng lúc

### 5.6. Dừng và tiếp tục
- Click "⏹️ Dừng" để dừng quá trình học
- Tiến độ được lưu tự động
- Click "▶️ Bắt đầu" lại để tiếp tục từ nơi đã dừng

### 5.7. Xem log
1. Click tab "Nhật ký"
2. Chọn user hoặc xem tất cả
3. Click "🔄 Làm mới" để cập nhật

## Tùy chỉnh Automation

### Quan trọng: Phải tùy chỉnh code theo website của bạn!

File cần sửa: `src/automation/index.ts`

### Tùy chỉnh Login
Tìm hàm `login()` và sửa các selector:
```typescript
// Sửa selector cho ô username
await page.fill('input[name="username"]', config.username);

// Sửa selector cho ô password
await page.fill('input[name="password"]', config.password);

// Sửa selector cho nút đăng nhập
await page.click('button[type="submit"]');
```

### Tùy chỉnh Learning
Tìm hàm `startLearning()` và thêm logic:
```typescript
// Ví dụ: Click vào video
await page.click('.video-play-button');

// Đợi video phát xong
await page.waitForTimeout(duration);

// Click nút Next
await page.click('.next-button');

// Cập nhật tiến độ
currentProgress += 10;
```

### Làm thế nào để tìm selector?
1. Mở Chrome DevTools (F12)
2. Click vào biểu tượng mũi tên (Select element)
3. Click vào phần tử cần chọn
4. Xem thuộc tính `name`, `id`, `class`
5. Dùng trong code: `input[name="username"]` hoặc `.class-name` hoặc `#id-name`

## Các vấn đề thường gặp

### Lỗi kết nối database
- Kiểm tra PostgreSQL đã chạy chưa (Task Manager)
- Kiểm tra thông tin trong `.env` có đúng không
- Kiểm tra database đã tạo chưa

### Trình duyệt không mở
- Chạy lại: `npx playwright install chromium`
- Kiểm tra Chrome đã cài đặt chưa

### Không đăng nhập được
- Đăng nhập thủ công lần đầu
- Kiểm tra selector trong code có đúng không
- Website có captcha/2FA thì cần xử lý riêng

### Tiến độ không cập nhật
- Kiểm tra logic trong `startLearning()`
- Thêm log để debug: `console.log()`
- Kiểm tra database có dữ liệu không

## Tips

1. **Chrome Profile**: Mỗi user có 1 profile riêng trong thư mục `chrome-profiles/user-{id}/`
2. **Đăng nhập thủ công**: Nếu auto login không được, cứ login thủ công, lần sau sẽ nhớ
3. **Nhiều user**: Có thể chạy nhiều user cùng lúc, mỗi user 1 cửa sổ Chrome
4. **Dừng giữa chừng**: An toàn, tiến độ được lưu vào database
5. **Debug**: Mở DevTools trong Electron bằng cách uncomment dòng `mainWindow.webContents.openDevTools();`

## Cấu trúc Database

### Thêm khóa học cho user thủ công:
```sql
INSERT INTO user_courses (user_id, course_id, progress, time)
VALUES (1, 1, 0, CURRENT_TIMESTAMP);
```

### Xem tiến độ:
```sql
SELECT u.username, c.course_name, uc.progress 
FROM user_courses uc
JOIN users u ON uc.user_id = u.id
JOIN courses c ON uc.course_id = c.id;
```

### Xem log:
```sql
SELECT u.username, l.action, l.timestamp
FROM logs l
JOIN users u ON l.user_id = u.id
ORDER BY l.timestamp DESC
LIMIT 20;
```

## Phát triển thêm

Có thể thêm các tính năng:
- Hỗ trợ 2FA (cần tương tác thủ công)
- Schedule tự động chạy theo giờ
- Notification khi hoàn thành
- Export báo cáo Excel/PDF
- Hỗ trợ proxy
- Multi-language

## Liên hệ và Hỗ trợ

Nếu có vấn đề, check:
1. Console của Electron (DevTools)
2. Terminal khi chạy `npm start`
3. File log nếu có

Happy Learning! 🎓
