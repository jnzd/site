// Builds every entry in entries/ (see entries/*/entry.json) into one static site in dist/.
//   node build.mjs          one-off build
//   node build.mjs --serve  build, watch for changes, serve on localhost
//
// An entry of type "thesis" is a LaTeX thesis from a submodule in content/, built
// to dist/<path>/; the talks it lists are built to dist/<talk.path>/ and link
// back to it.
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
import { renderHome } from './lib/home.mjs';
import { renderSlides } from './lib/slides.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const at = (...p) => path.join(root, ...p);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const site = JSON.parse(fs.readFileSync(at('site.json'), 'utf8'));

// A relative link from the page at dist/<from>/ to dist/<to>/ (both without slashes at the ends).
export function rel(from, to) {
  const up = from ? from.split('/').map(() => '..') : [];
  const href = [...up, ...(to ? to.split('/') : [])].join('/');
  return href ? href + '/' : './';
}
const rootOf = (p) => (p ? p.split('/').map(() => '../').join('') : '');

function loadEntries() {
  return fs.readdirSync(at('entries')).sort()
    .filter((d) => fs.existsSync(at('entries', d, 'entry.json')))
    .map((d) => ({ dir: at('entries', d), ...JSON.parse(fs.readFileSync(at('entries', d, 'entry.json'), 'utf8')) }));
}

// Links written from the site root ("/lex/talk/") become relative to the page.
const siteLink = (from, url) => (url.startsWith('/') ? rel(from, url.replace(/^\/|\/$/g, '')) : url);

function renderThesis(entry) {
  const src = at(entry.source);
  const from = (f) => path.join(entry.dir, f);
  const { tex, meta: texMeta, state } = preprocess(src, entry);
  const meta = { ...texMeta, ...(entry.meta || {}) };
  // pandoc drops \dj (đ) from author names, so hand it a patched copy of the bibliography.
  const bib = path.join(os.tmpdir(), `thesis-site-refs-${process.pid}-${path.basename(entry.dir)}.bib`);
  fs.writeFileSync(bib, fs.readFileSync(path.join(src, entry.bibliography), 'utf8').replace(/\{?\\dj\b\s*(\{\})?\}?/g, 'đ'));
  const raw = execFileSync('pandoc', [
    '-f', 'latex', '-t', 'html', '--katex', '--wrap=none', '--citeproc', '--bibliography', bib,
  ], { input: tex, cwd: src, encoding: 'utf8', maxBuffer: 1 << 28 });
  const macros = katexMacros(src, entry.macroFiles || [], entry.katexMacros || {});
  const referenceLinks = Object.fromEntries(Object.entries(entry.referenceLinks || {})
    .map(([k, links]) => [k, links.map((l) => ({ ...l, url: siteLink(entry.path, l.url) }))]));
  const { html, toc, warnings } = postprocess(raw, {
    state, macros, figuresDir: from('figures'), tikzFiles: entry.tikzFigures || [],
    bibliographyOrder: entry.bibliographyOrder || [],
    referenceLinks,
    referenceUpdates: entry.referenceUpdates || {},
    linkUpdates: entry.linkUpdates || {},
    inserts: (entry.inserts || []).map((x) => ({ after: x.after, before: x.before, html: fs.readFileSync(from(x.file), 'utf8') })),
    imageReplacements: entry.imageReplacements || {}, imageClasses: entry.imageClasses || {}, sortCitations: !!entry.sortCitations,
  });
  fs.rmSync(bib, { force: true });
  for (const w of warnings) console.warn(`warning (${entry.path}):`, w);

  const people = [meta.supervisor, meta.advisors].filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('');
  const byline = [
    meta.author && `<span class="author">${esc(meta.author)}</span>`,
    `<span>${esc([meta.thesistype, entry.institution].filter(Boolean).join(', '))}</span>`,
    meta.date && `<span>${esc(meta.date)}</span>`,
  ].filter(Boolean).join('');
  // The thesis PDF is the main action; a related paper gets a quieter button
  // (its full title shows on hover).
  const pub = entry.publication;
  const actions = [
    entry.pdf && `<a class="button primary" href="${esc(entry.pdf)}">Read the PDF</a>`,
    pub && `<a class="button" href="${esc(pub.url)}" title="${esc(pub.title)} (${esc(pub.venue)})">${esc(pub.label)} <span aria-hidden="true">↗</span></a>`,
    entry.code && `<a class="button" href="${esc(entry.code)}">Source</a>`,
    // Every talk, by its short name, in the order entry.json lists them.
    ...(entry.talks || []).map((t) => `<a class="button" href="${esc(rel(entry.path, t.path))}" title="${esc(t.title)}">${esc(t.short || t.title)}</a>`),
  ].filter(Boolean).join('');

  const page = fillTemplate({
    lang: 'en', title: meta.title, subtitle: entry.subtitle || '', description: entry.subtitle || meta.title,
    author: meta.author, institution: [meta.department, entry.institution].filter(Boolean).join(', '), date: meta.date,
    byline, people, actions, rail: renderRail(toc),
    heroVisual: entry.heroVisual ? fs.readFileSync(from(entry.heroVisual), 'utf8') : '', content: html,
    root: rootOf(entry.path), scripts: (entry.scripts || []).map((s) => `<script src="${esc(s)}" defer></script>`).join('\n'),
    bodyClass: 'thesis',
  });
  // Reference numbers as they appear on the thesis page, for the talks.
  const refs = {};
  [...html.matchAll(/<li id="ref-([^"]+)">/g)].forEach((m, i) => { refs[m[1]] = i + 1; });
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  // Figure and table numbers ("Fig 2.3"), for {n} in talks' thesis links.
  const labels = {};
  for (const m of html.matchAll(/<figure[^>]*\sid="([^"]+)"[\s\S]*?<span class="label">([^<]+)<\/span>/g)) labels[m[1]] = m[2].trim();
  return { page, toc, refs, ids, labels, meta, macros };
}

