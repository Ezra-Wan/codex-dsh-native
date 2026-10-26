import {taskIdentity} from './task-identity.mjs';
import { App } from '@modelcontextprotocol/ext-apps';
import { AppWebEntry } from '@deepseek-ai/dsh-client-web';
import { createNativeMcpRpc } from './native-mcp-rpc.mjs';
import { createNativeTaskController } from './native-task-controller.mjs';
import { registerSessionTarget } from './native-session-target.mjs';
import { splitNativeFonts, installNativeFonts } from './native-fonts.mjs';
import { createNativeTaskLayout, requestNativeViewClose } from './native-task-layout.mjs';
import { createNativeDisplayMode, registerNativePresentation } from './native-presentation.mjs';
import { observeNativeRendering } from './native-render-evidence.mjs';
import { mountWorkerFallback } from './worker-fallback.mjs';
import {createObservationContext,registerNativeObservation} from './native-observation.mjs';

const sideEntry=globalThis.__DSH_SIDE_ENTRY__===true;
const app = new App({ name: 'DSH native task', version: '1' }, { availableDisplayModes: sideEntry?['fullscreen']:['inline', 'fullscreen'] }, { autoResize: false });
const root = document.getElementById('root'), status = document.getElementById('state'), tasks = document.getElementById('tasks');
function renderTaskStatus(task){document.title=taskIdentity(task);status.textContent=`${taskIdentity(task)} · ${task.status}${task.observation?.frozen?' · 当次记录已固定':''}${task.failure?.label?' · '+task.failure.label:''}`;status.title=task.error??'';}
function showLoading(message, busy = true) {
  const mask = document.getElementById('native-loading');
  mask.hidden = false; mask.dataset.busy = String(busy);
  document.getElementById('native-loading-message').textContent = message;
}
const rawCall = async (name, args = {}) => {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? 'Native view request failed');
  return result._meta?.payload;
};
const signal = (event, detail = '') => rawCall('native_ui_signal', { event, detail: String(detail).slice(0, 1000) }).catch(() => {});
const decode = async encoded => new Response(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const execute = code => { const el = document.createElement('script'); el.textContent = code; document.head.appendChild(el); el.remove(); };
const css = document.createElement('style'); document.head.appendChild(css);
let selected, selectedCall, anchor, currentTask, polling = false, timer;
let entryTask;
let lastMode;
const nativeMode = createNativeDisplayMode();
const layout = createNativeTaskLayout({ app, doc: document, root,
  changed: ({ mode }) => nativeMode.set(mode),
  close: async () => { const path = await requestNativeViewClose(app); void signal('native-close-request', path); },
});
const controller = createNativeTaskController({ call: rawCall,
  waiting(task) { selected = task.agent_id; document.getElementById('worker-fallback').hidden=true; root.style.visibility = 'hidden'; const released = task.nativeViewAvailable === false && !task.nativeViewRestorable && !['starting','running'].includes(task.status); status.textContent = task.backend==='worker'?'正在连接旧 worker…':released ? '该任务暂无可恢复的原生界面' : task.nativeViewRestorable&&!task.nativeViewAvailable?'正在恢复原生历史（不调用模型）…':'正在连接原生会话…'; showLoading(status.textContent, !released); },
  failed(error) { const message=`观察连接失败（未确认执行中止）：${error.message}`;status.textContent = message; showLoading(message, false); void signal('native-view-failed', error.message); },
  worker(task){
    selected=task.agent_id;root.style.visibility='hidden';document.getElementById('native-loading').hidden=true;
    status.textContent='旧 worker 兜底 · 无原生正文流';
    return mountWorkerFallback({doc:document,call:rawCall,task,readMode:()=>nativeMode.getSnapshot()});
  },
  async mount({ viewId, task, bootstrap }) {
    showLoading('正在加载原生 DSH 界面…');
    // Capture this capability, never route an old stream through a new task.
    const call = (name, args) => rawCall(name, { ...args, viewId });
    const rpc = createNativeMcpRpc(call);
    delete globalThis.__ModuleLoader__;
    delete globalThis.__DSH_BOOT__;
    delete globalThis.__DSH_BOOT_READY__;
    root.replaceChildren();
    for (const encoded of bootstrap.injected) execute(await decode(encoded));
    for (const encoded of bootstrap.batches) execute(await decode(encoded));
    const styles = splitNativeFonts(bootstrap.css);
    css.textContent = styles.css;
    await installNativeFonts(styles.fonts);
    globalThis.__DSH_TRANSPORT__ = { rpc,
      loadBundle: async url => {
        if (['/codex-session-target.js', '/codex-native-presentation.js','/codex-observation.js'].includes(new URL(url, location.href).pathname)) return;
        const { code } = await call('native_asset', { path: url }); execute(code);
      },
    };
    const target = () => task.session_id;
    target.subscribe = fn => nativeMode.subscribe(() => {if(nativeMode.getSnapshot()==='inline')fn();});
    registerSessionTarget({ loader: globalThis.__ModuleLoader__, boot: globalThis.__DSH_BOOT__, readTarget: target,
      onNavigate: value => { void signal('native-session-selected', JSON.stringify(value)); } });
    registerNativePresentation({ loader: globalThis.__ModuleLoader__, boot: globalThis.__DSH_BOOT__, mode: nativeMode });
    const observationContext=createObservationContext(nativeMode,task);
    registerNativeObservation({loader:globalThis.__ModuleLoader__,boot:globalThis.__DSH_BOOT__,context:observationContext,sessionId:task.session_id});
    const entry = new AppWebEntry(root);
    try { await entry.run(error => { throw error; }); }
    catch (error) { observationContext.dispose();rpc.dispose(); await entry.dispose(); throw error; }
    root.style.visibility = 'visible'; renderTaskStatus(task);
    document.getElementById('native-loading').hidden = true;
    layout.mounted();
    void signal('native-view-mounted', task.session_id);
    const stopEvidence = bootstrap.diagnostics ? observeNativeRendering(root, { mode: nativeMode,
      signal: (event, detail) => signal(event, JSON.stringify({ agent_id: task.agent_id, viewId, sample: JSON.parse(detail) })) }) : () => {};
    return { update(next){observationContext.update(next);}, async dispose() { observationContext.dispose();stopEvidence(); try { await entry.dispose(); } finally { rpc.dispose(); } } };
  },
});

async function present(task){
  currentTask=task;selected=task.agent_id;selectedCall=task.observation?.call_id;
  const sideOnly=task.role!=='sub'&&layout.mode!=='fullscreen';
  document.documentElement.dataset.sideOnly=String(sideOnly);
  tasks.hidden=layout.mode!=='fullscreen';
  if(sideOnly){
    await controller.clear();
    if(layout.mode==='fullscreen'||currentTask?.agent_id!==task.agent_id)return;
    // The declared peer resource is fullscreen-only. Never leave an inline
    // placeholder requiring a second click when a host ignores that contract.
    document.getElementById('native-toolbar').hidden=true;
    await requestNativeViewClose(app).catch(()=>{});
    return;
  }
  document.getElementById('native-toolbar').hidden=false;
  renderTaskStatus(task);await controller.select(task);
}

function receive(data) {
  if (!data) return;
  const items = data.items ?? (data.agent_id ? [data] : []);
  for (const task of items) {
    if (!task.agent_id) continue;
    let option = [...tasks.options].find(item => item.value === task.agent_id);
    if (!option) { option = document.createElement('option'); option.value = task.agent_id; tasks.appendChild(option); }
    option.textContent = taskIdentity(task);
  }
  const task = data.agent_id ? data : items.find(item => item.agent_id === selected) ?? items.at(-1);
  if (task?.agent_id) { selectionSeq++;anchor??=task.agent_id;entryTask??=task;tasks.value=task.agent_id;void present(task); }
}
app.ontoolresult = result => receive(result.structuredContent);
app.ontoolinput = ({arguments:args}) => {if(args?.role==='peer'&&layout.mode!=='fullscreen'){document.documentElement.dataset.sideOnly='true';void app.sendSizeChanged({height:34}).catch(()=>{});}};
let selectionSeq=0;
async function choose(id,force=false){
  const seq=++selectionSeq;const callId=id===selected?selectedCall:undefined;selected=id;
  try{const task=await rawCall('native_state',{agent_id:id,...(callId?{call_id:callId}:{})});if(seq===selectionSeq&&selected===id){selectedCall=task.observation?.call_id;if(force)await controller.select(task,{force});else await present(task);}}
  catch(error){if(seq===selectionSeq)showLoading(error.message,false);}
}
tasks.addEventListener('change', () => { void choose(tasks.value); });
document.getElementById('retry').addEventListener('click', () => { void choose(selected,true); });
app.onhostcontextchanged = context => {
  const mode = context.displayMode ?? app.getHostContext()?.displayMode ?? 'inline';
  document.documentElement.dataset.mode = mode;
  void layout.context({ ...context, displayMode: mode }).catch(error => { status.textContent = error.message; });
  if (mode !== lastMode) { lastMode = mode; void signal('native-display-mode', JSON.stringify({ mode, viewport: innerHeight, document: document.documentElement.scrollHeight, container: context.containerDimensions })); }
  tasks.hidden=mode!=='fullscreen';
  if(mode!=='fullscreen'&&entryTask){currentTask=entryTask;selected=entryTask.agent_id;selectedCall=entryTask.observation?.call_id;}
  if(currentTask)void present(currentTask);
  if(mode==='fullscreen'&&anchor)void rawCall('native_tasks',{agent_id:anchor}).then(data=>{
    for(const task of data.items??[]){let option=[...tasks.options].find(item=>item.value===task.agent_id);if(!option){option=document.createElement('option');option.value=task.agent_id;tasks.appendChild(option);}option.textContent=taskIdentity(task);}
  }).catch(()=>{});
  // Stable native root: no teardown or remount on a display-mode notification.
};
window.addEventListener('resize', () => { void layout.context({ displayMode: layout.mode, containerDimensions: { height: innerHeight } }); });
window.addEventListener('error', event => { void signal('error', event.message); });
window.addEventListener('unhandledrejection', event => { void signal('rejection', event.reason?.message ?? event.reason); });
app.onteardown = async () => { clearInterval(timer); await controller.dispose(); return {}; };
await app.connect();
await layout.context(app.getHostContext());
void signal('native-card-connected', `task-v14; ${crypto.randomUUID()}; autoResize=false; closeExtension=${typeof globalThis.openai?.requestClose === 'function'}`);
await installNativeFonts(globalThis.__DSH_NATIVE_FONTS__ ?? []);
delete globalThis.__DSH_NATIVE_FONTS__;
timer = setInterval(async () => {
  if (!selected || polling || document.hidden || (layout.mode!=='fullscreen'&&(currentTask?.observation?.frozen||currentTask?.role!=='sub'))) return;
  polling = true;
  try { const state = await rawCall('native_state', { agent_id: selected,...(selectedCall?{call_id:selectedCall}:{}) }); if (state.agent_id === selected && (!selectedCall||state.observation?.call_id===selectedCall)) { if(state.agent_id===entryTask?.agent_id&&state.observation?.call_id===entryTask?.observation?.call_id)entryTask=state;await present(state); } }
  catch (error) { status.textContent = `${globalThis.navigator?.onLine===false?'本机报告网络离线':'读取任务状态失败'}（未确认执行中止）：${error.message}`; }
  finally { polling = false; }
}, 5000);
