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
  for (const ed of stackEditors.values()) ed.setVim($('vim').checked);
};

const stackMode = () => document.body.classList.contains('layout-stack') && matchMedia('(max-width: 860px)').matches;
let stackEditors = new Map();
function setFiles(ex) {
  files = { ...ex.files };
  main = ex.main;
  editor.reset();
  showTab(main);
  buildStack();
}
// Stack: one editor per source file, main first, each under its name.
function buildStack() {
  if (!document.body.classList.contains('layout-stack')) return;
  const box = $('stack-src');
  box.replaceChildren();
  stackEditors = new Map();
  const names = Object.keys(files).filter((f) => !f.endsWith('.xml')).sort((a, b) => (b === main) - (a === main));
  for (const f of names) {
    const sec = document.createElement('section');
    sec.className = 'stack-file';
    sec.innerHTML = `<h3 class="stack-head"></h3><div class="stack-ed"></div>`;
    sec.firstChild.textContent = f.split('/').pop();
    if (f === main) sec.firstChild.append(Object.assign(document.createElement('span'), { className: 'main', textContent: 'main' }));
    box.append(sec);
    const ed = LexEditor.createEditor(sec.lastChild, () => $('run').click(), { vimMode: $('vim').checked });
    ed.show(f, files[f]);
    stackEditors.set(f, ed);
  }
}
// The files as the editors have them.
function syncFiles() {
  if (stackMode()) for (const [f, ed] of stackEditors) files[f] = ed.value;
  else files[current] = editor.value;
}
function showTab(name) {
  if (current && !stackMode()) files[current] = editor.value;
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
  if (typeof renderStrip === 'function') {
    renderStrip();
    renderPicker($('tabs').parentNode, Object.keys(files).filter((f) => !f.endsWith('.xml')).map((f) => [f, f.split('/').pop() + (f === main ? '  (main)' : '')]), name, showTab);
  }
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
  status(`Loading Lex${e === 'wasm' ? ' (wasm)' : ''}…`);
  $('run').disabled = true;
  delete self.lexRun;
  lexReady = (async () => {
    await loadScript(e === 'wasm' ? 'lexweb.bc.wasm.js' : 'lexweb.bc.js');
    for (let i = 0; typeof self.lexRun !== 'function'; i++) {
      if (i > 1000) throw new Error('Lex did not start');
      await new Promise((r) => setTimeout(r, 10));
    }
    status(`Lex loaded${e === 'wasm' ? ' (wasm)' : ''} in ${Math.round(performance.now() - t)} ms`);
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
    const res = { ok: r.ok, output: r.output, sig: r.sig || '', mfotl: r.mfotl || '', log: r.log || '', smt: Array.from(r.smt, (q) => [q[0], q[1]]), passes: pass };
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

// ---- MFOTL output: one tab per file -----------------------------------------
// Lex writes the signature and the formula as two files (lex -o name gives
// name.sig and name.mfotl); the playground shows them as two tabs. Warnings go
// in their own strip above. Everything else Lex prints while compiling is
// in "Lex's debug output", collapsed under the output.
const WARNING = /^Warning\b/;
let lastResult = null, outFiles = [], outTab = null;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (s) => LexEditor.highlightMfotl(s);

function showWarnings(r, d) {
  // Lexdoc's run can warn too (say, about a docstring); each warning once.
  const log = r.log + (d ? '\n' + d.log : '');
  const ws = [...new Set(log.split('\n'))].filter((l) => WARNING.test(l)).map((l) => l.replace(/^Warning( at [^:]*)?:\s*/, (m, at) => (at ? at.slice(4) + ': ' : '')));
  $('warnings').hidden = ws.length === 0;
  $('warnings').replaceChildren(...ws.map((w) => Object.assign(document.createElement('li'), { textContent: w })));
}

// Clex.to_string prints "Signature:\n<sig>\n\nFormula:\n<formula>\n".
function splitOutput(text) {
  const m = text.match(/^Signature:\n([\s\S]*?)\n\nFormula:\n([\s\S]*?)\n*$/);
  return m ? { sig: m[1], mfotl: m[2] } : null;
}

function renderOutput(r) {
  const base = (main || 'lex').split('/').pop().replace(/\.\w+$/, '');
  // The two files `lex -o name` writes; older builds only had the printed text.
  const split = !r.ok ? null : (r.sig || r.mfotl) ? { sig: r.sig, mfotl: r.mfotl } : splitOutput(r.output);
  outFiles = split
    ? [{ id: 'sig', name: base + '.sig', text: split.sig }, { id: 'mfotl', name: base + '.mfotl', text: split.mfotl }]
    : [{ id: 'errors', name: r.ok ? 'output' : 'errors', text: r.output.trim() }];
  if (document.body.classList.contains('layout-two')) outFiles.push({ id: 'lexdoc', name: 'Lexdoc', text: '' });
  if (!outFiles.some((f) => f.id === outTab)) outTab = outFiles[split ? 1 : 0].id;
  showOutTab(outTab);
  renderStackOut();
}
// Stack: every output file one after another, each under its name with its
// own copy and download buttons.
// Folded output files, kept across runs (by id: sig, mfotl, errors).
const stackFolded = new Set();
function renderStackOut() {
  if (!document.body.classList.contains('layout-stack')) return;
  $('stack-out').replaceChildren(...outFiles.filter((f) => f.id !== 'lexdoc').map((f) => {
    const sec = document.createElement('section');
    sec.className = 'stack-file';
    sec.innerHTML = `<h3 class="stack-head"><button class="fold" aria-expanded="true"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg><span></span></button><button class="icon-button" title="Copy" aria-label="Copy"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5h8v8h-8zM10.5 5.5v-3h-8v8h3"/></svg></button>`
      + `<button class="icon-button" title="Download" aria-label="Download"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5V14.5h12v-2"/></svg></button></h3>`;
    sec.querySelector('span').textContent = f.name;
    const [fold, copy, dl] = sec.querySelectorAll('button');
    const setFold = (folded) => {
      sec.classList.toggle('folded', folded);
      fold.setAttribute('aria-expanded', String(!folded));
      fold.title = (folded ? 'Expand ' : 'Collapse ') + f.name;
      if (folded) stackFolded.add(f.id); else stackFolded.delete(f.id);
    };
    setFold(stackFolded.has(f.id));
    fold.onclick = () => setFold(!sec.classList.contains('folded'));
    copy.onclick = async () => { try { await navigator.clipboard.writeText(f.text); flash(copy, 'Copied'); } catch { flash(copy, 'Copy failed'); } };
    dl.onclick = () => lexSaveHtml(f.text + '\n', f.id === 'trace' || f.id === 'errors' ? f.name + '.txt' : f.name, 'text/plain');
    if (f.id === 'trace') sec.insertAdjacentHTML('beforeend', `<div class="trace">${f.html}</div>`);
    else {
      const pre = document.createElement('pre');
      pre.className = 'stack-pre' + (f.id === 'errors' ? ' error' : '');
      pre.innerHTML = f.id === 'errors' ? esc(f.text) : hl(f.text);
      sec.append(pre);
    }
    return sec;
  }));
}
function showOutTab(id) {
  outTab = id;
  const f = outFiles.find((x) => x.id === id);
  $('out-tabs').replaceChildren(...outFiles.map((x) => {
    const b = document.createElement('button');
    b.textContent = document.body.classList.contains('layout-chips') && /\.(sig|mfotl)$/.test(x.name) ? x.name.replace(/^.*\./, '.') : x.name;
    b.title = x.name;
    b.className = x.id === id ? 'active' : '';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(x.id === id));
    b.onclick = () => showOutTab(x.id);
    return b;
  }));
  renderStrip();
  renderPicker($('out-tabs').parentNode, outFiles.map((x) => [x.id, x.name]), id, showOutTab);
  $('out-tools').hidden = id === 'lexdoc';
  document.body.dataset.outtab = id;
  if (id === 'lexdoc') { $('output').hidden = true; $('trace').hidden = true; fitDoc(); return; }
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
// Every style has a light and a dark version and follows the page's theme.
const DOC_STYLES = { lexdoc: ['lexdoc/original.css'], site: ['theme.css', 'lexdoc/site.css'], statute: ['lexdoc/statute.css'] };
const DOC_BACKGROUND = { lexdoc: ['#fff', '#15171a'], site: ['var(--panel)', 'var(--panel)'], statute: ['#fbfaf6', '#1a1916'] };
const pageDark = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; };
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
  $('doc').style.background = DOC_BACKGROUND[style][pageDark() ? 1 : 0];
  $('doc').srcdoc = withTheme(lastDoc)
    .replace(BOOTSTRAP, '<link rel="stylesheet" href="vendor/bootstrap.min.css">')
    .replace(JQUERY, '<script src="vendor/jquery.min.js"></script>')
    .replace('</head>', links + '</head>')
    .replace('</body>', '<script src="lexdoc/tap.js"></script></body>');
}
$('docstyle').onchange = () => {
  try { localStorage.setItem('lexdoc-style', $('docstyle').value); } catch {}
  renderDoc();
};
// Lexdoc follows the light/dark toggle.
new MutationObserver(() => renderDoc())
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
      viewer: `<script>${await fetchText('lexdoc/save.js')}\n${await fetchText('lexdoc/viewer.js')}\n${await fetchText('lexdoc/tap.js')}</script>`,
    };
  })();
  const p = await standaloneParts;
  const title = (lastDoc.match(/<title>([^<]*)<\/title>/) || [, 'Lexdoc'])[1];
  const bar = `<div class="lex-viewer-bar" data-file="${docName()}"><span class="t">${title}</span>`
    + `<select aria-label="Style"><option value="site">Site style</option><option value="statute">Statute style</option><option value="lexdoc">Original style</option></select>`
    + `<button type="button" data-act="theme" title="Dark" aria-label="Dark"><svg class="moon" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z"/></svg>`
    + `<svg class="sun" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"/></svg></button>`
    + `<button type="button" data-act="print" title="Print"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6V1.5h8V6M4 12H2V6h12v6h-2M4 9.5h8v5H4z"/></svg><span>Print</span></button>`
    + `<button type="button" data-act="pdf" title="Save as PDF (in the print dialog, choose Save as PDF)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 1.5H3.5v13h9v-10zM9.5 1.5v3h3"/><path d="M5.5 9.5h5M5.5 12h3.5" /></svg><span>PDF</span></button>`
    + `<button type="button" data-act="download" title="Download as HTML"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v9M4.5 7 8 10.5 11.5 7M2 12.5V14.5h12v-2"/></svg><span>HTML</span></button></div>`;
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
  document.body.classList.remove('running');
  // On a phone, a dot on Output and Lexdoc in the section bar until seen.
  for (const l of jumpLinks) if (!l.classList.contains('current') && l.dataset.for !== 'source-pane') l.classList.add('fresh');
  lastDoc = d && d.ok ? d.output : null;
  if (lastDoc !== null) renderDoc();
  showWarnings(r, d);
  $('run').disabled = false;
  const n = r.smt.length;
  $('status').className = 'status ' + (r.ok ? 'ok' : 'bad');
  status(`${r.ok ? 'Done' : 'Errors'} in ${Math.round(performance.now() - runStart)} ms` +
         (n ? `, ${n} Z3 ${n === 1 ? 'query' : 'queries'}` : '') + (r.passes > 1 ? `, ${r.passes} passes` : ''));
  renderOutput(r);
  showDoc();
  $('smt').hidden = n === 0;
  // What else Lex printed while compiling (its compiler's debug lines).
  const debug = r.log.split('\n').filter((l) => l.trim() !== '' && !WARNING.test(l)).join('\n');
  $('lexlog').hidden = !debug;
  $('lexlog-text').textContent = debug;
  $('smt-list').replaceChildren(...r.smt.map(([s, a], i) => {
    const p = document.createElement('pre');
    p.textContent = `; query ${i + 1}: Z3 answered ${a}` +
      (a === 'unsat' ? ' (the implication holds)' : a === 'sat' ? ' (counterexample exists)' : '') + '\n' + s;
    return p;
  }));
}

