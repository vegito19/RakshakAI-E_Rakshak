import { chromium, Browser, Page } from 'playwright';
import { RawCrawledItem, RedditMetadata } from '../../shared-types/crawler';
import { logger } from '../../utils/logger';

export class RedditScraper {
  private browser: Browser | null = null;

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
   * @returns Array of raw crawled items mapped strictly to schema definitions
   */
  public async scrapeSubreddit(subreddit: string, limit: number = 25): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Initiating scrape for r/${subreddit} with limit: ${limit}`, 'RedditScraper', { subreddit, limit });
      const browser = await this.getBrowser();
      
      // Setup browser context with stealth and optional proxy options
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        locale: 'en-US',
        viewport: { width: 1280, height: 1000 }
      };

      if (process.env.PROXY_SERVER) {
        try {
          const url = new URL(process.env.PROXY_SERVER);
          const proxyConfig: any = {
            server: `${url.protocol}//${url.host}`
          };
          if (url.username) proxyConfig.username = decodeURIComponent(url.username);
          if (url.password) proxyConfig.password = decodeURIComponent(url.password);
          contextOptions.proxy = proxyConfig;
          logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'RedditScraper');
        } catch {
          contextOptions.proxy = {
            server: process.env.PROXY_SERVER
          };
          logger.info(`Routing requests through proxy server: ${process.env.PROXY_SERVER}`, 'RedditScraper');
        }
      }

      const context = await browser.newContext(contextOptions);

      page = await context.newPage();

      // Stealth injections to bypass basic bot checks
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      });

      const url = `https://www.reddit.com/r/${subreddit}/new/`;
      logger.debug(`Navigating to target Reddit URL: ${url}`, 'RedditScraper');
      
      // Navigate and wait for DOM load
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      if (response && response.status() === 403) {
        throw new Error('Reddit network security blocked the request (403 Forbidden).');
      }

      // Wait a few seconds for lazy loaded items and GraphQL API requests to settle
      logger.debug('Waiting for dynamic feed content to render...', 'RedditScraper');
      await page.waitForTimeout(8000);

      const pageTitle = await page.title();
      if (pageTitle.includes('Blocked') || pageTitle.includes('Access Denied')) {
        throw new Error(`Reddit bot detection blocked page access. Title: ${pageTitle}`);
      }

      // Locate shreddit-post elements (Modern Reddit post container)
      const postElements = await page.locator('shreddit-post').all();
      logger.info(`Found ${postElements.length} post containers in r/${subreddit}`, 'RedditScraper');

      for (const element of postElements.slice(0, limit)) {
        try {
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

          const metadata: RedditMetadata = {
            subreddit: subredditName,
            upvotes,
            commentsCount,
            isLocked,
            isOver18,
            score: upvotes
          };

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
