import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWorkerFallback} from '../ui/worker-fallback.mjs';

test('degraded worker evidence view discards a late response after task disposal',async()=>{
  const nodes=new Map(['worker-fallback','worker-state','worker-answer','worker-events'].map(id=>[id,{hidden:true,textContent:''}]));
  const request=Promise.withResolvers(),calls=[];
  const view=mountWorkerFallback({doc:{getElementById:id=>nodes.get(id)},call:async(name,args)=>{calls.push({name,args});return request.promise;},task:{agent_id:'worker-A',status:'running',warnings:['No native stream']}});
  assert.equal(nodes.get('worker-fallback').hidden,false);assert.match(nodes.get('worker-state').textContent,/No native stream/);
  view.update({status:'unknown',worker_agent_id:'remote-A',failure:{kind:'channel_lost',label:'本地控制通道断开，执行状态待核实'}});
  assert.match(nodes.get('worker-state').textContent,/本地控制通道断开/);
  view.update({status:'completed',worker_agent_id:'remote-A',final:'verified result'});
  assert.doesNotMatch(nodes.get('worker-state').textContent,/本地控制通道断开/);
  assert.equal(nodes.get('worker-answer').textContent,'verified result');
  view.dispose();request.resolve({events:[{type:'tool/result',text:'stale-A'}],next_cursor:'opaque-A'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('worker-events').textContent,'');assert.equal(nodes.get('worker-fallback').hidden,true);assert.equal(calls.length,1);
});
