import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
const $ = id => document.getElementById(id);
const app = new App({ name: 'DSH execution observer', version: '0.1.0' }, { availableDisplayModes: ['inline', 'fullscreen'] });
const labels = { starting: '启动中', running: '运行中', stopping: '停止中', completed: '已完成', completed_with_warnings: '完成 · 有异常', failed: '失败', interrupted: '已中断' };
let selected, cursor = -1, task, busy = false, hasMore = false;
let connected = false, pendingResult, generation = 0, mutating = false, refreshAgain = false;
const seen = new Map();
const callNames = new Map();
const parse = result => {
  if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '请求失败');
  return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
};
const call = async (name, args = {}) => parse(await app.callServerTool({ name, arguments: args }));
function showError(error) { $('error').textContent = error?.message ?? String(error); }
function applyContext(context) {
  if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context?.theme) document.documentElement.style.colorScheme = context.theme;
}
function setTask(record) {
  task = record;
  $('title').textContent = record.name || 'DSH 任务';
  $('subtitle').textContent = `${record.model} · ${record.mode} · 第 ${record.turn} 轮`;
  const active = ['starting', 'running', 'stopping'].includes(record.status);
  $('stop').disabled = !active || mutating;
  $('send').disabled = active || mutating;
  $('status').textContent = labels[record.status] ?? record.status;
  const errors = [...seen.values()].filter(item => item.type === 'tool/result' && item.isError);
  const count = Math.max(errors.length, record.warnings?.length ?? 0);
  $('warning').classList.toggle('hidden', count === 0);
  if (count) {
    $('warning').textContent = `记录中有 ${count} 次工具失败。请展开橙色条目查看；最终返回答案不代表执行过程没有异常。`;
    if (record.status === 'completed') $('status').textContent = labels.completed_with_warnings;
  }
  if (record.error) $('error').textContent = record.error;
}
function renderEvents(events) {
  for (const event of events) {
    if (seen.has(event.seq)) continue;
    seen.set(event.seq, event);
    if (event.type === 'tool/call') callNames.set(event.callId, event.name);
    const li = document.createElement('li');
    li.className = `event${event.isError ? ' failed' : ''}`;
    const details = document.createElement('details');
    details.open = Boolean(event.isError || event.type === 'assistant/message');
    const summary = document.createElement('summary');
    const time = document.createElement('span'); time.className = 'time';
    time.textContent = new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false });
    const title = document.createElement('span'); title.className = 'label';
    const kind = document.createElement('span'); kind.className = 'kind';
    if (event.type === 'tool/call') {
      let args; try { args = JSON.parse(event.text); } catch { /* Keep the original tool name for non-JSON arguments. */ }
      const path = args?.path ?? args?.file_path ?? args?.filePath;
      title.textContent = `${({ read: '读取', write: '写入', edit: '修改', pwsh: '执行命令' })[event.name] ?? event.name}${path ? ` · ${path}` : ''}`;
      kind.textContent = '调用';
    }
    else if (event.type === 'tool/result') { title.textContent = `${callNames.get(event.callId) ?? '工具'}${event.isError ? '执行失败' : '返回结果'}`; kind.textContent = event.isError ? '异常' : '结果'; }
    else if (event.type === 'assistant/message') { title.textContent = 'DS 回复'; kind.textContent = '消息'; }
    else if (event.type === 'user/message') { title.textContent = '收到任务'; kind.textContent = '输入'; }
    else { title.textContent = event.type === 'turn/start' ? '开始工作' : `本轮结束 · ${event.reason}`; kind.textContent = '状态'; }
    summary.append(time, title, kind); details.append(summary);
    if (event.text) {
      const content = document.createElement(event.type.includes('tool/') ? 'pre' : 'div');
      content.className = event.type.includes('tool/') ? '' : 'message';
      content.textContent = event.text + (event.truncated ? '\n…内容较长，此处仅展示前段。' : '');
      details.append(content);
    }
    li.append(details); $('events').append(li);
  }
  $('empty').classList.toggle('hidden', seen.size > 0);
  if (seen.size === 0) $('empty').textContent = '任务已登记，等待原生日志产生事件。';
  if (task) setTask(task);
}
async function refresh() {
  if (!connected || !selected) return;
  if (busy || mutating) { refreshAgain = true; return; }
  const version = generation, id = selected;
  busy = true; $('refresh').disabled = true; $('error').textContent = '';
  try {
    const status = await call('ds_wait', { agent_id: id, timeoutMs: 0 });
    if (version !== generation) return;
    setTask(status);
    const page = await call('ds_events', { agent_id: id, after_seq: cursor, limit: 30 });
    if (version !== generation) return;
    renderEvents(page.events); cursor = page.cursor; hasMore = page.hasMore;
    $('more').classList.toggle('hidden', !hasMore);
  } catch (error) { if (version === generation) showError(error); }
  finally {
    busy = false; $('refresh').disabled = false;
    if (version !== generation || refreshAgain) { refreshAgain = false; void refresh(); }
  }
}
async function select(id) {
  generation++; selected = id; cursor = -1; task = null; hasMore = false;
  seen.clear(); callNames.clear(); $('events').replaceChildren();
  $('title').textContent = '读取任务'; $('subtitle').textContent = '';
  $('status').textContent = '读取中'; $('stop').disabled = true; $('send').disabled = true;
  $('warning').classList.add('hidden'); $('more').classList.add('hidden');
  $('empty').classList.remove('hidden'); $('empty').textContent = '读取原生执行记录…';
  $('tasks').value = id;
  await refresh();
}
async function receive(result) {
  const data = parse(result);
  const items = data.items ?? (data.agent_id ? [data] : []);
  if (items.length) {
    const old = selected;
    $('tasks').replaceChildren(...items.map(item => { const option = document.createElement('option'); option.value = item.agent_id; option.textContent = item.name || item.agent_id.slice(0,8); return option; }));
    await select(items.some(item => item.agent_id === old) ? old : items.at(-1).agent_id);
  } else { $('title').textContent = '没有桥接任务'; $('empty').textContent = '发起 DS 任务后，执行记录会出现在这里。'; }
}
app.ontoolresult = result => {
  if (!connected) pendingResult = result;
  else void receive(result).catch(showError);
};
app.onhostcontextchanged = applyContext;
$('tasks').addEventListener('change', () => { void select($('tasks').value); });
$('refresh').addEventListener('click', refresh);
$('more').addEventListener('click', refresh);
async function mutate(name, args) {
  if (mutating || !selected) return;
  const id = selected, version = ++generation;
  mutating = true; $('tasks').disabled = true;
  if (task) setTask(task);
  try {
    const record = await call(name, { agent_id: id, ...args });
    if (version === generation) {
      setTask(record);
      if (name === 'ds_followup') $('prompt').value = '';
    }
  } catch (error) { if (version === generation) showError(error); }
  finally {
    mutating = false; $('tasks').disabled = false;
    if (task) setTask(task);
    void refresh();
  }
}
$('stop').addEventListener('click', () => { void mutate('ds_stop', {}); });
$('send').addEventListener('click', async () => {
  const prompt = $('prompt').value.trim(); if (!prompt || !selected) return;
  await mutate('ds_followup', { task: prompt });
});
try {
  await app.connect(); connected = true; applyContext(app.getHostContext());
  // Opening a conversation entrypoint can happen without a model invocation.
  if (pendingResult) { await receive(pendingResult); pendingResult = undefined; }
  else {
    const initial = await app.callServerTool({ name: 'ds_bridge', arguments: {} });
    if (!selected) await receive(initial);
  }
  setInterval(() => {
    if ($('auto').checked && !document.hidden && (hasMore || ['starting','running','stopping'].includes(task?.status))) void refresh();
  }, 2000);
} catch (error) {
  $('title').textContent = '宿主界面尚未连通'; $('status').textContent = '未验证';
  showError(error); $('empty').textContent = '这不是任务执行失败。当前页面没有完成 MCP 界面握手。';
}
