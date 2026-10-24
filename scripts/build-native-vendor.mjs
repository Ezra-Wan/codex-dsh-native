import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildNativeVendor() {
  const root = new URL('../vendor/deepseek-worker-tunnel/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('UPSTREAM.json', root), 'utf8'));
  for (const [name, entry] of Object.entries(manifest.files)) {
    const hash = createHash('sha256').update(await readFile(new URL(name, root))).digest('hex');
    if (hash !== entry.sha256) throw new Error(`Vendored upstream changed without provenance update: ${name}`);
  }
  await build({ entryPoints: [fileURLToPath(new URL('client/client.ts', root))], bundle: true,
    outfile: fileURLToPath(new URL('client.mjs', root)), format: 'esm', platform: 'browser', target: 'es2022',
    banner: { js: '/* DeepSeek WorkerTunnel, MIT (c) 2026 DeepSeek. See LICENSE and UPSTREAM.json beside this file. */' } });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildNativeVendor();
