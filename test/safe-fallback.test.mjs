import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../src/bridge.mjs';
import {WorkerTasks} from '../src/worker-tasks.mjs';
import {TaskRouter} from '../src/task-router.mjs';

async function setup(t){
  const root=await mkdtemp(join(tmpdir(),'safe-dsh-fallback-'));let closed=false,sent=0,closeFails=false;
  const native=await new Bridge({root,runtimeFactory:()=>({start:async()=>{},session:()=>({getWorkingDirectory:async()=>root}),
    run:async()=>({finalResponse:'',events:[{type:'turn/end',data:{reason:{kind:'error',error:{message:'native fixture failed'}}}}]}),
    close:async()=>{if(closeFails)throw Error('cannot confirm shutdown');closed=true;},
  })}).init();await native.setEnabled(true);
  const worker=await new WorkerTasks({root,enabled:async()=>true,worker:{startArguments:async()=>{},start:async()=>{assert.equal(closed,true,'native shutdown must finish before worker mutation');sent++;return{agent_id:'real-worker-id'};},wait:async()=>({wait_outcome:'settled',status:'completed',answer:'FALLBACK_OK'}),close:async()=>{}}}).init();
  const router=new TaskRouter(native,worker);
  t.after(async()=>{closeFails=false;await router.close();await rm(root,{recursive:true,force:true});});
  const receipt=await router.start({task:'fixture failure',cwd:root,webEmbed:false});
  await native.live.get(receipt.agent_id).done;
  return{root,native,worker,router,id:receipt.agent_id,count:()=>sent,failClose:()=>{closeFails=true;}};
}

test('confirmed native failure is shut down before handoff; repeated fallback reuses one worker and retires native followup',async t=>{
  const {router,native,id,count}=await setup(t);
  const args={agent_id:id,task:'remaining work only',issue_id:'same-issue'};
  const first=await router.fallback(args);const done=await router.wait(first.agent_id,1000);
  assert.equal(done.final,'FALLBACK_OK');assert.equal(done.source_agent_id,id);assert.equal(native.live.has(id),false);
  assert.equal((await router.fallback(args)).agent_id,first.agent_id);assert.equal(count(),1);
  await assert.rejects(router.followup(id,'race original against fallback'),/retired/);
  assert.equal((await native.status(id)).fallbackAgentId,first.agent_id);
});

test('uncertain native runtime shutdown refuses worker dispatch, including after bridge state is cold',async t=>{
  const {router,native,id,count,failClose}=await setup(t);failClose();
  await assert.rejects(router.fallback({agent_id:id,task:'remaining',issue_id:'same'}),/shutdown/);assert.equal(count(),0);
  const other=await new Bridge({root:native.root}).init();
  await assert.rejects(other.prepareFallback(id),/proof/);assert.equal(count(),0);
});

test('active, unknown, completed and user-interrupted states cannot trigger fallback, nor can unsupported budgets retire source',async t=>{
  const {router,native,worker,id,count}=await setup(t);const record=native.live.get(id).record;
  for(const status of ['running','unknown','completed','interrupted']){
    record.status=status;
    await assert.rejects(router.fallback({agent_id:id,task:'remaining',issue_id:'same'}),/failed/);
  }
  record.status='failed';worker.worker.startArguments=async()=>{throw Error('maxTokens unsupported');};
  await assert.rejects(router.fallback({agent_id:id,task:'remaining',issue_id:'same',maxTokens:1024}),/unsupported/);
  assert.equal(record.fallbackReserved,undefined);assert.equal(count(),0);
});

test('a normal protocol end with rejected actual artifacts can be handed off with an explicit recorded reason',async t=>{
  const {router,native,id}=await setup(t);native.live.get(id).record.status='completed';await native.save(native.live.get(id).record);
  const receipt=await router.fallback({agent_id:id,task:'Produce missing artifact',issue_id:'same',rejectionReason:'Parent checked result.txt: missing; the assistant reported unavailable file tools.'});
  assert.equal((await router.wait(receipt.agent_id,1000)).final,'FALLBACK_OK');
  assert.match((await native.read(id)).fallbackReason,/missing/);
});
