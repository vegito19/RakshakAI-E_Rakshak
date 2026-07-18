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
 * Ensures the 'users' table exists and links the 'alerts' table's
 * assigned_officer_id column to it via a foreign key constraint.
 */
export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    logger.info('Initializing database schemas...', 'DatabaseInit');

    // Create users table
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

    // Create index for username lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);

    // Add foreign key constraint to alerts table if not exists
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

    logger.info('Database schema initialization completed successfully.', 'DatabaseInit');
  } catch (error) {
    logger.error('Database initialization encountered a fatal error.', error as Error, 'DatabaseInit');
    throw error;
  } finally {
    client.release();
  }
}
