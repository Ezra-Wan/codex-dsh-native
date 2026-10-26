import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {TaskRouter} from '../src/task-router.mjs';

test('actual bridge MCP routes worker start, observe, opaque events, review and same-identity followup over real stdio',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-route-')),config=join(root,'config.toml'),remote=join(root,'remote.json');
  await writeFile(config,`[mcp_servers.deepseek_worker]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(fileURLToPath(new URL('./fixtures/worker-mcp.mjs',import.meta.url)))}]\n[mcp_servers.deepseek_worker.env]\nFAKE_WORKER_STATE=${JSON.stringify(remote)}\n`);
  const client=new Client({name:'worker-route-test',version:'1'});
  const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});assert.equal(result.isError,undefined,result.content?.[0]?.text);return result.structuredContent??result._meta?.payload;};
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],env:{...process.env,CODEX_DSH_BRIDGE_HOME:root,CODEX_DSH_UI:'mcp',CODEX_DSH_WORKER_CONFIG:config,DSH_NATIVE_REPLAY:'off'},stderr:'pipe'}));
    await assert.rejects(readFile(remote),/ENOENT/);await call('ds_bridge',{enabled:true});
    const args={task:'offline fixture',cwd:root,backend:'worker',issue_id:'stable-route-test',permission:'read-only'};
    const rejected=await client.callTool({name:'ds_start',arguments:{...args,maxTokens:1024}});assert.equal(rejected.isError,true);await assert.rejects(readFile(remote),/ENOENT/);
    const receipt=await call('ds_start',args);assert.equal(receipt.backend,'worker');assert.ok(receipt.agent_id);
    const first=await call('ds_wait',{agent_id:receipt.agent_id,timeoutMs:5000});assert.equal(first.final,'WORKER_OK');
    const ui=await call('native_state',{agent_id:receipt.agent_id});assert.equal(ui.worker_agent_id,first.worker_agent_id);assert.equal(ui.nativeViewAvailable,false);
    const events=await call('ds_events',{agent_id:receipt.agent_id,after_seq:'opaque:before'});assert.equal(events.next_cursor,'opaque:next');
    const appEvents=await call('native_worker_events',{agent_id:receipt.agent_id,after:'opaque:before'});assert.equal(appEvents.next_cursor,'opaque:next');
    await call('ds_review',{agent_id:receipt.agent_id,verdict:'revise',feedback:'verify revision protocol'});
    await call('ds_followup',{agent_id:receipt.agent_id,task:'revision'});
    const second=await call('ds_wait',{agent_id:receipt.agent_id,timeoutMs:5000});assert.equal(second.final,'FOLLOWUP_OK');assert.equal(second.worker_agent_id,first.worker_agent_id);
    await call('ds_review',{agent_id:receipt.agent_id,verdict:'pass',feedback:'fixture result verified'});
    assert.equal((await call('ds_panel',{agent_id:receipt.agent_id})).items.length,1);assert.equal(JSON.parse(await readFile(remote,'utf8')).starts,1);
  }finally{await client.close();await rm(root,{recursive:true,force:true});}
});

test('cross-backend writer admission rejects an uncertain writer before dispatch but permits read-only work',async()=>{
  const items=[{agent_id:'old',cwd:tmpdir(),permission:'workspace-write',status:'unknown'}];let sent=0;
  const native={config:async()=>({enabled:true}),list:async()=>({items:[]})};
  const worker={has:async()=>false,list:async()=>items,start:async args=>{sent++;return args;}};
  const router=new TaskRouter(native,worker);
  await assert.rejects(router.start({cwd:tmpdir(),backend:'worker',task:'unsafe duplicate'}),/uncertain/);assert.equal(sent,0);
  await router.start({cwd:tmpdir(),backend:'worker',permission:'read-only',task:'inspect only'});assert.equal(sent,1);
});
