// Present mode for talk pages: shows the title and then one slide at a time,
// scaled to fill the window. Arrow keys, space and page keys move; Esc leaves
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
  let i = -1;

  // Largest zoom (up to 1.6x) at which the slide fits the window.
  function fit(el) {
    el.style.setProperty('--zoom', 1);
    const fits = (z) => {
      el.style.setProperty('--zoom', z);
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    };
    let lo = 0.5, hi = 1.6;
    if (fits(hi)) return;
    for (let k = 0; k < 8; k++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
    el.style.setProperty('--zoom', lo);
  }

  function show(n) {
    n = Math.max(0, Math.min(slides.length - 1, n));
    if (slides[i]) slides[i].classList.remove('current');
    i = n;
    slides[i].classList.add('current');
    fit(slides[i]);
    count.textContent = `${i + 1} / ${slides.length}`;
  }

  function enter() {
    if (presenting()) return;
    // Start at the slide currently on screen.
    const y = window.innerHeight * 0.3;
    let n = 0;
    slides.forEach((s, k) => { if (s.getBoundingClientRect().top <= y) n = k; });
    document.body.classList.add('presenting');
    show(n);
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  function exit() {
    const el = slides[i];
    document.body.classList.remove('presenting');
    slides.forEach((s) => { s.classList.remove('current'); s.style.removeProperty('--zoom'); });
    if (document.fullscreenElement) document.exitFullscreen?.();
    el?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }

  const presenting = () => document.body.classList.contains('presenting');
  start.addEventListener('click', enter);
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
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && presenting()) exit(); });
  window.addEventListener('resize', () => { if (presenting()) fit(slides[i]); });
  if (new URLSearchParams(location.search).has('present')) enter();
})();
