// Lex playground: Lex (OCaml compiled to JS or Wasm) and Z3 (z3-solver, Wasm)
// both run in the page. Z3 is loaded only when a refinement needs it.
const $ = (id) => document.getElementById(id);
const status = (s) => { $('status').textContent = s; };

let examples = {}, files = {}, current = null, main = null;
let runStart = 0;
// Apple keyboards run with Cmd+Enter (CodeMirror's Mod), others with Ctrl+Enter.
const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
if (apple) {
  document.querySelector('.shortcut .mod').textContent = '⌘';
  $('run').title = 'Run (⌘+Enter)';
}
let vimOn = false;
try { vimOn = localStorage.getItem('lex-vim') === '1'; } catch {}
const editor = LexEditor.createEditor($('source'), () => $('run').click(), { vimMode: vimOn });
$('vim').checked = vimOn;
$('vim').onchange = () => {
  try { localStorage.setItem('lex-vim', $('vim').checked ? '1' : '0'); } catch {}
  editor.setVim($('vim').checked);
};

function setFiles(ex) {
  files = { ...ex.files };
  main = ex.main;
  editor.reset();
  showTab(main);
}
function showTab(name) {
  if (current) files[current] = editor.value;
  current = name;
  editor.show(name, files[name]);
  // Large legal-text sources (formex / Akoma Ntoso XML) are sent along but not shown.
  $('tabs').replaceChildren(...Object.keys(files).filter((f) => !f.endsWith('.xml')).map((f) => {
    const b = document.createElement('button');
    b.textContent = f.split('/').pop();
    if (f === main) b.append(Object.assign(document.createElement('span'), { className: 'main', textContent: 'main' }));
    b.className = f === name ? 'active' : '';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(f === name));
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
    const res = { ok: r.ok, output: r.output, log: r.log || '', smt: Array.from(r.smt, (q) => [q[0], q[1]]), passes: pass };
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

// Lex prints debug lines while compiling ("g = …", "{p = ; fs = …}", "-> …").
// They are hidden unless "Show debug output" is ticked; warnings stay.
// Warnings go in their own strip above the output; every other line Lex
// prints on the way (debug lines, the typed formula) only with "Debug output".
const WARNING = /^Warning\b/;
let lastResult = null;

function outputText(r) {
  const lines = r.log.split('\n').filter((l) => l.trim() !== '' && !WARNING.test(l));
  return ($('debug').checked && lines.length ? lines.join('\n') + '\n\n' : '') + r.output;
}
function showWarnings(r) {
  const ws = r.log.split('\n').filter((l) => WARNING.test(l)).map((l) => l.replace(/^Warning( at [^:]*)?:\s*/, (m, at) => (at ? at.slice(4) + ': ' : '')));
  $('warnings').hidden = ws.length === 0;
  $('warnings').replaceChildren(...ws.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

// MFOTL output is highlighted; error lines are marked.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function renderOutput(r) {
  const text = outputText(r);
  $('output').innerHTML = r.ok ? LexEditor.highlightMfotl(text)
    : text.split('\n').map((l) => (/error|exception|cannot/i.test(l) ? `<span class="err">${esc(l)}</span>` : esc(l))).join('\n');
}

// Lexdoc styles: extra style sheets laid over Lex's own (see web/lexdoc/).
// The page's base URL also applies inside the srcdoc frame, so relative links work.
const DOC_STYLES = { lexdoc: [], site: ['theme.css', 'lexdoc/site.css'], statute: ['lexdoc/statute.css'] };
const DOC_BACKGROUND = { lexdoc: 'white', site: 'var(--panel)', statute: '#fbfaf6' };
let lastDoc = null;
try { const s = localStorage.getItem('lexdoc-style'); if (s in DOC_STYLES) $('docstyle').value = s; } catch {}
function renderDoc() {
  if (lastDoc === null) return;
  const style = $('docstyle').value;
  const theme = document.documentElement.dataset.theme;
  const links = ['lexdoc/base.css', ...DOC_STYLES[style]].map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  $('doc').style.background = DOC_BACKGROUND[style];
  $('doc').srcdoc = lastDoc
    .replace('<html lang="en">', `<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>`)
    .replace('</head>', links + '</head>');
}
$('docstyle').onchange = () => {
  try { localStorage.setItem('lexdoc-style', $('docstyle').value); } catch {}
  renderDoc();
};
// The site style follows the light/dark toggle.
new MutationObserver(() => { if ($('docstyle').value === 'site') renderDoc(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// ---- Lexdoc full-size, print and download --------------------------------
// A standalone copy of the Lexdoc page: the style sheets inlined, and for the
// site style its fonts as data URLs, so the file works anywhere.
async function standaloneDoc({ print = false } = {}) {
  const style = $('docstyle').value;
  const theme = document.documentElement.dataset.theme;
  let css = '';
  for (const h of ['lexdoc/base.css', ...DOC_STYLES[style]]) {
    let text = await (await fetch(h)).text();
    for (const [m, f] of [...text.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)]) {
      const b = new Uint8Array(await (await fetch(f)).arrayBuffer());
      let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
      text = text.replace(m, `url(data:font/woff2;base64,${btoa(bin)})`);
    }
    css += text + '\n';
  }
  const page = { lexdoc: '', site: 'body.container{max-width:64rem}', statute: '' }[style];
  return lastDoc
    .replace('<html lang="en">', `<html lang="en"${theme ? ` data-theme="${theme}"` : ''}>`)
    .replace('</head>', `<style>${css}${page}</style>` +
      (print ? '<script>addEventListener("load", () => setTimeout(print, 400))<\/script>' : '') + '</head>');
}
const docName = () => (main || 'lex').split('/').pop().replace(/\.\w+$/, '') + '-lexdoc.html';
async function openDoc(print) {
  // Open the tab right away (browsers block pop-ups opened after an await).
  const w = window.open('', '_blank');
  const url = URL.createObjectURL(new Blob([await standaloneDoc({ print })], { type: 'text/html' }));
  if (w) w.location = url; else location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('doc-open').onclick = () => openDoc(false);
$('doc-print').onclick = () => openDoc(true);
$('doc-download').onclick = async () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([await standaloneDoc()], { type: 'text/html' }));
  a.download = docName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
};

// ---- Output: MFOTL and Lexdoc, both from every run --------------------------
let view = 'mfotl';
try { if (localStorage.getItem('lex-view') === 'doc') view = 'doc'; } catch {}
function setView(v) {
  view = v;
  try { localStorage.setItem('lex-view', v); } catch {}
  for (const [id, on] of [['view-mfotl', v === 'mfotl'], ['view-doc', v === 'doc']]) {
    $(id).classList.toggle('active', on);
    $(id).setAttribute('aria-selected', String(on));
  }
  const docShown = v === 'doc' && lastDoc !== null;
  $('doc-tools').hidden = !docShown;
  $('doc').hidden = !docShown;
  $('output').hidden = docShown;
  if (!lastResult) return;
  if (v === 'doc' && lastDocResult && !lastDocResult.ok) {
    // Lexdoc can fail where MFOTL works (Lex's Lexdoc does not handle every refinement).
    $('output').innerHTML = `<span class="note">Lex could not build Lexdoc for this program.</span>\n\n${esc(lastDocResult.output.trim())}`;
  } else if (!docShown) renderOutput(lastResult);
}
$('view-mfotl').onclick = () => setView('mfotl');
$('view-doc').onclick = () => setView('doc');
let lastDocResult = null;

function showResult(r, d) {
  lastResult = r;
  lastDocResult = d;
  lastDoc = d && d.ok ? d.output : null;
  if (lastDoc !== null) renderDoc();
  showWarnings(r);
  $('run').disabled = false;
  const n = r.smt.length;
  $('status').className = 'status ' + (r.ok ? 'ok' : 'bad');
  status(`${r.ok ? 'Done' : 'Errors'} in ${Math.round(performance.now() - runStart)} ms` +
         (n ? `, ${n} Z3 ${n === 1 ? 'query' : 'queries'}` : '') + (r.passes > 1 ? `, ${r.passes} passes` : ''));
  setView(view);
  $('smt').hidden = n === 0;
  $('smt-list').replaceChildren(...r.smt.map(([s, a], i) => {
    const p = document.createElement('pre');
    p.textContent = `; query ${i + 1}: Z3 answered ${a}` +
      (a === 'unsat' ? ' (the implication holds)' : a === 'sat' ? ' (counterexample exists)' : '') + '\n' + s;
    return p;
  }));
}

$('debug').onchange = () => { if (lastResult) setView(view); };

$('run').onclick = async () => {
  if (typeof self.lexRun !== 'function') return;
  files[current] = editor.value;
  $('run').disabled = true;
  $('status').className = 'status';
  status('Running Lex…');
  runStart = performance.now();
  try {
    const r = await runLex('mfotl', main, files);
    // Lexdoc from the same sources; Z3's answers are cached, so this is quick.
    const d = r.ok ? await runLex('doc', main, files) : null;
    showResult(r, d);
  }
  catch (e) { $('run').disabled = false; status(String(e)); }
};
$('engine').onchange = () => loadLex($('engine').value);
$('example').onchange = () => { current = null; setFiles(examples[$('example').value]); };

(async () => {
  const res = await fetch('examples.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`cannot load the examples (HTTP ${res.status})`);
  examples = await res.json();
  $('example').replaceChildren(...Object.keys(examples).map((k) => new Option(k, k)));
  setFiles(examples[Object.keys(examples)[0]]);
  // JS by default for now; WebAssembly is faster but needs WebAssembly GC.
  $('engine').value = 'js';
  loadLex('js');
})().catch((e) => { status(`Could not start: ${e.message}. Reload the page.`); console.error(e); });
