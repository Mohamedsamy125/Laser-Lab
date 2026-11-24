import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(fileURLToPath(new URL('../dist/', import.meta.url)));
const basePath = (process.env.LASER_LAB_BASE_PATH || '').replace(/\/+$/, '');
if (basePath && (!basePath.startsWith('/') || basePath.includes('..') || /[?#\\]/.test(basePath))) {
  throw new Error('LASER_LAB_BASE_PATH must be a path such as /Laser-Lab');
}
const types = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
}));

function respond(response, code) {
  response.writeHead(code).end();
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return respond(response, 405);
  }

  try {
    let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (basePath) {
      if (pathname === basePath) { response.writeHead(302, { Location: basePath + '/' }).end(); return; }
      if (!pathname.startsWith(basePath + '/')) return respond(response, 404);
      pathname = pathname.slice(basePath.length);
    }
    const candidate = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!candidate.startsWith(root + sep)) return respond(response, 404);
    const file = await realpath(candidate);
    if (!file.startsWith(root + sep)) return respond(response, 404);
    const info = await stat(file);
    if (!info.isFile()) return respond(response, 404);

    response.writeHead(200, {
      'Content-Type': types.get(extname(file).toLowerCase()) ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') return response.end();
    const stream = createReadStream(file);
    stream.on('error', error => response.destroy(error));
    response.on('close', () => stream.destroy());
    stream.pipe(response);
  } catch (error) {
    if (error instanceof URIError || error.code === 'ERR_INVALID_ARG_VALUE') return respond(response, 400);
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return respond(response, 404);
    console.error(error);
    return respond(response, 500);
  }
});

const host = process.env.LASER_LAB_HOST || 'localhost';
server.listen(Number(process.env.PORT || 3000), host, () => {
  console.log(`Laser Lab · http://${host}:${server.address().port}${basePath}/`);
});
