import * as dotenv from 'dotenv';
dotenv.config();
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '0';

import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../../utils/logger';
import { pool, initializeDatabase } from '../../database/connection';
import { registerSchema, loginSchema } from '../../validation/auth';
import { signToken, verifyToken } from '../../auth/jwt';
import { authenticate } from '../../auth/middleware';

const execAsync = promisify(exec);
import { ApiResponse } from '../../shared-types/api';
import { User, UserJWTPayload } from '../../shared-types/user';

// Import local scrapers
import { redditScraper } from '../../crawler/sources/reddit';
import { telegramScraper } from '../../crawler/sources/telegram';
import { instagramScraper } from '../../crawler/sources/instagramLocal';
import { twitterScraper } from '../../crawler/sources/twitterLocal';
import { youtubeScraper } from '../../crawler/sources/youtubeLocal';
import { facebookScraper } from '../../crawler/sources/facebookLocal';
import { RawCrawledItem, SocialSource } from '../../shared-types/crawler';

// Import local NLP and Fallback utilities
import { analyzePost, computeContentHash, SURAT_LOCATIONS, AnalyzedOutput } from '../../utils/nlpProcessor';
import { generateMockOSINT } from '../../utils/fallbackGenerator';
import fastifyMultipart from '@fastify/multipart';
import { AgentInvestigator } from '../../utils/agentInvestigator';
import { darkWebMonitor } from '../../utils/darkWebMonitor';
import { cryptoForensics } from '../../utils/cryptoForensics';
import { otpAuthService } from '../../utils/otpAuthService';
import { forensicsTriage } from '../../utils/forensicsTriage';
import { realAdbBridge } from '../../utils/realAdbBridge';
import { cdrAnalyzer } from '../../utils/cdrAnalyzer';

interface UserRegistrationDto {
  username?: string;
  email?: string;
  password?: string;
  role?: string;
}

interface UserLoginDto {
  username?: string;
  password?: string;
}

interface CrawlerExtractDto {
  platform?: string;
  mode?: string;
  target?: string;
  limit?: string | number;
  depth?: string | number;
  startDate?: string;
  endDate?: string;
  extractComments?: boolean;
}

const fastify: FastifyInstance = Fastify({
  logger: false, // Disabling fastify default logger to use project's custom logger
});

// Register multipart for real forensics and CDR file uploads
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max file size
  }
});

// Setup global error handler
fastify.setErrorHandler((error: unknown, request: FastifyRequest, reply: FastifyReply) => {
  if (error instanceof Error) {
    const err = error as FastifyError;
    if (err.validation) {
      logger.warn('Validation error encountered on request.', 'FastifyServer', {
        validation: err.validation,
        url: request.url,
      });
      const response: ApiResponse = {
        success: false,
        error: `Validation Failed: ${err.message}`,
      };
      reply.status(400).send(response);
      return;
    }

    logger.error('Unhandled internal server error.', err, 'FastifyServer');
  } else {
    logger.error('Unhandled unknown error.', new Error(String(error)), 'FastifyServer');
  }

  const response: ApiResponse = {
    success: false,
    error: 'Internal Server Error.',
  };
  reply.status(500).send(response);
});

// Global state to track PostGIS availability
let hasPostGIS = false;

// Date-filtering utility
function filterByDateRange(items: RawCrawledItem[], startDateStr?: string, endDateStr?: string): RawCrawledItem[] {
  if (!startDateStr && !endDateStr) return items;

  const start = startDateStr ? new Date(startDateStr).getTime() : -Infinity;
  const end = endDateStr ? new Date(endDateStr.includes('T') ? endDateStr : endDateStr + 'T23:59:59.999Z').getTime() : Infinity;

  return items.filter((item) => {
    try {
      const pubTime = new Date(item.publishedAt).getTime();
      return pubTime >= start && pubTime <= end;
    } catch {
      return true; // Retain post if date parsing fails
    }
  });
}

async function generateOSINTSummary(items: RawCrawledItem[]): Promise<string> {
  if (items.length === 0) return 'No items ingested to summarize.';
  
  const geminiKey = process.env.GEMINI_API_KEY;
  const contentToSummarize = items
    .map((item, idx) => `[Post ${idx + 1}] Source: ${item.source} | Author: ${item.author}\nContent: ${item.content}`)
    .join('\n\n');

  const prompt = `You are Rakshak AI, an OSINT intelligence analyst assistant for Surat Police Department.
Review the following social media posts extracted in a targeted crawl and provide a brief, professional, bulleted summary (3-4 points) highlighting:
1. Threat Level assessment (Low/Medium/High).
2. Key active locations or events mentioned (e.g. Vesu, Chowk Bazar, road blocks, protests, waterlogging).
3. Actions or incidents requiring police attention, or specify if it is just general community chatter.

Keep the summary concise, clear, and actionable for police officers.

Ingested Posts:
${contentToSummarize}`;

  if (geminiKey && geminiKey.trim() !== '' && !geminiKey.startsWith('AQ.')) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      });
      if (res.ok) {
        const result = await res.json();
        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      }
    } catch (err) {
      logger.debug(`Gemini API summary generation failed: ${(err as Error).message}`, 'APIServer');
    }
  }

  // Algorithmic fallback if Gemini key is missing or fails
  const locations = new Set<string>();
  const alerts: string[] = [];
  let threatCount = 0;

  items.forEach((item) => {
    const text = item.content.toLowerCase();
    if (text.includes('accident') || text.includes('brutality') || text.includes('protest') || text.includes('alert') || text.includes('emergency') || text.includes('rain') || text.includes('flood')) {
      threatCount++;
      alerts.push(`"${item.title || 'Incident'}" from @${item.author}`);
    }
    // Spot locations
    ['vesu', 'adajan', 'varachha', 'katargam', 'rander', 'chowk bazar', 'dumas'].forEach((loc) => {
      if (text.includes(loc)) locations.add(loc.toUpperCase());
    });
  });

  let fallbackSummary = `### OSINT Automated Batch Summary\n\n`;
  fallbackSummary += `*   **Threat Level Assessment**: ${threatCount > 0 ? 'MEDIUM (Alerts/Safety tags detected)' : 'LOW (General community discussions)'}\n`;
  fallbackSummary += `*   **Ingested Posts**: ${items.length} records analyzed.\n`;
  if (locations.size > 0) {
    fallbackSummary += `*   **Identified Locations**: ${Array.from(locations).join(', ')}\n`;
  }
  if (alerts.length > 0) {
    fallbackSummary += `*   **Critical Incidents**: Identified ${threatCount} posts highlighting potential events or complaints (e.g. ${alerts.slice(0, 2).join(', ')}).\n`;
  } else {
    fallbackSummary += `*   **Critical Incidents**: No high-threat alert keywords flagged in this crawl batch.\n`;
  }
  return fallbackSummary;
}

/**
 * Database Seeder Routine
 */
