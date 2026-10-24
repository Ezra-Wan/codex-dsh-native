import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTaskController } from '../ui/native-task-controller.mjs';
import { registerSessionTarget } from '../ui/native-session-target.mjs';
import { nativeTaskBootstrap } from '../src/native-task-bootstrap.mjs';
import { splitNativeFonts } from '../ui/native-fonts.mjs';
import { registerNativeTaskUi } from '../src/native-task-ui.mjs';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const tick = () => new Promise(resolve => setImmediate(resolve));

test('the installed native module parser accepts our receiver and rejects its previously missing batch', async()=>{
  let factory;
  const source=await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-modules/client')),'utf8');
  runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{factory=entry.factory;}}}});
  const {parseBootManifest}=factory(()=>{throw new Error('The native parser needs no external module');});
  const workspace='@deepseek-ai/dsh-client-ui-workspace';
  const boot={rev:'native-receiver-contract',entries:[{id:workspace,url:'/workspace.js',rev:'1'}],
    batches:[{phase:'application',url:'/workspace.js',rev:'1',entries:[workspace]}]};
  registerSessionTarget({loader:{load(){}},boot,readTarget:()=>undefined});
  assert.doesNotThrow(()=>parseBootManifest(boot));
  boot.batches.pop();
  assert.throws(()=>parseBootManifest(boot),/belongs to no initial-load batch/);
});

test('a stale native bootstrap cannot mount under the next task; stable task needs no remount', async () => {
  const first=Promise.withResolvers(), calls=[], mounts=[], disposed=[];
  const controller=createNativeTaskController({
    call:async(name,args)=>{
      calls.push({name,args});
      if(name==='native_bootstrap'&&args.agent_id==='A')return first.promise;
      if(name==='native_bootstrap')return{viewId:'view-B',task:{runtimeGeneration:2}};
      return{};
    },
    mount:async data=>{mounts.push(data.viewId);return{dispose:async()=>disposed.push(data.viewId)};},
  });
  const a=controller.select({agent_id:'A'});await tick();
  const b=controller.select({agent_id:'B'});
  first.resolve({viewId:'stale-A',task:{runtimeGeneration:1}});
  await Promise.all([a,b]);
  assert.deepEqual(mounts,['view-B']);
  assert.ok(calls.some(call=>call.name==='native_view_close'&&call.args.viewId==='stale-A'));
  await controller.select({agent_id:'B',runtimeGeneration:2});
  assert.equal(mounts.length,1,'status/display-only changes keep the same native tree');
  await controller.select({agent_id:'B',runtimeGeneration:3});
  assert.deepEqual(disposed,['view-B']);
  await controller.dispose();
});

test('native session navigation selects exact identities, creates nothing and disposes pending work', async () => {
  let factory, target='same-cwd-root-A', changed;
  const opened=[];
  const readTarget=()=>target;readTarget.subscribe=listener=>{changed=listener;return()=>{changed=undefined;};};
  const boot={entries:[]};
  registerSessionTarget({loader:{load:entry=>{factory=entry.factory;}},boot,readTarget});
  const plugin=factory();
  let phase='loading', sessionChanged;
  const ctx={uiWorkspace:{openSession:value=>opened.push(value)},
    sessions:{list:{getSnapshot:()=>({phase}),subscribe:listener=>{sessionChanged=listener;return()=>{};}}},
    workspaces:{list:{getSnapshot:()=>({phase}),subscribe:()=>()=>{}}}};
  const dispose=plugin.apply(ctx);
  await tick();
  assert.deepEqual(opened,[],'native baseline readiness precedes automatic selection');
  phase='ready';sessionChanged();await tick();
  target='same-cwd-root-B';changed();await tick();
  const child={kind:'subagent',parentSessionId:'same-cwd-root-B',childSessionId:'child-B'};
  target=child;changed();await tick();
  assert.deepEqual(opened,['same-cwd-root-A','same-cwd-root-B',child]);
  target='late';changed();dispose();await tick();
  assert.equal(opened.length,3);
  assert.deepEqual(plugin.inject,['workspaces','sessions','uiWorkspace']);
  assert.equal(boot.entries[0].id,'integration:codex-session-target');
  assert.deepEqual(boot.batches[0].entries,['integration:codex-session-target'],'every native graph row belongs to an initial-load batch');
});

