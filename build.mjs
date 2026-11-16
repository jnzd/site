// Builds the LaTeX thesis (see site.config.json) into a single static page in dist/.
//   node build.mjs          one-off build
//   node build.mjs --serve  build, watch for changes, serve on localhost
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { preprocess, katexMacros } from './lib/preprocess.mjs';
import { postprocess } from './lib/postprocess.mjs';
import { renderTalk } from './lib/talk.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(root, ...p);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const config = JSON.parse(fs.readFileSync(at('site.config.json'), 'utf8'));
const thesisDir = path.resolve(root, process.env.THESIS_DIR || config.thesisDir);

function render() {
  const { tex, meta, state } = preprocess(thesisDir);
  // pandoc drops \dj (đ) from author names, so hand it a patched copy of the bibliography.
  const bib = path.join(os.tmpdir(), `thesis-site-refs-${process.pid}.bib`);
  fs.writeFileSync(bib, fs.readFileSync(path.join(thesisDir, 'refs.bib'), 'utf8').replace(/\{?\\dj\b\s*(\{\})?\}?/g, 'đ'));
  const raw = execFileSync('pandoc', [
    '-f', 'latex', '-t', 'html', '--katex', '--wrap=none', '--citeproc', '--bibliography', bib,
  ], { input: tex, cwd: thesisDir, encoding: 'utf8', maxBuffer: 1 << 28 });
  const { html, toc, warnings } = postprocess(raw, {
    state, macros: katexMacros(thesisDir), figuresDir: at('public/figures'), tikzFiles: config.tikzFigures || [],
    bibliographyOrder: config.bibliographyOrder || [],
    referenceLinks: config.referenceLinks || {},
    referenceUpdates: config.referenceUpdates || {},
    linkUpdates: config.linkUpdates || {},
    inserts: (config.inserts || []).map((x) => ({ after: x.after, html: fs.readFileSync(at(x.file), 'utf8') })),
  });
  fs.rmSync(bib, { force: true });
  for (const w of warnings) console.warn('warning:', w);

  const people = [meta.supervisor, meta.advisors].filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('');
  const byline = [
    meta.author && `<span class="author">${esc(meta.author)}</span>`,
    `<span>${esc([meta.thesistype, config.institution].filter(Boolean).join(', '))}</span>`,
    meta.date && `<span>${esc(meta.date)}</span>`,
  ].filter(Boolean).join('');
  // The thesis PDF is the main action; a related paper gets a quieter button
  // (its full title shows on hover).
  const pub = config.publication;
  const actions = [
    config.pdf && `<a class="button primary" href="${esc(config.pdf)}">Read the PDF</a>`,
    pub && `<a class="button" href="${esc(pub.url)}" title="${esc(pub.title)} (${esc(pub.venue)})">${esc(pub.label)} <span aria-hidden="true">↗</span></a>`,
    config.code && `<a class="button" href="${esc(config.code)}">Source</a>`,
  ].filter(Boolean).join('');
  const rail = renderRail(toc);

  const fill = {
    lang: 'en', title: meta.title, subtitle: config.subtitle || '', description: config.subtitle || meta.title,
    author: meta.author, institution: [meta.department, config.institution].filter(Boolean).join(', '), date: meta.date,
    byline, people, actions, rail,
    heroVisual: config.heroVisual ? fs.readFileSync(at(config.heroVisual), 'utf8') : '', content: html,
    root: '', scripts: '', bodyClass: 'thesis',
  };
  // Reference numbers as they appear on the thesis page, for the talks.
  const refs = {};
  [...html.matchAll(/<li id="ref-([^"]+)">/g)].forEach((m, i) => { refs[m[1]] = i + 1; });
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  return { page: fillTemplate(fill), toc, refs, ids, meta };
}

function fillTemplate(fill) {
  return fs.readFileSync(at('src/template.html'), 'utf8')
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => fill[k] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => esc(fill[k] ?? ''));
}

// Every chapter, section and subsection gets a tick (long, medium, short);
// site.js positions them and adds the hover labels and the current trail.
function renderRail(toc) {
  return toc.map((s) =>
    `<a class="l${s.level || 1}" href="#${esc(s.id)}" data-target="${esc(s.id)}" data-num="${esc(s.num || '')}"><span class="tick"></span><span class="name">${s.num ? s.num + ' ' : ''}${esc(s.text)}</span></a>`).join('')
    + '<div class="rail-zone" aria-hidden="true"></div><div class="rail-trail" aria-hidden="true"><span class="c"></span><span class="s"></span></div>';
}