// The shared header names the site and links home; every page gets it.
function siteHeader(rootHref) {
  return `<nav class="site-nav" aria-label="Site"><a class="site-name" href="${esc(rootHref || './')}">${esc(site.name)}</a></nav>`;
}

function fillTemplate(fill) {
  fill = { siteHeader: siteHeader(fill.root), siteName: site.name, ...fill };
  return fs.readFileSync(at('theme/template.html'), 'utf8')
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

// A talk (see lib/talk.mjs) becomes dist/<talk.path>/index.html, linked to its thesis.
function renderTalkPage(talk, entry, thesis) {
  const figuresDir = talk.figures ? at('entries', talk.figures) : path.join(entry.dir, 'figures');
  const { html, toc, warnings } = renderTalk(fs.readFileSync(at('entries', talk.source), 'utf8'), {
    macros: thesis.macros, thesisToc: thesis.toc, thesisRefs: thesis.refs,
    thesisIds: thesis.ids, thesisLabels: thesis.labels, figuresDir, thesisHref: rel(talk.path, entry.path),
  });
  for (const w of warnings) console.warn(`warning (${talk.path}):`, w);
  const actions = [
    `<button class="button primary" type="button" data-present>Present <span aria-hidden="true">▸</span></button>`,
    `<a class="button" href="${esc(rel(talk.path, entry.path))}">${esc(talk.thesisLabel || 'Read the thesis')}</a>`,
    talk.slides && `<a class="button" href="slides/">Original slides</a>`,
    // The other talks, by their short name ("Thesis talk", "Practical-work talk").
    ...(entry.talks || []).filter((t) => t.path !== talk.path).map((t) => `<a class="button" href="${esc(rel(talk.path, t.path))}" title="${esc(t.title)}">${esc(t.short || t.title)}</a>`),
  ].filter(Boolean).join('');
  const byline = [
    `<span class="author">${esc(thesis.meta.author)}</span>`,
    talk.kind && `<span>${esc(talk.kind)}</span>`,
    talk.date && `<span>${esc(talk.date)}</span>`,
  ].filter(Boolean).join('');
  const r = rootOf(talk.path);
  return fillTemplate({
    lang: 'en', title: talk.title, subtitle: talk.subtitle || '', description: talk.subtitle || talk.title,
    author: thesis.meta.author, institution: entry.institution, date: talk.date,
    byline, people: '', actions, rail: renderRail(toc),
    heroVisual: talk.heroVisual ? fs.readFileSync(at('entries', talk.heroVisual), 'utf8') : '', content: html,
    root: r, bodyClass: 'talk',
    scripts: [`${r}talk.js`, ...(talk.scripts || [])].map((s) => `<script src="${esc(s)}" defer></script>`).join('\n'),
  });
}

function copyFonts(pkg, files, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.copyFileSync(at('node_modules', pkg, f), path.join(dest, path.basename(f)));
}

async function build() {
  const started = Date.now();
  const dist = at('dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });

  // Links to the stylesheet and scripts carry a hash of their content, so a
  // browser fetches the new file after every change instead of a cached one.
  const shared = ['style.css', 'theme.js', 'site.js', 'talk.js', 'slides.js', 'favicon.svg', 'apple-touch-icon.png'];
  const stamps = Object.fromEntries(shared.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(at('theme', f))).digest('hex').slice(0, 10)]));
  const stamp = (html) => html.replace(/(href|src)="((?:\.\.\/)*)(style\.css|theme\.js|site\.js|talk\.js|slides\.js|favicon\.svg)"/g, (_, attr, r, f) => `${attr}="${r}${f}?v=${stamps[f]}"`);
  const write = (p, html) => {
    fs.mkdirSync(path.join(dist, p), { recursive: true });
    fs.writeFileSync(path.join(dist, p, 'index.html'), stamp(html));
  };

  const entries = loadEntries();
  const cards = [];
  for (const entry of entries.filter((e) => e.type === 'thesis')) {
    const out = path.join(dist, entry.path);
    fs.mkdirSync(out, { recursive: true });
    // Images the thesis includes (PDFs are replaced by their SVG twins).
    if (entry.assets) {
      for (const a of [].concat(entry.assets)) {
        fs.cpSync(path.join(at(entry.source), a), path.join(out, a), { recursive: true, filter: (f) => !f.endsWith('.pdf') });
      }
    }
    // Hand-made web assets of the entry (figures, scripts) are served next to its page.
    for (const d of entry.public || []) fs.cpSync(path.join(entry.dir, d), path.join(out, d), { recursive: true });
    const thesis = renderThesis(entry);
    write(entry.path, thesis.page);
    cards.push({ entry, title: thesis.meta.title, date: thesis.meta.date, visual: entry.heroVisual ? fs.readFileSync(path.join(entry.dir, entry.heroVisual), 'utf8') : '' });
    for (const talk of entry.talks || []) {
      write(talk.path, renderTalkPage(talk, entry, thesis));
      for (const f of talk.public || []) fs.cpSync(at('entries', f), path.join(dist, talk.path, path.basename(f)), { recursive: true });
      if (talk.slides) await renderSlides({
        pdf: at(talk.slides), out: path.join(dist, talk.path, 'slides'),
        title: `${talk.title} · Original slides`, label: 'Original slides', back: '../', backLabel: 'Talk',
        links: [{ href: rel(talk.path + '/slides', entry.path), label: 'Thesis' }], root: rootOf(talk.path + '/slides'), stamp,
      });
    }
    if (entry.thesisPdf) await renderSlides({
      pdf: path.join(at(entry.source), entry.thesisPdf), out: path.join(out, 'pdf'), kind: 'page',
      title: `${thesis.meta.title} · PDF`, label: 'Thesis (PDF)', back: '../', backLabel: 'Web version',
      root: rootOf(entry.path + '/pdf'), stamp,
    });
  }
  write('', renderHome({ site, cards, fillTemplate, esc, rel }));

  for (const f of shared) fs.copyFileSync(at('theme', f), path.join(dist, f));

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
  if (site.cname) fs.writeFileSync(path.join(dist, 'CNAME'), site.cname + '\n');

  console.log(`built dist/ in ${Date.now() - started} ms`);
}

await build();

if (process.argv.includes('--serve')) {
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => build().catch((e) => console.error(e.message)), 100);
  };
  for (const dir of [at('theme'), at('entries'), at('lib')]) fs.watch(dir, { recursive: true }, rebuild);
  fs.watch(at('content'), { recursive: true }, (_event, file) => {
    if (file && /\.(tex|bib)$/.test(file)) rebuild();
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
