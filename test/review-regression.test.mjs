import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, utimes, cp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
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
        closed: false, patches: options.patches ?? [], options, record,
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

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-review-fix-'));
  const fake = factory();
  const bridge = await new Bridge({ root, runtimeFactory: fake.create, idleMs: 60_000, ...options }).init();
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
  const task = await bridge.start({ cwd: root, task: 'spawn children', permission: 'read-only', webEmbed: false });
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
  const task = await bridge.start({ cwd: root, task: 'first', webEmbed: false });
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
  const task = await bridge.start({ cwd: root, task: 'first', webEmbed: false });
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

test('the native URL is generation-scoped: release revokes it, cold followup re-collects the new token', async t => {
  // Isolated port band: parallel test files each allocate from 8801.
  const { root, fake, bridge } = await setup(t, { webEmbedBasePort: 8850 });
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'two generations', permission: 'read-only' });
  const urlFile = join(bridge.root, 'task-urls', '8851.json');
  await mkdir(join(bridge.root, 'task-urls'), { recursive: true });
  const writeUrl = token => writeFile(urlFile, JSON.stringify({ url: `http://127.0.0.1:8851/?token=${token}`, pid: 1, writtenAt: new Date().toISOString() }));
  await writeUrl('gen1');
  for (let i = 0; i < 40 && !(await bridge.status(task.agent_id)).nativeUrl; i++) await new Promise(r => setTimeout(r, 100));
  assert.equal((await bridge.status(task.agent_id)).nativeUrl, 'http://127.0.0.1:8851/?token=gen1');
  (await ready(fake)).finish();
  await bridge.wait(task.agent_id);
  await bridge.release(task.agent_id);
  // Release killed the process: the URL must be revoked, not served as live.
  const afterRelease = await bridge.status(task.agent_id);
  assert.equal(afterRelease.nativeUrl, null, 'stale token explicitly revoked on release');
  // Cold followup rebuilds the runtime; its launch clears the URL file first,
  // so the new generation's adapter writes the new token afterwards.
  await bridge.followup(task.agent_id, 'continue');
  await writeUrl('gen2');
  for (let i = 0; i < 40 && (await bridge.status(task.agent_id)).nativeUrl !== 'http://127.0.0.1:8851/?token=gen2'; i++) {
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal((await bridge.status(task.agent_id)).nativeUrl, 'http://127.0.0.1:8851/?token=gen2', 'second generation URL collected');
  (await ready(fake, 1)).finish();
  await bridge.wait(task.agent_id);
});

test('web-embed tasks launch the sdk-web profile, pick up the adapter URL and clean it up', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'observed work', permission: 'read-only' });
  const runtime = await ready(fake);
  // The dispatch passed the sdk-web profile and a per-task web overlay.
  assert.equal(runtime.patches.length, 1);
  assert.equal(runtime.options?.profile ?? (fake.lastOptions?.profile), 'sdk-web');
  const overlay = await readFile(runtime.patches[0], 'utf8');
  assert.match(overlay, /id: webserver/);
  assert.match(overlay, /port: 8801/, 'per-task port pinned in the overlay');
  assert.match(overlay, /@codex-dsh\/web-embed/);
  assert.match(overlay, /task-urls/);
  // The adapter writes the URL file once the in-process web stack is live.
  const urlFile = join(bridge.root, 'task-urls', '8801.json');
  await mkdir(join(bridge.root, 'task-urls'), { recursive: true });
  await writeFile(urlFile, JSON.stringify({ url: 'http://127.0.0.1:8801/?token=tok', pid: 1, writtenAt: new Date().toISOString() }));
  for (let i = 0; i < 40 && !(await bridge.status(task.agent_id)).nativeUrl; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const summary = await bridge.status(task.agent_id);
  assert.equal(summary.nativeUrl, 'http://127.0.0.1:8801/?token=tok');
  runtime.finish();
  await bridge.wait(task.agent_id);
  await bridge.release(task.agent_id);
  assert.equal(await readFile(urlFile, 'utf8').then(() => true).catch(() => false), false, 'URL file removed on release');
});

