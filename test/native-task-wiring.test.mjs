import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createNativeDisplayMode } from '../ui/native-presentation.mjs';
import { createNativeTaskLayout } from '../ui/native-task-layout.mjs';

async function setup() {
  const source = (await readFile(new URL('../ui/native-task.mjs', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
  const calls = [], selected = [], nodes = new Map(), states = new Map();
  const node = id => nodes.get(id) ?? nodes.set(id, { style: {}, dataset: {}, options: [], hidden: false,
    textContent: '', value: '', addEventListener() {}, replaceChildren() {}, remove() {},
    appendChild(item) { this.options.push(item); } }).get(id);
  let tick, clears = 0;
  const app = { callServerTool: async ({ name, arguments: args }) => {
    calls.push({ name, args });
    const payload = name === 'native_state' ? states.get(args.agent_id) : name === 'native_tasks' ? { items: [] } : {};
    return { _meta: { payload } };
  }, sendSizeChanged: async () => {}, connect: async () => {}, getHostContext: () => ({ displayMode: 'inline' }),
    requestTeardown: async () => {}, requestDisplayMode: async () => { throw Error('must not force side open'); } };
  const result = await runInNewContext(`(async()=>{${source}\nreturn {receive,app,choose};})()`, {
    App: function() { return app; }, AppWebEntry: function() {}, createNativeDisplayMode, createNativeTaskLayout,
    createNativeTaskController: () => ({ select: async task => selected.push(task), clear: async () => { clears++; }, dispose: async () => {} }),
    requestNativeViewClose: async () => {}, installNativeFonts: async () => {},
    document: { getElementById: node, createElement: () => node(randomUUID()), head: node('head'),
      documentElement: node('html'), body: node('body'), hidden: false },
    window: { addEventListener() {} }, innerHeight: 600, crypto: { randomUUID },
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {}, console,
  });
  return { ...result, calls, selected, nodes, states, tick: () => tick(), clears: () => clears };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const task = (id, call, role = 'sub', frozen = false) => ({ agent_id: id, session_id: id, role, status: frozen ? 'completed' : 'running',
  observation: { call_id: call, start_seq: 4, end_seq: frozen ? 9 : null, frozen } });

test('actual app wiring never selects peer body inline; closing side cannot reopen it inline', async () => {
  const h = await setup();
  h.receive(task('A', 'A1', 'peer')); await settle();
  assert.equal(h.selected.length, 0);
  assert.equal(h.nodes.get('html').dataset.sideOnly, 'true');
  h.app.onhostcontextchanged({ displayMode: 'fullscreen' }); await settle();
  assert.equal(h.selected.at(-1).agent_id, 'A');
  const count = h.selected.length;
  h.app.onhostcontextchanged({ displayMode: 'inline' }); await settle();
  assert.equal(h.selected.length, count);
  assert.equal(h.nodes.get('html').dataset.sideOnly, 'true');
});

test('actual app wiring pins old invocation on poll and retry; side selection cannot rewrite its inline owner', async () => {
  const h = await setup(), a1 = task('A', 'A1');
  h.states.set('A', a1); h.states.set('B', task('B', 'B1'));
  h.receive(a1); await settle();
  await h.tick();
  assert.equal(h.calls.findLast(c => c.name === 'native_state').args.call_id, 'A1');
  await h.choose('A', true);
  assert.equal(h.calls.findLast(c => c.name === 'native_state').args.call_id, 'A1');
  h.app.onhostcontextchanged({ displayMode: 'fullscreen' }); await settle();
  await h.choose('B');
  assert.equal(h.calls.findLast(c => c.name === 'native_state').args.call_id, undefined, 'A call id is never sent to B');
  h.app.onhostcontextchanged({ displayMode: 'inline' }); await settle();
  assert.equal(h.selected.at(-1).agent_id, 'A');
  assert.equal(h.selected.at(-1).observation.call_id, 'A1');
  assert.equal(h.nodes.get('tasks').hidden, true);
});

test('settled inline invocation stops status polling; fullscreen still permits observing native history', async () => {
  const h = await setup();
  h.receive(task('A', 'A1', 'sub', true)); await settle();
  const before = h.calls.filter(c => c.name === 'native_state').length;
  await h.tick();
  assert.equal(h.calls.filter(c => c.name === 'native_state').length, before);
  h.app.onhostcontextchanged({ displayMode: 'fullscreen' }); await settle();
  h.states.set('A', task('A', 'A1', 'sub', true));
  await h.tick();
  assert.equal(h.calls.filter(c => c.name === 'native_state').length, before + 1);
});
