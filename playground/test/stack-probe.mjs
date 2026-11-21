// Diagnostic: compares how deep JS can recurse on the page vs in a worker,
// and whether Lex finishes the MiniTwit example on the page's main thread
// (Z3 answers stubbed as "unsat", which is what Z3 returns for it).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const server = spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, '8124'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));
const browser = await chromium.launch({ executablePath: process.argv[2] || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto('http://localhost:8124/examples.json');
const depth = 'let d=0;function f(){d++;f()};try{f()}catch(e){};d';
console.log('recursion depth, page:', await page.evaluate(depth));
console.log('recursion depth, worker:', await page.evaluate((src) => new Promise((ok) => {
  const w = new Worker(URL.createObjectURL(new Blob([`postMessage((()=>{${src.replace(/;d$/, ';return d')}})())`])));
  w.onmessage = (e) => ok(e.data);
}), depth));
const r = await page.evaluate(async () => {
  self.lexZ3Check = () => 'unsat';
  await new Promise((ok, err) => { const s = document.createElement('script'); s.src = 'lexweb.bc.js'; s.onload = ok; s.onerror = err; document.head.append(s); });
  const ex = (await (await fetch('examples.json')).json())['MiniTwit refines the GDPR (uses Z3)'];
  const assets = await (await fetch('lexdoc-assets.json')).json();
  const all = { ...assets, ...ex.files };
  const t = performance.now();
  const r = self.lexRun('mfotl', ex.main, Object.keys(all), Object.values(all), '5000');
  return { ok: r.ok, ms: Math.round(performance.now() - t), tail: r.output.slice(-200), queries: r.smt.length };
});
console.log('Lex on the main thread:', JSON.stringify(r));
await browser.close();
server.kill();
