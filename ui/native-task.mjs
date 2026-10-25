import { App } from '@modelcontextprotocol/ext-apps';
import { AppWebEntry } from '@deepseek-ai/dsh-client-web';
import { createNativeMcpRpc } from './native-mcp-rpc.mjs';
import { createNativeTaskController } from './native-task-controller.mjs';
import { registerSessionTarget } from './native-session-target.mjs';
import { splitNativeFonts, installNativeFonts } from './native-fonts.mjs';
import { createNativeTaskLayout } from './native-task-layout.mjs';
import { createNativeDisplayMode, registerNativePresentation } from './native-presentation.mjs';

const app = new App({ name: 'DSH native task', version: '1' }, { availableDisplayModes: ['inline', 'fullscreen'] }, { autoResize: false });
const root = document.getElementById('root'), status = document.getElementById('state'), tasks = document.getElementById('tasks');
const rawCall = async (name, args = {}) => {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? 'Native view request failed');
  return result._meta?.payload;
};
const signal = (event, detail = '') => rawCall('native_ui_signal', { event, detail: String(detail).slice(0, 1000) }).catch(() => {});
const decode = async encoded => new Response(new Blob([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
const execute = code => { const el = document.createElement('script'); el.textContent = code; document.head.appendChild(el); el.remove(); };
const css = document.createElement('style'); document.head.appendChild(css);
let selected, polling = false, timer;
let lastMode;
const nativeMode = createNativeDisplayMode();
const layout = createNativeTaskLayout({ app, doc: document, root,
  persist: (agent_id, collapsed) => rawCall('native_presentation', { agent_id, collapsed }),
  changed: ({ mode, collapsed }) => {
    nativeMode.set(mode);
    document.getElementById('flow').hidden = mode === 'fullscreen';
    document.getElementById('flow').textContent = collapsed ? '▾ 在对话内展开' : '▴ 收起对话内视图';
    document.getElementById('flow').setAttribute('aria-expanded', String(!collapsed));
    document.getElementById('flow').setAttribute('aria-controls', 'root');
    document.getElementById('expand').textContent = mode === 'fullscreen' ? '关闭侧边视图' : '▥ 在侧边查看';
    document.getElementById('expand').title = mode === 'fullscreen' ? '返回对话，保持对话内视图收起' : '请求 Codex 在侧边区域打开原生 DSH';
  },
});
const controller = createNativeTaskController({ call: rawCall,
  waiting(task) { selected = task.agent_id; layout.task(selected, task.presentation); root.style.visibility = 'hidden'; status.textContent = task.nativeViewAvailable === false && !['starting','running'].includes(task.status) ? '原生运行时已释放，续接后恢复' : '正在连接原生会话…'; },
  failed(error) { status.textContent = error.message; void signal('native-view-failed', error.message); },
  async mount({ viewId, task, bootstrap }) {
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
        if (['/codex-session-target.js', '/codex-native-presentation.js'].includes(new URL(url, location.href).pathname)) return;
        const { code } = await call('native_asset', { path: url }); execute(code);
      },
    };
    const target = () => task.session_id;
    registerSessionTarget({ loader: globalThis.__ModuleLoader__, boot: globalThis.__DSH_BOOT__, readTarget: target,
      onNavigate: value => { void signal('native-session-selected', JSON.stringify(value)); } });
    registerNativePresentation({ loader: globalThis.__ModuleLoader__, boot: globalThis.__DSH_BOOT__, mode: nativeMode });
    const entry = new AppWebEntry(root);
    try { await entry.run(error => { throw error; }); }
    catch (error) { rpc.dispose(); await entry.dispose(); throw error; }
    root.style.visibility = 'visible'; status.textContent = `${task.name || 'DSH'} · ${task.role === 'sub' ? '派生任务' : '协作工作区'} · ${task.status}`;
    layout.restore(task.presentation); layout.mounted();
    void signal('native-view-mounted', task.session_id);
    return { async dispose() { try { await entry.dispose(); } finally { rpc.dispose(); } } };
  },
});

function receive(data) {
  if (!data) return;
  const items = data.items ?? (data.agent_id ? [data] : []);
  for (const task of items) {
    if (!task.agent_id || task.backend === 'worker') continue;
    let option = [...tasks.options].find(item => item.value === task.agent_id);
    if (!option) { option = document.createElement('option'); option.value = task.agent_id; tasks.appendChild(option); }
    option.textContent = `${task.name || task.agent_id.slice(0, 8)} · ${task.role === 'sub' ? '派生任务' : '协作工作区'}`;
  }
  const task = data.agent_id ? data : items.find(item => item.agent_id === selected) ?? items.at(-1);
  if (task?.agent_id && task.backend !== 'worker') { tasks.value = task.agent_id; void controller.select(task); }
}
app.ontoolresult = result => receive(result.structuredContent);
tasks.addEventListener('change', () => { void controller.select({ agent_id: tasks.value }); });
document.getElementById('retry').addEventListener('click', () => { void controller.select({ agent_id: selected }, { force: true }); });
app.onhostcontextchanged = context => {
  const mode = context.displayMode ?? app.getHostContext()?.displayMode ?? 'inline';
  document.documentElement.dataset.mode = mode;
  void layout.context({ ...context, displayMode: mode }).catch(error => { status.textContent = error.message; });
  if (mode !== lastMode) { lastMode = mode; void signal('native-display-mode', JSON.stringify({ mode, viewport: innerHeight, document: document.documentElement.scrollHeight, container: context.containerDimensions })); }
  // Stable native root: no teardown or remount on a display-mode notification.
};
window.addEventListener('resize', () => { void layout.context({ displayMode: layout.mode, containerDimensions: { height: innerHeight } }); });
document.getElementById('expand').addEventListener('click', () => {
  const mode = layout.mode === 'fullscreen' ? 'inline' : 'fullscreen';
  void (async () => {
    // Collapse the inline source BEFORE a host creates a fullscreen copy.
    await layout.setCollapsed(true);
    const actual = await app.requestDisplayMode({ mode });
    await layout.context({ displayMode: actual.mode });
  })().catch(error => { status.textContent = error.message; });
});
document.getElementById('flow').addEventListener('click', () => { void layout.setCollapsed(!layout.collapsed).catch(error => { status.textContent = error.message; }); });
window.addEventListener('error', event => { void signal('error', event.message); });
window.addEventListener('unhandledrejection', event => { void signal('rejection', event.reason?.message ?? event.reason); });
app.onteardown = async () => { clearInterval(timer); await controller.dispose(); return {}; };
await app.connect();
await layout.context(app.getHostContext());
void signal('native-card-connected', `task-v5; ${crypto.randomUUID()}; autoResize=false`);
await installNativeFonts(globalThis.__DSH_NATIVE_FONTS__ ?? []);
delete globalThis.__DSH_NATIVE_FONTS__;
timer = setInterval(async () => {
  if (!selected || polling || document.hidden) return;
  polling = true;
  try { const state = await rawCall('native_state', { agent_id: selected }); if (state.agent_id === selected) { layout.restore(state.presentation); await controller.select(state); } }
  catch (error) { status.textContent = error.message; }
  finally { polling = false; }
}, 5000);
