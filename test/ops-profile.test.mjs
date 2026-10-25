import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareOpsProfiles} from '../scripts/init-ops-profiles.mjs';

test('OPS installation prepares separate opt-in profiles and never overwrites a base profile or installs through task-home links',async t=>{
  const home=await mkdtemp(join(tmpdir(),'ops-profile-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await mkdir(join(home,'profiles','sdk-web'),{recursive:true});await writeFile(join(home,'profiles','sdk-web','sentinel'),'base');
  const dirs=await prepareOpsProfiles({home});assert.equal(dirs.length,2);
  assert.equal(await readFile(join(home,'profiles','sdk-web','sentinel'),'utf8'),'base');
  for(const dir of dirs){const p=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));assert.equal(p.dependencies['dsh-ops'],'0.3.0');assert.match(await readFile(join(dir,'cordis.patch.yml'),'utf8'),/dsh-ops-shell\n  disabled: true/);}
  const linked=join(home,'task-home');await mkdir(linked);await symlink(join(home,'profiles'),join(linked,'profiles'),'junction');
  await assert.rejects(prepareOpsProfiles({home:linked}),/junction/);
});
