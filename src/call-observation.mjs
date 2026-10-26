import { randomUUID } from 'node:crypto';

const terminal = new Set(['completed', 'completed_with_warnings', 'failed', 'interrupted', 'closed']);

// Metadata only: native messages remain in their original session log.
export function beginObservation(record, conversationId) {
  if (conversationId && record.conversationId && conversationId !== record.conversationId) {
    throw new Error('Task belongs to a different Codex conversation');
  }
  if (conversationId) record.conversationId = conversationId;
  const call = { call_id: randomUUID(), turn: record.turn, start_seq: null, end_seq: null,
    frozen: false, status: record.status, created_at: new Date().toISOString() };
  record.observations ??= {};
  record.observations[call.call_id] = call;
  record.currentCallId = call.call_id;
  return call;
}

export function observeCallEvent(record, event) {
  const call = record.observations?.[record.currentCallId];
  if (!call || call.frozen || !Number.isInteger(event.seq)) return;
  // Bind to the actual native boundary, not an assumed count of model requests.
  if (call.start_seq === null && event.type === 'turn/start') {
    call.start_seq = event.seq;
    call.native_turn = event.data?.turn ?? event.turn;
  }
  if (call.start_seq !== null) call.last_seq = event.seq;
  if (event.type === 'turn/end' && call.start_seq !== null) call.end_seq = event.seq;
}

export function updateObservation(record, { freeze = false } = {}) {
  const call = record.observations?.[record.currentCallId];
  if (!call || call.frozen) return;
  call.status = record.status;
  if (freeze || terminal.has(record.status)) {
    call.end_seq ??= call.last_seq ?? null;
    call.frozen = true;
    call.error = record.error ?? null;
    call.failure = record.failure ?? null;
    call.resultPath = record.resultPath ?? null;
    call.usage = structuredClone(record.usage ?? null);
    call.finishReason = record.finishReason ?? null;
    call.finished_at = new Date().toISOString();
  }
}

export function observationSummary(record, callId = record.currentCallId) {
  if (!callId) return record.conversationId ? { conversation_id: record.conversationId } : {};
  const call = record.observations?.[callId];
  if (!call) throw new Error('Unknown invocation for this agent');
  return { conversation_id: record.conversationId ?? null, observation: { ...call },
    ...(callId !== record.currentCallId ? { turn: call.turn, status: call.status,
      error: call.error ?? null, failure: call.failure ?? null, resultPath: call.resultPath ?? null,
      usage: structuredClone(call.usage ?? null), finishReason: call.finishReason ?? null,
      final: undefined, progress: {}, recentActions: [], warnings: [] } : {}) };
}

export function conversationIdentity(args = {}, extra = {}) {
  const supplied = extra._meta?.['openai/session'];
  return typeof supplied === 'string' && supplied.length > 0 && supplied.length <= 200
    ? supplied : args.conversation_id;
}

export function tasksInConversation(items, anchor, conversationId) {
  const owner = conversationId ?? anchor?.conversation_id;
  // Missing host identity is not permission to show every local task.
  return owner ? items.filter(task => task.conversation_id === owner)
    : anchor ? items.filter(task => task.agent_id === anchor.agent_id) : [];
}
