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

for (const f of ['index.html', 'playground.css', 'playground.js'])
  cpSync(path.join(here, 'web', f), path.join(dist, f));
for (const f of ['lexweb.bc.js', 'lexweb.bc.wasm.js', 'lexweb.bc.wasm.assets'])
  if (existsSync(path.join(lexweb, f))) cpSync(path.join(lexweb, f), path.join(dist, f), { recursive: true });
for (const f of ['z3-built.js', 'z3-built.wasm'])
  cpSync(path.join(nm, 'z3-solver/build', f), path.join(dist, 'z3', f));
cpSync(path.join(nm, 'coi-serviceworker/coi-serviceworker.min.js'), path.join(dist, 'coi-serviceworker.js'));
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
console.log('assembled', dist);