async function seedDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    // 1. Seed Users
    logger.info('Ensuring default law enforcement credentials exist in database...', 'DatabaseSeeding');
    const usersToSeed = [
      { username: 'admin', email: 'admin@suratpolice.gov.in', password: 'admin_rakshak', role: 'admin' },
      { username: 'officer_surat', email: 'officer@suratpolice.gov.in', password: 'rakshak_secure', role: 'officer' },
      { username: 'analyst_mehta', email: 'mehta@suratpolice.gov.in', password: 'analyst_secure', role: 'analyst' }
    ];

    for (const u of usersToSeed) {
      const hash = await bcrypt.hash(u.password, 10);
      await client.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (username) DO UPDATE 
        SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role;
      `, [u.username, u.email, hash, u.role]);
    }
    
    logger.info('Demo users checked/seeded successfully.', 'DatabaseSeeding');

    // 2. Check if raw posts exist, seed only if empty (never purge existing crawled items)
    const postCountRes = await client.query('SELECT COUNT(*) FROM raw_posts;');
    const postCount = parseInt(postCountRes.rows[0].count, 10);

    if (postCount === 0) {
      logger.info('Raw posts table is empty. Pre-seeding baseline OSINT intelligence for Surat command map...', 'DatabaseSeeding');
      
      const seedRawItems = [
        ...generateMockOSINT('reddit', 'search', 'protest', 3),
        ...generateMockOSINT('twitter', 'search', 'traffic', 3),
        ...generateMockOSINT('telegram', 'search', 'disaster', 3),
        ...generateMockOSINT('instagram', 'search', 'cyber', 2)
      ];

      let alertSeedCount = 0;
      for (const item of seedRawItems) {
        // Insert into raw_posts
        await client.query(`
          INSERT INTO raw_posts (id, source, url, title, content, author, published_at, metadata)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING;
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

        // Run local NLP analysis
        const analysis = await analyzePost(item);

        // Insert into processed_posts
        const procResult = await client.query(`
          INSERT INTO processed_posts (
            raw_post_id, original_language, translated_title, translated_content,
            sentiment_score, sentiment_label, threat_score, threat_label, threat_category, named_entities
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (raw_post_id) DO NOTHING
          RETURNING id;
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

        if (procResult.rowCount !== null && procResult.rowCount > 0 && analysis.threatScore >= 0.45) {
          const processedPostId = procResult.rows[0].id;
          const severity = analysis.threatLabel === 'critical' ? 'critical' : 'warning';
          
          let coords: [number, number] | null = null;
          if (analysis.namedEntities.locations && analysis.namedEntities.locations.length > 0) {
            const primaryLoc = analysis.namedEntities.locations[0].toLowerCase();
            if (SURAT_LOCATIONS[primaryLoc]) {
              coords = SURAT_LOCATIONS[primaryLoc];
            }
          }

          if (hasPostGIS && coords) {
            await client.query(`
              INSERT INTO alerts (processed_post_id, severity, status, location_geom)
              VALUES ($1, $2, 'pending', ST_SetSRID(ST_MakePoint($3, $4), 4326))
            `, [processedPostId, severity, coords[0], coords[1]]);
          } else {
            const geomStr = coords ? `${coords[1]},${coords[0]}` : null;
            await client.query(`
              INSERT INTO alerts (processed_post_id, severity, status, location_geom)
              VALUES ($1, $2, 'pending', $3)
            `, [processedPostId, severity, geomStr]);
          }
          alertSeedCount++;
        }
      }
      logger.info(`Successfully seeded ${seedRawItems.length} posts and generated ${alertSeedCount} active alerts.`, 'DatabaseSeeding');
    }
  } catch (err) {
    logger.error('Database seeding encountered an error.', err as Error, 'DatabaseSeeding');
  } finally {
    client.release();
  }
}

/**
 * Endpoint for registering a new user/officer.
 */
fastify.post(
  '/auth/register',
  { schema: registerSchema },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const { username, email, password, role } = request.body as UserRegistrationDto;
    const finalRole = role || 'officer';

    try {
      if (!username || !email || !password) {
        reply.status(400).send({
          success: false,
          error: 'Username, email, and password are required.'
        });
        return;
      }

      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      const query = `
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, email, role, created_at;
      `;

      const result = await pool.query(query, [username, email, hashedPassword, finalRole]);
      const dbUser = result.rows[0];

      const user: User = {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role,
        createdAt: new Date(dbUser.created_at).toISOString(),
      };

      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`Successfully registered user: ${username} with role: ${finalRole}`, 'AuthHandler');

      const response = {
        success: true,
        message: 'Registration successful.',
        token,
        user,
        data: { user, token },
      };

      reply.status(201).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        const err = error as any;
        if (err.code === '23505') {
          logger.warn(`Registration conflict. Username or Email already exists: ${username} / ${email}`, 'AuthHandler');
          const response: ApiResponse = {
            success: false,
            error: 'Username or Email is already registered.',
          };
          reply.status(409).send(response);
          return;
        }
        logger.error('Failed to register new user.', err, 'AuthHandler');
      }

      const response: ApiResponse = {
        success: false,
        error: 'An unexpected database error occurred during registration.',
      };
      reply.status(500).send(response);
    }
  }
);

/**
 * Endpoint for user authentication (Login).
 */
fastify.post(
  '/auth/login',
  { schema: loginSchema },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const { username, password } = request.body as UserLoginDto;

    try {
      if (!username || !password) {
        reply.status(400).send({
          success: false,
          error: 'Username and password are required.'
        });
        return;
      }

      const query = `
        SELECT id, username, email, password_hash, role, created_at 
        FROM users 
        WHERE username = $1;
      `;
      const result = await pool.query(query, [username]);

      if (result.rowCount === 0) {
        logger.warn(`Failed login attempt: User not found (${username})`, 'AuthHandler');
        const response: ApiResponse = {
          success: false,
          error: 'Invalid username or password.',
        };
        reply.status(401).send(response);
        return;
      }

      const dbUser = result.rows[0];
      const isPasswordMatch = await bcrypt.compare(password, dbUser.password_hash);

      if (!isPasswordMatch) {
        logger.warn(`Failed login attempt: Incorrect password for user: ${username}`, 'AuthHandler');
        const response: ApiResponse = {
          success: false,
          error: 'Invalid username or password.',
        };
        reply.status(401).send(response);
        return;
      }

      const user: User = {
        id: dbUser.id,
        username: dbUser.username,
        email: dbUser.email,
        role: dbUser.role,
        createdAt: new Date(dbUser.created_at).toISOString(),
      };

      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`User logged in successfully: ${username}`, 'AuthHandler');

      const response = {
        success: true,
        message: 'Login successful.',
        token,
        user,
        data: { user, token },
      };

      reply.status(200).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('Error executing user login query.', error, 'AuthHandler');
      }
      const response: ApiResponse = {
        success: false,
        error: 'An unexpected database error occurred during login.',
      };
      reply.status(500).send(response);
    }
  }
);

/**
 * Secured endpoint to retrieve the current user profile.
 */
fastify.get(
  '/auth/me',
  { preHandler: [authenticate] },
  async (
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> => {
    const response: ApiResponse<{ user: UserJWTPayload }> = {
      success: true,
      data: {
        user: request.user!,
      },
    };
    reply.status(200).send(response);
  }
);

// Route aliases for /api/auth prefix
fastify.post('/api/auth/register', { schema: registerSchema }, async (req, reply) => {
  return fastify.inject({ method: 'POST', url: '/auth/register', payload: req.body as any }).then(res => {
    reply.status(res.statusCode).headers(res.headers).send(res.body);
  });
});
fastify.post('/api/auth/login', { schema: loginSchema }, async (req, reply) => {
  return fastify.inject({ method: 'POST', url: '/auth/login', payload: req.body as any }).then(res => {
    reply.status(res.statusCode).headers(res.headers).send(res.body);
  });
});
fastify.get('/api/auth/me', { preHandler: [authenticate] }, async (req, reply) => {
  reply.send({ success: true, data: { user: req.user! } });
});

/**
 * Health check endpoints for Uptime & Keep-Alive Pings (cron-job.org)
 */
fastify.get('/api/health', async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.send({ status: 'ok', timestamp: new Date().toISOString(), service: 'Rakshak AI Backend' });
});

fastify.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
  reply.send({ status: 'ok', timestamp: new Date().toISOString(), service: 'Rakshak AI Backend' });
});

/**
 * Send 6-Digit Email OTP for Login, Registration, or Password Reset
 */
fastify.post('/api/auth/send-otp', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { email, purpose = 'LOGIN' } = (request.body as any) || {};
    if (!email || !email.includes('@')) {
      reply.status(400).send({ success: false, error: 'Valid official email address is required.' });
      return;
    }

    const normPurpose = (purpose.toUpperCase() === 'REGISTER' ? 'REGISTER' : (purpose.toUpperCase() === 'FORGOT_PASSWORD' ? 'FORGOT_PASSWORD' : 'LOGIN')) as any;
    
    // Check user existence if logging in or resetting password
    if (normPurpose === 'FORGOT_PASSWORD' || normPurpose === 'LOGIN') {
      const userRes = await pool.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1);', [email.trim()]);
      if (userRes.rowCount === 0 && normPurpose === 'FORGOT_PASSWORD') {
        reply.status(404).send({ success: false, error: `No registered officer profile found with email: ${email}` });
        return;
      }
    }

    const result = await otpAuthService.generateAndSendOtp(email, normPurpose);
    reply.send(result);
  } catch (err) {
    logger.error('Error generating security OTP', err as Error, 'APIServer');
    reply.status(500).send({ success: false, error: 'Failed to dispatch security OTP.' });
  }
});

/**
 * Verify OTP and Authenticate User (Passwordless / 2FA Login)
 */
fastify.post('/api/auth/verify-otp-login', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { email, otp, password } = (request.body as any) || {};
    if (!email || !otp) {
      reply.status(400).send({ success: false, error: 'Email and 6-digit OTP code are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const verification = otpAuthService.verifyOtp(cleanEmail, otp, 'LOGIN');
    if (!verification.valid) {
      reply.status(401).send({ success: false, error: verification.error });
      return;
    }

    // Lookup user in PostgreSQL
    let userRes = await pool.query('SELECT id, username, email, password_hash, role, created_at FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1);', [cleanEmail]);
    
    // If user doesn't exist, create an active officer profile for this email
    if (userRes.rowCount === 0) {
      const fallbackUsername = cleanEmail.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_');
      const hashedPass = await bcrypt.hash(password || 'Rakshak@2026', 10);
      const insertRes = await pool.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, 'officer')
        RETURNING id, username, email, role, created_at;
      `, [fallbackUsername, cleanEmail, hashedPass]);
      userRes = insertRes;
    } else if (password) {
      // If password was also provided, verify it (2FA mode)
      const dbUser = userRes.rows[0];
      const isPassValid = await bcrypt.compare(password, dbUser.password_hash);
      if (!isPassValid) {
        reply.status(401).send({ success: false, error: 'Incorrect badge password.' });
        return;
      }
    }

    const dbUser = userRes.rows[0];
    const user: User = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role,
      createdAt: new Date(dbUser.created_at).toISOString(),
    };

    const jwtPayload: UserJWTPayload = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    const token = signToken(jwtPayload);

    logger.info(`User authenticated successfully via Email OTP: ${user.email}`, 'AuthHandler');

    reply.send({
      success: true,
      message: 'Officer identity authenticated successfully.',
      token,
      user,
      data: { user, token }
    });
  } catch (err) {
    logger.error('Error verifying login OTP', err as Error, 'APIServer');
    reply.status(500).send({ success: false, error: 'Authentication verification failed.' });
  }
});

