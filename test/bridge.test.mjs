import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bridge } from '../src/bridge.mjs';
import {prepareOpsProfiles} from '../scripts/init-ops-profiles.mjs';

function factory() {
  const histories = new Map();
  const instances = [];
  return {
    histories, instances,
    create(record, options = {}) {
      const runtime = {
        closed: false, resumed: false, patches: options.patches ?? [], options, record,
        start: async () => {},
        session: id => ({ getWorkingDirectory: async () => { histories.set(id, []); return record.cwd; } }),
        resumeSession: async id => {
          if (!histories.has(id)) throw new Error('Native history missing');
          runtime.resumed = true;
        },
        run: (task, { sessionId, onNotification }) => new Promise((resolve, reject) => {
          runtime.reject = reject;
          runtime.emit = (event, sessionIdOverride) => onNotification?.({ method: 'session.event', params: { sessionId: sessionIdOverride ?? sessionId, event } });
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

test('native view leases retain their runtime, enforce capacity and release independently', async t => {
  const {root,bridge,fake}=await setup(t);
  bridge.maxParallel=1;
  await bridge.setEnabled(true);
  const task=await bridge.start({cwd:root,task:'retained',permission:'read-only',webEmbed:false});
  const runtime=await ready(fake);
  const releaseA=await bridge.retainView(task.agent_id), releaseB=await bridge.retainView(task.agent_id);
  runtime.finish();await bridge.wait(task.agent_id);
  await bridge.release(task.agent_id);
  assert.equal(runtime.closed,false);
  await assert.rejects(bridge.start({cwd:root,task:'cannot evict visible runtime',permission:'read-only',webEmbed:false}),/retained/);
  await releaseA();await releaseA();
  assert.equal(bridge.live.get(task.agent_id).viewCount,1,'a view lease releases only once');
  await releaseB();
  await bridge.release(task.agent_id);
  assert.equal(runtime.closed,true);
});

test('explicit stop still closes a running task with a native view lease', async t => {
  const {root,bridge,fake}=await setup(t);await bridge.setEnabled(true);
  const task=await bridge.start({cwd:root,task:'running',permission:'read-only',webEmbed:false});
  const runtime=await ready(fake), release=await bridge.retainView(task.agent_id);
  await bridge.stop(task.agent_id);
  assert.equal(runtime.closed,true);assert.equal(bridge.live.has(task.agent_id),false);
  await release();
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

test('dynamic root concurrency persists across reconnects and lowering does not interrupt active tasks',async t=>{
  const {root,bridge,fake}=await setup(t);await bridge.configure({enabled:true,maxParallel:1});
  const first=await bridge.start({cwd:root,task:'A',permission:'read-only',webEmbed:false});await ready(fake);
  await assert.rejects(bridge.start({cwd:root,task:'B',permission:'read-only',webEmbed:false}),/capacity/);
  await bridge.configure({maxParallel:3});
  const second=await bridge.start({cwd:root,task:'B',permission:'read-only',webEmbed:false});await ready(fake,1);
  await bridge.configure({maxParallel:1});assert.equal(fake.instances[0].closed,false);assert.equal(fake.instances[1].closed,false);
  assert.equal((await bridge.config()).enabled,true);await assert.rejects(bridge.configure({maxParallel:9}),/1 to 8/);
  fake.instances[0].finish();fake.instances[1].finish();await bridge.wait(first.agent_id);await bridge.wait(second.agent_id);await bridge.close();
  const restored=await new Bridge({root,runtimeFactory:fake.create}).init();t.after(()=>restored.close());
  assert.equal(restored.maxParallel,1);await restored.setEnabled(false);assert.equal((await restored.config()).maxParallel,1);
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
  assert.equal((await bridge.status(first.agent_id)).failure.kind,'requested_stop');
  assert.equal(fake.instances[1].closed, false);
  fake.instances[1].finish();
  assert.equal((await bridge.wait(second.agent_id)).status, 'completed');
});

test('native network loss records its cause; a missing controller becomes unknown and cannot replay a prompt',async t=>{
  const {root,bridge,fake}=await setup(t);await bridge.setEnabled(true);
  bridge.networkSnapshot=()=>({localInterfaceAvailable:false,internetReachable:null});
  const task=await bridge.start({cwd:root,task:'one request',webEmbed:false});
  (await ready(fake)).reject(new Error('fetch failed',{cause:Object.assign(Error('down'),{code:'ENETDOWN'})}));
  const failed=await bridge.wait(task.agent_id);assert.equal(failed.status,'failed');assert.equal(failed.failure.kind,'network_unavailable');
  assert.equal((await bridge.read(task.agent_id)).failure.code,'ENETDOWN');assert.equal(fake.instances.length,1);
  await bridge.release(task.agent_id);
  const record=await bridge.read(task.agent_id);await bridge.save({...record,status:'running',failure:null});
  const lost=await bridge.status(task.agent_id);assert.equal(lost.status,'unknown');assert.equal(lost.failure.kind,'controller_lost');
  await assert.rejects(bridge.followup(task.agent_id,'do not replay'),/uncertain/);assert.equal(fake.instances.length,1);
});

test('another bridge instance cannot write an owned native session', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first', webEmbed: false });
  (await ready(fake)).finish();
  await bridge.wait(first.agent_id);
  const other = await new Bridge({ root, runtimeFactory: fake.create }).init();
  try { await assert.rejects(other.followup(first.agent_id, 'steal'), /owned by another/); }
  finally { await other.close(); }
});

test('long final answers are bounded in tool output and preserved in a file', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd: root, task: 'first', webEmbed: false });
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

test('subagent tasks mount the official delegation patch and record role', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'delegate docs', subagents: true, role: 'sub', name: '[X·sub] docs', webEmbed: false });
  const runtime = await ready(fake);
  assert.equal(runtime.patches.length, 2);
  const patch = await readFile(runtime.patches[1], 'utf8');
  assert.match(patch, /dsh-subagent-spawn-in-process/);
  assert.match(patch, /provider: spawn/);
  runtime.finish();
  const summary = await bridge.wait(task.agent_id);
  assert.equal(summary.role, 'sub');
  assert.equal(summary.subagents, true);
});

test('plain SDK tasks keep native execution and explicitly disable optional delegation', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  await bridge.start({ cwd: root, task: 'plain', permission: 'read-only', webEmbed: false });
  const runtime = await ready(fake);
  assert.equal(runtime.patches.length,1);
  const patch=await readFile(runtime.patches[0],'utf8');assert.match(patch,/tool-subagent\n  disabled: true/);assert.doesNotMatch(patch,/id: tool-fs\n/);
  runtime.finish();
});

test('OPS fails before dispatch when absent, uses its separate profile when enabled, and retains the choice on cold continuation',async t=>{
  const {root,bridge,fake}=await setup(t);await bridge.setEnabled(true);
  await assert.rejects(bridge.start({cwd:root,task:'not dispatched',ops:'files',webEmbed:false}),/OPS profile is unavailable/);assert.equal(fake.instances.length,0);
  for(const dir of await prepareOpsProfiles({home:bridge.home})){
    const module=join(dir,'node_modules','dsh-ops');await mkdir(module,{recursive:true});await writeFile(join(module,'package.json'),JSON.stringify({name:'dsh-ops',version:'0.3.0'}));
  }
  const first=await bridge.start({cwd:root,task:'use files',ops:'files',webEmbed:false,maxTokens:1024});const runtime=await ready(fake);
  assert.equal(runtime.options.profile,'sdk-ops');
  const patches=await Promise.all(runtime.patches.map(p=>readFile(p,'utf8')));assert.ok(patches.some(p=>/dsh-ops-shell\n  disabled: true/.test(p)&&/dsh-ops-file\n  disabled: false/.test(p)));
  runtime.finish();await bridge.wait(first.agent_id);await bridge.close();
  const cold=await new Bridge({root,runtimeFactory:fake.create}).init();t.after(()=>cold.close());
  const resumed=await cold.followup(first.agent_id,'same plugins');assert.equal(resumed.ops,'files');assert.equal(resumed.maxTokens,1024);
  (await ready(fake,1)).finish();await cold.wait(first.agent_id);
});

test('descendant session events land in children, not as bridge agents', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'spawn children', permission: 'read-only', webEmbed: false });
  const runtime = await ready(fake);
  const childId = '11111111-2222-3333-4444-555555555555';
  runtime.emit({ type: 'turn/start', seq: 1, time: 1, data: { turn: 1 } }, childId);
  runtime.emit({ type: 'tool/call', seq: 2, time: 2, data: { callId: 'c1', name: 'read', arguments: '{}' } }, childId);
  const mid = await bridge.status(task.agent_id);
  assert.equal(mid.children.length, 1);
  assert.equal(mid.children[0].child_id, childId);
  assert.equal(mid.children[0].lastEvent, 'tool/call');
  runtime.finish();
  const done = await bridge.wait(task.agent_id);
  assert.equal(done.children[0].child_id, childId);
  // The child id is not itself an agent: following it up must fail.
  await assert.rejects(bridge.followup(childId, 'drive'), /ENOENT|Invalid agent_id/);
  await bridge.release(task.agent_id);
  const cold = await new Bridge({ root, runtimeFactory: fake.create }).init();
  t.after(() => cold.close());
  await cold.followup(task.agent_id, 'continue without losing previous children');
  const nextRuntime = await ready(fake, 1);
  const nextChild = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  nextRuntime.emit({ type: 'turn/start', seq: 1, time: 3, data: { turn: 1 } }, nextChild);
  nextRuntime.finish();
  const continued = await cold.wait(task.agent_id);
  assert.deepEqual(continued.children.map(child => child.child_id).sort(), [childId, nextChild].sort());
  assert.deepEqual(Object.keys((await cold.read(task.agent_id)).children).sort(), [childId, nextChild].sort());
});

