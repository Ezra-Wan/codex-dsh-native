import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Context} from '@deepseek-ai/cordis';
import {WebServer} from '@deepseek-ai/dsh-host-webserver';
import {apply as webEmbed} from '../adapter/web-embed/lib/index.js';
import {Bridge} from '../src/bridge.mjs';

test('two real upstream webservers publish distinct OS-bound loopback origins through the real adapter',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-real-ports-')),contexts=[];
  t.after(async()=>{for(const ctx of contexts)await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});});
  const urls=[];
  for(const name of ['A','B']){
    const ctx=new Context();contexts.push(ctx);
    ctx.provide('connection',{authenticatedUrl:origin=>`${origin}/?token=synthetic`});
    ctx.plugin(WebServer,{host:'127.0.0.1',port:0,compression:'none'});
    const urlFile=join(root,`${name}.json`);ctx.plugin(webEmbed,{urlFile});
    let data;
    for(let i=0;i<100&&!data;i++){
      data=await readFile(urlFile,'utf8').then(JSON.parse).catch(()=>null);
      if(!data)await new Promise(done=>setTimeout(done,10));
    }
    assert.ok(data,'the real provider+adapter must announce its bound port');
    const url=new URL(data.url);assert.equal(url.hostname,'127.0.0.1');assert.ok(Number(url.port)>0);urls.push(url);
  }
  assert.notEqual(urls[0].port,urls[1].port,'the OS holds both listeners simultaneously');
});

test('concurrent tasks use distinct task/generation files while both request port zero',async t=>{
  const root=await mkdtemp(join(tmpdir(),'dsh-port-files-')),records=[];
  const bridge=await new Bridge({root,runtimeFactory:record=>{
    records.push(record);return{start:async()=>{},session:()=>({getWorkingDirectory:async()=>root}),close:async()=>{},run:async()=>({events:[],finalResponse:'ok'})};
  }}).init();
  t.after(async()=>{await bridge.close();await rm(root,{recursive:true,force:true});});
  await mkdir(bridge.homeProfilesRoot(),{recursive:true});await bridge.setEnabled(true);
  const a=await bridge.start({cwd:root,task:'A',permission:'read-only'}),b=await bridge.start({cwd:root,task:'B',permission:'read-only'});
  await Promise.all([bridge.live.get(a.agent_id).done,bridge.live.get(b.agent_id).done]);
  assert.equal(records.length,2);assert.ok(records.every(r=>r.webRequestedPort===0));
  assert.notEqual(records[0].webUrlFile,records[1].webUrlFile);
  for(const record of records){
    assert.match(record.webUrlFile,new RegExp(`${record.agent_id}-1\\.json$`));
    const patch=await readFile(join(root,'patches',`web-embed-${record.agent_id}-1.yaml`),'utf8');
    assert.match(patch,/port: 0\b/);assert.ok(patch.includes(record.webUrlFile.replaceAll('\\','\\\\'))||patch.includes(record.webUrlFile));
  }
});