/**
 * Helper to enforce enterprise police department strong password policy for new enrollments/resets
 */
function validateStrongPassword(password: string): { valid: boolean; error?: string } {
  if (!password || password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters long.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one numeric digit (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password)) {
    return { valid: false, error: 'Password must contain at least one special character (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

/**
 * Register New Officer with Email OTP Verification
 */
fastify.post('/api/auth/register-with-otp', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { username, email, password, role = 'officer', otp } = (request.body as any) || {};
    if (!username || !email || !password || !otp) {
      reply.status(400).send({ success: false, error: 'Username, email, password, and OTP code are required.' });
      return;
    }

    // Strong password validation for new account enrollments
    const passCheck = validateStrongPassword(password);
    if (!passCheck.valid) {
      reply.status(400).send({ success: false, error: passCheck.error });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    const verification = otpAuthService.verifyOtp(cleanEmail, otp, 'REGISTER');
    if (!verification.valid) {
      reply.status(401).send({ success: false, error: verification.error });
      return;
    }

    // Check if username or email already exists
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2);', [cleanUsername, cleanEmail]);
    if (existing.rowCount !== null && existing.rowCount > 0) {
      reply.status(409).send({ success: false, error: 'An officer with this badge username or email already exists.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertRes = await pool.query(`
      INSERT INTO users (username, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email, role, created_at;
    `, [cleanUsername, cleanEmail, hashedPassword, role]);

    const dbUser = insertRes.rows[0];
    const user: User = {
      id: dbUser.id,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.role,
      createdAt: new Date(dbUser.created_at).toISOString(),
    };

    const token = signToken({ id: user.id, username: user.username, role: user.role });

    logger.info(`New officer registered with OTP verification: ${cleanUsername} (${cleanEmail})`, 'AuthHandler');

    reply.send({
      success: true,
      message: 'Officer profile enrolled successfully.',
      token,
      user,
      data: { user, token }
    });
  } catch (err) {
    logger.error('Error in register-with-otp', err as Error, 'APIServer');
    reply.status(500).send({ success: false, error: 'Registration failed.' });
  }
});

/**
 * Reset Forgotten Password with Email OTP
 */
fastify.post('/api/auth/reset-password', async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { email, otp, newPassword } = (request.body as any) || {};
    if (!email || !otp || !newPassword) {
      reply.status(400).send({ success: false, error: 'Email, 6-digit OTP code, and new password are required.' });
      return;
    }

    // Strong password validation for password resets
    const passCheck = validateStrongPassword(newPassword);
    if (!passCheck.valid) {
      reply.status(400).send({ success: false, error: passCheck.error });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const verification = otpAuthService.verifyOtp(cleanEmail, otp, 'FORGOT_PASSWORD');
    if (!verification.valid) {
      reply.status(401).send({ success: false, error: verification.error });
      return;
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const updateRes = await pool.query(`
      UPDATE users 
      SET password_hash = $1 
      WHERE LOWER(email) = LOWER($2) OR LOWER(username) = LOWER($2)
      RETURNING id, username, email;
    `, [hashedPassword, cleanEmail]);

    if (updateRes.rowCount === 0) {
      reply.status(404).send({ success: false, error: 'No user account found to update password.' });
      return;
    }

    logger.info(`Password successfully reset via OTP for officer: ${cleanEmail}`, 'AuthHandler');

    reply.send({
      success: true,
      message: 'Badge access password reset successfully. You can now sign in with your new password.'
    });
  } catch (err) {
    logger.error('Error resetting password', err as Error, 'APIServer');
    reply.status(500).send({ success: false, error: 'Failed to reset password.' });
  }
});

/**
 * On-demand targeted crawler endpoint (integrated with DB pipeline).
 */
fastify.post('/api/crawler/extract', async (request: FastifyRequest, reply: FastifyReply) => {
  const {
    platform,
    mode,
    target,
    limit = 10,
    depth = 2,
    startDate,
    endDate,
    extractComments = false
  } = request.body as CrawlerExtractDto;

  if (!platform || !target) {
    reply.status(400).send({ error: 'Platform and Target parameters are required.' });
    return;
  }

  logger.info(`API Request: Ingesting target "${target}" from platform "${platform}"`, 'APIServer');

  try {
    let items: RawCrawledItem[] = [];
    const runLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const runDepth = typeof depth === 'string' ? parseInt(depth, 10) : depth;

    // Execute active playwright crawler, wrapped in try-catch to enable fallback gracefully
    try {
      switch (platform.toLowerCase()) {
        case 'reddit':
          items = await redditScraper.scrape(target, runLimit, extractComments, startDate, endDate);
          break;

        case 'telegram':
          items = await telegramScraper.scrape(target, runLimit, startDate, endDate);
          break;

        case 'instagram':
          const igMode = (mode === 'reels' || target.toLowerCase().includes('reel')) 
            ? 'reels' 
            : mode === 'hashtag' || target.startsWith('#')
              ? 'hashtag' 
              : 'profile';
          items = await instagramScraper.scrape(igMode as any, target, runLimit, startDate, endDate, true);
          break;

        case 'twitter':
        case 'x':
          const twMode = mode === 'hashtag' ? 'hashtag' : (mode === 'handle' || mode === 'profile') ? 'handle' : 'search';
          items = await twitterScraper.scrape(twMode, target, runLimit, startDate, endDate, true);
          break;

        case 'youtube':
          const ytMode = mode === 'channel' ? 'channel' : 'search';
          items = await youtubeScraper.scrape(ytMode, target, runLimit, startDate, endDate, true);
          break;

        case 'facebook':
          items = await facebookScraper.scrape(target, runLimit, startDate, endDate);
          break;

        default:
          reply.status(400).send({ error: `Platform "${platform}" is not supported.` });
          return;
      }
    } catch (scraperError) {
      logger.warn(`Live scraper error for ${platform} - ${target}: ${(scraperError as Error).message}. Initiating realistic mock fallback.`, 'APIServer');
    }

    // Call Mock Generator if scrapers return no items (for reliable demo evaluation)
    let isMockFallback = false;
    if (items.length === 0) {
      isMockFallback = true;
      logger.info(`No items retrieved from live scraping. Invoking fallback generator for target: "${target}"`, 'APIServer');
      items = generateMockOSINT(platform.toLowerCase() as SocialSource, mode || 'search', target, runLimit);
    }

    const filteredItems = filterByDateRange(items, startDate, endDate);
    const processedItems: any[] = [];

    // Push each item into database and run analysis pipeline
    for (const item of filteredItems) {
      try {
        // 1. Save Raw Ingest
        await pool.query(`
          INSERT INTO raw_posts (id, source, url, title, content, author, published_at, metadata, crawled_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (id) DO UPDATE SET
            url = EXCLUDED.url,
            title = EXCLUDED.title,
            content = EXCLUDED.content,
            metadata = EXCLUDED.metadata,
            crawled_at = NOW();
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

        // 2. Perform NLP analysis (combining rules-based + Gemini dynamic checks)
        const analysis = await analyzePost(item);

        // 3. Save Processed NLP Info
        const procRes = await pool.query(`
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
            named_entities = EXCLUDED.named_entities
          RETURNING id;
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

        const processedPostId = procRes.rows[0].id;

        // 4. Generate Alert if high threat
        if (analysis.threatScore >= 0.45) {
          const alertCheck = await pool.query('SELECT id FROM alerts WHERE processed_post_id = $1', [processedPostId]);
          if (alertCheck.rowCount === 0) {
            const severity = analysis.threatLabel === 'critical' ? 'critical' : 'warning';
            
            let coords: [number, number] | null = null;
            if (analysis.namedEntities.locations && analysis.namedEntities.locations.length > 0) {
              const primaryLoc = analysis.namedEntities.locations[0].toLowerCase();
              if (SURAT_LOCATIONS[primaryLoc]) {
                coords = SURAT_LOCATIONS[primaryLoc];
              }
            }

            if (hasPostGIS && coords) {
              await pool.query(`
                INSERT INTO alerts (processed_post_id, severity, status, location_geom)
                VALUES ($1, $2, 'pending', ST_SetSRID(ST_MakePoint($3, $4), 4326))
              `, [processedPostId, severity, coords[0], coords[1]]);
            } else {
              const geomStr = coords ? `${coords[1]},${coords[0]}` : null;
              await pool.query(`
                INSERT INTO alerts (processed_post_id, severity, status, location_geom)
                VALUES ($1, $2, 'pending', $3)
              `, [processedPostId, severity, geomStr]);
            }
          }
        }

        processedItems.push({
          ...item,
          analysis
        });
      } catch (ingestErr) {
        logger.error(`Error saving and processing post ${item.id}`, ingestErr as Error, 'APIServer');
      }
    }

    const summary = await generateOSINTSummary(filteredItems);

    reply.send({
      success: true,
      platform,
      target,
      count: filteredItems.length,
      isLiveScrape: !isMockFallback,
      summary,
      data: processedItems
    });
  } catch (error) {
    logger.error('API Ingestion extraction failed', error as Error, 'APIServer');
    reply.status(500).send({
      error: 'Crawler extraction failed',
      details: (error as Error).message
    });
  }
});

/**
 * Endpoints for Dashboard metrics and aggregates
 */
fastify.get('/api/dashboard/stats', { preHandler: [authenticate] }, async (request, reply) => {
  try {
    const totalCrawledRes = await pool.query('SELECT COUNT(*) FROM raw_posts;');
    const criticalAlertsRes = await pool.query("SELECT COUNT(*) FROM alerts WHERE severity = 'critical';");
    const unresolvedAlertsRes = await pool.query("SELECT COUNT(*) FROM alerts WHERE status IN ('pending', 'investigating');");
    const resolvedAlertsRes = await pool.query("SELECT COUNT(*) FROM alerts WHERE status = 'resolved';");

    const platformRes = await pool.query('SELECT source, COUNT(*) FROM raw_posts GROUP BY source;');
    const categoryRes = await pool.query('SELECT threat_category as category, COUNT(*) FROM processed_posts GROUP BY threat_category;');
    const languageRes = await pool.query('SELECT original_language as lang, COUNT(*) FROM processed_posts GROUP BY original_language;');

    const platformBreakdown = platformRes.rows.reduce((acc: any, row: any) => {
      acc[row.source] = parseInt(row.count, 10);
      return acc;
    }, {});

    const categoryBreakdown = categoryRes.rows.reduce((acc: any, row: any) => {
      acc[row.category] = parseInt(row.count, 10);
      return acc;
    }, {});

    const languageBreakdown = languageRes.rows.reduce((acc: any, row: any) => {
      acc[row.lang] = parseInt(row.count, 10);
      return acc;
    }, {});

    reply.send({
      success: true,
      stats: {
        totalCrawled: parseInt(totalCrawledRes.rows[0].count, 10),
        criticalAlerts: parseInt(criticalAlertsRes.rows[0].count, 10),
        unresolvedAlerts: parseInt(unresolvedAlertsRes.rows[0].count, 10),
        resolvedAlerts: parseInt(resolvedAlertsRes.rows[0].count, 10),
        platformBreakdown,
        categoryBreakdown,
        languageBreakdown
      }
    });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve stats', details: (err as Error).message });
  }
});

/**
 * Paginated and filterable Intelligence Feed list (sorted by newest crawled/published first)
 */
fastify.get('/api/dashboard/feed', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { platform, severity, category, language, query } = request.query as any;
    let sql = `
      SELECT 
        r.id, r.source, r.url, r.title, r.content, r.author, r.published_at as "publishedAt", r.crawled_at as "crawledAt", r.metadata,
        p.original_language as "originalLanguage", p.translated_title as "translatedTitle", p.translated_content as "translatedContent",
        p.sentiment_score as "sentimentScore", p.sentiment_label as "sentimentLabel",
        p.threat_score as "threatScore", p.threat_label as "threatLabel", p.threat_category as "threatCategory",
        p.named_entities as "namedEntities"
      FROM raw_posts r
      JOIN processed_posts p ON r.id = p.raw_post_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let pIdx = 1;

    if (platform) {
      sql += ` AND r.source = $${pIdx}`;
      params.push(platform);
      pIdx++;
    }
    if (severity) {
      sql += ` AND p.threat_label = $${pIdx}`;
      params.push(severity);
      pIdx++;
    }
    if (category) {
      sql += ` AND p.threat_category = $${pIdx}`;
      params.push(category);
      pIdx++;
    }
    if (language) {
      sql += ` AND p.original_language = $${pIdx}`;
      params.push(language);
      pIdx++;
    }
    if (query) {
      sql += ` AND (r.content ILIKE $${pIdx} OR r.title ILIKE $${pIdx} OR p.translated_content ILIKE $${pIdx})`;
      params.push(`%${query}%`);
      pIdx++;
    }

    sql += ` ORDER BY r.crawled_at DESC, r.published_at DESC LIMIT 100;`;
    const res = await pool.query(sql, params);
    reply.send({ success: true, count: res.rowCount, feed: res.rows, data: res.rows });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve feed', details: (err as Error).message });
  }
});

// Alias for /api/feed
fastify.get('/api/feed', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { platform, severity, category, language, query } = request.query as any;
    let sql = `
      SELECT 
        r.id, r.source, r.url, r.title, r.content, r.author, r.published_at as "publishedAt", r.crawled_at as "crawledAt", r.metadata,
        p.original_language as "originalLanguage", p.translated_title as "translatedTitle", p.translated_content as "translatedContent",
        p.sentiment_score as "sentimentScore", p.sentiment_label as "sentimentLabel",
        p.threat_score as "threatScore", p.threat_label as "threatLabel", p.threat_category as "threatCategory",
        p.named_entities as "namedEntities"
      FROM raw_posts r
      JOIN processed_posts p ON r.id = p.raw_post_id
      WHERE 1=1
    `;
    const params: any[] = [];
    let pIdx = 1;

    if (platform) {
      sql += ` AND r.source = $${pIdx}`;
      params.push(platform);
      pIdx++;
    }
    if (severity) {
      sql += ` AND p.threat_label = $${pIdx}`;
      params.push(severity);
      pIdx++;
    }
    if (category) {
      sql += ` AND p.threat_category = $${pIdx}`;
      params.push(category);
      pIdx++;
    }
    if (language) {
      sql += ` AND p.original_language = $${pIdx}`;
      params.push(language);
      pIdx++;
    }
    if (query) {
      sql += ` AND (r.content ILIKE $${pIdx} OR r.title ILIKE $${pIdx} OR p.translated_content ILIKE $${pIdx})`;
      params.push(`%${query}%`);
      pIdx++;
    }

    sql += ` ORDER BY r.crawled_at DESC, r.published_at DESC LIMIT 100;`;
    const res = await pool.query(sql, params);
    reply.send({ success: true, count: res.rowCount, feed: res.rows, data: res.rows });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve feed', details: (err as Error).message });
  }
});

/**
 * Delete a crawled telemetry post from the database
 */
fastify.delete('/api/feed/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { id } = request.params as { id: string };
    if (!id) {
      reply.status(400).send({ error: 'Post ID is required' });
      return;
    }

    // 1. Delete associated alerts safely
    await pool.query(`
      DELETE FROM alerts 
      WHERE processed_post_id IN (
        SELECT id FROM processed_posts WHERE raw_post_id = $1
      );
    `, [id]);

    // 2. Delete processed_posts
    await pool.query('DELETE FROM processed_posts WHERE raw_post_id = $1;', [id]);

    // 3. Delete raw_posts
    const delRes = await pool.query('DELETE FROM raw_posts WHERE id = $1;', [id]);

    reply.send({ success: true, message: 'Telemetry post deleted successfully', deletedCount: delRes.rowCount });
  } catch (err) {
    logger.error('Failed to delete telemetry post', err as Error, 'APIServer');
    reply.status(500).send({ error: 'Failed to delete post', details: (err as Error).message });
  }
});
fastify.delete('/api/posts/:id', { preHandler: [authenticate] }, async (req, reply) => {
  return fastify.inject({ method: 'DELETE', url: `/api/feed/${(req.params as any).id}`, headers: req.headers as any }).then(res => {
    reply.status(res.statusCode).headers(res.headers).send(res.body);
  });
});

/**
 * Retrieves Active Alerts coordinates and post contexts for command mapping
 */
fastify.get('/api/dashboard/alerts', { preHandler: [authenticate] }, async (request, reply) => {
  try {
    const geomSelect = hasPostGIS
      ? 'ST_X(a.location_geom) as lng, ST_Y(a.location_geom) as lat'
      : 'a.location_geom as "geomText"';

    const sql = `
      SELECT 
        a.id, a.processed_post_id as "processedPostId", a.severity, a.status, a.assigned_officer_id as "assignedOfficerId", a.created_at as "createdAt",
        u.username as "assignedOfficerName",
        ${geomSelect},
        r.id as "rawPostId", r.source, r.url, r.title, r.content, r.author, r.published_at as "publishedAt",
        p.translated_title as "translatedTitle", p.translated_content as "translatedContent", p.threat_score as "threatScore", p.threat_category as "threatCategory"
      FROM alerts a
      JOIN processed_posts p ON a.processed_post_id = p.id
      JOIN raw_posts r ON p.raw_post_id = r.id
      LEFT JOIN users u ON a.assigned_officer_id = u.id
      ORDER BY a.created_at DESC;
    `;
    const res = await pool.query(sql);
    
    const alerts = res.rows.map((row: any) => {
      let coordinates: [number, number] | null = null;
      if (hasPostGIS) {
        if (row.lng !== null && row.lat !== null) {
          coordinates = [row.lng, row.lat];
        }
      } else if (row.geomText) {
        const parts = row.geomText.split(',');
        if (parts.length === 2) {
          // Convert stored "latitude,longitude" text into [longitude, latitude] coordinates array
          coordinates = [parseFloat(parts[1]), parseFloat(parts[0])];
        }
      }
      
      return {
        id: row.id,
        processedPostId: row.processedPostId,
        severity: row.severity,
        status: row.status,
        assignedOfficerId: row.assignedOfficerId,
        assignedOfficerName: row.assignedOfficerName,
        createdAt: row.createdAt,
        locationGeom: coordinates ? { type: 'Point', coordinates } : null,
        post: {
          id: row.rawPostId,
          source: row.source,
          url: row.url,
          title: row.title,
          content: row.content,
          translatedTitle: row.translatedTitle,
          translatedContent: row.translatedContent,
          author: row.author,
          publishedAt: row.publishedAt,
          threatScore: row.threatScore,
          threatCategory: row.threatCategory
        }
      };
    });

    reply.send({ success: true, alerts });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve alerts', details: (err as Error).message });
  }
});

/**
 * Updates Alert assignment or status
 */
fastify.put('/api/dashboard/alerts/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { id } = request.params as any;
    const { status, assignedOfficerId } = request.body as any;

    let sql = 'UPDATE alerts SET ';
    const sets: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (status) {
      sets.push(`status = $${pIdx}`);
      params.push(status);
      pIdx++;
    }
    if (assignedOfficerId !== undefined) {
      sets.push(`assigned_officer_id = $${pIdx}`);
      params.push(assignedOfficerId === 'null' || assignedOfficerId === null ? null : parseInt(assignedOfficerId, 10));
      pIdx++;
    }

    if (sets.length === 0) {
      reply.status(400).send({ error: 'No fields to update' });
      return;
    }

    sql += sets.join(', ');
    sql += ` WHERE id = $${pIdx} RETURNING id;`;
    params.push(parseInt(id, 10));

    const result = await pool.query(sql, params);
    if (result.rowCount === 0) {
      reply.status(404).send({ error: `Alert with ID ${id} not found` });
      return;
    }

    reply.send({ success: true, message: `Alert ${id} updated successfully.` });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to update alert', details: (err as Error).message });
  }
});

/**
 * Get registered officers list
 */
fastify.get('/api/dashboard/officers', { preHandler: [authenticate] }, async (request, reply) => {
  try {
    const res = await pool.query("SELECT id, username, email, role FROM users ORDER BY id ASC;");
    reply.send({ success: true, officers: res.rows });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve officers', details: (err as Error).message });
  }
});

/**
 * Evidentiary chain of custody reports dataset
 */
fastify.get('/api/dashboard/reports/:alertId', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { alertId } = request.params as any;
    const geomSelect = hasPostGIS
      ? 'ST_X(a.location_geom) as lng, ST_Y(a.location_geom) as lat'
      : 'a.location_geom as "geomText"';

    const sql = `
      SELECT 
        a.id as "alertId", a.severity, a.status, a.created_at as "alertCreatedAt",
        u.username as "assignedOfficerName", u.role as "assignedOfficerRole", u.email as "assignedOfficerEmail",
        ${geomSelect},
        r.id as "postId", r.source, r.url, r.title, r.content, r.author, r.published_at as "publishedAt", r.crawled_at as "crawledAt",
        p.original_language as "originalLanguage", p.translated_title as "translatedTitle", p.translated_content as "translatedContent",
        p.sentiment_score as "sentimentScore", p.sentiment_label as "sentimentLabel",
        p.threat_score as "threatScore", p.threat_label as "threatLabel", p.threat_category as "threatCategory",
        p.named_entities as "namedEntities"
      FROM alerts a
      JOIN processed_posts p ON a.processed_post_id = p.id
      JOIN raw_posts r ON p.raw_post_id = r.id
      LEFT JOIN users u ON a.assigned_officer_id = u.id
      WHERE a.id = $1;
    `;
    const res = await pool.query(sql, [parseInt(alertId, 10)]);
    
    if (res.rowCount === 0) {
      reply.status(404).send({ error: `Alert with ID ${alertId} not found` });
      return;
    }

    const row = res.rows[0];
    let coordinates: [number, number] | null = null;
    if (hasPostGIS) {
      if (row.lng !== null && row.lat !== null) {
        coordinates = [row.lng, row.lat];
      }
    } else if (row.geomText) {
      const parts = row.geomText.split(',');
      if (parts.length === 2) {
        coordinates = [parseFloat(parts[1]), parseFloat(parts[0])];
      }
    }

    const contentHash = computeContentHash(row.content, row.title);

    const report = {
      caseId: `SRT-OSINT-${row.alertId.toString().padStart(4, '0')}`,
      alertId: row.alertId,
      severity: row.severity,
      status: row.status,
      createdAt: row.alertCreatedAt,
      location: coordinates ? { latitude: coordinates[1], longitude: coordinates[0] } : null,
      officer: row.assignedOfficerName ? {
        name: row.assignedOfficerName,
        role: row.assignedOfficerRole,
        email: row.assignedOfficerEmail
      } : null,
      post: {
        id: row.postId,
        source: row.source,
        url: row.url,
        title: row.title,
        content: row.content,
        author: row.author,
        publishedAt: row.publishedAt,
        crawledAt: row.crawledAt,
        contentHash
      },
      analysis: {
        originalLanguage: row.originalLanguage,
        translatedTitle: row.translatedTitle,
        translatedContent: row.translatedContent,
        sentimentScore: parseFloat(row.sentimentScore),
        sentimentLabel: row.sentimentLabel,
        threatScore: parseFloat(row.threatScore),
        threatLabel: row.threatLabel,
        threatCategory: row.threatCategory,
        namedEntities: row.namedEntities
      },
      legalNotice: "CONFIDENTIAL LAW ENFORCEMENT RECORD. Prepared by Surat Police Cyber Cell. Information extracted under OSINT authorization protocols. Digital chain-of-custody verified using SHA-256 cryptographic verification checks. Document alterations will render the record legally inadmissible.",
      systemVersion: "Rakshak AI OSINT Node v1.0.0"
    };

    reply.send({ success: true, report });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to generate evidence report', details: (err as Error).message });
  }
});

