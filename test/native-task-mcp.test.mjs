import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('production MCP switch exposes native carrier on dispatch without starting replay or models', async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-task-ui-'));
  const client=new Client({name:'native-task-discovery',version:'1'});
  try{
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],
      env:{...process.env,CODEX_DSH_BRIDGE_HOME:root,CODEX_DSH_UI:'mcp',DSH_NATIVE_REPLAY:'off'},stderr:'pipe'}));
    const {tools}=await client.listTools();
    const uri=tools.find(tool=>tool.name==='ds_start')._meta.ui.resourceUri;
    assert.equal(uri,'ui://dsh-native/task-v14.html');
    assert.equal(tools.find(tool=>tool.name==='ds_followup')._meta.ui.resourceUri,uri);
    const peerUri=tools.find(tool=>tool.name==='ds_start_peer')._meta.ui.resourceUri;
    assert.notEqual(peerUri,uri);
    for(const name of ['ds_followup_peer','ds_observe_peer','ds_fallback_peer','ds_panel'])assert.equal(tools.find(t=>t.name===name)._meta.ui.resourceUri,peerUri);
    const peerResource=await client.readResource({uri:peerUri});
    assert.deepEqual(peerResource.contents[0]._meta['openai/ui'],{availableDisplayModes:['fullscreen'],preferredDisplayMode:'fullscreen'});
    assert.match(peerResource.contents[0].text,/__DSH_SIDE_ENTRY__=true/);
    assert.deepEqual((await client.readResource({uri})).contents[0]._meta['openai/ui'].availableDisplayModes,['inline','fullscreen']);
    assert.match(client.getInstructions(),/Observe is allowed whenever/);
    assert.doesNotMatch(client.getInstructions(),/Do not emit extra observe|single user-visible entry/);
    for(const name of ['native_bootstrap','native_rpc','native_stream_open','native_stream_send','native_view_close']){
      assert.deepEqual(tools.find(tool=>tool.name===name)._meta.ui.visibility,['app']);
    }
    const resource=await client.readResource({uri});
    assert.deepEqual(resource.contents[0]._meta.ui.csp,{frameDomains:[],connectDomains:[],resourceDomains:[]});
    assert.doesNotMatch(resource.contents[0].text,/<iframe|src=["']https?:/);
    assert.ok(Buffer.byteLength(JSON.stringify(resource))<8*1024*1024);
    const tasks=await client.callTool({name:'native_tasks',arguments:{}});
    assert.deepEqual(tasks._meta.payload.items,[]);
    const refused=await client.callTool({name:'ds_start',arguments:{task:'disabled, must not run',cwd:root}});
    assert.equal(refused.isError,true);
  }finally{await client.close();await rm(root,{recursive:true,force:true});}
});

test('real MCP lists only the host conversation or explicit anchor, never every task when identity is missing', async () => {
  const root=await mkdtemp(join(tmpdir(),'dsh-conversation-scope-'));
  const a=randomUUID(),b=randomUUID();
  await mkdir(join(root,'tasks'));
  for(const [id,owner] of [[a,'chat-A'],[b,'chat-B']])await writeFile(join(root,'tasks',`${id}.json`),JSON.stringify({
    agent_id:id,session_id:id,conversationId:owner,status:'completed',turn:1,role:'peer',mode:'light',returnChars:4000,cwd:root,
  }));
  const client=new Client({name:'scope-discovery',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],
      env:{...process.env,CODEX_DSH_BRIDGE_HOME:root,CODEX_DSH_UI:'mcp',DSH_NATIVE_REPLAY:'off'},stderr:'pipe'}));
    const panel=await client.callTool({name:'ds_panel',arguments:{},_meta:{'openai/session':'chat-A'}});
    assert.deepEqual(panel.structuredContent.items.map(x=>x.agent_id),[a]);
    const anonymous=await client.callTool({name:'native_tasks',arguments:{}});
    assert.deepEqual(anonymous._meta.payload.items,[]);
    const anchored=await client.callTool({name:'native_tasks',arguments:{agent_id:b}});
    assert.deepEqual(anchored._meta.payload.items.map(x=>x.agent_id),[b]);
  } finally {await client.close();await rm(root,{recursive:true,force:true});}
});
