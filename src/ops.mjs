import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';

export const opsProfile=web=>web?'sdk-web-ops':'sdk-ops';
export async function assertOpsInstalled(profiles,web){
  try{
    const path=join(profiles,opsProfile(web),'package.json'),manifest=JSON.parse(await readFile(path,'utf8'));
    if(!manifest.codexDshOpsProfile||!manifest.dsh?.profile?.bundles?.includes('dsh-ops'))throw Error('Profile is not the explicit OPS composition');
    const requireProfile=createRequire(resolve(path)),pkg=JSON.parse(await readFile(requireProfile.resolve('dsh-ops/package.json'),'utf8'));
    if(pkg.version!=='0.3.0')throw Error('OPS installed version changed; compatibility must be revalidated');
  }catch(error){throw new Error(`OPS profile is unavailable: ${error.code==='ENOENT'?'run scripts/init-ops-profiles.mjs with the explicit isolated home':error.message}`);}
}
export async function writeOpsPatch(root,mode){
  if(!['files','full'].includes(mode))throw Error('OPS mode must be files or full');
  const dir=join(root,'patches');await mkdir(dir,{recursive:true});
  const text=['shell','file','background','ptc'].map(part=>`- id: dsh-ops-${part}\n  disabled: ${!(part==='file'||(part==='shell'&&mode==='full'))}\n`).join('');
  const path=join(dir,`ops-${mode}.yaml`),temporary=`${path}.${randomUUID()}.tmp`;
  await writeFile(temporary,text,{flush:true});await rename(temporary,path);return path;
}
