// Explicit opt-in live harness test. Not part of npm test; starts no model.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { createNativeMcpRpc } from '../ui/native-mcp-rpc.mjs';

const root=process.env.DSH_MCP_UI_PROBE_ROOT;
assert.ok(root&&process.env.DSH_MCP_UI_PROBE_PROFILES&&process.env.DSH_MCP_UI_PROBE_PORT,
  'Set an isolated probe root, profile installation and unused port explicitly');
const client=new Client({name:'native-ui-carrier-live-check',version:'1'});
const report={modelCalls:0,visualAcceptance:'not tested by this script'};
const active=[];
try {
  await client.connect(new StdioClientTransport({command:process.execPath,
    args:[fileURLToPath(new URL('./native-ui-mcp-probe.mjs',import.meta.url))],env:{...process.env},stderr:'pipe'}));
  const call=async(name,args={})=>{
    const result=await client.callTool({name,arguments:args},undefined,{timeout:90000});
    if(result.isError)throw new Error(result.content[0].text);
    return result._meta?.payload??result.structuredContent;
  };
  const facts=await call('show_native_mcp_probe');
  assert.equal(facts.modelCalls,0);
  report.startup=facts.timingMs;
  const {tools}=await client.listTools();
  assert.ok(tools.every(t=>!['ds_start','ds_followup'].includes(t.name)));
  const resource=await client.readResource({uri:tools.find(t=>t.name==='show_native_mcp_probe')._meta.ui.resourceUri});
  assert.deepEqual(resource.contents[0]._meta.ui.csp.connectDomains,[]);
  assert.ok(Buffer.byteLength(JSON.stringify(resource))<8*1024*1024,'resource fits the real SDK 10 MiB stdio buffer');
  for(const script of resource.contents[0].text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))await transform(script[1],{loader:'js',logLevel:'silent'});
  const rpc=createNativeMcpRpc(call);
  for(const [endpoint,payload,expected] of [
    ['$events',{args:{}},'ready'],['workspace/follow',{args:{}},'baseline'],['session/control',{args:{}},'baseline'],
    ['session/follow',{args:{request:{address:{kind:'session',sessionId:'bc243aa7-57aa-47b5-b219-c73a6a45c5ed'},assistantStream:true}}},'snapshot'],
  ]) {
    // Generated native Remote handles always pass an uplink, even before a
    // history page is requested. Keep one blocked exactly like that handle.
    const uplink={ [Symbol.asyncIterator](){return this;},next(){return new Promise(()=>{});},return(){return Promise.resolve({done:true});} };
    const stream=rpc.open('/api',endpoint,payload,new AbortController().signal,uplink);
    active.push(stream);
    const first=await stream.next();
    assert.equal(first.value.type,expected,endpoint);
    if(endpoint==='session/follow'){
      assert.ok(first.value.records.length>0);
      assert.ok(JSON.stringify(first.value.records).includes('assistant/message'),'real fixture assistant history crossed the actual MCP carrier');
      report.historyRecords=first.value.records.length;
    }
  }
  report.concurrentNativeStreams=4;
  await active.shift().return();
  const listed=await rpc.call('/api','session/canOpenWorkspacePath',{args:{}},new AbortController().signal);
  assert.equal(listed.ok,true,'canceling one logical stream keeps its shared operator alive: '+JSON.stringify(listed.error));
  const refused=await client.callTool({name:'native_rpc',arguments:{channel:'/api',endpoint:'session/prompt',payload:{}}});
  assert.equal(refused.isError,true);
  report.paidPromptBlocked=true;
  report.passed=true;
} finally {
  for(const stream of active)await stream.return();
  await client.close();
}
await writeFile(join(root,'live-carrier-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
