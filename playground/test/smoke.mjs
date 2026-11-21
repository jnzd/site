// Smoke test for the browser build of Lex, run under Node.
// Usage: node smoke.mjs <js|wasm> <path to lexweb build> <lex checkout>
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [kind, build, lex] = process.argv.slice(2);
const require = createRequire(import.meta.url);

const sab = new SharedArrayBuffer(4);
const flag = new Int32Array(sab);
const worker = new Worker(new URL('./z3-node-worker.mjs', import.meta.url), { workerData: { sab } });
await new Promise((ok) => worker.once('message', ok));

let queries = 0;
globalThis.lexZ3Check = (script) => {
  queries++;
  Atomics.store(flag, 0, 0);
  worker.postMessage(script);
  Atomics.wait(flag, 0, 0);
  return ['', 'sat', 'unsat', 'unknown'][Atomics.load(flag, 0)];
};

process.on('exit', (code) => console.log(`[${kind}] exit code ${code}`));
let t0 = performance.now();
if (kind === 'js') require(path.resolve(build, 'lexweb.bc.js'));
else require(path.resolve(build, 'lexweb.bc.wasm.js'));
while (typeof globalThis.lexRun !== 'function') await new Promise((r) => setTimeout(r, 5));
console.log(`[${kind}] loaded in ${Math.round(performance.now() - t0)} ms`);

const file = (rel) => readFileSync(path.join(lex, rel), 'utf8');
const assets = {
  'assets/lexdoc.css': file('assets/lexdoc.css'),
  'assets/lexdoc.js': file('assets/lexdoc.js'),
};
function run(mode, main, files) {
  const all = { ...assets, ...files };
  queries = 0;
  const t = performance.now();
  let r;
  try {
    r = globalThis.lexRun(mode, main, Object.keys(all), Object.values(all), '5000');
  } catch (e) {
    console.log(`\n=== ${mode} ${main}: lexRun threw`, e, e?.stack);
    process.exitCode = 1;
    return { ok: false, output: String(e), smt: [] };
  }
  const ms = Math.round(performance.now() - t);
  console.log(`\n=== ${mode} ${main}: ok=${r.ok}, ${ms} ms, ${queries} Z3 queries`);
  console.log(r.output.length > 600 ? r.output.slice(0, 600) + `\n... (${r.output.length} chars)` : r.output);
  if (r.smt.length) console.log('--- first SMT-LIB query:\n' + r.smt[0][0] + '--- answer: ' + r.smt[0][1]);
  return r;
}

// Must pass: plain compilation and Lexdoc.
let failed = 0;
const must = (r) => { if (!r.ok) failed++; };
must(run('mfotl', 'tutorial.lex', { 'tutorial.lex': file('example/tutorial/tutorial.lex') }));
must(run('doc', 'tutorial.lex', { 'tutorial.lex': file('example/tutorial/tutorial.lex') }));

// Refinements, which go through Z3. Reported, not required: some examples
// in the repository may not type-check at this commit.
const gdprXml = file('example/GDPR/GDPR.xml');
const results = {
  'hello.lex (imports GDPR formex)': run('mfotl', 'hello.lex', { 'hello.lex': file('example/unit/hello.lex'), 'GDPR/GDPR.xml': gdprXml }),
  'GDPR/paper.rex': run('mfotl', 'GDPR/paper.rex', { 'GDPR/paper.rex': file('example/GDPR/paper.rex'), 'GDPR/paper.lex': file('example/GDPR/paper.lex'), 'GDPR/GDPR.xml': gdprXml }),
  'GDPR/minitwit.rex': run('mfotl', 'GDPR/minitwit.rex', { 'GDPR/minitwit.rex': file('example/GDPR/minitwit.rex'), 'GDPR/paper.lex': file('example/GDPR/paper.lex'), 'GDPR/GDPR.xml': gdprXml }),
  'evaluation minitwit_gdpr.rex': run('mfotl', 'ev/minitwit_gdpr.rex', { 'ev/minitwit_gdpr.rex': file('evaluation/01_formalization/minitwit_gdpr.rex'), 'ev/gdpr.lex': file('evaluation/01_formalization/gdpr.lex'), 'ev/GDPR.xml': file('evaluation/01_formalization/GDPR.xml') }),
  'epd/epd.rex': run('mfotl', 'epd/epd.rex', { 'epd/epd.rex': file('example/e-privacy-directive/epd.rex'), 'epd/epd.lex': file('example/e-privacy-directive/epd.lex') }),
};
console.log('\n=== summary');
for (const [k, r] of Object.entries(results)) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${k}: ${r.smt.length} Z3 queries, answers ${r.smt.map((q) => q[1]).join(',') || '-'}`);
await worker.terminate();
process.exit(failed ? 1 : 0);
