// Lex playground: the page keeps the editor responsive and runs Z3; Lex runs
// in a worker (lex-worker.js) and waits for Z3's answers through shared memory.
const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };

let examples = {}, files = {}, current = null, main = null;
let worker = null, flag = null, workerReady = false, runStart = 0;

function setFiles(ex) {
  files = { ...ex.files };
  main = ex.main;
  showTab(main);
}
function showTab(name) {
  if (current) files[current] = $('source').value;
  current = name;
  $('source').value = files[name];
  $('tabs').replaceChildren(...Object.keys(files).map((f) => {
    const b = document.createElement('button');
    b.textContent = f.split('/').pop() + (f === main ? ' (main)' : '');
    b.className = f === name ? 'active' : '';
    b.onclick = () => showTab(f);
    return b;
  }));
}

// ---- Z3, loaded on the first query --------------------------------------
let z3 = null;
function loadZ3() {
  if (!z3) z3 = (async () => {
    const t = performance.now();
    status('Loading Z3 (first refinement check only)…');
    for (const src of ['z3/z3-built.js', 'z3-glue.js']) {
      await new Promise((ok, err) => {
        const s = document.createElement('script');
        s.src = src; s.onload = ok; s.onerror = () => err(new Error('cannot load ' + src));
        document.head.append(s);
      });
    }
    const { Z3 } = await window.z3Init();
    const cfg = Z3.mk_config();
    const ctx = Z3.mk_context(cfg);
    console.log(`Z3 ready in ${Math.round(performance.now() - t)} ms`);
    return { Z3, ctx };
  })();
  return z3;
}
async function answerZ3(script) {
  let code = 3;
  try {
    const { Z3, ctx } = await loadZ3();
    status('Checking refinement with Z3…');
    const out = await Z3.eval_smtlib2_string(ctx, '(reset)\n' + script);
    const last = out.trim().split('\n').pop().trim();
    code = last === 'sat' ? 1 : last === 'unsat' ? 2 : 3;
  } catch (e) { console.error(e); }
  Atomics.store(flag, 0, code);
  Atomics.notify(flag, 0);
}

// ---- Lex worker -----------------------------------------------------------
function startWorker(engine) {
  if (worker) worker.terminate();
  workerReady = false;
  $('run').disabled = true;
  const t = performance.now();
  status(`Loading Lex (${engine})…`);
  flag = new Int32Array(new SharedArrayBuffer(4));
  worker = new Worker('lex-worker.js');
  worker.onmessage = ({ data: m }) => {
    if (m.type === 'ready') {
      workerReady = true;
      $('run').disabled = false;
      status(`Lex loaded (${m.engine}) in ${Math.round(performance.now() - t)} ms`);
      if (m.engine !== engine) $('engine').value = m.engine;
    } else if (m.type === 'z3') {
      answerZ3(m.script);
    } else if (m.type === 'result') {
      showResult(m);
    } else if (m.type === 'error') {
      status(m.message);
    }
  };
  worker.postMessage({ type: 'init', sab: flag.buffer, engine });
}

function showResult(r) {
  $('run').disabled = false;
  const n = r.smt.length;
  status(`${r.ok ? 'Done' : 'Errors'} in ${Math.round(performance.now() - runStart)} ms` +
         (n ? `, ${n} Z3 ${n === 1 ? 'query' : 'queries'}` : ''));
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

$('run').onclick = () => {
  if (!workerReady) return;
  files[current] = $('source').value;
  $('run').disabled = true;
  status('Running…');
  runStart = performance.now();
  worker.postMessage({ type: 'run', mode: $('mode').value, main, files });
};
$('engine').onchange = () => startWorker($('engine').value);
$('example').onchange = () => { current = null; setFiles(examples[$('example').value]); };
$('source').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('run').click(); }
});

(async () => {
  if (!self.crossOriginIsolated) {
    status('Waiting for cross-origin isolation (the page reloads once)…');
    if (!navigator.serviceWorker) status('This browser cannot isolate the page, so Lex cannot run here.');
    return;
  }
  examples = await (await fetch('examples.json')).json();
  $('example').replaceChildren(...Object.keys(examples).map((k) => new Option(k, k)));
  setFiles(examples[Object.keys(examples)[0]]);
  const wasmGC = WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,95,1,127,0]));
  const engine = wasmGC ? 'wasm' : 'js';
  $('engine').value = engine;
  startWorker(engine);
})();
