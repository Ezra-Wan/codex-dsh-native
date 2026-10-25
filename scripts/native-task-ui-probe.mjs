// Explicit second-instance fixture exercise of the SAME production card and
// carrier registration. No paid endpoints, no real provider credentials.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mkdir, cp, symlink, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { zstdDecompressSync, zstdCompressSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { createRuntime, writeWebEmbedPatch } from '../src/runtime.mjs';
import { registerNativeTaskUi, NATIVE_TASK_URI } from '../src/native-task-ui.mjs';
import { NativeWebPeer } from '../src/native-web-peer.mjs';

const root = process.env.DSH_MCP_UI_PROBE_ROOT, profiles = process.env.DSH_MCP_UI_PROBE_PROFILES;
const port = Number(process.env.DSH_MCP_UI_PROBE_PORT ?? 19071);
if (!root || !profiles || !Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Explicit isolated root/profiles and two valid ports required');
delete process.env.DEEPSEEK_API_KEY; delete process.env.OPENAI_API_KEY;
const fixtureId = 'bc243aa7-57aa-47b5-b219-c73a6a45c5ed';
const secondFixtureId = '19c2730d-351e-461d-93b5-f888293eb07c';
const states = new Map(['aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000002'].map((agent_id,index) => [agent_id, {
  task: { agent_id, session_id: index ? secondFixtureId : fixtureId, name: `原生验收 ${index ? 'B' : 'A'}`, role: 'peer', backend: 'native',
    status: 'waiting', runtimeGeneration: 1, nativeUrl: null }, index,
}]));
const facts = { modelCalls: 0, originalFrontend: true, productionCarrier: true, visualAcceptance: 'pending', signals: [] };
const save = async () => { await mkdir(root,{recursive:true}); await writeFile(join(root,'report.json'), JSON.stringify(facts,null,2)+'\n'); };
async function addDistinctFixture(home) {
  const sessions = join(home,'sessions'), workspace = (await readdir(sessions))[0];
  const bytes = await readFile(join(sessions,workspace,fixtureId,'session.v4.jsonl.zstd'));
  const frames = [];
  for (let offset=0;offset<bytes.length;) {
    const decoded=zstdDecompressSync(bytes.subarray(offset),{info:true});
    if(!decoded.engine.bytesWritten)throw new Error('Fixture decoder made no progress');
    offset+=decoded.engine.bytesWritten;
    const lines=decoded.buffer.toString().replaceAll(fixtureId,secondFixtureId).trim().split('\n').map(JSON.parse);
    const mark=value=>{if(!value||typeof value!=='object')return;if(value.type==='text'&&typeof value.text==='string')value.text='【隔离验收 B】'+value.text;for(const child of Object.values(value))mark(child);};
    for(const line of lines)mark(line);
    frames.push(zstdCompressSync(Buffer.from(lines.map(line=>JSON.stringify(line)+'\n').join(''))));
  }
  // Keep A as well: B's UI must select the requested identity from TWO
  // histories with the same cwd, rather than benefiting from a singleton home.
  const target=join(sessions,workspace,secondFixtureId);await mkdir(target,{recursive:true});
  await writeFile(join(target,'session.v4.jsonl.zstd'),Buffer.concat(frames));
}
let closing = false;
async function ensure(state) {
  if (state.task.nativeUrl) return;
  if (state.starting) return state.starting;
  state.starting = (async () => {
    state.task.status = 'starting';
    const began = Date.now(), dir = join(root, `task-${state.index}`), home = join(dir,'dsh-home'), cwd = join(dir,'workspace');
    await mkdir(home,{recursive:true}); await mkdir(cwd,{recursive:true});
    try { await symlink(resolve(profiles),join(home,'profiles'),'junction'); } catch(error) { if(error.code!=='EEXIST')throw error; }
    await cp(new URL('../test/fixtures/sessions/',import.meta.url),join(home,'sessions'),{recursive:true});
    if(state.index)await addDistinctFixture(home);
    const urlFile=join(dir,'native-url.json'); await rm(urlFile,{force:true});
    const patch=await writeWebEmbedPatch(dir,{port:port+state.index,urlFile});
    state.runtime=createRuntime({cwd,provider:'deepseek-official',model:'deepseek-v4-flash',maxTokens:1024,permission:'read-only',effort:'off'}, {home,profile:'sdk-web',patches:[patch]});
    await state.runtime.start();
    for(let i=0;i<150;i++) {
      const value=await readFile(urlFile,'utf8').then(JSON.parse).catch(()=>null);
      if(value?.url){state.task.nativeUrl=value.url;state.task.status='fixture';break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!state.task.nativeUrl)throw new Error('Fixture runtime did not publish its native URL');
    facts[`runtime${state.index}ReadyMs`]=Date.now()-began; await save();
  })().finally(()=>{state.starting=null;});
  return state.starting;
}
const allowed = new Set(['session/list','session/page','session/follow','session/control','session/projections','session/modelCatalog',
  'session/canOpenWorkspacePath','session/workspacePathApplications','session/search','workspace/follow','workspace/initializeDefault',
  'skills/list','$events','$events/result','settings/describe','settings/snapshot','agentPresets/list','dynamicCordisRunner/inventory','schedule/catalog','schedule/list','subagents/list']);
const server=new McpServer({name:'dsh-native-task-fixture',version:'1'},{instructions:'Zero-model original DSH task-card acceptance. Only show_native_task_probe once, then the user checks automatic history selection and A/B switching. No paid model tasks, no external DSH tools. Never claim visual acceptance yourself.'});
const ui=registerNativeTaskUi(server,{
  diagnostics:true,
  listTasks:async()=>[...states.values()].map(state=>state.task),
  resolveTask:async(id,wait)=>{const state=states.get(id);if(!state)throw new Error('Unknown fixture task');if(wait)await ensure(state);return state.task;},
  peerFactory:url=>new NativeWebPeer(url,{allow:endpoint=>allowed.has(endpoint)}),
  onSignal:async args=>{facts.signals.push({...args,at:new Date().toISOString()});facts.signals=facts.signals.slice(-200);await save();},
});
server.registerTool('show_native_task_probe',{title:'DSH 原生任务 · 复用验收',description:'Display the production native card against two isolated read-only fixture runtimes. Zero model calls.',inputSchema:{},_meta:{ui:{resourceUri:NATIVE_TASK_URI}}},async()=>({
  content:[{type:'text',text:'Zero-model native task view; automatic selection and A/B display require user observation.'}],
  structuredContent:{items:[...states.values()].map(({task:{nativeUrl,...task}})=>task)},
}));
async function close(){if(closing)return;closing=true;ui.close();await Promise.all([...states.values()].map(async state=>{await state.starting?.catch(()=>{});await state.runtime?.close().catch(()=>{});}));await server.close();}
process.stdin.once('end',()=>{void close();});process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
await server.connect(new StdioServerTransport());
