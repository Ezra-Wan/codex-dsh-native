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
  const frame = $('frame');
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
    const status = await call('ds_wait', { agent_id: selected, timeoutMs: 0 });
    const bits = [LABELS[status.status] ?? status.status];
    if (status.children?.length) bits.push(`${status.children.length} 个子会话`);
    if (status.userTakeover) bits.push('用户接管中');
    $('state').textContent = bits.join(' · ');
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
  const replay = data.nativeReplay;
  if (replay && replay.running !== false) mountOfficial(replay.url);
  else renderFallback(replay ? '官方界面进程已退出，可重启：npm run native-replay' : null);
}

app.ontoolresult = result => { void receive(result).catch(() => renderFallback('读取任务状态失败')); };
$('tasks').addEventListener('change', () => { selected = $('tasks').value; void refreshSelected(); });

try {
  await app.connect();
  const initial = await app.callServerTool({ name: 'ds_bridge', arguments: {} });
  await receive(initial);
  setInterval(() => {
    if (!document.hidden && $('fallback').style.display !== 'block') void refreshSelected();
  }, 2000);
} catch (error) {
  renderFallback(`宿主界面尚未连通：${error?.message ?? error}`);
}
