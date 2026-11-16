# Thesis site

A single-page, article-style web version of the thesis, built directly from
its LaTeX source. The output is a static site with no third-party requests.

```bash
npm install
npm run dev     # build, watch and serve at http://localhost:4321
npm run build   # one-off build into dist/
```

Requires Node 20+ and `pandoc` on the PATH. The thesis source is read from the
parent folder (`thesisDir` in `site.config.json`, or the `THESIS_DIR`
environment variable).

## Where things live

| Path                  | What it is                                                    |
|-----------------------|---------------------------------------------------------------|
| `site.config.json`    | Thesis location, subtitle, PDF and source links, reference order |
| `lib/preprocess.mjs`  | Rewrites LaTeX that pandoc cannot handle (proof trees, algorithms, listings, TikZ) |
| `lib/postprocess.mjs` | Numbering, cross-references, citations, code highlighting, math rendering (KaTeX) |
| `public/figures/`     | SVG redrawings of the three TikZ diagrams                     |
| `src/style.css`       | Design; colours and column width are variables at the top     |
| `src/template.html`   | Page skeleton (hero, section rail, footer)                    |
| `src/site.js`         | Section rail and reading progress                             |
| `build.mjs`           | Runs the pipeline and the dev server                          |

The build prints a warning for any formula, reference or citation it could not
convert. After editing `build.mjs` or files in `lib/`, restart `npm run dev`.

## Publishing

`dist/` is plain static files; upload it to any static host (GitHub Pages,
Netlify, Cloudflare Pages, a university web space).
