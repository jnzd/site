// Opens the assembled playground in headless Chrome (with COOP/COEP served by
// serve.mjs), runs the examples and prints what the page shows.
// Usage: node browser.mjs [chrome executable]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, '8123'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.argv[2] || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
let failed = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => console.log('  console:', m.text()));
  page.on('pageerror', (e) => { console.log('  pageerror:', e.message); failed++; });
  const t0 = Date.now();
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => !document.getElementById('run').disabled, null, { timeout: 60000 });
  console.log(`page ready in ${Date.now() - t0} ms: ${await page.textContent('#status')}`);
  const examples = await page.$$eval('#example option', (os) => os.map((o) => o.value));
  for (const ex of examples) {
    await page.selectOption('#example', ex);
    const t = Date.now();
    await page.click('#run');
    await page.waitForFunction(() => /^(Done|Errors)/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
    const status = await page.textContent('#status');
    const out = await page.textContent('#output');
    const answers = await page.$$eval('#smt-list pre', (ps) => ps.map((p) => p.textContent.split('\n')[0]));
    console.log(`\n=== ${ex}: ${status} (wall ${Date.now() - t} ms)\n${out.slice(0, 300)}\n...\n${out.slice(-1500)}\n${answers.join('\n')}`);
    if (!status.startsWith('Done')) failed++;
    if (/^(g = |\{p = )/m.test(out)) { console.log('  FAIL: debug lines shown by default'); failed++; }
    await page.check('#debug');
    if (!/^g = /m.test(await page.textContent('#output'))) console.log('  note: no debug lines with the toggle on');
    await page.uncheck('#debug');
    await page.screenshot({ path: `screenshot-${examples.indexOf(ex)}.png` });
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
