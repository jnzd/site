// Serves dist/ with the COOP/COEP headers a host like Cloudflare Pages would
// send (the service worker is then a no-op). Usage: node serve.mjs [port]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root = path.join(path.dirname(new URL(import.meta.url).pathname), 'dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm' };
const port = +(process.argv[2] || 8123);
createServer(async (req, res) => {
  let p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  try { if ((await stat(p)).isDirectory()) p = path.join(p, 'index.html');
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(port, () => console.log(`http://localhost:${port}/`));
