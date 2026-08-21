import { query } from '../db.js';
import { hashQuestion, normalizeQuestion, normalizeTitle } from '../utils/normalize.js';

const SELECT_COLS = `id, question_title, question_text, question_hash,
  correct_answer_index, created_at, updated_at`;

function normalizeTitleOrNull(title) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    return null;
  }
  return normalizeTitle(title);
}

/**
 * Ưu tiên 1: title + question
 * Ưu tiên 2: chỉ question
 */
export async function findAnswerByQuestion(questionText, questionTitle = null) {
  const questionHash = hashQuestion(questionText);
  const normalizedTitle = normalizeTitleOrNull(questionTitle);

  if (normalizedTitle) {
    const byTitle = await query(
      `SELECT ${SELECT_COLS}
       FROM questions
       WHERE question_hash = $1
         AND question_title = $2
         AND correct_answer_index IS NOT NULL`,
      [questionHash, normalizedTitle]
    );

    if (byTitle.rows[0]) {
      return { row: byTitle.rows[0], matchedBy: 'title+question' };
    }
  }

  const byQuestion = await query(
    `SELECT ${SELECT_COLS}
     FROM questions
     WHERE question_hash = $1
       AND correct_answer_index IS NOT NULL
     LIMIT 1`,
    [questionHash]
  );

  if (byQuestion.rows[0]) {
    return { row: byQuestion.rows[0], matchedBy: 'question' };
  }

  return null;
}

export async function upsertQuestion(questionText, correctAnswerIndex, questionTitle = null) {
  const normalized = normalizeQuestion(questionText);
  const questionHash = hashQuestion(questionText);
  const normalizedTitle = normalizeTitleOrNull(questionTitle);

  const result = await query(
    `INSERT INTO questions (question_title, question_text, question_hash, correct_answer_index)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_hash)
     DO UPDATE SET
       question_title = COALESCE(EXCLUDED.question_title, questions.question_title),
       question_text = EXCLUDED.question_text,
       correct_answer_index = EXCLUDED.correct_answer_index,
       updated_at = NOW()
     RETURNING ${SELECT_COLS}`,
    [normalizedTitle, normalized, questionHash, correctAnswerIndex]
  );

  return result.rows[0];
}

export async function insertQuestionOnly(
  questionText,
  correctAnswerIndex,
  questionTitle = null
) {
  const normalized = normalizeQuestion(questionText);
  const questionHash = hashQuestion(questionText);
  const normalizedTitle = normalizeTitleOrNull(questionTitle);

  const result = await query(
    `INSERT INTO questions (question_title, question_text, question_hash, correct_answer_index)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_hash) DO NOTHING
     RETURNING ${SELECT_COLS}`,
    [normalizedTitle, normalized, questionHash, correctAnswerIndex]
  );

  if (result.rows[0]) {
    return { inserted: true, row: result.rows[0] };
  }

  const existing = await query(
    `SELECT ${SELECT_COLS} FROM questions WHERE question_hash = $1`,
    [questionHash]
  );

  return { inserted: false, row: existing.rows[0] };
}

export async function listQuestions(limit = 50, offset = 0) {
  const result = await query(
    `SELECT ${SELECT_COLS}
     FROM questions
     ORDER BY id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}
