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
  const r = globalThis.lexRun(mode, main, Object.keys(all), Object.values(all), '5000');
  const ms = Math.round(performance.now() - t);
  console.log(`\n=== ${mode} ${main}: ok=${r.ok}, ${ms} ms, ${queries} Z3 queries`);
  console.log(r.output.length > 1500 ? r.output.slice(0, 1500) + `\n... (${r.output.length} chars)` : r.output);
  if (r.smt.length) console.log('--- first SMT-LIB query:\n' + r.smt[0][0] + '--- answer: ' + r.smt[0][1]);
  return r;
}

let failed = 0;
const check = (r) => { if (!r.ok) failed++; };
check(run('mfotl', 'hello.lex', { 'hello.lex': file('example/unit/hello.lex') }));
check(run('mfotl', 'tutorial.lex', { 'tutorial.lex': file('example/tutorial/tutorial.lex') }));
check(run('mfotl', 'epd/epd.rex', {
  'epd/epd.lex': file('example/e-privacy-directive/epd.lex'),
  'epd/epd.rex': file('example/e-privacy-directive/epd.rex'),
}));
check(run('doc', 'tutorial.lex', { 'tutorial.lex': file('example/tutorial/tutorial.lex') }));
await worker.terminate();
process.exit(failed ? 1 : 0);
