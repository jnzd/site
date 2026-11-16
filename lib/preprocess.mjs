// Turns the thesis LaTeX into LaTeX that pandoc converts well, replacing the
// constructs pandoc cannot handle (proof trees, TikZ, algorithms, listings)
// with markers that lib/postprocess.mjs turns into HTML.
import fs from 'node:fs';
import path from 'node:path';

// Reads a balanced {...} group starting at s[i] === '{'. Returns [content, indexAfter].
export function readGroup(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === '\\') { j++; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  throw new Error('Unbalanced braces near: ' + s.slice(i, i + 60));
}

const skipSpace = (s, i) => { while (i < s.length && /\s/.test(s[i])) i++; return i; };

// Replaces every \name{arg} with fn(arg), honouring nested braces.
function replaceCommand(s, name, fn) {
  const re = new RegExp('\\\\' + name + '\\s*(?=\\{)', 'g');
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    const [arg, end] = readGroup(s, m.index + m[0].length);
    out += s.slice(last, m.index) + fn(arg);
    last = end;
    re.lastIndex = end;
  }
  return out + s.slice(last);
}

function inlineInputs(tex, dir) {
  return tex.replace(/\\input\{([^}]+)\}/g, (_, f) => {
    const file = path.join(dir, f.endsWith('.tex') ? f : f + '.tex');
    return inlineInputs(fs.readFileSync(file, 'utf8'), dir);
  });
}

const stripComments = (tex) => tex
  .split('\n')
  .filter((l) => !/^\s*%/.test(l))
  .map((l) => l.replace(/(^|[^\\])%.*$/, '$1'))
  .join('\n');

// \prftree[r]{label}{premise}...{conclusion} -> \prfrule{label}{premises}{conclusion}
function convertProofTrees(s) {
  let out = '';
  let i = 0;
  for (;;) {
    const at = s.indexOf('\\prftree', i);
    if (at === -1) return out + s.slice(i);
    out += s.slice(i, at);
    let j = at + '\\prftree'.length;
    let labelled = false;
    for (j = skipSpace(s, j); s[j] === '['; j = skipSpace(s, j)) {
      const close = s.indexOf(']', j);
      if (/[rl]/.test(s.slice(j + 1, close))) labelled = true;
      j = close + 1;
    }
    const groups = [];
    for (;;) {
      const k = skipSpace(s, j);
      if (s[k] !== '{') break;
      const [g, end] = readGroup(s, k);
      groups.push(convertProofTrees(g).trim());
      j = end;
    }
    const label = labelled ? groups.shift() : '';
    const conclusion = groups.pop() ?? '';
    const premises = groups.filter(Boolean).join(' \\quad ');
    out += `\\prfrule{${label}}{${premises}}{${conclusion}}`;
    i = j;
  }
}

// algorithmic environments become plain numbered lines (an enumerate inside
// an "algolines" block), with \For bodies indented.
function convertAlgorithmic(s, state) {
  return s.replace(/\\begin\{algorithmic\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{algorithmic\}/g, (_, inner) => {
    let body = replaceCommand(inner, 'Function', (name) => `\\State \\textbf{let} ${name} `)
      .replace(/(\\State \\textbf\{let\} [^\n]*?)\{([^{}\n]*)\}\s*\n/, '$1$2 =\n');
    body = replaceCommand(body, 'For', (cond) => `\\State⟪+⟫ \\textbf{for} ${cond} \\textbf{do}`)
      .replace(/\\EndFor/g, '\\State⟪-⟫ \\textbf{end for}')
      .replace(/\\EndFunction/g, '')
      .replace(/\\Return/g, '\\textbf{return}')
      .replace(/\\hspace\{[^}]*\}/g, '');
    let depth = 0;
    const lines = body.split('\\State').slice(1).map((line, k) => {
      line = line.replace(/\\label\{([^}]+)\}/g, (_m, l) => { state.labels[l] = String(k + 1); return ''; }).trim();
      if (line.startsWith('⟪-⟫')) depth -= 1;
      const indent = '~~~~'.repeat(Math.max(0, depth));
      if (line.startsWith('⟪+⟫')) depth += 1;
      // Spacing commands outside math would be dropped by pandoc: use non-breaking spaces.
      const text = line.replace(/^⟪[+-]⟫\s*/, '').split(/(\$[^$]*\$)/).map((part) => (part.startsWith('$') ? part : part
        .replace(/\\qquad/g, '~~~~~~').replace(/\\quad/g, '~~~').replace(/\\[;,]/g, '~'))).join('');
      return `\\item ${indent}${text}`;
    });
    return `\\begin{algolines}\n\\begin{enumerate}\n${lines.join('\n')}\n\\end{enumerate}\n\\end{algolines}`;
  });
}