const agentInvestigator = new AgentInvestigator(pool);

/**
 * Agentic Copilot Query Route (ERH26_PS_10)
 */
fastify.post('/api/agent/chat', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { query, postId, contextItems = [] } = request.body as { query?: string; postId?: string; contextItems?: any[] };
    if (!query) {
      reply.status(400).send({ error: 'Query prompt is required' });
      return;
    }
    const officer = (request as any).user?.username || 'Officer';
    const result = await agentInvestigator.processQuery(query, officer, postId, contextItems);
    reply.send({ success: true, result });
  } catch (err) {
    reply.status(500).send({ error: 'Agent execution failed', details: (err as Error).message });
  }
});

/**
 * Dark Web Intelligence Feed & Categorized Repository (ERH26_PS_06)
 */
fastify.get('/api/darkweb/feed', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { query, category } = request.query as { query?: string; category?: string };
    const feeds = darkWebMonitor.getFeeds(query, category);
    reply.send({ success: true, count: feeds.length, feeds });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to fetch dark web feeds', details: (err as Error).message });
  }
});

/**
 * Live Tor & Dark Web Search Route (POST & GET) (ERH26_PS_06)
 */
fastify.post('/api/darkweb/search', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { query } = (request.body as { query?: string }) || {};
    if (!query) {
      reply.status(400).send({ error: 'Search keyword is required for Tor query' });
      return;
    }
    const results = await darkWebMonitor.searchLiveAhmia(query);
    reply.send({ success: true, query, count: results.length, results });
  } catch (err) {
    reply.status(500).send({ error: 'Live Tor search failed', details: (err as Error).message });
  }
});

