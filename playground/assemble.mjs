// Puts the playground together in dist/.
// Usage: node assemble.mjs <lexweb build dir> <lex checkout>
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { build } from 'esbuild';
import path from 'node:path';

const [lexweb, lex] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(here, 'dist');
const nm = path.join(here, 'node_modules');
rmSync(dist, { recursive: true, force: true });
mkdirSync(path.join(dist, 'z3'), { recursive: true });

for (const f of ['index.html', 'playground.css', 'playground.js', 'lexdoc'])
  cpSync(path.join(here, 'web', f), path.join(dist, f), { recursive: true });
for (const f of ['lexweb.bc.js', 'lexweb.bc.wasm.js', 'lexweb.bc.wasm.assets'])
  if (existsSync(path.join(lexweb, f))) cpSync(path.join(lexweb, f), path.join(dist, f), { recursive: true });
for (const f of ['z3-built.js', 'z3-built.wasm'])
  cpSync(path.join(nm, 'z3-solver/build', f), path.join(dist, 'z3', f));
cpSync(path.join(nm, 'coi-serviceworker/coi-serviceworker.min.js'), path.join(dist, 'coi-serviceworker.js'));
await build({
  entryPoints: [path.join(here, 'web/editor.src.js')], bundle: true, minify: true, format: 'iife',
  globalName: 'LexEditor', outfile: path.join(dist, 'editor.js'), logLevel: 'warning',
});
// The site's theme: its fonts and colour variables (the top of theme/style.css,
// up to the first rule) and the light/dark toggle.
const theme = path.join(here, '..', 'theme');
const style = readFileSync(path.join(theme, 'style.css'), 'utf8');
writeFileSync(path.join(dist, 'theme.css'), style.slice(0, style.indexOf('\n* {')) + '\n');
cpSync(path.join(theme, 'theme.js'), path.join(dist, 'theme.js'));
mkdirSync(path.join(dist, 'fonts'));
// Bootstrap and jQuery for Lexdoc pages, served locally instead of from a CDN.
mkdirSync(path.join(dist, 'vendor'));
cpSync(path.join(nm, 'bootstrap/dist/css/bootstrap.min.css'), path.join(dist, 'vendor/bootstrap.min.css'));
cpSync(path.join(nm, 'jquery/dist/jquery.min.js'), path.join(dist, 'vendor/jquery.min.js'));
for (const [pkg, files] of [['ibm-plex-sans', ['400-normal', '400-italic', '600-normal', '600-italic']], ['ibm-plex-mono', ['400-normal']]])
  for (const f of files) cpSync(path.join(nm, '@fontsource', pkg, 'files', `${pkg}-latin-${f}.woff2`), path.join(dist, 'fonts', `${pkg}-latin-${f}.woff2`));
await build({
  entryPoints: [path.join(here, 'web/z3-glue.src.js')], bundle: true, minify: true,
  define: { global: 'window' }, outfile: path.join(dist, 'z3-glue.js'), logLevel: 'warning',
});

const read = (rel) => readFileSync(path.join(lex, rel), 'utf8');
writeFileSync(path.join(dist, 'lexdoc-assets.json'), JSON.stringify({
  'assets/lexdoc.css': read('assets/lexdoc.css'),
  'assets/lexdoc.js': read('assets/lexdoc.js'),
}));
writeFileSync(path.join(dist, 'examples.json'), JSON.stringify({
  'Tutorial (GDPR excerpt)': { main: 'tutorial.lex', files: { 'tutorial.lex': read('example/tutorial/tutorial.lex') } },
  'MiniTwit refines the GDPR (uses Z3)': { main: 'gdpr/minitwit_gdpr.rex', files: {
    'gdpr/minitwit_gdpr.rex': read('evaluation/01_formalization/minitwit_gdpr.rex'),
    'gdpr/gdpr.lex': read('evaluation/01_formalization/gdpr.lex'),
    'gdpr/GDPR.xml': read('evaluation/01_formalization/GDPR.xml'),
  } },
}));
// Versioned links (?v=<content hash>) in index.html, so a browser that kept an
// older copy of a script or style sheet fetches the new one.
{
  const { createHash } = await import('node:crypto');
  const page = path.join(dist, 'index.html');
  const html = readFileSync(page, 'utf8').replace(/(src|href)="([\w./-]+\.(?:js|css))"/g, (m, attr, f) => {
    if (!existsSync(path.join(dist, f)) || f.startsWith('coi-')) return m; // the service worker keeps its URL
    const v = createHash('sha256').update(readFileSync(path.join(dist, f))).digest('hex').slice(0, 10);
    return `${attr}="${f}?v=${v}"`;
  });
  writeFileSync(page, html);
}
console.log('assembled', dist);
