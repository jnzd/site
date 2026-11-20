// Takes screenshots of the playground for review (desktop light, desktop dark,
// phone). Usage: node screenshots.mjs <chrome> <out dir>
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [chrome = '/usr/bin/google-chrome', out = 'screenshots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, '8125'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: chrome, args: ['--no-sandbox'] });

async function open(opts) {
  const page = await browser.newPage(opts);
  await page.goto('http://localhost:8125/');
  await page.waitForFunction(() => !document.getElementById('run').disabled, null, { timeout: 60000 });
  return page;
}
async function run(page, example, mode = 'mfotl') {
  await page.selectOption('#example', example);
  await page.click('#run');
  await page.waitForFunction(() => /^(Done|Errors)/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  await page.click(mode === 'doc' ? '#view-doc' : '#view-mfotl');
  await page.waitForTimeout(300);
}
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };

let page = await open(desktop);
await run(page, 'Tutorial (GDPR excerpt)');
await page.screenshot({ path: `${out}/1-tutorial-mfotl.png` });
await run(page, 'Tutorial (GDPR excerpt)', 'doc');
await page.waitForTimeout(1500); // Lexdoc loads Bootstrap from a CDN
await page.screenshot({ path: `${out}/2-tutorial-lexdoc.png` });
for (const style of ['statute', 'lexdoc']) {
  await page.selectOption('#docstyle', style);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/2-tutorial-lexdoc-${style}.png` });
}
await page.selectOption('#docstyle', 'site');
await run(page, 'MiniTwit refines the GDPR (uses Z3)');
await page.evaluate(() => { document.getElementById('smt').open = true; });
await page.screenshot({ path: `${out}/3-minitwit-refinement-z3.png` });
await page.close();

page = await open({ ...desktop, colorScheme: 'dark' });
await run(page, 'MiniTwit refines the GDPR (uses Z3)');
await page.screenshot({ path: `${out}/4-minitwit-dark.png` });
await page.close();

page = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
await run(page, 'Tutorial (GDPR excerpt)');
await page.screenshot({ path: `${out}/5-phone.png`, fullPage: true });
await browser.close();
server.kill();
console.log('screenshots in', out);
