import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new Pool({ connectionString })
  : new Pool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'rakshak_db',
    });

/**
 * Ensures all required database tables exist (raw_posts, processed_posts, users, alerts),
 * handling PostGIS absence gracefully and setting up indexes and constraints.
 */
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Initializing database schemas...', 'DatabaseInit');

    // 1. Try to enable PostGIS extension (optional)
    let hasPostGIS = false;
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis;');
      hasPostGIS = true;
      logger.info('PostGIS extension enabled successfully.', 'DatabaseInit');
    } catch (err) {
      logger.warn(`PostGIS extension is not available on this PostgreSQL server: ${(err as Error).message}. Falling back to standard string storage for locations.`, 'DatabaseInit');
    }

    // 2. Create raw_posts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS raw_posts (
          id VARCHAR(100) PRIMARY KEY,
          source VARCHAR(20) NOT NULL,
          url TEXT NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          author VARCHAR(100) NOT NULL,
          published_at TIMESTAMP WITH TIME ZONE NOT NULL,
          crawled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
          metadata JSONB NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_raw_posts_source ON raw_posts(source);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_raw_posts_published ON raw_posts(published_at);');

    // 3. Create processed_posts table
    await client.query(`
      CREATE TABLE IF NOT EXISTS processed_posts (
          id SERIAL PRIMARY KEY,
          raw_post_id VARCHAR(100) REFERENCES raw_posts(id) ON DELETE CASCADE UNIQUE,
          original_language VARCHAR(10) NOT NULL,
          translated_title TEXT,
          translated_content TEXT NOT NULL,
          sentiment_score NUMERIC(5, 4) NOT NULL,
          sentiment_label VARCHAR(20) NOT NULL,
          threat_score NUMERIC(5, 4) NOT NULL,
          threat_label VARCHAR(20) NOT NULL,
          threat_category VARCHAR(50) NOT NULL,
          named_entities JSONB NOT NULL,
          processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_processed_posts_threat_score ON processed_posts(threat_score);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_processed_posts_threat_category ON processed_posts(threat_category);');

    // 4. Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          username VARCHAR(50) UNIQUE NOT NULL,
          email VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          role VARCHAR(20) DEFAULT 'officer' NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);');

    // 5. Create alerts table
    const geomColumnType = hasPostGIS ? 'GEOMETRY(Point, 4326)' : 'TEXT';
    await client.query(`
      CREATE TABLE IF NOT EXISTS alerts (
          id SERIAL PRIMARY KEY,
          processed_post_id INTEGER REFERENCES processed_posts(id) ON DELETE CASCADE,
          severity VARCHAR(20) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending' NOT NULL,
          assigned_officer_id INTEGER,
          location_geom ${geomColumnType},
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);');

    // 6. Add foreign key constraint to alerts table if not exists
    const constraintCheck = await client.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'alerts' AND constraint_name = 'fk_alerts_assigned_officer';
    `);

    if (constraintCheck.rowCount === 0) {
      logger.info('Adding fk_alerts_assigned_officer foreign key constraint to alerts table...', 'DatabaseInit');
      await client.query(`
        ALTER TABLE alerts 
        ADD CONSTRAINT fk_alerts_assigned_officer 
        FOREIGN KEY (assigned_officer_id) 
        REFERENCES users(id) 
        ON DELETE SET NULL;
      `);
    } else {
      logger.debug('fk_alerts_assigned_officer constraint already exists.', 'DatabaseInit');
    }

    // 7. Create darkweb_pastes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS darkweb_pastes (
          id VARCHAR(100) PRIMARY KEY,
          onion_site VARCHAR(150) NOT NULL,
          title TEXT,
          content TEXT NOT NULL,
          threat_level VARCHAR(20) NOT NULL,
          category VARCHAR(50) NOT NULL,
          detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 8. Create breach_records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS breach_records (
          id SERIAL PRIMARY KEY,
          target_identifier VARCHAR(150) NOT NULL,
          source_leak VARCHAR(100) NOT NULL,
          breach_type VARCHAR(50) NOT NULL,
          data_sample TEXT NOT NULL,
          leaked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 9. Create forensic_evidence table
    await client.query(`
      CREATE TABLE IF NOT EXISTS forensic_evidence (
          id SERIAL PRIMARY KEY,
          case_number VARCHAR(50) NOT NULL,
          source_file VARCHAR(150) NOT NULL,
          evidence_type VARCHAR(50) NOT NULL,
          suspicious_count INTEGER DEFAULT 0,
          extracted_summary JSONB NOT NULL,
          triaged_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    logger.info('Database schema initialization completed successfully.', 'DatabaseInit');
  } catch (error) {
    logger.error('Database initialization encountered a fatal error.', error as Error, 'DatabaseInit');
    throw error;
  } finally {
    client.release();
  }
}