function convertAlgorithms(s, state) {
  return s.replace(/\\begin\{algorithm\}(?:\[[^\]]*\])?([\s\S]*?)\\end\{algorithm\}/g, (_, body) => {
    state.algorithms += 1;
    const n = state.algorithms;
    let caption = '';
    body = replaceCommand(body, 'caption', (c) => { caption = c; return ''; });
    caption = caption.replace(/\\label\{([^}]+)\}/g, (_m, l) => { state.labels[l] = String(n); return `⟦label:${l}⟧`; });
    return `\\begin{algorithmblock}\n\\begin{algcaption}⟦algnum:${n}⟧${caption}\\end{algcaption}\n${body}\n\\end{algorithmblock}`;
  });
}

// Spacing commands in table cells, outside math, would be dropped by pandoc.
function keepTableSpacing(s) {
  return s.replace(/\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/g, (table) => table.split(/(\$[^$]*\$)/).map((part) =>
    (part.startsWith('$') ? part : part.replace(/\\qquad/g, '~~~~~~').replace(/\\quad/g, '~~~'))).join(''));
}

// Numbered align environments: number each row (chapter.n) ourselves, since
// pandoc drops equation numbers.
function numberEquations(s, state) {
  let chapter = 0;
  let eq = 0;
  return s.replace(/\\chapter\*?\{|\\begin\{align\}([\s\S]*?)\\end\{align\}/g, (m, body) => {
    if (body === undefined) {
      if (!m.includes('*')) { chapter += 1; eq = 0; }
      return m;
    }
    const rows = body.split(/\\\\/).filter((r) => r.trim());
    const out = rows.map((row) => {
      eq += 1;
      const num = `${chapter}.${eq}`;
      row = row.replace(/\\label\{([^}]+)\}/g, (_m, l) => { state.labels[l] = num; return `\\htmlId{${l}}{}`; });
      return `${row.trimEnd()} \\tag{${num}}`;
    });
    return `\\begin{equation*}\\begin{NUMBEREDALIGN}${out.join(' \\\\\n')}\\end{NUMBEREDALIGN}\\end{equation*}`;
  });
}

