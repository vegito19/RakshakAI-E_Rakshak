import { chromium, Browser, Page } from 'playwright';
import { RawCrawledItem, TelegramMetadata } from '../../shared-types/crawler';
import { logger } from '../../utils/logger';

export class TelegramScraper {
  private browser: Browser | null = null;

  /**
   * Initializes or returns the existing Playwright browser instance.
   */
  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
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
        logger.info('Playwright browser closed successfully.', 'TelegramScraper');
      }
    } catch (error) {
      logger.error('Failed to close browser.', error as Error, 'TelegramScraper');
    }
  }

  /**
   * Parses Telegram views string (e.g. "1.2K" or "1.5M") into a numeric representation.
   */
  private parseViews(viewsStr: string): number {
    if (!viewsStr) return 0;
    
    try {
      const cleaned = viewsStr.trim().toUpperCase();
      if (cleaned.endsWith('K')) {
        return Math.round(parseFloat(cleaned.replace('K', '')) * 1000);
      }
      if (cleaned.endsWith('M')) {
        return Math.round(parseFloat(cleaned.replace('M', '')) * 1000000);
      }
      
      const parsed = parseInt(cleaned.replace(/[^0-9]/g, ''), 10);
      return isNaN(parsed) ? 0 : parsed;
    } catch {
      return 0;
    }
  }

  /**
   * Scrapes public messages from a public Telegram channel preview.
   * @param channelName Name/handle of the public channel (e.g. "surat_safety")
   * @param limit Maximum number of messages to fetch (default: 25)
   * @returns Array of raw crawled items mapped strictly to schema definitions
   */
  public async scrapeChannel(channelName: string, limit: number = 25): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Initiating scrape for Telegram channel: @${channelName} with limit: ${limit}`, 'TelegramScraper', { channelName, limit });
      const browser = await this.getBrowser();
      
      // Setup browser context with stealth and optional proxy options
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US'
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
          logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'TelegramScraper');
        } catch {
          contextOptions.proxy = {
            server: process.env.PROXY_SERVER
          };
          logger.info(`Routing requests through proxy server: ${process.env.PROXY_SERVER}`, 'TelegramScraper');
        }
      }

      const context = await browser.newContext(contextOptions);
      page = await context.newPage();

      const url = `https://t.me/s/${channelName}`;
      logger.debug(`Navigating to Telegram Web Preview URL: ${url}`, 'TelegramScraper');
      
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (response && response.status() === 404) {
        logger.warn(`Telegram channel preview page returned 404. Channel may not exist.`, 'TelegramScraper', { channelName });
        return [];
      }

      // Check if page displays channel-not-found text
      const content = await page.locator('body').innerText();
      if (content.includes('If you have Telegram, you can contact') && content.includes('right away')) {
        logger.warn(`Telegram channel @${channelName} does not exist or preview is disabled.`, 'TelegramScraper', { channelName });
        return [];
      }

      // Locate all message elements
      const messageElements = await page.locator('div.tgme_widget_message').all();
      logger.info(`Found ${messageElements.length} messages in preview. Commencing parsing...`, 'TelegramScraper');

      // Sort and slice messages (Telegram lists oldest first at the top, newest at the bottom. We slice the latest `limit` posts)
      const targetElements = messageElements.slice(-limit);

      for (const element of targetElements) {
        try {
          // Parse data-post attribute (e.g. "channel/123")
          const postPath = await element.getAttribute('data-post');
          if (!postPath) {
            logger.debug('Skipping message element: missing data-post attribute.', 'TelegramScraper');
            continue;
          }

          const pathParts = postPath.split('/');
          const parsedChannel = pathParts[0] || channelName;
          const postId = parseInt(pathParts[1] || '0', 10);
          const postUrl = `https://t.me/${postPath}`;

          // Author / Channel Owner Name
          const authorEl = element.locator('a.tgme_widget_message_owner_name');
          const author = (await authorEl.count()) > 0 ? await authorEl.innerText() : parsedChannel;

          // Message Body Text
          const textEl = element.locator('div.tgme_widget_message_text');
          if (await textEl.count() === 0) {
            logger.debug(`Skipping message ${postPath}: text body element is empty (e.g. photo-only, service message).`, 'TelegramScraper');
            continue;
          }
          const messageText = await textEl.innerText();

          // Views
          const viewsEl = element.locator('span.tgme_widget_message_views');
          const viewsText = (await viewsEl.count()) > 0 ? await viewsEl.innerText() : '0';
          const views = this.parseViews(viewsText);

          // Timestamp
          const timeEl = element.locator('time');
          let publishedAt = new Date().toISOString();
          if (await timeEl.count() > 0) {
            const datetimeAttr = await timeEl.getAttribute('datetime');
            if (datetimeAttr) {
              publishedAt = new Date(datetimeAttr).toISOString();
            }
          }

          // Generate title from the first sentence or first 60 chars of text body
          const firstLine = messageText.split('\n')[0] || '';
          const cleanedTitle = firstLine.length > 60 
            ? `${firstLine.substring(0, 60).trim()}...` 
            : firstLine.trim();

          const metadata: TelegramMetadata = {
            channelName: parsedChannel,
            views,
            postId
          };

          const rawItem: RawCrawledItem = {
            id: postPath, // Platform-unique ID format: "channel_name/message_id"
            source: 'telegram',
            url: postUrl,
            title: cleanedTitle || 'Telegram Post',
            content: messageText.trim(),
            author,
            publishedAt,
            crawledAt: new Date().toISOString(),
            metadata
          };

          items.push(rawItem);
        } catch (msgError) {
          logger.error(`Error parsing individual Telegram message`, msgError as Error, 'TelegramScraper');
        }
      }

      logger.info(`Successfully parsed ${items.length} items from @${channelName}`, 'TelegramScraper');
    } catch (error) {
      logger.error(`Failed to scrape Telegram channel @${channelName}`, error as Error, 'TelegramScraper', { channelName });
      throw error;
    } finally {
      if (page) {
        await page.close().catch((e) => logger.error('Failed to close page', e as Error, 'TelegramScraper'));
      }
    }

    return items;
  }
}

export const telegramScraper = new TelegramScraper();
