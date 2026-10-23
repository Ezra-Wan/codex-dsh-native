// Minimal ledger renderer: native-style turn grouping, paired tool records,
// error retention and tail following, on the existing card's CSS variables.
import { buildLedger, toolTitle } from './records.mjs';

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

// Event times are numeric epoch ms from the persistence log; accept strings too.
const ts = value => (typeof value === 'number' ? value : Date.parse(value));

function renderRecord(record, index, endAt, turnNumber) {
  const li = document.createElement('li');
  const failed = record.state === 'error' || record.state === 'interrupted';
  li.className = 'record';
  li.dataset.kind = record.kind;
  li.dataset.state = record.state ?? '';
  li.dataset.search = `${record.name ?? ''} ${record.text ?? ''} ${record.argsText ?? ''} ${record.result?.text ?? ''}`.toLowerCase();
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
    text.textContent = record.text.split('\n')[0]
      || (record.sourceKind === 'user' ? '收到任务' : record.sourceKind === 'skill-catalog' ? '技能目录' : '上下文注入');
  }
  // Trailing metrics per toolbar mode: 时长 / 轮次 / 调用.
  const trailing = document.createElement('span');
  trailing.className = 'trailing';
  const metric = (key, value) => {
    const el = document.createElement('span');
    el.className = 'metric';
    el.dataset.metric = key;
    el.textContent = value;
    return el;
  };
  const seconds = Math.max(1, Math.round((ts(endAt ?? record.time) - ts(record.time)) / 100) / 10);
  trailing.append(
    metric('duration', `${seconds}s`),
    metric('turn', `回合 ${turnNumber ?? record.turn ?? 0}`),
    metric('call', `#${index}`),
    metric('clock', time(record.time)),
  );
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

function renderTurn(turn, startIndex, nextTime) {
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
    badge.textContent = `本轮结束 · ${turn.end.reason}`;
    inner.append(badge);
  }
  head.append(inner);
  const list = document.createElement('ul');
  list.className = 'records';
  let index = startIndex;
  const times = turn.records.map(record => record.time);
  for (let i = 0; i < turn.records.length; i++) {
    const endAt = times[i + 1] ?? turn.end?.time ?? nextTime ?? times[i];
    const li = renderRecord(turn.records[i], ++index, endAt, turn.turn);
    list.append(li);
  }
  section.append(head, list);
  return section;
}

// Timing overview (TrajectoryTimeline): three fixed lanes 输入/模型/工具,
// spans positioned proportionally across the turn's real time range.
function timelineBar(turns) {
  const flat = [];
  for (const turn of turns) {
    const times = turn.records.map(record => record.time);
    for (let i = 0; i < turn.records.length; i++) {
      const record = turn.records[i];
      const endAt = times[i + 1] ?? turn.end?.time ?? record.time;
      flat.push({ record, start: ts(record.time), end: ts(endAt) });
    }
  }
  if (!flat.length) return null;
  const t0 = Math.min(...flat.map(item => item.start));
  const t1 = Math.max(...flat.map(item => item.end));
  const span = Math.max(1, t1 - t0);
  const root = document.createElement('div');
  root.className = 'timeline';
  const plot = document.createElement('div');
  plot.className = 'timeline-plot';
  const labels = document.createElement('div');
  labels.className = 'timeline-labels';
  for (const name of ['输入', '模型', '工具']) {
    const el = document.createElement('span');
    el.textContent = name;
    labels.append(el);
  }
  const track = document.createElement('div');
  track.className = 'timeline-track';
  for (const { record, start, end } of flat) {
    const spanEl = document.createElement('span');
    const kind = record.kind === 'tool' ? 'tool' : record.kind === 'message' ? 'message' : record.sourceKind === 'user' ? 'user' : 'context';
    spanEl.className = 'timeline-span';
    spanEl.dataset.timelineSpan = kind;
    if (record.state === 'error' || record.state === 'interrupted') spanEl.dataset.error = 'true';
    const left = ((start - t0) / span) * 100;
    spanEl.style.left = `${left.toFixed(2)}%`;
    spanEl.style.width = `${Math.max(0.6, ((end - start) / span) * 100).toFixed(2)}%`;
    spanEl.style.top = `${LANE[kind] * 14 + 4}px`;
    spanEl.title = `${record.kind === 'tool' ? toolTitle(record).label : record.kind === 'message' ? 'DS 回复' : '输入'} · ${Math.max(1, Math.round((end - start) / 100) / 10)}s`;
    track.append(spanEl);
  }
  plot.append(labels, track);
  root.append(plot);
  return root;
}

const LANE = { user: 0, context: 0, message: 1, tool: 2 };

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
      const bar = timelineBar(ledger.turns);
      if (bar) fragment.append(bar);
      let index = 0;
      for (let i = 0; i < ledger.turns.length; i++) {
        const turn = ledger.turns[i];
        const nextTime = ledger.turns[i + 1]?.records[0]?.time;
        fragment.append(renderTurn(turn, index, nextTime));
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
