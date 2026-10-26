import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('Windows PowerShell restart preflight reads Chinese UTF-8 JSON without closing any process', {skip:process.platform!=='win32'}, async () => {
  const root=await mkdtemp(join(tmpdir(),'dsh-restart-utf8-'));
  try {
    await mkdir(join(root,'tasks'));
    const task=join(root,'tasks','aaaaaaaa-0000-4000-8000-000000000001.json');
    await writeFile(task,JSON.stringify({name:'并行测试：中文历史与引号“正文”',status:'completed',final:'完成，未改权限。'}),'utf8');
    const manifest=join(root,'plan.json');
    await writeFile(manifest,JSON.stringify({BridgeRoot:root,PrimaryPid:process.pid,IsolatedPid:0}),'utf8');
    const executable=join(process.env.WINDIR,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const run=()=>spawnSync(executable,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
      fileURLToPath(new URL('../scripts/restart-codex-primary.ps1',import.meta.url)),'-Manifest',manifest,'-CheckOnly'],
      {encoding:'utf8',windowsHide:true});
    assert.equal(run().status,0);
    let state=JSON.parse((await readFile(join(root,'restart-state.json'),'utf8')).replace(/^\uFEFF/,''));
    assert.equal(state.Phase,'checked');
    assert.equal(state.NewPrimaryPid,0);
    // A corrupt state must fail closed, rather than skip it and kill the app.
    await writeFile(task,'{"status":','utf8');
    assert.equal(run().status,1);
    state=JSON.parse((await readFile(join(root,'restart-state.json'),'utf8')).replace(/^\uFEFF/,''));
    assert.equal(state.Phase,'failed');
    assert.match(state.Detail,/unreadable UTF-8 JSON/);
    assert.doesNotMatch(state.Detail,/中文历史|final/);
  } finally {await rm(root,{recursive:true,force:true});}
});
