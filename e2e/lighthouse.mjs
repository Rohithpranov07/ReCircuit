// Accessibility audit of S6 (auditor console, signed in) and S8 (public passport) with Lighthouse.
// usage: node lighthouse.mjs <public passport uid>
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';

const uid = process.argv[2];
const PORT = 9333;
const browser = await chromium.launchPersistentContext('', { headless: true, args: [`--remote-debugging-port=${PORT}`] });
const page = await browser.newPage();
await page.goto('http://localhost:5173/login');
await page.fill('#email', 'auditor@example.com');
await page.fill('#password', 'recircuit-demo');
await page.click('button[type=submit]');
await page.waitForURL('**/auditor');

let failed = false;
for (const [name, url] of [['S6 auditor console', 'http://localhost:5173/auditor'], ['S8 public passport', `http://localhost:5173/p/${uid}`]]) {
  const result = await lighthouse(url, { port: PORT, onlyCategories: ['accessibility'], disableStorageReset: true, output: 'json', logLevel: 'error' });
  const lhr = result.lhr;
  const score = Math.round((lhr.categories.accessibility.score ?? 0) * 100);
  console.log(`${name}: accessibility ${score}`);
  for (const a of Object.values(lhr.audits)) {
    if (a.score !== null && a.score < 1 && a.scoreDisplayMode === 'binary') console.log(`  - ${a.id}: ${a.title}`);
  }
  if (score < 90) failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
