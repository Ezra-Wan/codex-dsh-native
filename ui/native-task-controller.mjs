// Serialize client-tree changes. Host display-mode changes never call select(),
// so the same native tree and its connection survive a layout-only change.
export function createNativeTaskController({ call, mount, worker, waiting = () => {}, failed = () => {} }) {
  let sequence = 0, current, pendingTarget, failedTarget, chain = Promise.resolve(), stopped = false;
  const close = async view => {
    if (!view) return;
    try { await view.instance?.dispose(); }
    finally { if(view.viewId)await call('native_view_close', { viewId: view.viewId }).catch(() => {}); }
  };
  const select = (task, { force = false } = {}) => {
    if (stopped || !task?.agent_id) return Promise.resolve();
    const callId=task.observation?.call_id;
    const sameCall=view=>view?.callId===callId;
    if(task.backend==='worker'){
      if(!force&&current?.agentId===task.agent_id&&sameCall(current)&&current.backend==='worker'){current.instance?.update(task);return Promise.resolve();}
      const version=++sequence;pendingTarget=null;failedTarget=null;waiting(task);
      chain=chain.catch(()=>{}).then(async()=>{
        const previous=current;current=null;await close(previous);
        if(stopped||version!==sequence)return;
        if(!worker)throw Error('Worker fallback view unavailable');
        const view={agentId:task.agent_id,callId,backend:'worker',instance:await worker(task)};
        if(stopped||version!==sequence){await close(view);return;}current=view;
      }).catch(error=>{if(!stopped&&version===sequence)failed(error);});
      return chain;
    }
    if (!force && pendingTarget?.agentId === task.agent_id && sameCall(pendingTarget) && (pendingTarget.generation === undefined || task.runtimeGeneration === undefined || task.runtimeGeneration === pendingTarget.generation)) return chain;
    if (!force && failedTarget?.agentId === task.agent_id && sameCall(failedTarget) && (task.runtimeGeneration === undefined || task.runtimeGeneration === failedTarget.generation)) return Promise.resolve();
    if (task.nativeViewAvailable === false && !task.nativeViewRestorable && !['starting', 'running'].includes(task.status)) {
      ++sequence; waiting(task);
      chain = chain.catch(() => {}).then(async () => { const previous = current; current = null; await close(previous); });
      return chain;
    }
    if (!force && current?.agentId === task.agent_id && sameCall(current) && (task.runtimeGeneration === undefined || task.runtimeGeneration === current.generation)) {current.instance?.update?.(task);return Promise.resolve();}
    const version = ++sequence;
    let generation = task.runtimeGeneration;
    failedTarget = null;
    pendingTarget = { agentId: task.agent_id, callId, generation };
    waiting(task);
    chain = chain.catch(() => {}).then(async () => {
      if (stopped || version !== sequence) return;
      const previous = current; current = null;
      await close(previous);
      if (stopped || version !== sequence) return;
      const data = await call('native_bootstrap', { agent_id: task.agent_id, ...(callId?{call_id:callId}:{}) });
      generation = data.task.runtimeGeneration;
      const view = { viewId: data.viewId, agentId: task.agent_id, callId, generation: data.task.runtimeGeneration };
      if (stopped || version !== sequence) { await close(view); return; }
      try {
        view.instance = await mount(data);
        if (stopped || version !== sequence) { await close(view); return; }
        current = view;
      } catch (error) { await close(view); throw error; }
    }).catch(error => { if (!stopped && version === sequence) { failedTarget = { agentId: task.agent_id, callId, generation }; failed(error); } })
      .finally(() => { if (version === sequence) pendingTarget = null; });
    return chain;
  };
  return { select, current: () => current,
    async clear() { sequence++;pendingTarget=null;failedTarget=null;await chain;const previous=current;current=null;await close(previous); },
    async dispose() { stopped = true; sequence++; await chain; const previous = current; current = null; await close(previous); },
  };
}
