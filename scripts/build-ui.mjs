import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildNativeVendor } from './build-native-vendor.mjs';
import { packNativeCode } from '../src/native-ui-resource.mjs';
import { splitNativeFonts } from '../ui/native-fonts.mjs';
await buildNativeVendor();
const output = await build({ entryPoints: [fileURLToPath(new URL('../ui/observer.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', minify: true, target: ['es2022'] });
const template = await readFile(new URL('../ui/observer.html', import.meta.url), 'utf8');
// The card rides the shared upstream token sheet (ui/theme.css), so its
// chrome matches the official design language.
const theme = await readFile(new URL('../ui/theme.css', import.meta.url), 'utf8');
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await writeFile(new URL('../dist/observer.html', import.meta.url),
  template
    .replace('__THEME__', () => theme)
    .replace('__APP_CODE__', () => output.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')));
console.log('Built observer container card (official-UI embed + fallback).');
const native = await build({ entryPoints: [fileURLToPath(new URL('../ui/native-task.mjs', import.meta.url))],
  bundle: true, write: false, format: 'esm', minify: true, target: ['es2022'],
  outfile: fileURLToPath(new URL('../dist/native-task.js', import.meta.url)),
  loader: { '.module.css': 'local-css', '.css': 'css', '.woff2': 'dataurl', '.woff': 'dataurl', '.ttf': 'dataurl' },
  alias: { 'node:module': fileURLToPath(new URL('../vendor/deepseek-worker-tunnel/node-module-stub.ts', import.meta.url)) },
  define: { 'process.versions.node': '"0.0.0"', 'process.execArgv': '[]', 'process.env.CORDIS_SHARED': 'undefined',
    'process.env.DSH_CLIENT_BUILD_PROFILE': '"official"', 'process.env.DSH_CLIENT_TITLE': '"DeepSeek Harness"',
    'process.env.DSH_CLIENT_VERSION': '"0.2.1-rc.2"', 'process.env.DSH_CLIENT_COMMIT_HASH': '"687f282"' },
});
const nativeTemplate = await readFile(new URL('../ui/native-task.html', import.meta.url), 'utf8');
const nativeStyles = splitNativeFonts(native.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
const nativeCode = packNativeCode(native.outputFiles.find(file => file.path.endsWith('.js')).text);
await writeFile(new URL('../dist/native-task.html', import.meta.url), nativeTemplate
  .replace('__NATIVE_CSS__', () => nativeStyles.css)
  .replace('__NATIVE_APP__', () => `globalThis.__DSH_NATIVE_FONTS__=${JSON.stringify(nativeStyles.fonts)};
const bytes=Uint8Array.from(atob('${nativeCode}'),c=>c.charCodeAt(0));
const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const script=document.createElement('script');script.type='module';script.textContent=code;document.head.appendChild(script);`));
console.log('Built original DSH task app (official AppWebEntry + MCP carrier).');
