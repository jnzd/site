// Opens the assembled playground in headless Chrome (with COOP/COEP served by
// serve.mjs), runs the examples and prints what the page shows.
// Usage: node browser.mjs [chrome executable] [engine js|wasm] [url]
// Without a url it serves dist/ locally on port 8123.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const engine = process.argv[3] || 'js';
const url = process.argv[4];
const server = url ? null
  : spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, '8123'], { stdio: 'inherit' });
if (server) await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.argv[2] || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => console.log('  console:', m.text()));
  page.on('pageerror', (e) => { console.log('  pageerror:', e.message); failed++; });
  const t0 = Date.now();
  await page.goto(url || 'http://localhost:8123/');
  await page.waitForFunction(() => !document.getElementById('run').disabled, null, { timeout: 60000 });
  if (engine !== 'js') {
    await page.selectOption('#engine', engine);
    await page.waitForFunction((e) => document.getElementById('status').textContent.includes(`(${e})`) &&
      !document.getElementById('run').disabled, engine, { timeout: 60000 });
  }
  console.log(`page ready in ${Date.now() - t0} ms: ${await page.textContent('#status')}`);
  const examples = await page.$$eval('#example option', (os) => os.map((o) => o.value));
  for (const ex of examples) {
    await page.selectOption('#example', ex);
    const t = Date.now();
    await page.evaluate(() => document.getElementById('run').click());
    try {
      await page.waitForFunction(() => /^(Done|Errors)/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
    } catch (e) {
      console.log(`=== ${ex}: no result; status is "${await page.textContent('#status')}"`);
      failed++;
      continue;
    }
    const status = await page.textContent('#status');
    const out = await page.textContent('#output');
    const answers = await page.$$eval('#smt-list pre', (ps) => ps.map((p) => p.textContent.split('\n')[0]));
    console.log(`\n=== ${ex}: ${status} (wall ${Date.now() - t} ms)\n${out.slice(0, 300)}\n...\n${out.slice(-1500)}\n${answers.join('\n')}`);
    if (!status.startsWith('Done')) failed++;
    if (/^(g = |\{p = |Signature:)/m.test(out)) { console.log('  FAIL: the .mfotl tab shows more than the formula'); failed++; }
    const tabs = await page.$$eval('#out-tabs button', (bs) => bs.map((b) => b.textContent));
    if (tabs.length !== 3 || !tabs[0].endsWith('.sig') || !tabs[1].endsWith('.mfotl')) { console.log('  FAIL: output tabs are', tabs); failed++; }
    await page.click('#out-tabs button:nth-child(1)');
    if (/LET|Formula/.test(await page.textContent('#output'))) { console.log('  FAIL: the .sig tab shows the formula'); failed++; }
    await page.click('#out-tabs button:nth-child(3)');
    console.log('  trace:', await page.$$eval('#trace .trace-def', (s) => s.length), 'blocks');
    await page.click('#out-tabs button:nth-child(2)');
    await page.screenshot({ path: `screenshot-${examples.indexOf(ex)}.png` });
  }
} finally {
  await browser.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
