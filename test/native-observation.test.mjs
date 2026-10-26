import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { createObservationFeed, createObservationContext, registerNativeObservation } from '../ui/native-observation.mjs';
import { createNativeDisplayMode } from '../ui/native-presentation.mjs';
import { BoundConversation } from '../vendor/deepseek-bound-conversation/binding.mjs';
import { Context } from '@deepseek-ai/cordis';

const entry = (seq, type, turn = 1, extra = {}) => ({ type: 'event', event: { seq, type, turn, time: seq,
  data: { turn, ...extra } } });
function setup(role = 'sub') {
  const mode = createNativeDisplayMode();
  const task = { role, observation: { call_id: 'call-1', start_seq: 10, end_seq: null, frozen: false } };
  const context = createObservationContext(mode, task);
  const source = createSnapshotStore({ entries: [], hasMore: true, revision: 0 });
  const feed = createObservationFeed(source, context);
  let revision = 0;
  const publish = entries => source.set({ entries, hasMore: true, revision: ++revision });
  return { mode, task, context, feed, publish };
}

test('inline exposes only this invocation; fullscreen exposes the same original complete history', () => {
  const { mode, feed, publish, context } = setup();
  const history = [entry(1, 'turn/start', 0), entry(2, 'user/message', 0), entry(3, 'turn/end', 0),
    entry(10, 'turn/start'), entry(11, 'user/message'), entry(12, 'assistant/live-chunk')];
  publish(history);
  assert.deepEqual(feed.getSnapshot().entries.map(x => x.event.seq), [10, 11, 12]);
  assert.equal(feed.getSnapshot().hasMore, false);
  mode.set('fullscreen');
  assert.equal(feed.getSnapshot().entries, history, 'full side history is the original array, not copied transcript DOM');
  assert.equal(feed.getSnapshot().hasMore, true);
  mode.set('inline');
  assert.deepEqual(feed.getSnapshot().entries.map(x => x.event.seq), [10, 11, 12]);
  feed.dispose(); context.dispose();
});

test('two streamed pieces appear before native end; later same-session turns cannot mutate the old inline record', () => {
  const { mode, feed, publish, context } = setup();
  const start = entry(10, 'turn/start'), question = entry(11, 'user/message');
  const a = entry(12, 'assistant/live-chunk'), b = entry(13, 'assistant/live-chunk');
  publish([start, question, a]);
  assert.equal(feed.getSnapshot().entries.at(-1), a);
  publish([start, question, a, b]);
  assert.equal(feed.getSnapshot().entries.at(-1), b);
  const end = entry(14, 'turn/end');
  publish([start, question, a, b, end]);
  const frozen = feed.getSnapshot();
  publish([start, question, a, b, end, entry(20, 'turn/start', 2), entry(21, 'user/message', 2)]);
  assert.equal(feed.getSnapshot(), frozen, 'no new inline publication after native turn/end');
  mode.set('fullscreen'); assert.equal(feed.getSnapshot().entries.at(-1).event.seq, 21);
  mode.set('inline'); assert.equal(feed.getSnapshot().entries.at(-1), end);
  feed.dispose(); context.dispose();
});

test('peer never exposes inline history, irrespective of task count or completion; side remains complete', () => {
  const { mode, feed, publish, context } = setup('peer');
  const history = [entry(10, 'turn/start'), entry(11, 'user/message'), entry(12, 'turn/end')];
  publish(history); assert.deepEqual(feed.getSnapshot().entries, []);
  mode.set('fullscreen'); assert.equal(feed.getSnapshot().entries, history);
  mode.set('inline'); assert.deepEqual(feed.getSnapshot().entries, []);
  feed.dispose(); context.dispose();
});

