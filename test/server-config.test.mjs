import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Bridge } from '../src/bridge.mjs';

const run = promisify(execFile);
const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

test('port allocation fails before emitting an out-of-range overlay', () => {
  const bridge = new Bridge({ root: tmpdir(), webEmbedBasePort: 65533 });
  assert.equal(bridge.nextWebPort(), 65534);
  assert.equal(bridge.nextWebPort(), 65535);
  assert.throws(() => bridge.nextWebPort(), /Web port range exhausted/);
  assert.equal(bridge.portCursor, 2, 'exhaustion does not mutate the allocation cursor');
});

test('server accepts an isolated web port range and rejects invalid configuration before initialization', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-server-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_DSH_BRIDGE_HOME: root, DSH_NATIVE_REPLAY: 'off' };
  const { stdout } = await run(process.execPath, [server, '--status'], {
    env: { ...env, CODEX_DSH_WEB_BASE_PORT: '18900' }, timeout: 5000,
  });
  assert.equal(JSON.parse(stdout).enabled, false);
  const automatic=await run(process.execPath,[server,'--status'],{env:{...env,CODEX_DSH_WEB_BASE_PORT:'0'},timeout:5000});
  assert.equal(JSON.parse(automatic.stdout).enabled,false,'port zero is the explicit native OS-assigned mode');
  for (const value of ['', 'invalid', '1023', '65534', '18900.5']) {
    await assert.rejects(run(process.execPath, [server, '--status'], {
      env: { ...env, CODEX_DSH_WEB_BASE_PORT: value }, timeout: 5000,
    }), error => error.code === 1 && /CODEX_DSH_WEB_BASE_PORT must be /.test(error.stderr));
  }
});