test('webEmbed:false keeps the plain sdk profile without overlays', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  await bridge.start({ cwd: root, task: 'plain', permission: 'read-only', webEmbed: false });
  const runtime = await ready(fake);
  assert.deepEqual(runtime.patches, []);
  runtime.finish();
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

test('ensureNativeReplay is inert under the test guard (no service side effects)', async t => {
  const { bridge } = await setup(t);
  const previous = process.env.DSH_NATIVE_REPLAY;
  process.env.DSH_NATIVE_REPLAY = 'off';
  try {
    // The guard returns at the top of the function: no state read, no spawn
    // (the spawn call sits below the guard in bridge.mjs).
    const result = await bridge.ensureNativeReplay();
    assert.equal(result, null, 'guard returns without spawning');
  } finally {
    if (previous === undefined) delete process.env.DSH_NATIVE_REPLAY;
    else process.env.DSH_NATIVE_REPLAY = previous;
  }
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

test('durable fragments surface one wait at a time; a foreign lane event never wakes another lane\'s waiter', async t => {
  const { root, fake, bridge } = await setup(t);
  await bridge.setEnabled(true);
  const laneA = await bridge.start({ cwd: root, task: 'lane A', permission: 'read-only', name: 'A' });
  const laneB = await bridge.start({ cwd: root, task: 'lane B', permission: 'read-only', name: 'B' });
  const runtimeA = await ready(fake, 0);
  const runtimeB = await ready(fake, 1);
  const message = (text, seq) => ({ type: 'assistant/message', seq, time: Date.now(), data: { message: { content: [{ type: 'text', text }] } } });
  // NOTE: these are durable committed assistant/message events (the
  // persisted granularity), NOT native assistant-stream chunks; this test
  // covers the bridge waiter semantics only, not streaming display.
  const texts = actions => (actions ?? []).filter(action => action.type === 'assistant/message').map(action => action.text);
  const stillPending = (promise, ms = 120) => Promise.race([promise.then(() => false), new Promise(r => setTimeout(() => r(true), ms))]);

  // Both waiters park. B's fragment must leave A's waiter pending.
  const waitA1 = bridge.wait(laneA.agent_id, 20_000);
  const waitB = bridge.wait(laneB.agent_id, 20_000);
  await new Promise(resolve => setTimeout(resolve, 60));
  runtimeB.emit(message('B 的第一段', 1));
  assert.ok(await stillPending(waitA1), 'A 的等待在 B 事件后仍然挂起（未串唤醒）');
  runtimeA.emit(message('A 的第一段', 1));
  const a1 = await waitA1;
  assert.deepEqual(texts(a1.recentActions), ['A 的第一段'], '第一次等待只见到第一段（逐次到达）');
  const b = await waitB;
  assert.deepEqual(texts(b.recentActions), ['B 的第一段'], 'B 只见到自己的片段');

  // A second wait parks again and surfaces ONLY the second fragment as new.
  const waitA2 = bridge.wait(laneA.agent_id, 20_000);
  await new Promise(resolve => setTimeout(resolve, 60));
  runtimeA.emit(message('A 的第二段', 2));
  const a2 = await waitA2;
  assert.deepEqual(texts(a2.recentActions), ['A 的第一段', 'A 的第二段'], '第二次等待后两段齐备且有序');
  runtimeA.finish(); runtimeB.finish();
  await bridge.wait(laneA.agent_id);
  await bridge.wait(laneB.agent_id);
});

test('web-embed tasks run in a task-scoped home whose only sessions are the task\'s own', async t => {
  const { root, fake, bridge } = await setup(t, { webEmbedBasePort: 8860 });
  await bridge.setEnabled(true);
  // The shared profiles installation exists in real homes; fake it for the junction target.
  await mkdir(join(bridge.home, 'profiles', 'sdk'), { recursive: true });
  const task = await bridge.start({ cwd: root, task: 'scoped home', permission: 'read-only' });
  const runtime = await ready(fake);
  // The runtime home is the task home: private sessions dir, profiles
  // junction-linked to the shared installation (one sdk-web install).
  const taskHome = bridge.taskHome(task.agent_id);
  assert.equal(runtime.options.home, taskHome);
  const statSessions = await stat(join(taskHome, 'sessions'));
  assert.ok(statSessions.isDirectory());
  assert.equal(await readFile(join(taskHome, 'profiles'), 'utf8').then(() => true).catch(() => false), false, 'profiles is a link, not a copy');
  assert.equal(await realpath(join(taskHome, 'profiles')), await realpath(join(bridge.home, 'profiles')));
  // ds_events reads this task's sessions from the task home, not the shared one.
  const fixtureDir = '--D-~0040harness-codex-dsh-native-p0-.local-demo-1792663550562-workspace--';
  const source = fileURLToPath(new URL('../test/fixtures/sessions/--D-~0040harness-codex-dsh-native-p0-.local-demo-1792663550562-workspace--/', import.meta.url));
  await cp(source, join(taskHome, 'sessions', fixtureDir), { recursive: true });
  const childId = 'bc243aa7-57aa-47b5-b219-c73a6a45c5ed';
  runtime.emit({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }, childId);
  const events = await bridge.events(childId);
  assert.equal(events.session_id, childId);
  assert.ok(events.events.length > 0, 'child events read from the task-scoped home');
  runtime.finish();
  await bridge.wait(task.agent_id);
  await bridge.release(task.agent_id);
  // The task home SURVIVES release: cold followup resumes the same session
  // identity from the same home (generation-scoped URL, stable session home).
  await bridge.followup(task.agent_id, 'continue');
  assert.equal(bridge.taskHome(task.agent_id), taskHome);
  (await ready(fake, 1)).finish();
  await bridge.wait(task.agent_id);
});
