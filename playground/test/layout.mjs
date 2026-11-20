// Checks the playground for overlapping elements at phone, tablet and desktop
// widths: the page's controls, and Lexdoc's two columns in every style.
// Exits non-zero on any overlap. Usage: node layout.mjs [chrome]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
let failed = 0;
{
  const s = spawn(process.execPath, [new URL('../serve.mjs', import.meta.url).pathname, '8127'], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const b = await chromium.launch({ executablePath: process.argv[2] || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const [name, opts] of [['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }], ['tablet', { viewport: { width: 820, height: 1000 } }], ['desktop', { viewport: { width: 1280, height: 820 } }]]) {
    const p = await b.newPage({ ...opts, colorScheme: 'dark' });
    p.on('pageerror', e => { console.log(name, 'pageerror', e.message); failed++; });
    await p.goto('http://localhost:8127/');
    await p.waitForFunction(() => !document.getElementById('run').disabled);
    // page controls: pairwise overlap among visible interactive/bar elements
    const pageOverlaps = async () => p.evaluate(() => {
      const els = [...document.querySelectorAll('.bar > *, .tabs-row > *, #warnings, .frame, .site-nav > *, .intro > *, details')].filter(e => e.offsetParent !== null);
      const out = [];
      for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
        const a = els[i].getBoundingClientRect(), c = els[j].getBoundingClientRect();
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1)
          out.push(`${els[i].id || els[i].className || els[i].tagName} x ${els[j].id || els[j].className || els[j].tagName}`);
      }
      return out;
    });
    await p.click('#run');
    await p.waitForFunction(() => /^(Done|Errors)/.test(document.getElementById('status').textContent));
    let o = await pageOverlaps(); failed += o.length;
    console.log(name, 'mfotl: warnings', await p.$$eval('#warnings li', l => l.length), 'page overlaps', JSON.stringify(o));
    await p.selectOption('#mode', 'doc');
    await p.click('#run');
    await p.waitForFunction(() => /^(Done|Errors)/.test(document.getElementById('status').textContent));
    for (const st of ['site', 'statute', 'lexdoc']) {
      await p.selectOption('#docstyle', st);
      await p.waitForTimeout(1200);
      const f = p.frame({ url: /srcdoc/ }) || p.frames()[1];
      const bad = await f.evaluate(() => {
        const out = [];
        for (const row of document.querySelectorAll('.row')) {
          const cols = [...row.children].filter(c => c.offsetParent !== null);
          for (let i = 0; i + 1 < cols.length; i++) {
            const right = cols[i + 1].getBoundingClientRect();
            if (right.top >= cols[i].getBoundingClientRect().bottom - 1) continue; // stacked
            for (const e of cols[i].querySelectorAll('*')) {
              const r = e.getBoundingClientRect();
              if (r.width && r.right > right.left + 1 && r.bottom > right.top && r.top < right.bottom) { out.push(e.textContent.slice(0, 30)); break; }
            }
          }
        }
        const sw = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
        return { overlaps: out.slice(0, 5), horizontalScroll: sw };
      });
      o = await pageOverlaps(); failed += o.length + bad.overlaps.length + (bad.horizontalScroll ? 1 : 0);
      console.log(name, st, JSON.stringify(bad), 'page overlaps', JSON.stringify(o));
    }
    await p.close();
  }
  await b.close(); s.kill();
}
console.log(failed ? `${failed} layout problems` : 'no overlaps');
process.exit(failed ? 1 : 0);
