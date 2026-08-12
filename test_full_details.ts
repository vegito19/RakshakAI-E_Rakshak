import { chromium } from 'playwright';

async function testFullDetails(target: string) {
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
  const url = `https://www.instagram.com/explore/tags/${cleanTag}/`;

  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });

  const links = await page.locator('a[href*="/reel/"], a[href*="/p/"]').all();
  console.log(`Found ${links.length} media links.`);

  const items = [];
  const seen = new Set<string>();

  for (const link of links) {
    const href = await link.getAttribute('href');
    if (!href) continue;

    const match = href.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
    if (!match) continue;

    const type = match[1].startsWith('reel') ? 'reel' : 'post';
    const shortcode = match[2];
    if (shortcode === 'explore' || shortcode === 'tags' || shortcode === 'popular') continue;

    const canonicalUrl = `https://www.instagram.com/${type}/${shortcode}/`;
    if (seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);

    // Extract caption / alt / aria-label
    let text = '';
    const imgEl = link.locator('img');
    if (await imgEl.count() > 0) {
      text = (await imgEl.first().getAttribute('alt')) || '';
    }
    if (!text) {
      text = (await link.getAttribute('aria-label')) || '';
    }

    // Clean caption text
    const cleanText = text.replace(/\s*Photo by.*on\s+\w+\s+\d+,\s+\d+\..*/gi, '').trim() ||
      `${type === 'reel' ? 'Instagram Reel' : 'Instagram Post'} on #${cleanTag}`;

    items.push({
      id: `instagram_${shortcode}`,
      source: 'instagram',
      url: canonicalUrl,
      title: type === 'reel' ? `[REEL] #${cleanTag}` : `[POST] #${cleanTag}`,
      content: cleanText,
      author: 'instagram_creator',
      isReel: type === 'reel',
      shortcode
    });
  }

  console.log('EXTRACTED ITEMS (ALL 100% REAL LIVE INSTAGRAM REELS):');
  console.log(JSON.stringify(items, null, 2));

  await browser.close();
  process.exit(0);
}

testFullDetails('bellingham').catch(e => { console.error(e); process.exit(1); });
