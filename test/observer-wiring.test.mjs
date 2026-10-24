import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from '../ui/observer.mjs';
import { Bridge } from '../src/bridge.mjs';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Wiring tests for the observer card (cycle-discipline-review): execute the
// real interface module — import createCard, inject a fake MCP app host and a
// minimal DOM — and assert initialization, official-UI mounting, loop start,
// and task switching. The P1 wiring regression (undefined observeSeq in the
// card shell) lived at this layer and is exactly what controller-only tests
// could not catch.

function fakeDom() {
  const element = id => ({
    id,
    style: {},
    dataset: {},
    textContent: '',
    title: '',
    value: '',
    href: '',
    src: '',
    children: [],
    listeners: {},
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, handler) { (this.listeners[type] ??= []).push(handler); },
    dispatch(type) { for (const handler of this.listeners[type] ?? []) handler(); },
    removeAttribute(name) { if (name === 'title') this.title = ''; },
    querySelector() { return null; },
  });
  const byId = new Map(['tasks', 'state', 'open', 'notice', 'frame', 'fallback', 'rows'].map(id => [id, element(id)]));
  // Mirror the inline initial state in observer.html: fallback visible,
  // frame hidden until an official URL mounts.
  byId.get('fallback').style.display = 'block';
  byId.get('frame').style.display = 'none';
  return {
    hidden: false,
    getElementById: id => byId.get(id),
    createElement: () => element('dynamic'),
    byId,
  };
}

function fakeApp() {
  const calls = [];
  const pendingWaits = [];
  const app = {
    toolHandler: null,
    set ontoolresult(handler) { this.toolHandler = handler; },
    connect: async () => {},
    callServerTool: async ({ name, arguments: args }) => {
      calls.push({ name, args });
      if (name === 'ds_bridge') {
        return { structuredContent: {
          enabled: true,
          items: [{ agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: '任务A', status: 'running', role: 'peer' }],
          nativeReplay: { url: 'http://127.0.0.1:8792/?token=t', running: true },
        } };
      }
      if (name === 'ds_wait') {
        return new Promise(resolve => pendingWaits.push({ resolve, args }));
      }
      throw new Error(`unexpected tool ${name}`);
    },
    calls,
    pendingWaits,
  };
  return app;
}

test('initialization mounts the official UI and starts the observation loop', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const card = createCard({ app, doc });
  await card.start();
  // Official embed mounted with the replay URL; fallback hidden.
  assert.equal(doc.byId.get('frame').dataset.mounted, 'http://127.0.0.1:8792/?token=t');
  assert.equal(doc.byId.get('frame').src, 'http://127.0.0.1:8792/?token=t');
  assert.equal(doc.byId.get('frame').style.display, 'block');
  assert.equal(doc.byId.get('fallback').style.display, 'none');
  assert.equal(doc.byId.get('open').href, 'http://127.0.0.1:8792/?token=t');
  // Task list populated and the loop issued its first ds_wait for task A.
  const waits = app.calls.filter(call => call.name === 'ds_wait');
  assert.equal(waits.length, 1);
  assert.equal(waits[0].args.agent_id, 'aaaaaaaa-0000-0000-0000-000000000001');
  // A wait result applies the status to the badge without any wiring error.
  app.pendingWaits[0].resolve({ structuredContent: { status: 'running', recentActions: [] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(doc.byId.get('state').textContent, /运行中/);
  card.core.stop();
});

test('task switching clears state and re-anchors without wiring errors', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const card = createCard({ app, doc });
  await card.start();
  const select = doc.byId.get('tasks');
  select.value = 'bbbbbbbb-0000-0000-0000-000000000002';
  // The P1 regression was an undefined observeSeq inside this very path.
  select.dispatch('change');
  assert.equal(doc.byId.get('state').textContent, '', 'switching clears the previous task state');
  assert.equal(doc.byId.get('state').title, '');
  // No per-task URL on either task: the embed keeps its current mount
  // (the hash channel was removed; binding is per-task URL only).
  assert.equal(doc.byId.get('frame').src, 'http://127.0.0.1:8792/?token=t');
  // A tool result for the new selection is received without errors.
  card.receive({ items: [{ agent_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: '任务B', status: 'running' }] });
  assert.equal(select.children.length, 1);
  card.core.stop();
});

test('a missing replay keeps the waiting fallback and the loop alive, no errors', async () => {  const doc = fakeDom();
  const app = fakeApp();
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') return { structuredContent: { enabled: true, items: [{ agent_id: 'cccccccc-0000-0000-0000-000000000003', name: '任务C', status: 'running' }] } };
    if (name === 'ds_wait') return { structuredContent: { status: 'running' } };
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  await new Promise(resolve => setImmediate(resolve)); // let the loop's first wait fire
  // No nativeReplay field ⇒ no layout decision: the initial waiting fallback
  // stays, nothing breaks, and the paced loop still runs (first ds_wait issued).
  assert.equal(doc.byId.get('fallback').style.display, 'block');
  assert.equal(doc.byId.get('frame').style.display, 'none');
  assert.ok(app.calls.some(call => call.name === 'ds_wait'), 'loop issued its first wait');
  card.core.stop();
});

test('S2 binding: each task embeds its own executing-process URL; switching swaps the iframe', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const urlA = 'http://127.0.0.1:8801/?token=a';
  const urlB = 'http://127.0.0.1:8802/?token=b';
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') {
      return { structuredContent: { enabled: true, items: [
        { agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: '任务A', status: 'running', nativeUrl: urlA },
        { agent_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: '任务B', status: 'running', nativeUrl: urlB },
      ] } };
    }
    if (name === 'ds_wait') return new Promise(() => {});
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  // Default selection is the latest task (B): its own URL mounts, not a
  // global replay URL and not another chat's task.
  assert.equal(doc.byId.get('frame').dataset.mounted, urlB);
  assert.equal(doc.byId.get('frame').src, urlB);
  // Switch to A: the iframe swaps to A's executing-process UI.
  const select = doc.byId.get('tasks');
  select.value = 'aaaaaaaa-0000-0000-0000-000000000001';
  select.dispatch('change');
  assert.equal(doc.byId.get('frame').src, urlA);
  assert.equal(doc.byId.get('frame').dataset.mounted, urlA);
  card.core.stop();
});

