import { transform } from 'esbuild';
import { packNativeCode } from './native-ui-resource.mjs';

// Keep the actual runtime's injection table, original plugin factories and CSS.
// The page uses the public AppWebEntry package rather than patching a minified
// frontend entry, so its real dispose() owns the complete plugin lifecycle.
export async function nativeTaskBootstrap(peer) {
  const original = await peer.shell();
  const injected = [];
  for (const match of original.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type="module"/.test(match[1])) continue;
    const src = /src="([^"]+)"/.exec(match[1])?.[1];
    const code = src ? await peer.asset(src.replaceAll('&amp;', '&')) : match[2];
    injected.push(packNativeCode((await transform(code, { minify: true, loader: 'js' })).code));
  }
  const links = [...original.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
  const batches = [...new Set(links.filter(s => /as="script"/.test(s)).map(s => /href="([^"]+)"/.exec(s)?.[1]?.replaceAll('&amp;', '&')).filter(Boolean))];
  const loaded = await Promise.all(batches.map(async path => packNativeCode((await transform(await peer.asset(path), { minify: true, loader: 'js' })).code)));
  const css = await Promise.all(links.filter(s => /rel="stylesheet"/.test(s)).map(async s => peer.asset(/href="([^"]+)"/.exec(s)[1])));
  const payload = { injected, batches: loaded, css: css.join('\n') };
  if (Buffer.byteLength(JSON.stringify(payload)) > 7 * 1024 * 1024) throw new Error('Native bootstrap exceeds MCP message budget');
  return payload;
}
