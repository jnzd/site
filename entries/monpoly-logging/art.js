// Web-only illustrations for the bachelor's thesis and its talk.
// Seeded, so they look the same on every visit; they only animate while on
// screen and stay still for people who prefer reduced motion.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const seeded = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const whenVisible = (node, start, stop) => new IntersectionObserver(([e]) => (e.isIntersecting ? start() : stop())).observe(node);

  // ---- Thesis title: one trace, logged and monitored --------------------
  // Time points arrive at "now". Each is stored in QuestDB (the rows of dots,
  // which drift into the past) and checked by MonPoly (a verdict tick above).
  // Every so often the policy changes: the relative interval of the new
  // policy opens over the last 60 time units, and only the events its
  // extended relative intervals need light up and are read again.
  (() => {
    const svg = document.getElementById('hero-trace');
    if (!svg) return;
    const rnd = seeded(5);
    const NOW = 404, PX = 3.4, LEFT = 14;      // x of "now", px per time unit
    const MON = 58, ROWS = { P: 126, Q: 152, R: 178 }, DB_TOP = 104, DB_BOT = 200;
    const xOf = (age) => NOW - age * PX;

    el('rect', { x: LEFT - 6, y: DB_TOP, width: NOW - LEFT + 6, height: DB_BOT - DB_TOP, rx: 6, class: 'db' }, svg);
    for (const [p, y] of Object.entries(ROWS)) {
      el('path', { d: `M${LEFT} ${y}H${NOW}`, class: 'lane' }, svg);
      el('text', { x: LEFT, y: y - 6, class: 'mono rowname' }, svg).textContent = p;
    }
    el('path', { d: `M${LEFT} ${MON}H${NOW}`, class: 'lane' }, svg);
    el('path', { d: `M${NOW} ${MON - 22}V${DB_BOT + 10}`, class: 'now' }, svg);
    el('text', { x: NOW, y: DB_BOT + 26, 'text-anchor': 'middle', class: 'mono sub' }, svg).textContent = 'now';
    const label = (y, name, sub, acc) => {
      el('line', { x1: NOW + 8, y1: y, x2: NOW + 22, y2: y, class: 'tie' }, svg);
      el('text', { x: NOW + 28, y: y - 2, class: 'mono name ' + (acc ? 'acc' : 'txt') }, svg).textContent = name;
      el('text', { x: NOW + 28, y: y + 12, class: 'mono sub' }, svg).textContent = sub;
    };
    label(MON, 'MonPoly', 'a verdict per time point');
    label(152, 'QuestDB', 'every event, stored');

    // Policy-change overlay (hidden until a change runs).
    const change = el('g', { class: 'change' }, svg);
    const win = el('rect', { x: xOf(60), y: DB_TOP - 8, width: 60 * PX, height: DB_BOT - DB_TOP + 16, rx: 6, class: 'window' }, change);
    el('path', { d: `M${xOf(60)} ${DB_TOP - 14}V${DB_TOP - 20}H${NOW}V${DB_TOP - 14}`, class: 'bracket' }, change);
    el('text', { x: xOf(30), y: DB_TOP - 26, 'text-anchor': 'middle', class: 'mono ri' }, change).textContent = 'policy change: RI(φ′) = (−60, 0]';
    const count = el('text', { x: xOf(30), y: DB_BOT + 26, 'text-anchor': 'middle', class: 'mono acc' }, change);
    win.style.transformOrigin = `${NOW}px 0`;

    const dots = el('g', {}, svg), marks = el('g', {}, svg), fx = el('g', {}, svg);
    const live = [];   // { t, p, v, c }
    const verdicts = []; // { t, m }
    let T = 0;
    const needed = (e, now) => {
      const age = now - e.t;
      return (e.p === 'P' && age >= 20 && age < 60) || (e.p === 'P' && e.v === 'a' && age < 30)
        || (e.p === 'Q' && e.v === '2' && age < 30) || (e.p === 'R' && e.v === 'c' && age < 60);
    };
    function timePoint(at, quiet) {
      const n = 1 + Math.floor(rnd() * 2.4);
      const used = new Set();
      for (let k = 0; k < n; k++) {
        const p = 'PQR'[Math.floor(rnd() * 3)];
        if (used.has(p)) continue;
        used.add(p);
        const v = { P: ['a', 'b'], Q: ['2', '5'], R: ['c', 'd'] }[p][rnd() < 0.4 ? 0 : 1];
        const c = el('circle', { cx: xOf(T - at), cy: ROWS[p], r: 2.6, class: 'ev' }, dots);
        live.push({ t: at, p, v, c });
        if (!quiet && !reduce) c.animate([{ r: 0.5, opacity: 0 }, { r: 2.6, opacity: 1 }], { duration: 400, easing: 'ease-out' });
      }
      const bad = rnd() < 0.12;
      const m = el('path', { d: bad ? 'M0 -7V7' : 'M0 -4V4', class: 'verdict' + (bad ? ' bad' : '') }, marks);
      verdicts.push({ t: at, m });
      if (!quiet && !reduce) {
        // the time point travels up to the monitor
        const s = el('circle', { cx: NOW, cy: DB_TOP, r: 2, class: 'spark' }, fx);
        s.animate([{ cy: DB_TOP, opacity: 0.9 }, { cy: MON, opacity: 0.2 }], { duration: 520, easing: 'ease-in' }).onfinish = () => s.remove();
        if (bad) {
          const r = el('circle', { cx: NOW, cy: MON, r: 3, class: 'ring' }, fx);
          r.animate([{ r: 3, opacity: 0.9 }, { r: 13, opacity: 0 }], { duration: 1300, delay: 450, easing: 'ease-out' }).onfinish = () => r.remove();
        }
      }
    }
    function place() {
      for (let i = live.length - 1; i >= 0; i--) {
        const e = live[i], x = xOf(T - e.t);
        if (x < LEFT) { e.c.remove(); live.splice(i, 1); continue; }
        e.c.setAttribute('cx', x.toFixed(1));
        e.c.setAttribute('opacity', Math.min(1, (x - LEFT) / 60).toFixed(2));
      }
      for (let i = verdicts.length - 1; i >= 0; i--) {
        const v = verdicts[i], x = xOf(T - v.t);
        if (x < LEFT) { v.m.remove(); verdicts.splice(i, 1); continue; }
        v.m.setAttribute('transform', `translate(${x.toFixed(1)} ${MON})`);
        v.m.setAttribute('opacity', Math.min(1, (x - LEFT) / 60).toFixed(2));
      }
    }
    // Start with a full trace.
    let next = -120;
    for (T = -120; T < 0; T += 0.5) if (T >= next) { timePoint(T, true); next = T + 3 + rnd() * 4; }
    place();

    let changing = false;
    function policyChange(still) {
      changing = true;
      const now = T;
      let hit = 0, all = 0;
      for (const e of live) {
        if (now - e.t >= 60) continue;
        all++;
        if (needed(e, now)) { hit++; e.c.classList.add('keep'); } else e.c.classList.add('skip');
      }
      count.textContent = `ERI(φ′) reads ${hit} of ${all} events`;
      change.classList.add('on');
      if (still) return;
      win.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 700, easing: 'ease-out' });
      setTimeout(() => {
        change.classList.remove('on');
        for (const e of live) e.c.classList.remove('keep', 'skip');
        changing = false;
      }, 4200);
    }

    if (reduce) { policyChange(true); return; }
    let last = 0, running = false, sinceChange = 6;
    function tick(now) {
      if (!running) return;
      const dt = Math.min(60, now - (last || now)) / 1000;
      last = now;
      if (!changing) {
        T += dt * 3.2;          // time units per second
        sinceChange += dt;
        if (T >= next) { timePoint(T); next = T + 3 + rnd() * 4; }
        if (sinceChange > 11) { sinceChange = 0; policyChange(); }
        place();
      }
      requestAnimationFrame(tick);
    }
    whenVisible(svg, () => { if (!running) { running = true; last = 0; requestAnimationFrame(tick); } }, () => { running = false; });
  })();

  // ---- Talk title: the wrapper at work -----------------------------------
  // Events flow from the user through the wrapper to MonPoly and QuestDB;
  // verdicts flow back. Every so often the policy changes: the wrapper
  // queries QuestDB, and the answer is fed into the restarted monitor.
  (() => {
    const svg = document.getElementById('hero-flow');
    if (!svg) return;
    const N = {
      user: { x: 56, y: 150, w: 84, name: 'User', sub: 'sends events' },
      wrap: { x: 236, y: 150, w: 104, name: 'Wrapper', sub: 'REST API' },
      mon: { x: 430, y: 66, w: 104, name: 'MonPoly', sub: 'monitors φ' },
      db: { x: 430, y: 234, w: 104, name: 'QuestDB', sub: 'stores the trace' },
    };
    const H = 34;
    const edge = (a, b, bend = 0) => {
      const A = N[a], B = N[b];
      const x1 = A.x + A.w / 2, x2 = B.x - B.w / 2;
      return { x1, y1: A.y + bend, x2, y2: B.y + bend };
    };
    const E = {
      in: edge('user', 'wrap'),
      toMon: edge('wrap', 'mon', -6), fromMon: edge('wrap', 'mon', 6),
      toDb: edge('wrap', 'db', -6), fromDb: edge('wrap', 'db', 6),
    };
    for (const k in E) el('line', { ...E[k], class: 'wire' }, svg);
    const subs = {};
    for (const [k, n] of Object.entries(N)) {
      el('rect', { x: n.x - n.w / 2, y: n.y - H / 2, width: n.w, height: H, rx: H / 2, class: 'node' + (k === 'wrap' ? ' hub' : '') }, svg);
      el('text', { x: n.x, y: n.y + 4.5, 'text-anchor': 'middle', class: 'mono name txt' }, svg).textContent = n.name;
      subs[k] = el('text', { x: n.x, y: n.y + H / 2 + 16, 'text-anchor': 'middle', class: 'mono sub' }, svg);
      subs[k].textContent = n.sub;
    }
    if (reduce) return;

    const fx = el('g', {}, svg);
    // Move a packet along an edge; dir = 1 forwards, -1 backwards.
    const send = (e, cls, dir = 1, delay = 0, dur = 900) => new Promise((done) => setTimeout(() => {
      const [xa, ya, xb, yb] = dir > 0 ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
      const c = el('circle', { cx: xa, cy: ya, r: 4, class: 'pkt ' + cls }, fx);
      c.animate([{ cx: xa, cy: ya, opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.85 }, { cx: xb, cy: yb, opacity: 0 }],
        { duration: dur, easing: 'ease-in-out' }).onfinish = () => { c.remove(); done(); };
    }, delay));
    const pulse = (k) => {
      const n = N[k];
      const r = el('rect', { x: n.x - n.w / 2, y: n.y - H / 2, width: n.w, height: H, rx: H / 2, class: 'flash' }, fx);
      r.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 900, easing: 'ease-out' }).onfinish = () => r.remove();
    };

    const rnd = seeded(3);
    let step = 0, version = 0, running = false, timer = 0;
    async function cycle() {
      if (!running) return;
      step++;
      if (step % 7 === 0) {
        // policy change
        version++;
        subs.wrap.textContent = 'change policy';
        await send(E.toDb, 'query', 1, 0, 800);
        pulse('db');
        // the answer comes back to the wrapper and is fed to the new monitor
        await Promise.all([0, 160, 320].map((d) => send(E.fromDb, 'answer', -1, d, 800)));
        await Promise.all([0, 140, 280].map((d) => send(E.toMon, 'answer', 1, d, 800)));
        pulse('mon');
        subs.mon.textContent = 'monitors φ' + '′'.repeat(version % 3 || 3);
        subs.wrap.textContent = N.wrap.sub;
      } else {
        await send(E.in, 'event', 1, 0, 800);
        await Promise.all([send(E.toMon, 'event'), send(E.toDb, 'event')]);
        if (rnd() < 0.3) {
          await send(E.fromMon, 'verdict', -1, 0, 800);
          await send(E.in, 'verdict', -1, 0, 800);
        }
      }
      timer = setTimeout(cycle, 350);
    }
    whenVisible(svg, () => { if (!running) { running = true; cycle(); } }, () => { running = false; clearTimeout(timer); });
  })();

  // ---- Inline formulas wider than their line scroll on their own --------
  // (on phones some formulas are wider than the column; see .katex.wide)
  const inline = [...document.querySelectorAll('.post .katex')].filter((k) => !k.closest('.katex-display'));
  const markWide = () => inline.forEach((k) => {
    k.classList.remove('wide');
    const box = k.parentElement.getBoundingClientRect();
    const over = [...k.querySelectorAll('.katex-html > .base')].some((b) => b.getBoundingClientRect().right > box.right + 1);
    if (over) k.classList.add('wide');
  });
  window.addEventListener('resize', markWide);
  window.addEventListener('load', markWide);
  if (document.fonts) document.fonts.ready.then(markWide);
  markWide();

  // ---- Inline figures: draw in once they scroll into view ---------------
  if (!reduce && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in-view'); io.unobserve(e.target); }
    }), { threshold: 0.35 });
    document.querySelectorAll('.eri-fig').forEach((f) => { f.classList.add('animate'); io.observe(f); });
  }
})();
