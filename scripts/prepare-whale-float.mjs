import {cp,mkdir,readFile,writeFile,access,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

export const WHALE_REVISION='4a7ec1240de82527f2222b4af5202fa7b2ad731b';
export function scopeWhaleWindows(source){
  const original='return candidates.Where(pid => !candidates.Contains(parents[pid])).ToArray();';
  if(source.split(original).length!==2)throw Error('Unsupported upstream Windows host selector');
  // Never fall back to the primary Codex window if the test instance exits.
  return source.replace(original,`int requested;
        if (!int.TryParse(Environment.GetEnvironmentVariable("CODEX_DSH_WHALE_TARGET_PID"), out requested) || requested <= 0) return new int[0];
        return candidates.Where(pid => pid == requested && !candidates.Contains(parents[pid])).ToArray();`);
}
export async function prepareWhale({source,home,codexHome,install=false}){
  source=resolve(source);home=resolve(home);codexHome=resolve(codexHome);
  const revision=spawnSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
  const dirty=spawnSync('git',['-C',source,'status','--porcelain','--untracked-files=no'],{encoding:'utf8',windowsHide:true});
  if(revision.status!==0||revision.stdout.trim()!==WHALE_REVISION||dirty.status!==0||dirty.stdout.trim())throw Error('Require the clean, pinned Codex-Whale-Public source revision');
  const license=await readFile(join(source,'LICENSE'),'utf8');if(!license.startsWith('MIT License'))throw Error('Upstream MIT license is missing');
  const selector=scopeWhaleWindows(await readFile(join(source,'desktop','WindowApi.cs'),'utf8'));
  const code=join(home,'code'),data=join(home,'data');
  try{await access(home);throw Error('Float home already exists; keep existing settings and use a new isolated home');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(code,{recursive:true});await mkdir(data,{recursive:true});
  for(const entry of ['desktop','runtime','lib','vendor','assets','scripts','.codex-plugin','package.json','LICENSE','THIRD_PARTY_NOTICES.md','PROVENANCE.md'])await cp(join(source,entry),join(code,entry),{recursive:true,errorOnExist:true,force:false});
  await writeFile(join(code,'desktop','WindowApi.cs'),selector,{flush:true});
  const {ConfigStore}=await import(pathToFileURL(join(code,'runtime','config.mjs')));
  new ConfigStore({dataDir:data,codexHome}).save({monitorSessions:false,connectionMode:'fixed',selectedConnection:'dsh-deepseek',currency:'CNY',refreshSeconds:60,
    connections:[{id:'dsh-deepseek',name:'DSH · DeepSeek 账户余额',baseUrl:'https://api.deepseek.com',keyEnv:'DEEPSEEK_API_KEY',
      balance:{adapter:'deepseek',request:{url:'/user/balance',auth:{type:'bearer',keyEnv:'DEEPSEEK_API_KEY'}},mapping:{scope:'account',currency:'CNY',confirmed:true}}}]});
  await writeFile(join(data,'follow-config.json'),JSON.stringify({enabled:true,mode:'follow-codex',pluginRoot:code,electronPath:join(data,'desktop-runtime/node_modules/electron/dist/electron.exe')},null,2),{flush:true});
  const receipt={source:'https://github.com/Yang-huai406/Codex-Whale-Public',revision:WHALE_REVISION,code,data,codexHome,license:'MIT',adaptation:'Windows root selector requires the explicit isolated Codex PID; no global window fallback',modelCalls:0,autoStartInstalled:false,registeredCodexPlugin:false,perTaskEstimate:'unavailable; Codex session monitoring disabled to avoid attributing GPT usage to DSH'};
  await writeFile(join(home,'receipt.json'),JSON.stringify(receipt,null,2),{flush:true});
  if(install){
    const log=await open(join(home,'install.log'),'a');
    try{await new Promise((yes,no)=>{
      const child=spawn(process.execPath,[join(code,'scripts/install-desktop.mjs')],{cwd:code,env:{...process.env,WHALE_HOME:data,CODEX_HOME:codexHome},windowsHide:true,stdio:['ignore',log.fd,log.fd]});
      const timer=setTimeout(()=>{if(child.pid){if(process.platform==='win32')spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}no(Error('Isolated runtime installation timed out; inspect install.log before retrying'));},300000);
      child.once('error',e=>{clearTimeout(timer);no(e);});child.once('exit',n=>{clearTimeout(timer);n===0?yes():no(Error(`Original Electron installer exited ${n}; inspect isolated install.log`));});
    });}
    finally{await log.close();}
  }
  return receipt;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);if(i<0||!args[i+1]||args[i+1].startsWith('--'))throw Error(`Required ${key}`);return args[i+1];};
  console.log(JSON.stringify(await prepareWhale({source:value('--source'),home:value('--home'),codexHome:value('--codex-home'),install:args.includes('--install')})));
}
