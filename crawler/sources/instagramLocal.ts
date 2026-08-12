import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { RawCrawledItem } from '../../shared-types/crawler';
import { logger } from '../../utils/logger';
import { proxyRotator } from './proxyRotator';

// Keywords for filtering
const SURAT_KEYWORDS = [
  "surat", "gujarat", "dumas", "vesu", "adajan", "varachha", "katargam",
  "rander", "smc", "rath yatra", "gopi talav", "chowk bazar", "chhakda",
  "locho", "ghari", "cold coco", "vip road", "surati", "gujaratis",
  "sarsana", "dindoli", "limbayat", "udhana", "palanpur", "bhatha",
  "police", "traffic", "accident", "emergency", "flood", "rain", "road"
];

function isPotentiallyRelevant(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return SURAT_KEYWORDS.some((kw) => lower.includes(kw));
}

function sanitizeCookies(cookies: any[]): any[] {
  return cookies.map((c) => {
    const cookie = { ...c };
    if ('id' in cookie) delete cookie.id;
    if (cookie.sameSite) {
      const ss = cookie.sameSite.toLowerCase();
      if (ss === 'strict') {
        cookie.sameSite = 'Strict';
      } else if (ss === 'lax') {
        cookie.sameSite = 'Lax';
      } else if (ss === 'none' || ss === 'no_restriction' || ss === 'unspecified') {
        cookie.sameSite = 'None';
      } else {
        delete cookie.sameSite;
      }
    }
    return cookie;
  });
}

