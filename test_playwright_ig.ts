import { chromium } from 'playwright';

async function testInstagramPlaywright(target: string) {
  console.log(`[Playwright Instagram Test] Target: ${target}`);
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

  // Try 1: Explore tags or search query or profile
  const isTag = target.startsWith('#') || !target.includes(' ');
  const cleanTag = target.replace('#', '').trim();
  const url = `https://www.instagram.com/explore/tags/${cleanTag}/`;

  console.log(`Navigating to ${url}...`);
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e: any) {
    console.log(`Navigation timeout or error: ${e.message}`);
  }

  console.log(`Final page URL: ${page.url()}`);
  const title = await page.title();
  console.log(`Page title: ${title}`);

  // Check all links
  const links = await page.locator('a').all();
  console.log(`Total <a> links found: ${links.length}`);

  const mediaLinks: string[] = [];
  for (const l of links) {
    const href = await l.getAttribute('href');
    if (href && (href.includes('/p/') || href.includes('/reel/'))) {
      mediaLinks.push(href);
    }
  }

  console.log(`Media links found (${mediaLinks.length}):`, mediaLinks.slice(0, 10));

  // If redirected or empty, try profile directly
  if (mediaLinks.length === 0) {
    const profileUrl = `https://www.instagram.com/${cleanTag}/`;
    console.log(`\nTrying Profile URL: ${profileUrl}...`);
    try {
      await page.goto(profileUrl, { waitUntil: 'networkidle', timeout: 20000 });
      console.log(`Profile page title: ${await page.title()}`);
      const pLinks = await page.locator('a[href*="/p/"], a[href*="/reel/"]').all();
      console.log(`Profile media links found: ${pLinks.length}`);
      for (const pl of pLinks) {
        const h = await pl.getAttribute('href');
        console.log(`-> ${h}`);
      }
    } catch (e: any) {
      console.log('Profile fetch error:', e.message);
    }
  }

  await browser.close();
  process.exit(0);
}

testInstagramPlaywright('bellingham').catch(e => {
  console.error(e);
  process.exit(1);
});
