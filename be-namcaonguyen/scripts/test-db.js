import 'dotenv/config';
import pg from 'pg';

console.log('DATABASE_URL:', process.env.DATABASE_URL);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  const r = await client.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
  );
  console.log('Tables:', r.rows);
} catch (err) {
  console.error('Connection failed:', err.message);
} finally {
  await client.end();
}
