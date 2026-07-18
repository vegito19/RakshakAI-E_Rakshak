import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import { redditScraper } from './sources/reddit';
import { telegramScraper } from './sources/telegram';
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
const DEFAULT_SUBREDDITS = ['surat', 'gujarat', 'india'];
const TARGET_SUBREDDITS = process.env.SUBREDDITS
  ? process.env.SUBREDDITS.split(',').map((s) => s.trim())
  : DEFAULT_SUBREDDITS;

// Target Telegram channels for local news/safety
const DEFAULT_TELEGRAM_CHANNELS = ['surat_news', 'gujarat_safety', 'indiatimes'];
const TARGET_TELEGRAM_CHANNELS = process.env.TELEGRAM_CHANNELS
  ? process.env.TELEGRAM_CHANNELS.split(',').map((c) => c.trim())
  : DEFAULT_TELEGRAM_CHANNELS;

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
   * Orchestrates the Reddit and Telegram ingestion run.
   */
  public async executeRun(): Promise<void> {
    logger.info('Starting crawler coordinator execution run...', 'CrawlerCoordinator');

    try {
      await this.initRedis();

      // 1. Execute Reddit scraping
      for (const subreddit of TARGET_SUBREDDITS) {
        try {
          const items = await redditScraper.scrapeSubreddit(subreddit, POST_LIMIT);
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
      for (const channel of TARGET_TELEGRAM_CHANNELS) {
        try {
          const items = await telegramScraper.scrapeChannel(channel, POST_LIMIT);
          logger.info(`Retrieved ${items.length} items from Telegram channel @${channel}`, 'CrawlerCoordinator');

          let pushCount = 0;
          for (const item of items) {
            if (this.isTestingMode) {
              console.log('\n--- CRAWLED TELEGRAM ITEM SAMPLE ---');
              console.log(JSON.stringify(item, null, 2));
              console.log('------------------------------------\n');
            } else {
              await this.pushToQueue(item);
              pushCount++;
            }
          }

          if (!this.isTestingMode) {
            logger.info(`Successfully pushed ${pushCount} items from @${channel} to the queue.`, 'CrawlerCoordinator', { channel });
          }
        } catch (chanError) {
          logger.error(`Execution failed for Telegram channel: @${channel}`, chanError as Error, 'CrawlerCoordinator', { channel });
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
