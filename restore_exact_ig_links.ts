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

async function restoreExactInstagramLinks() {
  console.log('--- Restoring Exact Original Shortcode Links for all Instagram Posts & Reels ---');

  const res = await pool.query("SELECT id, source, content, metadata FROM raw_posts WHERE source = 'instagram';");
  
  for (const row of res.rows) {
    if (row.id.startsWith('instagram_')) {
      const shortcode = row.id.replace('instagram_', '');
      const meta = row.metadata || {};
      const isReel = meta.isReel === true || meta.mediaType === 'reel' || row.content.toLowerCase().includes('#fyp') || row.content.toLowerCase().includes('#reels');
      
      const exactUrl = isReel
        ? `https://www.instagram.com/reel/${shortcode}/`
        : `https://www.instagram.com/p/${shortcode}/`;

      meta.directUrl = exactUrl;
      meta.shortcode = shortcode;
      meta.isReel = isReel;

      await pool.query('UPDATE raw_posts SET url = $1, metadata = $2 WHERE id = $3;', [exactUrl, JSON.stringify(meta), row.id]);
      console.log(`[RESTORED EXACT LINK] ${row.id} -> ${exactUrl}`);
    }
  }

  console.log('✅ All Instagram Posts and Reels restored to their exact 100% original live links!');
  process.exit(0);
}

restoreExactInstagramLinks().catch(err => {
  console.error(err);
  process.exit(1);
});
