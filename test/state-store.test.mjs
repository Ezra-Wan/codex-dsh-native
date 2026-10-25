import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomicJson,readJson} from '../src/state-store.mjs';
import {Bridge} from '../src/bridge.mjs';
import {WorkerTasks} from '../src/worker-tasks.mjs';

test('NUL corruption preserves a valid previous JSON backup; a corrupt primary never replaces that backup',async t=>{
  const root=await mkdtemp(join(tmpdir(),'durable-dsh-'));t.after(()=>rm(root,{recursive:true,force:true}));const path=join(root,'state.json');
  await atomicJson(path,{turn:1});await atomicJson(path,{turn:2});await writeFile(path,Buffer.alloc(128));
  assert.deepEqual(await readJson(path),{turn:1,stateRecoveredFromBackup:true});
  await atomicJson(path,{turn:3});assert.deepEqual(await readJson(path),{turn:3});assert.deepEqual(JSON.parse(await readFile(path+'.bak','utf8')),{turn:1});
  await writeFile(path,Buffer.alloc(64));await writeFile(path+'.bak','null');await assert.rejects(readJson(path),e=>e.code==='STATE_CORRUPT');
});

test('backup settings fail closed, while task backup recovery is unknown and cannot restart a native prompt',async t=>{
  const root=await mkdtemp(join(tmpdir(),'durable-bridge-'));const bridge=await new Bridge({root,runtimeFactory:()=>{throw Error('must not boot');}}).init();
  t.after(async()=>{await bridge.close();await rm(root,{recursive:true,force:true});});
  await bridge.setEnabled(true);await bridge.setEnabled(false);await writeFile(join(root,'settings.json'),Buffer.alloc(20));
  assert.equal((await bridge.config()).enabled,false);assert.equal((await bridge.config()).stateRecoveredFromBackup,true);
  const id=randomUUID(),record={agent_id:id,session_id:id,status:'completed',cwd:root,persisted:true,returnChars:4000};
  await atomicJson(bridge.path(id),record);await atomicJson(bridge.path(id),{...record,turn:2});await writeFile(bridge.path(id),Buffer.alloc(64));
  assert.equal((await bridge.status(id)).status,'unknown');await assert.rejects(bridge.followup(id,'do not repeat'),/uncertain/);
  const worker=await new WorkerTasks({root,worker:{close:async()=>{}},enabled:async()=>true}).init();t.after(()=>worker.close());
  await atomicJson(worker.path(id),{...record,backend:'worker'});await atomicJson(worker.path(id),{...record,backend:'worker',turn:2});await writeFile(worker.path(id),Buffer.alloc(128));
  assert.equal((await worker.read(id)).status,'unknown');assert.equal((await worker.read(id)).submission,'uncertain');
});
