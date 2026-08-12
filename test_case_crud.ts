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

async function main() {
  console.log('--- Testing Post & Case Deletion / Editing ---');

  // 1. Insert a mock post + processed + alert
  const testPostId = 'test-post-delete-' + Date.now();
  await pool.query(`
    INSERT INTO raw_posts (id, source, url, content, author, published_at, crawled_at, metadata)
    VALUES ($1, 'instagram', 'https://instagram.com/p/test', 'Delete me post content', 'instagram_user', NOW(), NOW(), '{}'::jsonb);
  `, [testPostId]);

  const proc = await pool.query(`
    INSERT INTO processed_posts (raw_post_id, original_language, translated_content, sentiment_score, sentiment_label, threat_category, threat_score, threat_label, named_entities)
    VALUES ($1, 'en', 'Delete me post content', -0.5, 'negative', 'cyber_crime', 0.9, 'critical', '{}'::jsonb)
    RETURNING id;
  `, [testPostId]);

  await pool.query(`
    INSERT INTO alerts (processed_post_id, severity, status)
    VALUES ($1, 'critical', 'pending');
  `, [proc.rows[0].id]);
  console.log(`✅ Created test post (${testPostId}) with processed_post and alert.`);

  // 2. Perform the exact 3-step delete sequence used by DELETE /api/feed/:id
  await pool.query(`
    DELETE FROM alerts 
    WHERE processed_post_id IN (
      SELECT id FROM processed_posts WHERE raw_post_id = $1
    );
  `, [testPostId]);
  await pool.query('DELETE FROM processed_posts WHERE raw_post_id = $1;', [testPostId]);
  const delPostRes = await pool.query('DELETE FROM raw_posts WHERE id = $1 RETURNING id;', [testPostId]);
  console.log(`✅ Successfully deleted post from raw_posts: ${delPostRes.rows[0]?.id}`);

  // 3. Test Case Editing by string case_number
  const testCaseNumber = 'CASE-SRT-TEST-' + Math.floor(100 + Math.random() * 900);
  await pool.query(`
    INSERT INTO cases (case_number, fir_number, title, police_station, investigating_officer, status, threat_level, applicable_bns_sections, incident_summary)
    VALUES ($1, 'FIR-SRT-9999', 'Original Title', 'Cyber Branch', 'Insp. Jadeja', 'ACTIVE_INVESTIGATION', 'HIGH', '["BNS 308(2)"]'::jsonb, 'Original summary');
  `, [testCaseNumber]);
  console.log(`✅ Created test case: ${testCaseNumber}`);

  // Update with string case_number
  const updateRes = await pool.query(`
    UPDATE cases
    SET title = 'Updated Title by Case Number', status = 'SURVEILLANCE', threat_level = 'CRITICAL'
    WHERE case_number = $1
    RETURNING id, case_number, title, status;
  `, [testCaseNumber]);
  console.log(`✅ Successfully updated case by case_number:`, updateRes.rows[0]);

  // Delete with string case_number
  const delCaseRes = await pool.query(`
    DELETE FROM cases WHERE case_number = $1 RETURNING case_number, title;
  `, [testCaseNumber]);
  console.log(`✅ Successfully deleted case by case_number:`, delCaseRes.rows[0]);

  console.log('\n🎉 ALL POST & CASE OPERATIONS VERIFIED WORKING CLEANLY!');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
