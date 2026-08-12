import axios from 'axios';

export async function searchRealInstagramPosts(query: string, limit: number = 5) {
  console.log(`[OSINT Engine] Commencing Live Real Extraction for Instagram: "${query}" (Limit: ${limit})`);

  const results: any[] = [];
  const seenUrls = new Set<string>();

  const searchQueries = [
    `site:instagram.com/reel ${query}`,
    `site:instagram.com/p ${query}`,
    `site:instagram.com "${query}"`
  ];

  for (const sq of searchQueries) {
    if (results.length >= limit) break;
    try {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(sq)}`;
      const res = await axios.get(ddgUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 10000
      });

      const html = res.data as string;
      // Look for uddg= (DuckDuckGo redirect links)
      const uddgMatches = [...html.matchAll(/uddg=([^&"]+)/g)];
      
      for (const m of uddgMatches) {
        if (results.length >= limit) break;
        const decodedUrl = decodeURIComponent(m[1]);
        
        const igMatch = decodedUrl.match(/https?:\/\/(?:www\.)?instagram\.com\/(reel|p)\/([A-Za-z0-9_-]+)/);
        if (igMatch) {
          const type = igMatch[1];
          const shortcode = igMatch[2];
          if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'reels') continue;

          const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
          if (seenUrls.has(canonicalUrl)) continue;
          seenUrls.add(canonicalUrl);

          // Find text snippet near link
          const idx = html.indexOf(m[0]);
          let snippet = '';
          if (idx !== -1) {
            const surrounding = html.substring(Math.max(0, idx - 300), Math.min(html.length, idx + 500));
            snippet = surrounding.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          }

          let author = 'instagram_user';
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
            title: isReel ? `[REEL] ${query} - @${author}` : `[POST] ${query} - @${author}`,
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
    } catch (err: any) {
      console.log('Search error:', err.message);
    }
  }

  return results;
}

searchRealInstagramPosts('bellingham', 5).then(res => {
  console.log(`Successfully extracted ${res.length} real Instagram items:`);
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}).catch(e => {
  console.error(e);
  process.exit(1);
});
