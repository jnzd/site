// Builds the LaTeX thesis (see site.config.json) into a single static page in dist/.
//   node build.mjs          one-off build
//   node build.mjs --serve  build, watch for changes, serve on localhost
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { preprocess, katexMacros } from './lib/preprocess.mjs';
import { postprocess } from './lib/postprocess.mjs';

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
    referenceUpdates: config.referenceUpdates || {},
    linkUpdates: config.linkUpdates || {},
  });
  fs.rmSync(bib, { force: true });
  for (const w of warnings) console.warn('warning:', w);

  const people = [meta.supervisor, meta.advisors].filter(Boolean).map((p) => `<span>${esc(p)}</span>`).join('');
  const byline = [
    meta.author && `<span class="author">${esc(meta.author)}</span>`,
    `<span>${esc([meta.thesistype, config.institution].filter(Boolean).join(', '))}</span>`,
    meta.date && `<span>${esc(meta.date)}</span>`,
  ].filter(Boolean).join('');
  const actions = [
    config.pdf && `<a class="button" href="${esc(config.pdf)}">Read the PDF</a>`,
    config.code && `<a class="button" href="${esc(config.code)}">Source</a>`,
  ].filter(Boolean).join('');
  const pub = config.publication;
  const publication = pub
    ? `${esc(pub.text)} <a href="${esc(pub.url)}"><em>${esc(pub.title)}</em></a> (${esc(pub.venue)}).`
    : '';
  const rail = toc.map((s) =>
    `<a href="#${esc(s.id)}" data-target="${esc(s.id)}"><span class="tick"></span><span class="name">${s.num ? s.num + ' ' : ''}${esc(s.text)}</span></a>`).join('');

  const fill = {
    lang: 'en', title: meta.title, subtitle: config.subtitle || '', description: config.subtitle || meta.title,
    author: meta.author, institution: [meta.department, config.institution].filter(Boolean).join(', '), date: meta.date,
    byline, people, actions, publication, rail, content: html,
  };
  return fs.readFileSync(at('src/template.html'), 'utf8')
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => fill[k] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => esc(fill[k] ?? ''));
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
  fs.writeFileSync(path.join(dist, 'index.html'), render());
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
  for (const dir of [at('src'), at('public')]) fs.watch(dir, { recursive: true }, rebuild);
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
