// Turns a talk (an HTML fragment in talks/, one <section class="slide"> per
// slide) into a companion page that shares the thesis page's look, Lex
// highlighting, math and references.
//
// Inside a talk:
//   $...$, $$...$$                 math (thesis macros available)
//   <pre data-lang="lex">          highlighted Lex; data-lang="mfotl" for compiled formulas
//   <a data-thesis="section:mfotl"></a>   link to a thesis section, filled in as "§2.1 Title"
//   <cite data-ref="whyenf"></cite>       citation, numbered like the thesis's references
//   {{figure:system-model.svg}}           a drawing from public/figures, inlined
//   <p class="notes">                     commentary for readers, hidden in present mode
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import katex from 'katex';
import { renderListing } from './postprocess.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Compiled WhyEnf output, as written on the slides (Unicode operators).
function renderMfotl(code) {
  const re = /\b(let|fun)\b|\b(int|string|time)\b|([A-Za-z_][A-Za-z0-9_]*)(?=\()|([¬∧∨→∃∀□◇⧫■●○⇒]|:L\b|<-|->)|([\s\S])/g;
  const lines = code.split('\n').map((line) => {
    let out = '', m;
    re.lastIndex = 0;
    while ((m = re.exec(line))) {
      const [all, kw, ty, fn, op] = m;
      if (kw) out += `<span class="tok-kw">${kw}</span>`;
      else if (ty) out += `<span class="tok-com">${ty}</span>`;
      else if (fn) out += `<span class="tok-fn">${esc(fn)}</span>`;
      else if (op) out += `<span class="tok-op">${esc(op)}</span>`;
      else out += esc(all);
    }
    return `<span class="line">${out}</span>`;
  });
  return `<pre class="listing"><code>${lines.join('\n')}</code></pre>`;
}

// Strips the common indentation, so code can be indented in the source.
function dedent(code) {
  const lines = code.replace(/^\n+|\s+$/g, '').split('\n');
  const pad = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return lines.map((l) => l.slice(pad)).join('\n');
}

export function renderTalk(source, { macros, thesisToc, thesisRefs, thesisIds, figuresDir }) {
  const warnings = [];
  source = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\{figure:([^}]+)\}\}/g, (_, f) => {
    const file = path.join(figuresDir, f);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    warnings.push(`talk includes missing figure: ${f}`);
    return '';
  });
  const math = (tex, display) => katex.renderToString(tex, { displayMode: display, macros: { ...macros }, throwOnError: false, strict: false, trust: true });

  // Math outside code blocks.
  source = source.split(/(<pre[\s\S]*?<\/pre>)/).map((part, i) => (i % 2 ? part : part
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => math(t, true))
    .replace(/\$([^$\n]+?)\$/g, (_, t) => math(t, false)))).join('');

  const $ = cheerio.load(source, null, false);

  $('pre[data-lang]').each((_, el) => {
    const $el = $(el);
    const code = dedent($el.text());
    const lang = $el.attr('data-lang');
    const html = lang === 'mfotl' ? renderMfotl(code) : renderListing({ opts: '', code }, (t) => math(t, false));
    const title = $el.attr('data-title');
    $el.replaceWith(title ? `<div class="code-block"><div class="code-title">${esc(title)}</div>${html}</div>` : html);
  });

  const sectionById = new Map(thesisToc.map((s) => [s.id, s]));
  $('a[data-thesis]').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-thesis');
    const s = sectionById.get(id);
    if (!thesisIds.has(id)) warnings.push(`talk links to unknown thesis id: ${id}`);
    $el.attr('href', `../#${id}`).addClass('thesis-link').removeAttr('data-thesis');
    if (!$el.text().trim()) $el.text(s ? `${s.num ? (/^[A-Z]/.test(s.num) ? 'Appendix ' : '§') + s.num + ' ' : ''}${s.text}` : id);
  });

  $('cite[data-ref]').each((_, el) => {
    const keys = $(el).attr('data-ref').split(/[\s,]+/).filter(Boolean);
    const links = keys.map((k) => {
      if (!thesisRefs[k]) { warnings.push(`talk cites unknown reference: ${k}`); return esc(k); }
      return `<a href="../#ref-${k}">${thesisRefs[k]}</a>`;
    });
    $(el).replaceWith(`<span class="cite">[${links.join(', ')}]</span>`);
  });

  // Parts (h2) are numbered; slides (h3) go on the rail under their part.
  const toc = [];
  let part = 0;
  $('h2, h3').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id') || $el.closest('section').attr('id');
    if (!id) { warnings.push(`talk heading without id: ${$el.text()}`); return; }
    if (el.tagName === 'h2') { part++; $el.attr('data-num', String(part)); }
    toc.push({ id, level: el.tagName === 'h2' ? 1 : 2, num: el.tagName === 'h2' ? String(part) : '', text: $el.text().trim() });
  });

  return { html: $.html(), toc, warnings };
}
