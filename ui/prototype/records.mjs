// Turn-aware ledger assembled from visible session events (the ds_events shape).
// Pure logic, no DOM: shared by the replay page and node tests. Presentation
// concepts follow @deepseek-ai/dsh-client-ui-trajectory; see NOTICE.md.

export function buildLedger(events) {
  const turns = [];
  const byCall = new Map();
  // Prompt user/message events persist before turn/start and carry no turn
  // number; they belong to the first turn they precede, not a separate group.
  let pending = [];
  const flushed = new Set();
  let tools = 0, errors = 0;
  const ensureTurn = key => {
    let turn = turns.find(item => item.turn === key);
    if (!turn) { turn = { turn: key, records: [], end: null }; turns.push(turn); }
    if (pending.length && !flushed.has(key)) { turn.records.push(...pending); pending = []; flushed.add(key); }
    return turn;
  };
  const toRecord = event => {
    const base = { seq: event.seq, time: event.time, step: event.step };
    if (event.type === 'user/message') return { ...base, kind: 'task', text: event.text ?? '', truncated: Boolean(event.truncated) };
    if (event.type === 'assistant/message') return { ...base, kind: 'message', text: event.text ?? '', truncated: Boolean(event.truncated) };
    return null;
  };
  for (const event of events) {
    const task = toRecord(event);
    if (task) {
      if (event.turn === undefined) pending.push(task);
      else ensureTurn(event.turn).records.push(task);
      continue;
    }
    const turn = ensureTurn(event.turn ?? 0);
    const base = { seq: event.seq, time: event.time, step: event.step };
    if (event.type === 'tool/call') {
      const record = { ...base, kind: 'tool', callId: event.callId, name: event.name ?? 'tool',
        argsText: event.text ?? '', truncated: Boolean(event.truncated), result: null };
      byCall.set(event.callId, record);
      turn.records.push(record);
      tools++;
    } else if (event.type === 'tool/result') {
      const result = { text: event.text ?? '', truncated: Boolean(event.truncated), isError: Boolean(event.isError) };
      const call = byCall.get(event.callId);
      if (call) call.result = result;
      // A result whose call was never read (page gap) must stay visible, not vanish.
      else turn.records.push({ ...base, kind: 'tool', callId: event.callId, name: null, orphan: true, argsText: '', truncated: false, result });
      if (result.isError) errors++;
    } else if (event.type === 'turn/end') {
      turn.end = { seq: event.seq, time: event.time, reason: event.reason ?? 'unknown' };
    }
    // turn/start contributes the turn grouping itself; nothing to render.
  }
  for (const turn of turns) {
    for (const record of turn.records) {
      if (record.kind !== 'tool') continue;
      record.state = !record.result ? 'pending' : record.result.isError ? 'error' : 'ok';
    }
  }
  return { turns, stats: { events: events.length, turns: turns.length, tools, errors } };
}

export const TOOL_LABELS = { read: '读取', write: '写入', edit: '修改', pwsh: '执行命令' };

export function toolTitle(record) {
  if (record.orphan) return { label: '工具结果（未配对）', path: null };
  let path = null;
  try { const args = JSON.parse(record.argsText); path = args?.path ?? args?.file_path ?? args?.filePath ?? null; }
  catch { /* Non-JSON arguments keep the raw tool name. */ }
  return { label: TOOL_LABELS[record.name] ?? record.name, path };
}
