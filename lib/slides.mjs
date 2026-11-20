// A PDF (slides or a thesis) as a page of images: dist/.../slides/index.html
// plus one WebP per page. Pages are rendered with pdftoppm and cached in
// .cache/ by the PDF's hash, so a rebuild only re-renders a changed PDF.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const cacheRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.cache', 'pdf');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function renderPages(pdf, width) {
  const hash = crypto.createHash('sha256').update(fs.readFileSync(pdf)).update(String(width)).update('q86').digest('hex').slice(0, 16);
  const dir = path.join(cacheRoot, hash);
  if (!fs.existsSync(path.join(dir, 'done'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('pdftoppm', ['-png', '-scale-to-x', String(width), '-scale-to-y', '-1', pdf, path.join(dir, 'p')]);
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
      const n = Number(f.match(/(\d+)\.png$/)[1]);
      await sharp(path.join(dir, f)).webp({ quality: 86 }).toFile(path.join(dir, String(n).padStart(2, '0') + '.webp'));
      fs.rmSync(path.join(dir, f));
    }
    fs.writeFileSync(path.join(dir, 'done'), '');
  }
  return dir;
}

// kind: 'slide' (wide pages) or 'page' (a document).
export async function renderSlides({ pdf, out, title, label, back, backLabel, links = [], kind = 'slide', root, fillTemplate, stamp }) {
  // Two sizes: the large one for high-density screens and full-screen slides.
  const base = kind === 'slide' ? 1600 : 1240;
  const dir = await renderPages(pdf, base);
  const dir2 = await renderPages(pdf, base * 2);
  fs.mkdirSync(out, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webp')).sort();
  let w = 0, h = 0;
  for (const f of files) {
    fs.copyFileSync(path.join(dir, f), path.join(out, f));
    fs.copyFileSync(path.join(dir2, f), path.join(out, f.replace('.webp', '@2x.webp')));
    if (!w) ({ width: w, height: h } = await sharp(path.join(dir, f)).metadata());
  }
  const noun = kind === 'slide' ? 'Slide' : 'Page';
  const imgs = files.map((f, i) => `<figure class="sheet" id="p${i + 1}"><img src="${f}" srcset="${f} ${w}w, ${f.replace('.webp', '@2x.webp')} ${w * 2}w" sizes="${kind === 'slide' ? 'min(84vw, 177.8vh)' : 'min(100vw, 52rem)'}" alt="${noun} ${i + 1} of ${files.length}" width="${w}" height="${h}" loading="${i < 3 ? 'eager' : 'lazy'}" decoding="async"><figcaption class="page-no">${i + 1}</figcaption></figure>`).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${root}style.css">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${root}apple-touch-icon.png">
<script>try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
<script src="${root}theme.js" defer></script>
<script src="${root}slides.js" defer></script>
</head>
<body class="reader" data-back="${esc(back)}">
<header class="reader-bar">
  <span class="title">${esc(label)}</span>
  <span class="count" aria-live="polite" title="Use ← and → to move"><span class="n">1</span> / ${files.length}</span>
  ${links.map((l) => `<a class="button" href="${esc(l.href)}" title="${esc(l.title || l.label)}">${esc(l.label)}</a>`).join('')}<a class="icon-button" href="original.pdf" target="_blank" rel="noopener" aria-label="Open the PDF in the browser's viewer" title="Open the PDF in the browser's viewer"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 9.5v3.5H3V4h3.5"/></svg></a><a class="icon-button" href="original.pdf" download aria-label="Download the PDF" title="Download the PDF"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg></a><a class="reader-close" href="${esc(back)}" aria-label="Close" title="Close (Esc)">✕</a>
</header>
<main class="pages${kind === 'slide' ? ' slides' : ''}" style="--ratio: ${w} / ${h}" tabindex="-1">
${imgs}
</main>${kind === 'slide' ? `
<nav class="deck-nav" aria-label="Slides"><button type="button" data-go="-1" aria-label="Previous slide">←</button><button type="button" data-go="1" aria-label="Next slide">→</button></nav>` : ''}
</body>
</html>
`;
  fs.copyFileSync(pdf, path.join(out, 'original.pdf'));
  fs.writeFileSync(path.join(out, 'index.html'), stamp(html));
}
