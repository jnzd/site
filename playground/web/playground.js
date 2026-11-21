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
const loaded = new Set();
const loadScript = (src) => loaded.has(src) ? Promise.resolve() : new Promise((ok, err) => {
  const s = document.createElement('script');
  s.src = src; s.onload = () => { loaded.add(src); ok(); }; s.onerror = () => { s.remove(); err(new Error('cannot load ' + src)); };
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
  // A failed load (say, the network dropped) is tried again on the next run.
  z3.catch(() => { z3 = null; });
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

// ---- MFOTL output: one tab per file, plus Lex's own trace ------------------
// Lex writes the signature and the formula as two files (lex -o name gives
// name.sig and name.mfotl); the playground shows them as two tabs. Warnings go
// in their own strip above. Everything else Lex prints while compiling is
// in the "trace" tab, laid out by renderTrace.
const WARNING = /^Warning\b/;
let lastResult = null, outFiles = [], outTab = null;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (s) => LexEditor.highlightMfotl(s);

function showWarnings(r) {
  const ws = r.log.split('\n').filter((l) => WARNING.test(l)).map((l) => l.replace(/^Warning( at [^:]*)?:\s*/, (m, at) => (at ? at.slice(4) + ': ' : '')));
  $('warnings').hidden = ws.length === 0;
  $('warnings').replaceChildren(...ws.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

// Clex.to_string prints "Signature:\n<sig>\n\nFormula:\n<formula>\n".
function splitOutput(text) {
  const m = text.match(/^Signature:\n([\s\S]*?)\n\nFormula:\n([\s\S]*?)\n*$/);
  return m ? { sig: m[1], mfotl: m[2] } : null;
}

// Splits "a, f(b, c), d" at the commas outside brackets.
function splitTop(s) {
  const out = []; let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  if (s.slice(from).trim()) out.push(s.slice(from).trim());
  return out;
}

// For each predicate a rule defines, the compiler prints three lines
// (Compiler.compile_let_rule):
//   g = Head(x:sort, ...)                   the predicate
//   {p = <pattern>; fs = [f1, f2, ...]}     its temporal pattern and conditions
//   -> f1 ∧ f2 ∧ ...                        the formula that defines it
// and at the end the whole formula, still with each variable's sort.
function parseTrace(log, ok) {
  const lines = log.split('\n').filter((l) => l.trim() !== '' && !WARNING.test(l));
  const defs = [], other = [];
  let d = null, formula = null;
  for (const l of lines) {
    let m;
    if ((m = l.match(/^g = (.*)$/))) defs.push(d = { head: m[1], pattern: '', parts: [], body: '' });
    else if (d && (m = l.match(/^\{p = (.*?); fs = \[(.*)\]\}$/))) { d.pattern = m[1].trim(); d.parts = splitTop(m[2]); }
    else if (d && (m = l.match(/^-> (.*)$/))) { d.body = m[1]; d = null; }
    else other.push(l);
  }
  // Compiler.compile prints the formula last.
  if (ok && other.length) formula = other.pop();
  return { defs, formula, other };
}

function renderTrace(r) {
  const { defs, formula, other } = parseTrace(r.log, r.ok);
  const parts = [];
  if (!defs.length && !formula && !other.length) {
    parts.push('<p class="trace-intro">Lex printed nothing else for this program.</p>');
  } else {
    parts.push('<p class="trace-intro">What Lex prints while it compiles. Each predicate that a rule defines, with the conditions it combines and the formula it becomes; '
      + 'then the whole formula with the sort of each variable (in the .mfotl file every sort is <code>int</code>).</p>');
  }
  for (const d of defs) {
    parts.push(`<section class="trace-def"><h3>${hl(d.head)}</h3><dl>`
      + (d.pattern ? `<dt>Pattern</dt><dd>${hl(d.pattern)}</dd>` : '')
      + `<dt>Conditions</dt><dd><ol>${d.parts.map((p) => `<li>${hl(p)}</li>`).join('')}</ol></dd>`
      + `<dt>Defined as</dt><dd>${hl(d.body)}</dd></dl></section>`);
  }
  if (formula) parts.push(`<section class="trace-def"><h3>Formula, with sorts</h3><div class="trace-formula">${hl(formula)}</div></section>`);
  if (other.length) parts.push(`<section class="trace-def"><h3>Other output</h3><pre>${esc(other.join('\n'))}</pre></section>`);
  return parts.join('');
}

function renderOutput(r) {
  const base = (main || 'lex').split('/').pop().replace(/\.\w+$/, '');
  const split = r.ok ? splitOutput(r.output) : null;
  outFiles = split
    ? [{ id: 'sig', name: base + '.sig', text: split.sig }, { id: 'mfotl', name: base + '.mfotl', text: split.mfotl }]
    : [{ id: 'errors', name: r.ok ? 'output' : 'errors', text: r.output.trim() }];
  outFiles.push({ id: 'trace', name: 'trace', text: r.log.split('\n').filter((l) => l.trim() !== '' && !WARNING.test(l)).join('\n'), html: renderTrace(r) });
  if (!outFiles.some((f) => f.id === outTab)) outTab = outFiles[split ? 1 : 0].id;
  showOutTab(outTab);
}
function showOutTab(id) {
  outTab = id;
  const f = outFiles.find((x) => x.id === id);
  $('out-tabs').replaceChildren(...outFiles.map((x) => {
    const b = document.createElement('button');
    b.textContent = x.name;
    b.className = x.id === id ? 'active' : '';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(x.id === id));
    b.onclick = () => showOutTab(x.id);
    return b;
  }));
  $('out-tools').hidden = false;
  $('trace').hidden = id !== 'trace';
  $('output').hidden = id === 'trace';
  if (id === 'trace') { $('trace').innerHTML = f.html; return; }
  $('output').className = id === 'errors' ? 'error' : '';
  $('output').innerHTML = id === 'errors'
    ? f.text.split('\n').map((l) => (/error|exception|cannot/i.test(l) ? `<span class="err">${esc(l)}</span>` : esc(l))).join('\n')
    : hl(f.text);
}
$('out-copy').onclick = async () => {
  const f = outFiles.find((x) => x.id === outTab);
  try { await navigator.clipboard.writeText(f.text); flash($('out-copy'), 'Copied'); } catch { flash($('out-copy'), 'Copy failed'); }
};
$('out-download').onclick = () => {
  const f = outFiles.find((x) => x.id === outTab);
  lexSaveHtml(f.text + '\n', f.id === 'trace' ? f.name + '.txt' : f.id === 'errors' ? f.name + '.txt' : f.name, 'text/plain');
};
function flash(button, text) {
  const t = button.title;
  button.title = text; button.classList.add('done');
  setTimeout(() => { button.title = t; button.classList.remove('done'); }, 1200);
}

// Lexdoc styles: extra style sheets laid over Lex's own (see web/lexdoc/).
// base.css (layout fixes) and print.css (paper) apply to every style.
// Bootstrap and jQuery, which Lexdoc pages load from a CDN, come from the
// playground itself (vendor/), so nothing depends on a third-party server.
const DOC_STYLES = { lexdoc: [], site: ['theme.css', 'lexdoc/site.css'], statute: ['lexdoc/statute.css'] };
const DOC_BACKGROUND = { lexdoc: 'white', site: 'var(--panel)', statute: '#fbfaf6' };
const BOOTSTRAP = /<link href="https:\/\/cdn\.jsdelivr\.net\/npm\/bootstrap@[^"]*"[^>]*>/;
const JQUERY = /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/jquery@[^"]*"><\/script>/;
let lastDoc = null;
try { const s = localStorage.getItem('lexdoc-style'); if (s in DOC_STYLES) $('docstyle').value = s; } catch {}
const withTheme = (html, extra = '') => {
  const theme = document.documentElement.dataset.theme;
  return html.replace('<html lang="en">', `<html lang="en"${theme ? ` data-theme="${theme}"` : ''}${extra}>`);
};
function renderDoc() {
  if (lastDoc === null) return;
  const style = $('docstyle').value;
  const links = ['lexdoc/base.css', ...DOC_STYLES[style], 'lexdoc/print.css'].map((h) => `<link rel="stylesheet" href="${h}">`).join('');
  $('doc').style.background = DOC_BACKGROUND[style];
  $('doc').srcdoc = withTheme(lastDoc)
    .replace(BOOTSTRAP, '<link rel="stylesheet" href="vendor/bootstrap.min.css">')
    .replace(JQUERY, '<script src="vendor/jquery.min.js"></script>')
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
// One self-contained page: every style (switchable from a bar on top),
// Bootstrap, jQuery and the site fonts inlined, so it also works as a
// downloaded file, offline.
const fetchText = async (u) => (await fetch(u)).text();
async function inlineFonts(css) {
  for (const [m, f] of [...css.matchAll(/url\((fonts\/[^)]+\.woff2)\)/g)]) {
    const b = new Uint8Array(await (await fetch(f)).arrayBuffer());
    let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    css = css.replace(m, `url(data:font/woff2;base64,${btoa(bin)})`);
  }
  return css;
}
let standaloneParts = null;
async function standaloneDoc({ print = false } = {}) {
  standaloneParts ||= (async () => {
    const styleTag = async (name, files) => `<style data-style="${name}">${(await Promise.all(files.map(async (f) => inlineFonts(await fetchText(f))))).join('\n')}</style>`;
    return {
      bootstrap: `<style>${await fetchText('vendor/bootstrap.min.css')}</style>`,
      jquery: `<script>${(await fetchText('vendor/jquery.min.js')).replace(/<\/script/gi, '<\\/script')}</script>`,
      styles: `<style>${await fetchText('lexdoc/base.css')}</style>`
        + (await Promise.all(Object.entries(DOC_STYLES).map(([k, fs]) => styleTag(k, fs)))).join('')
        + `<style>${await fetchText('lexdoc/print.css')}</style><style>${await fetchText('lexdoc/viewer.css')}</style>`,
      viewer: `<script>${await fetchText('lexdoc/save.js')}\n${await fetchText('lexdoc/viewer.js')}</script>`,
    };
  })();
  const p = await standaloneParts;
  const title = (lastDoc.match(/<title>([^<]*)<\/title>/) || [, 'Lexdoc'])[1];
  const bar = `<div class="lex-viewer-bar" data-file="${docName()}"><span class="t">${title}</span>`
    + `<select aria-label="Style"><option value="site">Site style</option><option value="statute">Statute style</option><option value="lexdoc">Original style</option></select>`
    + `<button type="button" data-act="theme">Dark</button><button type="button" data-act="print">Print / PDF</button><button type="button" data-act="download">Download</button></div>`;
  return withTheme(lastDoc, ` data-style="${$('docstyle').value}"${print ? ' data-print' : ''}`)
    .replace(BOOTSTRAP, () => p.bootstrap)
    .replace(JQUERY, () => p.jquery)
    .replace('</head>', () => p.styles + '</head>')
    .replace(/(<body[^>]*>)/, (m) => m + bar)
    .replace(/<\/html>\s*$/, () => p.viewer + '</html>');
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
$('doc-download').onclick = async () => lexSaveHtml(await standaloneDoc(), docName());

// ---- Output: MFOTL next to the editor, Lexdoc in its own section below ------
let lastDocResult = null;
function showDoc() {
  const ok = lastDoc !== null;
  $('doc').hidden = !ok;
  $('doc-tools').hidden = !ok;
  $('doc-empty').hidden = ok;
  if (lastDocResult && !lastDocResult.ok)
    // Lexdoc can fail where MFOTL works (Lex's Lexdoc does not handle every refinement).
    $('doc-empty').textContent = 'Lex could not build Lexdoc for this program: ' + lastDocResult.output.trim().replace(/^Uncaught exception:\s*/, '');
  else if (!ok && lastResult) $('doc-empty').textContent = 'No Lexdoc: fix the errors above first.';
}

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
  renderOutput(r);
  showDoc();
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
  catch (e) {
    // Do not leave the previous program's output standing next to the error.
    $('run').disabled = false;
    $('status').className = 'status bad';
    status(String(e));
    lastResult = null;
    renderOutput({ ok: false, output: String(e), log: '', smt: [] });
  }
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
