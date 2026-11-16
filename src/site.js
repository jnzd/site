// Section rail and reading progress.
(() => {
  const root = document.documentElement;
  const rail = document.querySelector('.rail');
  const post = document.querySelector('.post');
  const links = rail ? [...rail.querySelectorAll('a')] : [];
  const sections = links.map((a) => document.getElementById(a.dataset.target));
  let start = 0;
  let span = 1;

  // Each section's tick sits at the same fraction of the rail as the
  // section's position within the article.
  function layout() {
    start = post.offsetTop;
    span = Math.max(1, post.offsetHeight - window.innerHeight * 0.5);
    links.forEach((a, i) => {
      const y = sections[i].getBoundingClientRect().top + window.scrollY;
      a.style.top = Math.min(100, Math.max(0, ((y - start) / span) * 100)) + '%';
    });
    update();
  }

  function update() {
    const y = window.scrollY + window.innerHeight * 0.25;
    const progress = Math.min(1, Math.max(0, (y - start) / span));
    root.style.setProperty('--progress', progress.toFixed(4));
    if (!rail) return;
    rail.classList.toggle('visible', window.scrollY > window.innerHeight * 0.5);
    let current = -1;
    sections.forEach((s, i) => {
      if (s.getBoundingClientRect().top <= window.innerHeight * 0.3) current = i;
    });
    links.forEach((a, i) => a.classList.toggle('current', i === current));
  }

  let queued = false;
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }, { passive: true });
  window.addEventListener('resize', layout);
  window.addEventListener('load', layout);
  if (document.fonts) document.fonts.ready.then(layout);
  layout();
})();

// Sideways-scrolling boxes (wide formulas, code, tables) fade out on each edge
// that has more content beyond it, so it is clear they continue.
(() => {
  const boxes = document.querySelectorAll('.table-scroll, .katex-display, pre, ol.algorithm-lines');
  function mark(el) {
    const max = el.scrollWidth - el.clientWidth;
    const left = el.scrollLeft > 1;
    const right = max > 1 && el.scrollLeft < max - 1;
    const more = left && right ? 'both' : left ? 'left' : right ? 'right' : '';
    if (more) el.dataset.more = more; else delete el.dataset.more;
  }
  const markAll = () => boxes.forEach(mark);
  boxes.forEach((el) => el.addEventListener('scroll', () => mark(el), { passive: true }));
  window.addEventListener('resize', markAll);
  window.addEventListener('load', markAll);
  if (document.fonts) document.fonts.ready.then(markAll);
  markAll();
})();
