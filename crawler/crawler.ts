import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import { redditScraper } from './sources/reddit';
import { telegramScraper } from './sources/telegram';
import { instagramScraper } from './sources/instagramLocal';
import { twitterScraper } from './sources/twitterLocal';
import { youtubeScraper } from './sources/youtubeLocal';
import { logger } from '../utils/logger';
import { RawCrawledItem } from '../shared-types/crawler';

// Load environmental configuration
dotenv.config();

// Redis Configuration
const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;
const REDIS_QUEUE_KEY = 'queue:raw_posts';

// Target subreddits for Surat OSINT mapping and public safety monitoring
const DEFAULT_SUBREDDITS = ['surat', 'gujarat'];
const TARGET_SUBREDDITS = process.env.SUBREDDITS
  ? process.env.SUBREDDITS.split(',').map((s) => s.trim())
  : DEFAULT_SUBREDDITS;

// Target Telegram channels for local news/safety
const DEFAULT_TELEGRAM_CHANNELS = ['surat_news', 'gujarat_safety', 'indiatimes'];
const TARGET_TELEGRAM_CHANNELS = process.env.TELEGRAM_CHANNELS
  ? process.env.TELEGRAM_CHANNELS.split(',').map((c) => c.trim())
  : DEFAULT_TELEGRAM_CHANNELS;

// Target Instagram configurations
const DEFAULT_INSTAGRAM_PROFILES = ['kemchhosurat'];
const TARGET_INSTAGRAM_PROFILES = process.env.INSTAGRAM_PROFILES
  ? process.env.INSTAGRAM_PROFILES.split(',').map((p) => p.trim())
  : DEFAULT_INSTAGRAM_PROFILES;

const DEFAULT_INSTAGRAM_HASHTAGS = ['surat'];
const TARGET_INSTAGRAM_HASHTAGS = process.env.INSTAGRAM_HASHTAGS
  ? process.env.INSTAGRAM_HASHTAGS.split(',').map((h) => h.trim())
  : DEFAULT_INSTAGRAM_HASHTAGS;

const DEFAULT_INSTAGRAM_LOCATIONS = ['213025252']; // Surat, Gujarat
const TARGET_INSTAGRAM_LOCATIONS = process.env.INSTAGRAM_LOCATIONS
  ? process.env.INSTAGRAM_LOCATIONS.split(',').map((l) => l.trim())
  : DEFAULT_INSTAGRAM_LOCATIONS;

// Target Twitter configurations
const DEFAULT_TWITTER_HANDLES = ['SuratPolice', 'CP_Surat'];
const TARGET_TWITTER_HANDLES = process.env.TWITTER_HANDLES
  ? process.env.TWITTER_HANDLES.split(',').map((p) => p.trim())
  : DEFAULT_TWITTER_HANDLES;

const DEFAULT_TWITTER_HASHTAGS = ['surat', 'suratpolice'];
const TARGET_TWITTER_HASHTAGS = process.env.TWITTER_HASHTAGS
  ? process.env.TWITTER_HASHTAGS.split(',').map((h) => h.trim())
  : DEFAULT_TWITTER_HASHTAGS;

// Target YouTube configurations
const DEFAULT_YOUTUBE_CHANNELS = ['SuratPoliceCity', 'SMCSRT'];
const TARGET_YOUTUBE_CHANNELS = process.env.YOUTUBE_CHANNELS
  ? process.env.YOUTUBE_CHANNELS.split(',').map((c) => c.trim())
  : DEFAULT_YOUTUBE_CHANNELS;

const DEFAULT_YOUTUBE_KEYWORDS = ['surat police', 'surat traffic news', 'surat rain update'];
const TARGET_YOUTUBE_KEYWORDS = process.env.YOUTUBE_KEYWORDS
  ? process.env.YOUTUBE_KEYWORDS.split(',').map((k) => k.trim())
  : DEFAULT_YOUTUBE_KEYWORDS;



// Scraper settings
const POST_LIMIT = parseInt(process.env.POST_LIMIT || '10', 10);

class CrawlerCoordinator {
  private redisClient: Redis | null = null;
  private isTestingMode: boolean = false;

  constructor(isTesting: boolean = false) {
    this.isTestingMode = isTesting;
  }

