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
// The tokenized URL is written to <root>/.local/native-replay.json so the
// observer card (MCP Apps) can embed or link the official UI. Single instance:
// if a live previous instance owns the file, its URL is reused.
//
// Usage: node scripts/native-replay.mjs [port]
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = process.argv[2] ?? '8792';
const home = join(root, '.local', 'dsh-home');
const statePath = join(root, '.local', 'native-replay.json');

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

const previous = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => null);
if (previous?.url && alive(previous.pid)) {
  console.log(`native-replay already running (pid ${previous.pid}): ${previous.url}`);
  process.exit(0);
}

const child = spawn('dsh', ['--profile', 'web', '--no-open', '--port', port], {
  env: { ...process.env, DSH_HOME: home },
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});

let buffer = '';
const writeState = url => writeFile(statePath, JSON.stringify({ url, pid: child.pid, port, startedAt: new Date().toISOString() }, null, 2) + '\n');
const onChunk = chunk => {
  const text = chunk.toString();
  process.stdout.write(text);
  buffer += text;
  const match = buffer.match(/https?:\/\/\S+token=\S+/);
  if (match) { writeState(match[0].trim()); buffer = ''; }
};
child.stdout.on('data', onChunk);
child.stderr.on('data', onChunk);
child.on('exit', code => { process.exitCode = code ?? 0; });
const stop = () => { child.kill(); process.exit(0); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
