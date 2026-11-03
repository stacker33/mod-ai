// Local preview of the built page: node scripts/serve.js  (http://localhost:3800)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const port = Number(process.env.PORT) || 3800;
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg' };
createServer(async (req, res) => {
  const name = basename(new URL(req.url, 'http://x').pathname) || 'index.html';
  try {
    const body = await readFile(join(SITE, name));
    res.writeHead(200, { 'Content-Type': TYPES[extname(name)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('build the site first: node scripts/site.js'); }
}).listen(port, () => console.log(`http://localhost:${port}`));
