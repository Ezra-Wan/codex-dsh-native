// Minimal ledger renderer: native-style turn grouping, paired tool records,
// error retention and tail following, on the existing card's CSS variables.
import { buildLedger, taskTitle, toolTitle } from './records.mjs';

const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const REASON_LABELS = { completed: '已完成', aborted: '已中止', interrupted: '已中断', 'max-tokens': '达到输出上限' };
// Record-kind tags mirror the native ledger palette: user green, context muted
// green, assistant brand blue, tool amber, failures red.
const TAGS = {
  task: { cls: 'tagUser', label: '用户' },
  context: { cls: 'tagContext', label: '上下文' },
  skill: { cls: 'tagContext', label: '技能' },
  message: { cls: 'tagMessage', label: '回复' },
  tool: { cls: 'tagTool', label: '工具' },
};
const STATE_LABELS = { ok: '结果', error: '异常', pending: '进行中', interrupted: '已中断' };

function detailBlock(text, truncated, mono) {
  const node = document.createElement('pre');
  if (mono) node.className = 'mono';
  node.textContent = text + (truncated ? '\n…' : '');
  return node;
}

function renderRecord(record, index) {
  const li = document.createElement('li');
  const failed = record.state === 'error' || record.state === 'interrupted';
  li.className = 'record';
  li.dataset.kind = record.kind;
  li.dataset.state = record.state ?? '';
  const details = document.createElement('details');
  details.open = failed || record.kind !== 'tool';
  const summary = document.createElement('summary');
  summary.className = 'row';
  const idx = document.createElement('span');
  idx.className = 'idx';
  idx.textContent = `#${index}`;
  const tag = document.createElement('span');
  let tagKey = record.kind;
  if (record.kind === 'task') tagKey = record.sourceKind === 'user' ? 'task' : record.sourceKind === 'skill-catalog' ? 'skill' : 'context';
  if (failed) { tag.className = 'tag tagError'; tag.textContent = STATE_LABELS[record.state]; }
  else { tag.className = `tag ${TAGS[tagKey].cls}`; tag.textContent = TAGS[tagKey].label; }
  const text = document.createElement('span');
  text.className = 'cell-text';
  if (record.kind === 'tool') {
    const { label, path } = toolTitle(record);
    text.textContent = path ? `${label} · ${path}` : label;
  } else if (record.kind === 'message') {
    text.textContent = record.text.split('\n')[0] || '（空回复）';
  } else {
    text.textContent = record.text.split('\n')[0] || taskTitle(record);
  }
  const trailing = document.createElement('span');
  trailing.className = 'trailing';
  const stamp = document.createElement('span');
  stamp.className = 'time';
  stamp.textContent = time(record.time);
  trailing.append(stamp);
  summary.append(idx, tag, text, trailing);
  details.append(summary);
  const body = document.createElement('div');
  body.className = 'detail';
  if (record.kind === 'tool') {
    if (record.argsText) body.append(detailBlock(record.argsText, record.truncated, true));
    if (record.result) body.append(detailBlock(record.result.text, record.result.truncated, true));
    else if (record.orphan) body.append(detailBlock('调用记录不在已读取范围内，仅剩结果。', false, true));
  } else {
    const prose = document.createElement('div');
    prose.className = 'prose';
    prose.textContent = record.text;
    body.append(prose);
    if (record.truncated) {
      const note = document.createElement('div');
      note.className = 'truncated-note';
      note.textContent = '内容较长，仅展示前 8000 字符。';
      body.append(note);
    }
  }
  details.append(body);
  li.append(details);
  return li;
}

function renderTurn(turn, startIndex) {
  const section = document.createElement('li');
  section.className = 'turn';
  const head = document.createElement('div');
  head.className = 'turn-head';
  const inner = document.createElement('div');
  inner.className = 'turn-inner';
  const title = document.createElement('span');
  title.className = 'turn-title';
  title.textContent = turn.turn === 0 ? '准备' : `回合 ${turn.turn}`;
  inner.append(title);
  if (turn.end) {
    const badge = document.createElement('span');
    badge.className = 'turn-reason';
    badge.textContent = REASON_LABELS[turn.end.reason] ?? turn.end.reason;
    inner.append(badge);
  }
  head.append(inner);
  const list = document.createElement('ul');
  list.className = 'records';
  let index = startIndex;
  for (const record of turn.records) list.append(renderRecord(record, ++index));
  section.append(head, list);
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
      let index = 0;
      for (const turn of ledger.turns) {
        fragment.append(renderTurn(turn, index));
        index += turn.records.length;
      }
      container.replaceChildren(fragment);
      if (following) {
        lastTailWrite = Date.now();
        container.scrollTop = container.scrollHeight;
      }
      return ledger;
    },
  };
}