test('S2 fallback: tasks without per-task URLs defer to the global nativeReplay', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const globalUrl = 'http://127.0.0.1:8792/?token=global';
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') {
      return { structuredContent: { enabled: true, items: [
        { agent_id: 'dddddddd-0000-0000-0000-000000000004', name: '旧任务', status: 'completed' },
      ], nativeReplay: { url: globalUrl, running: true } } };
    }
    if (name === 'ds_wait') return new Promise(() => {});
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  assert.equal(doc.byId.get('frame').dataset.mounted, globalUrl, 'global replay URL used when the task has none');
  card.core.stop();
});

test('async nativeUrl from a wait result re-binds the embed to the task UI', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const globalUrl = 'http://127.0.0.1:8792/?token=global';
  const taskUrl = 'http://127.0.0.1:8801/?token=task';
  const agentId = 'aaaaaaaa-0000-0000-0000-000000000001';
  let waitCount = 0;
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') return { structuredContent: { enabled: true, items: [{ agent_id: agentId, name: '任务A', status: 'running' }], nativeReplay: { url: globalUrl, running: true } } };
    if (name === 'ds_wait') {
      waitCount++;
      // First wait: no task URL yet (global replay shown); second wait carries it.
      return { structuredContent: waitCount === 1
        ? { status: 'running', agent_id: agentId, recentActions: [] }
        : { status: 'running', agent_id: agentId, nativeUrl: taskUrl, recentActions: [] } };
    }
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  assert.equal(doc.byId.get('frame').dataset.mounted, globalUrl, 'starts on the global replay URL');
  // The paced loop's next wait delivers the task URL: the embed must switch.
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal(doc.byId.get('frame').dataset.mounted, taskUrl, 'async task URL re-binds the embed');
  card.core.stop();
});

test('switching to a task with no live URL withdraws the previous task page', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const urlA = 'http://127.0.0.1:8801/?token=a';
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') return { structuredContent: { enabled: true, items: [
      { agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: '任务A', status: 'running', nativeUrl: urlA },
      { agent_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: '任务B', status: 'starting' },
    ] } };
    if (name === 'ds_wait') return new Promise(() => {});
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  // Default selection is B (last item, no URL yet): explicit waiting state.
  assert.equal(doc.byId.get('fallback').style.display, 'block');
  // Switch to A: its live URL mounts.
  const select = doc.byId.get('tasks');
  select.value = 'aaaaaaaa-0000-0000-0000-000000000001';
  select.dispatch('change');
  assert.equal(doc.byId.get('frame').src, urlA);
  // Switch back to B: A's page must be withdrawn, not left under B's tab.
  select.value = 'bbbbbbbb-0000-0000-0000-000000000002';
  select.dispatch('change');
  assert.equal(doc.byId.get('frame').style.display, 'none', 'old task page withdrawn');
  assert.equal(doc.byId.get('frame').dataset.mounted, undefined, 'stale mount cleared');
  assert.equal(doc.byId.get('fallback').style.display, 'block', 'explicit waiting state shown');
  card.core.stop();
});

