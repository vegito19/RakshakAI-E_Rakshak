import { chromium, Browser, Page } from 'playwright';
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

function parseViews(viewsStr: string | null): number {
  if (!viewsStr) return 0;
  const clean = viewsStr.trim().toUpperCase().replace(/,/g, '');
  const match = clean.match(/(\d+(\.\d+)?)\s*[KM]?/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (clean.includes('K')) {
    return Math.round(num * 1000);
  }
  if (clean.includes('M')) {
    return Math.round(num * 1000000);
  }
  return Math.round(num);
}

function parseRelativeDate(relativeStr: string | null): string {
  if (!relativeStr) return new Date().toISOString();
  const clean = relativeStr.trim().toLowerCase();
  
  const now = new Date();
  const match = clean.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) {
    if (clean.includes('a day ago') || clean.includes('yesterday')) {
      now.setDate(now.getDate() - 1);
      return now.toISOString();
    }
    if (clean.includes('an hour ago')) {
      now.setHours(now.getHours() - 1);
      return now.toISOString();
    }
    return now.toISOString();
  }
  
  const value = parseInt(match[1], 10);
  const unit = match[2];
  
  switch (unit) {
    case 'second':
      now.setSeconds(now.getSeconds() - value);
      break;
    case 'minute':
      now.setMinutes(now.getMinutes() - value);
      break;
    case 'hour':
      now.setHours(now.getHours() - value);
      break;
    case 'day':
      now.setDate(now.getDate() - value);
      break;
    case 'week':
      now.setDate(now.getDate() - value * 7);
      break;
    case 'month':
      now.setMonth(now.getMonth() - value);
      break;
    case 'year':
      now.setFullYear(now.getFullYear() - value);
      break;
  }
  return now.toISOString();
}

export class YouTubeScraper {
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
        logger.error('Failed to close YouTube browser', err as Error, 'YouTubeScraper');
      }
      this.browser = null;
    }
  }

  public async scrape(mode: 'search' | 'channel', target: string, limit: number = 5, startDate?: string, endDate?: string, bypassKeywordFilter: boolean = false): Promise<RawCrawledItem[]> {
    const items: RawCrawledItem[] = [];
    let page: Page | null = null;

    try {
      logger.info(`Starting local YouTube scrape: mode=${mode}, target=${target}, limit=${limit}`, 'YouTubeScraper');
      const browser = await this.getBrowser();
      
      const contextOptions: any = {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        locale: 'en-US'
      };

      const proxyConfig = proxyRotator.getNextProxy();
      if (proxyConfig) {
        contextOptions.proxy = proxyConfig;
        logger.info(`Routing requests through proxy: ${proxyConfig.server}`, 'YouTubeScraper');
      }

      const context = await browser.newContext(contextOptions);
      page = await context.newPage();

      let url = '';
      if (mode === 'search') {
        // sp=CAI%253D is the filter query for "Upload Date" sorting
        url = `https://www.youtube.com/results?search_query=${encodeURIComponent(target)}&sp=CAI%253D`;
      } else {
        const username = target.replace('@', '');
        url = `https://www.youtube.com/@${username}/videos`;
      }

      logger.info(`Navigating to ${url}`, 'YouTubeScraper');
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait for video items to load
      await page.waitForSelector('a#video-title-link, a#video-title', { timeout: 15000 }).catch(() => {
        logger.debug('Timeout waiting for video elements to render.', 'YouTubeScraper');
      });

      // Find all generic card renderers (ytd-video-renderer or ytd-grid-video-renderer)
      const renderers = await page.locator('ytd-video-renderer, ytd-grid-video-renderer').all();
      logger.info(`Found ${renderers.length} video elements. Commencing parsing...`, 'YouTubeScraper');

      let count = 0;
      for (const card of renderers) {
        if (items.length >= limit) break;

        try {
          // Extract title and href link
          const titleEl = card.locator('a#video-title-link, a#video-title');
          if (await titleEl.count() === 0) continue;

          const titleText = (await titleEl.first().innerText()) || '';
          const href = await titleEl.first().getAttribute('href');

          if (!titleText || !href || !href.includes('/watch?v=')) continue;
          if (!bypassKeywordFilter && !isPotentiallyRelevant(titleText)) continue;

          // Extract Video ID
          const urlParams = new URLSearchParams(href.split('?')[1] || '');
          const videoId = urlParams.get('v') || 'video';
          const videoUrl = `https://www.youtube.com${href}`;

          // Extract Author/Channel Name
          let author = 'YouTube Channel';
          if (mode === 'channel') {
            author = target.replace('@', '');
          } else {
            const authorEl = card.locator('#channel-info a, #byline-container a, ytd-channel-name a');
            if (await authorEl.count() > 0) {
              author = (await authorEl.first().innerText()) || 'YouTube Channel';
            }
          }

          // Extract views and relative time
          const metadataSpans = await card.locator('#metadata-line span').all();
          let viewsText = '';
          let relativeTimeText = '';

          if (metadataSpans.length >= 2) {
            viewsText = await metadataSpans[0].innerText();
            relativeTimeText = await metadataSpans[1].innerText();
          } else if (metadataSpans.length === 1) {
            const textVal = await metadataSpans[0].innerText();
            if (textVal.toLowerCase().includes('view')) {
              viewsText = textVal;
            } else {
              relativeTimeText = textVal;
            }
          }

          const viewsCount = parseViews(viewsText);
          const publishedAt = parseRelativeDate(relativeTimeText);
          const pubTime = new Date(publishedAt).getTime();

          if (startDate) {
            const start = new Date(startDate).getTime();
            if (pubTime < start) {
              logger.debug(`YouTube: Skipping video older than start date (${startDate})`, 'YouTubeScraper');
              continue;
            }
          }
          if (endDate) {
            const end = new Date(endDate.includes('T') ? endDate : endDate + 'T23:59:59.999Z').getTime();
            if (pubTime > end) {
              logger.debug(`YouTube: Skipping video newer than end date (${endDate})`, 'YouTubeScraper');
              continue;
            }
          }

          const crawledItem: RawCrawledItem = {
            id: `youtube_${videoId}`,
            source: 'youtube',
            url: videoUrl,
            title: titleText,
            content: `[YouTube Video] Title: ${titleText} | Channel: ${author}`,
            author,
            publishedAt,
            crawledAt: new Date().toISOString(),
            metadata: {
              viewsCount,
              relativeTime: relativeTimeText
            }
          };

          items.push(crawledItem);
        } catch (itemErr) {
          logger.error('Failed to parse individual YouTube video', itemErr as Error, 'YouTubeScraper');
        }
      }
    } catch (err) {
      logger.error('YouTube scraper run failed', err as Error, 'YouTubeScraper');
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }

    return items;
  }
}

export const youtubeScraper = new YouTubeScraper();
