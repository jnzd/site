// PDF reader (a PDF's pages as images): page counter, arrow keys, #p12 opens page 12.
// Slides scroll sideways with the current one centred; pages of a document scroll down.
(() => {
  const n = document.querySelector('.count .n');
  const box = document.querySelector('.pages');
  const sheets = [...document.querySelectorAll('.pages .sheet')];
  const wide = box.classList.contains('slides');
  const prev = document.querySelector('.deck-nav [data-go="-1"]');
  const next = document.querySelector('.deck-nav [data-go="1"]');
  let cur = -1, queued = false;

  // Closing goes back to the page the reader was opened from (the home page,
  // the talk, the thesis); opened directly, it goes to the talk or thesis.
  const closeLink = document.querySelector('.reader-close');
  const cameFromSite = (() => { try { return document.referrer && new URL(document.referrer).origin === location.origin && !document.referrer.startsWith(location.href.split('#')[0]); } catch { return false; } })();
  function close() {
    if (cameFromSite && history.length > 1) history.back();
    else if (closeLink) location.href = closeLink.href;
  }
  closeLink?.addEventListener('click', (e) => { if (cameFromSite) { e.preventDefault(); close(); } });

  function current() {
    if (wide) {
      const mid = box.getBoundingClientRect().left + box.clientWidth / 2;
      let best = 0, d = Infinity;
      sheets.forEach((s, i) => { const r = s.getBoundingClientRect(), x = Math.abs(r.left + r.width / 2 - mid); if (x < d) { d = x; best = i; } });
      return best;
    }
    const mid = window.innerHeight / 2;
    let c = 0;
    sheets.forEach((s, i) => { if (s.getBoundingClientRect().top <= mid) c = i; });
    return c;
  }
  function update() {
    queued = false;
    const c = current();
    if (c === cur) return;
    sheets[cur]?.classList.remove('cur');
    cur = c;
    sheets[cur].classList.add('cur');
    n.textContent = cur + 1;
    if (prev) { prev.disabled = cur === 0; next.disabled = cur === sheets.length - 1; }
    history.replaceState(null, '', '#p' + (cur + 1));
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  (wide ? box : window).addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', () => go(cur, 'instant'));

  function go(i, behavior = 'smooth') {
    i = Math.max(0, Math.min(sheets.length - 1, i));
    sheets[i].scrollIntoView({ behavior, block: wide ? 'nearest' : 'start', inline: 'center' });
  }
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // Esc closes the reader and goes back to the page it came from.
    // (In full screen the browser takes Esc to leave full screen first.)
    if (e.key === 'Escape') { if (!document.fullscreenElement) close(); e.preventDefault(); return; }
    if (wide && (e.key === 'f' || e.key === 'F')) { full(); e.preventDefault(); return; }
    const keys = wide
      ? { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 1, ArrowUp: -1, PageDown: 1, PageUp: -1, ' ': 1, j: 1, k: -1 }
      : { ArrowRight: 1, ArrowLeft: -1, j: 1, k: -1 };
    if (wide && (e.key === 'Home' || e.key === 'End')) { go(e.key === 'Home' ? 0 : sheets.length - 1); e.preventDefault(); return; }
    const step = keys[e.key];
    if (!step) return;
    go(current() + (e.shiftKey && e.key === ' ' ? -1 : step), wide ? 'smooth' : 'instant');
    e.preventDefault();
  });

  // F (or the button) shows the slides full screen, one at a time, like a presentation.
  function full() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }
  document.querySelector('.full-toggle')?.addEventListener('click', full);
  document.addEventListener('fullscreenchange', () => {
    const on = !!document.fullscreenElement;
    document.body.classList.toggle('full', on);
    const b = document.querySelector('.full-toggle');
    if (b) b.title = on ? 'Leave full screen (F or Esc)' : 'Full screen (F)';
    requestAnimationFrame(() => go(cur, 'instant'));
  });

  if (wide) {
    document.querySelector('.deck-nav').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) go(cur + Number(b.dataset.go));
    });
    // Clicking a neighbour brings it to the centre.
    sheets.forEach((s, i) => s.addEventListener('click', () => { if (i !== cur) go(i); }));
    // A mouse wheel (up and down) moves one slide at a time.
    let lock = 0;
    box.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // trackpad swipes scroll natively
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4 || e.timeStamp < lock) return;
      lock = e.timeStamp + 350;
      go(cur + Math.sign(e.deltaY));
    }, { passive: false });
    box.focus({ preventScroll: true });
  }

  const m = location.hash.match(/^#p(\d+)$/);
  if (m) go(Number(m[1]) - 1, 'instant');
  update();
})();
