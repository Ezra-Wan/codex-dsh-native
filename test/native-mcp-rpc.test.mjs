import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeMcpRpc } from '../ui/native-mcp-rpc.mjs';

test('native journal carrier forwards uplink pages and releases a blocked uplink on cancellation', async () => {
  const calls=[];
  let released=false, first=true;
  const uplink={ [Symbol.asyncIterator](){return this;},
    next(){if(first){first=false;return Promise.resolve({done:false,value:{type:'load-older',beforeSeq:50}});}return new Promise(()=>{});},
    return(){released=true;return new Promise(()=>{});},
  };
  const rpc=createNativeMcpRpc(async(name,args)=>{
    calls.push({name,args});
    if(name==='native_stream_open')return{id:'lane-a'};
    if(name==='native_stream_read'){
      await new Promise(resolve=>setImmediate(resolve));
      return {frames:[{type:'item',value:{type:'snapshot',records:['original history']}}],closed:false};
    }
    return {};
  });
  const stream=rpc.open('/api','session/follow',{args:{}},new AbortController().signal,uplink);
  assert.equal((await stream.next()).value.records[0],'original history');
  assert.deepEqual(calls.find(c=>c.name==='native_stream_send').args,{id:'lane-a',type:'item',value:{type:'load-older',beforeSeq:50}});
  await stream.return();
  assert.equal(released,true);
  assert.deepEqual(calls.at(-1),{name:'native_stream_close',args:{id:'lane-a'}});
});

test('native stream preserves structured remote failures instead of relabeling every error internal', async () => {
  const rpc=createNativeMcpRpc(async name=>name==='native_stream_open'?{id:'lane'}:
    name==='native_stream_read'?{frames:[{type:'error',error:{code:'session/not-found',message:'missing history',details:{sessionId:'fixture'}}}]}:{});
  await assert.rejects(rpc.open('/api','session/follow',{},new AbortController().signal).next(),error=>
    error.code==='session/not-found'&&error.isDSHRemoteError===true&&error.details.sessionId==='fixture');
});
