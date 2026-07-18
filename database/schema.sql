-- Enable PostGIS for geospatial analytics (used for Surat mapping)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Raw Ingested Posts table
CREATE TABLE IF NOT EXISTS raw_posts (
    id VARCHAR(100) PRIMARY KEY, -- Unique platform-agnostic ID (e.g. reddit submission id)
    source VARCHAR(20) NOT NULL, -- 'reddit', 'twitter', 'telegram', 'youtube', 'news'
    url TEXT NOT NULL,
    title TEXT,
    content TEXT NOT NULL,
    author VARCHAR(100) NOT NULL,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL,
    crawled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    metadata JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_posts_source ON raw_posts(source);
CREATE INDEX IF NOT EXISTS idx_raw_posts_published ON raw_posts(published_at);

-- 2. Processed NLP Results table
CREATE TABLE IF NOT EXISTS processed_posts (
    id SERIAL PRIMARY KEY,
    raw_post_id VARCHAR(100) REFERENCES raw_posts(id) ON DELETE CASCADE UNIQUE,
    original_language VARCHAR(10) NOT NULL, -- 'hi', 'gu', 'en', 'hinglish', etc.
    translated_title TEXT,
    translated_content TEXT NOT NULL,       -- Normalized English version for analysis
    sentiment_score NUMERIC(5, 4) NOT NULL, -- Range -1.0 to 1.0
    sentiment_label VARCHAR(20) NOT NULL,   -- 'positive', 'neutral', 'negative'
    threat_score NUMERIC(5, 4) NOT NULL,    -- Probability of safety threat (0.0 to 1.0)
    threat_label VARCHAR(20) NOT NULL,      -- 'critical', 'warning', 'info', 'none'
    threat_category VARCHAR(50) NOT NULL,   -- 'violence', 'hate_speech', 'riot', 'none'
    named_entities JSONB NOT NULL,          -- {"locations": [...], "organizations": [...]}
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processed_posts_threat_score ON processed_posts(threat_score);
CREATE INDEX IF NOT EXISTS idx_processed_posts_threat_category ON processed_posts(threat_category);

-- 3. Alerts table (Investigator action items)
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    processed_post_id INTEGER REFERENCES processed_posts(id) ON DELETE CASCADE,
    severity VARCHAR(20) NOT NULL,         -- 'critical', 'warning', 'info'
    status VARCHAR(20) DEFAULT 'pending' NOT NULL, -- 'pending', 'investigating', 'resolved', 'dismissed'
    assigned_officer_id INTEGER,           -- For mapping assigned law enforcement officers
    location_geom GEOMETRY(Point, 4326),  -- Geospatial location coordinates for Surat map
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);

-- 4. Users and Roles table (for authentication & authorization)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'officer' NOT NULL, -- 'admin', 'officer', 'analyst'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Link alerts to users table safely
ALTER TABLE alerts 
ADD CONSTRAINT fk_alerts_assigned_officer 
FOREIGN KEY (assigned_officer_id) 
REFERENCES users(id) 
ON DELETE SET NULL;
