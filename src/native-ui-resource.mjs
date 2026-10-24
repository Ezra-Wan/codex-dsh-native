// Independent minified bundles must keep independent module scopes. Joining
// their text in one module causes duplicate binding SyntaxErrors before boot.
const escapeScript = code => code.replace(/<\/script/gi, '<\\/script');
import { gzipSync } from 'node:zlib';
export const packNativeCode = code => gzipSync(code).toString('base64');
export function nativeUiResource({ css, injected, adapter, frontend, batches=[] }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style>
<script>globalThis.__DSH_MCP_READY__=Promise.withResolvers();globalThis.__DSH_MCP_BATCHES__=${JSON.stringify(batches.map(packNativeCode))};</script>${injected}</head><body>
<div id="dsh-mcp-status" style="font:12px system-ui;padding:4px">正在连接 MCP 通信层（零模型验证）…</div><div id="root"></div>
<script type="module">${escapeScript(adapter)}</script>
<script type="module">await globalThis.__DSH_MCP_READY__.promise;
const bytes=Uint8Array.from(atob('${packNativeCode(frontend)}'),c=>c.charCodeAt(0));
const code=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const entry=document.createElement('script');entry.type='module';entry.textContent=code;document.head.appendChild(entry);
</script>
</body></html>`;
}