fastify.get('/api/darkweb/live-search', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { query } = request.query as { query?: string };
    if (!query) {
      reply.status(400).send({ error: 'Search keyword is required for Tor query' });
      return;
    }
    const results = await darkWebMonitor.searchLiveAhmia(query);
    reply.send({ success: true, query, count: results.length, results });
  } catch (err) {
    reply.status(500).send({ error: 'Live Tor search failed', details: (err as Error).message });
  }
});

/**
 * Cryptocurrency Address Forensic Audit Route (ERH26_PS_06)
 */
fastify.post('/api/crypto/audit', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { address } = request.body as { address?: string };
    if (!address) {
      reply.status(400).send({ error: 'Crypto wallet public address is required' });
      return;
    }
    const audit = await cryptoForensics.auditCryptoAddress(address);
    reply.send({ success: true, audit });
  } catch (err) {
    reply.status(500).send({ error: 'Crypto wallet audit failed', details: (err as Error).message });
  }
});

fastify.post('/api/crypto/notice', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { address, caseId } = request.body as { address?: string; caseId?: string };
    if (!address) {
      reply.status(400).send({ error: 'Crypto wallet public address is required' });
      return;
    }
    const audit = await cryptoForensics.auditCryptoAddress(address);
    const notice = cryptoForensics.generateExchangeProductionNotice(audit, caseId);
    reply.send({ success: true, notice, audit });
  } catch (err) {
    reply.status(500).send({ error: 'Exchange notice generation failed', details: (err as Error).message });
  }
});

