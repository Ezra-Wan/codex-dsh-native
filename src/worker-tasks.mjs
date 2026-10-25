import { mkdir,readFile,readdir,rm,stat,writeFile } from 'node:fs/promises';
import { isAbsolute,join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson,MODES } from './bridge.mjs';
import { WorkerMcpClient } from './worker-client.mjs';
import {readJson} from './state-store.mjs';

const ID=/^[a-f0-9-]{36}$/;
const ACTIVE=new Set(['starting','running','stopping','unknown']);
const safe=error=>String(error?.message??error).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/([?&](?:token|api_key|key)=)[^&\s]+/gi,'$1[redacted]').slice(0,2000);
const busyPid=pid=>{if(!Number.isInteger(pid)||pid<1)return true;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};

// Durable wrapper identities stay separate from the worker's own identities.
// A proxy disappearing is never evidence that its background task stopped.
export class WorkerTasks {
  constructor({root,worker=new WorkerMcpClient(),enabled=async()=>false}) {
    this.root=join(resolve(root),'worker-tasks');this.worker=worker;this.enabled=enabled;
    this.entries=new Map();this.writes=new Map();this.gate=Promise.resolve();this.closed=false;
  }
  async init(){await mkdir(this.root,{recursive:true});return this;}
  serial(fn){const p=this.gate.then(fn);this.gate=p.catch(()=>{});return p;}
  path(id){if(!ID.test(id))throw Error('Invalid bridge task id');return join(this.root,`${id}.json`);}
  async has(id){try{await stat(this.path(id));return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  async read(id){
    if(this.entries.has(id))return this.entries.get(id).record;
    const record=await readJson(this.path(id));if(record.agent_id!==id)throw Error('Worker identity does not match its state path');
    return record.stateRecoveredFromBackup?{...record,status:'unknown',submission:'uncertain',error:'Task state recovered from backup; reconcile worker identity before continuing.'}:record;
  }
  save(record){
    const snapshot=structuredClone(record),id=record.agent_id;
    const p=(this.writes.get(id)??Promise.resolve()).catch(()=>{}).then(()=>atomicJson(this.path(id),snapshot));
    this.writes.set(id,p);return p;
  }
  async own(record){
    const id=record.agent_id;if(this.entries.has(id))return this.entries.get(id);
    const path=join(this.root,`${id}.lock`);
    try{await mkdir(path);}catch(e){
      if(e.code!=='EEXIST')throw e;
      const owner=await readFile(join(path,'owner.json'),'utf8').then(JSON.parse).catch(()=>null);
      if(!owner||busyPid(owner.pid))throw Error('Worker task belongs to another live bridge process');
      await rm(path,{recursive:true});await mkdir(path);
    }
    await atomicJson(join(path,'owner.json'),{pid:process.pid});
    const entry={record,busy:false,release:()=>rm(path,{recursive:true,force:true})};
    this.entries.set(id,entry);return entry;
  }
  summary(record){
    const final=(record.final??'').slice(0,record.returnChars);
    return{agent_id:record.agent_id,session_id:null,backend:'worker',worker_agent_id:record.workerAgentId??null,
      name:record.name,cwd:record.cwd,permission:record.permission,role:record.role,mode:record.mode,
      issue_id:record.issue_id,status:record.status,workerStatus:record.workerStatus??null,turn:record.turn,
      model:record.model??null,maxTokens:record.maxTokens??null,budgetControl:record.maxTokens?'per-request':'worker-policy',
      submission:record.submission,error:record.error??null,warnings:record.warnings??[],review:record.review??null,
      progress:record.progress??{},...(record.source_agent_id?{source_agent_id:record.source_agent_id}:{}),
      ...(record.resultPath?{final,resultPath:record.resultPath,resultTruncated:final.length<(record.final??'').length}:{}),
      ...(record.finishReason?{finishReason:record.finishReason}:{}),nativeViewAvailable:false};
  }
  async start(args){return this.serial(async()=>{
    if(this.closed)throw Error('Worker task adapter is closed');
    if(!await this.enabled())throw Error('Bridge is disabled. Enable it explicitly before dispatch.');
    if(!isAbsolute(args.cwd??'')||!(await stat(args.cwd)).isDirectory())throw Error('cwd must be an existing absolute directory');
    if(!args.task?.trim()||!args.issue_id?.trim())throw Error('Worker tasks require a task and a stable issue_id');
    const mode=args.mode??'light',permission=args.permission??'workspace-write',role=args.role??'peer';
    if(!MODES[mode]||!['read-only','workspace-write'].includes(permission)||!['peer','sub'].includes(role))throw Error('Invalid worker task options');
    if(args.subagents)throw Error('This worker interface cannot promise native subagents; no task was sent');
    const id=randomUUID(),marker=`dsh-${id}`,remoteArgs={task:args.task,cwd:resolve(args.cwd),name:`${marker} ${(args.name??'worker fallback').slice(0,65)}`,
      issue_id:args.issue_id.trim(),permission,...Object.fromEntries(['model','provider','effort','maxTokens'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]]))};
    // Capability validation and connection happen BEFORE any local reservation
    // or paid mutation. Unsupported budgets must not be silently discarded.
    await this.worker.startArguments(remoteArgs);
    const record={agent_id:id,backend:'worker',name:args.name??'worker fallback',cwd:remoteArgs.cwd,permission,role,mode,
      issue_id:remoteArgs.issue_id,marker,model:args.model??null,maxTokens:args.maxTokens??null,returnChars:MODES[mode].returnChars,
      status:'starting',submission:'prepared',turn:1,createdAt:new Date().toISOString(),
      warnings:['Worker fallback uses the retained worker harness. Native MCP body streaming is unavailable on this backend.',
        ...(!args.maxTokens?['Per-task output cap is owned by the worker policy, not the native light/coding preset.']:[])],
      ...(args.source_agent_id?{source_agent_id:args.source_agent_id}:{})};
    const entry=await this.own(record);await this.save(record);
    this.run(entry,()=>this.worker.start(remoteArgs));
    return this.summary(record);
  });}
  run(entry,dispatch){
    entry.busy=true;
    entry.done=(async()=>{
      const record=entry.record;
      record.submission='sending';await this.save(record);
      try{
        const receipt=await dispatch();
        const remote=receipt.agent_id??receipt.id;
        if(typeof remote!=='string'||!remote)throw Error('Worker start returned no agent identity');
        if(record.workerAgentId&&record.workerAgentId!==remote)throw Error('Worker changed the retained conversation identity');
        record.workerAgentId=remote;record.review=receipt.review??record.review;record.expectedRevision=undefined;
        record.submission='acknowledged';record.status='running';await this.save(record);
        await this.collect(entry);
      }catch(error){
        record.error=safe(error);
        // Only explicit preflight errors prove that no mutation was sent.
        const notSent=!record.workerAgentId&&error.mayHaveRun===false;
        record.status=notSent?'failed':'unknown';
        record.submission=notSent?'not_sent':record.submission==='acknowledged'?'acknowledged':'uncertain';
        await this.save(record);
      }
    })().catch(error=>{entry.record.status='unknown';entry.record.error=safe(error);}).finally(()=>{entry.busy=false;});
  }
  async apply(record,value){
    record.workerStatus=value.status;record.review=value.review??record.review;
    record.progress={lastEvent:value.last_event??value.progress??null,updatedAt:value.updated_at??new Date().toISOString()};
    record.updatedAt=new Date().toISOString();
    if(value.wait_outcome!=='settled'){record.status='running';return;}
    record.error=value.error?safe(value.error):null;
    record.finishReason=value.finish_reason?.kind??value.finish_reason??value.status;
    record.status=value.status==='completed'?'completed':['interrupted','closed'].includes(value.status)?'interrupted':'failed';
    if(record.status==='completed'){
      if(typeof value.answer!=='string'||!value.answer.trim()){record.status='failed';record.error='Worker settled without a final answer';}
      else{
        record.final=value.answer;record.resultPath=join(this.root,`${record.agent_id}.result.txt`);
        await writeFile(record.resultPath,value.answer,'utf8');
      }
    }
  }
  async collect(entry){
    const record=entry.record;
    while(!this.closed){
      const value=await this.worker.wait(record.workerAgentId,50);
      await this.apply(record,value);await this.save(record);
      if(value.wait_outcome==='settled')return;
    }
  }
  async reconcile(entry){
    const record=entry.record;
    if(!record.workerAgentId){
      const found=await this.worker.find(record.marker),exact=(found.items??[]).filter(row=>row.name?.startsWith(record.marker+' '));
      if(exact.length!==1){record.status='unknown';record.error=exact.length?'Multiple worker matches; inspect before continuing':'No acknowledged worker match yet; the submission will not be replayed';await this.save(record);return;}
      record.workerAgentId=exact[0].agent_id??exact[0].id;
    }
    const value=await this.worker.wait(record.workerAgentId,0);
    if(record.expectedRevision!==undefined&&value.review?.revision_round!==record.expectedRevision){
      record.status='unknown';record.error='Followup acknowledgement is uncertain; current worker review round does not prove acceptance';await this.save(record);return;
    }
    record.submission='acknowledged';record.error=null;delete record.stateRecoveredFromBackup;
    await this.apply(record,value);await this.save(record);
    if(value.wait_outcome!=='settled'){
      entry.busy=true;
      entry.done=this.collect(entry).catch(async error=>{record.status='unknown';record.error=safe(error);await this.save(record);}).finally(()=>{entry.busy=false;});
    }
  }
  async status(id){
    const record=await this.read(id),current=this.entries.get(id);
    if(current?.busy||!ACTIVE.has(record.status))return this.summary(record);
    return this.serial(async()=>{
      const entry=await this.own(record);
      if(!entry.busy)try{await this.reconcile(entry);}catch(e){record.status='unknown';record.error=safe(e);await this.save(record);}
      return this.summary(record);
    });
  }
  async wait(id,timeoutMs=50000){
    if(!Number.isInteger(timeoutMs)||timeoutMs<0||timeoutMs>50000)throw Error('timeoutMs must be 0..50000');
    await this.status(id);
    const entry=this.entries.get(id);let timer;
    if(entry?.busy&&timeoutMs)try{await Promise.race([entry.done,new Promise(resolve=>{timer=setTimeout(resolve,timeoutMs);})]);}finally{clearTimeout(timer);}
    return this.status(id);
  }
  async followup(id,task){return this.serial(async()=>{
    if(this.closed||!await this.enabled())throw Error('Bridge is closed or disabled');
    const record=await this.read(id),entry=await this.own(record);
    if(entry.busy||ACTIVE.has(record.status))throw Error('Worker task is active or uncertain; inspect or stop it before followup');
    if(!record.workerAgentId||!task?.trim())throw Error('Missing worker identity or followup task');
    // The retained worker, not this adapter, owns review and correction caps.
    if(record.review?.phase!=='revision_ready'||record.review?.last_verdict!=='revise'||record.review.takeover_required)throw Error('Review this worker delivery as revise before followup; exhausted corrections require parent takeover');
    record.expectedRevision=(record.review.revision_round??0)+1;record.turn++;record.status='starting';record.final='';record.resultPath=null;record.error=null;
    await this.save(record);this.run(entry,()=>this.worker.followup(record.workerAgentId,task));return this.summary(record);
  });}
  async review(id,verdict,feedback){return this.serial(async()=>{
    const record=await this.read(id),entry=await this.own(record);
    if(entry.busy||ACTIVE.has(record.status)||!record.workerAgentId)throw Error('Worker is not settled for review');
    record.review=await this.worker.review(record.workerAgentId,verdict,feedback);await this.save(record);return{agent_id:id,backend:'worker',review:record.review};
  });}
  async stop(id){
    // Reconcile a lost start receipt before interrupting exactly that worker.
    await this.status(id);
    return this.serial(async()=>{
      const record=await this.read(id),entry=await this.own(record);
      if(!record.workerAgentId)throw Error('Cannot confirm which worker accepted the task; inspect its stable marker before stopping');
      try{
        await this.worker.stop(record.workerAgentId);
        await entry.done;
        const value=await this.worker.wait(record.workerAgentId,0);
        await this.apply(record,value);await this.save(record);
      }catch(e){record.status='unknown';record.error=safe(e);await this.save(record);throw e;}
      return this.summary(record);
    });
  }
  async events(id,after=-1,limit=30){const record=await this.read(id);if(!record.workerAgentId)return{backend:'worker',events:[],cursor:after,pendingIdentity:true};return{backend:'worker',source:'deepseek_worker',...await this.worker.events(record.workerAgentId,after,limit)};}
  async list(){const names=(await readdir(this.root)).filter(name=>name.endsWith('.json')&&ID.test(name.slice(0,-5)));return Promise.all(names.map(async name=>this.summary(await this.read(name.slice(0,-5)))));}
  async close(){
    const unresolved=[];
    for(const[id,entry]of this.entries)if(entry.busy||ACTIVE.has(entry.record.status))try{await this.stop(id);}catch(e){unresolved.push({agent_id:id,error:safe(e)});}
    this.closed=true;await this.worker.close();
    await Promise.all([...this.entries.values()].map(async entry=>{await entry.done;await this.writes.get(entry.record.agent_id)?.catch(()=>{});await entry.release();}));
    this.entries.clear();return{unresolved};
  }
}
