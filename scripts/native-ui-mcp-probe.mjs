// Experimental original DSH frontend, with only its carrier replaced by MCP.
// No public/local-network browser requests, no imitation conversation renderer.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile, writeFile, mkdir, symlink, cp, rm } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { build, transform } from 'esbuild';
import { z } from 'zod';
import { createRuntime, writeWebEmbedPatch } from '../src/runtime.mjs';
import { nativeUiResource } from '../src/native-ui-resource.mjs';

const root = process.env.DSH_MCP_UI_PROBE_ROOT;
const profiles = process.env.DSH_MCP_UI_PROBE_PROFILES;
const port = Number(process.env.DSH_MCP_UI_PROBE_PORT ?? 19051);
if (!root || !profiles || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Isolated root/profiles and valid port required');
delete process.env.DEEPSEEK_API_KEY;
delete process.env.OPENAI_API_KEY;
const require = createRequire(import.meta.resolve('@deepseek-ai/dsh-api-gateway'));
const { WebSocket } = require('ws');
const project = fileURLToPath(new URL('../', import.meta.url));
const origin = `http://127.0.0.1:${port}`;
const uri = 'ui://dsh-native-mcp-probe/v4.html';
const facts = {modelCalls:0, frontendVersion:'0.2.1-rc.2', browserLocalNetwork:false, visualAcceptance:'pending', calls:[], uiSignals:[]};
let began=Date.now();
const timed=phase=>{(facts.timingMs??={})[phase]=Date.now()-began;};
const save = () => writeFile(join(root,'report.json'),JSON.stringify(facts,null,2)+'\n');
let runtime, starting, html, browserCookie, apiCookie, mux, muxStarting, launchUrl;
const streams = new Map();
const readonly = new Set(['session/list','session/page','session/follow','session/control','session/projections',
  'session/modelCatalog','session/canOpenWorkspacePath','session/workspacePathApplications','session/search',
  'workspace/follow','workspace/initializeDefault','skills/list','$events','$events/result']);
for(const endpoint of ['settings/describe','settings/snapshot','agentPresets/list','dynamicCordisRunner/inventory','schedule/catalog','schedule/list'])readonly.add(endpoint);
function assertRead(endpoint) {
  if (!readonly.has(endpoint)) {note('refused',endpoint);throw new Error(`Zero-model probe refuses endpoint: ${endpoint}`);}
}
function note(kind, endpoint) {
  facts.calls.push({kind,endpoint,at:new Date().toISOString()});
  facts.calls = facts.calls.slice(-100);
  void save().catch(()=>{});
}
const script = code => `<script>${code.replace(/<\/script/gi,'<\\/script')}</script>`;
async function asset(path) {
  const url = new URL(path,origin+'/');
  if (url.origin!==origin || !(/^\/plugins\/\?\?/.test(url.pathname+url.search) || /^\/assets\/[A-Za-z0-9_./-]+$/.test(url.pathname))) throw new Error('Asset outside official bundle routes');
  const response=await fetch(url,{signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error(`Official asset ${response.status}: ${url.pathname}`);
  return response.text();
}
async function start() {
  if(html)return;
  if(starting)return starting;
  starting=(async()=>{
    began=Date.now();
    await mkdir(root,{recursive:true});
    const home=join(root,'dsh-home');
    await mkdir(home,{recursive:true});
    await mkdir(join(root,'workspace'),{recursive:true});
    try{await symlink(resolve(profiles),join(home,'profiles'),'junction');}catch(error){if(error.code!=='EEXIST')throw error;}
    await cp(new URL('../test/fixtures/sessions/',import.meta.url),join(home,'sessions'),{recursive:true});
    const urlFile=join(root,'native-url.json');
    await rm(urlFile,{force:true});
    const patch=await writeWebEmbedPatch(root,{port,urlFile});
    runtime=createRuntime({cwd:join(root,'workspace'),provider:'deepseek-official',model:'deepseek-v4-flash',maxTokens:1024,permission:'read-only',effort:'off'},
      {home,profile:'sdk-web',patches:[patch]});
    await runtime.start();
    timed('runtimeReady');
    let nativeUrl;
    for(let i=0;i<100;i++){
      const value=await readFile(urlFile,'utf8').then(JSON.parse).catch(()=>null);
      if(value?.url){nativeUrl=value.url;break;}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!nativeUrl||new URL(nativeUrl).origin!==origin)throw new Error('Missing official backend URL');
    launchUrl=nativeUrl;
    const auth=await fetch(nativeUrl,{redirect:'manual'});
    browserCookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const connect=new URL('/connect',nativeUrl);connect.search=new URL(nativeUrl).search;connect.searchParams.set('interactions','answer');
    const apiAuth=await fetch(connect,{redirect:'manual'});
    apiCookie=apiAuth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    const page=await fetch(origin,{headers:{Cookie:browserCookie}});
    if(!page.ok)throw new Error('Official shell status '+page.status);
    const original=await page.text();
    timed('shellFetched');
    const scripts=[...original.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    const entry=scripts.find(m=>/type="module"/.test(m[1]));
    const entryPath=/src="([^"]+)"/.exec(entry?.[1]??'')?.[1];
    if(!entryPath)throw new Error('Official frontend entry not found');
    const frontendDir=join(dirname(fileURLToPath(import.meta.resolve('@deepseek-ai/dsh-web-frontend/package.json'))),'dist');
    const built=await build({entryPoints:[join(frontendDir,entryPath)],bundle:true,write:false,format:'esm',platform:'browser',minify:true,logLevel:'silent'});
    const adapter=await build({entryPoints:[join(project,'ui/native-mcp-transport.mjs')],bundle:true,write:false,format:'esm',platform:'browser',minify:true,logLevel:'silent'});
    let injected='';
    for(const match of scripts){
      if(/type="module"/.test(match[1]))continue;
      const src=/src="([^"]+)"/.exec(match[1])?.[1];
      const code=src?await asset(src.replaceAll('&amp;','&')):match[2];
      injected+=script((await transform(code,{minify:true,loader:'js'})).code);
    }
    // Preserve upstream factories, pre-enrolled on its normal loader queue.
    // This avoids sending its initial plugin batches across many MCP calls.
    const preloads=[...original.matchAll(/<link\b[^>]*>/gi)].filter(m=>/as="script"/.test(m[0]));
    const batchUrls=[...new Set(preloads.map(m=>/href="([^"]+)"/.exec(m[0])?.[1]?.replaceAll('&amp;','&')).filter(Boolean))];
    const batches=await Promise.all(batchUrls.map(async path=>(await transform(await asset(path),{minify:true,loader:'js'})).code));
    facts.preloadedPluginBatches=batches.length;
    let css='';
    for(const link of original.matchAll(/<link\b[^>]*>/gi)){
      if(!/rel="stylesheet"/.test(link[0]))continue;
      const href=/href="([^"]+)"/.exec(link[0])?.[1];
      css+=await asset(href);
    }
    html=nativeUiResource({css,injected,adapter:adapter.outputFiles[0].text,frontend:built.outputFiles[0].text,batches});
    if(Buffer.byteLength(JSON.stringify({html}))>8*1024*1024)throw new Error('UI resource exceeds safe stdio message budget');
    facts.resourceBytes=Buffer.byteLength(html);facts.originalShell=true;
    timed('resourceBuilt');
    await save();
  })().catch(async error=>{await runtime?.close().catch(()=>{});runtime=null;throw error;}).finally(()=>{starting=null;});
  return starting;
}
async function ensureMux() {
  if(mux?.readyState===WebSocket.OPEN)return;
  if(muxStarting)return muxStarting;
  muxStarting=(async()=>{
    // A disconnected native operator is retired by DSH. A new generation
    // needs a fresh operator cookie, not the dead generation's cookie.
    if(mux){
      const connect=new URL('/connect',launchUrl);connect.search=new URL(launchUrl).search;connect.searchParams.set('interactions','answer');
      const auth=await fetch(connect,{redirect:'manual'});
      if(auth.status!==302)throw new Error('Native reconnect authentication failed');
      apiCookie=auth.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
    }
    mux=new WebSocket(origin.replace('http:','ws:')+'/api/remote.mux',{headers:{Cookie:apiCookie,Origin:origin},handshakeTimeout:5000});
    mux.on('message',raw=>{
      const frame=JSON.parse(raw.toString()), state=streams.get(frame.streamId);
      if(state){state.queue.push(frame);state.wake?.();}
    });
    const lost=()=>{for(const state of streams.values()){state.closed=true;state.wake?.();}};
    mux.on('close',lost);mux.on('error',lost);
    await once(mux,'open');
  })().finally(()=>{muxStarting=null;});
  return muxStarting;
}
async function openStream(endpoint,payload) {
  assertRead(endpoint);
  // The native auth protocol admits ONE socket per API operator. Logical
  // streams must share that socket, matching the official multiplexer.
  await ensureMux();
  const id=randomUUID();
  streams.set(id,{queue:[],wake:null,closed:false});
  mux.send(JSON.stringify({type:'open',streamId:id,endpoint,payload}));
  note('stream',endpoint);
  return id;
}
async function readStream(id) {
  const state=streams.get(id);if(!state)throw new Error('Unknown stream');
  if(!state.queue.length&&!state.closed)await new Promise(resolve=>{
    const timer=setTimeout(done,1000);
    function done(){clearTimeout(timer);state.wake=null;resolve();}
    state.wake=done;
  });
  return {frames:state.queue.splice(0,100),closed:state.closed};
}
const server=new McpServer({name:'dsh-native-mcp-zero-model',version:'1'}, {instructions:'Zero-model original frontend experiment. Only show_native_mcp_probe once. Keep its card. No model task/start/followup is allowed. Only actual user-visible native UI and history can pass visual acceptance.'});
server.registerResource('native-mcp-probe',uri,{mimeType:'text/html;profile=mcp-app'},async()=>{await start();return {contents:[{uri,mimeType:'text/html;profile=mcp-app',text:html,_meta:{ui:{csp:{frameDomains:[],connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline','fullscreen'],preferredDisplayMode:'inline'}}}]};});
const add=(name,inputSchema,handler)=>server.registerTool(name,{description:'Original frontend carrier, app only. No model turn.',inputSchema,_meta:{ui:{visibility:['app']}}},async args=>{
  const data=await handler(args);return{content:[{type:'text',text:'forwarded'}],_meta:{payload:data}};
});
server.registerTool('show_native_mcp_probe',{title:'DSH 原版界面 · MCP 零模型验证',description:'Display original DSH frontend and sanitized history. No model prompt.',inputSchema:{},annotations:{readOnlyHint:true},_meta:{ui:{resourceUri:uri}}},async()=>{await start();return {content:[{type:'text',text:JSON.stringify(facts)}],structuredContent:facts};});
add('native_asset',{path:z.string().max(20000)},async({path})=>({code:await asset(path)}));
add('native_rpc',{channel:z.literal('/api'),endpoint:z.string().max(120),payload:z.unknown()},async({endpoint,payload})=>{
  assertRead(endpoint);note('rpc',endpoint);
  await ensureMux();
  const rpcId=randomUUID();const response=await fetch(`${origin}/api/${endpoint}`,{method:'POST',headers:{Cookie:apiCookie,'content-type':'application/json',Origin:origin},body:JSON.stringify({type:'client-request',rpcId,method:endpoint,payload}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('Native RPC HTTP '+response.status);
  return (await response.json()).result;
});
add('native_stream_open',{endpoint:z.string().max(120),payload:z.unknown()},async({endpoint,payload})=>({id:await openStream(endpoint,payload)}));
add('native_stream_read',{id:z.string().uuid()},async({id})=>readStream(id));
add('native_stream_send',{id:z.string().uuid(),type:z.enum(['item','end']),value:z.unknown().optional()},async({id,type,value})=>{
  if(!streams.has(id)||mux?.readyState!==WebSocket.OPEN)throw new Error('Inactive stream');
  mux.send(JSON.stringify({type,streamId:id,...(value===undefined?{}:{value})}));return{sent:true};
});
add('native_stream_close',{id:z.string().uuid()},async({id})=>{if(mux?.readyState===WebSocket.OPEN)mux.send(JSON.stringify({type:'cancel',streamId:id}));streams.get(id)?.wake?.();streams.delete(id);return{closed:true};});
add('native_ui_signal',{event:z.string().max(100),detail:z.string().max(1000)},async args=>{facts.uiSignals.push({...args,at:new Date().toISOString()});facts.uiSignals=facts.uiSignals.slice(-40);timed(args.event);await save();return{recorded:true};});
let closing=false;
async function close(){if(closing)return;closing=true;mux?.terminate();await starting?.catch(()=>{});await runtime?.close();await server.close();}
process.stdin.once('end',()=>{void close();});process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
await server.connect(new StdioServerTransport());
