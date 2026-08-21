/**
 * Import data/db-export.json vào PostgreSQL (máy mới).
 * Chạy trước: npm run db:init
 *
 * Mặc định upsert theo hash (không xóa data cũ).
 * Xóa hết rồi import sạch: node scripts/import-db.js --replace
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '..', 'data', 'db-export.json');
const replace = process.argv.includes('--replace');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Thiếu DATABASE_URL trong .env');
  }

  const raw = readFileSync(dataPath, 'utf8');
  const payload = JSON.parse(raw);

  if (!payload?.tables?.questions || !payload?.tables?.simulation_situations) {
    throw new Error('File export không hợp lệ (thiếu tables.questions / tables.simulation_situations)');
  }

  await client.connect();
  await client.query('BEGIN');

  try {
    if (replace) {
      await client.query('TRUNCATE simulation_situations, questions RESTART IDENTITY CASCADE');
      console.log('Đã TRUNCATE questions + simulation_situations');
    }

    let qUpsert = 0;
    for (const row of payload.tables.questions) {
      await client.query(
        `INSERT INTO questions (
           question_title, question_text, question_hash,
           correct_answer_index, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), COALESCE($6::timestamptz, NOW()))
         ON CONFLICT (question_hash) DO UPDATE SET
           question_title = EXCLUDED.question_title,
           question_text = EXCLUDED.question_text,
           correct_answer_index = EXCLUDED.correct_answer_index,
           updated_at = EXCLUDED.updated_at`,
        [
          row.question_title ?? null,
          row.question_text,
          row.question_hash,
          row.correct_answer_index ?? null,
          row.created_at ?? null,
          row.updated_at ?? null,
        ]
      );
      qUpsert += 1;
    }

    let sUpsert = 0;
    for (const row of payload.tables.simulation_situations) {
      await client.query(
        `INSERT INTO simulation_situations (
           situation_title, situation_question, situation_hash,
           stop_second, stop_percent, video_duration, mark_color,
           created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7,
                   COALESCE($8::timestamptz, NOW()), COALESCE($9::timestamptz, NOW()))
         ON CONFLICT (situation_hash) DO UPDATE SET
           situation_title = EXCLUDED.situation_title,
           situation_question = EXCLUDED.situation_question,
           stop_second = EXCLUDED.stop_second,
           stop_percent = EXCLUDED.stop_percent,
           video_duration = EXCLUDED.video_duration,
           mark_color = EXCLUDED.mark_color,
           updated_at = EXCLUDED.updated_at`,
        [
          row.situation_title ?? null,
          row.situation_question,
          row.situation_hash,
          row.stop_second ?? null,
          row.stop_percent ?? null,
          row.video_duration ?? null,
          row.mark_color ?? null,
          row.created_at ?? null,
          row.updated_at ?? null,
        ]
      );
      sUpsert += 1;
    }

    await client.query('COMMIT');
    console.log(`Import xong từ ${dataPath}`);
    console.log(`  exportedAt: ${payload.exportedAt ?? '(n/a)'}`);
    console.log(`  questions upserted: ${qUpsert}`);
    console.log(`  simulation_situations upserted: ${sUpsert}`);
    console.log(replace ? '  mode: --replace' : '  mode: merge (ON CONFLICT UPDATE)');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
