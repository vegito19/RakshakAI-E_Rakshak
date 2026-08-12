import { chromium } from 'playwright';
import * as fs from 'fs';

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  // Try 1: Mobile context WITH cookies
  console.log('--- Context with Cookies ---');
  const context1 = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 }
  });
  
  const cookiesPath = 'crawler/cookies/instagram.json';
  if (fs.existsSync(cookiesPath)) {
    try {
      const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
      await context1.addCookies(cookies);
      console.log('Loaded cookies.');
    } catch (e) {}
  }
  
  const page1 = await context1.newPage();
  await page1.goto('https://www.instagram.com/popular/bellingham/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page1.waitForTimeout(3000);
  const links1 = await page1.locator('a').all();
  console.log(`With cookies found links: ${links1.length}`);

  // Try 2: Mobile context WITHOUT cookies
  console.log('\n--- Context without Cookies ---');
  const context2 = await browser.newContext({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 }
  });
  const page2 = await context2.newPage();
  await page2.goto('https://www.instagram.com/popular/bellingham/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page2.waitForTimeout(3000);
  const links2 = await page2.locator('a').all();
  console.log(`Without cookies found links: ${links2.length}`);

  await browser.close();
}
main();
