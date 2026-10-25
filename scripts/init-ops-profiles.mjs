// Explicit installation only. Ordinary MCP initialization never installs OPS.
import {mkdir,readFile,writeFile,cp,lstat,access} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {atomicJson} from '../src/state-store.mjs';
import {WEB_RUNTIME_PATCH} from '../src/web-profile.mjs';

const project=fileURLToPath(new URL('..',import.meta.url));
export const OPS_VERSION='0.3.0';
export async function prepareOpsProfiles({home,opsSource}={}){
  if(!home)throw Error('An explicit isolated --home is required');
  home=resolve(home);const profiles=join(home,'profiles');
  const link=await lstat(profiles).catch(e=>{if(e.code!=='ENOENT')throw e;});
  if(link?.isSymbolicLink())throw Error('Refusing to install through a task-home profiles junction');
  if(opsSource){opsSource=resolve(opsSource);const installed=JSON.parse(await readFile(join(opsSource,'package.json'),'utf8'));if(installed.name!=='dsh-ops'||installed.version!==OPS_VERSION)throw Error(`Expected original dsh-ops@${OPS_VERSION}`);}
  const dirs=[];
  for(const web of [false,true]){
    const name=web?'sdk-web-ops':'sdk-ops',dir=join(profiles,name);
    const existing=await readFile(join(dir,'package.json'),'utf8').then(JSON.parse).catch(e=>{if(e.code!=='ENOENT')throw e;});
    if(existing&&!existing.codexDshOpsProfile)throw Error(`Refusing to overwrite unmanaged ${name}`);
    await mkdir(dir,{recursive:true});
    const core=['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app',...(web?['@deepseek-ai/dsh-web-app']:[])];
    const manifest={name,private:true,type:'module',codexDshOpsProfile:1,dsh:{profile:{bundles:[...core,'dsh-ops']}},
      dependencies:{...Object.fromEntries(core.map(pkg=>[pkg,'0.2.1-rc.2'])),'dsh-ops':opsSource?`link:${opsSource.replaceAll('\\','/')}`:OPS_VERSION,...(web?{'@codex-dsh/web-embed':'link:./web-embed'}:{})},
      allowScripts:{'@deepseek-ai/dsh-subprocess-local@0.2.1-rc.2':true,'koffi@3.1.1':true,'node-pty@1.2.0-beta.15':true,'protobufjs@7.6.6':true}};
    if(web)await cp(join(project,'adapter','web-embed'),join(dir,'web-embed'),{recursive:true});
    await atomicJson(join(dir,'package.json'),manifest);
    await writeFile(join(dir,'cordis.yml'),'[]\n',{flush:true});
    // Installed is not enabled. The task overlay explicitly selects files or
    // full; background/PTC never become available merely by installing a bundle.
    await writeFile(join(dir,'cordis.patch.yml'),(web?WEB_RUNTIME_PATCH:'')+['shell','file','background','ptc'].map(part=>`- id: dsh-ops-${part}\n  disabled: true\n`).join(''),{flush:true});
    dirs.push(dir);
  }
  return dirs;
}
async function install(dir){
  let command='pnpm',prefix=[];
  if(process.platform==='win32'){
    let entry=process.env.CODEX_DSH_PNPM_ENTRY;
    if(!entry){const {stdout}=await promisify(execFile)('where.exe',['pnpm.cmd'],{windowsHide:true});entry=join(dirname(stdout.trim().split(/\r?\n/)[0]),'node_modules','pnpm','bin','pnpm.cjs');}
    await access(entry);command=process.execPath;prefix=[entry];
  }
  const result=await new Promise((resolveResult,reject)=>{
    const child=spawn(command,[...prefix,'install','--prefer-offline','--ignore-scripts','--dir',dir],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.on('data',b=>{output+=b;});child.once('error',reject);child.once('close',code=>resolveResult({code,output}));
  });
  await writeFile(join(dir,'install.log'),result.output,{flush:true});
  if(result.code!==0)throw Error(`OPS profile installation failed; inspect ${join(dir,'install.log')}`);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const value=flag=>{const i=process.argv.indexOf(flag);return i<0?undefined:process.argv[i+1];};
  const dirs=await prepareOpsProfiles({home:value('--home'),opsSource:value('--ops-source')});
  for(const dir of dirs){if(process.argv.includes('--install'))await install(dir);console.log(JSON.stringify({profile:dir,installed:process.argv.includes('--install'),opsVersion:OPS_VERSION,enabledByDefault:false}));}
}
