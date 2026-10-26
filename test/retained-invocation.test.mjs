import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Bridge} from '../src/bridge.mjs';
import {TaskRouter} from '../src/task-router.mjs';
import {registerNativeTaskUi,bridgeTaskResolver} from '../src/native-task-ui.mjs';

test('reopening a retained invocation keeps its range AND the live runtime, not a revoked disk snapshot',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-retained-invocation-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const id=randomUUID(),first=randomUUID(),second=randomUUID(),resultPath=join(root,'turn-1.txt');
  await writeFile(resultPath,'first answer');
  const record={agent_id:id,session_id:id,role:'sub',webEmbed:true,persisted:true,returnChars:4000,
    status:'completed',turn:2,currentCallId:second,nativeUrl:null,runtimeGeneration:1,
    observations:{[first]:{call_id:first,turn:1,start_seq:4,end_seq:17,frozen:true,status:'completed',resultPath},
      [second]:{call_id:second,turn:2,start_seq:19,end_seq:26,frozen:true,status:'completed'}},progress:{}};
  const live=structuredClone(record);live.nativeUrl='http://127.0.0.1:19991/?token=private';live.runtimeGeneration=2;
  const native={live:new Map([[id,{record:live,runtime:{}}]]),read:async()=>structuredClone(record),summary:Bridge.prototype.summary};
  const router=new TaskRouter(native,{has:async()=>false});
  const handlers=new Map();
  const ui=registerNativeTaskUi({registerResource(){},registerTool(name,_schema,fn){handlers.set(name,fn);}},
    {resolveTask:(...args)=>router.resolveTask(...args),listTasks:async()=>[],peerFactory:()=>({shell:async()=>'',close(){}})});
  t.after(()=>ui.close());
  const response=await handlers.get('native_bootstrap')({agent_id:id,call_id:first});
  assert.equal(response.isError,undefined,response.content[0].text);
  const task=response._meta.payload.task;
  assert.equal(task.nativeViewAvailable,true);
  assert.equal(task.runtimeGeneration,2);
  assert.equal(task.observation.call_id,first);
  assert.deepEqual([task.observation.start_seq,task.observation.end_seq],[4,17]);
  assert.equal(task.final,'first answer');
  assert.doesNotMatch(JSON.stringify(response),/token=private/);
});

test('bootstrap waits for an already-starting cold history runtime URL without prompting or starting twice',async()=>{
  const id=randomUUID();let starts=0;
  const record={agent_id:id,status:'completed',webEmbed:true,persisted:true,nativeUrl:null,runtimeGeneration:2};
  const ready=Promise.withResolvers(),entry={record,runtime:{},busy:false};
  entry.urlWait=ready.promise.then(()=>{record.nativeUrl='http://127.0.0.1:19992/';});
  const bridge={live:new Map([[id,entry]]),read:async()=>record,summary:r=>({...r}),openView:async()=>{starts++;}};
  const resolve=bridgeTaskResolver(bridge);let returned=false;
  const pending=resolve(id,true).then(value=>{returned=true;return value;});
  await new Promise(done=>setImmediate(done));
  assert.equal(returned,false,'completed execution does not mean its new view URL is ready');
  ready.resolve();
  assert.equal((await pending).nativeUrl,'http://127.0.0.1:19992/');
  assert.equal(starts,0,'reuse the existing history startup, never send a prompt');
});