test('a following invocation uses its own range while preserving full side history', () => {
  const { mode, task, feed, publish, context } = setup();
  const history = [entry(10, 'turn/start'), entry(11, 'user/message'), entry(12, 'turn/end'),
    entry(20, 'turn/start', 2), entry(21, 'user/message', 2)];
  publish(history);
  context.update({ ...task, observation: { call_id: 'call-2', start_seq: 20, end_seq: null, frozen: false } });
  assert.deepEqual(feed.getSnapshot().entries.map(x => x.event.seq), [20, 21]);
  mode.set('fullscreen'); assert.equal(feed.getSnapshot().entries, history);
  feed.dispose(); context.dispose();
});

async function nativeExports() {
  let factory;
  const require = createRequire(import.meta.url);
  runInNewContext(await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-conversation/client')), 'utf8'),
    { window: { __ModuleLoader__: { load: entry => { factory = entry.factory; } } }, queueMicrotask, console });
  // DOM-only primitive components are not instantiated; assembly is the actual installed module.
  return factory(id => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id));
}

test('published native assembler and copied native binding consume the filtered event source', async () => {
  const { ConversationNodeAssembler } = await nativeExports();
  const { feed, publish, context } = setup();
  const assembler = new ConversationNodeAssembler({ entries: () => [], fallbackEntry: () => undefined }, { entries: () => [] });
  const binding = new BoundConversation(feed, assembler);
  publish([entry(1, 'turn/start', 0), entry(2, 'turn/end', 0), entry(10, 'turn/start', 5)]);
  assert.equal(binding.openTurn.getSnapshot(), 5);
  publish([entry(10, 'turn/start', 5), entry(11, 'turn/end', 5), entry(20, 'turn/start', 6)]);
  assert.equal(binding.openTurn.getSnapshot(), undefined, 'future turn is not assembled into old inline content');
  binding.dispose(); feed.dispose(); context.dispose();
});

test('observation boot module belongs to an initial-load batch and uses the native conversation dependency', () => {
  let loaded;
  const boot = { entries: [], batches: [] };
  registerNativeObservation({ loader: { load: value => { loaded = value; } }, boot, context: {}, sessionId: 'A' });
  assert.equal(loaded.id, boot.batches[0].entries[0]);
  assert.deepEqual(boot.entries[0].inject, ['@deepseek-ai/dsh-client-ui-conversation']);
});

test('real Cordis and native UiConversation adopt only the selected session, restore the service on unload', async () => {
  const native = await nativeExports();
  const { mode, context, publish } = setup();
  const ctx = new Context(), ownerCtx = new Context(), loads = [];
  const source = createSnapshotStore({ entries: [], hasMore: false, revision: 0, change: { kind: 'replace', entries: [] } });
  const owner = { sessionId: 'A', ctx: ownerCtx, eventSource: source, session: { loadThrough: async seq => loads.push(seq) } };
  const sessions = { binding: id => id === 'A' ? owner : undefined };
  let plugin;
  registerNativeObservation({ loader: { load: value => { plugin = value.factory(() => native); } },
    boot: { entries: [] }, context, sessionId: 'A' });
  ctx.provide('sessions', sessions);
  const service = new native.UiConversation(ctx, sessions);
  const original = service.binding;
  const handle = ctx.plugin(plugin);
  try {
    await new Promise(resolve => setImmediate(resolve));
    const binding = service.binding('A');
    assert.notEqual(service.binding, original);
    assert.equal(service.binding(owner), binding);
    assert.deepEqual(loads, [10], 'exact beginning is loaded with the native history pager');
    const records = [entry(1, 'turn/start', 0), entry(2, 'turn/end', 0), entry(10, 'turn/start', 5)];
    source.set({ entries: records, hasMore: true, revision: 1, change: { kind: 'replace', entries: records } });
    assert.equal(binding.openTurn.getSnapshot(), 5);
    mode.set('fullscreen');
    assert.equal(service.binding('A'), binding, 'display mode changes do not replace native binding identity');
    await handle.dispose();
    assert.equal(service.binding, original);
    assert.notEqual(service.binding('A'), binding);
  } finally { await ownerCtx.fiber.dispose(); await ctx.fiber.dispose(); context.dispose(); }
});
