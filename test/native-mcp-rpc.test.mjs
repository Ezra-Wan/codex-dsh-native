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
    error.dshRemoteStreamFailure.kind==='remote'&&error.dshRemoteStreamFailure.code==='session/not-found'
      &&error.dshRemoteStreamFailure.details.sessionId==='fixture');
});

test('abort releases an outstanding native read immediately and a late open acknowledgement is closed', async () => {
  const opened=Promise.withResolvers();
  const closed=[];
  const rpc=createNativeMcpRpc(async(name,args)=>{
    if(name==='native_stream_open')return opened.promise;
    if(name==='native_stream_close'){closed.push(args.id);return{};}
    throw new Error('An aborted stream must not start reading');
  });
  const controller=new AbortController();
  const reading=rpc.open('/api','session/follow',{},controller.signal).next();
  controller.abort(new Error('view switched'));
  await assert.rejects(reading,/view switched/);
  opened.resolve({id:'late-native-id'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(closed,['late-native-id']);
});

test('native socket loss is a carrier failure and cancelling A leaves B active', async () => {
  const readers=new Map(), closes=[];
  const rpc=createNativeMcpRpc(async(name,args)=>{
    if(name==='native_stream_open')return{id:args.endpoint};
    if(name==='native_stream_read'){
      const pending=Promise.withResolvers();readers.set(args.id,pending);return pending.promise;
    }
    if(name==='native_stream_close'){closes.push(args.id);return{};}
    return{};
  });
  const a=new AbortController(), b=new AbortController();
  const sa=rpc.open('/api','lane-a',{},a.signal), sb=rpc.open('/api','lane-b',{},b.signal);
  const ra=sa.next(), rb=sb.next();
  await new Promise(resolve=>setImmediate(resolve));
  a.abort(new Error('cancel A'));
  await assert.rejects(ra,/cancel A/);
  assert.deepEqual(closes,['lane-a']);
  readers.get('lane-b').resolve({frames:[],closed:true});
  await assert.rejects(rb,error=>error.dshRemoteStreamFailure.kind==='carrier');
  readers.get('lane-a').resolve({frames:[],closed:true});
});
