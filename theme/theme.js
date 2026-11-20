// Theme toggle: follows the system by default; a click cycles through
// system, light and dark, and the choice is kept for the next visit.
// (The saved choice is applied before the page paints by an inline script in <head>.)
// GitHub Pages lets browsers keep a page for 10 minutes. After a deploy, a
// kept page notices that version.json names a newer build and reloads once.
(() => {
  const meta = document.querySelector('meta[name="build"]');
  const me = document.currentScript || document.querySelector('script[src*="theme.js"]');
  if (!meta || !me || location.protocol === 'file:') return;
  const url = new URL('version.json', me.src);
  const check = () => fetch(url, { cache: 'no-store' }).then((r) => r.ok && r.json()).then((v) => {
    if (!v || !v.build || v.build === meta.content) return;
    const key = 'reloaded-for-' + v.build + location.pathname;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    location.reload();
  }).catch(() => {});
  check();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
})();

(() => {
  const root = document.documentElement;
  const host = document.querySelector('.site-nav, .reader-bar');
  if (!host) return;
  const order = ['system', 'light', 'dark'];
  const icons = {
    system: '<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>',
    light: '<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6L13 13M3 13l1.4-1.4M11.6 4.4L13 3"/>',
    dark: '<path d="M13.5 9.5A6 6 0 1 1 6.5 2.5a4.8 4.8 0 0 0 7 7z"/>',
  };
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'theme-toggle';
  const current = () => root.dataset.theme || 'system';
  function render() {
    const t = current();
    const nextT = order[(order.indexOf(t) + 1) % 3];
    b.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">${icons[t]}</svg><span>${t}</span>`;
    b.setAttribute('aria-label', `Theme: ${t}. Switch to ${nextT}.`);
    b.title = `Theme: ${t} (click for ${nextT})`;
  }
  b.addEventListener('click', () => {
    const t = order[(order.indexOf(current()) + 1) % 3];
    if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
    try { t === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', t); } catch {}
    render();
  });
  render();
  const close = host.querySelector('.reader-close');
  if (close) host.insertBefore(b, close); else host.append(b);
})();
