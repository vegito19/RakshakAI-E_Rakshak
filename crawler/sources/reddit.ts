import { chromium, Browser, Page } from 'playwright';
import { RawCrawledItem, RedditMetadata } from '../../shared-types/crawler';
import { logger } from '../../utils/logger';
import { proxyRotator } from './proxyRotator';

export class RedditScraper {
  private browser: Browser | null = null;
  private lastNavigationTime = 0;

  /**
   * Initializes or returns the existing Playwright browser instance.
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security'
        ]
      });
    }
    return this.browser;
  }

  /**
   * Closes the Playwright browser instance if it is open.
   */
  public async close(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        logger.info('Playwright browser closed successfully.', 'RedditScraper');
      }
    } catch (error) {
      logger.error('Failed to close browser.', error as Error, 'RedditScraper');
    }
  }

  /**
   * Scrapes a specific subreddit's new posts list.
   * @param subreddit Name of the subreddit (e.g. "surat")
   * @param limit Maximum number of posts to fetch (default: 25)
   * @param extractComments Whether to fetch top comments for each post
   * @returns Array of raw crawled items mapped strictly to schema definitions
   */
  public async scrape(subreddit: string, limit: number = 25, extractComments: boolean = false, startDate?: string, endDate?: string): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Initiating scrape for r/${subreddit} with limit: ${limit}`, 'RedditScraper', { subreddit, limit });
      const browser = await this.getBrowser();
      
      // Setup browser context with stealth and optional proxy options
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/124.0.0.0',
        locale: 'en-US',
        viewport: { width: 1280, height: 1000 }
      };

      const proxyConfig = proxyRotator.getNextProxy();
      if (proxyConfig) {
        contextOptions.proxy = proxyConfig;
        logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'RedditScraper');
      }

      const context = await browser.newContext(contextOptions);

      page = await context.newPage();

      // Stealth injections to bypass basic bot checks
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      // Navigation & Profile/Target Switching Delays (120 to 300 seconds spacing)
      const now = Date.now();
      if (this.lastNavigationTime > 0) {
        const elapsed = (now - this.lastNavigationTime) / 1000;
        const requiredDelay = Math.random() * (300 - 120) + 120; // 120 to 300 seconds
        if (elapsed < requiredDelay) {
          const waitTime = requiredDelay - elapsed;
          logger.info(`Spacing target switching. Waiting for ${waitTime.toFixed(2)} seconds...`, 'RedditScraper');
          await page.waitForTimeout(waitTime * 1000);
        }
      }
      this.lastNavigationTime = Date.now();

      const url = `https://www.reddit.com/r/${subreddit}/new/`;
      logger.debug(`Navigating to target Reddit URL: ${url}`, 'RedditScraper');
      
      // Navigate and wait for DOM load
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && (response.status() === 403 || response.status() === 429)) {
        logger.warn(`Encountered HTTP ${response.status()} block. Circuit breaker active: halting for 1800 seconds...`, 'RedditScraper');
        await page.waitForTimeout(1800 * 1000);
        throw new Error(`Reddit security blocked request with status: ${response.status()}`);
      }

      // Check for "Try Again Later" rate limit modal/content
      const bodyText = await page.innerText('body');
      if (bodyText.includes('Try Again Later') || bodyText.includes('try again later')) {
        logger.warn('Encountered "Try Again Later" rate limit. Circuit breaker active: halting for 1800 seconds...', 'RedditScraper');
        await page.waitForTimeout(1800 * 1000);
        throw new Error('Reddit rate limit encountered: Try Again Later');
      }

      // Wait a few seconds for lazy loaded items and GraphQL API requests to settle
      logger.debug('Waiting for dynamic feed content to render...', 'RedditScraper');
      await page.waitForTimeout(8000);

      const pageTitle = await page.title();
      if (pageTitle.includes('Blocked') || pageTitle.includes('Access Denied')) {
        logger.warn('Encountered block in page title. Circuit breaker active: halting for 1800 seconds...', 'RedditScraper');
        await page.waitForTimeout(1800 * 1000);
        throw new Error(`Reddit bot detection blocked page access. Title: ${pageTitle}`);
      }

      // Locate shreddit-post elements (Modern Reddit post container)
      const postElements = await page.locator('shreddit-post').all();
      logger.info(`Found ${postElements.length} post containers in r/${subreddit}`, 'RedditScraper');

      for (const element of postElements) {
        if (items.length >= limit) break;
        try {
          // Human Behavioral Emulation: Micro-scroll (100-300px) with randomized offsets
          await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 200) + 100));
          // Action-Level Delay after scroll (4.5 to 9.2 seconds)
          await page.waitForTimeout((Math.random() * (9.2 - 4.5) + 4.5) * 1000);

          // Human Behavioral Emulation: Smooth mouse movement to the element's bounding box
          const box = await element.boundingBox();
          if (box) {
            const steps = 6;
            const startX = Math.random() * 1280;
            const startY = Math.random() * 1000;
            const targetX = box.x + box.width / 2 + (Math.random() * 30 - 15);
            const targetY = box.y + box.height / 2 + (Math.random() * 30 - 15);
            for (let i = 1; i <= steps; i++) {
              const x = startX + (targetX - startX) * (i / steps);
              const y = startY + (targetY - startY) * (i / steps);
              await page.mouse.move(x, y);
              await page.waitForTimeout(20 + Math.random() * 30);
            }
          }

          // Human Behavioral Emulation: Linger over post element prior to extracting (1.5 to 3.5 seconds)
          await page.waitForTimeout((Math.random() * (3.5 - 1.5) + 1.5) * 1000);

          const id = await element.getAttribute('id');
          if (!id) {
            logger.debug('Skipping element: missing id attribute.', 'RedditScraper');
            continue;
          }

          const postTitle = await element.getAttribute('post-title') || '';
          const permalink = await element.getAttribute('permalink') || '';
          const postUrl = permalink ? `https://www.reddit.com${permalink}` : (await element.getAttribute('content-href') || '');
          const author = await element.getAttribute('author') || '[deleted]';
          const scoreStr = await element.getAttribute('score') || '0';
          const commentCountStr = await element.getAttribute('comment-count') || '0';
          const createdTimestamp = await element.getAttribute('created-timestamp') || new Date().toISOString();
          const pubTime = new Date(createdTimestamp).getTime();

          if (startDate) {
            const start = new Date(startDate).getTime();
            if (pubTime < start) {
              logger.debug(`Reddit: Skipping post older than start date (${startDate})`, 'RedditScraper');
              continue;
            }
          }
          if (endDate) {
            const end = new Date(endDate).getTime();
            if (pubTime > end) {
              logger.debug(`Reddit: Skipping post newer than end date (${endDate})`, 'RedditScraper');
              continue;
            }
          }

          const subredditName = await element.getAttribute('subreddit-name') || subreddit;

          const upvotes = parseInt(scoreStr, 10);
          const commentsCount = parseInt(commentCountStr, 10);

          // Detect locked / over18 states from classes and attributes
          const classAttr = await element.getAttribute('class') || '';
          const isLocked = classAttr.includes('locked');
          const isOver18 = classAttr.includes('over18') || (await element.getAttribute('nsfw')) !== null;

          // Parse UTC published timestamp
          const publishedAt = new Date(createdTimestamp).toISOString();

          // Extract text content (body) if it exists, otherwise list link
          const textBodyEl = element.locator('shreddit-post-text-body, [slot="text-body"]');
          let content = '';
          if (await textBodyEl.count() > 0) {
            content = await textBodyEl.first().innerText();
          } else {
            content = `[External Link Post] ${postUrl}`;
          }

          const metadata: any = {
            subreddit: subredditName,
            upvotes,
            commentsCount,
            isLocked,
            isOver18,
            score: upvotes
          };

          if (extractComments && postUrl) {
            logger.info(`Fetching deep comments for post: ${id}`, 'RedditScraper');
            metadata.comments = await fetchRedditComments(postUrl);
          }

          const rawItem: RawCrawledItem = {
            id,
            source: 'reddit',
            url: postUrl,
            title: postTitle,
            content: content.trim(),
            author,
            publishedAt,
            crawledAt: new Date().toISOString(),
            metadata
          };

          items.push(rawItem);

          // Action-Level Delay between post extractions (4.5 to 9.2 seconds)
          await page.waitForTimeout((Math.random() * (9.2 - 4.5) + 4.5) * 1000);
        } catch (postError) {
          logger.error(`Error parsing individual post inside r/${subreddit}`, postError as Error, 'RedditScraper');
        }
      }

      logger.info(`Successfully parsed ${items.length} items from r/${subreddit}`, 'RedditScraper');
    } catch (error) {
      logger.error(`Failed to scrape subreddit r/${subreddit}`, error as Error, 'RedditScraper', { subreddit });
      throw error;
    } finally {
      if (page) {
        await page.close().catch((e) => logger.error('Failed to close crawler page', e as Error, 'RedditScraper'));
      }
    }

    return items;
  }
}

export const redditScraper = new RedditScraper();

async function fetchRedditComments(postUrl: string): Promise<any[]> {
  try {
    const cleanUrl = postUrl.split('?')[0].replace(/\/$/, '') + '.json';
    const res = await fetch(cleanUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (res.status === 429 || res.status === 403) {
      logger.warn(`fetchRedditComments: HTTP ${res.status}. Halting for 1800 seconds...`, 'RedditScraper');
      await new Promise(resolve => setTimeout(resolve, 1800 * 1000));
      return [];
    }
    if (!res.ok) return [];
    const data = await res.json();
    if (Array.isArray(data) && data.length > 1) {
      const commentsList = data[1].data?.children || [];
      return commentsList
        .slice(0, 10)
        .map((c: any) => ({
          author: c.data?.author || '[deleted]',
          text: c.data?.body || '',
          score: c.data?.score || 0
        }))
        .filter((c: any) => c.text);
    }
  } catch (err) {
    logger.debug(`Failed to fetch Reddit comments for ${postUrl}: ${(err as Error).message}`, 'RedditScraper');
  }
  return [];
}