test('a solo dispatch result takes card ownership away from the initial default selection', async () => {
  const doc = fakeDom();
  const app = fakeApp();
  const dispatchA = 'http://127.0.0.1:8805/?token=a-dispatch';
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') return { structuredContent: { enabled: true, items: [
      { agent_id: 'cccccccc-0000-0000-0000-000000000003', name: '旧任务C', status: 'completed' },
      { agent_id: 'dddddddd-0000-0000-0000-000000000004', name: '旧任务D', status: 'completed' },
    ], nativeReplay: { url: 'http://127.0.0.1:8792/?token=g', running: true } } };
    if (name === 'ds_wait') return new Promise(() => {});
    throw new Error('unexpected');
  };
  const card = createCard({ app, doc });
  await card.start();
  // Default selection is the LAST item (D). The dispatch result for A arrives.
  assert.equal(doc.byId.get('tasks').value, 'dddddddd-0000-0000-0000-000000000004');
  card.receive({ agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'running', nativeUrl: dispatchA, name: '任务A' });
  assert.equal(doc.byId.get('tasks').value, 'aaaaaaaa-0000-0000-0000-000000000001', 'dispatch owns the selection');
  assert.equal(doc.byId.get('frame').dataset.mounted, dispatchA, 'embed bound to the dispatched task');
  card.core.stop();
});

