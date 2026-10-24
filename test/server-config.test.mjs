import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const server = fileURLToPath(new URL('../src/server.mjs', import.meta.url));

test('server accepts an isolated web port range and rejects invalid configuration before initialization', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-server-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_DSH_BRIDGE_HOME: root, DSH_NATIVE_REPLAY: 'off' };
  const { stdout } = await run(process.execPath, [server, '--status'], {
    env: { ...env, CODEX_DSH_WEB_BASE_PORT: '18900' }, timeout: 5000,
  });
  assert.equal(JSON.parse(stdout).enabled, false);
  for (const value of ['', 'invalid', '1023', '65534', '18900.5']) {
    await assert.rejects(run(process.execPath, [server, '--status'], {
      env: { ...env, CODEX_DSH_WEB_BASE_PORT: value }, timeout: 5000,
    }), error => error.code === 1 && /CODEX_DSH_WEB_BASE_PORT must be an integer/.test(error.stderr));
  }
});
