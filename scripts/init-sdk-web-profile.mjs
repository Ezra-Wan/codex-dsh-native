// Initialize the sdk-web profile in the bridge's isolated DSH_HOME: the SDK
// protocol stack (dsh-sdk-app) PLUS the official web stack (dsh-web-app) in
// one process, so the official UI served by the SAME process receives its
// native assistant-stream frames (see docs/upstream-source-study.md).
//
// Idempotent; installs profile dependencies (network, no services, no model).
// Usage: node scripts/init-sdk-web-profile.mjs [--home <dsh-home>]
import { mkdir, writeFile, cp, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argIndex = process.argv.indexOf('--home');
const home = argIndex !== -1 ? resolve(process.argv[argIndex + 1]) : join(root, '.local', 'dsh-home');
const profiles = join(home, 'profiles');
const profileDir = join(profiles, 'sdk-web');

const exists = path => access(path, constants.F_OK).then(() => true).catch(() => false);

if (await exists(join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-web-app'))) {
  console.log('sdk-web profile already initialized.');
  process.exit(0);
}
if (!(await exists(join(profiles, 'web')))) {
  throw new Error(`Template profile missing: ${join(profiles, 'web')} (initialize the home once via the SDK first)`);
}

await mkdir(join(profileDir, 'web-embed'), { recursive: true });
await cp(join(root, 'adapter', 'web-embed'), join(profileDir, 'web-embed'), { recursive: true });

// Profile manifest: same composition style as the shipped web profile, with
// the SDK bundle inserted before the web bundle and our adapter mounted via
// the profile patch layer (insert after every bundle layer).
await writeFile(join(profileDir, 'package.json'), JSON.stringify({
  name: 'sdk-web',
  private: true,
  type: 'module',
  dsh: { profile: { bundles: [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-sdk-app',
    '@deepseek-ai/dsh-web-app',
  ] } },
  dependencies: {
    '@deepseek-ai/dsh-base': '0.2.1-rc.2',
    '@deepseek-ai/dsh-sdk-app': '0.2.1-rc.2',
    '@deepseek-ai/dsh-web-app': '0.2.1-rc.2',
    '@codex-dsh/web-embed': 'file:./web-embed',
  },
  allowScripts: {
    '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.2': true,
    'koffi@3.1.1': true,
    'node-pty@1.2.0-beta.15': true,
    'protobufjs@7.6.6': true,
  },
}, null, 2) + '\n');

await writeFile(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - ./web-embed\n');
await writeFile(join(profileDir, 'cordis.yml'), '# dsh profile root — composed as patches (see the web profile note).\n[]\n');
await writeFile(join(profileDir, 'cordis.patch.yml'), [
  '# Bridge overlay for the sdk-web profile:',
  '# - never open or print (stdout belongs to the SDK JSON-RPC protocol line;',
  '#   the bridge learns the URL from @codex-dsh/web-embed instead)',
  '# - the per-task webserver port is injected via a --patch overlay at launch.',
  '- id: web-app',
  '  config:',
  '    openBrowser: false',
  '    printUrl: false',
].join('\n') + '\n');

console.log('Installing sdk-web profile dependencies (pnpm install; no services started)...');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(pnpm, ['install', '--dir', profileDir], {
  stdio: 'pipe',
  shell: process.platform === 'win32',
  env: { ...process.env, PNPM_ALLOW_SCRIPTS: 'true' },
  encoding: 'utf8',
});
if (result.status !== 0) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  // ERR_PNPM_IGNORED_BUILDS is an approval warning; packages resolve fine and
  // native builds are irrelevant to booting the profile (already built in the
  // shared store by the main project's installs).
  if (!/ERR_PNPM_IGNORED_BUILDS/.test(output)) {
    console.error(output);
    throw new Error(`pnpm install failed with status ${result.status}`);
  }
  console.log('pnpm install completed (build-script approval warning ignored; native deps prebuilt in the shared store).');
}
const installed = await readdir(join(profileDir, 'node_modules', '@deepseek-ai')).catch(() => []);
console.log(`sdk-web profile ready (installed ${installed.length} @deepseek-ai packages).`);
