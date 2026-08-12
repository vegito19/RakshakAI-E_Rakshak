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

async function cleanDummyPosts() {
  console.log('Cleaning up any dummy / fallback template posts from DB...');

  // Delete alerts associated with dummy posts
  await pool.query(`
    DELETE FROM alerts 
    WHERE processed_post_id IN (
      SELECT id FROM processed_posts 
      WHERE raw_post_id LIKE 'in_general_%' 
         OR translated_content LIKE '%[Regarding query%'
    );
  `);

  // Delete processed posts
  await pool.query(`
    DELETE FROM processed_posts 
    WHERE raw_post_id LIKE 'in_general_%' 
       OR translated_content LIKE '%[Regarding query%';
  `);

  // Delete raw posts
  const res = await pool.query(`
    DELETE FROM raw_posts 
    WHERE id LIKE 'in_general_%' 
       OR content LIKE '%[Regarding query%'
    RETURNING id;
  `);

  console.log(`✅ Deleted ${res.rowCount} dummy/template posts.`);
  process.exit(0);
}

cleanDummyPosts().catch(err => {
  console.error(err);
  process.exit(1);
});
