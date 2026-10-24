// Observer card: a CONTAINER adapter for the official DSH web UI.
//
// Per the 2026-10-24 acceptance review, the main display path must carry the
// official implementation, not a re-implementation. This card therefore:
// - embeds the official web UI (native-replay adapter URL) in an iframe;
// - falls back to a minimal task-status list when embedding is unavailable;
// - polls only light status (ds_wait with timeout 0) for the badge; all
//   conversation rendering belongs to the embedded official app.
import { App } from '@modelcontextprotocol/ext-apps';

const $ = id => document.getElementById(id);
const app = new App({ name: 'DSH observer container', version: '0.2.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
const LABELS = { starting: '启动中', running: '运行中', stopping: '停止中', completed: '已完成', completed_with_warnings: '完成·有异常', failed: '失败', interrupted: '已中断' };

const parse = result => {
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '请求失败');
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
};
const call = async (name, args = {}) => parse(await app.callServerTool({ name, arguments: args }));

let selected = null;
let tasks = [];

function renderFallback(message) {
  $('frame').style.display = 'none';
  $('fallback').style.display = 'block';
  if (message) { $('notice').style.display = 'block'; $('notice').textContent = message; }
  const rows = $('rows');
  rows.replaceChildren();
  const heading = $('fallback').querySelector('.hint');
  if (heading) heading.textContent = message ? '暂显示任务状态：' : '官方界面未运行（npm run native-replay），暂显示任务状态：';
  for (const task of tasks) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = `${task.name || task.agent_id.slice(0, 8)} · ${task.role ?? 'peer'}`;
    const state = document.createElement('span');
    state.className = 'state';
    state.textContent = LABELS[task.status] ?? task.status;
    row.append(name, state);
    rows.append(row);
  }
  if (!tasks.length) rows.replaceChildren(Object.assign(document.createElement('p'), { className: 'hint', textContent: '暂无桥接任务。' }));
}

function mountOfficial(url) {
  // Restore the embed explicitly: a later fallback must never leave the
  // frame hidden once a valid URL arrives, in either arrival order.
  $('fallback').style.display = 'none';
  $('frame').style.display = 'block';
  $('notice').style.display = 'none';
  const frame = $('frame');
  if (frame.dataset.mounted === url) return;
  frame.dataset.mounted = url;
  let loaded = false;
  frame.addEventListener('load', () => { loaded = true; }, { once: true });
  frame.src = url;
  $('open').href = url;
  setTimeout(() => {
    if (!loaded) {
      $('notice').style.display = 'block';
      $('notice').textContent = '官方界面嵌入超时（宿主可能限制 iframe）。可用右上角「新窗口打开」。';
    }
  }, 5000);
}

async function refreshSelected() {
  if (!selected) return;
  try {
    // Event-driven bounded wait: returns as soon as a fresh native event for
    // this task lands (bridge wakes waiters), at most 2s otherwise — the
    // card's minimal "text arriving before completion" signal. The embedded
    // official UI remains the full-fidelity view.
    const status = await call('ds_wait', { agent_id: selected, timeoutMs: 2000 });
    const bits = [LABELS[status.status] ?? status.status];
    if (status.children?.length) bits.push(`${status.children.length} 个子会话`);
    if (status.userTakeover) bits.push('用户接管中');
    $('state').textContent = bits.join(' · ');
    const lastText = [...(status.recentActions ?? [])].reverse().find(action => action.type === 'assistant/message' && action.text);
    if (lastText) $('state').title = lastText.text.slice(0, 120);
  } catch { /* badge keeps its last value */ }
}

async function receive(result) {
  const data = parse(result);
  const items = data.items ?? (data.agent_id ? [data] : []);
  if (items.length) {
    tasks = items;
    selected ??= items.at(-1).agent_id;
    $('tasks').replaceChildren(...items.map(item => {
      const option = document.createElement('option');
      option.value = item.agent_id;
      option.textContent = item.name || item.agent_id.slice(0, 8);
      return option;
    }));
    $('tasks').value = selected;
    void refreshSelected();
  }
  // Layout authority is the nativeReplay field ONLY: a bare task summary
  // (ds_observe / ds_wait) carries no replay state and must not flip the
  // card into fallback after the official UI has mounted.
  if ('nativeReplay' in data) {
    const replay = data.nativeReplay;
    if (replay && replay.running !== false) mountOfficial(replay.url);
    else renderFallback(replay ? '官方界面进程已退出，可重启：npm run native-replay' : null);
  }
}

app.ontoolresult = result => { void receive(result).catch(() => renderFallback('读取任务状态失败')); };
$('tasks').addEventListener('change', () => {
  selected = $('tasks').value;
  // Anchor the embed to the chosen session. The official app ignores the
  // hash today (no deep-link); once upstream supports it this switch becomes
  // "click a task, see that task" without further card changes.
  const frame = $('frame');
  if (frame.dataset.mounted && selected) frame.src = `${frame.dataset.mounted}#session=${selected}`;
  void refreshSelected();
});

try {
  await app.connect();
  const initial = await app.callServerTool({ name: 'ds_bridge', arguments: {} });
  await receive(initial);
  // Event-driven loop instead of a fixed 2s poll: each wait parks up to 2s
  // and returns early on the task's next native event.
  for (;;) {
    if (!document.hidden && selected) await refreshSelected();
    else await new Promise(resolve => setTimeout(resolve, 1000));
  }
} catch (error) {
  renderFallback(`宿主界面尚未连通：${error?.message ?? error}`);
}
