// Bundle the prototype's markdown renderer (same mdast engine as the native
// chat) into a browser-importable ESM file, mirroring scripts/build-ui.mjs.
// Refresh: node scripts/build-prototype.mjs
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const output = await build({
  entryPoints: [fileURLToPath(new URL('../ui/prototype/markdown.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', minify: true, target: ['es2022'],
});
await mkdir(fileURLToPath(new URL('../ui/prototype/', import.meta.url)), { recursive: true });
await writeFile(
  fileURLToPath(new URL('../ui/prototype/markdown.bundle.mjs', import.meta.url)),
  output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'),
);
console.log('markdown.bundle.mjs written.');
