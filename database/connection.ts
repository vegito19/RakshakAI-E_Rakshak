import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: connectionString.includes('127.0.0.1') || connectionString.includes('localhost')
        ? false
        : { rejectUnauthorized: false }
    })
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

    // 7. Create CrimeOS Cases Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cases (
          id SERIAL PRIMARY KEY,
          case_number VARCHAR(100) UNIQUE NOT NULL,
          fir_number VARCHAR(100),
          title VARCHAR(255) NOT NULL,
          police_station VARCHAR(100) DEFAULT 'Cyber Crime Branch Surat' NOT NULL,
          investigating_officer VARCHAR(100) NOT NULL,
          status VARCHAR(30) DEFAULT 'ACTIVE_INVESTIGATION' NOT NULL,
          threat_level VARCHAR(20) DEFAULT 'HIGH' NOT NULL,
          applicable_bns_sections JSONB DEFAULT '[]'::jsonb NOT NULL,
          incident_summary TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);
    await client.query('CREATE INDEX IF NOT EXISTS idx_cases_case_number ON cases(case_number);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);');

    // 8. Create Suspects Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suspects (
          id SERIAL PRIMARY KEY,
          case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
          name VARCHAR(150) NOT NULL,
          alias VARCHAR(100),
          phone_numbers JSONB DEFAULT '[]'::jsonb,
          social_handles JSONB DEFAULT '[]'::jsonb,
          threat_score NUMERIC(5, 4) DEFAULT 0.5,
          notes TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 9. Create Evidence Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS evidence_items (
          id SERIAL PRIMARY KEY,
          case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
          item_type VARCHAR(50) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          file_hash_sha256 VARCHAR(64) NOT NULL,
          file_hash_md5 VARCHAR(32) NOT NULL,
          metadata JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 10. Create CDR Records Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS cdr_records (
          id SERIAL PRIMARY KEY,
          case_id INTEGER REFERENCES cases(id) ON DELETE CASCADE,
          calling_number VARCHAR(30) NOT NULL,
          called_number VARCHAR(30) NOT NULL,
          call_time TIMESTAMP WITH TIME ZONE NOT NULL,
          duration_sec INTEGER NOT NULL,
          call_type VARCHAR(20) NOT NULL,
          first_cell_id VARCHAR(50),
          imei VARCHAR(30),
          imsi VARCHAR(30),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
      );
    `);

    // 11. Create Dark Web Watchlists Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS darkweb_watchlists (
          id SERIAL PRIMARY KEY,
          keyword VARCHAR(150) UNIQUE NOT NULL,
          category VARCHAR(50) NOT NULL,
          priority VARCHAR(20) DEFAULT 'HIGH' NOT NULL,
          hits_count INTEGER DEFAULT 0 NOT NULL,
          last_scanned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
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
