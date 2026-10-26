const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only the widget's own optional host snapshot is used. No transcript, URL,
// global localStorage key, or model context is copied into presentation state.
export function createInvocationOwner(host=globalThis.openai){
  let identity;
  try{
    const saved=host?.widgetState?.dshInvocation;
    if(uuid.test(saved?.agent_id??'')&&uuid.test(saved?.call_id??''))identity={agent_id:saved.agent_id,call_id:saved.call_id};
  }catch{/* Optional host extension; the original tool result remains usable. */}
  const matches=task=>!identity||(task?.agent_id===identity.agent_id&&task.observation?.call_id===identity.call_id);
  return {
    get identity(){return identity;},
    get persistenceAvailable(){return typeof host?.setWidgetState==='function';},
    matches,
    remember(task){
      const call_id=task?.observation?.call_id;
      if(identity||!task?.agent_id||!call_id)return;
      identity={agent_id:task.agent_id,call_id};
      if(!uuid.test(identity.agent_id)||!uuid.test(call_id)||typeof host?.setWidgetState!=='function')return;
      try{host.setWidgetState({...host.widgetState,dshInvocation:{...identity}});}catch{/* No persistence promise on unsupported hosts. */}
    },
  };
}
