import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleEvent } from '../src/trace.mjs';

test('trace exposes tool failures and omits reasoning, raw streams and request headers', () => {
  assert.equal(visibleEvent({ type: 'request/header', data: { secret: 'do-not-render' } }), null);
  const view = visibleEvent({ type: 'assistant/message', seq: 3, time: 1, data: {
    message: { content: [{ type: 'reasoning', text: 'do-not-render' }, { type: 'text', text: 'visible reply' }] },
    stream: [{ providerSecret: 'do-not-render' }],
  } });
  assert.equal(view.text, 'visible reply');
  assert.ok(!JSON.stringify(view).includes('do-not-render'));
  const failure = visibleEvent({ type: 'tool/result', seq: 4, data: { message: { toolCallId: 'a', isError: true, content: [{ type: 'text', text: 'access denied' }] } } });
  assert.equal(failure.isError, true);
  assert.equal(failure.callId, 'a');
});
