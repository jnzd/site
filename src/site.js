// Section rail and reading progress.
// Scrolling only reads window.scrollY: heading positions are measured once
// (and again on resize or when fonts load), and only what changed is written.
(() => {
  const rail = document.querySelector('.rail');
  const bar = document.querySelector('.progress');
  const post = document.querySelector('.post');
  const links = rail ? [...rail.querySelectorAll('a')] : [];
  const sections = links.map((a) => document.getElementById(a.dataset.target));
  const levels = links.map((a) => Number(a.className.match(/l(\d)/)?.[1] || 1));
  const names = links.map((a) => a.querySelector('.name').textContent);
  const trail = rail && rail.querySelector('.rail-trail');
  const trailC = trail && trail.querySelector('.c');
  const trailS = trail && trail.querySelector('.s');
  let start = 0, span = 1, railH = 0;
  let tops = [];  // each heading's position in the document, px
  let pos = [];   // each tick's position on the rail, 0..1
  let shownCurrent = -2, passedUpTo = -1, visible = null;

  function layout() {
    start = post.getBoundingClientRect().top + window.scrollY;
    span = Math.max(1, post.offsetHeight - window.innerHeight * 0.5);
    tops = sections.map((s) => s.getBoundingClientRect().top + window.scrollY);
    pos = tops.map((t) => Math.min(1, Math.max(0, (t - start) / span)));
    links.forEach((a, i) => { a.style.top = (pos[i] * 100) + '%'; });
    railH = rail ? rail.getBoundingClientRect().height : 0;
    passedUpTo = -1;
    links.forEach((a) => a.classList.remove('passed'));
    shownCurrent = -2;
    update();
  }

  function update() {
    const sy = window.scrollY;
    const progress = Math.min(1, Math.max(0, (sy + window.innerHeight * 0.25 - start) / span));
    if (bar) bar.style.setProperty('--p', progress.toFixed(4));
    if (!rail) return;
    rail.style.setProperty('--p', progress.toFixed(4));
    rail.style.setProperty('--py', (progress * railH).toFixed(1) + 'px');
    const show = sy > window.innerHeight * 0.5;
    if (show !== visible) { rail.classList.toggle('visible', show); visible = show; }
    // Ticks before the progress point are "passed" (positions are sorted).
    let upTo = -1;
    while (upTo + 1 < pos.length && pos[upTo + 1] <= progress) upTo++;
    for (let i = Math.min(upTo, passedUpTo) + 1; i <= Math.max(upTo, passedUpTo); i++) links[i].classList.toggle('passed', i <= upTo);
    passedUpTo = upTo;
    // The current heading is the last one above 30% of the window.
    const line = sy + window.innerHeight * 0.3;
    let current = -1;
    while (current + 1 < tops.length && tops[current + 1] <= line) current++;
    if (current === shownCurrent) return;
    if (shownCurrent >= 0) links[shownCurrent].removeAttribute('aria-current');
    if (current >= 0) links[current].setAttribute('aria-current', 'location');
    shownCurrent = current;
    if (trail) {
      let chapter = current;
      while (chapter > 0 && levels[chapter] !== 1) chapter--;
      trailC.textContent = chapter >= 0 ? names[chapter] : '';
      trailS.textContent = current > chapter ? names[current] : '';
    }
  }

  // Hovering in the band left of the line: the nearest tick (within 14px) is
  // highlighted; other ticks within 70px show their names in grey, fading with
  // distance. In a long stretch with no ticks nearby, the closest tick above
  // and below are shown instead. Labels never overlap: closer ones win.
  // Work is done at most once per frame, with the rail measured on entry.
  const zone = rail && rail.querySelector('.rail-zone');
  if (zone) {
    const RANGE = 70, HIT = 14, GAP = 15;
    let lit = [], hot = -1, railTop = 0, lastY = null, pending = false;
    const clear = () => {
      lit.forEach((i) => { links[i].classList.remove('hot', 'near'); links[i].querySelector('.name').style.opacity = ''; });
      lit = [];
      hot = -1;
    };
    const render = () => {
      pending = false;
      if (lastY === null) return;
      clear();
      const y = lastY - railTop;
      const dist = pos.map((p, i) => ({ i, ty: p * railH, d: Math.abs(p * railH - y) })).sort((p, q) => p.d - q.d);
      let pick = dist.filter((x) => x.d <= RANGE);
      if (!pick.length) {
        const above = dist.find((x) => x.ty < y), below = dist.find((x) => x.ty >= y);
        pick = [above, below].filter(Boolean).map((x) => ({ ...x, far: true }));
      }
      const taken = [];
      for (const x of pick) {
        if (taken.some((t) => Math.abs(t - x.ty) < GAP)) continue;
        taken.push(x.ty);
        lit.push(x.i);
        if (x === pick[0] && x.d <= HIT && !x.far) { links[x.i].classList.add('hot'); hot = x.i; continue; }
        links[x.i].classList.add('near');
        links[x.i].querySelector('.name').style.opacity = x.far ? 0.55 : Math.max(0.2, 1 - x.d / RANGE).toFixed(2);
      }
    };
    zone.addEventListener('mouseenter', () => {
      const r = rail.getBoundingClientRect();
      railTop = r.top;
      railH = r.height;
      rail.classList.add('hovering');
    });
    zone.addEventListener('mousemove', (e) => {
      lastY = e.clientY;
      if (!pending) { pending = true; requestAnimationFrame(render); }
    });
    zone.addEventListener('mouseleave', () => { lastY = null; clear(); rail.classList.remove('hovering'); });
    zone.addEventListener('click', () => { if (hot >= 0) links[hot].click(); });
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
    if (!running) return;
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
  // Only animate while the drawing is on screen.
  let running = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !running) { running = true; last = 0; requestAnimationFrame(tick); }
    else if (!e.isIntersecting) running = false;
  }).observe(svg);
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
