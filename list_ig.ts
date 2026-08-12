import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'rakshak_db'
});

async function run() {
  const res = await pool.query("SELECT id, source, url, author, content, metadata FROM raw_posts WHERE source = 'instagram';");
  console.log('Instagram Posts in DB:', res.rows.length);
  for (const r of res.rows) {
    console.log(`ID: ${r.id} | Author: ${r.author} | URL: ${r.url}`);
    console.log(`Content: ${r.content.substring(0, 80)}...`);
    console.log('---');
  }
  process.exit(0);
}
run();
