import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('HTTPS probe discovery declares an exact origin and cannot start paid work or boot a service', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-https-contract-'));
  const client = new Client({name:'probe-contract',version:'1'});
  try {
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:[fileURLToPath(new URL('../scripts/https-ui-probe.mjs',import.meta.url))],
      env:{...process.env,DSH_HTTPS_PROBE_ROOT:root,DSH_HTTPS_PROBE_PROFILES:join(root,'missing-profiles'),DSH_HTTPS_PROBE_PORT:'19041'},stderr:'pipe'}));
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(tool=>tool.name).sort(),['probe_ui_signal','show_https_probe']);
    assert.deepEqual(tools.find(tool=>tool.name==='probe_ui_signal')._meta.ui.visibility,['app']);
    const resource = await client.readResource({uri:tools.find(tool=>tool.name==='show_https_probe')._meta.ui.resourceUri});
    assert.deepEqual(resource.contents[0]._meta.ui.csp.frameDomains,['https://127.0.0.1:19041']);
    assert.deepEqual(await readdir(root),[], 'discovery does not start DSH, read a certificate or write state');
  } finally {await client.close();await rm(root,{recursive:true,force:true});}
});
