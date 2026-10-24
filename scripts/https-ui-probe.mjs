// Isolated, opt-in MCP viewer. No prompt/start/followup endpoint exists here.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile, writeFile, mkdir, symlink, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:https';
import { build } from 'esbuild';
import { z } from 'zod';
import { createRuntime, writeWebEmbedPatch } from '../src/runtime.mjs';

const root = process.env.DSH_HTTPS_PROBE_ROOT;
const profiles = process.env.DSH_HTTPS_PROBE_PROFILES;
const port = Number(process.env.DSH_HTTPS_PROBE_PORT ?? 19041);
if (!root || !profiles || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Explicit isolated probe root, profiles and valid port required.');
}
// This child cannot inherit a paid provider credential. The clean home has no
// provider credential file either. Display tools below never prompt a model.
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;
const origin = `https://127.0.0.1:${port}`;
const uri = `ui://dsh-https-probe/v1-${port}.html`;
const certFile = join(root, 'certificate.pem');
const keyFile = join(root, 'private-key.pem');
const facts = { modelCalls: 0, origin, hostVisualAcceptance: 'pending', uiSignals: [] };
let runtime, nativeUrl, starting;
const save = () => writeFile(join(root, 'report.json'), JSON.stringify(facts, null, 2) + '\n');
function httpsGet(url, ca, cookie) {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, headers: cookie ? { Cookie: cookie } : {}, timeout: 5000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', part => { body += part; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('HTTPS probe timeout')));
    req.on('error', reject);
    req.end();
  });
}
async function start() {
  if (nativeUrl) return;
  if (starting) return starting;
  starting = (async () => {
    const home = join(root, 'dsh-home');
    await mkdir(home, { recursive: true });
    await mkdir(join(root, 'workspace'), { recursive: true });
    try { await symlink(resolve(profiles), join(home, 'profiles'), 'junction'); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    // The versioned, previously sanitized fixture is display history, not a
    // fabricated live answer. Never use a real user's live session directory.
    await cp(new URL('../test/fixtures/sessions/', import.meta.url), join(home, 'sessions'), { recursive: true });
    const urlFile = join(root, 'native-url.json');
    await rm(urlFile, { force: true });
    const patch = await writeWebEmbedPatch(root, { port, urlFile });
    const tlsPatch = join(root, 'tls.yaml');
    await writeFile(tlsPatch, [
      '- id: webserver', '  config:', '    host: 127.0.0.1', `    port: ${port}`,
      '    tls:', `      certFile: ${JSON.stringify(certFile)}`, `      keyFile: ${JSON.stringify(keyFile)}`, '',
    ].join('\n'));
    runtime = createRuntime({ cwd: join(root, 'workspace'), provider: 'deepseek-official',
      model: 'deepseek-v4-flash', maxTokens: 1024, permission: 'read-only', effort: 'off' },
    { home, profile: 'sdk-web', patches: [patch, tlsPatch] });
    await runtime.start();
    facts.sdkHandshake = true;
    for (let n = 0; n < 100; n++) {
      const value = await readFile(urlFile, 'utf8').then(JSON.parse).catch(() => null);
      if (value?.url) { nativeUrl = value.url; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!nativeUrl || new URL(nativeUrl).origin !== origin) throw new Error('Native HTTPS URL missing or wrong origin');
    const ca = await readFile(certFile);
    const auth = await httpsGet(nativeUrl, ca);
    const cookies = auth.headers['set-cookie'] ?? [];
    const page = await httpsGet(origin, ca, cookies.map(value => value.split(';')[0]).join('; '));
    facts.tlsValidatedWithExplicitCA = true;
    facts.authStatus = auth.status;
    facts.pageStatus = page.status;
    facts.pageBytes = Buffer.byteLength(page.body);
    facts.secureCookie = cookies.some(value => /;\s*Secure\b/i.test(value));
    facts.sameSite = cookies.map(value => /SameSite=([^;]+)/i.exec(value)?.[1]).filter(Boolean);
    facts.officialPage = page.body.includes('__DSH_BOOT__');
    await save();
  })().catch(async error => {
    nativeUrl = null;
    await runtime?.close().catch(() => {});
    runtime = null;
    facts.error = String(error.message).replace(/https?:\/\/\S+/g, '[URL]');
    await save();
    throw new Error(facts.error);
  }).finally(() => { starting = null; });
  return starting;
}

// This is a transport container, not a replacement DSH renderer. All DSH
// content, styles, navigation and session rendering come from its official UI.
const appCode = `import { App } from '@modelcontextprotocol/ext-apps';
const app = new App({name:'DSH HTTPS zero-model probe',version:'1'}, {}, {autoResize:false});
const status = document.getElementById('status'), frame = document.getElementById('native');
async function signal(event) { try { await app.callServerTool({name:'probe_ui_signal',arguments:{event,frameDomains:app.getHostCapabilities()?.sandbox?.csp?.frameDomains ?? []}}); } catch {} }
app.ontoolresult = result => { const url=result._meta?.nativeUrl; if(url){frame.src=url;status.textContent='下方为 DSH 原版页面；请确认是否看见原生会话列表/正文。载入事件不等于验收通过。';} };
frame.addEventListener('load',()=>{if(frame.src)void signal('frame-load-not-proof');});
window.addEventListener('securitypolicyviolation',e=>{status.textContent='被宿主策略拦截：'+e.violatedDirective;void signal('csp-block:'+e.violatedDirective);});
await app.connect(); await app.sendSizeChanged({height:600}); await signal('mcp-app-connected');`;
const bundle = await build({ stdin: { contents: appCode, resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'https-probe-ui.mjs' },
  bundle: true, write: false, format: 'esm', minify: true, target: 'es2022' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:600px;overflow:hidden}body{display:flex;flex-direction:column}#status{font:12px system-ui;padding:8px}iframe{border:0;width:100%;flex:1;min-height:0}</style></head><body><div id="status">正在连接零模型 HTTPS 验证。不会发起模型任务。</div><iframe id="native" title="DSH 官方 HTTPS 页面"></iframe><script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
const server = new McpServer({name:'dsh-https-zero-model',version:'1'}, {
  instructions:'Only a zero-model UI transport experiment. Call show_https_probe once and leave the card open. Do not call any other DSH tools. Never claim visual acceptance based on tool output or iframe load; the user must actually see the official DSH UI.',
});
server.registerResource('https-probe', uri, {mimeType:'text/html;profile=mcp-app'}, async () => ({ contents:[{
  uri, mimeType:'text/html;profile=mcp-app', text:html,
  _meta:{ui:{csp:{frameDomains:[origin]}},'openai/ui':{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'inline'}},
}]}));
server.registerTool('show_https_probe', {title:'DSH HTTPS 零模型验证',description:'Show official DSH UI over loopback HTTPS with sanitized existing history. Never starts a model turn.', inputSchema:{},annotations:{readOnlyHint:true},_meta:{ui:{resourceUri:uri}}}, async () => {
  await start();
  return {content:[{type:'text',text:JSON.stringify(facts)}],structuredContent:facts,_meta:{nativeUrl}};
});
server.registerTool('probe_ui_signal', {description:'App-only diagnostics. A frame load is not visual acceptance.',inputSchema:{event:z.string().max(120),frameDomains:z.array(z.string().max(200)).max(20)},_meta:{ui:{visibility:['app']}}}, async args => {
  facts.uiSignals.push({...args,at:new Date().toISOString()});
  facts.uiSignals = facts.uiSignals.slice(-30);
  await save();
  return {content:[{type:'text',text:'recorded'}]};
});
let closing = false;
async function close() { if(closing)return;closing=true;await starting?.catch(()=>{});await runtime?.close();await server.close(); }
process.stdin.once('end',()=>{void close();});
process.once('SIGTERM',()=>{void close();});
process.once('SIGINT',()=>{void close();});
await server.connect(new StdioServerTransport());
