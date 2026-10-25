import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorkerMcpClient,workerLaunchConfig } from '../src/worker-client.mjs';

async function fixture(t,extra='') {
  const root=await mkdtemp(join(tmpdir(),'native-worker-client-'));
  const configPath=join(root,'config.toml'),state=join(root,'state.json');
  await writeFile(configPath,`[mcp_servers.deepseek_worker]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(fileURLToPath(new URL('./fixtures/worker-mcp.mjs',import.meta.url)))}]\nenv_vars=["TEST_WORKER_SECRET"]\n[mcp_servers.deepseek_worker.env]\nFAKE_WORKER_STATE=${JSON.stringify(state)}\n${extra}`);
  t.after(()=>rm(root,{recursive:true,force:true}));
  const client=new WorkerMcpClient({configPath,env:{TEST_WORKER_SECRET:'synthetic'}});
  t.after(()=>client.close());
  return{client,state,configPath};
}

test('configured worker is lazy, respects disabled launchers, and rejects unsupported output caps before dispatch over real stdio',async t=>{
  const {client,state,configPath}=await fixture(t);
  await assert.rejects(readFile(state),/ENOENT/,'constructing an adapter cannot boot its configured worker');
  const config=await workerLaunchConfig({configPath,env:{TEST_WORKER_SECRET:'synthetic',UNLISTED_SECRET:'not forwarded'}});
  assert.equal(config.env.TEST_WORKER_SECRET,'synthetic');assert.equal(config.env.UNLISTED_SECRET,undefined);
  assert.deepEqual(await client.capabilities(),{outputCapField:null});
  await assert.rejects(client.start({task:'short',cwd:tmpdir(),issue_id:'same-issue',maxTokens:1024}),e=>!e.mayHaveRun&&/maxTokens/.test(e.message));
  await assert.rejects(readFile(state),/ENOENT/,'unsupported arguments must not create a remote task');
  const task=await client.start({task:'short',cwd:tmpdir(),name:'marker-unique',issue_id:'same-issue'});
  assert.equal((await client.find('marker-unique')).items[0].agent_id,task.agent_id);
  assert.equal((await client.wait(task.agent_id,0)).answer,'WORKER_OK');
  assert.equal((await client.events(task.agent_id)).next_cursor,'opaque:next');
  await writeFile(configPath,'[mcp_servers.deepseek_worker]\nenabled=false\n');
  await assert.rejects(workerLaunchConfig({configPath}),/disabled/);
});

test('a lost start acknowledgement is uncertain and is reconciled by a stable marker without replaying the mutation',async t=>{
  const {client,state}=await fixture(t,'FAKE_WORKER_LOST_ACK="once"\n');
  await assert.rejects(client.start({task:'short',cwd:tmpdir(),name:'lost-ack-marker',issue_id:'lost-ack-issue'}),e=>e.mayHaveRun===true);
  const found=await client.find('lost-ack-marker');
  assert.equal(found.items.length,1);
  assert.equal(JSON.parse(await readFile(state,'utf8')).starts,1);
});