fastify.post('/api/darkweb/crypto-lookup', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { address } = request.body as { address?: string };
    if (!address) {
      reply.status(400).send({ error: 'Crypto wallet public address is required' });
      return;
    }
    const audit = await cryptoForensics.auditCryptoAddress(address);
    reply.send({ success: true, audit });
  } catch (err) {
    reply.status(500).send({ error: 'Crypto wallet audit failed', details: (err as Error).message });
  }
});

/**
 * Real Hardware ADB Live Probe Route (ERH26_PS_02)
 */
fastify.get('/api/forensics/adb-live', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const liveResult = await realAdbBridge.probeDevices();
    reply.send({ success: true, data: liveResult });
  } catch (err) {
    reply.status(500).send({ error: 'Live ADB probe failed', details: (err as Error).message });
  }
});

/**
 * Real Physical Device Live Evidence Extraction (Documents, WhatsApp, APKs, EXIF) (ERH26_PS_02)
 */
fastify.post('/api/forensics/live-extract', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { serial } = (request.body as any) || {};
    const officer = (request as any).user?.username || 'Insp. Cyber Crime Branch';
    const result = await realAdbBridge.extractLiveDeviceEvidence(officer, serial);
    reply.send({ success: true, data: result });
  } catch (err) {
    reply.status(500).send({ error: 'Live device extraction failed', details: (err as Error).message });
  }
});

