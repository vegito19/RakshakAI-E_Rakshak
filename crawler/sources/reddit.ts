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
    let items: RawCrawledItem[] = [];
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

      // Quick safe spacing between navigation if needed (max 500ms)
      const now = Date.now();
      if (this.lastNavigationTime > 0) {
        const elapsed = (now - this.lastNavigationTime) / 1000;
        if (elapsed < 0.5) {
          await page.waitForTimeout(500);
        }
      }
      this.lastNavigationTime = Date.now();

      // Determine whether target is a subreddit or a global search keyword query
      const cleanTarget = subreddit.trim().replace(/^#/, '').trim();
      const isSubredditFormat = /^[a-zA-Z0-9_]+$/.test(cleanTarget) && ['surat', 'gujarat', 'india', 'news', 'delhi'].includes(cleanTarget.toLowerCase());
      
      let url = isSubredditFormat 
        ? `https://www.reddit.com/r/${cleanTarget}/new/`
        : `https://www.reddit.com/search/?q=${encodeURIComponent(cleanTarget)}&sort=new`;

      logger.info(`Navigating to target Reddit URL: ${url}`, 'RedditScraper');
      
      // Navigate and wait for DOM load
      let response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Fallback to search query if subreddit URL returned 404 or empty
      if (response && response.status() === 404 && isSubredditFormat) {
        url = `https://www.reddit.com/search/?q=${encodeURIComponent(cleanTarget)}&sort=new`;
        logger.info(`Subreddit not found. Retrying via Reddit search URL: ${url}`, 'RedditScraper');
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }

      if (response && (response.status() === 403 || response.status() === 429)) {
        throw new Error(`Reddit security blocked request with status: ${response.status()}`);
      }

      // Check for "Try Again Later" rate limit modal/content
      const bodyText = await page.innerText('body').catch(() => '');
      if (bodyText.includes('Try Again Later') || bodyText.includes('try again later')) {
        throw new Error('Reddit rate limit encountered: Try Again Later');
      }

      // Wait for shreddit-post elements to render
      await page.waitForSelector('shreddit-post', { timeout: 10000 }).catch(() => {
        logger.debug('Timeout waiting for shreddit-post elements to render.', 'RedditScraper');
      });

      const pageTitle = await page.title().catch(() => '');
      if (pageTitle.includes('Blocked') || pageTitle.includes('Access Denied')) {
        throw new Error(`Reddit bot detection blocked page access. Title: ${pageTitle}`);
      }

      // Locate shreddit-post elements (Modern Reddit post container)
      const postElements = await page.locator('shreddit-post').all();
      logger.info(`Found ${postElements.length} shreddit post containers for: ${cleanTarget}`, 'RedditScraper');

      if (postElements.length > 0) {
        for (const element of postElements) {
          if (items.length >= limit) break;
          try {
            const id = await element.getAttribute('id');
            if (!id) continue;

            const postTitle = await element.getAttribute('post-title') || '';
            const permalink = await element.getAttribute('permalink') || '';
            const postUrl = permalink ? `https://www.reddit.com${permalink}` : (await element.getAttribute('content-href') || '');
            // 1. Author Username Extraction
            let author = await element.getAttribute('author');
            if (!author || author === '[deleted]' || author.trim() === '') {
              const authorEl = element.locator('a[href*="/user/"], a[href*="/u/"], [slot="authorName"]').first();
              if (await authorEl.count() > 0) {
                const text = (await authorEl.innerText()).trim();
                if (text) {
                  author = text.replace(/^u\//, '');
                } else {
                  const userHref = await authorEl.getAttribute('href');
                  const uMatch = userHref?.match(/\/u(?:ser)?\/([^\/]+)/);
                  if (uMatch) author = uMatch[1];
                }
              }
            }

            const subredditName = await element.getAttribute('subreddit-name') || cleanTarget;

            if (!author || author === '[deleted]' || author.trim() === '') {
              author = subredditName ? `r/${subredditName}` : 'RedditUser';
            }

            const scoreStr = await element.getAttribute('score') || '0';
            const commentCountStr = await element.getAttribute('comment-count') || '0';
            const createdTimestamp = await element.getAttribute('created-timestamp') || new Date().toISOString();
            const pubTime = new Date(createdTimestamp).getTime();

            if (startDate) {
              const start = new Date(startDate).getTime();
              if (pubTime < start) continue;
            }
            if (endDate) {
              const end = new Date(endDate).getTime();
              if (pubTime > end) continue;
            }

            const upvotes = parseInt(scoreStr, 10) || 0;
            const commentsCount = parseInt(commentCountStr, 10) || 0;

            const publishedAt = new Date(createdTimestamp).toISOString();
            const textBodyEl = element.locator('shreddit-post-text-body, [slot="text-body"]');
            let content = '';
            if (await textBodyEl.count() > 0) {
              content = await textBodyEl.first().innerText();
            } else {
              content = postTitle;
            }

            const metadata: any = {
              subreddit: subredditName,
              upvotes,
              commentsCount,
              score: upvotes
            };

            if (extractComments && postUrl) {
              metadata.comments = await fetchRedditComments(postUrl);
            }

            const rawItem: RawCrawledItem = {
              id,
              source: 'reddit',
              url: postUrl,
              title: postTitle,
              content: content.trim() || postTitle,
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
      } else {
        // Fallback: Parse Reddit Search page result cards (a[href*="/comments/"])
        logger.info(`shreddit-post count is 0. Parsing Reddit search card links for query: "${cleanTarget}"`, 'RedditScraper');
        const searchLinks = await page.locator('a[href*="/comments/"]').all();
        const seenUrls = new Set<string>();

        for (const link of searchLinks) {
          if (items.length >= limit) break;
          try {
            const href = await link.getAttribute('href');
            if (!href || !href.includes('/comments/')) continue;

            const fullUrl = href.startsWith('http') ? href : `https://www.reddit.com${href}`;
            const cleanUrl = fullUrl.split('?')[0];

            if (seenUrls.has(cleanUrl)) continue;

            const rawText = (await link.innerText()).trim();
            const title = rawText.split('\n')[0].trim();

            if (!title || title.length < 3) continue;

            seenUrls.add(cleanUrl);

            const match = cleanUrl.match(/\/comments\/([a-zA-Z0-9]+)/);
            const postId = match ? match[1] : Math.random().toString(36).substring(2, 9);

            let author = 'RedditUser';
            let subredditName = cleanTarget;

            if (cleanUrl.includes('/user/')) {
              const userMatch = cleanUrl.match(/\/user\/([^\/]+)/);
              if (userMatch) author = userMatch[1];
            } else if (cleanUrl.includes('/r/')) {
              const subMatch = cleanUrl.match(/\/r\/([^\/]+)/);
              if (subMatch) {
                subredditName = subMatch[1];
                const authorEl = link.locator('xpath=ancestor::faceplate-tracker[1]//a[contains(@href, "/user/") or contains(@href, "/u/")]').first();
                if (await authorEl.count() > 0) {
                  const uText = (await authorEl.innerText()).trim();
                  if (uText) author = uText.replace(/^u\//, '');
                }
                if (!author || author === 'RedditUser') {
                  author = `r/${subredditName}`;
                }
              }
            }

            const rawItem: RawCrawledItem = {
              id: `reddit_${postId}`,
              source: 'reddit',
              url: cleanUrl,
              title,
              content: title,
              author,
              publishedAt: new Date().toISOString(),
              crawledAt: new Date().toISOString(),
              metadata: {
                subreddit: subredditName,
                upvotes: 1,
                commentsCount: 0,
                score: 1
              }
            };

            items.push(rawItem);
          } catch (searchCardErr) {
            logger.error('Error parsing Reddit search result card', searchCardErr as Error, 'RedditScraper');
          }
        }
      }

      logger.info(`Successfully parsed ${items.length} items from r/${subreddit}`, 'RedditScraper');
    } catch (error) {
      logger.warn(`Playwright scrape for Reddit r/${subreddit} failed: ${(error as Error).message}. Attempting live RSS fallback...`, 'RedditScraper');
      items = await this.scrapeViaRss(subreddit, limit);
    } finally {
      if (page) {
        await page.close().catch((e) => logger.error('Failed to close crawler page', e as Error, 'RedditScraper'));
      }
    }

    if (items.length === 0) {
      items = await this.scrapeViaRss(subreddit, limit);
    }

    return items;
  }

  private async scrapeViaRss(target: string, limit: number = 25): Promise<RawCrawledItem[]> {
    try {
      const axios = (await import('axios')).default;
      const cleanTarget = target.trim().replace(/^#/, '').trim();
      const isSubredditFormat = /^[a-zA-Z0-9_]+$/.test(cleanTarget) && ['surat', 'gujarat', 'india', 'news', 'delhi', 'cricket', 'sports'].includes(cleanTarget.toLowerCase());
      const rssUrl = isSubredditFormat 
        ? `https://www.reddit.com/r/${cleanTarget}/new.rss`
        : `https://www.reddit.com/search.rss?q=${encodeURIComponent(cleanTarget)}&sort=new`;

      logger.info(`Fetching Reddit live RSS feed fallback: ${rssUrl}`, 'RedditScraper');
      const res = await axios.get(rssUrl, {
        headers: {
          'User-Agent': 'RakshakOSINT/1.0.0 (CrimeOS; contact@suratpolice.gov.in)',
          'Accept': 'application/rss+xml, application/xml, text/xml'
        },
        timeout: 10000
      });

      const xml = res.data || '';
      const entries = xml.split('<entry>');
      const items: RawCrawledItem[] = [];

      for (let i = 1; i < entries.length && items.length < limit; i++) {
        const entry = entries[i];
        const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
        const linkMatch = entry.match(/<link href="([^"]+)"/);
        const authorMatch = entry.match(/<author><name>([^<]+)<\/name>/);
        const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);

        const title = titleMatch ? titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : cleanTarget;
        const url = linkMatch ? linkMatch[1] : `https://www.reddit.com/r/${cleanTarget}`;
        const authorRaw = authorMatch ? authorMatch[1].replace('/u/', '') : 'RedditUser';
        const publishedAt = updatedMatch ? new Date(updatedMatch[1]).toISOString() : new Date().toISOString();

        const idMatch = entry.match(/<id>([^<]+)<\/id>/);
        const id = idMatch ? `reddit_${idMatch[1].replace(/[^a-zA-Z0-9_]/g, '')}` : `reddit_${Date.now()}_${i}`;

        items.push({
          id,
          source: 'reddit',
          url,
          title,
          content: title,
          author: authorRaw,
          publishedAt,
          crawledAt: new Date().toISOString(),
          metadata: {
            subreddit: cleanTarget,
            upvotes: 1,
            commentsCount: 0,
            score: 1
          }
        });
      }

      logger.info(`Live RSS fallback retrieved ${items.length} real posts for: "${cleanTarget}"`, 'RedditScraper');
      return items;
    } catch (err) {
      logger.warn(`Reddit RSS fallback failed: ${(err as Error).message}`, 'RedditScraper');
      return [];
    }
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
      logger.warn(`fetchRedditComments: HTTP ${res.status}`, 'RedditScraper');
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
