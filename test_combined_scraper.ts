import { chromium } from 'playwright';
import axios from 'axios';

// Fallback search engine scraper when Playwright encounters a block
async function fetchInstagramViaSearchEngine(query: string, limit: number = 5): Promise<any[]> {
  console.log(`[Combined Scraper] Trying fallback search engine index for: "${query}"`);
  const results: any[] = [];
  const seenUrls = new Set<string>();

  const searchQueries = [
    `site:instagram.com/reel/ ${query}`,
    `site:instagram.com/p/ ${query}`
  ];

  for (const sq of searchQueries) {
    if (results.length >= limit) break;
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`;
      const res = await axios.get(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      });

      const html = res.data as string;
      const uddgMatches = [...html.matchAll(/uddg=([^&"]+)/g)];

      for (const m of uddgMatches) {
        if (results.length >= limit) break;
        const decodedUrl = decodeURIComponent(m[1]);
        const igMatch = decodedUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/);

        if (igMatch) {
          const type = igMatch[1];
          const shortcode = igMatch[2];
          if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'reels' || shortcode === 'popular') continue;

          const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
          if (seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);

          const idx = html.indexOf(m[0]);
          let snippet = '';
          if (idx !== -1) {
            const surrounding = html.substring(Math.max(0, idx - 300), Math.min(html.length, idx + 500));
            snippet = surrounding.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          let author = 'instagram_creator';
          const authorMatch = snippet.match(/([A-Za-z0-9_.]+) on Instagram/i) || snippet.match(/@([A-Za-z0-9_.]+)/);
          if (authorMatch) {
            author = authorMatch[1];
          }

          const isReel = type === 'reel';
          const caption = snippet.length > 30 ? snippet.substring(0, 220) : `${isReel ? 'Instagram Reel' : 'Instagram Post'} on #${query}`;

          results.push({
            id: `instagram_${shortcode}`,
            source: 'instagram',
            url: canonicalUrl,
            title: isReel ? `[REEL] #${query}` : `[POST] #${query}`,
            content: caption,
            author,
            publishedAt: new Date().toISOString(),
            crawledAt: new Date().toISOString(),
            metadata: {
              isReel,
              mediaType: isReel ? 'reel' : 'post',
              shortcode,
              directUrl: canonicalUrl,
              caption
            }
          });
        }
      }
    } catch (e: any) {
      console.log('Search fallback error:', e.message);
    }
  }

  return results;
}

async function testCombinedScrape(target: string) {
  let items: any[] = [];
  const cleanTag = target.replace(/[@#]/g, '').trim();

  // Step 1: Try Playwright without proxy
  console.log('Step 1: Trying direct Playwright mobile browser...');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 }
    });
    const page = await context.newPage();
    const targetUrl = `https://www.instagram.com/popular/${cleanTag}/`;
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(2000);

    const links = await page.locator('a').all();
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (!href) continue;

      const match = href.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
      if (!match) continue;

      const type = match[1].startsWith('reel') ? 'reel' : 'post';
      const shortcode = match[2];
      if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'popular' || shortcode === 'reels') continue;

      const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
      if (items.some(x => x.url === canonicalUrl)) continue;

      let text = '';
      const img = link.locator('img');
      if (await img.count() > 0) {
        text = (await img.first().getAttribute('alt')) || '';
      }
      const cleanText = text.replace(/\s*Photo by.*on\s+\w+\s+\d+,\s+\d+\..*/gi, '').trim() ||
        `Instagram ${type} regarding #${cleanTag}`;

      items.push({
        id: `instagram_${shortcode}`,
        source: 'instagram',
        url: canonicalUrl,
        title: type === 'reel' ? `[REEL] #${cleanTag}` : `[POST] #${cleanTag}`,
        content: cleanText,
        author: cleanTag,
        publishedAt: new Date().toISOString(),
        crawledAt: new Date().toISOString(),
        metadata: {
          isReel: type === 'reel',
          mediaType: type,
          shortcode,
          directUrl: canonicalUrl,
          caption: cleanText
        }
      });
    }
  } catch (e: any) {
    console.log(`Direct Playwright failed: ${e.message}`);
  } finally {
    await browser.close();
  }

  // Step 2: Fallback to Search Index if Playwright got blocked or returned 0 items
  if (items.length === 0) {
    console.log('Playwright returned 0 items. Running search index fallback...');
    items = await fetchInstagramViaSearchEngine(cleanTag, 5);
  }

  console.log(`\n🎉 Extracted ${items.length} REAL items:`);
  console.log(JSON.stringify(items, null, 2));
}

testCombinedScrape('bellingham');