$('run').onclick = async () => {
  if (typeof self.lexRun !== 'function') return;
  syncFiles();
  $('run').disabled = true;
  $('status').className = 'status running';
  document.body.classList.add('running');
  status('Running Lex…');
  runStart = performance.now();
  await showOutputPane();
  // Let the spinner paint before Lex takes over the page's thread.
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    const r = await runLex('mfotl', main, files);
    // Lexdoc from the same sources; Z3's answers are cached, so this is quick.
    const d = r.ok ? await runLex('doc', main, files) : null;
    showResult(r, d);
  }
  catch (e) {
    // Do not leave the previous program's output standing next to the error.
    $('run').disabled = false;
    document.body.classList.remove('running');
    $('status').className = 'status bad';
    status(String(e));
    lastResult = null;
    $('lexlog').hidden = true;
    renderOutput({ ok: false, output: String(e), log: '', smt: [] });
  }
};
// Lex runs as JavaScript (js_of_ocaml). The WebAssembly build
// (wasm_of_ocaml) is not offered on the page: the choice means nothing to a
// visitor, and loading it crashes Safari's page process (iPad, 2026-11).
// ?engine=wasm loads it, for testing.
const wantWasm = new URLSearchParams(location.search).get('engine') === 'wasm';

// ---- Phones: the section bar ---------------------------------------------
const phone = matchMedia('(max-width: 860px)');
// The bar's Run mirrors the main one (enabled, disabled, running).
new MutationObserver(() => { $('run-mini').disabled = $('run').disabled; })
  .observe($('run'), { attributes: true, attributeFilter: ['disabled'] });
