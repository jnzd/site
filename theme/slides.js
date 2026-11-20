// PDF reader (a PDF's pages as images): page counter, arrow keys, #p12 opens page 12.
(() => {
  const n = document.querySelector('.count .n');
  const imgs = [...document.querySelectorAll('.pages img')];
  let queued = false;
  const update = () => {
    queued = false;
    const mid = window.innerHeight / 2;
    let cur = 0;
    imgs.forEach((im, i) => { if (im.getBoundingClientRect().top <= mid) cur = i; });
    n.textContent = cur + 1;
  };
  window.addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = { ArrowRight: 1, ArrowLeft: -1, j: 1, k: -1 }[e.key];
    if (!step) return;
    const i = Math.max(0, Math.min(imgs.length - 1, Number(n.textContent) - 1 + step));
    imgs[i].scrollIntoView({ behavior: 'instant', block: 'start' });
    e.preventDefault();
  });
  const m = location.hash.match(/^#p(\d+)$/);
  if (m) document.getElementById('p' + m[1])?.scrollIntoView({ block: 'start' });
  update();
})();
