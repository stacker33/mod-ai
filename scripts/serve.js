// Local preview of the built page: node scripts/serve.js  (http://localhost:3800)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const port = Number(process.env.PORT) || 3800;
createServer(async (req, res) => {
  try { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(await readFile(join(SITE, 'index.html'))); } catch { res.writeHead(404); res.end('build the site first: node scripts/site.js'); }
}).listen(port, () => console.log(`http://localhost:${port}`));
