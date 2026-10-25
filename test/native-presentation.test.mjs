import test from 'node:test';
import assert from 'node:assert/strict';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { Context } from '@deepseek-ai/cordis';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { createNativeDisplayMode, registerNativePresentation } from '../ui/native-presentation.mjs';
const locale={bind:ns=>key=>`${ns}.${key}`,subscribe:()=>()=>{}};

test('native presentation hides free-text input in both modes and restores only drawer controls in fullscreen', () => {
  const core = new SlotCore();
  core.register({name:'root', children:{
    'conversation.session.header.corner':{kind:'single',scope:'session'},
    'conversation.composer.bar':{kind:'single',scope:'session-maybe'},
    'conversation.composer':{kind:'chain',scope:'session'},
    'main':{kind:'keyed',scope:'root'},
    'rightbar':{kind:'single',scope:'root'},
  }},()=>null);
  const toggle=()=> 'native toggle', body=()=> 'native conversation', drawer=()=> 'native drawer';
  core.register({name:'conversation.session.header.corner'},toggle);
  core.register({name:'main',key:'conversation'},body);
  core.register({name:'rightbar'},drawer);
  const composer=()=> 'original input', question=()=> 'native question';
  core.register({name:'conversation.composer.bar'},composer);
  core.register({name:'conversation.composer',select:()=>true},question);
  const original=core.entriesOfSlot('conversation.session.header.corner')[0];
  const styles=[], doc={documentElement:{dataset:{}},head:{appendChild:style=>styles.push(style)},
    createElement:()=>({remove(){styles.splice(styles.indexOf(this),1);}})};
  const mode=createNativeDisplayMode(), boot={entries:[],batches:[]};
  let factory;
  registerNativePresentation({loader:{load:entry=>{factory=entry.factory;}},boot,mode,doc});
  const dispose=factory().apply({locale,slots:{
    inject:(_key,fn)=>fn(), register:core.register.bind(core),
  }});
  assert.equal(doc.documentElement.dataset.codexNativeMode,'inline');
  assert.equal(core.entriesOfSlot('conversation.session.header.corner')[0].component(),null);
  assert.equal(core.entries('conversation.session.header.corner').length,2,'the native occupant is retained');
  assert.equal(core.entriesOfSlot('main')[0].component,body);
  assert.equal(core.entriesOfSlot('rightbar')[0].component,drawer,'native services and drawer stores remain mounted');
  assert.equal(core.entriesOfSlot('conversation.composer.bar')[0].component(),null);
  assert.equal(core.entries('conversation.composer')[0].component,question,'do not replace the native questions/approval chain');
  mode.set('fullscreen');
  assert.equal(core.entriesOfSlot('conversation.session.header.corner')[0],original);
  assert.equal(doc.documentElement.dataset.codexNativeMode,'fullscreen');
  assert.equal(core.entriesOfSlot('conversation.composer.bar')[0].component(),null,'side view is not an implicit handover');
  mode.set('inline'); mode.set('inline');
  assert.equal(core.entries('conversation.session.header.corner').length,2,'duplicate host notifications add no new registrations');
  dispose(); mode.set('fullscreen');
  assert.equal(core.entriesOfSlot('conversation.session.header.corner')[0],original);
  assert.equal(doc.documentElement.dataset.codexNativeMode,undefined);
  assert.equal(styles.length,0);
  assert.equal(core.entriesOfSlot('conversation.composer.bar')[0].component,composer);
});

test('the installed renderer SlotRegistry owns mode-switch registrations and unloads them with the real Cordis plugin', async () => {
  let factory;
  const source=await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-client-ui-renderer/client')),'utf8');
  runInNewContext(source,{window:{__ModuleLoader__:{load:entry=>{factory=entry.factory;}}},queueMicrotask,console});
  const {SlotRegistry}=factory(createRequire(import.meta.url));
  const ctx=new Context(), mode=createNativeDisplayMode();
  ctx.provide('locale',locale);
  const doc={documentElement:{dataset:{}},head:{appendChild(){}},createElement:()=>({remove(){}})};
  let plugin;
  registerNativePresentation({loader:{load:entry=>{plugin=entry.factory();}},boot:{entries:[]},mode,doc});
  try {
    ctx.plugin(SlotRegistry);
    ctx.plugin({inject:['slots'],apply(c){
      c.slots.register({name:'root',children:{
        'conversation.session.header.corner':{kind:'single',scope:'session'},
      }},()=>null);
      // Production declares the resident bar beneath a Component Factory,
      // rather than as a child of the frame's ordinary root registration.
      c.slots.registerFactory({name:'conversation.content',scope:'session-maybe',children:{
        'conversation.composer.bar':{kind:'single',scope:'session-maybe'},
      }},()=>null);
      c.slots.register({name:'conversation.session.header.corner'},()=> 'original');
      c.slots.register({name:'conversation.composer.bar'},()=> 'original input');
    }});
    const handle=ctx.plugin(plugin);
    await new Promise(resolve=>setImmediate(resolve));
    const slots=ctx.get('slots');
    assert.equal(slots.entries('conversation.session.header.corner').length,2);
    assert.equal(slots.entries('conversation.composer.bar').length,2);
    mode.set('fullscreen');
    assert.equal(slots.entries('conversation.session.header.corner').length,1);
    assert.equal(slots.entries('conversation.composer.bar').length,2);
    mode.set('inline');
    assert.equal(slots.entries('conversation.session.header.corner').length,2);
    await handle.dispose();
    assert.equal(slots.entries('conversation.session.header.corner').length,1);
    assert.equal(slots.entries('conversation.composer.bar').length,1);
    mode.set('fullscreen');
    assert.equal(doc.documentElement.dataset.codexNativeMode,undefined);
  } finally { await ctx.fiber.dispose(); }
});
