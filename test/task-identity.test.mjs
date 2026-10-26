import test from 'node:test';
import assert from 'node:assert/strict';
import { taskIdentity } from '../ui/task-identity.mjs';

test('role identity stays explicit for peers, subagents, worker fallback and unlabelled legacy tasks', () => {
  assert.equal(taskIdentity({role:'peer',name:'检查'}),'协作 agent〔peer〕 · 检查');
  assert.equal(taskIdentity({role:'sub',name:'实现'}),'子 agent〔sub〕 · 实现');
  assert.equal(taskIdentity({role:'sub',name:'实现',backend:'worker'}),'子 agent〔sub〕 · 实现 · 旧 worker 兜底');
  assert.equal(taskIdentity({agent_id:'abcdefghijk'}),'角色未标注 · abcdefgh');
});
