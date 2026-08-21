-- Cho phép lưu câu hỏi chưa có đáp án (extension gửi lên, admin điền sau)
ALTER TABLE questions
  ALTER COLUMN correct_answer_index DROP NOT NULL;

ALTER TABLE questions
  DROP CONSTRAINT IF EXISTS questions_correct_answer_index_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_correct_answer_index_check
  CHECK (correct_answer_index IS NULL OR correct_answer_index >= 0);

COMMENT ON COLUMN questions.correct_answer_index IS 'Chỉ số đáp án đúng (0 = đáp án đầu tiên). NULL = chưa điền.';