test('child OPS executor failures remain visible in parent completion even when the plugin uses isError=false',async t=>{
  const {root,bridge,fake}=await setup(t);await bridge.setEnabled(true);
  const task=await bridge.start({cwd:root,task:'observe child failure',permission:'read-only',webEmbed:false});const runtime=await ready(fake),child='11111111-2222-3333-4444-555555555555';
  runtime.emit({type:'tool/call',seq:2,time:2,data:{callId:'ops1',name:'ops_bash',arguments:'{}'}},child);
  runtime.emit({type:'tool/result',seq:3,time:3,data:{message:{toolCallId:'ops1',isError:false,content:[{type:'text',text:'[error: EXECUTOR_UNAVAILABLE: native shell did not start]\n[exit code: 256]'}]}}},child);
  runtime.finish();const done=await bridge.wait(task.agent_id);assert.equal(done.status,'completed_with_warnings');assert.equal(done.warnings[0].session_id,child);assert.equal(done.warnings[0].tool,'ops_bash');
  const disk=await bridge.read(task.agent_id);assert.match(disk.warnings[0].message,/EXECUTOR_UNAVAILABLE/);
});

test('extra user prompts mark a user takeover for the next parent read', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'original', permission: 'read-only' });
  const runtime = await ready(fake);
  // The real SDK echoes the bridge prompt back as a kind=user user/message;
  // a second one is the user steering this peer from the native UI.
  runtime.emit({ type: 'user/message', seq: 4, time: 4, data: { message: { content: [{ type: 'text', text: 'original' }], source: { kind: 'user' } } } });
  runtime.emit({ type: 'user/message', seq: 5, time: 5, data: { message: { content: [{ type: 'text', text: 'user steering' }], source: { kind: 'user' } } } });
  runtime.finish();
  const result = await bridge.wait(task.agent_id);
  assert.equal(result.userTakeover.events, 1);
  assert.match(result.userTakeover.hint, /outside the bridge/);
});

