import test from 'node:test';
import assert from 'node:assert/strict';
import { App } from '@modelcontextprotocol/ext-apps';
import { APP_OPTIONS, configureCardLayout, INLINE_HEIGHT } from '../ui/layout.mjs';

test('actual app options disable SDK viewport resize feedback', () => {
  const app = new App({ name: 'layout-test', version: '1' }, {}, APP_OPTIONS);
  assert.equal(app.options.autoResize, false);
});

test('sidebar round-trips report one fixed inline height and ignore repeated host sizing', () => {
  const sizes = [];
  const doc = { body: { style: {} } };
  const app = {
    getHostContext: () => ({ displayMode: 'inline' }),
    sendSizeChanged: async size => { sizes.push(size); },
  };
  configureCardLayout({ app, doc });
  assert.equal(doc.body.style.height, `${INLINE_HEIGHT}px`);
  assert.equal(sizes.length, 1);
  for (let i = 0; i < 100; i++) app.onhostcontextchanged({ displayMode: 'inline', containerDimensions: { height: 600 + i } });
  assert.equal(sizes.length, 1, 'host resize notifications never generate a new resize');
  app.onhostcontextchanged({ displayMode: 'fullscreen' });
  assert.equal(doc.body.style.height, '100vh');
  assert.equal(sizes.length, 1, 'fullscreen belongs to the host');
  app.onhostcontextchanged({ displayMode: 'inline' });
  assert.equal(doc.body.style.height, `${INLINE_HEIGHT}px`);
  assert.deepEqual(sizes, [{ height: INLINE_HEIGHT }, { height: INLINE_HEIGHT }]);
  app.onhostcontextchanged({ theme: 'dark' });
  assert.equal(sizes.length, 2);
});
