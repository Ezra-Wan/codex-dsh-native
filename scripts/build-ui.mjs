import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const output = await build({ entryPoints: [fileURLToPath(new URL('../ui/observer.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', minify: true, target: ['es2022'] });
const template = await readFile(new URL('../ui/observer.html', import.meta.url), 'utf8');
// The card rides the same upstream token sheet the prototype extracted, so
// its chrome matches the official design language.
const theme = await readFile(new URL('../ui/prototype/theme.css', import.meta.url), 'utf8');
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/observer.html', import.meta.url),
  template
    .replace('__THEME__', () => theme)
    .replace('__APP_CODE__', () => output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
console.log('Built observer container card (official-UI embed + fallback).');