test('revocation closes the loop across bridge and card: null clears cache, withdraws, never remounts', async t => {
  const root = await mkdtemp(join(tmpdir(), 'revoke-loop-'));
  const pending = [];
  const instances = new Map();
  let bridge;
  let card;
  t.after(async () => {
    card?.core.stop();
    for (const request of pending.splice(0)) request.resume();
    await new Promise(resolve => setImmediate(resolve));
    await bridge?.close();
    await rm(root, { recursive: true, force: true });
  });
  const until = async (predicate, description) => {
    const deadline = Date.now() + 5000;
    while (!(await predicate())) {
      assert.ok(Date.now() < deadline, description);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  // Real Bridge and real card: replies are held until a lifecycle transition,
  // then returned through ds_wait. No direct card.receive for the revocation.
  const create = (record, options = {}) => {
    const runtime = {
      closed: false, patches: options.patches ?? [], options,
      start: async () => {},
      session: id => ({ getWorkingDirectory: async () => ({}) }),
      resumeSession: async () => {},
      run: () => new Promise((resolve, reject) => {
        runtime.reject = reject;
        runtime.finish = () => resolve({ finalResponse: 'done', events: [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] });
      }),
      close: async () => { runtime.closed = true; runtime.reject?.(new Error('closed')); },
    };
    const generations = instances.get(record.agent_id) ?? [];
    generations.push(runtime);
    instances.set(record.agent_id, generations);
    return runtime;
  };
  await mkdir(join(root, 'dsh-home', 'profiles'), { recursive: true });
  bridge = await new Bridge({ root, runtimeFactory: create, idleMs: 60_000, webEmbedBasePort: 8870 }).init();
  await bridge.setEnabled(true);
  const taskA = await bridge.start({ cwd: root, task: 'revoke A', permission: 'read-only' });
  const taskB = await bridge.start({ cwd: root, task: 'switch B', permission: 'read-only' });
  const ready = async (task, generation = 0) => {
    await until(() => instances.get(task.agent_id)?.[generation]?.finish, 'fake runtime must reach run');
    return instances.get(task.agent_id)[generation];
  };
  const publishUrl = async (task, url) => {
    const record = await bridge.read(task.agent_id);
    await writeFile(record.webUrlFile, JSON.stringify({ url, pid: 1 }));
    await until(async () => (await bridge.status(task.agent_id)).nativeUrl === url, 'bridge must collect the generation URL');
  };
  const runtimeA = await ready(taskA);
  await ready(taskB);
  const urlA1 = 'http://127.0.0.1:8871/?token=synthetic-a1';
  const urlA2 = 'http://127.0.0.1:8871/?token=synthetic-a2';
  const urlB = 'http://127.0.0.1:8872/?token=synthetic-b';
  await publishUrl(taskA, urlA1);
  await publishUrl(taskB, urlB);
  const doc = fakeDom();
  const app = fakeApp();
  const summaries = [];
  app.callServerTool = async ({ name, arguments: args }) => {
    app.calls.push({ name, args });
    if (name === 'ds_bridge') {
      return { structuredContent: await bridge.list() };
    }
    assert.equal(name, 'ds_wait');
    await new Promise(resume => pending.push({ resume }));
    const status = await bridge.wait(args.agent_id, 0);
    summaries.push(status);
    return { structuredContent: status };
  };
  card = createCard({ app, doc });
  card.receive(await bridge.status(taskA.agent_id));
  await card.start();
  assert.equal(doc.byId.get('frame').dataset.mounted, urlA1, 'live URL mounted');

  // Complete + release: the REAL summary must carry the explicit revocation.
  runtimeA.finish();
  await bridge.live.get(taskA.agent_id).done;
  await bridge.release(taskA.agent_id);
  const revokedSummary = await bridge.status(taskA.agent_id);
  assert.equal(revokedSummary.nativeUrl, null, 'bridge summary carries explicit null after release');
  const pumpUntil = async (predicate) => until(async () => {
    for (const request of pending.splice(0)) request.resume();
    return predicate();
  }, 'real ds_wait reply must update the card');
  await pumpUntil(() => summaries.some(status => status.agent_id === taskA.agent_id && status.nativeUrl === null)
    && doc.byId.get('frame').style.display === 'none');
  assert.equal(doc.byId.get('frame').style.display, 'none', 'revocation withdraws the page');
  assert.equal(doc.byId.get('frame').dataset.mounted, undefined, 'mount cleared');
  // Round-trip away and back: the dead URL must not remount from cache.
  const select = doc.byId.get('tasks');
  select.value = taskB.agent_id;
  select.dispatch('change');
  assert.equal(doc.byId.get('frame').dataset.mounted, urlB, 'B remains independently observable');
  select.value = taskA.agent_id;
  select.dispatch('change');
  assert.equal(doc.byId.get('frame').style.display, 'none', 'A/B round-trip does not revive the revoked URL');

  // Cold followup: a NEW generation URL arrives through the wait path.
  const followup = await bridge.followup(taskA.agent_id, 'again');
  card.receive(followup);
  await ready(taskA, 1);
  await publishUrl(taskA, urlA2);
  await pumpUntil(() => doc.byId.get('frame').dataset.mounted === urlA2);
  assert.equal(doc.byId.get('frame').dataset.mounted, urlA2, 'new generation remounts via ds_wait');
});

test('solo dispatch adds the missing select option, not just the value', () => {
  const doc = fakeDom();
  const card = createCard({ app: fakeApp(), doc });
  const old = { agent_id: 'dddddddd-0000-0000-0000-000000000004', name: '旧任务D', status: 'completed' };
  const dispatched = { agent_id: 'eeeeeeee-0000-0000-0000-000000000005', name: '新派发E', status: 'starting', nativeUrl: null };
  card.receive({ items: [old] });
  card.receive(dispatched);
  const select = doc.byId.get('tasks');
  assert.deepEqual(select.children.map(option => option.value), [old.agent_id, dispatched.agent_id]);
  assert.equal(select.children[1].textContent, dispatched.name);
  assert.equal(select.value, dispatched.agent_id);
  card.receive({ ...dispatched, status: 'running' });
  assert.equal(select.children.length, 2, 'repeated results do not duplicate options');
});

test('an explicitly pending task stays in its waiting view instead of showing global replay', () => {
  const doc = fakeDom();
  const card = createCard({ app: fakeApp(), doc });
  card.receive({
    items: [{ agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'pending A', status: 'starting', nativeUrl: null }],
    nativeReplay: { url: 'http://127.0.0.1:8792/?token=synthetic-other-history', running: true },
  });
  assert.equal(doc.byId.get('frame').style.display, 'none');
  assert.equal(doc.byId.get('frame').dataset.mounted, undefined);
  assert.equal(doc.byId.get('fallback').style.display, 'block');
});

test('an explicit host denial shows a useful fallback without navigating a blocked frame', () => {
  const doc = fakeDom();
  const app = fakeApp();
  app.getHostCapabilities = () => ({ sandbox: { csp: { frameDomains: [] } } });
  const card = createCard({ app, doc });
  const url = 'http://127.0.0.1:18911/?token=synthetic-policy-test';
  card.receive({ agent_id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'running', nativeUrl: url });
  assert.equal(doc.byId.get('frame').src, '', 'do not navigate into a known host block');
  assert.equal(doc.byId.get('frame').style.display, 'none');
  assert.equal(doc.byId.get('frame').dataset.mounted, undefined);
  assert.match(doc.byId.get('notice').textContent, /未允许内嵌/);
  assert.equal(doc.byId.get('open').href, url, 'external opening remains an explicit user action');
});
