import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(__dirname, '..', 'sql', 'init.sql');
const migratePath = join(__dirname, '..', 'sql', 'migrate-pending-answer.sql');
const migrateTitlePath = join(__dirname, '..', 'sql', 'migrate-add-title.sql');
const migrateSimulationPath = join(__dirname, '..', 'sql', 'migrate-simulation.sql');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();
  await client.query(readFileSync(sqlPath, 'utf8'));
  await client.query(readFileSync(migratePath, 'utf8'));
  await client.query(readFileSync(migrateTitlePath, 'utf8'));
  await client.query(readFileSync(migrateSimulationPath, 'utf8'));
  console.log('Đã khởi tạo / migrate các bảng.');
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
