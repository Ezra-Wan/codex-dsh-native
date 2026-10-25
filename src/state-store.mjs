import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

const decode=text=>{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new SyntaxError('State must be a JSON object');return value;};
async function publish(path,text){
  const temporary=`${path}.${randomUUID()}.tmp`;
  try{
    // Flush file contents before publishing the rename. Rename alone is
    // insufficient: the observed BSOD left a renamed file full of NUL bytes.
    await writeFile(temporary,text,{mode:0o600,flush:true});await rename(temporary,path);
  }catch(error){await rm(temporary,{force:true}).catch(()=>{});throw error;}
}
export async function atomicJson(path,value){
  const text=JSON.stringify(value,null,2)+'\n';decode(text);await mkdir(dirname(path),{recursive:true});
  let previous;
  try{previous=await readFile(path,'utf8');decode(previous);}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;previous=undefined;}
  // Never overwrite a valid backup with a corrupt primary. Both files use
  // flushed temporary contents; no new task is dispatched by recovery.
  if(previous!==undefined)await publish(path+'.bak',previous);
  await publish(path,text);
}
export async function readJson(path){
  let primary;
  try{return decode(await readFile(path,'utf8'));}
  catch(error){if(error.code!=='ENOENT'&&!(error instanceof SyntaxError))throw error;primary=error;}
  try{return{...decode(await readFile(path+'.bak','utf8')),stateRecoveredFromBackup:true};}
  catch(error){
    if(primary.code==='ENOENT'&&error.code==='ENOENT')throw primary;
    throw Object.assign(new Error('State is unreadable and no valid backup is available; inspect before dispatching or resuming',{cause:primary}),{code:'STATE_CORRUPT'});
  }
}
