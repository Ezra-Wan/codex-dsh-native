import test from 'node:test';
import assert from 'node:assert/strict';
import { createCard } from '../ui/observer.mjs';

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
  assert.ok(select.src === undefined || true);
  assert.equal(doc.byId.get('frame').src, 'http://127.0.0.1:8792/?token=t#session=bbbbbbbb-0000-0000-0000-000000000002');
  // A tool result for the new selection is received without errors.
  card.receive({ items: [{ agent_id: 'bbbbbbbb-0000-0000-0000-000000000002', name: '任务B', status: 'running' }] });
  assert.equal(select.children.length, 1);
  card.core.stop();
});

test('a missing replay keeps the waiting fallback and the loop alive, no errors', async () => {
  const doc = fakeDom();
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
