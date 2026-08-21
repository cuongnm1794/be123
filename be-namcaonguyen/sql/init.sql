CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    question_title TEXT,
    question_text TEXT NOT NULL,
    question_hash VARCHAR(64) NOT NULL UNIQUE,
    correct_answer_index INTEGER CHECK (correct_answer_index IS NULL OR correct_answer_index >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_hash ON questions (question_hash);

COMMENT ON TABLE questions IS 'Câu hỏi và vị trí đáp án đúng (0 = đáp án đầu tiên)';
COMMENT ON COLUMN questions.question_title IS 'Tiêu đề nhóm câu hỏi (vd: 1. Câu hỏi chọn một đáp án), đã chuẩn hóa';
COMMENT ON COLUMN questions.correct_answer_index IS 'Chỉ số đáp án đúng (0 = đáp án đầu tiên). NULL = chưa điền.';
