// Minimal ledger renderer: native-style turn grouping, paired tool records,
// error retention and tail following, on the existing card's CSS variables.
import { buildLedger, toolTitle } from './records.mjs';

const time = value => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const STATE_LABELS = { ok: '结果', error: '异常', pending: '等待结果' };

function pre(text, truncated, extraClass = '') {
  const node = document.createElement('pre');
  if (extraClass) node.className = extraClass;
  node.textContent = text + (truncated ? '\n…内容较长，仅展示前段。' : '');
  return node;
}

function renderRecord(record) {
  const li = document.createElement('li');
  li.className = `record ${record.kind}${record.state === 'error' ? ' failed' : ''}${record.state === 'pending' ? ' waiting' : ''}`;
  const details = document.createElement('details');
  const openByDefault = record.kind !== 'tool' || record.state === 'error';
  if (openByDefault) details.open = true;
  const summary = document.createElement('summary');
  const stamp = document.createElement('span');
  stamp.className = 'time';
  stamp.textContent = time(record.time);
  const title = document.createElement('span');
  title.className = 'label';
  const chip = document.createElement('span');
  chip.className = 'chip';
  if (record.kind === 'task') {
    title.textContent = '收到任务';
    chip.textContent = '输入';
  } else if (record.kind === 'message') {
    title.textContent = 'DS 回复';
    chip.textContent = '消息';
  } else {
    const { label, path } = toolTitle(record);
    title.textContent = path ? `${label} · ${path}` : label;
    chip.textContent = STATE_LABELS[record.state];
    if (record.state === 'pending') li.classList.add('waiting');
  }
  summary.append(stamp, title, chip);
  details.append(summary);
  if (record.kind === 'tool') {
    if (record.argsText) details.append(pre(record.argsText, record.truncated, 'args'));
    if (record.result) details.append(pre(record.result.text, record.result.truncated));
    else if (record.orphan) details.append(pre('调用记录不在已读取范围内，仅剩结果。', false, 'args'));
  } else {
    const body = document.createElement('div');
    body.className = 'prose';
    body.textContent = record.text;
    details.append(body);
    if (record.truncated) {
      const note = document.createElement('div');
      note.className = 'truncated-note';
      note.textContent = '内容较长，仅展示前 8000 字符；完整内容在原生日志中。';
      details.append(note);
    }
  }
  li.append(details);
  return li;
}

function renderTurn(turn) {
  const section = document.createElement('li');
  section.className = 'turn';
  const head = document.createElement('div');
  head.className = 'turn-head';
  head.innerHTML = `<span class="turn-name">${turn.turn === 0 ? '准备' : `回合 ${turn.turn}`}</span>`;
  if (turn.end) {
    const badge = document.createElement('span');
    badge.className = `turn-badge${['completed'].includes(turn.end.reason) ? '' : ' bad'}`;
    badge.textContent = `本轮结束 · ${turn.end.reason}`;
    head.append(badge);
  }
  const list = document.createElement('ul');
  list.className = 'records';
  for (const record of turn.records) list.append(renderRecord(record));
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
