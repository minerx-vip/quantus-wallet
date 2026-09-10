import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve('dist/pages');
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
};
createServer(async (req, res) => {
  try {
    let relative = new URL(req.url, 'http://localhost').pathname.replace(
      /^\/quantus-wallet\/?/,
      '',
    );
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = resolve(root, relative.replace(/^\/+/, ''));
    if (!file.startsWith(root + sep)) throw Error('Invalid path');
    const bytes = await readFile(file);
    res
      .writeHead(200, {
        'Content-Type': mime[extname(file)] || 'application/octet-stream',
      })
      .end(bytes);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(4173, '127.0.0.1');
