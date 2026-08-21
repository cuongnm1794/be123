/**
 * Export toàn bộ data từ PostgreSQL local → data/db-export.json
 * Máy mới: npm run db:init && npm run db:import
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'data');
const outPath = join(outDir, 'db-export.json');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Thiếu DATABASE_URL trong .env');
  }

  await client.connect();

  const questions = await client.query(
    `SELECT id, question_title, question_text, question_hash,
            correct_answer_index, created_at, updated_at
     FROM questions
     ORDER BY id`
  );

  const simulations = await client.query(
    `SELECT id, situation_title, situation_question, situation_hash,
            stop_second, stop_percent, video_duration, mark_color,
            created_at, updated_at
     FROM simulation_situations
     ORDER BY id`
  );

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: process.env.DATABASE_URL.replace(/:[^:@/]+@/, ':****@'),
    counts: {
      questions: questions.rowCount,
      simulation_situations: simulations.rowCount,
    },
    tables: {
      questions: questions.rows,
      simulation_situations: simulations.rows,
    },
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`Đã export → ${outPath}`);
  console.log(`  questions: ${payload.counts.questions}`);
  console.log(`  simulation_situations: ${payload.counts.simulation_situations}`);

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
