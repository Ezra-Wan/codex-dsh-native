import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTaskLayout, requestNativeViewClose } from '../ui/native-task-layout.mjs';

test('documented close extension is optional and never emits a duplicate successful close request', async()=>{
  const calls=[];
  const app={requestTeardown:async()=>calls.push('mcp')};
  assert.equal(await requestNativeViewClose(app,{requestClose:async()=>calls.push('openai')}),'openai');
  assert.deepEqual(calls,['openai']);
  assert.equal(await requestNativeViewClose(app,{}),'mcp');
  assert.equal(await requestNativeViewClose(app,{requestClose:async()=>{throw Error('extension unavailable');}}),'mcp');
  assert.deepEqual(calls,['openai','mcp','mcp']);
});

function setup() {
  const sizes=[],doc={documentElement:{style:{}},body:{style:{}}},root={style:{}};
  let closes=0;
  const layout=createNativeTaskLayout({app:{sendSizeChanged:async size=>sizes.push(size),requestTeardown:async()=>{closes++;}},doc,root});
  return {layout,sizes,doc,root,closes:()=>closes};
}

test('native host controls own close: leaving fullscreen requests teardown once without reopening or blanking an inline copy', async()=>{
  const {layout,sizes,doc,root,closes}=setup();
  await layout.context({displayMode:'inline'});
  assert.deepEqual(sizes,[{height:600}]);
  await layout.context({displayMode:'fullscreen'});
  const before=sizes.length;
  await layout.context({displayMode:'inline'});
  for(let i=0;i<100;i++)await layout.context({displayMode:'inline',containerDimensions:{height:200}});
  assert.equal(closes(),1,'notifications are not evidence that the host accepted closure');
  assert.equal(sizes.length,before,'do not inflate the source view while the host decides');
  assert.equal(root.style.display,undefined,'no second collapsed/blank presentation');
  assert.equal(doc.body.style.height,'100%');
});

test('open inline height repairs stay bounded without overriding native fullscreen geometry', async()=>{
  const {layout,sizes,doc}=setup();
  layout.mounted();const before=sizes.length;
  for(let i=0;i<100;i++)await layout.context({displayMode:'inline',containerDimensions:{height:200+i%5}});
  assert.equal(sizes.length,before+1);
  await layout.context({displayMode:'fullscreen'});
  assert.equal(doc.body.style.height,'100%');
  const full=sizes.length;
  for(let i=0;i<100;i++)await layout.context({displayMode:'fullscreen',containerDimensions:{height:900}});
  assert.equal(sizes.length,full);
});