// A talk (see lib/talk.mjs) becomes dist/<slug>/index.html, linked to the thesis.
function renderTalkPage(talk, thesis) {
  const { html, toc, warnings } = renderTalk(fs.readFileSync(at(talk.source), 'utf8'), {
    macros: katexMacros(thesisDir), thesisToc: thesis.toc, thesisRefs: thesis.refs,
    thesisIds: thesis.ids, figuresDir: at('public/figures'),
  });
  for (const w of warnings) console.warn('warning:', w);
  const actions = [
    `<button class="button primary" type="button" data-present>Present <span aria-hidden="true">▸</span></button>`,
    `<a class="button" href="../">${esc(talk.thesisLabel || 'Read the thesis')}</a>`,
    talk.slides && `<a class="button" href="${esc(talk.slides)}">Original slides <span aria-hidden="true">↗</span></a>`,
  ].filter(Boolean).join('');
  const byline = [
    `<span class="author">${esc(thesis.meta.author)}</span>`,
    talk.kind && `<span>${esc(talk.kind)}</span>`,
    talk.date && `<span>${esc(talk.date)}</span>`,
  ].filter(Boolean).join('');
  return fillTemplate({
    lang: 'en', title: talk.title, subtitle: talk.subtitle || '', description: talk.subtitle || talk.title,
    author: thesis.meta.author, institution: config.institution, date: talk.date,
    byline, people: '', actions, rail: renderRail(toc), heroVisual: '', content: html,
    root: '../', scripts: '<script src="../talk.js" defer></script>', bodyClass: 'talk',
  });
}

function copyFonts(pkg, files, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.copyFileSync(at('node_modules', pkg, f), path.join(dest, path.basename(f)));
}

function build() {
  const started = Date.now();
  const dist = at('dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  if (fs.existsSync(at('public'))) fs.cpSync(at('public'), dist, { recursive: true });

  if (fs.existsSync(path.join(thesisDir, 'assets'))) fs.cpSync(path.join(thesisDir, 'assets'), path.join(dist, 'assets'), { recursive: true, filter: (f) => !f.endsWith('.pdf') });
  // Links to the stylesheet and scripts carry a hash of their content, so a
  // browser fetches the new file after every change instead of a cached one.
  const version = (f) => crypto.createHash('sha256').update(fs.readFileSync(at(f))).digest('hex').slice(0, 10);
  const stamps = { 'style.css': version('src/style.css'), 'site.js': version('src/site.js'), 'talk.js': version('src/talk.js') };
  const stamp = (html) => html.replace(/(href|src)="((?:\.\.\/)?)(style\.css|site\.js|talk\.js)"/g, (_, attr, root, f) => `${attr}="${root}${f}?v=${stamps[f]}"`);
  const thesis = render();
  fs.writeFileSync(path.join(dist, 'index.html'), stamp(thesis.page));
  for (const talk of config.talks || []) {
    fs.mkdirSync(path.join(dist, talk.slug), { recursive: true });
    fs.writeFileSync(path.join(dist, talk.slug, 'index.html'), stamp(renderTalkPage(talk, thesis)));
  }
  fs.copyFileSync(at('src/talk.js'), path.join(dist, 'talk.js'));
  fs.copyFileSync(at('src/style.css'), path.join(dist, 'style.css'));
  fs.copyFileSync(at('src/site.js'), path.join(dist, 'site.js'));

  // Self-hosted fonts and KaTeX, so the site needs no third-party requests.
  fs.mkdirSync(path.join(dist, 'katex'), { recursive: true });
  fs.copyFileSync(at('node_modules/katex/dist/katex.min.css'), path.join(dist, 'katex/katex.min.css'));
  fs.cpSync(at('node_modules/katex/dist/fonts'), path.join(dist, 'katex/fonts'), {
    recursive: true, filter: (src) => !/\.(ttf|woff)$/.test(src),
  });
  copyFonts('@fontsource/ibm-plex-sans/files', [
    'ibm-plex-sans-latin-400-normal.woff2', 'ibm-plex-sans-latin-400-italic.woff2',
    'ibm-plex-sans-latin-600-normal.woff2', 'ibm-plex-sans-latin-600-italic.woff2',
  ], path.join(dist, 'fonts'));
  copyFonts('@fontsource/ibm-plex-mono/files', ['ibm-plex-mono-latin-400-normal.woff2'], path.join(dist, 'fonts'));

  console.log(`built dist/ in ${Date.now() - started} ms`);
}

build();

if (process.argv.includes('--serve')) {
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { try { build(); } catch (e) { console.error(e.message); } }, 100);
  };
  for (const dir of [at('src'), at('public'), at('talks')]) fs.watch(dir, { recursive: true }, rebuild);
  // The thesis folder may contain this site: only react to its LaTeX sources.
  fs.watch(thesisDir, { recursive: true }, (_event, file) => {
    if (file && /\.(tex|bib)$/.test(file) && !/(^|[\\/])(node_modules|dist|\.git)[\\/]/.test(file)) rebuild();
  });

  const types = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf',
    '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4',
  };
  const port = Number(process.env.PORT) || 4321;
  http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(at('dist'), path.normalize(rel));
    if (!file.startsWith(at('dist')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  }).listen(port, () => console.log(`serving http://localhost:${port}`));
}
