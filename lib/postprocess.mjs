// Turns pandoc's HTML into the article body: numbering, cross-references,
// citations, figures, listings and server-side rendered math.
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import katex from 'katex';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const THEOREMS = 'div.definition, div.theorem, div.lemma, div.example, div.remark, div.corollary, div.proposition';

const LEX_KEYWORDS = new Set(('law article paragraph point rule whenever oblige constitute except refine observable scope '
  + 'causable suppressable hide event internal predicate type is transparently enforceable suppressing refinement function '
  + 'assume fulfilled by replace strengthen true false').split(' '));
const LEX_OPERATORS = new Set('ONCE NOT SINCE OR AND EXISTS'.split(' '));

// Splits Lex source into [class, text] tokens.
function tokenizeLex(code) {
  const re = /("""[\s\S]*?"""|"[^"\n]*")|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|([A-Za-z_][A-Za-z0-9_]*)|([\s\S])/g;
  const tokens = [];
  let m;
  while ((m = re.exec(code))) {
    const [all, str, comment, word] = m;
    if (str) tokens.push(['tok-str', str]);
    else if (comment) tokens.push(['tok-com', comment]);
    else if (word && LEX_OPERATORS.has(word)) tokens.push(['tok-op', word]);
    else if (word && LEX_KEYWORDS.has(word.toLowerCase())) tokens.push(['tok-kw', word]);
    else tokens.push(['', all]);
  }
  return tokens;
}

// Compiled MFOTL (signatures and formulas, as in the appendix) rather than Lex.
const isMfotl = (code) => /^\s*LET\b|^\w+\([^)]*:\s*(int|string)\b/m.test(code);

// Splits a plain-text stretch of MFOTL into [class, text] tokens.
function tokenizeMfotl(code) {
  const re = /("[^"\n]*")|\b(LET|IN)\b|\b(int|string)\b|([A-Za-z_][A-Za-z0-9_]*)(?=\()|\b(S|U)(?=\[)|(:L\b|\)[+-]+(?=\s*(?:=|$)))|([\s\S])/gm;
  const tokens = [];
  let m;
  while ((m = re.exec(code))) {
    const [all, str, kw, type, fn, op, mark] = m;
    if (str) tokens.push(['tok-str', str]);
    else if (kw) tokens.push(['tok-kw', kw]);
    else if (type) tokens.push(['tok-com', type]);
    else if (fn) tokens.push(['tok-fn', fn]);
    else if (op) tokens.push(['tok-op', op]);
    else if (mark) {
      if (mark.startsWith(')')) tokens.push(['', ')'], ['tok-com', mark.slice(1)]);
      else tokens.push(['tok-com', mark]);
    } else tokens.push(['', all]);
  }
  return tokens;
}

const tokensToHtml = (tokens) => tokens.map(([cls, text]) => (cls ? `<span class="${cls}">${esc(text)}</span>` : esc(text))).join('');

function renderListing({ opts, code }, renderMath) {
  const first = Number((opts.match(/firstnumber=(\d+)/) || [])[1] || 1);
  let lines;
  if (isMfotl(code)) {
    // Escaped math ($...$) holds the logical operators.
    lines = code.split('\n').map((line) => line.split(/(\$[^$]*\$)/).map((part) =>
      (part.length > 1 && part.startsWith('$') && part.endsWith('$')
        ? `<span class="tok-op">${renderMath(part.slice(1, -1), false)}</span>`
        : tokensToHtml(tokenizeMfotl(part)))).join(''));
  } else if (opts.includes('mathescape')) {
    lines = code.split('\n').map((line) => line.split(/(\$[^$]*\$)/).map((part) =>
      (part.length > 1 && part.startsWith('$') && part.endsWith('$') ? renderMath(part.slice(1, -1), false) : esc(part))).join(''));
  } else {
    // A token may span lines (docstrings), so it is wrapped once per line.
    lines = [''];
    for (const [cls, text] of tokenizeLex(code)) {
      text.split('\n').forEach((piece, i) => {
        if (i > 0) lines.push('');
        if (piece) lines[lines.length - 1] += cls ? `<span class="${cls}">${esc(piece)}</span>` : esc(piece);
      });
    }
  }
  const body = lines.map((l) => `<span class="line">${l}</span>`).join('\n');
  return `<pre class="listing" style="counter-reset: line ${first - 1}"><code>${body}</code></pre>`;
}