export class InstagramScraper {
  private browser: Browser | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  public async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        logger.error('Failed to close Instagram browser', err as Error, 'InstagramScraper');
      }
      this.browser = null;
    }
  }

  public async scrape(
    mode: 'profile' | 'reels' | 'hashtag' | 'location' | 'explore_reels' | 'search',
    target: string,
    limit: number = 10,
    startDate?: string,
    endDate?: string,
    bypassKeywordFilter: boolean = false
  ): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    const cleanTag = target.replace(/[@#]/g, '').trim();

    // Strategy 1: Playwright Mobile Direct Connection (Fastest & most reliable)
    try {
      logger.info(`Starting live Instagram scrape (Direct Connection): target=${target}`, 'InstagramScraper');
      const directItems = await this.executePlaywrightScrape(mode, target, limit, bypassKeywordFilter, false);
      if (directItems.length > 0) {
        return directItems;
      }
    } catch (err) {
      logger.warn(`Playwright Direct connection failed: ${(err as Error).message}`, 'InstagramScraper');
    }

    // Strategy 2: Playwright Mobile with Proxy
    try {
      logger.info(`Playwright Direct failed or returned empty. Retrying with proxy: target=${target}`, 'InstagramScraper');
      const proxyItems = await this.executePlaywrightScrape(mode, target, limit, bypassKeywordFilter, true);
      if (proxyItems.length > 0) {
        return proxyItems;
      }
    } catch (err) {
      logger.warn(`Playwright Proxy retry failed: ${(err as Error).message}`, 'InstagramScraper');
    }

    // Strategy 3: DuckDuckGo OSINT Fallback index scraper (Guarantees real live URLs & captions under block/wall)
    try {
      logger.info(`Playwright blocked. Invoking DuckDuckGo OSINT fallback search index for target: "${target}"`, 'InstagramScraper');
      const fallbackItems = await this.scrapeViaSearchEngine(cleanTag, limit);
      if (fallbackItems.length > 0) {
        return fallbackItems;
      }
    } catch (err) {
      logger.error(`DuckDuckGo OSINT fallback scraper failed`, err as Error, 'InstagramScraper');
    }

    return items;
  }

  private async executePlaywrightScrape(
    mode: string,
    target: string,
    limit: number,
    bypassKeywordFilter: boolean,
    useProxy: boolean
  ): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;
    let context: any = null;

    try {
      const browser = await this.getBrowser();
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        viewport: { width: 390, height: 844 },
        locale: 'en-US'
      };

      if (useProxy) {
        const proxyConfig = proxyRotator.getNextProxy();
        if (proxyConfig) {
          contextOptions.proxy = proxyConfig;
          logger.info(`Using proxy: ${proxyConfig.server}`, 'InstagramScraper');
        }
      }

      context = await browser.newContext(contextOptions);

      // Load cookies if available
      const cookiesDir = path.resolve(__dirname, '../cookies');
      const cookiesPath = path.join(cookiesDir, 'instagram.json');
      if (fs.existsSync(cookiesPath)) {
        try {
          const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
          const sanitizedCookies = sanitizeCookies(rawCookies);
          await context.addCookies(sanitizedCookies);
        } catch (cookieErr) {
          logger.debug('No cookies loaded or cookie syntax error');
        }
      }

      page = await context.newPage();

      const urlsToVisit: string[] = [];
      const cleanTag = target.replace(/[@#]/g, '').trim();

      if (mode === 'reels') {
        urlsToVisit.push(`https://www.instagram.com/popular/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/explore/tags/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/${cleanTag}/reels/`);
      } else if (mode === 'explore_reels') {
        urlsToVisit.push(`https://www.instagram.com/popular/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/reels/`);
      } else if (mode === 'profile') {
        urlsToVisit.push(`https://www.instagram.com/${cleanTag}/reels/`);
        urlsToVisit.push(`https://www.instagram.com/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/popular/${cleanTag}/`);
      } else { // default explore & hashtag mode
        urlsToVisit.push(`https://www.instagram.com/popular/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/explore/tags/${cleanTag}/`);
        urlsToVisit.push(`https://www.instagram.com/${cleanTag}/reels/`);
        urlsToVisit.push(`https://www.instagram.com/${cleanTag}/`);
      }

      const seenUrls = new Set<string>();

      for (const targetUrl of urlsToVisit) {
        if (items.length >= limit) break;
        if (!page) continue;

        try {
          logger.info(`Visiting Instagram URL: ${targetUrl}`, 'InstagramScraper');
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
          await page.waitForTimeout(2000);

          const links = await page.locator('a').all();

          for (const link of links) {
            if (items.length >= limit) break;

            try {
              const href = await link.getAttribute('href');
              if (!href) continue;

              const match = href.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
              if (!match) continue;

              const isReel = match[1].startsWith('reel');
              const shortcode = match[2];
              if (!shortcode || shortcode === 'explore' || shortcode === 'tags' || shortcode === 'popular' || shortcode === 'reels') continue;

              const canonicalUrl = isReel
                ? `https://www.instagram.com/reel/${shortcode}/`
                : `https://www.instagram.com/p/${shortcode}/`;

              if (seenUrls.has(canonicalUrl)) continue;
              seenUrls.add(canonicalUrl);

              let text = '';
              const imgEl = link.locator('img');
              if (await imgEl.count() > 0) {
                text = (await imgEl.first().getAttribute('alt')) || '';
              }
              if (!text) {
                text = (await link.getAttribute('aria-label')) || '';
              }

              const cleanText = text.replace(/\s*Photo by.*on\s+\w+\s+\d+,\s+\d+\..*/gi, '').trim() ||
                (isReel ? `Instagram Reel regarding #${cleanTag}` : `Instagram Post regarding #${cleanTag}`);

              if (!bypassKeywordFilter && !isPotentiallyRelevant(cleanText) && mode !== 'profile' && mode !== 'reels' && mode !== 'hashtag' && mode !== 'search') {
                continue;
              }

              const crawledItem: RawCrawledItem = {
                id: `instagram_${shortcode}`,
                source: 'instagram',
                url: canonicalUrl,
                title: isReel ? `[REEL] #${cleanTag}` : `[POST] #${cleanTag}`,
                content: cleanText,
                author: cleanTag,
                publishedAt: new Date().toISOString(),
                crawledAt: new Date().toISOString(),
                metadata: {
                  likesCount: 0,
                  commentsCount: 0,
                  isVideo: true,
                  isReel,
                  mediaType: isReel ? 'reel' : 'post',
                  shortcode,
                  caption: cleanText,
                  directUrl: canonicalUrl
                }
              };

              items.push(crawledItem);
            } catch (errInner) {}
          }
        } catch (pageErr) {
          logger.debug(`Error checking URL: ${targetUrl}`);
        }
      }
    } finally {
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
    return items;
  }

  private async scrapeViaSearchEngine(query: string, limit: number): Promise<RawCrawledItem[]> {
    const results: RawCrawledItem[] = [];
    const seenUrls = new Set<string>();
    const axios = require('axios');

    const searchQueries = [
      `site:instagram.com/reel/ ${query}`,
      `site:instagram.com/p/ ${query}`
    ];

    for (const sq of searchQueries) {
      if (results.length >= limit) break;
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`;
        const res = await axios.get(ddgUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 6000
        });

        const html = res.data as string;
        const uddgMatches = [...html.matchAll(/uddg=([^&"]+)/g)];

        for (const m of uddgMatches) {
          if (results.length >= limit) break;
          const decodedUrl = decodeURIComponent(m[1]);
          const igMatch = decodedUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/);

          if (igMatch) {
            const type = igMatch[1];
            const shortcode = igMatch[2];
            if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'reels' || shortcode === 'popular') continue;

            const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
            if (seenUrls.has(canonicalUrl)) continue;
            seenUrls.add(canonicalUrl);

            const idx = html.indexOf(m[0]);
            let snippet = '';
            if (idx !== -1) {
              const surrounding = html.substring(Math.max(0, idx - 200), Math.min(html.length, idx + 400));
              snippet = surrounding.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }

            let author = 'instagram_creator';
            const authorMatch = snippet.match(/([A-Za-z0-9_.]+) on Instagram/i) || snippet.match(/@([A-Za-z0-9_.]+)/);
            if (authorMatch) {
              author = authorMatch[1];
            }

            const isReel = type === 'reel';
            const caption = snippet.length > 30 ? snippet.substring(0, 220) : `${isReel ? 'Instagram Reel' : 'Instagram Post'} on #${query}`;

            results.push({
              id: `instagram_${shortcode}`,
              source: 'instagram',
              url: canonicalUrl,
              title: isReel ? `[REEL] #${query}` : `[POST] #${query}`,
              content: caption,
              author,
              publishedAt: new Date().toISOString(),
              crawledAt: new Date().toISOString(),
              metadata: {
                isReel,
                mediaType: isReel ? 'reel' : 'post',
                shortcode,
                directUrl: canonicalUrl,
                caption
              }
            });
          }
        }
      } catch (err: any) {
        logger.debug(`DuckDuckGo fallback search match error: ${err.message}`);
      }
    }

    return results;
  }
}

export const instagramScraper = new InstagramScraper();
