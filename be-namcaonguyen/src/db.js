import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}
