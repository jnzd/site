// Runs the Lex compiler. Z3 queries go to the page; the worker blocks on a
// shared Int32 until the page writes the answer (1 sat, 2 unsat, 3 unknown).
let flag = null;

self.lexZ3Check = (script) => {
  Atomics.store(flag, 0, 0);
  self.postMessage({ type: 'z3', script });
  Atomics.wait(flag, 0, 0);
  return ['', 'sat', 'unsat', 'unknown'][Atomics.load(flag, 0)];
};

async function load(engine) {
  importScripts(engine === 'wasm' ? 'lexweb.bc.wasm.js' : 'lexweb.bc.js');
  for (let i = 0; typeof self.lexRun !== 'function'; i++) {
    if (i > 600) throw new Error('Lex did not start');
    await new Promise((r) => setTimeout(r, 10));
  }
}

let assets = null;
self.onmessage = async ({ data: m }) => {
  if (m.type === 'init') {
    flag = new Int32Array(m.sab);
    let engine = m.engine;
    try { await load(engine); }
    catch (e) {
      if (engine !== 'wasm') { self.postMessage({ type: 'error', message: String(e) }); return; }
      console.warn('Wasm build failed, falling back to JS:', e);
      engine = 'js';
      await load(engine);
    }
    assets = await (await fetch('lexdoc-assets.json')).json();
    self.postMessage({ type: 'ready', engine });
  } else if (m.type === 'run') {
    const all = { ...assets, ...m.files };
    const r = self.lexRun(m.mode, m.main, Object.keys(all), Object.values(all), '5000');
    self.postMessage({ type: 'result', ok: r.ok, output: r.output, smt: Array.from(r.smt, (q) => [q[0], q[1]]) });
  }
};