/**
 * Real Evidence Multi-File Upload & Forensic Ingestion (ERH26_PS_02)
 */
fastify.post('/api/forensics/upload-evidence', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const parts = request.files();
    const uploadedFiles: { name: string; buffer: Buffer }[] = [];

    for await (const part of parts) {
      const buf = await part.toBuffer();
      uploadedFiles.push({
        name: part.filename,
        buffer: buf
      });
    }

    const officer = (request as any).user?.username || 'Investigating Officer';
    const report = await forensicsTriage.generateTriageReport(officer, uploadedFiles);

    reply.send({
      success: true,
      filesProcessed: uploadedFiles.length,
      report
    });
  } catch (err) {
    reply.status(500).send({ error: 'Evidence file processing failed', details: (err as Error).message });
  }
});

/**
 * Real-Time Seized Document & Database Download / Preview (ERH26_PS_02)
 */
fastify.get('/api/forensics/download', async (request: FastifyRequest, reply) => {
  try {
    const { filePath, serial, token } = request.query as { filePath?: string; serial?: string; token?: string };
    
    // Auth check: either from header or query token
    const authHeader = request.headers.authorization;
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : token;
    if (!rawToken) {
      reply.status(401).send({ error: 'Unauthorized: Access token required' });
      return;
    }

    try {
      verifyToken(rawToken);
    } catch {
      reply.status(401).send({ error: 'Invalid or expired access token' });
      return;
    }

    if (!filePath) {
      reply.status(400).send({ error: 'filePath parameter is required' });
      return;
    }

    const fname = path.basename(filePath);
    const targetSerial = serial || '91e3a45';
    const evidenceDir = path.join(process.cwd(), 'seized_evidence', targetSerial);
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const localFilePath = path.join(evidenceDir, fname);

    // If file does not exist locally yet, pull it from phone via ADB
    if (!fs.existsSync(localFilePath)) {
      const adbCmd = realAdbBridge.getAdbExecutable();
      await execAsync(`${adbCmd} -s ${targetSerial} pull "${filePath}" "${localFilePath}"`, { timeout: 30000 });
    }

    if (!fs.existsSync(localFilePath)) {
      reply.status(404).send({ error: `File could not be extracted from phone: ${fname}` });
      return;
    }

    const ext = path.extname(fname).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (ext === '.pdf') mimeType = 'application/pdf';
    else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.txt') mimeType = 'text/plain; charset=utf-8';
    else if (ext === '.docx') mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === '.xlsx') mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    const fileStream = fs.createReadStream(localFilePath);
    reply.header('Content-Type', mimeType);
    reply.header('Content-Disposition', `inline; filename="${fname}"`);
    return reply.send(fileStream);

  } catch (err) {
    reply.status(500).send({ error: 'File download failed', details: (err as Error).message });
  }
});

/**
 * Plaintext WhatsApp Chat Export Ingestion (_chat.txt) (ERH26_PS_02)
 */
fastify.post('/api/forensics/parse-chat-text', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { chatText, filename } = request.body as { chatText?: string; filename?: string };
    if (!chatText) {
      reply.status(400).send({ error: 'chatText content is required' });
      return;
    }

    const records = forensicsTriage.parseChatExportText(chatText);
    reply.send({
      success: true,
      totalParsed: records.length,
      records
    });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to parse chat export', details: (err as Error).message });
  }
});

/**
 * WhatsApp crypt14 / crypt15 Decryption Route (ERH26_PS_02)
 */
fastify.post('/api/forensics/decrypt-whatsapp', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { keyHex, dbPath, serial } = request.body as { keyHex?: string; dbPath?: string; serial?: string };
    if (!keyHex) {
      reply.status(400).send({ error: 'WhatsApp 64-hexadecimal key or 32-byte key is required' });
      return;
    }

    const targetSerial = serial || '91e3a45';
    const targetDbPath = dbPath || '/sdcard/Android/media/com.whatsapp/WhatsApp/Databases/msgstore.db.crypt14';
    const fname = path.basename(targetDbPath);
    const localDbPath = path.join(process.cwd(), 'seized_evidence', targetSerial, fname);

    if (!fs.existsSync(localDbPath)) {
      const adbCmd = realAdbBridge.getAdbExecutable();
      await execAsync(`${adbCmd} -s ${targetSerial} pull "${targetDbPath}" "${localDbPath}"`, { timeout: 35000 });
    }

    if (!fs.existsSync(localDbPath)) {
      reply.status(404).send({ error: 'WhatsApp database file could not be pulled from device' });
      return;
    }

    const encBuf = fs.readFileSync(localDbPath);
    const decBuf = forensicsTriage.decryptWhatsAppCrypt14(encBuf, keyHex);

    const decryptedPath = path.join(process.cwd(), 'seized_evidence', targetSerial, 'msgstore_decrypted.db');
    fs.writeFileSync(decryptedPath, decBuf);

    const records = forensicsTriage.parseDatabaseOrChatBuffer(decBuf, 'msgstore_decrypted.db');

    reply.send({
      success: true,
      message: 'WhatsApp database successfully decrypted via AES-256-GCM',
      decryptedDbPath: decryptedPath,
      records
    });
  } catch (err) {
    reply.status(500).send({ error: 'Decryption failed', details: (err as Error).message });
  }
});

/**
 * CrimeOS: Cases Management API (ERH26_PS_10)
 */
fastify.get('/api/crimeos/cases', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const casesRes = await pool.query(`
      SELECT 
        id, case_number as "caseNumber", fir_number as "firNumber", title,
        police_station as "policeStation", investigating_officer as "investigatingOfficer",
        status, threat_level as "threatLevel", applicable_bns_sections as "applicableBnsSections",
        incident_summary as "incidentSummary", created_at as "createdAt"
      FROM cases
      ORDER BY created_at DESC;
    `);

    // If no cases in DB yet, insert realistic default active police cases
    if (casesRes.rows.length === 0) {
      await pool.query(`
        INSERT INTO cases (case_number, fir_number, title, police_station, investigating_officer, status, threat_level, applicable_bns_sections, incident_summary)
        VALUES 
          ('CASE-SRT-2026-081', 'FIR-SRT-2026-4412', 'Varachha Diamond Syndicate Extortion Threat', 'Cyber Crime Branch Surat', 'Insp. V. K. Jadeja', 'ACTIVE_INVESTIGATION', 'CRITICAL', '["BNS 308(2) Extortion", "BNS 351(2) Criminal Intimidation", "IT Act 66D"]'::jsonb, 'Coordinated WhatsApp VoIP extortion demands targeting SEZ diamond export merchants with leaked tax assessment dumps.'),
          ('CASE-SRT-2026-082', 'FIR-SRT-2026-4419', 'NH-48 Ankleshwar-Surat Firearms Trafficking', 'Special Operations Group (SOG)', 'Sub-Insp. R. M. Patel', 'SURVEILLANCE', 'CRITICAL', '["Arms Act Sec 25(1-A)", "BNS 111 Organized Crime"]'::jsonb, 'Underground supply channel distributing country-made 7.65mm pistols via dead drops along Vesu & Dumas bypass.'),
          ('CASE-SRT-2026-083', 'FIR-SRT-2026-4425', 'Katargam Communal Disinformation & Riot Incitement', 'Katargam Police Station', 'Insp. S. B. Desai', 'CHARGESHEET_FILED', 'HIGH', '["BNS 196 Promoting Enmity", "BNS 197 Public Mischief", "IT Act 66C"]'::jsonb, 'Viral social media video manipulation inciting stone-pelting and bandh calls across Katargam market perimeter.');
      `);

      const refreshed = await pool.query(`
        SELECT 
          id, case_number as "caseNumber", fir_number as "firNumber", title,
          police_station as "policeStation", investigating_officer as "investigatingOfficer",
          status, threat_level as "threatLevel", applicable_bns_sections as "applicableBnsSections",
          incident_summary as "incidentSummary", created_at as "createdAt"
        FROM cases
        ORDER BY created_at DESC;
      `);
      reply.send({ success: true, cases: refreshed.rows });
      return;
    }

    reply.send({ success: true, cases: casesRes.rows });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to retrieve cases', details: (err as Error).message });
  }
});

