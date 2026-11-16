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

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Title page visual: four layers from the law down to a running system. Many
// events at the top thin out layer by layer; now and then one falls through,
// and about half stop at the refinement layer. Seeded, so it looks the same
// on every visit.
(() => {
  const svg = document.getElementById('hero-layers');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const CX = 220, HW = 185, HH = 34, GAP = 78, TOP = 52;
  const accentLine = 'color-mix(in srgb, var(--accent) 55%, var(--line))';
  const layers = [
    { name: 'Law', sub: 'Directive 2002/58/EC', dots: 34, color: 'var(--faint)', r: 1.6 },
    { name: 'Lex specification', sub: 'abstract events', dots: 20, color: 'var(--tok-fn)', r: 2 },
    { name: 'Refinement', sub: 'assume · strengthen', dots: 0, accent: true },
    { name: 'Running system', sub: 'enforced at runtime', dots: 8, color: 'var(--accent)', r: 2.6 },
  ];
  const yOf = (i) => TOP + i * GAP;
  const diamond = (y, dy = 0) => `${CX - HW},${y + dy} ${CX},${y - HH + dy} ${CX + HW},${y + dy} ${CX},${y + HH + dy}`;
  const inside = () => {
    for (;;) {
      const u = rnd() * 2 - 1, v = rnd() * 2 - 1;
      if (Math.abs(u) + Math.abs(v) < 0.78) return [CX + u * HW, v * HH];
    }
  };

  const defs = el('defs', {});
  const gradient = (id, from, to) => {
    const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    el('stop', { offset: 0, 'stop-color': from }, g);
    el('stop', { offset: 1, 'stop-color': to }, g);
  };
  gradient('hl-plane', 'var(--panel)', 'var(--bg)');
  gradient('hl-accent', 'color-mix(in srgb, var(--accent) 16%, var(--bg))', 'color-mix(in srgb, var(--accent) 6%, var(--bg))');

  // Bottom layer first, so the upper layers sit in front.
  for (let i = layers.length - 1; i >= 0; i--) {
    const L = layers[i], y = yOf(i);
    el('polygon', { points: diamond(y, 5), fill: 'color-mix(in srgb, var(--strong) 7%, var(--bg))' });
    el('polygon', { points: diamond(y), fill: L.accent ? 'url(#hl-accent)' : 'url(#hl-plane)', stroke: L.accent ? accentLine : 'var(--line)' });
    for (let k = 0; k < L.dots; k++) {
      const [x, dy] = inside();
      el('circle', { cx: x, cy: y + dy, r: L.r, fill: L.color, opacity: i === 0 ? 0.7 : 0.85 });
    }
    el('line', { x1: CX + HW, y1: y, x2: CX + HW + 16, y2: y, stroke: L.accent ? accentLine : 'var(--line)' });
    el('text', { x: CX + HW + 22, y: y - 2, class: 'mono name ' + (L.accent ? 'acc' : 'txt'), 'font-size': 11.5 }).textContent = L.name;
    el('text', { x: CX + HW + 22, y: y + 12, class: 'mono mut sub', 'font-size': 9 }).textContent = L.sub;
  }
  if (reduceMotion) return;

  const fx = el('g', {});
  const live = [];
  function spawn() {
    if (live.length >= 4) return;
    const [x, dy] = inside();
    const stops = rnd() < 0.5;
    live.push({ c: el('circle', { cx: x, r: 2.2, fill: 'var(--tok-fn)' }, fx), x, dy, t: 0, end: stops ? 2 : 3, stops });
  }
  let last = 0, lastSpawn = -2000;
  function tick(now) {
    const dt = Math.min(50, now - (last || now));
    last = now;
    if (document.hidden) { requestAnimationFrame(tick); return; }
    if (now - lastSpawn > 1500) { spawn(); lastSpawn = now; }
    for (let i = live.length - 1; i >= 0; i--) {
      const p = live[i];
      p.t += dt / 2600; // one layer per 2.6 s
      const pos = Math.min(p.t, p.end);
      const y = yOf(0) + pos * GAP + p.dy;
      p.c.setAttribute('cy', y);
      p.c.setAttribute('fill', pos > 2 ? 'var(--accent)' : 'var(--tok-fn)');
      p.c.setAttribute('opacity', Math.min(1, p.t * 3));
      if (p.t >= p.end) {
        const mark = el('circle', { cx: p.x, cy: y, r: 3, class: p.stops ? 'ring' : 'ripple', 'stroke-width': 1.2 }, fx);
        mark.animate([{ r: 3, opacity: 0.9 }, { r: 12, opacity: 0 }], { duration: 1400, easing: 'ease-out' }).onfinish = () => mark.remove();
        p.c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' }).onfinish = () => p.c.remove();
        live.splice(i, 1);
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

// Web-only figures draw their branches once they scroll into view.
(() => {
  if (reduceMotion || !('IntersectionObserver' in window)) return;
  const figs = document.querySelectorAll('.refinement-tree');
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
  }), { threshold: 0.4 });
  figs.forEach((f) => { f.classList.add('animate'); io.observe(f); });
})();