test('followup refuses while the session log shows fresh external writes', async t => {
  const { root, bridge, fake } = await setup(t);
  await bridge.setEnabled(true);
  const task = await bridge.start({ cwd: root, task: 'first', webEmbed: false });
  (await ready(fake)).finish();
  await bridge.wait(task.agent_id);
  const sessionDir = join(bridge.home, 'sessions', '--D-workspace--', task.session_id);
  await mkdir(sessionDir, { recursive: true });
  const logPath = join(sessionDir, 'session.v4.jsonl.zstd');
  await writeFile(logPath, '{}\n');
  const fresh = new Date(Date.now() - 5_000);
  await utimes(logPath, fresh, fresh);
  // Fresh writes only read as external when they postdate the bridge's own mark;
  // followup prefers the live in-memory record, so age both copies.
  {
    const mark = Date.now() - 300_000;
    const entry = bridge.live.get(task.agent_id);
    if (entry) entry.record.lastSelfWriteAt = mark;
    const record = await bridge.read(task.agent_id);
    await bridge.save({ ...record, lastSelfWriteAt: mark });
  }
  await assert.rejects(bridge.followup(task.agent_id, 'next'), /external writes/);
  const stale = new Date(Date.now() - 300_000);
  await utimes(logPath, stale, stale);
  const next = await bridge.followup(task.agent_id, 'next');
  assert.ok(['starting', 'running'].includes(next.status), `unexpected status ${next.status}`);
});
