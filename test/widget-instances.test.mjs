import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('real MCP keeps separate view instance identities for old and new calls over the same resource and native session',async()=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-widget-instance-')),id=randomUUID(),first=randomUUID(),second=randomUUID();
  const client=new Client({name:'widget-instance-acceptance',version:'1'});
  try{
    await mkdir(join(root,'tasks'));
    const resultPath=join(root,'first.txt');await writeFile(resultPath,'first');
    await writeFile(join(root,'tasks',`${id}.json`),JSON.stringify({agent_id:id,session_id:id,role:'sub',backend:'native',
      status:'completed',turn:2,currentCallId:second,returnChars:4000,final:'second',progress:{},
      observations:{[first]:{call_id:first,turn:1,status:'completed',frozen:true,start_seq:4,end_seq:17,resultPath},
        [second]:{call_id:second,turn:2,status:'completed',frozen:true,start_seq:19,end_seq:26}}}));
    await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/server.mjs',import.meta.url))],
      env:{...process.env,CODEX_DSH_BRIDGE_HOME:root,CODEX_DSH_UI:'mcp',DSH_NATIVE_REPLAY:'off'},stderr:'pipe'}));
    const replies=[];
    for(const call_id of [first,second,first]){
      const response=await client.callTool({name:'ds_observe',arguments:{agent_id:id,call_id}});
      assert.equal(response.isError,undefined,response.content[0].text);
      assert.equal(response.structuredContent.session_id,id);
      assert.equal(response.structuredContent.observation.call_id,call_id);
      const view=response._meta?.['openai/widgetSessionId'];
      assert.match(view??'',/^[0-9a-f-]{36}$/,'current Codex requires a distinct widget instance to retain each entry');
      assert.equal(response.structuredContent.widgetSessionId,undefined,'presentation identity never changes the native session or model-visible data');
      replies.push(view);
    }
    assert.equal(new Set(replies).size,3,'reopening a call creates another view of the same log, not a globally superseding widget');
    const status=await client.callTool({name:'ds_bridge',arguments:{}});
    assert.equal(status._meta?.['openai/widgetSessionId'],undefined,'non-UI tools do not create widgets');
    assert.equal(replies.length,3);
  }finally{await client.close();await rm(root,{recursive:true,force:true});}
});
