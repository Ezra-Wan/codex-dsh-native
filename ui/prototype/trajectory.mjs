// Chat-form renderer following the native conversation view: right-aligned
// user bubbles, a ChatGroupSeat-style process group (activity icon that swaps
// to a chevron, processTitle summary, member rows without hairlines), and
// markdown-rendered assistant text. Tail-follow logic is unchanged.
import { buildLedger, toolTitle } from './records.mjs';
import { icon } from './icons.mjs';
import { renderMarkdown } from './markdown.bundle.mjs';

const clock = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const REASON_LABELS = { completed: '已完成', aborted: '已中止', interrupted: '已中断', 'max-tokens': '达到输出上限' };
// PROCESS_ICONS mapping from ChatGroupSeat.tsx; zh labels observed in the
// native app (the acceptance reference).
const TOOLS = {
  read: { icon: 'browse', label: '读取', done: '已读取文件' },
  write: { icon: 'edit', label: '写入', done: '已写入文件' },
  edit: { icon: 'edit', label: '修改', done: '修改了文件' },
  pwsh: { icon: 'api', label: '运行命令', done: '执行了命令' },
};
const CONTEXT_KINDS = { 'runtime-context': { icon: 'contextInjection', label: '上下文' }, 'skill-catalog': { icon: 'contextInjection', label: '技能' } };
const STATE_LABELS = { error: '异常', interrupted: '已中断' };

function duration(from, to) {
  const seconds = Math.max(1, Math.round((new Date(to) - new Date(from)) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

// processTitle (step-process.ts): top categories joined; two share 并, three
// or more take the 等 suffix.
function groupTitle(tools) {
  const counts = new Map();
  for (const record of tools) {
    const done = TOOLS[record.name]?.done;
    if (done) counts.set(done, (counts.get(done) ?? 0) + 1);
  }
  const labels = [...counts.keys()];
  if (labels.length === 0) return '已注入上下文';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]}并${labels[1]}`;
  return `${labels.join('，')}等`;
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

// Member row: leading icon, label, single-line summary; expands to detail.
// No hairlines, no per-row chevron (native ChatGroupSeat members).
function memberRow({ iconName, label, summary, failed = false, open = false, dotted = false, bodies = [] }) {
  const li = document.createElement('li');
  li.className = 'process-row';
  if (failed) li.classList.add('failed');
  const details = document.createElement('details');
  if (open) details.open = true;
  const head = document.createElement('summary');
  head.className = 'row-head';
  const leading = document.createElement('span');
  leading.className = 'row-icon';
  leading.append(icon(iconName, 14));
  head.append(leading);
  const labelNode = document.createElement('span');
  labelNode.className = 'row-label';
  labelNode.textContent = label;
  head.append(labelNode);
  if (summary) {
    const text = document.createElement('span');
    text.className = 'row-summary' + (dotted ? ' dotted' : '');
    text.textContent = summary;
    head.append(text);
  }
  details.append(head);
  if (bodies.length) {
    const body = document.createElement('div');
    body.className = 'process-body';
    for (const node of bodies) body.append(node);
    details.append(body);
  }
  li.append(details);
  return li;
}

function recordNode(record) {
  const failed = record.state === 'error' || record.state === 'interrupted';
  if (record.kind === 'task' && record.sourceKind === 'user') return bubble(record);
  if (record.kind === 'message') {
    const li = document.createElement('li');
    li.className = 'assistant-row';
    li.append(renderMarkdown(record.text));
    if (record.truncated) {
      const note = document.createElement('div');
      note.className = 'truncated-note';
      note.textContent = '内容较长，仅展示前 8000 字符。';
      li.append(note);
    }
    return li;
  }
  const bodies = [];
  const summary = record.kind === 'task' ? record.text.split('\n')[0] : toolTitle(record).path ?? '';
  if (record.kind === 'task') bodies.push(codeBlock(record.text, record.truncated));
  else {
    if (record.argsText) bodies.push(codeBlock(record.argsText, record.truncated));
    if (record.result) bodies.push(codeBlock(record.result.text, record.result.truncated));
    else if (record.orphan) bodies.push(codeBlock('调用记录不在已读取范围内，仅剩结果。', false));
    if (record.interruptedAt) bodies.push(codeBlock(`已中断 · ${clock(record.interruptedAt.time)}`, false));
  }
  if (record.kind === 'task') {
    const kind = CONTEXT_KINDS[record.sourceKind] ?? { icon: 'contextInjection', label: record.sourceKind };
    return memberRow({ iconName: kind.icon, label: kind.label, summary, bodies });
  }
  const tool = TOOLS[record.name] ?? { icon: 'api', label: record.name };
  const state = failed ? `（${STATE_LABELS[record.state]}）` : '';
  return memberRow({
    iconName: tool.icon,
    label: `${tool.label}${state}`,
    summary,
    failed,
    open: failed,
    dotted: ['read', 'write', 'edit'].includes(record.name),
    bodies,
  });
}

// TurnProcessNodeView: settled duration disclosure with rotating chevron and
// a hairline under it; collapses the rest of the turn.
function statusLine(turn) {
  const label = turn.end
    ? `${REASON_LABELS[turn.end.reason] ?? turn.end.reason}，用时 ${duration(turn.records[0]?.time ?? turn.end.time, turn.end.time)}`
    : '进行中…';
  const node = document.createElement('summary');
  node.className = 'status-line';
  const text = document.createElement('span');
  text.textContent = label;
  node.append(text);
  node.append(icon('chevronDown', 14));
  return node;
}

// Native conversation order: user bubbles, the settled-duration disclosure,
// the process group (ChatGroupSeat header over context/skill/tool member
// rows), then the markdown assistant text.
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
  const rest = document.createElement('details');
  rest.className = 'turn-rest';
  rest.open = true;
  rest.append(statusLine(turn));
  const restBody = document.createElement('div');
  restBody.className = 'turn-rest-body';
  if (process.length) {
    const tools = process.filter(record => record.kind === 'tool');
    const group = document.createElement('details');
    group.className = 'process-group';
    group.open = true;
    group.append(groupHeader(groupTitle(tools)));
    const body = document.createElement('div');
    body.className = 'group-body';
    const list = document.createElement('ul');
    list.className = 'process-list';
    for (const record of process) list.append(recordNode(record));
    body.append(list);
    group.append(body);
    restBody.append(group);
  }
  for (const record of messages) restBody.append(recordNode(record));
  rest.append(restBody);
  section.append(rest);
  return section;
}

// ChatGroupSeat: activity icon swaps to a chevron on hover/expand, title is
// the processTitle summary.
function groupHeader(title) {
  const node = document.createElement('summary');
  node.className = 'group-title';
  const leading = document.createElement('span');
  leading.className = 'leading';
  const activity = document.createElement('span');
  activity.className = 'activity-icon';
  activity.append(icon('browse', 14));
  const arrow = document.createElement('span');
  arrow.className = 'swap-chevron';
  arrow.append(icon('chevronDown', 14));
  leading.append(activity, arrow);
  node.append(leading);
  const text = document.createElement('span');
  text.textContent = title;
  node.append(text);
  return node;
}

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
