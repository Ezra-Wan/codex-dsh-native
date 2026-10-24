import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, utimes, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bridge } from '../src/bridge.mjs';

// Regression tests for the acceptance/consolidation reviews
// (.local/acceptance-review-20261024, .local/consolidation-review-20261024).
// The markdown stack-overflow regression lived with ui/prototype and was
// archived together with it (chore/retire-prototype).

function factory() {
  const instances = [];
  return {
    instances,
    create(record, options = {}) {
      const runtime = {
        closed: false, patches: options.patches ?? [],
        start: async () => {},
        session: id => ({ getWorkingDirectory: async () => ({}) }),
        resumeSession: async () => {},
        run: (task, { sessionId, onNotification }) => new Promise((resolve, reject) => {
          runtime.reject = reject;
          runtime.emit = (event, sessionIdOverride) => onNotification?.({ method: 'session.event', params: { sessionId: sessionIdOverride ?? sessionId, event } });
          runtime.finish = (reason = 'completed', final = task) => resolve({ finalResponse: final, events: [
            { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: final }] } } },
            { type: 'turn/end', data: { reason: { kind: reason } } },
          ] });
        }),
        close: async () => { runtime.closed = true; runtime.reject?.(new Error('transport closed')); },
      };
      instances.push(runtime);
      return runtime;
    },
  };
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-fix-'));
  const fake = factory();
  const bridge = await new Bridge({ root, runtimeFactory: fake.create, idleMs: 60_000 }).init();
  t.after(async () => { await bridge.close(); await rm(root, { recursive: true, force: true }); });
  return { root, fake, bridge };
}
async function ready(fake, index = 0) {
  for (let count = 0; count < 100; count++) {
    if (fake.instances[index]?.finish) return fake.instances[index];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('fake runtime did not start');
}
const userPrompt = (text, seq) => ({ type: 'user/message', seq, time: seq, data: { message: { content: [{ type: 'text', text }], source: { kind: 'user' } } } });

// Simulate that the bridge last wrote long ago, so a fresh native log reads
// as external activity rather than the bridge's own turn output. followup
// prefers the in-memory live record, so age that too.
async function ageSelfWrites(bridge, id, msAgo) {
  const mark = Date.now() - msAgo;
  const live = bridge.live.get(id);
  if (live) live.record.lastSelfWriteAt = mark;
  const record = await bridge.read(id);
  await bridge.save({ ...record, lastSelfWriteAt: mark });
}

test('a running child session is readable through ds_events before the parent persists', async t => {
  const { root, fake, bridge } = await setup(t);
  // The in-repo sanitized copy of the real demo session log (previous commit).
  const childId = 'bc243aa7-57aa-47b5-b219-c73a6a45c5ed';
  const source = fileURLToPath(new URL('../test/fixtures/sessions/--D-~0040harness-codex-dsh-native-p0-.local-demo-1792663550562-workspace--/', import.meta.url));
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'spawn children', permission: 'read-only' });
  const runtime = await ready(fake);
  const target = join(bridge.home, 'sessions', '--D-~0040harness-codex-dsh-native-p0-.local-demo-1792663550562-workspace--');
  await mkdir(join(bridge.home, 'sessions'), { recursive: true });
  await cp(source, target, { recursive: true });
  runtime.emit({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }, childId);
  // Parent still running: the child must already resolve through the live index.
  const summary = await bridge.status(task.agent_id);
  assert.ok(summary.children.some(child => child.child_id === childId), 'summary lists the running child');
  const events = await bridge.events(childId);
  assert.equal(events.session_id, childId);
  assert.ok(events.events.length > 0, 'real child log yields visible events');
  runtime.finish();
  await bridge.wait(task.agent_id);
});

