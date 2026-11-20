// The landing page: a short intro and one card per thesis, with its talks.
export function renderHome({ site, cards, fillTemplate, esc, rel }) {
  const sorted = [...cards].sort((a, b) => (b.entry.home?.order ?? 0) - (a.entry.home?.order ?? 0));
  const items = sorted.map(({ entry, title }) => {
    const h = entry.home || {};
    const talks = (entry.talks || []).map((t) =>
      `<li><a href="${esc(rel('', t.path))}">${esc(t.title)}</a> <span class="meta">${esc([t.kind, t.date].filter(Boolean).join(' · '))}</span></li>`).join('');
    return `<article class="card">
  <p class="meta">${esc([h.kind, h.year].filter(Boolean).join(' · '))}</p>
  <h2><a href="${esc(rel('', entry.path))}">${esc(title)}</a></h2>
  ${h.blurb ? `<p>${esc(h.blurb)}</p>` : ''}
  ${talks ? `<ul class="talks">${talks}</ul>` : ''}
</article>`;
  }).join('\n');
  return fillTemplate({
    lang: 'en', title: site.name, subtitle: site.tagline, description: site.intro,
    author: site.name, institution: '', date: '', byline: '', people: '', actions: '', rail: '', heroVisual: '',
    content: `<p class="intro">${esc(site.intro)}</p>\n<section class="cards" aria-label="Work">\n${items}\n</section>`,
    root: '', scripts: '', bodyClass: 'home',
  });
}
