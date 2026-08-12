import { chromium } from 'playwright';

async function testPopularAndTag(target: string) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    locale: 'en-US'
  });

  const page = await context.newPage();
  const cleanTag = target.replace('#', '').trim();

  // Try both /popular/${cleanTag}/ and /explore/tags/${cleanTag}/
  const urls = [
    `https://www.instagram.com/popular/${cleanTag}/`,
    `https://www.instagram.com/explore/tags/${cleanTag}/`,
    `https://www.instagram.com/${cleanTag}/reels/`,
    `https://www.instagram.com/${cleanTag}/`
  ];

  const results: any[] = [];
  const seenUrls = new Set<string>();

  for (const u of urls) {
    if (results.length >= 6) break;
    console.log(`Checking ${u}...`);
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(3000);

      const allLinks = await page.locator('a').all();
      for (const link of allLinks) {
        if (results.length >= 6) break;
        const href = await link.getAttribute('href');
        if (!href) continue;

        const match = href.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
        if (!match) continue;

        const type = match[1].startsWith('reel') ? 'reel' : 'post';
        const shortcode = match[2];
        if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'popular' || shortcode === 'reels') continue;

        const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
        if (seenUrls.has(canonicalUrl)) continue;
        seenUrls.add(canonicalUrl);

        // Get text
        let text = '';
        const img = link.locator('img');
        if (await img.count() > 0) {
          text = (await img.first().getAttribute('alt')) || '';
        }
        if (!text) {
          text = (await link.getAttribute('aria-label')) || '';
        }
        const cleanCaption = text.replace(/\s*Photo by.*on\s+\w+\s+\d+,\s+\d+\..*/gi, '').trim() ||
          `${type === 'reel' ? 'Instagram Reel' : 'Instagram Post'} on #${cleanTag}`;

        results.push({
          id: `instagram_${shortcode}`,
          source: 'instagram',
          url: canonicalUrl,
          title: type === 'reel' ? `[REEL] #${cleanTag}` : `[POST] #${cleanTag}`,
          content: cleanCaption,
          author: cleanTag,
          isReel: type === 'reel'
        });
      }
    } catch (e: any) {
      console.log(`Error on ${u}: ${e.message}`);
    }
  }

  console.log(`\n🎉 Extracted ${results.length} REAL LIVE Instagram items for "${target}":`);
  console.log(JSON.stringify(results, null, 2));

  await browser.close();
  process.exit(0);
}

testPopularAndTag('bellingham').catch(e => { console.error(e); process.exit(1); });
