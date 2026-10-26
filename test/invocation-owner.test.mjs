import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createInvocationOwner} from '../ui/invocation-owner.mjs';

test('optional widget persistence stores only its first invocation identity, no copied history',()=>{
  const host={widgetState:{existing:true},setWidgetState(value){this.widgetState=value;}};
  const first={agent_id:randomUUID(),observation:{call_id:randomUUID()},final:'private transcript',nativeUrl:'secret'};
  const owner=createInvocationOwner(host);owner.remember(first);
  owner.remember({...first,observation:{call_id:randomUUID()}});
  assert.deepEqual(host.widgetState,{existing:true,dshInvocation:{agent_id:first.agent_id,call_id:first.observation.call_id}});
  assert.equal(createInvocationOwner(host).matches(first),true);
  assert.equal(owner.matches({...first,observation:{call_id:randomUUID()}}),false);
});

test('missing or rejected optional host persistence never prevents in-memory invocation ownership',()=>{
  for(const host of [undefined,{setWidgetState(){throw Error('unsupported');}},{widgetState:{dshInvocation:{agent_id:'bad',call_id:'bad'}}}]){
    const owner=createInvocationOwner(host),task={agent_id:randomUUID(),observation:{call_id:randomUUID()}};
    assert.equal(owner.identity,undefined);assert.doesNotThrow(()=>owner.remember(task));
    assert.equal(owner.matches(task),true);assert.equal(owner.matches({...task,observation:{call_id:randomUUID()}}),false);
  }
});
