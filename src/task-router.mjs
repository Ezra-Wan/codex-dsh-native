import {realpath} from 'node:fs/promises';
import {bridgeTaskResolver} from './native-task-ui.mjs';

const active=new Set(['starting','running','stopping','unknown']);
const canonical=async path=>{const value=await realpath(path);return process.platform==='win32'?value.toLowerCase():value;};

// A single dispatch surface, with identities and backend capabilities kept
// explicit. Reading the list never starts a worker connection or model.
export class TaskRouter {
  constructor(native,worker){this.native=native;this.worker=worker;this.gate=Promise.resolve();this.resolveNative=bridgeTaskResolver(native);}
  serial(fn){const p=this.gate.then(fn);this.gate=p.catch(()=>{});return p;}
  async backend(id){return await this.worker.has(id)?this.worker:this.native;}
  async list(){const [native,worker]=await Promise.all([this.native.list(),this.worker.list()]);return{...native,items:[...native.items,...worker]};}
  setEnabled(value){return this.native.setEnabled(value);}
  configure(value){return this.native.configure(value);}
  async guardWriter(args,exclude){
    if(args.permission==='read-only')return;
    const target=await canonical(args.cwd);
    for(const task of (await this.list()).items){
      if(task.agent_id===exclude||task.permission==='read-only'||!active.has(task.status))continue;
      if(await canonical(task.cwd)===target)throw Error('Another active or uncertain bridge task may write this workspace. Stop/reconcile it or use a separate worktree.');
    }
  }
  start(args){return this.serial(async()=>{
    if(this.closing)throw Error('Bridge is closing');
    if(!(await this.native.config()).enabled)throw Error('Bridge is disabled. Enable it explicitly before dispatch.');
    await this.guardWriter(args);
    return(args.backend==='worker'?this.worker:this.native).start(args);
  });}
  followup(id,task,options={}){return this.serial(async()=>{if(this.closing)throw Error('Bridge is closing');const backend=await this.backend(id),record=await backend.read(id);await this.guardWriter(record,id);return backend.followup(id,task,options);});}
  async status(id){return(await this.backend(id)).status(id);}
  async wait(id,timeoutMs){return(await this.backend(id)).wait(id,timeoutMs);}
  async stop(id){return(await this.backend(id)).stop(id);}
  async events(id,after,limit){const backend=await this.backend(id);if(backend===this.native&&typeof after!=='number')throw Error('Native events require a numeric sequence');return backend.events(id,after,limit);}
  async review(id,verdict,feedback){
    if(!await this.worker.has(id))throw Error('ds_review applies to worker deliveries; native deliveries require artifact review by the caller, not a simulated worker ledger.');
    return this.worker.review(id,verdict,feedback);
  }
  fallback({agent_id,task,issue_id,name,maxTokens,rejectionReason}){return this.serial(async()=>{
    if(this.closing||!(await this.native.config()).enabled)throw Error('Bridge is closed or disabled');
    if(await this.worker.has(agent_id))throw Error('Fallback source must be a native task');
    const source=await this.native.status(agent_id);
    if(source.status!=='failed'&&!(['completed','completed_with_warnings'].includes(source.status)&&rejectionReason?.trim()))throw Error('Only a failed native task or completed delivery explicitly rejected by artifact review can be handed off; unknown or active work must be inspected first.');
    // Preflight before retiring the native conversation. The old worker owns
    // its budget policy; explicit unsupported caps still fail before handoff.
    await this.worker.worker.startArguments({task,cwd:source.cwd,issue_id,permission:source.permission,...(maxTokens!==undefined?{maxTokens}:{})});
    const held=await this.native.prepareFallback(agent_id,{rejectionReason});
    try{
      const previous=(await this.worker.list()).filter(item=>item.source_agent_id===agent_id);
      if(previous.length>1)throw Error('Multiple fallback records found; inspect rather than dispatch again');
      if(previous.length)return this.worker.status(previous[0].agent_id);
      const args={task,cwd:source.cwd,permission:source.permission,mode:source.mode,role:source.role,issue_id,name:name??`${source.name||'DSH'} worker fallback`,maxTokens,source_agent_id:agent_id,conversation_id:source.conversation_id};
      await this.guardWriter(args,agent_id);
      const result=await this.worker.start(args);
      held.record.fallbackAgentId=result.agent_id;await this.native.save(held.record);
      return result;
    }finally{await held.release();}
  });}
  async resolveTask(id,wait=false){return await this.worker.has(id)?this.worker.status(id):this.resolveNative(id,wait);}
  async close(){this.closing=true;await this.gate;const worker=await this.worker.close();await this.native.close();return worker;}
}
