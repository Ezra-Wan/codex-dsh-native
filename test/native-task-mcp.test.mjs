import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
    assert.equal(uri,'ui://dsh-native/task-v8.html');
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
