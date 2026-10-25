import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkerTasks} from '../src/worker-tasks.mjs';
import {WorkerMcpClient} from '../src/worker-client.mjs';

async function setup(t,{extra='',worker}={}){
  const root=await mkdtemp(join(tmpdir(),'native-worker-tasks-')),configPath=join(root,'config.toml'),state=join(root,'remote.json');
  await writeFile(configPath,`[mcp_servers.deepseek_worker]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(fileURLToPath(new URL('./fixtures/worker-mcp.mjs',import.meta.url)))}]\n[mcp_servers.deepseek_worker.env]\nFAKE_WORKER_STATE=${JSON.stringify(state)}\n${extra}`);
  const tasks=await new WorkerTasks({root,worker:worker??new WorkerMcpClient({configPath}),enabled:async()=>true}).init();
  t.after(async()=>{await tasks.close();await rm(root,{recursive:true,force:true});});
  return{root,state,configPath,tasks,args:{cwd:root,task:'fixture only',issue_id:'stable-test-issue',permission:'read-only'}};
}

test('worker wrapper completes, persists full answer, and cold continuation retains identity and real review contract',async t=>{
  const {tasks,args,root,configPath}=await setup(t);
  await assert.rejects(tasks.start({...args,maxTokens:1024}),/maxTokens/);
  const receipt=await tasks.start(args),first=await tasks.wait(receipt.agent_id,5000);
  assert.equal(first.status,'completed');assert.equal(first.final,'WORKER_OK');assert.notEqual(first.agent_id,first.worker_agent_id);
  assert.equal(await readFile(first.resultPath,'utf8'),'WORKER_OK');assert.equal(first.maxTokens,null);
  assert.equal((await tasks.events(first.agent_id,'opaque:previous')).next_cursor,'opaque:next');
  await assert.rejects(tasks.followup(first.agent_id,'revision'),/Review/);
  await tasks.review(first.agent_id,'revise','fixture rejection');await tasks.close();
  const cold=await new WorkerTasks({root,worker:new WorkerMcpClient({configPath}),enabled:async()=>true}).init();t.after(()=>cold.close());
  assert.equal((await cold.list())[0].review.phase,'revision_ready');
  await cold.followup(first.agent_id,'revision');const second=await cold.wait(first.agent_id,5000);
  assert.equal(second.final,'FOLLOWUP_OK');assert.equal(second.worker_agent_id,first.worker_agent_id);assert.equal(second.issue_id,first.issue_id);assert.equal(second.review.revision_round,1);
  await cold.review(first.agent_id,'pass','verified');await assert.rejects(cold.followup(first.agent_id,'unreviewed'),/Review/);
});

test('lost start receipt is recovered by marker with one remote dispatch, never a replay',async t=>{
  const {tasks,args,state}=await setup(t,{extra:'FAKE_WORKER_LOST_ACK="once"\n'});
  const receipt=await tasks.start(args);await tasks.entries.get(receipt.agent_id).done;
  const uncertain=await tasks.read(receipt.agent_id);assert.equal(uncertain.status,'unknown');assert.equal(uncertain.submission,'uncertain');
  const recovered=await tasks.wait(receipt.agent_id,5000);
  assert.equal(recovered.status,'completed');assert.equal(JSON.parse(await readFile(state,'utf8')).starts,1);
});

test('unmatched or ambiguous lost receipts stay unknown and cannot be followed up or silently restarted',async t=>{
  let starts=0,matches=[];
  const worker={async startArguments(){},async start(){starts++;throw Error('lost receipt');},async find(){return{items:matches};},async close(){}};
  const {tasks,args}=await setup(t,{worker});const receipt=await tasks.start(args);await tasks.entries.get(receipt.agent_id).done;
  assert.equal((await tasks.status(receipt.agent_id)).status,'unknown');
  await assert.rejects(tasks.followup(receipt.agent_id,'again'),/uncertain/);
  const marker=(await tasks.read(receipt.agent_id)).marker;matches=[{name:marker+' a'},{name:marker+' b'}];
  assert.match((await tasks.status(receipt.agent_id)).error,/Multiple/);assert.equal(starts,1);
  await assert.rejects(tasks.stop(receipt.agent_id),/Cannot confirm/);
});

test('uncertain followup must prove new worker revision before accepting an old completed answer',async t=>{
  let round=0,waiting,interrupts=0;
  const review={phase:'revision_ready',last_verdict:'revise',revision_round:0};
  const worker={async startArguments(){},async start(){return{agent_id:'remote'};},async wait(id,seconds){
    if(waiting&&seconds){await new Promise(resolve=>{waiting=resolve;});}
    return{status:interrupts?'interrupted':'completed',wait_outcome:'settled',answer:round?'NEW':'OLD',review:{...review,revision_round:round}};
  },async review(){return review;},async followup(){throw Error('lost followup receipt');},async close(){},async stop(){interrupts++;if(typeof waiting==='function')waiting();}};
  const {tasks,args}=await setup(t,{worker});const receipt=await tasks.start(args);await tasks.wait(receipt.agent_id,5000);
  await tasks.review(receipt.agent_id,'revise','revision');await tasks.followup(receipt.agent_id,'new');await tasks.entries.get(receipt.agent_id).done;
  assert.equal((await tasks.status(receipt.agent_id)).status,'unknown');assert.equal((await tasks.status(receipt.agent_id)).final,undefined);
  round=1;assert.equal((await tasks.status(receipt.agent_id)).final,'NEW');
});

test('stopping a wrapped worker waits for its collector and does not interrupt another task; disabling only blocks new dispatch',async t=>{
  const pending=new Map(),stopped=new Set();let count=0,enabled=true;
  const worker={async startArguments(){},async start(){return{agent_id:`remote-${++count}`};},async wait(id,seconds){
    if(!stopped.has(id)&&seconds)await new Promise(resolve=>pending.set(id,resolve));
    return{status:stopped.has(id)?'interrupted':'running',wait_outcome:stopped.has(id)?'settled':'pending'};
  },async stop(id){stopped.add(id);pending.get(id)?.();},async close(){}};
  const {tasks,args}=await setup(t,{worker});tasks.enabled=async()=>enabled;
  const a=await tasks.start(args),b=await tasks.start({...args,issue_id:'second'});
  while(pending.size<2)await new Promise(resolve=>setTimeout(resolve,1));
  enabled=false;await assert.rejects(tasks.start({...args,issue_id:'third'}),/disabled/);
  assert.equal((await tasks.stop(a.agent_id)).status,'interrupted');
  assert.equal((await tasks.status(b.agent_id)).status,'running');assert.deepEqual([...stopped],['remote-1']);
  assert.equal((await tasks.stop(b.agent_id)).status,'interrupted');
});

test('a read-only wait transport failure after acceptance cannot classify the paid task as not sent or failed',async t=>{
  const worker={async startArguments(){},async start(){return{agent_id:'accepted'};},async wait(){throw Object.assign(Error('read transport lost'),{mayHaveRun:false});},async close(){},async stop(){throw Error('unreachable');}};
  const {tasks,args}=await setup(t,{worker});const receipt=await tasks.start(args);await tasks.entries.get(receipt.agent_id).done;
  const record=await tasks.read(receipt.agent_id);assert.equal(record.status,'unknown');assert.equal(record.submission,'acknowledged');assert.equal(record.workerAgentId,'accepted');
});
