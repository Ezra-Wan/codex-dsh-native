import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionAssistantStreamAccumulator } from './vendor/session-controller/dist/host-accumulator.mjs';
import { ClientAssistantStream } from './vendor/session-controller/dist/client-fold.mjs';

// Contract tests against the OFFICIAL assistant-stream fold (vendored
// verbatim from upstream 687f282e, MIT — see file headers). These verify the
// receiving-side semantics the S1 adapter relies on: transient chunks become
// visible one by one BEFORE the answer completes, a durable settlement
// replaces them per native rules, a reconnect baseline rebuilds in-flight
// text, and two lanes never cross. Synthetic inputs; no model, no services.

const attempt = '11111111-1111-1111-1111-111111111111';
// StreamChunk text-delta carries its own dense index (dsh-llm push reads it).
const chunk = (text, index) => ({ type: 'text-delta', index, text });
const durableMessage = (seq, text, extra = {}) => ({
  type: 'event',
  event: { type: 'assistant/message', seq, time: seq, turn: 1, step: 1, surfaceOp: 'append', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text }], usage: {} }, ...extra } },
});

function fold(client, frames) {
  const out = [];
  for (const frame of frames) out.push(client.acceptFrame(frame));
  return out;
}

test('transient chunks surface one by one before completion, then settle by native rules', () => {
  const client = new ClientAssistantStream();
  client.replace([]);
  const results = fold(client, [
    { type: 'start', attemptId: attempt, revision: 1, startedAfterSeq: 5, turn: 1, step: 1 },
    { type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: 1000, chunk: chunk('第一段', 0) },
    { type: 'chunk', attemptId: attempt, revision: 1, index: 1, time: 1001, chunk: chunk('第二段', 1) },
  ]);
  const transients = results.filter(result => result?.type === 'transient');
  assert.equal(transients.length, 2, 'both chunks visible while the answer is still running');
  assert.equal(transients[0].entry.event.data.chunk.text, '第一段');
  assert.equal(transients[1].entry.event.data.chunk.text, '第二段');
  assert.ok(transients[1].entry.event.seq > transients[0].entry.event.seq, 'transient rows keep display order (dense seq grows with the gap counter)');

  // Durable settlement arrives while the attempt is open, then end commits it.
  assert.equal(client.acceptDurable(durableMessage(9, '第一段第二段')), undefined, 'settlement staged, not yet published');
  const settled = client.acceptFrame({ type: 'end', attemptId: attempt, revision: 1, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 9 } });
  assert.equal(settled.type, 'publish', 'successful message publishes at end');
  assert.equal(settled.entry.event.seq, 9);
  // After settlement the durable window replaces the transient prefix.
  const window = client.replace([durableMessage(9, '第一段第二段')]);
  assert.equal(window.length, 1);
  assert.equal(window[0].event.type, 'assistant/message');
});

test('an interrupted settlement retires transient rows immediately (settlement, not publish)', () => {
  const client = new ClientAssistantStream();
  client.replace([]);
  fold(client, [
    { type: 'start', attemptId: attempt, revision: 1, startedAfterSeq: 5, turn: 1, step: 1 },
    { type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: 1000, chunk: chunk('写到一半', 0) },
  ]);
  assert.equal(client.acceptDurable(durableMessage(9, '写到一半', { interrupted: true })), undefined);
  const outcome = client.acceptFrame({ type: 'end', attemptId: attempt, revision: 1, index: 1, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 9 } });
  assert.equal(outcome.type, 'settlement', 'interrupted messages settle without retention');
  assert.equal(outcome.entry.event.data.interrupted, true);
});

test('a reconnect baseline rebuilds the in-flight text on a fresh receiver', () => {
  const host = new SessionAssistantStreamAccumulator();
  // Frame revisions are monotone per attached Agent lifecycle: start=1, then
  // each following frame increments (a replacement restarts at 1).
  host.accept({ type: 'start', attemptId: attempt, revision: 1, turn: 1, step: 1 }, 5);
  host.accept({ type: 'chunk', attemptId: attempt, revision: 2, index: 0, time: 1000, chunk: chunk('重连前', 0) }, 5);
  host.accept({ type: 'chunk', attemptId: attempt, revision: 3, index: 1, time: 1001, chunk: chunk('已积累', 1) }, 5);
  const baseline = host.snapshot();
  assert.equal(baseline.revision, 3);
  assert.equal(baseline.activeAttempt.nextIndex, 2, 'host baseline keeps the dense prefix');

  const reconnected = new ClientAssistantStream();
  const visible = reconnected.replace([], baseline);
  const rebuilt = visible.filter(entry => entry.type === 'transient');
  assert.equal(rebuilt.length, 2, 'in-flight text reconstructed after reconnect');
  assert.deepEqual(rebuilt.map(entry => entry.event.data.chunk.text), ['重连前', '已积累']);
  // The reconnected receiver continues the SAME attempt without rebaseline
  // (the client fold keys on attemptId + dense index, not the wire revision).
  const next = reconnected.acceptFrame({ type: 'chunk', attemptId: attempt, revision: 4, index: 2, time: 1002, chunk: chunk('继续', 2) });
  assert.equal(next.type, 'transient');
  assert.equal(next.entry.event.data.chunk.text, '继续');
});

test('two lanes fold independently — A chunks never surface in B', () => {
  const attemptB = '22222222-2222-2222-2222-222222222222';
  const laneA = new ClientAssistantStream();
  const laneB = new ClientAssistantStream();
  laneA.replace([]);
  laneB.replace([]);
  laneA.acceptFrame({ type: 'start', attemptId: attempt, revision: 1, startedAfterSeq: 5, turn: 1, step: 1 });
  laneB.acceptFrame({ type: 'start', attemptId: attemptB, revision: 1, startedAfterSeq: 7, turn: 1, step: 1 });
  const fromA = laneA.acceptFrame({ type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: 1, chunk: chunk('A 的文字', 0) });
  const bSeesA = laneB.acceptFrame({ type: 'chunk', attemptId: attempt, revision: 1, index: 0, time: 1, chunk: chunk('A 的文字', 0) });
  assert.equal(fromA.type, 'transient');
  assert.equal(bSeesA, undefined, 'a foreign attempt id is ignored — no cross-lane leak');
  const fromB = laneB.acceptFrame({ type: 'chunk', attemptId: attemptB, revision: 1, index: 0, time: 2, chunk: chunk('B 的文字', 0) });
  assert.equal(fromB.entry.event.data.chunk.text, 'B 的文字');
});
