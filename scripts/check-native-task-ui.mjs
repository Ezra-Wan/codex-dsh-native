// Explicit live native runtime check. No provider prompt, no browser, no model.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNativeMcpRpc } from '../ui/native-mcp-rpc.mjs';
const root=process.env.DSH_MCP_UI_PROBE_ROOT;
assert.ok(root&&process.env.DSH_MCP_UI_PROBE_PROFILES&&process.env.DSH_MCP_UI_PROBE_PORT,'Explicit isolated root, profiles and ports required');
const client=new Client({name:'native-task-live-check',version:'1'});
const report={modelCalls:0,visualAcceptance:'not tested'}, views=[], streams=[];
try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./native-task-ui-probe.mjs',import.meta.url))],env:{...process.env},stderr:'pipe'}));
  const raw=async(name,args={})=>{const result=await client.callTool({name,arguments:args},undefined,{timeout:90000});if(result.isError)throw new Error(result.content[0].text);return result._meta?.payload??result.structuredContent;};
  const {items}=await raw('show_native_task_probe');
  for(const task of items){
    const data=await raw('native_bootstrap',{agent_id:task.agent_id});views.push(data.viewId);
    assert.equal(data.task.session_id,task.session_id);assert.equal('nativeUrl' in data.task,false);
    const rpc=createNativeMcpRpc((name,args)=>raw(name,{...args,viewId:data.viewId}));
    const stream=rpc.open('/api','session/follow',{args:{request:{address:{kind:'session',sessionId:task.session_id},assistantStream:true}}},new AbortController().signal,{
      [Symbol.asyncIterator](){return this;},next(){return new Promise(()=>{});},return(){return Promise.resolve({done:true});},
    });
    streams.push(stream);
    const first=await stream.next();assert.equal(first.value.type,'snapshot');assert.ok(first.value.records.length>0);
    if(task.name.endsWith('B'))assert.match(JSON.stringify(first.value.records),/隔离验收 B/,'B is a distinct existing session in a home containing A too');
    report[task.agent_id]={records:first.value.records.length,bootstrapBytes:Buffer.byteLength(JSON.stringify(data.bootstrap))};
    await assert.rejects(raw('native_rpc',{viewId:data.viewId,channel:'/api',endpoint:'session/prompt',payload:{}}),/refuses endpoint/);
  }
  await streams.shift().return();
  const result=await raw('native_rpc',{viewId:views[1],channel:'/api',endpoint:'session/canOpenWorkspacePath',payload:{args:{}}});
  assert.equal(result.ok,true,'closing A must not break B');
  const closedView=views.shift();
  await raw('native_view_close',{viewId:closedView});
  await assert.rejects(raw('native_rpc',{viewId:closedView,channel:'/api',endpoint:'session/canOpenWorkspacePath',payload:{args:{}}}),/expired/);
  report.passed=true;
}finally{for(const stream of streams)await stream.return();for(const viewId of views)await client.callTool({name:'native_view_close',arguments:{viewId}}).catch(()=>{});await client.close();}
await writeFile(join(root,'live-check.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
