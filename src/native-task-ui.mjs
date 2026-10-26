import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NativeWebPeer } from './native-web-peer.mjs';
import { nativeTaskBootstrap } from './native-task-bootstrap.mjs';
import { conversationIdentity, tasksInConversation } from './call-observation.mjs';

export const NATIVE_TASK_URI = 'ui://dsh-native/task-v14.html';
export const NATIVE_PEER_URI = 'ui://dsh-native/peer-v14.html';
const publicTask = ({ nativeUrl, ...task }) => ({ ...task, nativeViewAvailable: typeof nativeUrl === 'string' });

// The same registration is used by the production switch and the isolated
// zero-model fixture server. A view capability is private _meta, not model text.
export function registerNativeTaskUi(server, { resolveTask, listTasks, retainView, workerEvents, peerFactory = url => new NativeWebPeer(url), onSignal = () => {}, diagnostics = false }) {
  const views = new Map();
  const closeView = id => {
    const view = views.get(id);
    if (!view) return;
    views.delete(id); view.peer.close(); void view.release?.().catch(() => {});
  };
  const add = (name, inputSchema, handler) => server.registerTool(name, {
    description: 'Native DSH view transport. App-only; runtime permissions remain authoritative.', inputSchema,
    _meta: { ui: { visibility: ['app'] } },
  }, async (args, extra) => {
    try { return { content: [{ type: 'text', text: 'Native view response' }], _meta: { payload: await handler(args, extra) } }; }
    catch (error) { return { isError: true, content: [{ type: 'text', text: String(error.message).replace(/([?&]token=)[^&\s]+/g, '$1[redacted]') }] }; }
  });
  const capability = z.string().uuid();
  const agent = z.string().uuid();
  const get = async id => {
    const view = views.get(id);
    if (!view) throw new Error('Native view expired; reopen this task');
    const current = await resolveTask(view.agentId, false);
    if (!current.nativeUrl || current.nativeUrl !== view.url || current.runtimeGeneration !== view.generation) {
      closeView(id); throw new Error('Native runtime generation changed; reopen this task');
    }
    view.touched = Date.now();
    return view;
  };
  for(const [uri,sideOnly] of [[NATIVE_TASK_URI,false],[NATIVE_PEER_URI,true]]) {
  server.registerResource(sideOnly?'dsh-native-peer':'dsh-native-task', uri, { title: sideOnly?'DSH 协作 agent〔peer〕':'DSH 子 agent〔sub〕', mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri, mimeType: 'text/html;profile=mcp-app',
      text: (await readFile(new URL('../dist/native-task.html', import.meta.url), 'utf8')).replace('<head>',`<head><script>globalThis.__DSH_SIDE_ENTRY__=${sideOnly};</script>`),
      _meta: { ui: { prefersBorder: true, csp: { frameDomains: [], connectDomains: [], resourceDomains: [] } },
        'openai/ui': { availableDisplayModes: sideOnly?['fullscreen']:['inline', 'fullscreen'], preferredDisplayMode: sideOnly?'fullscreen':'inline' } },
    }],
  }));
  }
  const callId = z.string().uuid().optional();
  add('native_tasks', { agent_id: agent.optional(), conversation_id: z.string().min(1).max(200).optional() }, async (args, extra) => {
    const anchor=args.agent_id?await resolveTask(args.agent_id,false):null;
    return { items: tasksInConversation(await listTasks(),anchor,conversationIdentity(args,extra)).map(publicTask) };
  });
  add('native_state', { agent_id: agent, call_id: callId }, async ({ agent_id, call_id }) => publicTask(await resolveTask(agent_id, false, call_id)));
  add('native_worker_events',{agent_id:agent,after:z.union([z.number().int().min(-1),z.string().max(2000)]).default(-1),limit:z.number().int().min(1).max(50).default(20)},async({agent_id,after,limit})=>{
    if((await resolveTask(agent_id,false)).backend!=='worker'||!workerEvents)throw Error('This is not a worker-backed task');
    return workerEvents(agent_id,after,limit);
  });
  add('native_bootstrap', { agent_id: agent, call_id: callId }, async ({ agent_id, call_id }) => {
    const task = await resolveTask(agent_id, true, call_id);
    if (!task.nativeUrl) throw new Error('This task has no live native view; continue the task to reopen its runtime');
    if (views.size >= 16) throw new Error('Too many open native views; close an old view first');
    const release = await retainView?.(agent_id);
    let peer;
    try {
      peer = peerFactory(task.nativeUrl);
      const bootstrap = await nativeTaskBootstrap(peer);
      if (diagnostics) bootstrap.diagnostics = true;
      const id = randomUUID();
      views.set(id, { peer, release, agentId: agent_id, url: task.nativeUrl, generation: task.runtimeGeneration, touched: Date.now() });
      return { viewId: id, task: publicTask(task), bootstrap };
    } catch (error) { peer?.close(); await release?.(); throw error; }
  });
  add('native_asset', { viewId: capability, path: z.string().max(20000) }, async ({ viewId, path }) => ({ code: await (await get(viewId)).peer.asset(path) }));
  add('native_rpc', { viewId: capability, channel: z.literal('/api'), endpoint: z.string().max(120), payload: z.unknown() }, async ({ viewId, endpoint, payload }) => (await get(viewId)).peer.rpc(endpoint, payload));
  add('native_stream_open', { viewId: capability, endpoint: z.string().max(120), payload: z.unknown() }, async ({ viewId, endpoint, payload }) => (await get(viewId)).peer.open(endpoint, payload));
  add('native_stream_read', { viewId: capability, id: capability }, async ({ viewId, id }) => (await get(viewId)).peer.read(id));
  add('native_stream_send', { viewId: capability, id: capability, type: z.enum(['item', 'end']), value: z.unknown().optional() }, async ({ viewId, id, type, value }) => (await get(viewId)).peer.send(id, type, value));
  // Closing is always allowed, including after the runtime has been released.
  add('native_stream_close', { viewId: capability, id: capability }, async ({ viewId, id }) => views.get(viewId)?.peer.closeStream(id) ?? { closed: true });
  add('native_view_close', { viewId: capability }, async ({ viewId }) => { closeView(viewId); return { closed: true }; });
  add('native_ui_signal', { event: z.string().max(100), detail: z.string().max(1000) }, async args => { await onSignal(args); return { recorded: true }; });
  const timer = setInterval(() => {
    for (const [id, view] of views) if (Date.now() - view.touched > 120000) closeView(id);
  }, 30000);
  timer.unref();
  return { close() { clearInterval(timer); for (const id of views.keys()) closeView(id); } };
}

export function bridgeTaskResolver(bridge) {
  return async (id, wait = false) => {
    if(wait&&!bridge.live.get(id)?.runtime){
      const live=bridge.live.get(id),record=live?.record??await bridge.read(id);
      if(!live?.busy&&record.webEmbed&&record.persisted&&!record.fallbackReserved)await bridge.openView(id);
    }
    // Another card may already be restoring this settled session. Execution
    // being completed does not make its newly-created view URL ready.
    if(wait&&bridge.live.get(id)?.urlWait)await bridge.live.get(id).urlWait;
    const deadline = Date.now() + (wait ? 25000 : 0);
    while (true) {
      const live = bridge.live.get(id);
      const record = live?.record ?? await bridge.read(id);
      const task = { ...bridge.summary(record), runtimeGeneration: record.runtimeGeneration };
      if (!wait || task.nativeUrl || !['starting', 'running'].includes(task.status) || Date.now() >= deadline) return task;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  };
}