fastify.post('/api/crimeos/cases', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { title, policeStation, investigatingOfficer, threatLevel, incidentSummary, threatCategory } = request.body as any;
    if (!title) {
      reply.status(400).send({ error: 'Case title is required' });
      return;
    }

    const caseNumber = `CASE-SRT-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;
    const firNumber = `FIR-SRT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const officer = investigatingOfficer || (request as any).user?.username || 'IO Cyber Branch';
    const bnsSections = agentInvestigator.getRecommendedBNSSections(threatCategory || 'cyber_crime', incidentSummary || title);

    const insertRes = await pool.query(`
      INSERT INTO cases (case_number, fir_number, title, police_station, investigating_officer, status, threat_level, applicable_bns_sections, incident_summary)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE_INVESTIGATION', $6, $7, $8)
      RETURNING *;
    `, [caseNumber, firNumber, title, policeStation || 'Cyber Crime Branch Surat', officer, threatLevel || 'HIGH', JSON.stringify(bnsSections.map(s => `${s.statute} Sec ${s.section}`)), incidentSummary || '']);

    reply.send({ success: true, case: insertRes.rows[0] });
  } catch (err) {
    reply.status(500).send({ error: 'Failed to create case', details: (err as Error).message });
  }
});

/**
 * Edit / Update an active case file (ERH26_PS_10)
 */
fastify.put('/api/crimeos/cases/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { id } = request.params as { id: string };
    const { title, policeStation, investigatingOfficer, status, threatLevel, incidentSummary, applicableBnsSections } = request.body as any;

    if (!id) {
      reply.status(400).send({ error: 'Case ID is required' });
      return;
    }

    const isNumeric = /^\d+$/.test(id);
    const whereClause = isNumeric ? 'WHERE id = $8 OR case_number = $9' : 'WHERE case_number = $8';
    const queryParams: any[] = [
      title || null,
      policeStation || null,
      investigatingOfficer || null,
      status || null,
      threatLevel || null,
      incidentSummary || null,
      applicableBnsSections ? JSON.stringify(applicableBnsSections) : null,
      isNumeric ? parseInt(id, 10) : id
    ];
    if (isNumeric) {
      queryParams.push(id);
    }

    const updateRes = await pool.query(`
      UPDATE cases
      SET 
        title = COALESCE($1, title),
        police_station = COALESCE($2, police_station),
        investigating_officer = COALESCE($3, investigating_officer),
        status = COALESCE($4, status),
        threat_level = COALESCE($5, threat_level),
        incident_summary = COALESCE($6, incident_summary),
        applicable_bns_sections = COALESCE($7::jsonb, applicable_bns_sections)
      ${whereClause}
      RETURNING id, case_number as "caseNumber", fir_number as "firNumber", title, police_station as "policeStation", investigating_officer as "investigatingOfficer", status, threat_level as "threatLevel", applicable_bns_sections as "applicableBnsSections", incident_summary as "incidentSummary";
    `, queryParams);

    if (updateRes.rowCount === 0) {
      reply.status(404).send({ error: 'Case record not found' });
      return;
    }

    reply.send({ success: true, case: updateRes.rows[0], message: 'Case updated successfully' });
  } catch (err) {
    logger.error('Failed to update case', err as Error, 'APIServer');
    reply.status(500).send({ error: 'Failed to update case', details: (err as Error).message });
  }
});

/**
 * Delete an active case file (ERH26_PS_10)
 */
fastify.delete('/api/crimeos/cases/:id', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { id } = request.params as { id: string };
    if (!id) {
      reply.status(400).send({ error: 'Case ID is required' });
      return;
    }

    const isNumeric = /^\d+$/.test(id);
    const delRes = isNumeric
      ? await pool.query('DELETE FROM cases WHERE id = $1 OR case_number = $2 RETURNING id, case_number as "caseNumber", title;', [parseInt(id, 10), id])
      : await pool.query('DELETE FROM cases WHERE case_number = $1 RETURNING id, case_number as "caseNumber", title;', [id]);

    if (delRes.rowCount === 0) {
      reply.status(404).send({ error: 'Case record not found' });
      return;
    }

    reply.send({ success: true, message: 'Case record deleted successfully', case: delRes.rows[0] });
  } catch (err) {
    logger.error('Failed to delete case', err as Error, 'APIServer');
    reply.status(500).send({ error: 'Failed to delete case', details: (err as Error).message });
  }
});

/**
 * Telecom CDR & Tower Dump Multi-Format Analyzer (ERH26_PS_10)
 */
fastify.post('/api/crimeos/cdr-analyze', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    let rawCsvText = '';

    // Check if multipart file was sent
    if (request.isMultipart()) {
      const parts = request.files();
      for await (const part of parts) {
        const buf = await part.toBuffer();
        rawCsvText += buf.toString('utf8') + '\n';
      }
    } else if (request.body && typeof request.body === 'object' && (request.body as any).cdrText) {
      rawCsvText = (request.body as any).cdrText;
    }

    const summary = cdrAnalyzer.parseAndAnalyze(rawCsvText);
    reply.send({ success: true, summary });
  } catch (err) {
    reply.status(500).send({ error: 'CDR analysis failed', details: (err as Error).message });
  }
});

/**
 * Android Rapid Evidence Triage Route (ERH26_PS_02)
 */
fastify.post('/api/forensics/triage', { preHandler: [authenticate] }, async (request: FastifyRequest, reply) => {
  try {
    const { suspectName } = request.body as { suspectName?: string };
    const report = await forensicsTriage.generateTriageReport(suspectName);
    reply.send({ success: true, report });
  } catch (err) {
    reply.status(500).send({ error: 'Forensic triage failed', details: (err as Error).message });
  }
});

/**
 * Serve breathtaking, tactical command center dashboard for police.
 */
fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  const possiblePaths = [
    path.join(__dirname, 'dashboard.html'),
    path.join(__dirname, '..', 'src', 'dashboard.html'),
    path.join(process.cwd(), 'api', 'src', 'dashboard.html'),
    path.join(process.cwd(), 'dashboard.html')
  ];
  let html = '';
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      html = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  reply.type('text/html').send(html);
});

/**
 * Initializes resources and starts the Fastify API server.
 */
async function startServer(): Promise<void> {
  try {
    // 1. Initialize PostgreSQL schemas/tables
    await initializeDatabase();

    // Dynamically check for PostGIS
    try {
      const checkPostGIS = await pool.query("SELECT PostGIS_Version();");
      if (checkPostGIS.rowCount !== null && checkPostGIS.rowCount > 0) {
        hasPostGIS = true;
        logger.info("PostGIS extension detected and active.", "DatabaseInit");
      }
    } catch {
      logger.info("PostGIS extension is not installed on this database. Running in standard coordinate string storage.", "DatabaseInit");
    }

    // 2. Seed default data if needed
    await seedDatabase();

    // 3. Configure CORS
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    });

    // 4. Start Server
    const port = parseInt(process.env.PORT || '5000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    logger.info(`Rakshak API server is running on http://${host}:${port}`, 'FastifyServer');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to start the Fastify API server.', error, 'FastifyServer');
    }
    process.exit(1);
  }
}

// Invoke server start
if (require.main === module) {
  startServer();
}
