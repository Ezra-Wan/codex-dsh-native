import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.mjs';

function factory() {
  const histories = new Map();
  const instances = [];
  return {
    histories, instances,
    create(record) {
      const runtime = {
        closed: false, resumed: false,
        start: async () => {},
        session: id => ({ getWorkingDirectory: async () => { histories.set(id, []); return record.cwd; } }),
        resumeSession: async id => {
          if (!histories.has(id)) throw new Error('Native history missing');
          runtime.resumed = true;
        },
        run: (task, { sessionId, onNotification }) => new Promise((resolve, reject) => {
          runtime.reject = reject;
          runtime.emit = event => onNotification?.({ method: 'session.event', params: { sessionId, event } });
          runtime.finish = (reason = 'completed', final = task) => {
            histories.get(sessionId).push(task);
            resolve({ finalResponse: final, events: [
              { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 5 }, message: { content: [{ type: 'text', text: final }] } } },
              { type: 'turn/end', data: { reason: { kind: reason } } },
            ] });
          };
        }),
        close: async () => { runtime.closed = true; runtime.reject?.(new Error('transport closed')); },
      };
      instances.push(runtime);
      return runtime;
    },
  };
}

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-test-'));
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

test('off by default and disabled dispatch launches no native runtime', async t => {
  const { root, bridge, fake } = await setup(t);
  await assert.rejects(bridge.start({ cwd: root, task: 'hello' }), /disabled/);
  assert.equal(fake.instances.length, 0);
});

test('asynchronous tasks overlap, bounded waits stay pending and capacity is enforced', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first', permission: 'read-only' });
  const second = await bridge.start({ cwd: root, task: 'second', permission: 'read-only' });
  assert.equal(first.status, 'starting');
  await ready(fake, 1);
  assert.equal((await bridge.wait(first.agent_id, 1)).status, 'running');
  await assert.rejects(bridge.start({ cwd: root, task: 'third' }), /capacity/);
  fake.instances[1].finish();
  assert.equal((await bridge.wait(second.agent_id)).final, 'second');
  assert.equal((await bridge.status(first.agent_id)).status, 'running');
  fake.instances[0].finish();
  assert.equal((await bridge.wait(first.agent_id)).final, 'first');
});

test('concurrent writers use separate workspaces', async t => {
  const { root, bridge } = await setup(t);
  await bridge.setEnabled(true);
  await bridge.start({ cwd: root, task: 'writer' });
  await assert.rejects(bridge.start({ cwd: root, task: 'competing writer' }), /worktree/);
  const other = join(root, 'worktree');
  await mkdir(other);
  const second = await bridge.start({ cwd: other, task: 'separate writer' });
  assert.equal(second.status, 'starting');
});

test('disabling dispatch preserves already running work', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first' });
  const runtime = await ready(fake);
  await bridge.setEnabled(false);
  assert.equal(runtime.closed, false);
  runtime.finish();
  assert.equal((await bridge.wait(first.agent_id)).status, 'completed');
  await assert.rejects(bridge.followup(first.agent_id, 'next'), /disabled/);
});

test('cold followup resumes native history using exactly the same identity', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'remember 89', mode: 'coding' });
  (await ready(fake)).finish();
  await bridge.wait(first.agent_id);
  await bridge.close();
  const replacement = await new Bridge({ root, runtimeFactory: fake.create }).init();
  t.after(() => replacement.close());
  const next = await replacement.followup(first.agent_id, 'recall');
  assert.equal(next.session_id, first.session_id);
  assert.equal(next.maxTokens, 32768);
  const runtime = await ready(fake, 1);
  assert.equal(runtime.resumed, true);
  assert.deepEqual(fake.histories.get(first.session_id), ['remember 89']);
  runtime.finish('completed', '89');
  assert.equal((await replacement.wait(first.agent_id)).final, '89');
  await replacement.close();
});

test('missing native history fails without creating a replacement session', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'remember' });
  (await ready(fake)).finish();
  await bridge.wait(first.agent_id);
  await bridge.release(first.agent_id);
  fake.histories.clear();
  await bridge.followup(first.agent_id, 'recall');
  const result = await bridge.wait(first.agent_id);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /history missing/);
  assert.equal(fake.histories.size, 0);
});

test('partial text with max-tokens or a failed native turn is not success', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'long task' });
  (await ready(fake)).finish('max-tokens', 'unfinished');
  const result = await bridge.wait(first.agent_id);
  assert.equal(result.status, 'failed');
  assert.equal(result.finishReason, 'max-tokens');
  assert.match(result.error, /Output cap/);
  assert.equal(result.final, 'unfinished');
});

test('stop closes only the requested task and a busy followup is rejected', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first', permission: 'read-only' });
  const second = await bridge.start({ cwd: root, task: 'second', permission: 'read-only' });
  await ready(fake, 1);
  await assert.rejects(bridge.followup(first.agent_id, 'overlap'), /busy/);
  assert.equal((await bridge.stop(first.agent_id)).status, 'interrupted');
  assert.equal(fake.instances[1].closed, false);
  fake.instances[1].finish();
  assert.equal((await bridge.wait(second.agent_id)).status, 'completed');
});

test('another bridge instance cannot write an owned native session', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first' });
  (await ready(fake)).finish();
  await bridge.wait(first.agent_id);
  const other = await new Bridge({ root, runtimeFactory: fake.create }).init();
  try { await assert.rejects(other.followup(first.agent_id, 'steal'), /owned by another/); }
  finally { await other.close(); }
});

test('long final answers are bounded in tool output and preserved in a file', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first' });
  (await ready(fake)).finish('completed', 'a'.repeat(10_000));
  const result = await bridge.wait(first.agent_id);
  assert.equal(result.final.length, 4000);
  assert.equal(result.resultTruncated, true);
  assert.ok(result.resultPath.endsWith('.txt'));
});

test('a recovered tool failure stays visible after final completion and reload', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'check a result' });
  const runtime = await ready(fake);
  runtime.emit({ type: 'tool/call', seq: 8, time: 1000, data: { callId: 'check', name: 'pwsh', arguments: '{"command":"validate"}' } });
  runtime.emit({ type: 'tool/result', seq: 9, time: 1100, data: { message: { toolCallId: 'check', isError: true, content: [{ type: 'text', text: 'Windows access denied' }] } } });
  assert.equal((await bridge.status(first.agent_id)).warnings.length, 1);
  runtime.finish('completed', 'I checked using file reads instead');
  const result = await bridge.wait(first.agent_id);
  assert.equal(result.status, 'completed_with_warnings');
  assert.match(result.warnings[0].message, /access denied/);
  await bridge.release(first.agent_id);
  assert.equal((await bridge.status(first.agent_id)).warnings.length, 1);
});
