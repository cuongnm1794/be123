# Backend Quiz — Extension + PostgreSQL

API nhận câu hỏi từ extension, tra cứu **vị trí đáp án đúng** (chỉ số 0, 1, 2, 3...) đã lưu trong PostgreSQL.

## Luồng hoạt động

```
Extension ──POST /api/answer──► Backend ──SELECT──► PostgreSQL
                { question }              trả correctAnswerIndex
```

1. **Lưu câu hỏi** (một lần): `POST /api/questions` với `question` + `correctAnswerIndex`
2. **Extension hỏi đáp án**: `POST /api/answer` với `question` → nhận `correctAnswerIndex`

`correctAnswerIndex = 0` nghĩa là đáp án đúng là lựa chọn **đầu tiên** trên trang.

## Chạy nhanh

### 1. PostgreSQL

Dùng PostgreSQL local (hoặc tạo DB `quiznamcaonguyen`):

```sql
CREATE DATABASE quiznamcaonguyen;
```

Chuỗi kết nối mặc định trong `.env`:

```
postgresql://postgres:postgres@localhost:5432/quiznamcaonguyen
```

Khởi tạo bảng (nếu chưa có):

```bash
npm run db:init
```

### Export / Import data (máy mới)

Export DB local ra `data/db-export.json` (commit cùng repo):

```bash
npm run db:export
```

Trên máy mới (sau khi tạo DB + `.env` + `npm run db:init`):

```bash
npm run db:import
# hoặc xóa sạch rồi import lại:
npm run db:import:replace
```

Tùy chọn Docker (cùng credentials):

```bash
docker compose up -d
```

### 2. Cấu hình

```bash
copy .env.example .env
npm install
```

### 3. Khởi động API

```bash
npm run dev
```

Kiểm tra: `GET http://localhost:3000/health`

## API

### Lấy đáp án (extension)

```http
POST /api/answer
Content-Type: application/json
X-Api-Key: your-secret-api-key

{
  "question": "Thủ đô của Việt Nam là gì?"
}
```

**200 — tìm thấy:**

```json
{
  "success": true,
  "found": true,
  "data": {
    "id": 1,
    "question": "thủ đô của việt nam là gì?",
    "correctAnswerIndex": 2
  }
}
```

**404 — chưa có trong DB:**

```json
{
  "success": false,
  "found": false,
  "error": "Chưa có đáp án cho câu hỏi này"
}
```

### Lưu / cập nhật câu hỏi

```http
POST /api/questions
Content-Type: application/json
X-Api-Key: your-secret-api-key

{
  "question": "Thủ đô của Việt Nam là gì?",
  "correctAnswerIndex": 2
}
```

### Danh sách câu hỏi

```http
GET /api/questions?limit=50&offset=0
```

## Extension (ví dụ fetch)

```javascript
const res = await fetch('http://localhost:3000/api/answer', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Api-Key': 'your-secret-api-key',
  },
  body: JSON.stringify({ question: questionTextFromPage }),
});

const json = await res.json();
if (json.found) {
  const index = json.data.correctAnswerIndex;
  // highlight đáp án thứ `index` trên trang
}
```

## Schema PostgreSQL

| Cột | Mô tả |
|-----|--------|
| `question_text` | Nội dung câu hỏi (đã chuẩn hóa) |
| `question_hash` | SHA-256 để tra cứu nhanh |
| `correct_answer_index` | Vị trí đáp án đúng (bắt đầu từ 0) |

## Biến môi trường

| Biến | Mặc định | Mô tả |
|------|----------|--------|
| `PORT` | 3000 | Cổng HTTP |
| `DATABASE_URL` | — | Chuỗi kết nối PostgreSQL |
| `API_KEY` | (tùy chọn) | Bảo vệ API qua header `X-Api-Key` |
