# Personal site

Theses and talks as web pages, built from their LaTeX sources into one static
site with no third-party requests.

```bash
git clone --recurse-submodules https://github.com/jnzd/site
npm install
npm run dev     # build, watch and serve at http://localhost:4321
npm run build   # one-off build into dist/
```

Requires Node 20+, `pandoc` and `pdftoppm` (poppler) on the PATH.

## Where things live

| Path                     | What it is                                                      |
|--------------------------|-----------------------------------------------------------------|
| `content/`               | The thesis and slide repos, as git submodules (LaTeX sources)   |
| `entries/<name>/`        | One folder per page: `entry.json` plus its web-only parts       |
| `theme/`                 | Shared look: `style.css`, `template.html`, `site.js`, `talk.js`, `slides.js` |
| `lib/preprocess.mjs`     | Rewrites LaTeX that pandoc cannot handle (proof trees, algorithms, listings, TikZ) |
| `lib/postprocess.mjs`    | Numbering, cross-references, citations, code highlighting, math (KaTeX) |
| `lib/talk.mjs`           | Turns a talk (hand-written slide sections) into a page linked to its thesis |
| `lib/slides.mjs`         | Shows a PDF (original slides, the thesis PDF) as a page of images |
| `lib/home.mjs`           | The landing page                                                 |
| `site.json`              | Site name, intro text, custom domain (`cname`)                   |

## Pages

| URL                      | Source                                                          |
|--------------------------|-----------------------------------------------------------------|
| `/`                      | `lib/home.mjs`, `site.json`                                     |
| `/lex-refinement/`       | Master's thesis: `content/msc-thesis`, `entries/lex-refinement/` |
| `/lex-refinement/talk/`  | `entries/lex-refinement/talk.html`                              |
| `/lex/talk/`             | Practical-work talk: `entries/lex/talk.html`                    |
| `/monpoly-logging/`      | Bachelor's thesis: `content/bsc-thesis`, `entries/monpoly-logging/` |
| `/monpoly-logging/talk/` | `entries/monpoly-logging/talk.html`                             |

Each talk also gets `slides/` (its original deck as images) and each thesis
with a `thesisPdf` gets `pdf/`.

## Where a fix goes

- **The thesis text itself** (a typo, a wrong formula, a citation that has since
  been published): commit it to the thesis repo's `errata` branch. Its `main`
  stays the submitted version. Then move the submodule here to that commit:
  `git -C content/<name> fetch && git -C content/<name> checkout origin/errata && git add content/<name>`.
- **Web-only additions** (talks, redrawn figures, illustrations, inserts):
  in the page's folder under `entries/`.

## entry.json

A thesis entry names its submodule (`source`), the root `.tex` file (`main`),
the bibliography, the macro files KaTeX should know (`macroFiles`), and the
output `path`. Optional parts: `theorems` (how the thesis declares them, which
decides the numbering), `textMacros`, `katexMacros`, `meta` (title-page facts
LaTeX does not expose), `tikzFigures` and `imageReplacements` (SVG redrawings
in `figures/`), `imageClasses`, `inserts` (web-only HTML placed `after` or
`before` an element id), `bibliographyOrder`, `referenceLinks`, `heroVisual`,
`scripts`, `public` (files served next to the page), `home` (the card on the
home page) and `talks`.

The build warns about any formula, reference or citation it could not convert.

## Publishing

If a thesis repo is private, the deploy needs a token to clone it: a
fine-grained personal access token with read-only *Contents* access to that
repo, saved as the Actions secret `SUBMODULE_TOKEN` in this repo.

Every push to `main` builds the site and publishes it to GitHub Pages
(`.github/workflows/deploy.yml`). For a custom domain, set `cname` in
`site.json` and point the domain's DNS at GitHub Pages.