export function preprocess(thesisDir) {
  const main = fs.readFileSync(path.join(thesisDir, 'thesis.tex'), 'utf8');
  const meta = {};
  for (const key of ['title', 'author', 'thesistype', 'supervisor', 'advisors', 'department', 'date']) {
    const m = stripComments(main).match(new RegExp('\\\\' + key + '\\{([^}]*)\\}'));
    if (m) meta[key] = m[1].trim();
  }

  const state = { labels: {}, algorithms: 0, listings: [], tikz: 0 };
  let body = main.slice(main.indexOf('\\begin{document}') + '\\begin{document}'.length, main.indexOf('\\end{document}'));
  body = inlineInputs(body, thesisDir);

  // Listings are verbatim: lift them out before touching comments or macros.
  body = body.replace(/\\begin\{lstlisting\}(?:\[([^\]]*)\])?\n?([\s\S]*?)\\end\{lstlisting\}/g, (_, opts = '', code) => {
    state.listings.push({ opts, code: code.replace(/\s+$/, '') });
    return `\n\n⟦lst:${state.listings.length - 1}⟧\n\n`;
  });

  body = stripComments(body);

  // Front and back matter that has no place on the web page.
  body = body
    .replace(/\\begin\{titlingpage\}[\s\S]*?\\end\{titlingpage\}/, '')
    .replace(/\\(frontmatter|mainmatter|backmatter|cleartorecto|tableofcontents)\b/g, '')
    .replace(/\\bibliographystyle\{[^}]*\}|\\bibliography\{[^}]*\}|\\includepdf(\[[^\]]*\])?\{[^}]*\}/g, '')
    .replace(/\\begin\{abstract\}/, '\\chapter*{Abstract}')
    .replace(/\\end\{abstract\}/, '');

  // Mark appendix chapters so they can be lettered.
  const app = body.indexOf('\\appendix');
  if (app !== -1) {
    body = body.slice(0, app) + body.slice(app + '\\appendix'.length).replace(/\\chapter\{/g, '\\chapter{⟦appendix⟧');
  }

  body = body.replace(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g, () => `\n\n⟦tikz:${state.tikz++}⟧\n\n`);
  // Table labels are dropped by pandoc; remember them in order.
  state.tableLabels = [...body.matchAll(/\\begin\{table\}[\s\S]*?\\end\{table\}/g)].map((m) => (m[0].match(/\\label\{([^}]+)\}/) || [])[1] || '');
  body = convertAlgorithmic(body, state);
  body = convertAlgorithms(body, state);
  body = keepTableSpacing(body);
  body = numberEquations(body, state);
  body = convertProofTrees(body);

  // Syntax-colouring macros become markers that survive both text and math.
  const tok = (cls, wrap = (x) => x) => (arg) => `\\texttt{⟦${cls}:${wrap(arg)}⟧}`;
  body = replaceCommand(body, 'kw', tok('kw'));
  body = replaceCommand(body, 'bluekw', tok('id'));
  body = replaceCommand(body, 'graykw', tok('op'));
  body = replaceCommand(body, 'stringkw', tok('str', (x) => `"${x}"`));
  body = replaceCommand(body, 'triplestringkw', tok('str', (x) => `"""${x}"""`));

  // Table helpers pandoc does not know, and PDF icons that also exist as SVG.
  body = replaceCommand(body, 'makecell', (c) => c.replace(/\\\\/g, '\\newline '));
  body = body
    .replace(/\\multirow\{[^}]*\}\{[^}]*\}\s*(?=\{)/g, '')
    .replace(/\\Sequence\[([^\]]*)\]\{([^}]*)\}/g, '\\left\\langle{$2}\\right\\rangle_{$1}')
    .replace(/(\\includegraphics(?:\[[^\]]*\])?\{[^}]*)\.pdf\}/g, '$1.svg}');

  // Keep citation locators: \cite[Figure 2]{key} -> \cite{key}⟦loc:Figure 2⟧
  body = body.replace(/\\cite\[([^\]]*)\]\{([^}]*)\}/g, '\\cite{$2}⟦loc:$1⟧');

  body = body
    .replace(/\\begin\{figure\*\}/g, '\\begin{figure}').replace(/\\end\{figure\*\}/g, '\\end{figure}')
    .replace(/\\begin\{figure\}\[[^\]]*\]/g, '\\begin{figure}')
    .replace(/\\(begin\{minipage\}(\[[^\]]*\])?\{[^}]*\}|end\{minipage\})/g, '')
    .replace(/\\(vspace|hspace)\*?\{[^}]*\}/g, '')
    .replace(/\\(centering|hfill|noindent|newpage|clearpage)\b/g, '');

  // Only the text-mode macros go to pandoc; math macros are handed to KaTeX.
  const preamble = String.raw`\documentclass{book}
\newtheorem{theorem}{Theorem}[chapter]
\newtheorem{example}[theorem]{Example}
\newtheorem{remark}[theorem]{Remark}
\newtheorem{corollary}[theorem]{Corollary}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newcommand{\Lex}{Lex}
\newcommand{\Let}{\textbf{let}}
\newcommand{\IIn}{\textbf{in}}
\newcommand{\Case}{\textbf{case}}
\newcommand{\OOf}{\textbf{of}}
\newcommand{\When}{\textbf{when}}
\newcommand{\IInput}{\textbf{Input:}~}
\newcommand{\OOutput}{\textbf{Output:}~}
\begin{document}
`;
  return { tex: preamble + body + '\n\\end{document}\n', meta, state };
}

// Collects \newcommand definitions from the thesis's macro files as a KaTeX macro table.
export function katexMacros(thesisDir) {
  const macros = {};
  for (const file of ['macrosetup.tex', 'symbols.tex']) {
    const tex = stripComments(fs.readFileSync(path.join(thesisDir, file), 'utf8'));
    const re = /\\(?:re)?newcommand\*?\{(\\[A-Za-z]+)\}(?:\[(\d)\])?(?:\[[^\]]*\])?\s*(?=\{)/g;
    let m;
    while ((m = re.exec(tex))) {
      const [def] = readGroup(tex, m.index + m[0].length);
      macros[m[1]] = def;
    }
  }
  // Text-mode or colouring macros handled elsewhere.
  for (const k of ['\\Lex', '\\kw', '\\bluekw', '\\graykw', '\\stringkw', '\\triplestringkw']) delete macros[k];
  Object.assign(macros, {
    '\\phi': '\\varphi',
    '\\epsilon': '\\varepsilon',
    '\\ensuremath': '#1',
    '\\CIRCLE': '\\raisebox{-0.12em}{\\Large$\\bullet$}',
    '\\Circle': '\\raisebox{-0.12em}{\\Large$\\circ$}',
    '\\prfStackPremises': '\\begin{array}{c}#1\\\\#2\\end{array}',
    '\\abs': '\\left\\lvert #1 \\right\\rvert',
    '\\norm': '\\left\\lVert #1 \\right\\rVert',
    '\\textsc': '\\text{#1}',
    '\\prfrule': '\\dfrac{\\;#2\\;}{\\;#3\\;}\\,{\\scriptsize\\textsf{#1}}',
  });
  return macros;
}