  /**
   * Initializes Redis client if not in test mode.
   */
  private async initRedis(): Promise<void> {
    if (this.isTestingMode) {
      logger.info('Running in TEST mode. Redis queue insertion will be bypassed.', 'CrawlerCoordinator');
      return;
    }

    try {
      logger.info(`Connecting to Redis at ${REDIS_HOST}:${REDIS_PORT}`, 'CrawlerCoordinator');
      this.redisClient = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        password: REDIS_PASSWORD,
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          const delay = Math.min(times * 100, 3000);
          return delay;
        }
      });

      this.redisClient.on('connect', () => {
        logger.info('Successfully connected to Redis server.', 'CrawlerCoordinator');
      });

      this.redisClient.on('error', (err) => {
        logger.error('Redis Client encountered an error.', err as Error, 'CrawlerCoordinator');
      });
    } catch (err) {
      logger.error('Failed to initialize Redis client.', err as Error, 'CrawlerCoordinator');
      throw err;
    }
  }

  /**
   * Pushes a crawled item into the Redis queue.
   */
  private async pushToQueue(item: RawCrawledItem): Promise<void> {
    if (!this.redisClient) return;

    try {
      const payloadString = JSON.stringify(item);
      // RPUSH for FIFO queue behavior (Ingestion pushes to tail, NLP workers pop from head)
      await this.redisClient.rpush(REDIS_QUEUE_KEY, payloadString);
      logger.debug(`Pushed post ${item.id} to Redis queue.`, 'CrawlerCoordinator', { id: item.id });
    } catch (error) {
      logger.error(`Failed to push post ${item.id} to Redis queue`, error as Error, 'CrawlerCoordinator', { item });
    }
  }

  /**
   * Processes crawled items, logging in test mode or pushing to Redis queue.
   */
  private async processCrawledItems(items: RawCrawledItem[]): Promise<void> {
    let pushCount = 0;
    for (const item of items) {
      if (this.isTestingMode) {
        console.log(`\n--- CRAWLED ${item.source.toUpperCase()} ITEM SAMPLE ---`);
        console.log(JSON.stringify(item, null, 2));
        console.log('-------------------------------------\n');
      } else {
        await this.pushToQueue(item);
        pushCount++;
      }
    }
    if (!this.isTestingMode && pushCount > 0) {
      logger.info(`Successfully pushed ${pushCount} items to the queue.`, 'CrawlerCoordinator');
    }
  }

  /**
   * Orchestrates the Reddit and Telegram ingestion run.
   */
  public async executeRun(): Promise<void> {
    logger.info('Starting crawler coordinator execution run...', 'CrawlerCoordinator');

    try {
      await this.initRedis();

      // 1. Execute Reddit scraping
      for (const subreddit of TARGET_SUBREDDITS) {
        try {
          const items = await redditScraper.scrape(subreddit, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items from r/${subreddit}`, 'CrawlerCoordinator');

          let pushCount = 0;
          for (const item of items) {
            if (this.isTestingMode) {
              console.log('\n--- CRAWLED REDDIT ITEM SAMPLE ---');
              console.log(JSON.stringify(item, null, 2));
              console.log('----------------------------------\n');
            } else {
              await this.pushToQueue(item);
              pushCount++;
            }
          }

          if (!this.isTestingMode) {
            logger.info(`Successfully pushed ${pushCount} items from r/${subreddit} to the queue.`, 'CrawlerCoordinator', { subreddit });
          }
        } catch (subError) {
          logger.error(`Execution failed for subreddit: r/${subreddit}`, subError as Error, 'CrawlerCoordinator', { subreddit });
        }
      }

      // 2. Execute Telegram scraping
      if (this.isTestingMode) {
        logger.info('Telegram scraping is skipped in test mode.', 'CrawlerCoordinator');
      } else {
        for (const channel of TARGET_TELEGRAM_CHANNELS) {
          try {
            const items = await telegramScraper.scrape(channel, POST_LIMIT);
            logger.info(`Retrieved ${items.length} items from Telegram channel @${channel}`, 'CrawlerCoordinator');

            let pushCount = 0;
            for (const item of items) {
              await this.pushToQueue(item);
              pushCount++;
            }

            logger.info(`Successfully pushed ${pushCount} items from @${channel} to the queue.`, 'CrawlerCoordinator', { channel });
          } catch (chanError) {
            logger.error(`Execution failed for Telegram channel: @${channel}`, chanError as Error, 'CrawlerCoordinator', { channel });
          }
        }
      }

      // 3. Execute Instagram scraping
      logger.info('Starting Instagram scraping section...', 'CrawlerCoordinator');

      // 3a. Profile mode
      for (const profile of TARGET_INSTAGRAM_PROFILES) {
        try {
          const items = await instagramScraper.scrape('profile', profile, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items from Instagram profile @${profile}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process Instagram profile: ${profile}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 3b. Hashtag mode
      for (const tag of TARGET_INSTAGRAM_HASHTAGS) {
        try {
          const items = await instagramScraper.scrape('hashtag', tag, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items for hashtag #${tag}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process Instagram hashtag: ${tag}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 3c. Location mode
      for (const loc of TARGET_INSTAGRAM_LOCATIONS) {
        try {
          const items = await instagramScraper.scrape('location', loc, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items for location ID ${loc}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process Instagram location ID: ${loc}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 3d. Dedicated Instagram Reels mode
      logger.info('Starting Instagram Reels scraping section...', 'CrawlerCoordinator');
      for (const target of TARGET_INSTAGRAM_PROFILES) {
        try {
          const reelItems = await instagramScraper.scrape('reels', target, POST_LIMIT);
          logger.info(`Retrieved ${reelItems.length} Instagram Reels from @${target}`, 'CrawlerCoordinator');
          await this.processCrawledItems(reelItems);
        } catch (err) {
          logger.error(`Failed to process Instagram reels for ${target}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 4. Execute Twitter scraping
      logger.info('Starting Twitter scraping section...', 'CrawlerCoordinator');

      // 4a. Handle mode
      for (const handle of TARGET_TWITTER_HANDLES) {
        try {
          const items = await twitterScraper.scrape('handle', handle, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items from Twitter handle @${handle}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process Twitter handle: ${handle}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 4b. Hashtag mode
      for (const tag of TARGET_TWITTER_HASHTAGS) {
        try {
          const items = await twitterScraper.scrape('hashtag', tag, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items for Twitter hashtag #${tag}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process Twitter hashtag: ${tag}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 5. Execute YouTube scraping
      logger.info('Starting YouTube scraping section...', 'CrawlerCoordinator');

      // 5a. Channel mode
      for (const channel of TARGET_YOUTUBE_CHANNELS) {
        try {
          const items = await youtubeScraper.scrape('channel', channel, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items from YouTube channel @${channel}`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process YouTube channel: ${channel}`, err as Error, 'CrawlerCoordinator');
        }
      }

      // 5b. Search mode
      for (const keyword of TARGET_YOUTUBE_KEYWORDS) {
        try {
          const items = await youtubeScraper.scrape('search', keyword, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items for YouTube search query: "${keyword}"`, 'CrawlerCoordinator');
          await this.processCrawledItems(items);
        } catch (err) {
          logger.error(`Failed to process YouTube search query: ${keyword}`, err as Error, 'CrawlerCoordinator');
        }
      }

    } catch (error) {
      logger.error('Crawler execution run encountered a fatal error.', error as Error, 'CrawlerCoordinator');
    } finally {
      await this.shutdown();
    }
  }

  /**
   * Closes browser resources and Redis connections.
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down crawler coordinator resources...', 'CrawlerCoordinator');

    // Close scraper browsers
    await redditScraper.close();
    await telegramScraper.close();
    await twitterScraper.close();
    await instagramScraper.close();
    await youtubeScraper.close();

    // Close Redis connection
    if (this.redisClient) {
      try {
        await this.redisClient.quit();
        this.redisClient = null;
        logger.info('Redis connection closed successfully.', 'CrawlerCoordinator');
      } catch (err) {
        logger.error('Error during Redis client disconnect.', err as Error, 'CrawlerCoordinator');
      }
    }

    logger.info('Shutdown complete.', 'CrawlerCoordinator');
  }
}

// Entrypoint script execution
if (require.main === module) {
  const isTest = process.argv.includes('--test');
  const coordinator = new CrawlerCoordinator(isTest);

  // Setup process termination handlers for clean resource release
  const handleExit = async (signal: string) => {
    logger.warn(`Received signal ${signal}. Forcing graceful shutdown.`, 'CrawlerCoordinator');
    await coordinator.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => handleExit('SIGINT'));
  process.on('SIGTERM', () => handleExit('SIGTERM'));

  coordinator.executeRun()
    .then(() => {
      logger.info('Crawler run finished successfully.', 'CrawlerCoordinator');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Crawler process crashed.', err, 'CrawlerCoordinator');
      process.exit(1);
    });
}
