// Chat-form renderer following the native conversation view: right-aligned
// user bubbles, compact hairline process rows, free-flowing assistant text,
// and a collapsible per-turn status line. Tail-follow logic is unchanged.
import { buildLedger, toolTitle } from './records.mjs';

const clock = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const REASON_LABELS = { completed: '已完成', aborted: '已中止', interrupted: '已中断', 'max-tokens': '达到输出上限' };
const TOOL_LABELS = { read: '读取', write: '写入', edit: '修改', pwsh: '运行命令' };

function duration(from, to) {
  const seconds = Math.max(1, Math.round((new Date(to) - new Date(from)) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function chevron() {
  const node = document.createElement('span');
  node.className = 'chevron';
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// One compact process row: chevron · label · summary, hairline separated.
function processRow({ label, summary, open = false, failed = false, bodies = [] }) {
  const li = document.createElement('li');
  li.className = 'process-row';
  if (failed) li.classList.add('failed');
  const details = document.createElement('details');
  if (open) details.open = true;
  const summaryRow = document.createElement('summary');
  summaryRow.className = 'process-head';
  summaryRow.append(chevron());
  const labelNode = document.createElement('span');
  labelNode.className = 'process-label';
  labelNode.textContent = label;
  summaryRow.append(labelNode);
  if (summary) {
    const text = document.createElement('span');
    text.className = 'process-summary';
    text.textContent = summary;
    summaryRow.append(text);
  }
  details.append(summaryRow);
  if (bodies.length) {
    const body = document.createElement('div');
    body.className = 'process-body';
    for (const node of bodies) body.append(node);
    details.append(body);
  }
  li.append(details);
  return li;
}

function codeBlock(text, truncated) {
  const node = document.createElement('pre');
  node.textContent = text + (truncated ? '\n…' : '');
  return node;
}

function bubble(record) {
  const li = document.createElement('li');
  li.className = 'user-row';
  const node = document.createElement('div');
  node.className = 'bubble';
  node.textContent = record.text;
  li.append(node);
  return li;
}

function prose(record) {
  const li = document.createElement('li');
  li.className = 'assistant-row';
  const node = document.createElement('div');
  node.className = 'prose';
  node.textContent = record.text;
  li.append(node);
  if (record.truncated) {
    const note = document.createElement('div');
    note.className = 'truncated-note';
    note.textContent = '内容较长，仅展示前 8000 字符。';
    li.append(note);
  }
  return li;
}

function recordNode(record) {
  const failed = record.state === 'error' || record.state === 'interrupted';
  if (record.kind === 'task' && record.sourceKind === 'user') return bubble(record);
  if (record.kind === 'message') return prose(record);
  if (record.kind === 'task') {
    return processRow({
      label: record.sourceKind === 'skill-catalog' ? '技能' : '上下文',
      summary: record.text.split('\n')[0],
      bodies: [codeBlock(record.text, record.truncated)],
    });
  }
  const { label, path } = toolTitle(record);
  const bodies = [];
  if (record.argsText) bodies.push(codeBlock(record.argsText, record.truncated));
  if (record.result) bodies.push(codeBlock(record.result.text, record.result.truncated));
  else if (record.orphan) bodies.push(codeBlock('调用记录不在已读取范围内，仅剩结果。', false));
  if (record.interruptedAt) bodies.push(codeBlock(`已中断 · ${clock(record.interruptedAt.time)}`, false));
  return processRow({
    label: failed ? `${TOOL_LABELS[record.name] ?? record.name}（${record.state === 'interrupted' ? '已中断' : '异常'}）` : TOOL_LABELS[record.name] ?? record.name,
    summary: path ?? '',
    open: failed,
    failed,
    bodies,
  });
}

function statusLine(turn) {
  const label = turn.end
    ? `${REASON_LABELS[turn.end.reason] ?? turn.end.reason}，用时 ${duration(turn.records[0]?.time ?? turn.end.time, turn.end.time)}`
    : '进行中…';
  const node = document.createElement('summary');
  node.className = 'status-line';
  node.append(chevron());
  const text = document.createElement('span');
  text.textContent = label;
  node.append(text);
  return node;
}

// Native conversation order: user bubbles, then the collapsible process
// group (context, skills, tools), then the assistant text.
function renderTurn(turn) {
  const section = document.createElement('li');
  section.className = 'turn';
  const bubbles = [];
  const process = [];
  const messages = [];
  for (const record of turn.records) {
    if (record.kind === 'task' && record.sourceKind === 'user') bubbles.push(record);
    else if (record.kind === 'message') messages.push(record);
    else process.push(record);
  }
  const head = document.createElement('div');
  head.className = 'user-stack';
  for (const record of bubbles) head.append(bubble(record));
  if (head.children.length) section.append(head);
  if (process.length) {
    const group = document.createElement('details');
    group.className = 'process-group';
    group.open = true;
    group.append(statusLine(turn));
    const list = document.createElement('ul');
    list.className = 'process-list';
    for (const record of process) list.append(recordNode(record));
    group.append(list);
    section.append(group);
  }
  for (const record of messages) section.append(recordNode(record));
  return section;
}

// Full render per replay batch; fixture sizes are small and this mirrors the
// production loop (cursor page -> re-render), keeping follow logic honest.
// Tail following suspends on user intent only (wheel up, page-up keys, upward
// scrollbar drag) — never on layout-driven position changes like reflow.
export function mountLedger(container, { followButton }) {
  let following = true;
  let lastTailWrite = 0;
  let lastPosition = container.scrollTop;
  const distanceToTail = () => container.scrollHeight - container.scrollTop - container.clientHeight;
  const onScroll = () => {
    const upward = container.scrollTop < lastPosition - 1;
    lastPosition = container.scrollTop;
    const programmatic = Date.now() - lastTailWrite < 200;
    if (distanceToTail() < 24) setFollowing(true);
    else if (upward && !programmatic) setFollowing(false);
  };
  container.addEventListener('scroll', onScroll, { passive: true });
  container.addEventListener('wheel', event => { if (event.deltaY < 0) setFollowing(false); }, { passive: true });
  container.addEventListener('keydown', event => { if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) setFollowing(false); });
  function setFollowing(value) {
    following = value;
    followButton.classList.toggle('hidden', value);
    if (value) container.scrollTop = container.scrollHeight;
  }
  followButton.addEventListener('click', () => setFollowing(true));
  return {
    get following() { return following; },
    render(events) {
      const ledger = buildLedger(events);
      const fragment = document.createDocumentFragment();
      for (const turn of ledger.turns) fragment.append(renderTurn(turn));
      container.replaceChildren(fragment);
      if (following) {
        lastTailWrite = Date.now();
        container.scrollTop = container.scrollHeight;
      }
      return ledger;
    },
  };
}
