export type SocialSource = 'reddit' | 'twitter' | 'telegram' | 'youtube' | 'news';

export interface RedditMetadata {
  subreddit: string;
  upvotes: number;
  commentsCount: number;
  isLocked: boolean;
  isOver18: boolean;
  score?: number;
}

export interface TelegramMetadata {
  channelName: string;
  views: number;
  postId: number;
}

export interface RawCrawledItem {
  id: string;              // Unique platform-agnostic ID (e.g., Reddit submission fullname, Telegram message ID)
  source: SocialSource;    // 'reddit', 'telegram', etc.
  url: string;             // Absolute URL of the post
  title?: string;          // Post title (optional)
  content: string;         // Text content of the post
  author: string;          // Author username or channel name
  publishedAt: string;     // ISO 8601 UTC timestamp of post creation
  crawledAt: string;       // ISO 8601 UTC timestamp of crawling
  metadata: RedditMetadata | TelegramMetadata | Record<string, any>; // Extensible metadata block
}
