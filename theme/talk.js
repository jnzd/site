// Present mode for talk pages: shows the title and then one slide at a time,
// on a fixed 16:9 stage scaled to the window. Arrow keys, space and page keys move (on touch screens: swipe, or tap the right or left side); Esc leaves
// and returns to the slide in the article. ?present opens a page in it.
(() => {
  const slides = [document.querySelector('.hero'), ...document.querySelectorAll('.slide')];
  const start = document.querySelector('[data-present]');
  if (!start || slides.length < 2) return;

  const bar = document.createElement('div');
  bar.className = 'present-bar';
  bar.innerHTML = '<button type="button" data-go="-1" aria-label="Previous slide">←</button>'
    + '<span class="count"></span>'
    + '<button type="button" data-go="1" aria-label="Next slide">→</button>'
    + '<button type="button" data-exit aria-label="Leave present mode">Esc</button>';
  document.body.append(bar);
  const count = bar.querySelector('.count');
  // No Esc key on a touch screen: the button shows a cross there.
  if (matchMedia('(hover: none)').matches) bar.querySelector('[data-exit]').textContent = '✕';
  let i = -1;

  // The stage is 960x540; one scale for the window, the same for every slide.
  const STAGE_W = 960, STAGE_H = 540;
  const setScale = () => document.documentElement.style.setProperty('--scale',
    Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H).toFixed(4));

  // Every slide uses the same 960x540 stage, so titles never move. Content that
  // overflows it (down, or sideways inside a code block, table or formula) is
  // zoomed out just enough to fit: first only the big blocks (figures, code,
  // tables), and only if that is not enough, everything below the title.
  function overflows(el) {
    if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) return true;
    return [...el.querySelectorAll('pre, .table-scroll, .katex-display')].some((b) => b.scrollWidth > b.clientWidth + 1);
  }
  const TEXT = new Set(['H2', 'H3', 'P', 'UL', 'OL']);
  function shrink(el, parts) {
    const set = (z) => parts.forEach((p) => { p.style.zoom = z; });
    let lo = 0.4, hi = 1;
    for (let k = 0; k < 10; k++) {
      const mid = (lo + hi) / 2;
      set(mid);
      if (overflows(el)) hi = mid; else lo = mid;
    }
    set(lo);
    return !overflows(el);
  }
  function fit(el) {
    const body = [...el.children].filter((c) => c.tagName !== 'H3' && !c.classList.contains('notes'));
    body.forEach((c) => { c.style.zoom = ''; });
    if (!overflows(el)) return;
    const blocks = body.filter((c) => !TEXT.has(c.tagName) || c.querySelector('pre, figure, table, .katex-display'));
    if (blocks.length && shrink(el, blocks)) {
      // Not below 0.6 for blocks alone: then the text shrinks with them.
      if (Number(blocks[0].style.zoom) >= 0.6) return;
    }
    body.forEach((c) => { c.style.zoom = ''; });
    shrink(el, body);
  }

  function show(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (slides[i]) slides[i].classList.remove('current');
    i = n;
    slides[i].classList.add('current');
    fit(slides[i]);
    // Images still loading (lazy) change the height: fit again when they arrive.
    const el = slides[i];
    el.querySelectorAll('img').forEach((im) => {
      if (im.complete) return;
      im.loading = 'eager';
      im.addEventListener('load', () => { if (el.classList.contains('current')) fit(el); }, { once: true });
    });
    count.textContent = `${i + 1} / ${slides.length}`;
  }

  function enter(from) {
    if (presenting()) return;
    // Start at the given slide, or at the slide currently on screen.
    let n = 0;
    if (typeof from === 'number') n = from;
    else {
      const y = window.innerHeight * 0.3;
      slides.forEach((s, k) => { if (s.getBoundingClientRect().top <= y) n = k; });
    }
    setScale();
    document.body.classList.remove('deck');
    document.body.classList.add('presenting');
    show(n);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function exit() {
    const el = slides[i];
    document.body.classList.remove('presenting');
    slides.forEach((s) => s.classList.remove('current'));
    if (document.fullscreenElement) document.exitFullscreen?.();
    deck();
    el?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  const presenting = () => document.body.classList.contains('presenting');
  start.addEventListener('click', () => enter());
  document.querySelectorAll('[data-present-from]').forEach((b) => b.addEventListener('click', () => enter(Number(b.dataset.presentFrom) - 1)));

  // Deck view: on a wide window every slide is shown as a card the width of the
  // stage, zoomed to fit the page; narrower windows get the slides as plain text.
  const content = slides.slice(1);
  function deck() {
    if (presenting()) return;
    // Wider than the stage on big windows, but always a whole card in view.
    const z = Math.min(1.4, (window.innerWidth - 200) / STAGE_W, (window.innerHeight - 150) / STAGE_H);
    const on = (window.innerWidth - 200) / STAGE_W >= 0.75 && z >= 0.6;
    document.body.classList.toggle('deck', on);
    document.documentElement.style.setProperty('--deck-z', z.toFixed(4));
    // Cards grow taller rather than shrink their content: no zoom outside present mode.
    content.forEach((s) => [...s.children].forEach((c) => { c.style.zoom = ''; }));
  }
  deck();

  // A Present button that stays in view once the title is scrolled away: it
  // glides from the title's Present button into the top-left corner, and back.
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'present-fab';
  fab.innerHTML = start.innerHTML;
  fab.title = 'Present from the slide on screen (Esc leaves)';
  fab.addEventListener('click', () => enter());
  const nav = document.querySelector('.site-nav');
  if (nav) nav.querySelector('.site-name').after(fab); else document.body.append(fab);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  new IntersectionObserver(([e]) => {
    const show = !e.isIntersecting && e.boundingClientRect.top < 0;
    if (show === fab.classList.contains('show')) return;
    fab.classList.toggle('show', show);
    if (still) return;
    // A short glide between the title's button and the header; from at most
    // a little way off, so it never flies in from far away after a fast scroll.
    const r = start.getBoundingClientRect(), f = fab.getBoundingClientRect();
    const clamp = (v, m) => Math.max(-m, Math.min(m, v));
    const from = `translate(${clamp(r.left - f.left, 240)}px, ${clamp(r.top - f.top, 60)}px)`;
    fab.animate(show
      ? [{ transform: from, opacity: 0.6 }, { transform: 'none', opacity: 1 }]
      : [{ transform: 'none', opacity: 1 }, { transform: from, opacity: 0 }],
    { duration: show ? 200 : 150, easing: 'cubic-bezier(0.25, 0.9, 0.3, 1)' });
  }, { rootMargin: "-52px 0px 0px 0px" }).observe(start);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-exit')) exit(); else show(i + Number(b.dataset.go));
  });
  document.addEventListener('keydown', (e) => {
    if (!presenting() || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) show(i + (e.shiftKey && k === ' ' ? -1 : 1));
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) show(i - 1);
    else if (k === 'Home') show(0);
    else if (k === 'End') show(slides.length - 1);
    else if (k === 'Escape') exit();
    else return;
    e.preventDefault();
  });
  // Touch: swipe left or right, or tap the right or left part of the screen.
  let t0 = null;
  document.addEventListener('touchstart', (e) => {
    if (!presenting() || e.touches.length !== 1) { t0 = null; return; }
    const t = e.touches[0];
    t0 = { x: t.clientX, y: t.clientY, at: e.timeStamp };
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!presenting() || !t0) return;
    const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y;
    const from = t0; t0 = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > 1.5 * Math.abs(dy)) { show(i + (dx < 0 ? 1 : -1)); return; }
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && e.timeStamp - from.at < 400) {
      if (e.target.closest('a, button, input, summary, [data-more], .present-bar')) return;
      show(i + (t.clientX < window.innerWidth / 3 ? -1 : 1));
      e.preventDefault();
    }
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && presenting()) exit(); });
  window.addEventListener('resize', () => { if (presenting()) setScale(); else deck(); });
  if (new URLSearchParams(location.search).has('present')) enter();
})();
