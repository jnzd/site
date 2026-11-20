// The source editor (CodeMirror 6) with Lex syntax highlighting, and a small
// highlighter for the MFOTL output. Bundled into editor.js by assemble.mjs.
// Keywords follow Lex's lexer (src/lexer.mll) and the VS Code grammar
// (vscode/lex/syntaxes/lex.tmGrammar.json). Colours come from the site theme's
// --tok-* variables, so the playground matches the code on the thesis pages.
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { StreamLanguage, HighlightStyle, syntaxHighlighting, indentUnit, bracketMatching } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const words = (s) => new Set(s.split(/\s+/));
// Structure of a law: law "GDPR", article 6, paragraph 1, point a.
const SECTION = words('law title chapter section article paragraph point subpoint note');
// Statements and their modifiers.
const DECL = words('type is event predicate function functional variable rule replace whenever fix oblige permit '
  + 'constitute except scope import refine strengthen weaken assume by fulfilled lex rex formex akomaNtoso '
  + 'conditions effects exceptions scopes within before strictly after between excluded delaying if in the future past '
  + 'eventually always once suppressing causing and or not');
const MODIFIER = words('causable suppressable observable transparently enforceable internal');
const TYPE = words('string int float bool time span money');
const TEMPORAL = words('NOT AND OR IMPLIES IFF EQUIV EXISTS FORALL SINCE UNTIL RELEASE TRIGGER NEXT PREV PREVIOUS '
  + 'GLOBALLY EVENTUALLY GLOBALLY_PAST HISTORICALLY ALWAYS ONCE LET IN SUM AVG MED CNT MIN MAX');
const CONST = words('true false');

const lex = StreamLanguage.define({
  name: 'lex',
  startState: () => ({ docstring: false }),
  token(stream, state) {
    if (state.docstring) {
      if (stream.skipTo('"""')) { stream.pos += 3; state.docstring = false; } else stream.skipToEnd();
      return 'docString';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('"""')) { state.docstring = true; return 'docString'; }
    if (stream.peek() === '#') { stream.skipToEnd(); return 'comment'; }
    if (stream.match(/^r?"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^condition\[\d+\]/) || stream.match(/^\[\d+\]/)) return 'labelName';
    if (stream.match(/^-?\d+(?:\.\d*)?[smhd]?\b/)) return 'number';
    if (stream.match(/^(?:<-|->|<>|\*\*|[¬∧∨→↔∃∀○●□◊■⧫?])/)) return 'operator';
    const w = stream.match(/^[A-Za-z_][\w']*/);
    if (w) {
      const word = w[0];
      if (SECTION.has(word)) return 'heading';
      if (DECL.has(word)) return 'keyword';
      if (MODIFIER.has(word)) return 'modifier';
      if (TYPE.has(word)) return 'typeName';
      if (TEMPORAL.has(word)) return 'operatorKeyword';
      if (CONST.has(word)) return 'bool';
      // An event or predicate name is capitalised (Process, GiveConsent).
      if (/^[A-Z]/.test(word)) return 'className';
      return 'variableName';
    }
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' } },
});

const style = HighlightStyle.define([
  { tag: [t.keyword, t.heading], color: 'var(--tok-kw)', fontWeight: '600' },
  { tag: [t.operator, t.operatorKeyword], color: 'var(--tok-op)' },
  { tag: [t.string, t.docString], color: 'var(--tok-str)' },
  { tag: t.docString, fontStyle: 'italic' },
  { tag: t.comment, color: 'var(--tok-com)', fontStyle: 'italic' },
  { tag: [t.modifier, t.typeName, t.labelName], color: 'var(--tok-com)' },
  { tag: t.className, color: 'var(--tok-fn)' },
  { tag: [t.number, t.bool], color: 'var(--accent)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent', fontSize: '.82rem' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '.6rem 0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none', paddingLeft: '.25rem' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--text) 4%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--muted)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection':
    { backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent) !important' },
  '.cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid var(--faint)' },
});

// One EditorState per file, so each tab keeps its own undo history.
export function createEditor(parent, onRun) {
  const extensions = [
    lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
    bracketMatching(), indentUnit.of('    '), lex, syntaxHighlighting(style), theme,
    keymap.of([{ key: 'Mod-Enter', run: () => { onRun(); return true; } },
      indentWithTab, ...defaultKeymap, ...historyKeymap]),
  ];
  const states = new Map();
  const view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions }) });
  let current = null;
  return {
    get value() { return view.state.doc.toString(); },
    // Shows a file; text is used only the first time the file is shown.
    show(name, text) {
      if (current !== null) states.set(current, view.state);
      current = name;
      view.setState(states.get(name) || EditorState.create({ doc: text, extensions }));
    },
    reset() { states.clear(); current = null; },
    focus() { view.focus(); },
  };
}

// MFOTL output: "Signature:" lists, LET … IN formulas, predicates.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
export function highlightMfotl(text) {
  const re = /("[^"\n]*")|\b(LET|IN|Signature|Formula)\b|\b(int|string|float|bool)\b|([A-Za-z_][\w']*)(?=\()|([¬∧∨→↔∃∀⧫◊■□●○⊤⊥]|\b[SU](?=\[))|(\[[^\])\n]*[\])])|([\s\S])/g;
  let out = '', m;
  while ((m = re.exec(text))) {
    const [all, str, kw, type, fn, op, interval] = m;
    const cls = str ? 'tok-str' : kw ? 'tok-kw' : type ? 'tok-com' : fn ? 'tok-fn' : op ? 'tok-op' : interval ? 'tok-com' : '';
    out += cls ? `<span class="${cls}">${esc(all)}</span>` : esc(all);
  }
  return out;
}
