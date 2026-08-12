import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 }
  });
  const page = await context.newPage();
  console.log('Navigating to popular bellingham...');
  await page.goto('https://www.instagram.com/popular/bellingham/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(3000);

  const links = await page.locator('a').all();
  console.log(`Found ${links.length} total anchor links.`);
  for (const link of links) {
    const href = await link.getAttribute('href');
    const text = await link.innerText();
    if (href) {
      console.log(`Href: "${href}" | Text: "${text.substring(0, 50)}..."`);
    }
  }
  await browser.close();
}
main();
