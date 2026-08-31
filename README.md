# Nam Cao Nguyên — Monorepo

Gói đầy đủ để clone lên máy khác và chạy: quiz extension, auto-py, DB tài khoản, và Đại Lợi.

## Cấu trúc

| Thư mục | Mô tả |
|---------|--------|
| `be-namcaonguyen/` | API quiz (PostgreSQL `quiznamcaonguyen`) |
| `extension-ncn/` | Chrome extension cho namcaonguyen.huelms.com |
| `auto-py/` | Click chuột OS + manager học viên |
| `accounts_db/` | DB tài khoản + log tiến độ (PostgreSQL `auto_learning`) |
| `seed/` | Seed NCN + Đại Lợi |
| `dailoi/` | Source học tự động Đại Lợi (eco-tek) + Electron UI |
| `learning-py/` | Alias NCN learning (dùng chung accounts_db) |

## Máy mới — setup nhanh

### 1. PostgreSQL

```powershell
cd namcaonguyen
docker compose up -d
```

Tạo 2 database: `quiznamcaonguyen` (quiz) và `auto_learning` (tài khoản).

### 2. Backend quiz

```powershell
cd be-namcaonguyen
copy .env.example .env
npm install
npm run db:init
npm run db:import
npm run dev
```

API: `http://localhost:3000`

### 3. Accounts DB (log tài khoản NCN + Đại Lợi)

```powershell
cd accounts_db
copy .env.example .env
pip install -r requirements.txt
py -3.11 api.py
```

API: `http://localhost:3004`

- `GET /api/insights?site=namcaonguyen` — danh sách học viên, khóa, %, pass
- `GET /api/users/{id}/summary` — chi tiết 1 học viên + log

### 4. Seed tài khoản

```powershell
cd ..
pip install asyncpg python-dotenv
py -3.11 seed/seed_all.py
```

Seed cả NCN (8 học viên từ `info.txt`) và Đại Lợi (mẫu trong `seed/dailoi-users.json`).

### 5. Auto-py + extension

```powershell
cd auto-py
pip install -r requirements.txt
py -3.11 app.py
```

Manager: `http://127.0.0.1:8765/manager` — hiển thị cửa sổ Chrome + tiến độ từ accounts-db.

Load extension `extension-ncn` vào Chrome profile từng học viên.

### 6. Đại Lợi (tùy chọn)

```powershell
cd dailoi
pip install -r requirements.txt
playwright install chromium
py -3.11 runner.py learn --user-id 1
```

## DB tài khoản — lưu gì?

Giống Đại Lợi, mỗi học viên có:

- Tên, username (CCCD), trạng thái `is_running` / `is_finish`
- Khóa học: tên, link, `progress` (%), `completed` (đã pass)
- `study_hours` — giờ học theo ngày
- `study_sessions` — phiên học chi tiết (Đại Lợi automation)
- `logs` — lịch sử hành động (login, sync, hoàn thành lượt mô phỏng…)

Extension/auto-py ghi log qua `POST /api/users/{id}/log` khi có sự kiện (vd. hoàn thành lượt mô phỏng).

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `DATABASE_URL` | — | Quiz DB (be-namcaonguyen) |
| `DB_LEARN_*` | localhost/auto_learning | Accounts DB |
| `ACCOUNTS_API_URL` | http://127.0.0.1:3004 | auto-py đọc tiến độ |

## Git

Repo này đã có `.gitignore` loại `node_modules`, `.env`, chrome profiles, logs.

Quiz data export: `be-namcaonguyen/data/db-export.json` — commit cùng repo để import máy mới.
