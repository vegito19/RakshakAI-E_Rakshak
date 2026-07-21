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

function parseStats(val: string | null): number {
  if (!val) return 0;
  const match = val.match(/\d+(\.\d+)?[KM]?/i);
  if (!match) return 0;
  const numStr = match[0].toUpperCase();
  if (numStr.endsWith('K')) {
    return Math.round(parseFloat(numStr.replace('K', '')) * 1000);
  }
  if (numStr.endsWith('M')) {
    return Math.round(parseFloat(numStr.replace('M', '')) * 1000000);
  }
  return Math.round(parseFloat(numStr));
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

export class TwitterScraper {
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
        logger.error('Failed to close Twitter browser', err as Error, 'TwitterScraper');
      }
      this.browser = null;
    }
  }

  public async scrape(mode: 'handle' | 'hashtag' | 'search' | 'location', target: string, limit: number = 5, startDate?: string, endDate?: string, bypassKeywordFilter: boolean = false): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Starting local Twitter scrape: mode=${mode}, target=${target}, limit=${limit}`, 'TwitterScraper');
      const browser = await this.getBrowser();
      
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US'
      };

      const proxyConfig = proxyRotator.getNextProxy();
      if (proxyConfig) {
        contextOptions.proxy = proxyConfig;
        logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'TwitterScraper');
      }

      const context = await browser.newContext(contextOptions);

      // Load cookies
      const cookiesDir = path.resolve(__dirname, '../cookies');
      if (!fs.existsSync(cookiesDir)) {
        fs.mkdirSync(cookiesDir, { recursive: true });
      }
      const cookiesPath = path.join(cookiesDir, 'twitter.json');
      if (fs.existsSync(cookiesPath)) {
        try {
          const rawCookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
          const sanitizedCookies = sanitizeCookies(rawCookies);
          await context.addCookies(sanitizedCookies);
          logger.info(`Loaded Twitter cookies from ${cookiesPath}`, 'TwitterScraper');
        } catch (cookieErr) {
          logger.error(`Error loading Twitter cookies`, cookieErr as Error, 'TwitterScraper');
        }
      } else {
        logger.warn(`No cookies file found at ${cookiesPath}. Scraping may fail due to login wall.`, 'TwitterScraper');
      }

      page = await context.newPage();

      let url = '';
      if (mode === 'handle') {
        const username = target.replace('@', '');
        url = `https://x.com/${username}`;
      } else if (mode === 'location' || /^\-?\d+(\.\d+)?,?\s*\-?\d+(\.\d+)?$/.test(target)) {
        const cleanGeo = target.replace(/\s+/g, '');
        url = `https://x.com/search?q=${encodeURIComponent(`geocode:${cleanGeo},10km`)}&f=live`;
      } else {
        const query = mode === 'hashtag' && !target.startsWith('#') ? `#${target}` : target;
        url = `https://x.com/search?q=${encodeURIComponent(query)}&f=live`;
      }

      logger.info(`Navigating to ${url}`, 'TwitterScraper');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Check if redirected to login page
      if (page.url().includes('x.com/i/flow/login') || page.url().includes('twitter.com/i/flow/login')) {
        logger.error(`Twitter redirected to login page. Please ensure you have valid cookies in ${cookiesPath}`, new Error('Login wall hit'), 'TwitterScraper');
        return [];
      }

      // Wait for tweet elements to render
      await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 }).catch(() => {
        logger.debug('Timeout waiting for tweet elements to render.', 'TwitterScraper');
      });

      // Locate tweet articles
      const articles = await page.locator('article[data-testid="tweet"]').all();
      logger.info(`Found ${articles.length} tweets on page. Commencing parsing...`, 'TwitterScraper');

      for (const article of articles) {
        if (items.length >= limit) break;
        try {
          // Extract Text
          const textEl = article.locator('[data-testid="tweetText"]');
          const text = (await textEl.count()) > 0 ? await textEl.innerText() : '';

          if (!text) continue;
          if (!bypassKeywordFilter && !isPotentiallyRelevant(text)) continue;

          // Extract Status Link / ID
          const timeLinkEl = article.locator('time').locator('..');
          const href = (await timeLinkEl.count()) > 0 ? await timeLinkEl.getAttribute('href') : null;
          if (!href || !href.includes('/status/')) continue;

          const parts = href.split('/');
          const author = parts[1];
          const tweetId = parts[3];
          const postUrl = `https://x.com${href}`;

          // Extract Published Date
          const timeEl = article.locator('time');
          const publishedAt = (await timeEl.count()) > 0 
            ? (await timeEl.getAttribute('datetime')) || new Date().toISOString()
            : new Date().toISOString();

          const pubTime = new Date(publishedAt).getTime();
          if (startDate) {
            const start = new Date(startDate).getTime();
            if (pubTime < start) {
              logger.debug(`Twitter: Skipping tweet older than start date (${startDate})`, 'TwitterScraper');
              continue;
            }
          }
          if (endDate) {
            const end = new Date(endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z').getTime();
            if (pubTime > end) {
              logger.debug(`Twitter: Skipping tweet newer than end date (${endDate})`, 'TwitterScraper');
              continue;
            }
          }

          // Extract Engagement stats from buttons / divs
          const replyEl = article.locator('[data-testid="reply"]');
          const replyText = (await replyEl.count()) > 0 
            ? (await replyEl.getAttribute('aria-label')) || (await replyEl.innerText()) 
            : '0';
          const replyCount = parseStats(replyText);

          const retweetEl = article.locator('[data-testid="retweet"]');
          const retweetText = (await retweetEl.count()) > 0 
            ? (await retweetEl.getAttribute('aria-label')) || (await retweetEl.innerText()) 
            : '0';
          const retweetCount = parseStats(retweetText);

          const likeEl = article.locator('[data-testid="like"]');
          const likeText = (await likeEl.count()) > 0 
            ? (await likeEl.getAttribute('aria-label')) || (await likeEl.innerText()) 
            : '0';
          const likeCount = parseStats(likeText);

          // Construct RawCrawledItem
          const crawledItem: RawCrawledItem = {
            id: `twitter_${tweetId}`,
            source: 'twitter',
            url: postUrl,
            title: text.length > 80 ? text.substring(0, 80) + '...' : text,
            content: text,
            author,
            publishedAt,
            crawledAt: new Date().toISOString(),
            metadata: {
              retweetCount,
              likeCount,
              replyCount,
              lang: await article.locator('[data-testid="tweetText"]').getAttribute('lang') || 'en'
            }
          };
          items.push(crawledItem);
        } catch (itemErr) {
          logger.error('Failed to parse individual tweet', itemErr as Error, 'TwitterScraper');
        }
      }
    } catch (err) {
      logger.error(`Twitter scraper failed`, err as Error, 'TwitterScraper');
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
    return items;
  }
}

export const twitterScraper = new TwitterScraper();
