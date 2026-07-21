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

  public async scrape(mode: 'profile' | 'hashtag' | 'location', target: string, limit: number = 5, startDate?: string, endDate?: string, bypassKeywordFilter: boolean = false): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Starting local Instagram scrape: mode=${mode}, target=${target}, limit=${limit}`, 'InstagramScraper');
      const browser = await this.getBrowser();
      
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US'
      };
      
      const proxyConfig = proxyRotator.getNextProxy();
      if (proxyConfig) {
        contextOptions.proxy = proxyConfig;
        logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'InstagramScraper');
      }

      const context = await browser.newContext(contextOptions);

      // Load cookies
      const cookiesDir = path.resolve(__dirname, '../cookies');
      if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
      }
      const cookiesPath = path.join(cookiesDir, 'instagram.json');
      if (fs.existsSync(cookiesPath)) {
        try {
          const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
          const sanitizedCookies = sanitizeCookies(rawCookies);
          await context.addCookies(sanitizedCookies);
          logger.info(`Loaded Instagram cookies from ${cookiesPath}`, 'InstagramScraper');
        } catch (cookieErr) {
          logger.error(`Error loading Instagram cookies`, cookieErr as Error, 'InstagramScraper');
        }
      } else {
        logger.warn(`No cookies file found at ${cookiesPath}. Scraping may fail due to login wall.`, 'InstagramScraper');
      }

      page = await context.newPage();

      let url = '';
      if (mode === 'profile') {
        const username = target.replace('@', '');
        url = `https://www.instagram.com/${username}/`;
      } else if (mode === 'hashtag') {
        const cleanTag = target.replace('#', '');
        url = `https://www.instagram.com/explore/tags/${cleanTag}/`;
      } else { // location mode
        url = `https://www.instagram.com/explore/locations/${target}/`;
      }

      logger.info(`Navigating to ${url}`, 'InstagramScraper');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check if redirected to login page
      if (page.url().includes('instagram.com/accounts/login')) {
        logger.error(`Instagram redirected to login page. Please ensure you have valid cookies in ${cookiesPath}`, new Error('Login wall hit'), 'InstagramScraper');
        return [];
      }

      // Wait for posts to render
      await page.waitForSelector('a[href*="/p/"], a[href*="/reel/"]', { timeout: 15000 }).catch(() => {
        logger.debug('Timeout waiting for post elements to render.', 'InstagramScraper');
      });

      // Select links that point to posts/reels
      const postLinks = await page.locator('a[href*="/p/"], a[href*="/reel/"]').all();
      logger.info(`Found ${postLinks.length} post elements on page. Commencing parsing...`, 'InstagramScraper');

      const seenUrls = new Set<string>();
      let count = 0;

      for (const link of postLinks) {
        if (count >= limit) break;

        try {
          const href = await link.getAttribute('href');
          if (!href) continue;

          const postUrl = `https://www.instagram.com${href}`;
          if (seenUrls.has(postUrl)) continue;
          seenUrls.add(postUrl);

          // Get the caption text from the nested img alt attribute
          const imgEl = link.locator('img');
          let text = '';
          if (await imgEl.count() > 0) {
            text = (await imgEl.first().getAttribute('alt')) || '';
          }

          // Clean Instagram caption fluff (alt text often appends photo details like "Photo by X on Y")
          const cleanText = text.replace(/\s*Photo by.*on\s+\w+\s+\d+,\s+\d+\..*/gi, '').trim();

          if (!cleanText) {
            logger.debug(`Skipping post ${href}: caption text is empty.`, 'InstagramScraper');
            continue;
          }

          if (!bypassKeywordFilter && !isPotentiallyRelevant(cleanText)) {
            continue;
          }

          // Extract shortcode/ID
          const pathParts = href.split('/').filter(Boolean);
          const shortcode = pathParts[pathParts.length - 1] || 'post';

          // Construct RawCrawledItem
          const crawledItem: RawCrawledItem = {
            id: `instagram_${shortcode}`,
            source: 'instagram',
            url: postUrl,
            title: cleanText.length > 80 ? cleanText.substring(0, 80) + '...' : cleanText,
            content: cleanText,
            author: mode === 'profile' ? target.replace('@', '') : 'instagram_user',
            publishedAt: new Date().toISOString(), // Fallback since IG grid doesn't expose post date directly
            crawledAt: new Date().toISOString(),
            metadata: {
              likesCount: 0, // Fallback placeholder
              commentsCount: 0,
              isVideo: href.includes('/reel/'),
              caption: cleanText
            }
          };

          items.push(crawledItem);
          count++;
        } catch (itemErr) {
          logger.error('Failed to parse individual Instagram post', itemErr as Error, 'InstagramScraper');
        }
      }
    } catch (err) {
      logger.error(`Instagram scraper failed`, err as Error, 'InstagramScraper');
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
    return items;
  }
}

export const instagramScraper = new InstagramScraper();