export function postprocess(rawHtml, { state, macros, figuresDir, tikzFiles, bibliographyOrder = [], referenceUpdates = {}, linkUpdates = {}, inserts = [] }) {
  const warnings = [];
  const mathErrors = new Map();

  function renderMath(tex, display) {
    tex = tex
      .replace(/NUMBEREDALIGN/g, 'align')
      .replace(/\\label\{[^}]*\}/g, '')
      .replace(/\\ref\{([^}]*)\}/g, (_, l) => `\\text{${labels[l] ?? '?'}}`)
      .replace(/\\texttt\{⟦(kw|id|op|str):([^⟧]*)⟧\}/g, '\\htmlClass{tok-$1}{\\texttt{$2}}');
    // Proof rules stacked in rows need room between the rows.
    if (tex.includes('\\prfrule')) tex = tex.replace(/\\\\(?!\[)(?=\s*\\(prfrule|quad|qquad))/g, '\\\\[1.1em]');
    try {
      return katex.renderToString(tex, { displayMode: display, macros: { ...macros }, throwOnError: true, strict: false, trust: true });
    } catch (e) {
      const key = e.message.replace(/ at position[\s\S]*/, '');
      mathErrors.set(key, (mathErrors.get(key) || 0) + 1);
      return katex.renderToString(tex, { displayMode: display, macros: { ...macros }, throwOnError: false, strict: false, trust: true });
    }
  }

  // --- String-level fixes before parsing ---
  let html = rawHtml
    .replace(/<code>⟦(kw|id|op|str):([^⟧]*)⟧<\/code>/g, '<code class="tok-$1">$2</code>');

  const $ = cheerio.load(html, null, false);
  const labels = { ...state.labels };

  // --- Headings: chapters become h2, sections h3, subsections h4 ---
  for (const [from, to] of [['h3', 'h4'], ['h2', 'h3'], ['h1', 'h2']]) {
    $(from).each((_, el) => { el.tagName = to; });
  }
  const toc = [];
  const chapterOf = new Map(); // element -> chapter number, for float numbering
  let chapter = '';
  let nChapter = 0;
  let nAppendix = 0;
  let nSection = 0;
  let nSub = 0;
  const counters = {};
  $('*').each((_, el) => {
    const $el = $(el);
    if (el.tagName === 'h2') {
      const text = $el.text();
      if ($el.hasClass('unnumbered')) {
        chapter = '';
      } else if (text.includes('⟦appendix⟧')) {
        chapter = String.fromCharCode(65 + nAppendix++);
        $el.html($el.html().replace('⟦appendix⟧', ''));
        $el.attr('data-appendix', '');
      } else {
        chapter = String(++nChapter);
      }
      nSection = 0;
      if (!$el.attr('id')) $el.attr('id', 'chapter-' + (chapter || text.trim().toLowerCase()));
      if (chapter) { $el.attr('data-num', chapter); labels[$el.attr('id')] = chapter; }
      toc.push({ id: $el.attr('id'), num: chapter, text: $el.text().trim(), level: 1 });
    } else if (el.tagName === 'h3' && chapter) {
      nSub = 0;
      const num = `${chapter}.${++nSection}`;
      $el.attr('data-num', num);
      if ($el.attr('id')) labels[$el.attr('id')] = num;
      if ($el.attr('id')) toc.push({ id: $el.attr('id'), num, text: $el.text().trim(), level: 2 });
    } else if (el.tagName === 'h4' && chapter) {
      const num = `${chapter}.${nSection}.${++nSub}`;
      $el.attr('data-num', num);
      if ($el.attr('id')) labels[$el.attr('id')] = num;
      if ($el.attr('id')) toc.push({ id: $el.attr('id'), num, text: $el.text().trim(), level: 3 });
    } else if (el.tagName === 'figure' || el.tagName === 'table') {
      chapterOf.set(el, chapter);
    }
  });

  const nextNumber = (kind, ch) => {
    const key = `${kind}:${ch}`;
    counters[key] = (counters[key] || 0) + 1;
    return ch ? `${ch}.${counters[key]}` : String(counters[key]);
  };

  // --- Figures ---
  $('figure').each((_, el) => {
    const $el = $(el);
    const num = nextNumber('fig', chapterOf.get(el));
    if ($el.attr('id')) labels[$el.attr('id')] = num;
    $el.find('figcaption span[label]').each((__, s) => {
      labels[$(s).attr('label')] = num;
      if (!$el.attr('id')) $el.attr('id', $(s).attr('label'));
      $(s).remove();
    });
    const cap = $el.children('figcaption');
    const body = $('<div class="figure-body"></div>');
    $el.children().not('figcaption').appendTo(body);
    $el.prepend(body);
    cap.prepend(`<span class="label">Fig ${num}</span>`);
  });

  let nTables = 0;
  // --- A figure holding two ruled tables with the same row groups (Fig 2.9)
  // becomes one table: the second table's columns continue the first's, so
  // matching groups share a row band and its label.
  const groupsOf = ($t) => {
    const groups = [[]];
    $t.find('tr').each((_, tr) => {
      if ($(tr).text().includes('⟦rule⟧')) groups.push([]);
      else groups.at(-1).push(tr);
    });
    return groups.filter((g) => g.length);
  };
  $('figure').each((_, fig) => {
    const tables = $(fig).find('table').toArray();
    if (tables.length !== 2 || !tables.every((t) => $(t).text().includes('⟦cols:') && !$(t).find('thead').length)) return;
    const [a, b] = tables.map((t) => $(t));
    const ga = groupsOf(a), gb = groupsOf(b);
    if (ga.length !== gb.length) return;
    const width = (g) => Math.max(...g.map((tr) => $(tr).children('td').length));
    const wa = Math.max(...ga.map(width)), wb = Math.max(...gb.map(width));
    const specOf = ($t) => { const m = $t.find('td').first().html().match(/⟦cols:([^⟧]*)⟧/); return m ? m[1] : ''; };
    const spec = specOf(a) + specOf(b);
    b.find('td').first().html(b.find('td').first().html().replace(/⟦cols:[^⟧]*⟧/, ''));
    a.find('td').first().html(a.find('td').first().html().replace(/⟦cols:[^⟧]*⟧/, `⟦cols:${spec}⟧`));
    const rows = [];
    ga.forEach((g, i) => {
      if (i > 0) rows.push(`<tr><td>⟦rule⟧</td></tr>`);
      const n = Math.max(g.length, gb[i].length);
      for (let r = 0; r < n; r++) {
        const cells = (tr, w) => {
          const tds = tr ? $(tr).children('td').toArray().map((td) => $.html(td)) : [];
          while (tds.length < w) tds.push('<td></td>');
          return tds.join('');
        };
        rows.push(`<tr>${cells(g[r], wa)}${cells(gb[i][r], wb)}</tr>`);
      }
    });
    a.find('tbody').html(rows.join('\n'));
    a.addClass('merged');
    const bWrap = b.parent('div:not(.figure-body)');
    (bWrap.length && bWrap.children().length === 1 ? bWrap : b).remove();
  });

  // --- Table rules carried over from LaTeX (see keepTableSpacing) ---
  $('table').each((_, table) => {
    const $table = $(table);
    // Rule marker rows become a border above the next row.
    $table.find('tr').each((__, el) => {
      const $tr = $(el);
      if (!$tr.text().includes('⟦rule⟧')) return;
      $tr.next('tr').addClass('rule-before');
      $tr.remove();
    });
    // Column spec: vertical rules between columns become cell borders.
    let spec = '';
    $table.find('td, th').first().each((__, cell) => {
      const html = $(cell).html() || '';
      const m = html.match(/⟦cols:([^⟧]*)⟧/);
      if (m) { spec = m[1]; $(cell).html(html.replace(m[0], '')); }
    });
    const ruledBefore = [];
    let pending = false;
    for (let i = 0; i < spec.length; i++) {
      const c = spec[i];
      if (c === 'I') pending = true;
      else if ('lcrpmb'.includes(c)) {
        ruledBefore.push(pending);
        pending = false;
        if ('pmb'.includes(c) && spec[i + 1] === '{') i = spec.indexOf('}', i);
      }
    }
    if (!ruledBefore.slice(1).some(Boolean)) return;
    $table.addClass('ruled');
    // Group body rows between rules; a cell filled only in a group's first
    // row (LaTeX \multirow) spans the whole group.
    const rows = $table.find('tbody tr').toArray();
    const groups = [[]];
    rows.forEach((tr) => { if ($(tr).hasClass('rule-before') && groups.at(-1).length) groups.push([]); groups.at(-1).push(tr); });
    const remove = [];
    for (const g of groups) {
      if (g.length < 2) continue;
      const cells = g.map((tr) => $(tr).children('td').toArray());
      const ncol = Math.min(...cells.map((r) => r.length));
      for (let c = 0; c < ncol; c++) {
        const filled = cells.map((r) => $(r[c]).text().replace(/ /g, ' ').trim() !== '');
        if (filled[0] && filled.slice(1).every((f) => !f)) {
          $(cells[0][c]).attr('rowspan', g.length).addClass('span');
          for (let r = 1; r < g.length; r++) remove.push(cells[r][c]);
        }
      }
    }
    // Borders by column position, before spanned cells are taken out.
    $table.find('tr').each((__, tr) => {
      $(tr).children('td, th').each((c, cell) => { if (c > 0 && ruledBefore[c]) $(cell).addClass('rule-left'); });
    });
    remove.forEach((cell) => $(cell).remove());
  });

  // --- Tables: captioned ones become numbered figures, all get a scroll wrapper ---
  $('table').each((_, el) => {
    const $el = $(el);
    const cap = $el.children('caption');
    if (cap.length && !$el.closest('figure').length) {
      const num = nextNumber('tab', chapterOf.get(el));
      // pandoc wraps a labelled table in <div id="label">; otherwise fall back to source order.
      const wrapper = $el.parent('div[id]');
      let id = wrapper.attr('id') || state.tableLabels?.[nTables] || '';
      nTables += 1;
      if (wrapper.length) wrapper.replaceWith($el);
      if (id) labels[id] = num;
      cap.find('span[label]').each((__, s) => { id = $(s).attr('label'); labels[id] = num; $(s).remove(); });
      const fig = $(`<figure class="table"${id ? ` id="${id}"` : ''}><figcaption><span class="label">Table ${num}</span>${cap.html()}</figcaption><div class="table-scroll"></div></figure>`);
      cap.remove();
      $el.replaceWith(fig);
      fig.find('.table-scroll').append($el);
    } else {
      $el.wrap('<div class="table-scroll"></div>');
    }
    // Tables with sentences in their cells wrap text instead of growing sideways.
    // Only plain text counts, not math (raw TeX here, or rendered with a hidden MathML copy).
    const plainText = (td) => { const c = $(td).clone(); c.find('.katex, .math').remove(); return c.text().trim(); };
    const prose = $el.find('td').toArray().some((td) => plainText(td).length > 40);
    if (prose) $el.parent('.table-scroll').addClass('prose');
  });

  // --- Algorithms ---
  $('div.algolines').each((_, el) => {
    const list = $(el).children('ol').first();
    list.addClass('algorithm-lines');
    list.find('li > p').each((__, p) => { $(p).replaceWith($(p).html()); });
    $(el).replaceWith(list);
  });
  $('div.algorithmblock').each((_, el) => {
    const $el = $(el);
    const cap = $el.find('div.algcaption').first();
    let capHtml = cap.find('p').html() ?? cap.html();
    let id = '';
    let num = '';
    capHtml = capHtml.replace(/⟦algnum:(\d+)⟧/, (_m, n) => { num = n; return ''; })
      .replace(/⟦label:([^⟧]+)⟧/, (_m, l) => { id = l; return ''; });
    const list = $el.find('ol.algorithm-lines').first();
    const fig = $(`<figure class="algorithm"${id ? ` id="${id}"` : ''}><figcaption><span class="label">Algorithm ${num}</span>${capHtml}</figcaption></figure>`);
    fig.append(list);
    $el.replaceWith(fig);
  });

  // --- Theorem-like blocks: upright body, emphasised terms stay emphasised ---
  $(THEOREMS).each((_, el) => {
    const $el = $(el);
    $el.addClass('thm');
    const outer = $el.find('em').toArray().filter((em) => $(em).parents('em').length === 0);
    for (const em of outer) $(em).replaceWith($(em).html());
  });
  $('div.proof').addClass('proof-block');

  // --- Cross-references ---
  $('a[data-reference]').each((_, el) => {
    const $el = $(el);
    const label = $el.attr('data-reference');
    const num = labels[label];
    if (num) $el.text(num);
    else if (/^\[/.test($el.text())) warnings.push(`unresolved reference: ${label}`);
    $el.addClass('ref').removeAttr('data-reference').removeAttr('data-reference-type');
  });

  // --- Citations and bibliography ---
  const refNumber = {};
  // Entries keep pandoc's order unless the config lists keys (to match the PDF's numbering).
  const keyOf = (el) => $(el).attr('id').replace(/^ref-/, '');
  const rank = (el) => { const i = bibliographyOrder.indexOf(keyOf(el)); return i === -1 ? Infinity : i; };
  const entries = $('#refs .csl-entry').toArray().map((el, i) => [el, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(([el]) => el);
  const items = [];
  entries.forEach((el, i) => {
    const key = keyOf(el);
    refNumber[key] = i + 1;
    const original = $(el).html().trim();
    // A reference updated since submission (e.g. a draft that has since been
    // published) shows the new entry, with the thesis's original entry below it.
    const updated = referenceUpdates[key];
    items.push(updated
      ? `<li id="ref-${key}">${updated}<span class="ref-original">In the submitted thesis: ${original}</span></li>`
      : `<li id="ref-${key}">${original}</li>`);
  });
  $('#refs').replaceWith(`<h2 id="references" class="unnumbered">References</h2>\n<ol class="references">\n${items.join('\n')}\n</ol>`);
  toc.push({ id: 'references', num: '', text: 'References', level: 1 });
  $('span.citation').each((_, el) => {
    const $el = $(el);
    const keys = ($el.attr('data-cites') || '').split(/\s+/).filter(Boolean);
    const links = keys.map((k) => {
      if (!refNumber[k]) { warnings.push(`unknown citation: ${k}`); return esc(k); }
      return `<a href="#ref-${k}">${refNumber[k]}</a>`;
    });
    // A locator marker (from \cite[...]{...}) directly follows its citation.
    let loc = '';
    const next = el.nextSibling;
    if (next && next.type === 'text') {
      const m = next.data.match(/^\s*⟦loc:([^⟧]*)⟧/);
      if (m) { loc = m[1]; next.data = next.data.slice(m[0].length); }
    }
    $el.replaceWith(`<span class="cite">[${links.join(', ')}${loc ? ', ' + esc(loc) : ''}]</span>`);
  });

  // --- Listings and TikZ pictures ---
  $('p').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    let m;
    if ((m = text.match(/^⟦lst:(\d+)⟧$/))) {
      $el.replaceWith(renderListing(state.listings[Number(m[1])], renderMath));
    } else if ((m = text.match(/^⟦tikz:(\d+)⟧$/))) {
      const file = path.join(figuresDir, tikzFiles[Number(m[1])] ?? '');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) $el.replaceWith(fs.readFileSync(file, 'utf8'));
      else { warnings.push(`no drawing for TikZ picture ${m[1]}`); $el.remove(); }
    }
  });

  // --- Math ---
  $('span.math').each((_, el) => {
    const $el = $(el);
    const display = $el.hasClass('display');
    const tex = $el.text().replace(/^\\[(\[]/, '').replace(/\\[)\]]$/, '');
    $el.replaceWith(renderMath(tex, display));
  });

  // --- Web-only additions (unnumbered figures etc.), placed after a heading.
  for (const { after, html: extra } of inserts) {
    const target = $(`[id="${after}"]`);
    if (target.length) target.after(extra);
    else warnings.push(`insert target not found: ${after}`);
  }

  // --- Links moved since submission: point to the new address and keep the
  // thesis's original one beside it.
  $('a[href]').each((_, el) => {
    const $el = $(el);
    const to = linkUpdates[$el.attr('href')];
    if (!to) return;
    const from = $el.attr('href');
    const showsUrl = $el.text().trim() === from;
    $el.attr('href', to);
    if (showsUrl) $el.text(to);
    $el.after(` <span class="link-original">(in the submitted thesis: ${esc(from)})</span>`);
  });

  // --- Tidy up ---
  $('p').each((_, el) => { if (!$(el).html().trim()) $(el).remove(); });
  $('div.center').each((_, el) => { $(el).replaceWith($(el).html()); });
  $('.footnotes > hr').remove();

  for (const [k, n] of mathErrors) warnings.push(`math (${n}x): ${k}`);
  const leftovers = $.html().match(/⟦[a-z]+:[^⟧]{0,40}⟧/g);
  if (leftovers) warnings.push(`unconverted markers: ${[...new Set(leftovers)].slice(0, 8).join(' ')}`);
  return { html: $.html(), toc, warnings };
}
