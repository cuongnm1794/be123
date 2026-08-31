CREATE TABLE IF NOT EXISTS simulation_quiz_questions (
    id SERIAL PRIMARY KEY,
    stimulus_title TEXT NOT NULL,
    question_text TEXT NOT NULL,
    question_hash VARCHAR(64) NOT NULL UNIQUE,
    correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sim_quiz_stimulus ON simulation_quiz_questions (stimulus_title);
CREATE INDEX IF NOT EXISTS idx_sim_quiz_hash ON simulation_quiz_questions (question_hash);

COMMENT ON TABLE simulation_quiz_questions IS 'Cau hoi con trong bai on luyen mo phong (video + MCQ)';
COMMENT ON COLUMN simulation_quiz_questions.stimulus_title IS 'Ten tinh huong gan video, vd: Bo dung giua duong';
COMMENT ON COLUMN simulation_quiz_questions.question_text IS 'Noi dung cau hoi con (da chuan hoa)';
COMMENT ON COLUMN simulation_quiz_questions.correct_answer_index IS 'Chi so dap an dung (0 = dap an dau tien)';
