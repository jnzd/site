// Lex playground: Lex (OCaml compiled to JS or Wasm) and Z3 (z3-solver, Wasm)
// both run in the page. Z3 is loaded only when a refinement needs it.
const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };

let examples = {}, files = {}, current = null, main = null;
let runStart = 0;

function setFiles(ex) {
  files = { ...ex.files };
  main = ex.main;
  showTab(main);
}
function showTab(name) {
  if (current) files[current] = $('source').value;
  current = name;
  $('source').value = files[name];
  // Large legal-text sources (formex / Akoma Ntoso XML) are sent along but not shown.
  $('tabs').replaceChildren(...Object.keys(files).filter((f) => !f.endsWith('.xml')).map((f) => {
    const b = document.createElement('button');
    b.textContent = f.split('/').pop() + (f === main ? ' (main)' : '');
    b.className = f === name ? 'active' : '';
    b.onclick = () => showTab(f);
    return b;
  }));
}

// ---- Z3, loaded on the first query --------------------------------------
let z3 = null;
const loadScript = (src) => new Promise((ok, err) => {
  const s = document.createElement('script');
  s.src = src; s.onload = ok; s.onerror = () => err(new Error('cannot load ' + src));
  document.head.append(s);
});
function loadZ3() {
  if (!z3) z3 = (async () => {
    if (!self.crossOriginIsolated) throw new Error('Z3 needs a cross-origin isolated page');
    const t = performance.now();
    status('Loading Z3 (first refinement check only)…');
    await loadScript('z3/z3-built.js');
    await loadScript('z3-glue.js');
    const { Z3 } = await window.z3Init();
    const ctx = Z3.mk_context(Z3.mk_config());
    console.log(`Z3 ready in ${Math.round(performance.now() - t)} ms`);
    return { Z3, ctx };
  })();
  return z3;
}
async function solve(script) {
  const { Z3, ctx } = await loadZ3();
  const out = await Z3.eval_smtlib2_string(ctx, '(reset)\n' + script);
  const last = out.trim().split('\n').pop().trim();
  return ['sat', 'unsat'].includes(last) ? last : 'unknown';
}

// ---- Lex, on the page's main thread ----------------------------------------
// Lex asks Z3 synchronously, but Z3 in the browser answers asynchronously. So
// each query Lex has not seen yet is answered "unsat" (the usual outcome: the
// refinement holds) and remembered; after the run, Z3 checks those guesses,
// and only if one was wrong does Lex run again with the real answers.
// (Lex runs here rather than in a worker because a worker's stack is about
// half as deep, which is not enough for the larger examples.)
const answers = new Map();
let guessed = [];
self.lexZ3Check = (script) => {
  if (answers.has(script)) return answers.get(script);
  guessed.push(script);
  return 'unsat';
};

let engine = 'js';
let lexReady = null;
function loadLex(e) {
  engine = e;
  const t = performance.now();
  status(`Loading Lex (${e})…`);
  $('run').disabled = true;
  delete self.lexRun;
  lexReady = (async () => {
    await loadScript(e === 'wasm' ? 'lexweb.bc.wasm.js' : 'lexweb.bc.js');
    for (let i = 0; typeof self.lexRun !== 'function'; i++) {
      if (i > 1000) throw new Error('Lex did not start');
      await new Promise((r) => setTimeout(r, 10));
    }
    status(`Lex loaded (${e}) in ${Math.round(performance.now() - t)} ms`);
    $('run').disabled = false;
  })().catch((err) => status(String(err)));
}

async function runLex(mode, main, files) {
  const assets = await (await fetch('lexdoc-assets.json')).json();
  const all = { ...assets, ...files };
  for (let pass = 1; ; pass++) {
    guessed = [];
    await new Promise((r) => setTimeout(r, 0)); // let the status line paint
    const r = self.lexRun(mode, main, Object.keys(all), Object.values(all), '5000');
    const res = { ok: r.ok, output: r.output, smt: Array.from(r.smt, (q) => [q[0], q[1]]), passes: pass };
    if (!guessed.length) return res;
    let wrong = false;
    for (const [i, s] of guessed.entries()) {
      status(`Checking refinement with Z3 (${i + 1}/${guessed.length})…`);
      const a = await solve(s);
      answers.set(s, a);
      if (a !== 'unsat') wrong = true;
    }
    if (!wrong) return res;
    status('Z3 found a counterexample; running Lex again…');
  }
}

function showResult(r) {
  $('run').disabled = false;
  const n = r.smt.length;
  status(`${r.ok ? 'Done' : 'Errors'} in ${Math.round(performance.now() - runStart)} ms` +
         (n ? `, ${n} Z3 ${n === 1 ? 'query' : 'queries'}` : '') + (r.passes > 1 ? `, ${r.passes} passes` : ''));
  const isDoc = r.ok && $('mode').value === 'doc';
  $('output').hidden = isDoc;
  $('doc').hidden = !isDoc;
  if (isDoc) $('doc').srcdoc = r.output; else $('output').textContent = r.output;
  $('smt').hidden = n === 0;
  $('smt-list').replaceChildren(...r.smt.map(([s, a], i) => {
    const p = document.createElement('pre');
    p.textContent = `; query ${i + 1}: Z3 answered ${a}` +
      (a === 'unsat' ? ' (the implication holds)' : a === 'sat' ? ' (counterexample exists)' : '') + '\n' + s;
    return p;
  }));
}

$('run').onclick = async () => {
  if (typeof self.lexRun !== 'function') return;
  files[current] = $('source').value;
  $('run').disabled = true;
  status('Running Lex…');
  runStart = performance.now();
  try { showResult(await runLex($('mode').value, main, files)); }
  catch (e) { $('run').disabled = false; status(String(e)); }
};
$('engine').onchange = () => loadLex($('engine').value);
$('example').onchange = () => { current = null; setFiles(examples[$('example').value]); };
$('source').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('run').click(); }
});

(async () => {
  examples = await (await fetch('examples.json')).json();
  $('example').replaceChildren(...Object.keys(examples).map((k) => new Option(k, k)));
  setFiles(examples[Object.keys(examples)[0]]);
  // JS by default: the Wasm build still lacks a few Jane Street runtime stubs.
  $('engine').value = 'js';
  loadLex('js');
})();
