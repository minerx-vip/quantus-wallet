import { cp, mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';

// Vinext exports the base path as a directory; GitHub Pages adds that directory
// itself. Publish its contents at the Pages artifact root.
const base = (process.env.PAGES_BASE_PATH || '').replace(/^\/+|\/+$/g, '');
const input = path.resolve('dist/client');
const output = path.resolve('dist/pages');
await mkdir(output, {recursive:true});
await cp(base ? path.join(input,base) : input, output, {recursive:true});
if (base) {
  try { await access(path.join(output,'index.html')); }
  catch { await cp(path.join(input,base+'.html'),path.join(output,'index.html')); }
  await cp(path.join(input,'404.html'),path.join(output,'404.html'));
}
const html = await readFile(path.join(output,'index.html'),'utf8');
if (!html.includes('安全声明')) throw Error('Missing safety statement in static output');
for (const match of html.matchAll(/(?:src|href)="([^"?#]+)"/g)) {
  const ref = match[1];
  if (!ref.startsWith('/') || ref.startsWith('//')) continue;
  const prefix = base ? `/${base}/` : '/';
  if (!ref.startsWith(prefix)) throw Error(`Wrong Pages asset prefix: ${ref}`);
  await access(path.join(output, ref.slice(prefix.length)));
}
console.log('Verified static Pages artifact: dist/pages');
