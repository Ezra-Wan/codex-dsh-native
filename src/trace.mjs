import { Context } from '@deepseek-ai/cordis';
import * as persistence from '@deepseek-ai/dsh-session-persistence-jsonl';

const ID = /^[a-f0-9-]{36}$/;
export function visibleEvent(event) {
  const base = { seq: event.seq, time: event.time, type: event.type, turn: event.data?.turn, step: event.data?.step };
  const text = value => {
    const raw = String(value ?? '');
    return { text: raw.slice(0, 8000), truncated: raw.length > 8000 };
  };
  if (event.type === 'tool/call') return { ...base, callId: event.data.callId, name: event.data.name, ...text(event.data.arguments) };
  if (event.type === 'tool/result') return {
    ...base, callId: event.data.message.toolCallId, isError: Boolean(event.data.message.isError),
    ...text(event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')),
  };
  if (event.type === 'assistant/message' || event.type === 'user/message') {
    const message = event.data.message ?? event.data;
    const content = message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? '';
    // Only visible message text. Never expose reasoning blocks or raw provider streams.
    if (!content) return null;
    // Producer identity (user / runtime-context / skill-catalog) is visible
    // metadata; the native trajectory classifies records by it.
    const sourceKind = event.type === 'user/message' ? message.source?.kind ?? null : null;
    return { ...base, ...(sourceKind ? { sourceKind } : {}), ...text(content) };
  }
  if (event.type === 'turn/start') return base;
  if (event.type === 'turn/end') return { ...base, reason: event.data.reason.kind };
  return null;
}

export async function readNativeEvents(home, sessionId, afterSeq = -1, limit = 30) {
  if (!ID.test(sessionId)) throw new Error('Invalid session_id');
  if (!Number.isInteger(afterSeq) || afterSeq < -1) throw new Error('after_seq must be >= -1');
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('limit must be 1..50');
  const ctx = new Context();
  try {
    await ctx.plugin(persistence, { root: `${home}/sessions` });
    const handle = await ctx.sessionPersistence.open(sessionId, 'read');
    try {
      const { events: raw } = await handle.read(afterSeq + 1, 256);
      const events = [];
      let cursor = afterSeq;
      for (const entry of raw) {
        cursor = entry.seq;
        const view = visibleEvent(entry);
        if (view) events.push(view);
        if (events.length >= limit) break;
      }
      return { session_id: sessionId, source: 'native-dsh-session-log', events, cursor,
        hasMore: cursor < (raw.at(-1)?.seq ?? cursor) || raw.length === 256 };
    } finally { await handle.close(); }
  } finally { await ctx.fiber.dispose(); }
}
