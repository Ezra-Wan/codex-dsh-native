import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyFailure} from '../src/failure.mjs';
import {createServer} from 'node:http';
const networkSnapshot=()=>({localInterfaceAvailable:true,internetReachable:null});
test('request loss is not user interruption; local interface evidence never claims Internet connectivity',()=>{
  const cause=Object.assign(Error('socket failed'),{code:'ECONNRESET'}),error=new Error('fetch failed',{cause});
  const result=classifyFailure(error,{networkSnapshot});assert.equal(result.kind,'connection_lost');assert.equal(result.code,'ECONNRESET');assert.equal(result.network.internetReachable,null);
  const offline=classifyFailure(error,{networkSnapshot:()=>({localInterfaceAvailable:false,internetReachable:null})});assert.equal(offline.kind,'network_unavailable');assert.match(offline.label,/疑似/);
  const sandbox=classifyFailure(Error('Win32 error 5'),{networkSnapshot:()=>{throw Error('must not probe unrelated errors');}});assert.equal(sandbox.kind,'unclassified');assert.equal(sandbox.network,null);
});
test('an actual local HTTP connection drop is diagnosed without claiming user interruption or laptop offline',async t=>{
  const server=createServer((request,response)=>{response.writeHead(200,{'Content-Type':'text/plain'});response.write('partial');setImmediate(()=>response.socket?.destroy());});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  let error;try{const response=await fetch(`http://127.0.0.1:${server.address().port}`,{signal:AbortSignal.timeout(3000)});await response.text();}catch(cause){error=cause;}
  assert.ok(error,'real stream must fail');const result=classifyFailure(error,{networkSnapshot});assert.equal(result.kind,'connection_lost');assert.equal(result.code,'UND_ERR_SOCKET');assert.equal(result.network.internetReachable,null);
});
test('DNS, timeout and provider errors remain distinct; abort without a stop request is not caller stop',()=>{
  for(const[code,kind]of [['ENOTFOUND','dns_error'],['EAI_AGAIN','dns_error'],['ETIMEDOUT','request_timeout'],['ENETUNREACH','network_unreachable']])assert.equal(classifyFailure(Object.assign(Error('failed'),{code}),{networkSnapshot}).kind,kind);
  assert.equal(classifyFailure({status:429,message:'rate limit'}).kind,'rate_limited');
  assert.equal(classifyFailure({statusCode:503,message:'not laptop offline'}).kind,'provider_error');
  assert.equal(classifyFailure(null,{finishReason:'aborted'}).kind,'runtime_interrupted');
  assert.equal(classifyFailure(null,{stopSource:'caller'}).kind,'requested_stop');
  assert.equal(classifyFailure(null,{stopSource:'controller_shutdown'}).kind,'controller_shutdown');
  assert.equal(classifyFailure(Error('Connection closed'),{stage:'native_transport'}).kind,'channel_lost');
});
