// Adapter: boot the REAL native DSH web UI against this bridge's isolated
// DSH_HOME so the official app replays bridge sessions read-only.
//
// This is the "copy + adapter" route: no UI code is reimplemented here — the
// user's installed `dsh` CLI (0.2.0-rc.2 verified) serves the official web
// profile, and the sessions written by the bridge SDK (0.2.1-rc.2) are read
// back through the official persistence stack. No model calls happen; the
// composer can send prompts only if the user provides credentials in this
// DSH_HOME (it has none by default).
//
// Usage: node scripts/native-replay.mjs [port]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = process.argv[2] ?? '8792';
const home = join(root, '.local', 'dsh-home');

const child = spawn('dsh', ['--profile', 'web', '--no-open', '--port', port], {
  env: { ...process.env, DSH_HOME: home },
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});

let settled = false;
const report = line => {
  process.stdout.write(line);
  if (!settled && line.includes('token=')) settled = true;
};
child.stdout.on('data', chunk => report(chunk.toString()));
child.stderr.on('data', chunk => report(chunk.toString()));
const stop = () => { child.kill(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
child.on('exit', code => { process.exitCode = code ?? 0; });