test('takeover protection sees the real two-level session layout', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'first' });
  (await ready(fake)).finish();
  await bridge.wait(task.agent_id);
  // Real layout: sessions/<workspace-dir>/<session-id>/session.v4.jsonl.zstd
  const sessionDir = join(bridge.home, 'sessions', '--D-workspace--', task.session_id);
  await mkdir(sessionDir, { recursive: true });
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd');
  await writeFile(logPath, 'x');
  await utimes(logPath, new Date(Date.now() - 5_000), new Date(Date.now() - 5_000));
  // Fresh writes only read as external when they postdate the bridge's own mark.
  await ageSelfWrites(bridge, task.agent_id, 300_000);
  await assert.rejects(bridge.followup(task.agent_id, 'next'), /external writes/);
  await utimes(logPath, new Date(Date.now() - 300_000), new Date(Date.now() - 300_000));
  const next = await bridge.followup(task.agent_id, 'next');
  assert.ok(['starting', 'running'].includes(next.status));
});

test('user takeover is reported on the second turn as well', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'turn one', permission: 'read-only' });
  let runtime = await ready(fake);
  runtime.emit(userPrompt('turn one', 1));
  runtime.finish();
  await bridge.wait(task.agent_id);
  await bridge.release(task.agent_id); // fresh runtime so the next finish() lands on the new run
  await bridge.followup(task.agent_id, 'turn two');
  // Second turn: bridge prompt + one user steering message.
  runtime = await ready(fake, 1);
  runtime.emit(userPrompt('turn two', 2));
  runtime.emit(userPrompt('user steering', 3));
  runtime.finish();
  const result = await bridge.wait(task.agent_id);
  assert.equal(result.userTakeover?.events, 1, 'second-turn takeover is not under-reported');
});

test('the guard accepts the bridge\'s own fresh writes but rejects external ones', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'first' });
  (await ready(fake)).finish();
  await bridge.wait(task.agent_id);
  const sessionDir = join(bridge.home, 'sessions', '--D-workspace--', task.session_id);
  await mkdir(sessionDir, { recursive: true });
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd');
  await writeFile(logPath, 'x');
  // Own writes: at/before lastSelfWriteAt + grace → followup must pass.
  await utimes(logPath, new Date(Date.now() - 1_000), new Date(Date.now() - 1_000));
  const next = await bridge.followup(task.agent_id, 'continue immediately');
  assert.ok(['starting', 'running'].includes(next.status), 'own fresh log must not be read as a takeover');
  await bridge.stop(task.agent_id);
  // External writes: fresher than the bridge's own mark → refused.
  await utimes(logPath, new Date(Date.now() - 500), new Date(Date.now() - 500));
  await ageSelfWrites(bridge, task.agent_id, 300_000);
  await assert.rejects(bridge.followup(task.agent_id, 'next'), /external writes/);
});

test('backend marker: worker is an explicit failover directive, native is recorded', async t => {
  const { root, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const failover = await bridge.start({ cwd: root, task: 'fallback work', backend: 'worker' });
  assert.equal(failover.backend, 'worker');
  assert.equal(failover.routedTo, 'deepseek_worker');
  assert.equal(failover.agent_id, null);
  const native = await bridge.start({ cwd: root, task: 'native work', permission: 'read-only', backend: 'native' });
  assert.equal(native.backend, 'native');
  await bridge.stop(native.agent_id);
});

test('ds_wait returns on the first fresh native event, not at the timeout (P0-B data layer)', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'long work', permission: 'read-only' });
  const runtime = await ready(fake);
  const started = Date.now();
  const pending = bridge.wait(task.agent_id, 20_000);
  // A fresh root event arrives well before any timeout: wait must settle.
  await new Promise(resolve => setTimeout(resolve, 60));
  runtime.emit({ type: 'tool/call', seq: 7, time: Date.now(), data: { callId: 'x', name: 'read', arguments: '{}' } });
  const result = await pending;
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `wait settled on the event in ${elapsed}ms, not the 20s timeout`);
  assert.ok(result.progress.eventCount >= 1);
  runtime.finish();
  await bridge.wait(task.agent_id);
});
