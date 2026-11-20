// The landing page. Each thesis is a feature row: its animated title
// illustration beside its title, summary and buttons. Below, every talk is a
// card led by the first slide of its original deck.
import { icon } from './icons.mjs';
const year = (d) => Number((String(d || '').match(/\d{4}/) || [0])[0]);

export function renderHome({ site, cards, fillTemplate, esc, rel }) {
  const sorted = [...cards].sort((a, b) => (b.entry.home?.order ?? 0) - (a.entry.home?.order ?? 0));

  const theses = sorted.map(({ entry, title, visual }, i) => {
    const h = entry.home || {};
    const page = rel('', entry.path);
    const pdf = entry.pdf && (/^https?:/.test(entry.pdf) ? entry.pdf : page + entry.pdf);
    const talks = (entry.talks || []).filter((t) => t.path.startsWith(entry.path + '/'));
    return `<article class="feature${i % 2 ? ' flip' : ''}">
  <a class="feature-visual" href="${esc(page)}" tabindex="-1" aria-hidden="true">${visual || ''}</a>
  <div class="feature-text">
    <p class="kicker"><span class="year">${esc(h.year || '')}</span>${esc(h.kind || '')}</p>
    <h2><a href="${esc(page)}" title="Read the thesis">${esc(title)}<span class="go" aria-hidden="true">${icon('arrow')}</span></a></h2>
    ${entry.subtitle ? `<p class="summary">${esc(entry.subtitle)}</p>` : ''}
    <p class="feature-actions">${pdf ? `<a class="button" href="${esc(pdf)}" title="The thesis as submitted (PDF)">${icon('pdf')}PDF</a>` : ''}${talks.map((t) => `<a class="button" href="${esc(rel('', t.path))}" title="Talk: ${esc(t.title)}">${icon('talk')}${esc(t.short || 'Talk')}</a>`).join('')}</p>
  </div>
</article>`;
  }).join('\n');

  const allTalks = sorted.flatMap(({ entry, title }) => (entry.talks || []).map((t) => ({ t, entry, thesisTitle: title })))
    .sort((a, b) => year(b.t.date) - year(a.t.date));
  const talkCards = allTalks.map(({ t }) => `<article class="talk-card">
  <a class="talk-thumb" href="${esc(rel('', t.path))}" tabindex="-1" aria-hidden="true">${t.slides ? `<img src="${esc(rel('', t.path + '/slides'))}${String(t.thumbSlide || 1).padStart(2, '0')}.webp" alt="" decoding="async">` : ''}<span class="play">Open talk <span aria-hidden="true">→</span></span></a>
  <p class="kicker">${esc([t.kind, t.date].filter(Boolean).join(' · '))}</p>
  <h3><a href="${esc(rel('', t.path))}">${esc(t.title)}</a></h3>
  <p class="talk-actions"><a class="button small primary" href="${esc(rel('', t.path))}" title="The talk as a web page you can also present">${icon('talk')}Talk page</a>${t.slides ? `<a class="button small" href="${esc(rel('', t.path + '/slides'))}" title="The slides as given in the talk">${icon('slides')}Original slides</a>` : ''}</p>
</article>`).join('\n');

  const scripts = sorted.flatMap(({ entry }) => (entry.home?.visualScripts || []).map((s) => `${entry.path}/${s}`));
  return fillTemplate({
    lang: 'en', title: site.name, subtitle: site.intro, description: site.intro,
    author: site.name, institution: '', date: '',
    byline: `<span>${esc(site.tagline)}</span>`, people: '',
    actions: `<a class="button" href="#theses">Theses</a><a class="button" href="#talks">Talks</a>`,
    rail: '', heroVisual: '',
    content: `<section class="home-section" id="theses" aria-label="Theses">\n<h2 class="section-label">Theses</h2>\n${theses}\n</section>
<section class="home-section" id="talks" aria-label="Talks">\n<h2 class="section-label">Talks</h2>\n<div class="talk-grid">\n${talkCards}\n</div>\n</section>`,
    root: '', scripts: scripts.map((s) => `<script src="${esc(s)}" defer></script>`).join('\n'), bodyClass: 'home',
  });
}
