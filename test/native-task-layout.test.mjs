import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeTaskLayout } from '../ui/native-task-layout.mjs';

function setup(persist = async()=>({revision:1})) {
  const sizes=[], doc={documentElement:{style:{}},body:{style:{}}},root={style:{}};
  const layout=createNativeTaskLayout({app:{sendSizeChanged:async size=>sizes.push(size)},doc,root,persist});
  layout.task('A',{collapsed:false,revision:0});
  return{layout,sizes,doc,root};
}

test('closing fullscreen preserves a compact inline entry and only explicit unfolding restores the body', async()=>{
  const saved=[];const {layout,sizes,root,doc}=setup(async(id,collapsed)=>{saved.push({id,collapsed});return{revision:saved.length};});
  await layout.setCollapsed(true);
  assert.equal(root.style.display,'none');
  await layout.context({displayMode:'fullscreen'});
  assert.equal(root.style.display,'block');assert.equal(doc.body.style.height,'100%');
  const before=sizes.length;
  await layout.context({displayMode:'inline'});
  assert.equal(root.style.display,'none');assert.equal(doc.body.style.height,'36px');
  assert.equal(sizes.length,before+1);assert.deepEqual(sizes.at(-1),{height:36});
  await layout.setCollapsed(false);
  assert.equal(root.style.display,'block');assert.deepEqual(sizes.at(-1),{height:600});
  assert.ok(saved.some(state=>state.collapsed),'the host-created inline copy can restore the collapsed state');
});

test('inline height repairs are bounded and stale presentation snapshots cannot reopen a collapsed view', async()=>{
  const saving=Promise.withResolvers();
  const {layout,sizes}=setup(()=>saving.promise);
  layout.mounted();const before=sizes.length;
  for(let i=0;i<100;i++)await layout.context({displayMode:'inline',containerDimensions:{height:200+i%5}});
  assert.equal(sizes.length,before+1,'a host clamp is not an unlimited resize negotiation');
  const collapse=layout.setCollapsed(true);
  layout.restore({collapsed:false,revision:0});assert.equal(layout.collapsed,true);
  saving.resolve({revision:2});await collapse;
  layout.restore({collapsed:false,revision:1});assert.equal(layout.collapsed,true);
});
