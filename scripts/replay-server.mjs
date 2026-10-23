// Static server for the offline trajectory replay page. Usage: node scripts/replay-server.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../ui/prototype/', import.meta.url));
const port = Number(process.argv[2] ?? 8791);
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.json': 'application/json', '.md': 'text/markdown', '.css': 'text/css; charset=utf-8' };

createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    let path = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!path.startsWith(root)) throw new Error('Path traversal');
    if (path.endsWith(sep)) path += 'trajectory.html';
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream' });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error.message));
  }
}).listen(port, '127.0.0.1', () => console.log(`Replay page: http://127.0.0.1:${port}/`));