$('run-mini').onclick = () => $('run').click();
// Marks the section that fills most of the screen.
const jumpLinks = [...document.querySelectorAll('#jump a')];
const inView = new Map();
const sectionObserver = new IntersectionObserver((entries) => {
  if (document.body.classList.contains('layout-tabbed') && phone.matches) return;
  for (const e of entries) inView.set(e.target.id, e.isIntersecting ? e.intersectionRect.height : 0);
  const [best, seen] = [...inView].sort((x, y) => y[1] - x[1])[0] || [];
  for (const l of jumpLinks) l.classList.toggle('current', seen > 0 && l.dataset.for === best);
  // A result not looked at yet keeps its dot until its section is in view.
  for (const l of jumpLinks) if (l.classList.contains('current')) l.classList.remove('fresh');
}, { threshold: [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1] });
for (const id of ['source-pane', 'output-pane', 'lexdoc']) sectionObserver.observe($(id));
// On a phone the output is below the editor: bring it into view on Run, so
// the progress shows, and wait for the scroll before Lex blocks the page.
// Phone layouts, prototypes for now (?layout=…, links in the footer; the
// classes are set by a script at the top of <body>, before the first paint):
//   scroll  panes stacked, the section bar on top jumps between them
//   tabs    one section at a time, bar at the bottom, panes as boxes
//   flow    as tabs, but each tab scrolls with the page: no boxes in boxes
//   top     as flow, tabs on top, Run as a round button at the bottom
//   two     as flow, two tabs: Source and Result (files and Lexdoc as tabs)
//   strip   as flow, no section tabs: one row with every file, in and out
//   picker  as top, but a section's files are a menu instead of tabs
//   stack   as top, no file tabs: a section's files one after another, each
//           under its name (an editor per source file)
//   chips   as top, a section's files as a small switch of fixed size
const LAYOUTS = ['scroll', 'tabs', 'flow', 'top', 'two', 'strip', 'picker', 'stack', 'chips'];
const layout = LAYOUTS.find((l) => document.body.classList.contains('layout-' + l)) || 'scroll';
const tabbed = layout !== 'scroll';
const flow = document.body.classList.contains('flow');
for (const a of document.querySelectorAll('.proto a')) if (a.search === '?layout=' + layout) a.classList.add('here');
const SECTIONS = ['source-pane', 'output-pane', 'lexdoc'];
// What each tab shows. In "two", Result holds both (Lexdoc is a file tab).
const VIEW = layout === 'two' ? { 'source-pane': ['source-pane'], 'output-pane': ['output-pane', 'lexdoc'] } : null;
let currentView = 'source-pane';
function setView(id) {
  currentView = id;
  const show = VIEW ? VIEW[id] : [id];
  for (const s of SECTIONS) $(s).classList.toggle('off-view', !show.includes(s));
  for (const l of jumpLinks) l.classList.toggle('current', l.dataset.for === id);
  for (const l of jumpLinks) if (l.dataset.for === id) l.classList.remove('fresh');
  scrollTo(0, 0);
  requestAnimationFrame(fitDoc);
  renderStrip();
}
// The strip: every file in one row; picking one shows its section.
function renderStrip() {
  if (!document.body.classList.contains('layout-strip')) return;
  const btn = (label, active, cls, onclick) => {
    const b = document.createElement('button');
    b.textContent = label; b.className = (active ? 'active ' : '') + cls; b.onclick = onclick;
    return b;
  };
  const items = Object.keys(files).filter((f) => !f.endsWith('.xml')).map((f) =>
    btn(f.split('/').pop(), currentView === 'source-pane' && f === current, 'in', () => { setView('source-pane'); showTab(f); }));
  items.push(Object.assign(document.createElement('span'), { className: 'sep' }));
  const outs = outFiles.length ? outFiles.filter((x) => x.id !== 'lexdoc') : [{ id: null, name: 'output' }];
  for (const x of outs) {
    const b = btn(x.name, currentView === 'output-pane' && (x.id === outTab || !x.id), 'out', () => { setView('output-pane'); if (x.id) showOutTab(x.id); });
    if (x === outs[0]) b.append(Object.assign(document.createElement('span'), { className: 'run-state' }));
    items.push(b);
  }
  items.push(btn('Lexdoc', currentView === 'lexdoc', 'out', () => setView('lexdoc')));
  $('strip').replaceChildren(...items);
  $('strip').querySelector('.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
// The picker: a menu of a section's files, in place of its tabs.
function renderPicker(row, entries, active, onpick) {
  if (!document.body.classList.contains('layout-picker')) return;
  let sel = row.querySelector('.file-pick');
  if (!sel) { sel = document.createElement('select'); sel.className = 'file-pick'; sel.setAttribute('aria-label', 'File'); row.prepend(sel); }
  sel.replaceChildren(...entries.map(([v, label]) => new Option(label, v, false, v === active)));
  sel.onchange = () => onpick(sel.value);
}
if (layout === 'two') document.querySelector('#jump a[data-for="output-pane"]').firstChild.textContent = 'Result';
if (tabbed) setView('source-pane');
for (const l of jumpLinks) l.addEventListener('click', (e) => {
  if (phone.matches && tabbed) { e.preventDefault(); setView(l.dataset.for); }
});

// In the flow layouts the Lexdoc frame takes the height of its document, so
// the page scrolls rather than a box inside it.
function fitDoc() {
  const f = $('doc');
  if (!(flow && phone.matches)) { f.style.height = ''; return; }
  const d = f.contentDocument;
  if (d && d.documentElement) f.style.height = d.documentElement.scrollHeight + 'px';
}
$('doc').addEventListener('load', () => {
  fitDoc();
  try { new ResizeObserver(fitDoc).observe($('doc').contentDocument.body); } catch {}
});
phone.addEventListener('change', fitDoc);

// On a phone the output is out of sight when Run is pressed: bring it into
// view, so the progress shows, before Lex blocks the page.
async function showOutputPane() {
  if (!phone.matches) return;
  if (tabbed) { setView('output-pane'); return; }
  const pane = $('output-pane'), top = pane.getBoundingClientRect().top;
  if (top >= 0 && top < innerHeight / 3) return;
  pane.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await new Promise((r) => { addEventListener('scrollend', r, { once: true }); setTimeout(r, 700); });
}

$('example').onchange = () => { current = null; setFiles(examples[$('example').value]); };

(async () => {
  const res = await fetch('examples.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`cannot load the examples (HTTP ${res.status})`);
  examples = await res.json();
  $('example').replaceChildren(...Object.keys(examples).map((k) => new Option(k, k)));
  setFiles(examples[Object.keys(examples)[0]]);
  loadLex(wantWasm ? 'wasm' : 'js');
})().catch((e) => { status(`Could not start: ${e.message}. Reload the page.`); console.error(e); });
