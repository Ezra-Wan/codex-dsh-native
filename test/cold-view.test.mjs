import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Bridge} from '../src/bridge.mjs';
import {bridgeTaskResolver} from '../src/native-task-ui.mjs';

test('cold native history remount is prompt-free, retains delivery identity and budget, and remains available with dispatch disabled',async()=>{
  const root=await mkdtemp(join(tmpdir(),'native-cold-view-')),history=new Set();let runs=0,resumes=0;
  const factory=record=>({start:async()=>{await writeFile(record.webUrlFile,JSON.stringify({url:`http://127.0.0.1:1/?token=synthetic-${record.runtimeGeneration}`}));},
    session:id=>({getWorkingDirectory:async()=>{history.add(id);}}),resumeSession:async id=>{assert.ok(history.has(id));resumes++;},
    run:async()=>{runs++;return{finalResponse:'preserved answer',events:[{type:'turn/end',data:{reason:{kind:'completed'}}}]};},close:async()=>{}});
  let bridge=await new Bridge({root,runtimeFactory:factory}).init();
  try{
    await mkdir(bridge.homeProfilesRoot(),{recursive:true});await bridge.setEnabled(true);
    const first=await bridge.start({cwd:root,task:'single turn',permission:'read-only',maxTokens:1024});await bridge.live.get(first.agent_id).done;
    await bridge.close();bridge=await new Bridge({root,runtimeFactory:factory}).init();await bridge.setEnabled(false);
    const restored=await bridgeTaskResolver(bridge)(first.agent_id,true);
    assert.equal(restored.turn,1);assert.equal(restored.status,'completed');assert.equal(restored.final,'preserved answer');assert.equal(restored.maxTokens,1024);
    assert.equal(restored.session_id,first.session_id);assert.equal(restored.runtimeGeneration,2);assert.equal(resumes,1);assert.equal(runs,1,'opening history must never call runtime.run');
    const other=await new Bridge({root,runtimeFactory:factory}).init();await assert.rejects(other.openView(first.agent_id),/owned/);await other.close();
    const next=bridge.nextWebPort();assert.notEqual(next,bridge.live.get(first.agent_id).record.webPort,'new task port cannot collide with a restored view');
  }finally{await bridge.close();await rm(root,{recursive:true,force:true});}
});
