import { instagramScraper } from './crawler/sources/instagramLocal';
import { analyzePost } from './utils/nlpProcessor';
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

async function testLiveIngestion() {
  console.log('--- Testing Live Real Instagram Crawl Ingestion for "bellingham" ---');

  const items = await instagramScraper.scrape('hashtag', 'bellingham', 5, undefined, undefined, true);
  console.log(`Live Scraper extracted ${items.length} real Instagram items.`);

  if (items.length === 0) {
    console.error('ERROR: No items extracted!');
    process.exit(1);
  }

  for (const item of items) {
    console.log(`\nIngesting: [${item.id}] ${item.title}`);
    console.log(`URL: ${item.url}`);
    console.log(`Content: ${item.content.substring(0, 100)}...`);

    // 1. Save Raw Ingest
    await pool.query(`
      INSERT INTO raw_posts (id, source, url, title, content, author, published_at, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        url = EXCLUDED.url,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata;
    `, [
      item.id,
      item.source,
      item.url,
      item.title || null,
      item.content,
      item.author,
      item.publishedAt,
      JSON.stringify(item.metadata)
    ]);

    // 2. Perform NLP
    const analysis = await analyzePost(item);

    // 3. Save Processed
    await pool.query(`
      INSERT INTO processed_posts (
        raw_post_id, original_language, translated_title, translated_content,
        sentiment_score, sentiment_label, threat_score, threat_label, threat_category, named_entities
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (raw_post_id) DO UPDATE SET
        translated_title = EXCLUDED.translated_title,
        translated_content = EXCLUDED.translated_content,
        sentiment_score = EXCLUDED.sentiment_score,
        sentiment_label = EXCLUDED.sentiment_label,
        threat_score = EXCLUDED.threat_score,
        threat_label = EXCLUDED.threat_label,
        threat_category = EXCLUDED.threat_category,
        named_entities = EXCLUDED.named_entities;
    `, [
      item.id,
      analysis.originalLanguage,
      analysis.translatedTitle,
      analysis.translatedContent,
      analysis.sentimentScore,
      analysis.sentimentLabel,
      analysis.threatScore,
      analysis.threatLabel,
      analysis.threatCategory,
      JSON.stringify(analysis.namedEntities)
    ]);
  }

  console.log('\n🎉 ALL REAL INSTAGRAM REELS SUCCESSFULLY CRAWLED & INGESTED INTO DATABASE!');
  await instagramScraper.close();
  process.exit(0);
}

testLiveIngestion().catch(err => {
  console.error(err);
  process.exit(1);
});
