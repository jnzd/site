// The landing page: a short intro and one card per thesis, with its talks.
// Every link is a visible control: buttons for the thesis and its PDF, and a
// row per talk with a "Slides" button beside it.
export function renderHome({ site, cards, fillTemplate, esc, rel }) {
  const sorted = [...cards].sort((a, b) => (b.entry.home?.order ?? 0) - (a.entry.home?.order ?? 0));
  const items = sorted.map(({ entry, title }) => {
    const h = entry.home || {};
    const page = rel('', entry.path);
    const pdf = entry.pdf && (/^https?:/.test(entry.pdf) ? entry.pdf : page + entry.pdf);
    const talks = (entry.talks || []).map((t) => `<li>
      <a class="talk-link" href="${esc(rel('', t.path))}"><span class="talk-title">${esc(t.title)}</span><span class="meta">${esc([t.kind, t.date].filter(Boolean).join(' · '))}</span><span class="go" aria-hidden="true">→</span></a>
      ${t.slides ? `<a class="button small" href="${esc(rel('', t.path + '/slides'))}">Slides</a>` : ''}
    </li>`).join('');
    return `<article class="card">
  <p class="meta">${esc([h.kind, h.year].filter(Boolean).join(' · '))}</p>
  <h2><a href="${esc(page)}">${esc(title)}</a></h2>
  ${h.blurb ? `<p>${esc(h.blurb)}</p>` : ''}
  <p class="card-actions"><a class="button primary" href="${esc(page)}">Read the thesis</a>${pdf ? `<a class="button" href="${esc(pdf)}">PDF</a>` : ''}</p>
  ${talks ? `<p class="talks-label">${entry.talks.length > 1 ? 'Talks' : 'Talk'}</p><ul class="talks">${talks}</ul>` : ''}
</article>`;
  }).join('\n');
  return fillTemplate({
    lang: 'en', title: site.name, subtitle: site.tagline, description: site.intro,
    author: site.name, institution: '', date: '', byline: '', people: '', actions: '', rail: '', heroVisual: '',
    content: `<p class="intro">${esc(site.intro)}</p>\n<section class="cards" aria-label="Work">\n${items}\n</section>`,
    root: '', scripts: '', bodyClass: 'home',
  });
}
