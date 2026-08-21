ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS question_title TEXT;

CREATE INDEX IF NOT EXISTS idx_questions_hash_title
  ON questions (question_hash, question_title);

COMMENT ON COLUMN questions.question_title IS 'Tiêu đề nhóm câu hỏi (vd: 1. Câu hỏi chọn một đáp án), đã chuẩn hóa';
