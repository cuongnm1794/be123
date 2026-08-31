# Python automation — học tự động trên hoclythuyetlaixe.eco-tek.com.vn

Port từ `hermes-bridge/dailoi`, dùng chung DB `accounts_db` (PostgreSQL `auto_learning`).

## Cài đặt

```powershell
cd dailoi
pip install -r requirements.txt
playwright install chromium
copy .env.example .env
```

## Seed + chạy

```powershell
# Từ thư mục gốc namcaonguyen
py -3.11 seed/seed_all.py --site dailoi

cd dailoi
py -3.11 runner.py init-db
py -3.11 runner.py login --user-id 1
py -3.11 runner.py sync --user-id 1
py -3.11 runner.py learn --user-id 1
```

## Electron UI (tùy chọn)

Thư mục `electron/` là app desktop gốc của Đại Lợi:

```powershell
cd electron
npm install
npm run dev
```

## Cấu trúc

| File | Mô tả |
|------|--------|
| `browser.py` | Playwright + Chrome profile |
| `learning.py` | Logic học slide tự động |
| `sync.py` | Đồng bộ khóa từ profile web |
| `jobs.py` | Job queue học nhiều khóa |
| `runner.py` | CLI |
