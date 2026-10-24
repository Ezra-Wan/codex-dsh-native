import test from 'node:test';
import assert from 'node:assert/strict';
import { createObserverCore } from '../ui/observer-core.mjs';

// Controller tests for the observer loop discipline (p0-followup-review):
// terminal stop, error backoff, stale-response dropping, revive-on-followup.
// Deterministic via an injected fake clock — no DOM, no MCP, no timers.

function fakeClock() {
  let now = 0;
  const sleeps = [];
  return {
    now: () => now,
    sleep: ms => new Promise(resolve => sleeps.push({ ms, resolve })),
    // Advance the virtual clock by resolving pending sleeps in order.
    async tick() {
      const batch = sleeps.splice(0);
      for (const item of batch) {
        now += item.ms;
        item.resolve();
      }
      // Two macrotask turns: let resumed loop continuations (and their next
      // sleeps) settle before this tick returns.
      await new Promise(resolve => setImmediate(resolve));
      await new Promise(resolve => setImmediate(resolve));
    },
    pending: () => sleeps.map(item => item.ms),
  };
}

test('terminal status stops the hot loop: only slow-watch requests follow', async () => {
  const clock = fakeClock();
  let calls = 0;
  const core = createObserverCore({
    wait: async () => { calls++; return { status: 'completed' }; },
    apply: () => {},
    sleep: clock.sleep, now: clock.now,
  });
  const running = core.run(() => 'task-a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'first request fires immediately');
  assert.deepEqual(clock.pending(), [800], 'minimum pacing applies to the instant terminal return');
  for (let i = 0; i < 6; i++) await clock.tick();
  // Cadence property, not exact counts (tick scheduling may run an extra
  // continuation): average request interval stays near the 5s slow watch.
  const elapsed = clock.now();
  assert.ok(calls >= 2 && calls <= elapsed / 5000 + 2, `slow-watch cadence held: calls=${calls} over ${elapsed}ms`);
  core.stop();
  await clock.tick();
  await running;
});

test('error path backs off exponentially instead of hammering', async () => {
  const clock = fakeClock();
  let calls = 0;
  const core = createObserverCore({
    wait: async () => { calls++; throw new Error('transport down'); },
    apply: () => { throw new Error('apply must not run on errors'); },
    sleep: clock.sleep, now: clock.now,
  });
  const running = core.run(() => 'task-a');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.deepEqual(clock.pending(), [1000], 'first failure backs off to 1s (not the 800ms floor)');
  await clock.tick();
  assert.equal(calls, 2);
  assert.deepEqual(clock.pending(), [2000], 'second failure doubles to 2s');
  await clock.tick();
  assert.deepEqual(clock.pending(), [4000], 'third failure doubles to 4s');
  core.stop();
  await clock.tick();
  await running;
});

test('a response landing after a task switch is dropped, never applied', async () => {
  const clock = fakeClock();
  let applied = [];
  let resolveA;
  const waits = [];
  const core = createObserverCore({
    wait: id => new Promise(resolve => { waits.push(id); if (id === 'task-a') resolveA = resolve; else resolve({ status: 'running', task: id }); }),
    apply: status => applied.push(status),
    sleep: clock.sleep, now: clock.now,
  });
  let current = 'task-a';
  const running = core.run(() => current);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waits[0], 'task-a');
  // Switch to B while A's response is still in flight, then let A settle:
  // its result is stale (seq bumped) and must be dropped; the loop then
  // paces and moves on to task B.
  core.switchTask();
  current = 'task-b';
  resolveA({ status: 'completed', task: 'task-a' });
  await clock.tick();
  assert.ok(waits.includes('task-b'), 'loop moved on to task B');
  assert.deepEqual(applied.filter(status => status.task === 'task-a'), [], 'stale task-a result never applied');
  assert.ok(applied.every(status => status.task === 'task-b'), 'only task-b results rendered');
  core.stop();
  await clock.tick();
  await running;
});

test('a followup result revives a terminal task into the hot loop', async () => {
  const clock = fakeClock();
  let calls = 0;
  let status = 'completed';
  const core = createObserverCore({
    wait: async () => { calls++; return { status }; },
    apply: () => {},
    sleep: clock.sleep, now: clock.now,
  });
  const running = core.run(() => 'task-a');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(clock.pending(), [800]);
  await clock.tick();
  assert.deepEqual(clock.pending(), [5000], 'terminal task parked in slow watch');
  // Followup flips the task back to running; the revive takes effect at the
  // next slow check (≤5s), which then re-enters the hot 800ms cadence.
  core.observeStatus({ status: 'running' });
  status = 'running';
  await clock.tick();
  assert.ok(calls >= 2, `slow check ran and observed the revival (calls=${calls})`);
  assert.ok(clock.pending().includes(800), 'hot loop cadence restored after revival');
  core.stop();
  await clock.tick();
  await running;
});
