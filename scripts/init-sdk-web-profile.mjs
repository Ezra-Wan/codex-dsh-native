// Initialize the sdk-web profile in the bridge's isolated DSH_HOME: the SDK
// protocol stack (dsh-sdk-app) PLUS the official web stack (dsh-web-app) in
// one process, so the official UI served by the SAME process receives its
// native assistant-stream frames (see docs/upstream-source-study.md).
//
// Idempotent; installs profile dependencies (network, no services, no model).
// Usage: node scripts/init-sdk-web-profile.mjs [--home <dsh-home>]
import { mkdir, writeFile, cp, access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { WEB_RUNTIME_PATCH } from '../src/web-profile.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const argIndex = process.argv.indexOf('--home');
const home = argIndex !== -1 ? resolve(process.argv[argIndex + 1]) : join(root, '.local', 'dsh-home');
const profiles = join(home, 'profiles');
const profileDir = join(profiles, 'sdk-web');

const exists = path => access(path, constants.F_OK).then(() => true).catch(() => false);

// The adapter copy inside the profile is ALWAYS refreshed from the source of
// truth (adapter/web-embed) — the profile dependency uses `link:` so the
// in-profile copy is live-linked, not a stale pnpm `file:` copy.
const profileManifest = join(profileDir, 'package.json');
if (await exists(profileManifest)) {
  await cp(join(root, 'adapter', 'web-embed'), join(profileDir, 'web-embed'), { recursive: true });
  await writeFile(join(profileDir, 'cordis.patch.yml'), WEB_RUNTIME_PATCH, 'utf8');
  if(!process.argv.includes('--install')){
    console.log('sdk-web profile present; adapter copy and browser settings refreshed; use --install to reinstall dependencies.');
    process.exit(0);
  }
}
// This manifest is self-contained; a new installation must not depend on an
// unrelated pre-existing Web profile or a first paid task to initialize it.

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
    '@codex-dsh/web-embed': 'link:./web-embed',
  },
  allowScripts: {
    '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.2': true,
    'koffi@3.1.1': true,
    'node-pty@1.2.0-beta.15': true,
    'protobufjs@7.6.6': true,
  },
}, null, 2) + '\n');

await writeFile(join(profileDir, 'pnpm-workspace.yaml'), `packages:
  - ./web-embed
allowBuilds:
  '@deepseek-ai/dsh-subprocess-local@0.2.1-rc.2': true
  'koffi@3.1.1': true
  'node-pty@1.2.0-beta.15': true
  'protobufjs@7.6.6': true
  '@google/genai': false
`);
await writeFile(join(profileDir, 'cordis.yml'), '# dsh profile root — composed as patches (see the web profile note).\n[]\n');
await writeFile(join(profileDir, 'cordis.patch.yml'), WEB_RUNTIME_PATCH, 'utf8');
if(process.argv.includes('--prepare-only')){
  console.log('sdk-web profile files prepared; no installation, service or model started.');
  process.exit(0);
}

console.log('Installing sdk-web profile dependencies (pnpm install; no services started)...');
let pnpm='pnpm',prefix=[];
if(process.platform==='win32'){
  const lookup=spawnSync('where.exe',['pnpm.cmd'],{encoding:'utf8',windowsHide:true});
  if(lookup.status!==0)throw Error('pnpm is required to install the isolated sdk-web profile');
  const entry=process.env.CODEX_DSH_PNPM_ENTRY??join(dirname(lookup.stdout.trim().split(/\r?\n/)[0]),'node_modules/pnpm/bin/pnpm.cjs');
  await access(entry);pnpm=process.execPath;prefix=[entry];
}
const result = spawnSync(pnpm, [...prefix,'install', '--dir', profileDir], {
  stdio: 'pipe',
  shell: false, windowsHide: true,
  env: { ...process.env, PNPM_ALLOW_SCRIPTS: 'true' },
  encoding: 'utf8',
});
if (result.status !== 0) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  console.error(output);
  throw new Error(`pnpm install failed with status ${result.status}; profile files remain for inspection, installation is not accepted`);
}
const installed = await readdir(join(profileDir, 'node_modules', '@deepseek-ai')).catch(() => []);
console.log(`sdk-web profile ready (installed ${installed.length} @deepseek-ai packages).`);
