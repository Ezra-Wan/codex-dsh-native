import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import { beginObservation, observeCallEvent, updateObservation, observationSummary,
  conversationIdentity, tasksInConversation } from '../src/call-observation.mjs';

test('invocation metadata freezes a native range without copying questions or history', () => {
  const record = { turn: 1, status: 'running' };
  const first = beginObservation(record, 'chat-A');
  observeCallEvent(record, { type: 'turn/start', seq: 4, data: { turn: 7 } });
  observeCallEvent(record, { type: 'assistant/message', seq: 8 });
  observeCallEvent(record, { type: 'turn/end', seq: 9 });
  record.status = 'completed'; record.resultPath = 'existing-turn-1.txt'; updateObservation(record);
  const frozen = structuredClone(first);
  record.turn++; record.status = 'starting'; const second = beginObservation(record);
  observeCallEvent(record, { type: 'turn/start', seq: 12, data: { turn: 8 } });
  observeCallEvent(record, { type: 'assistant/message', seq: 15 });
  assert.deepEqual(first, frozen);
  assert.notEqual(first.call_id, second.call_id);
  assert.equal(first.native_turn, 7);
  assert.equal(observationSummary(record, first.call_id).status, 'completed');
  assert.equal(observationSummary(record, first.call_id).resultPath, 'existing-turn-1.txt');
  assert.equal(observationSummary(record).observation.start_seq, 12);
  assert.doesNotMatch(JSON.stringify(record.observations), /"messages"|"content"|"prompt"/);
});

test('host conversation identity wins; missing identity never exposes the global list', () => {
  assert.equal(conversationIdentity({ conversation_id: 'fallback' }, { _meta: { 'openai/session': 'host' } }), 'host');
  const a = { agent_id: 'A', conversation_id: 'chat-A' }, b = { agent_id: 'B', conversation_id: 'chat-B' };
  const legacy = { agent_id: 'old' };
  assert.deepEqual(tasksInConversation([a, b, legacy], a), [a]);
  assert.deepEqual(tasksInConversation([a, b, legacy], legacy), [legacy]);
  assert.deepEqual(tasksInConversation([a, b, legacy]), []);
  assert.throws(() => beginObservation({ conversationId: 'chat-A' }, 'chat-B'), /different Codex conversation/);
});

test('native start and continuation persist separate ranges on one session; old range survives reopen', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-call-range-'));
  const runs = [];
  const bridge = await new Bridge({ root, runtimeFactory: () => ({ start: async () => {}, close: async () => {},
    session: () => ({ getWorkingDirectory: async () => root }), resumeSession: async () => {},
    run: (_task, { sessionId, onNotification }) => new Promise(resolve => runs.push({ sessionId, onNotification, resolve })),
  }) }).init();
  t.after(async () => { await bridge.close(); await rm(root, { recursive: true, force: true }); });
  await bridge.setEnabled(true);
  const first = await bridge.start({ task: 'first', cwd: root, role: 'sub', webEmbed: false, conversation_id: 'chat-A' });
  while (runs.length < 1) await new Promise(resolve => setTimeout(resolve, 5));
  const finish = (run, seq, turn) => {
    const events = [{ type: 'turn/start', seq, data: { turn } },
      { type: 'assistant/message', seq: seq + 1, data: { turn, message: { content: [{ type: 'text', text: 'ok' }] } } },
      { type: 'turn/end', seq: seq + 2, data: { turn, reason: { kind: 'completed' } } }];
    for (const event of events) run.onNotification({ method: 'session.event', params: { sessionId: run.sessionId, event } });
    run.resolve({ events, finalResponse: 'ok' });
  };
  finish(runs[0], 4, 1); await bridge.wait(first.agent_id);
  const second = await bridge.followup(first.agent_id, 'second', { conversation_id: 'chat-A' });
  assert.equal(second.session_id, first.session_id);
  assert.notEqual(second.observation.call_id, first.observation.call_id);
  while (runs.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
  finish(runs[1], 10, 2); await bridge.wait(first.agent_id);
  const record = JSON.parse(await readFile(join(root, 'tasks', `${first.agent_id}.json`), 'utf8'));
  assert.equal(bridge.summary(record, first.observation.call_id).observation.end_seq, 6);
  assert.equal(bridge.summary(record).observation.start_seq, 10);
  assert.equal(record.conversationId, 'chat-A');
  await assert.rejects(bridge.followup(first.agent_id, 'foreign', { conversation_id: 'chat-B' }), /different Codex conversation/);
});
