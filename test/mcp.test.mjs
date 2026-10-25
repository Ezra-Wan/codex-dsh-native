import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpUiResourceMetaSchema } from '@modelcontextprotocol/ext-apps';

test('MCP initialization, tools and switch work over real stdio without model calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-mcp-test-'));
  const client = new Client({ name: 'bridge-test', version: '1' });
  const env = { ...process.env, CODEX_DSH_BRIDGE_HOME: root };
  delete env.DSH_NATIVE_REPLAY; // Real MCP initialization exercises the safe default.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('../src/server.mjs', import.meta.url))],
    env,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['ds_bridge', 'ds_events', 'ds_fallback', 'ds_followup', 'ds_observe', 'ds_panel', 'ds_review', 'ds_start', 'ds_stop', 'ds_wait']);
    const panel = tools.find(tool => tool.name === 'ds_panel');
    assert.deepEqual(panel._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
    // P0-A metadata: the dispatch call declares its task card. Note this is a
    // declaration only — whether the host renders a single aggregated entry
    // needs in-host acceptance and is NOT proven by this assertion.
    const start = tools.find(tool => tool.name === 'ds_start');
    assert.equal(start._meta.ui.resourceUri, 'ui://dsh-native/observer.html');
    const resource = await client.readResource({ uri: panel._meta.ui.resourceUri });
    assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
    assert.match(resource.contents[0].text, /执行记录/);
    assert.equal(resource.contents[0]._meta['openai/ui'].preferredDisplayMode, 'inline');
    const uiMeta = McpUiResourceMetaSchema.parse(resource.contents[0]._meta.ui);
    assert.deepEqual(uiMeta.csp.frameDomains, ['http://127.0.0.1:*'], 'the real stdio resource grants nested task pages on loopback only');
    const get = async args => {
      const result = await client.callTool({ name: 'ds_bridge', arguments: args });
      assert.equal(result.isError, undefined);
      return JSON.parse(result.content[0].text);
    };
    assert.equal((await get({})).enabled, false);
    assert.equal((await get({ enabled: true })).enabled, true);
    const limits=await get({maxParallel:4});assert.equal(limits.enabled,true);assert.equal(limits.maxParallel,4);
    assert.equal((await get({ enabled: false })).enabled, false);
    assert.equal((await get({})).maxParallel,4);
    const refused = await client.callTool({ name: 'ds_start', arguments: { cwd: root, task: 'Do not execute while disabled.' } });
    assert.equal(refused.isError, true);
    assert.match(refused.content[0].text, /disabled/);
  } finally { await client.close(); await rm(root, { recursive: true, force: true }); }
});
