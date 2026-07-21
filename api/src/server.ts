import Fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyError } from 'fastify';
import cors from '@fastify/cors';
import bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { logger } from '../../utils/logger';
import { pool, initializeDatabase } from '../../database/connection';
import { registerSchema, loginSchema } from '../../validation/auth';
import { signToken } from '../../auth/jwt';
import { authenticate } from '../../auth/middleware';
import { ApiResponse } from '../../shared-types/api';
import { User, UserJWTPayload } from '../../shared-types/user';

// Import local scrapers
import { redditScraper } from '../../crawler/sources/reddit';
import { telegramScraper } from '../../crawler/sources/telegram';
import { instagramScraper } from '../../crawler/sources/instagramLocal';
import { twitterScraper } from '../../crawler/sources/twitterLocal';
import { youtubeScraper } from '../../crawler/sources/youtubeLocal';
import { facebookScraper } from '../../crawler/sources/facebookLocal';
import { RawCrawledItem } from '../../shared-types/crawler';

dotenv.config();

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

  if (geminiKey) {
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
      alerts.push(`"${item.title}" from @${item.author}`);
    }
    // Spot locations
    ['vesu', 'adajan', 'varachha', 'katargam', 'rander', 'chowk bazar'].forEach((loc) => {
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

      // 1. Hash the password securely
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // 2. Insert the user record into PostgreSQL
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

      // 3. Generate token
      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`Successfully registered user: ${username} with role: ${finalRole}`, 'AuthHandler');

      const response: ApiResponse<{ user: User; token: string }> = {
        success: true,
        message: 'Registration successful.',
        data: { user, token },
      };

      reply.status(201).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        const err = error as any;
        // Catch unique violation error code (23505) in PostgreSQL
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
      } else {
        logger.error('Failed to register new user due to an unknown error.', new Error(String(error)), 'AuthHandler');
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

      // 1. Fetch user by username
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

      // 2. Verify password match
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

      // 3. Generate Token
      const jwtPayload: UserJWTPayload = {
        id: user.id,
        username: user.username,
        role: user.role,
      };
      const token = signToken(jwtPayload);

      logger.info(`User logged in successfully: ${username}`, 'AuthHandler');

      const response: ApiResponse<{ user: User; token: string }> = {
        success: true,
        message: 'Login successful.',
        data: { user, token },
      };

      reply.status(200).send(response);
    } catch (error: unknown) {
      if (error instanceof Error) {
        logger.error('Error executing user login query.', error, 'AuthHandler');
      } else {
        logger.error('Error executing user login query with unknown error.', new Error(String(error)), 'AuthHandler');
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
    // request.user is set by the authenticate middleware
    const response: ApiResponse<{ user: UserJWTPayload }> = {
      success: true,
      data: {
        user: request.user!,
      },
    };
    reply.status(200).send(response);
  }
);

/**
 * On-demand targeted crawler endpoint.
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

  logger.info(`API Request: Extracting target "${target}" from platform "${platform}"`, 'APIServer');

  try {
    let items: RawCrawledItem[] = [];
    const runLimit = typeof limit === 'string' ? parseInt(limit, 10) : limit;
    const runDepth = typeof depth === 'string' ? parseInt(depth, 10) : depth;

    switch (platform.toLowerCase()) {
      case 'reddit':
        items = await redditScraper.scrape(target, runLimit, extractComments, startDate, endDate);
        break;

      case 'telegram':
        items = await telegramScraper.scrape(target, runLimit, startDate, endDate);
        break;

      case 'instagram':
        const igMode = mode === 'hashtag' ? 'hashtag' : mode === 'location' ? 'location' : 'profile';
        items = await instagramScraper.scrape(igMode, target, runLimit, startDate, endDate, true);
        break;

      case 'twitter':
      case 'x':
        const twMode = mode === 'hashtag' ? 'hashtag' : mode === 'location' ? 'location' : mode === 'handle' ? 'handle' : 'search';
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

    const filteredItems = filterByDateRange(items, startDate, endDate);
    logger.info(`API Response: Successfully extracted and returned ${filteredItems.length} items.`, 'APIServer');
    
    const summary = await generateOSINTSummary(filteredItems);
    
    reply.send({
      success: true,
      platform,
      target,
      count: filteredItems.length,
      summary,
      data: filteredItems
    });

  } catch (error) {
    logger.error('API Crawler extraction failed', error as Error, 'APIServer');
    reply.status(500).send({
      error: 'Crawler extraction failed',
      details: (error as Error).message
    });
  }
});

/**
 * Serve static single-page control panel dashboard directly at root.
 */
fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
  const PORT = process.env.PORT || '5000';
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🛡️ Rakshak AI - Targeted OSINT Crawler Control Panel</title>
      <!-- Google Fonts -->
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet">
      <!-- Tailwind CSS -->
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          theme: {
            extend: {
              fontFamily: {
                sans: ['Outfit', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
              }
            }
          }
        }
      </script>
      <style>
        body {
          background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
          font-family: 'Outfit', sans-serif;
          min-height: 100vh;
        }
        .glass {
          background: rgba(30, 41, 59, 0.45);
          backdrop-filter: blur(16px);
          border: 1px rgba(255, 255, 255, 0.08) solid;
        }
        .glow-cyan {
          box-shadow: 0 0 15px rgba(6, 182, 212, 0.25);
        }
        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        ::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.2);
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.15);
          border-radius: 4px;
        }
      </style>
    </head>
    <body class="text-slate-100 p-4 md:p-8">
      <div class="max-w-7xl mx-auto space-y-6">
        
        <!-- Header -->
        <header class="flex flex-col md:flex-row justify-between items-start md:items-center p-6 glass rounded-2xl glow-cyan space-y-4 md:space-y-0">
          <div class="flex items-center space-x-4">
            <div class="bg-cyan-500/10 p-3 rounded-xl border border-cyan-500/30 text-cyan-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="4 4" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 009 11m-6.311 4c.485.498 1.248.88 2.022.923M12 11c0-3.517 1.009-6.799 2.753-9.571m3.44 2.04l-.054.09A13.916 13.916 0 0015 11m6.311-4a8.17 8.17 0 01-2.022-.923M12 11a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h1 class="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                Rakshak AI <span class="text-xs bg-cyan-500/20 text-cyan-300 font-semibold px-2 py-0.5 rounded border border-cyan-500/30">OSINT CONTROL</span>
              </h1>
              <p class="text-slate-400 text-sm">Targeted Social Media Ingestion Control Panel</p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <span class="w-3.5 h-3.5 bg-emerald-500 rounded-full animate-pulse"></span>
            <span class="text-slate-300 text-sm font-semibold tracking-wider font-mono">BACKEND ACTIVE : PORT \${PORT}</span>
          </div>
        </header>

        <!-- Main Body Grid -->
        <main class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          <!-- Parameters Control Form -->
          <section class="lg:col-span-1 glass p-6 rounded-2xl flex flex-col space-y-5">
            <h2 class="text-lg font-semibold text-white border-b border-slate-700/50 pb-2 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Extraction Controls
            </h2>
            
            <form id="crawlerForm" class="space-y-4 flex-1">
              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Platform Selection</label>
                <select id="platform" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-medium">
                  <option value="reddit">Reddit</option>
                  <option value="twitter">X / Twitter</option>
                  <option value="instagram">Instagram</option>
                  <option value="telegram">Telegram</option>
                  <option value="youtube">YouTube</option>
                  <option value="facebook">Facebook Pages</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Search Parameter Mode</label>
                <select id="mode" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-medium">
                  <option value="search">Keyword / Search Query</option>
                  <option value="profile">Profile / Handle</option>
                  <option value="hashtag">Hashtag (#)</option>
                  <option value="location">Geospatial / Location ID</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Search Target / Input</label>
                <input type="text" id="target" placeholder="e.g. Surat, @SuratPolice, or coordinates" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono text-sm" required>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Post Limit</label>
                  <input type="number" id="limit" value="10" min="1" max="100" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm">
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Scroll Depth</label>
                  <input type="number" id="depth" value="2" min="1" max="10" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500 font-mono text-sm">
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Start Date</label>
                  <input type="date" id="startDate" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 text-sm">
                </div>
                <div>
                  <label class="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">End Date</label>
                  <input type="date" id="endDate" class="w-full bg-slate-900/80 border border-slate-700/50 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-cyan-500 text-sm">
                </div>
              </div>

              <div class="flex items-center space-x-3 pt-2">
                <input type="checkbox" id="extractComments" class="w-4 h-4 bg-slate-900 border-slate-700 rounded text-cyan-500 focus:ring-cyan-500">
                <label for="extractComments" class="text-sm text-slate-300 font-semibold select-none">Extract Nested Comments (Reddit)</label>
              </div>

              <button type="submit" id="submitBtn" class="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-600 hover:to-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition duration-150 transform active:scale-95 shadow-lg flex items-center justify-center gap-2">
                <span id="btnText">EXECUTE CRAWL TASK</span>
                <div id="loader" class="hidden w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              </button>
            </form>
          </section>

          <!-- Terminal Logs & Ingested Data -->
          <section class="lg:col-span-2 flex flex-col space-y-6">
            
            <!-- Terminal Logs window -->
            <div class="glass p-5 rounded-2xl flex flex-col h-64">
              <h3 class="text-sm font-semibold text-slate-300 mb-2 font-mono flex items-center justify-between border-b border-slate-700/50 pb-2">
                <span>>_ LIVE EXTRACTION LOGS</span>
                <span class="text-xs text-slate-500">Playwright output streams</span>
              </h3>
              <div id="terminal" class="flex-1 bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 font-mono text-xs text-cyan-400 overflow-y-auto leading-relaxed space-y-1">
                <div class="text-slate-500">System initialized. Awaiting targeted extraction task parameters...</div>
              </div>
            </div>

            <!-- Ingested Results list -->
            <div class="glass p-6 rounded-2xl flex-1 flex flex-col min-h-[400px]">
              <div class="flex justify-between items-center border-b border-slate-700/50 pb-3 mb-4">
                <h3 class="text-lg font-semibold text-white flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5.5 w-5.5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  Ingested Intelligence Data
                </h3>
                <div class="flex items-center space-x-2">
                  <button id="exportCsvBtn" class="hidden px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg border border-slate-700/50 transition">Export CSV</button>
                  <button id="exportJsonBtn" class="hidden px-3.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-lg border border-slate-700/50 transition">Export JSON</button>
                  <span id="resultCount" class="bg-cyan-500/20 text-cyan-400 text-xs px-2.5 py-1 rounded font-bold border border-cyan-500/30">0 items</span>
                </div>
              </div>

              <!-- Intelligence Briefing Card -->
              <div id="briefingCard" class="hidden mb-4 p-5 bg-gradient-to-br from-indigo-950/50 to-slate-900/60 border border-cyan-500/20 rounded-xl space-y-2">
                <h4 class="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                  <span class="w-2 h-2 bg-cyan-400 rounded-full animate-pulse"></span>
                  Intelligence Briefing (OSINT Analyst Brief)
                </h4>
                <div id="briefingContent" class="text-xs text-slate-300 space-y-1.5 leading-relaxed prose prose-invert"></div>
              </div>

              <!-- Results Box -->
              <div id="resultsWrapper" class="flex-1 overflow-y-auto max-h-[500px] space-y-4 pr-1">
                <div class="flex flex-col items-center justify-center h-full py-20 text-slate-500 text-center space-y-2">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                  <div class="text-sm font-medium">No active extraction results</div>
                  <div class="text-xs max-w-xs">Run a targeted crawl using the left control form to extract public safety metrics in real-time.</div>
                </div>
              </div>
            </div>

          </section>

        </main>
      </div>

      <script>
        const form = document.getElementById('crawlerForm');
        const submitBtn = document.getElementById('submitBtn');
        const btnText = document.getElementById('btnText');
        const loader = document.getElementById('loader');
        const terminal = document.getElementById('terminal');
        const resultsWrapper = document.getElementById('resultsWrapper');
        const resultCount = document.getElementById('resultCount');
        const exportCsvBtn = document.getElementById('exportCsvBtn');
        const exportJsonBtn = document.getElementById('exportJsonBtn');
        const briefingCard = document.getElementById('briefingCard');
        const briefingContent = document.getElementById('briefingContent');

        let currentData = [];

        function formatMarkdown(text) {
          if (!text) return '';
          const boldRegex = new RegExp('\\\\\\\\*\\\\\\\\*(.*?)\\\\\\\\*\\\\\\\\*', 'g');
          const bulletRegex = new RegExp('\\\\\\\\* (.*?)\\\\\\\\n', 'g');
          const newlineRegex = new RegExp('\\\\\\\\n', 'g');
          return text
            .replace(boldRegex, '<strong>$1</strong>')
            .replace(bulletRegex, '<li class="ml-4 list-disc">$1</li>')
            .replace(newlineRegex, '<br/>');
        }

        function appendLog(message, type = 'info') {
          const div = document.createElement('div');
          const time = new Date().toLocaleTimeString();
          div.className = type === 'error' ? 'text-red-400' : type === 'success' ? 'text-emerald-400' : 'text-cyan-400';
          div.innerHTML = \`<span class="text-slate-500">[\${time}]</span> \${message}\`;
          terminal.appendChild(div);
          terminal.scrollTop = terminal.scrollHeight;
        }

        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const platform = document.getElementById('platform').value;
          const mode = document.getElementById('mode').value;
          const target = document.getElementById('target').value;
          const limit = document.getElementById('limit').value;
          const depth = document.getElementById('depth').value;
          const startDate = document.getElementById('startDate').value;
          const endDate = document.getElementById('endDate').value;
          const extractComments = document.getElementById('extractComments').checked;

          // Start visual loader
          submitBtn.disabled = true;
          btnText.textContent = "EXTRACTING DATA...";
          loader.classList.remove('hidden');

          appendLog(\`Task initialized. Platform: \${platform.toUpperCase()} | Target: "\${target}"...\\n\`);
          appendLog(\`Launching local headless browser wrapper context...\\n\`);

          try {
            const response = await fetch('/api/crawler/extract', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ platform, mode, target, limit, depth, startDate, endDate, extractComments })
            });

            const result = await response.json();

            if (!response.ok) {
              throw new Error(result.error || result.details || 'Server error');
            }

            currentData = result.data || [];
            appendLog(\`Extraction completed! Retrieved \${currentData.length} records.\\n\`, 'success');

            // Render Results
            renderResults(currentData);

            if (result.summary) {
              briefingContent.innerHTML = formatMarkdown(result.summary);
              briefingCard.classList.remove('hidden');
            } else {
              briefingCard.classList.add('hidden');
            }

          } catch (err) {
            appendLog(\`Task failed: \${err.message}\\n\`, 'error');
            alert(\`Extraction Failed: \${err.message}\`);
          } finally {
            submitBtn.disabled = false;
            btnText.textContent = "EXECUTE CRAWL TASK";
            loader.classList.add('hidden');
          }
        });

        function renderResults(data) {
          resultCount.textContent = \`\${data.length} items\`;

          if (data.length === 0) {
            resultsWrapper.innerHTML = \`
              <div class="text-slate-500 text-center py-20 text-sm">No items found matching the target filters.</div>
            \`;
            exportCsvBtn.classList.add('hidden');
            exportJsonBtn.classList.add('hidden');
            return;
          }

          exportCsvBtn.classList.remove('hidden');
          exportJsonBtn.classList.remove('hidden');

          resultsWrapper.innerHTML = data.map((item, idx) => {
            const date = new Date(item.publishedAt).toLocaleString();
            const hasComments = item.metadata && item.metadata.comments && item.metadata.comments.length > 0;

            return \`
              <div class="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3 hover:border-slate-700/60 transition">
                <div class="flex justify-between items-start">
                  <div>
                    <span class="text-xs font-semibold px-2 py-0.5 bg-indigo-500/20 text-indigo-300 border border-indigo-500/20 rounded-md uppercase font-mono">\${item.source}</span>
                    <span class="text-xs text-slate-400 font-semibold ml-2">Author: @\${item.author}</span>
                  </div>
                  <span class="text-xs font-mono text-slate-500">\${date}</span>
                </div>
                <div>
                  <h4 class="text-sm font-semibold text-white mb-1">\${item.title}</h4>
                  <p class="text-xs text-slate-300 leading-relaxed font-sans">\${item.content}</p>
                </div>
                <div class="flex items-center justify-between border-t border-slate-800/80 pt-3 text-slate-400 text-xs">
                  <div class="flex items-center space-x-4">
                    <span>Likes/Upvotes: <strong>\${item.metadata.likesCount || item.metadata.upvotes || 0}</strong></span>
                    <span>Replies/Comments: <strong>\${item.metadata.commentsCount || 0}</strong></span>
                  </div>
                  <a href="\${item.url}" target="_blank" class="text-cyan-400 hover:underline">View original post ➡️</a>
                </div>
                \${hasComments ? \`
                  <div class="mt-3 bg-slate-950/80 border border-slate-800 rounded-lg p-3 space-y-2">
                    <h5 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800/80 pb-1 flex items-center gap-1">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
                      Extracted Comment Thread
                    </h5>
                    <div class="space-y-2 max-h-40 overflow-y-auto pr-1">
                      \${item.metadata.comments.map(c => \`
                        <div class="text-[11px] leading-relaxed">
                          <span class="font-semibold text-cyan-300">@\${c.author}</span>: 
                          <span class="text-slate-300">\${c.text}</span>
                        </div>
                      \`).join('')}
                    </div>
                  </div>
                \` : ''}
              </div>
            \`;
          }).join('');
        }

        exportJsonBtn.addEventListener('click', () => {
          const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentData, null, 2));
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute("href", dataStr);
          downloadAnchor.setAttribute("download", "extracted_osint_data.json");
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
        });

        exportCsvBtn.addEventListener('click', () => {
          let csvContent = "data:text/csv;charset=utf-8,";
          csvContent += "ID,Platform,Author,PublishedAt,Title,Content,URL\\n";

          currentData.forEach(item => {
            const row = [
              item.id,
              item.source,
              item.author,
              item.publishedAt,
              \`"\${item.title.replace(/"/g, '""')}"\`,
              \`"\${item.content.replace(/"/g, '""')}"\`,
              item.url
            ].join(",");
            csvContent += row + "\\n";
          });

          const encodedUri = encodeURI(csvContent);
          const downloadAnchor = document.createElement('a');
          downloadAnchor.setAttribute("href", encodedUri);
          downloadAnchor.setAttribute("download", "extracted_osint_data.csv");
          document.body.appendChild(downloadAnchor);
          downloadAnchor.click();
          downloadAnchor.remove();
        });
      </script>
    </body>
    </html>
  `;
  reply.type('text/html').send(html);
});

/**
 * Initializes resources and starts the Fastify API server.
 */
async function startServer(): Promise<void> {
  try {
    // 1. Initialize PostgreSQL schemas/tables
    await initializeDatabase();

    // 2. Configure CORS
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    });

    // 3. Start Server
    const port = parseInt(process.env.PORT || '5000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await fastify.listen({ port, host });
    logger.info(`Rakshak API server is running on http://${host}:${port}`, 'FastifyServer');
  } catch (error: unknown) {
    if (error instanceof Error) {
      logger.error('Failed to start the Fastify API server.', error, 'FastifyServer');
    } else {
      logger.error('Failed to start the Fastify API server with unknown error.', new Error(String(error)), 'FastifyServer');
    }
    process.exit(1);
  }
}

// Invoke server start
if (require.main === module) {
  startServer();
}
