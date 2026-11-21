// Lexdoc on touch screens and inside the playground's frame.
//
// Lex's own script links a formula and its reading on hover only, which a
// touch screen has no way to do: here a tap pins the pair (tap again or
// elsewhere to let go). And the in-page links (#lex-event-…, #lex-section-…)
// are followed by script: in the playground's srcdoc frame a bare "#id"
// resolves against the playground's own address, so the browser would load
// that instead of jumping. scrollIntoView also scrolls the page around the
// frame when the frame is as tall as its document (phone layouts).
(function () {
  var PAIRS = [['lex-subformula', 'lex-subformula-reading'], ['lex-type-fix', 'lex-type-fix-reading']];
  var ACTIVE = { 'lex-subformula': 'lex-subformula-active', 'lex-type-fix': 'lex-subformula-active',
                 'lex-subformula-reading': 'lex-subformula-reading-active', 'lex-type-fix-reading': 'lex-subformula-reading-active' };
  var touch = false, pinned = [];
  document.addEventListener('pointerdown', function (e) { touch = e.pointerType !== 'mouse'; }, true);

  function unpin() {
    pinned.forEach(function (p) { p[0].classList.remove(p[1]); });
    pinned = [];
  }
  // The element of a formula/reading pair under the tap, and its partner.
  function pair(t) {
    for (var el = t; el && el.classList; el = el.parentElement) {
      if (!el.id) continue;
      for (var i = 0; i < PAIRS.length; i++) {
        var f = PAIRS[i][0], r = PAIRS[i][1], other = null;
        if (el.classList.contains(f) && el.id.indexOf('lex-subformula-') === 0)
          other = document.getElementById('lex-subformula-reading-' + el.id.slice('lex-subformula-'.length));
        else if (el.classList.contains(r) && el.id.indexOf('lex-subformula-reading-') === 0)
          other = document.getElementById('lex-subformula-' + el.id.slice('lex-subformula-reading-'.length));
        else continue;
        return [el, other];
      }
    }
    return null;
  }
  function cls(el) {
    for (var k in ACTIVE) if (el.classList.contains(k)) return ACTIVE[k];
    return null;
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a) {
      var target = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
      e.preventDefault();
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.classList.remove('lex-jumped'); void target.offsetWidth; target.classList.add('lex-jumped');
        try { if (window.parent === window) history.replaceState(null, '', a.getAttribute('href')); } catch (_) {}
      }
      return;
    }
    if (!touch) return;
    var p = pair(e.target);
    var same = p && pinned.length && pinned[0][0] === p[0];
    unpin();
    if (!p || same) return;
    p.forEach(function (el) { var c = el && cls(el); if (c) { el.classList.add(c); pinned.push([el, c]); } });
  });
})();
