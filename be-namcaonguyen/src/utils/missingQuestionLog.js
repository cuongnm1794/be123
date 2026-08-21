import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashQuestion, normalizeQuestion, normalizeTitle } from './normalize.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../logs');
const MISSING_LOG_FILE =
  process.env.MISSING_LOG_FILE || path.join(LOG_DIR, 'missing-questions.log');

function escapeSql(value) {
  if (value == null) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function logMissingQuestion(rawQuestion, rawTitle = null) {
  ensureLogDir();

  const questionText = normalizeQuestion(rawQuestion);
  const questionHash = hashQuestion(rawQuestion);
  const titleText =
    rawTitle && String(rawTitle).trim() ? normalizeTitle(rawTitle) : null;
  const timestamp = new Date().toISOString();

  const titleLine = rawTitle?.trim()
    ? `-- Title raw: ${rawTitle.trim()}`
    : '-- Title: (khong gui)';

  const sql = `-- ${timestamp}
-- Cau khong ton tai trong DB (extension gui len)
${titleLine}
-- Raw: ${rawQuestion.trim()}
INSERT INTO questions (question_title, question_text, question_hash, correct_answer_index)
VALUES (
  ${titleText ? escapeSql(titleText) : 'NULL'},
  ${escapeSql(questionText)},
  ${escapeSql(questionHash)},
  __FILL_CORRECT_ANSWER_INDEX__  -- 0 = dap an dau tien, 1 = thu 2, ...
);
`;

  fs.appendFile(MISSING_LOG_FILE, `${sql}\n`, (err) => {
    if (err) console.error('Ghi missing log thất bại:', err.message);
  });
}
