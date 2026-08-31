import { query } from '../db.js';
import { hashText, normalizeText } from '../utils/normalize.js';

const CTX_SEP = '»';

const SELECT_COLS = `id, stimulus_title, question_text, question_hash,
  correct_answer_index, created_at, updated_at`;

function normalizeStimulusOrNull(title) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    return null;
  }
  return normalizeText(title);
}

export function buildSimulationQuizHash(stimulusTitle, questionText) {
  const stimulus = normalizeStimulusOrNull(stimulusTitle) || '';
  const question = normalizeText(questionText);
  return hashText(`${stimulus}${CTX_SEP}${question}`);
}

function normalizeFields(stimulusTitle, questionText) {
  const stimulus = normalizeStimulusOrNull(stimulusTitle);
  if (!stimulus) {
    throw new Error('Thiếu stimulusTitle');
  }
  const question = normalizeText(questionText);
  if (!question) {
    throw new Error('Thiếu question');
  }
  const questionHash = buildSimulationQuizHash(stimulus, question);
  return { stimulus, question, questionHash };
}

/**
 * Tra cứu: ưu tiên stimulus + question, fallback chỉ hash.
 */
export async function findSimulationQuizAnswer(stimulusTitle, questionText) {
  const { stimulus, question, questionHash } = normalizeFields(stimulusTitle, questionText);

  const byBoth = await query(
    `SELECT ${SELECT_COLS}
     FROM simulation_quiz_questions
     WHERE question_hash = $1
       AND stimulus_title = $2
       AND correct_answer_index IS NOT NULL`,
    [questionHash, stimulus]
  );

  if (byBoth.rows[0]) {
    return { row: byBoth.rows[0], matchedBy: 'stimulus+question' };
  }

  const byHash = await query(
    `SELECT ${SELECT_COLS}
     FROM simulation_quiz_questions
     WHERE question_hash = $1
       AND correct_answer_index IS NOT NULL
     LIMIT 1`,
    [questionHash]
  );

  if (byHash.rows[0]) {
    return { row: byHash.rows[0], matchedBy: 'hash' };
  }

  return null;
}

export async function upsertSimulationQuiz(
  stimulusTitle,
  questionText,
  correctAnswerIndex
) {
  const { stimulus, question, questionHash } = normalizeFields(stimulusTitle, questionText);
  const idx = Math.max(0, Math.floor(Number(correctAnswerIndex)));

  const result = await query(
    `INSERT INTO simulation_quiz_questions
       (stimulus_title, question_text, question_hash, correct_answer_index)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_hash)
     DO UPDATE SET
       stimulus_title = EXCLUDED.stimulus_title,
       question_text = EXCLUDED.question_text,
       correct_answer_index = EXCLUDED.correct_answer_index,
       updated_at = NOW()
     RETURNING ${SELECT_COLS}`,
    [stimulus, question, questionHash, idx]
  );

  return result.rows[0];
}

export async function listSimulationQuiz(limit = 50, offset = 0) {
  const result = await query(
    `SELECT ${SELECT_COLS}
     FROM simulation_quiz_questions
     ORDER BY id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}
