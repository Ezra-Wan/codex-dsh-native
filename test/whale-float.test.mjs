import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareWhale} from '../scripts/prepare-whale-float.mjs';
test('unverified whale source fails before creating an installation or settings',async t=>{
  const root=await mkdtemp(join(tmpdir(),'whale-preflight-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const home=join(root,'not-created');
  await assert.rejects(prepareWhale({source:root,home,codexHome:join(root,'codex')}),/clean, pinned/);
  await assert.rejects(access(home),{code:'ENOENT'});
});
