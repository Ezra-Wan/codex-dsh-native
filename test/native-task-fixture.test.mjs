import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createNativeTaskController } from '../ui/native-task-controller.mjs';

test('real zero-model fixture state lets either uninitialized history reach the production bootstrap path', async () => {
  const root=await mkdtemp(join(tmpdir(),'dsh-lazy-fixture-'));
  const client=new Client({name:'lazy-fixture-contract',version:'1'});
  const calls=[],mounted=[];
  const controller=createNativeTaskController({
    // The carrier boundary is stubbed here: this test must not start a Web
    // service. The initial state below comes from the actual fixture server.
    call:async(name,args)=>{calls.push({name,args});return{viewId:args.agent_id,task:{runtimeGeneration:1}};},
    mount:async data=>{mounted.push(data.viewId);return{dispose:async()=>{}};},
  });
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:[fileURLToPath(new URL('../scripts/native-task-ui-probe.mjs',import.meta.url))],
      env:{...process.env,DEEPSEEK_API_KEY:'',OPENAI_API_KEY:'',DSH_MCP_UI_PROBE_ROOT:root,
        DSH_MCP_UI_PROBE_PROFILES:join(root,'not-installed-and-not-used'),DSH_MCP_UI_PROBE_PORT:'19171'},stderr:'pipe'}));
    const shown=await client.callTool({name:'show_native_task_probe',arguments:{}});
    assert.equal(shown.isError,undefined);
    for(const task of shown.structuredContent.items){
      const result=await client.callTool({name:'native_state',arguments:{agent_id:task.agent_id}});
      const state=result._meta.payload;
      assert.equal(state.nativeViewAvailable,false);
      assert.equal(state.nativeViewRestorable,true);
      assert.equal(state.observation.call_id,task.agent_id);
      await controller.select(state);
    }
    assert.deepEqual(mounted,shown.structuredContent.items.map(t=>t.agent_id));
    assert.equal(calls.filter(c=>c.name==='native_bootstrap').length,2);
  } finally {await controller.dispose();await client.close();await rm(root,{recursive:true,force:true});}
});
