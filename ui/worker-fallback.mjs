// A deliberately labelled degraded view, not a replacement transcript for
// the native DSH frontend. Only worker-projected tool evidence is displayed.
export function mountWorkerFallback({doc,call,task}){
  const panel=doc.getElementById('worker-fallback'),state=doc.getElementById('worker-state'),answer=doc.getElementById('worker-answer'),events=doc.getElementById('worker-events');
  let disposed=false,busy=false,cursor=-1,lines=[];
  panel.hidden=false;
  const update=value=>{state.textContent=`${value.name||'Worker'} · ${value.status}\nworker_agent_id: ${value.worker_agent_id??'等待回执'}\n${value.failure?.label??''}\n${value.error??''}\n${(value.warnings??[]).join('\n')}`;answer.textContent=value.final??'';};
  update(task);
  const poll=async()=>{
    if(disposed||busy||doc.hidden)return;busy=true;
    try{
      const packet=await call('native_worker_events',{agent_id:task.agent_id,after:cursor,limit:20});
      if(disposed)return;
      const rows=packet.items??packet.events??[];
      lines.push(...rows.map(row=>JSON.stringify(row)));lines=lines.slice(-40);events.textContent=lines.join('\n');
      cursor=packet.next_cursor??packet.cursor??cursor;
    }catch(error){if(!disposed)events.textContent=error.message;}
    finally{busy=false;}
  };
  void poll();const timer=setInterval(()=>void poll(),5000);
  return{update,dispose(){disposed=true;clearInterval(timer);panel.hidden=true;state.textContent='';answer.textContent='';events.textContent='';}};
}
