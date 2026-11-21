// The bar on top of the full-size Lexdoc page: style, light/dark, print,
// PDF (the print dialog's Save as PDF) and download. Every style sheet is in the page, as
// <style data-style="…">; the chosen one is switched on by its media.
(() => {
  const root = document.documentElement;
  const sheets = [...document.querySelectorAll('style[data-style]')];
  const bar = document.querySelector('.lex-viewer-bar');
  const pick = bar.querySelector('select');
  const themeBtn = bar.querySelector('[data-act="theme"]');
  const dark = () => root.dataset.theme === 'dark' || (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  function apply() {
    const s = pick.value;
    for (const el of sheets) el.media = el.dataset.style === s || el.dataset.style.split(' ').includes(s) ? 'all' : 'not all';
    themeBtn.title = dark() ? 'Light' : 'Dark';
    themeBtn.setAttribute('aria-label', themeBtn.title);
    if (dark()) root.setAttribute('data-viewer-dark', ''); else root.removeAttribute('data-viewer-dark');
    root.dataset.style = s;
  }
  pick.value = root.dataset.style || 'site';
  pick.onchange = apply;
  themeBtn.onclick = () => { root.dataset.theme = dark() ? 'light' : 'dark'; apply(); };
  bar.querySelector('[data-act="print"]').onclick = () => print();
  bar.querySelector('[data-act="pdf"]').onclick = () => print();
  bar.querySelector('[data-act="download"]').onclick = () =>
    lexSaveHtml('<!DOCTYPE html>\n' + root.outerHTML, bar.dataset.file || 'lexdoc.html');
  apply();
  if (root.hasAttribute('data-print')) { root.removeAttribute('data-print'); addEventListener('load', () => setTimeout(print, 400)); }
})();