test('status arriving during a slow native boot never restarts it; a boot failure waits for explicit retry', async()=>{
  const ready=Promise.withResolvers();let opens=0,mounts=0,failures=0;
  const controller=createNativeTaskController({
    call:async name=>{if(name==='native_bootstrap'){opens++;return ready.promise;}return{};},
    mount:async()=>{mounts++;throw new Error('static boot contract failed');},failed:()=>{failures++;},
  });
  const boot=controller.select({agent_id:'A'});await tick();
  const p1=controller.select({agent_id:'A',runtimeGeneration:1,status:'running'});
  const p2=controller.select({agent_id:'A',runtimeGeneration:1,status:'running'});
  ready.resolve({viewId:'slow-view',task:{runtimeGeneration:1}});
  await Promise.all([boot,p1,p2]);
  assert.equal(opens,1);assert.equal(mounts,1);assert.equal(failures,1);
  await controller.select({agent_id:'A',runtimeGeneration:1,status:'running'});
  assert.equal(opens,1,'a state refresh must not retry a fatal mount error');
  await controller.select({agent_id:'A'}, {force:true});
  assert.equal(opens,2);
  await controller.dispose();
});

test('native bootstrap preserves official runtime factories but excludes its auto-running entry', async () => {
  const seen=[];
  const peer={shell:async()=>'<script>globalThis.originalBoot=true</script><script type="module" src="/assets/entry.js"></script><link rel="preload" as="script" href="/plugins/??native"><link rel="stylesheet" href="/assets/native.css">',
    asset:async path=>{seen.push(path);return path.endsWith('.css')?'#native{color:red}':'globalThis.nativeFactory=true';}};
  const data=await nativeTaskBootstrap(peer);
  assert.equal(data.injected.length,1);assert.equal(data.batches.length,1);
  assert.deepEqual(seen.sort(),['/assets/native.css','/plugins/??native']);
  assert.equal(data.css,'#native{color:red}');
});

test('native font packing retains byte-backed font descriptors without browser data URLs', () => {
  const result=splitNativeFonts('@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:700;src:url(data:font/woff2;base64,AA==) format("woff2")}p{color:red}');
  assert.deepEqual(result.fonts,[{family:'KaTeX_Main',style:'italic',weight:'700',bytes:'AA=='}]);
  assert.equal(result.css,'p{color:red}');
});

test('a view capability is private, generation-scoped, and revocation releases only its own runtime lease', async () => {
  const handlers=new Map(), peers=[], retained=[], released=[];
  const states={A:{agent_id:'A',session_id:'session-A',nativeUrl:'http://127.0.0.1:19001/?token=secret-A',runtimeGeneration:1},
    B:{agent_id:'B',session_id:'session-B',nativeUrl:'http://127.0.0.1:19002/?token=secret-B',runtimeGeneration:1}};
  const server={registerTool(name,config,handler){handlers.set(name,handler);},registerResource(){}};
  const ui=registerNativeTaskUi(server,{
    resolveTask:async id=>states[id],listTasks:async()=>Object.values(states),
    retainView:async id=>{retained.push(id);return async()=>{released.push(id);};},
    peerFactory:url=>{const peer={url,closed:false,shell:async()=>'',close(){this.closed=true;},rpc:async()=>({ok:true})};peers.push(peer);return peer;},
  });
  try{
    const a=await handlers.get('native_bootstrap')({agent_id:'A'}), b=await handlers.get('native_bootstrap')({agent_id:'B'});
    assert.doesNotMatch(JSON.stringify(a),/secret-A/,'launch tokens never enter native UI responses');
    assert.equal(a._meta.payload.task.nativeViewAvailable,true);
    assert.deepEqual(a.content,[{type:'text',text:'Native view response'}]);
    states.A.runtimeGeneration=2;
    const revoked=await handlers.get('native_rpc')({viewId:a._meta.payload.viewId,endpoint:'session/list',payload:{}});
    assert.equal(revoked.isError,true);assert.match(revoked.content[0].text,/generation changed/);
    const live=await handlers.get('native_rpc')({viewId:b._meta.payload.viewId,endpoint:'session/list',payload:{}});
    assert.equal(live._meta.payload.ok,true);assert.equal(peers[1].closed,false);
    assert.deepEqual(retained,['A','B']);assert.deepEqual(released,['A']);
  }finally{ui.close();}
  assert.deepEqual(released,['A','B']);
});

test('a revoked runtime withdraws the native view until a new generation becomes available', async()=>{
  const calls=[],disposed=[];
  const controller=createNativeTaskController({
    call:async(name,args)=>{calls.push({name,args});return{viewId:'native-view',task:{runtimeGeneration:2}};},
    mount:async()=>({dispose:async()=>disposed.push(true)}),
  });
  await controller.select({agent_id:'A',runtimeGeneration:2});
  await controller.select({agent_id:'A',runtimeGeneration:2,nativeViewAvailable:false,status:'completed'});
  assert.equal(controller.current(),null);assert.equal(disposed.length,1);
  assert.equal(calls.filter(call=>call.name==='native_bootstrap').length,1);
  await controller.select({agent_id:'A',runtimeGeneration:3,nativeViewAvailable:true,status:'running'});
  assert.equal(calls.filter(call=>call.name==='native_bootstrap').length,2);
  await controller.dispose();
});
