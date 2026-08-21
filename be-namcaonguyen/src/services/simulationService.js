import { query } from '../db.js';
import { hashText } from '../utils/normalize.js';
import { normalizeText } from '../utils/normalize.js';

const SELECT_COLS = `id, situation_title, situation_question, situation_hash,
  stop_second, stop_percent, video_duration, mark_color, created_at, updated_at`;

function normalizeTitleOrNull(title) {
  if (!title || typeof title !== 'string' || !title.trim()) {
    return null;
  }
  return normalizeText(title);
}

export async function findSimulationAnswer(title, questionText) {
  const situationHash = hashText(questionText);
  const normalizedTitle = normalizeTitleOrNull(title);

  if (normalizedTitle) {
    const byTitle = await query(
      `SELECT ${SELECT_COLS}
       FROM simulation_situations
       WHERE situation_hash = $1
         AND situation_title = $2
         AND stop_second IS NOT NULL`,
      [situationHash, normalizedTitle]
    );

    if (byTitle.rows[0]) {
      return { row: byTitle.rows[0], matchedBy: 'title+question' };
    }
  }

  const byQuestion = await query(
    `SELECT ${SELECT_COLS}
     FROM simulation_situations
     WHERE situation_hash = $1
       AND stop_second IS NOT NULL
     LIMIT 1`,
    [situationHash]
  );

  if (byQuestion.rows[0]) {
    return { row: byQuestion.rows[0], matchedBy: 'question' };
  }

  return null;
}

export async function upsertSimulation(
  title,
  questionText,
  stopSecond,
  stopPercent = null,
  videoDuration = null,
  markColor = null
) {
  const normalizedQuestion = normalizeText(questionText);
  const situationHash = hashText(questionText);
  const normalizedTitle = normalizeTitleOrNull(title);

  const result = await query(
    `INSERT INTO simulation_situations
       (situation_title, situation_question, situation_hash,
        stop_second, stop_percent, video_duration, mark_color)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (situation_hash)
     DO UPDATE SET
       situation_title = COALESCE(EXCLUDED.situation_title, simulation_situations.situation_title),
       situation_question = EXCLUDED.situation_question,
       stop_second = EXCLUDED.stop_second,
       stop_percent = COALESCE(EXCLUDED.stop_percent, simulation_situations.stop_percent),
       video_duration = COALESCE(EXCLUDED.video_duration, simulation_situations.video_duration),
       mark_color = COALESCE(EXCLUDED.mark_color, simulation_situations.mark_color),
       updated_at = NOW()
     RETURNING ${SELECT_COLS}`,
    [normalizedTitle, normalizedQuestion, situationHash,
     stopSecond, stopPercent, videoDuration, markColor]
  );

  return result.rows[0];
}

export async function listSimulations(limit = 50, offset = 0) {
  const result = await query(
    `SELECT ${SELECT_COLS}
     FROM simulation_situations
     ORDER BY id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );

  return result.rows;
}
