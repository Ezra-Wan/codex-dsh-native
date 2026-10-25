import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';
import * as WebApp from '@deepseek-ai/dsh-web-app';
import { writeWebEmbedPatch,writeExecutionPatch,writeSubagentPatch } from '../src/runtime.mjs';

const require = createRequire(import.meta.resolve('@deepseek-ai/cordis-plugin-include'));
const { load } = require('js-yaml');
const parse = text => load(text, { schema: entryListSchema });
const run = promisify(execFile);

test('installed base + SDK + Web composition retains native SDK file tools and compaction without duplicate delegation providers',async t=>{
  const root=await mkdtemp(join(tmpdir(),'execution-profile-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const patches=await Promise.all(['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app','@deepseek-ai/dsh-web-app'].map(async name=>parse(await readFile(new URL(import.meta.resolve(`${name}/cordis.patch.yml`)),'utf8'))));
  let entries=[];for(const patch of patches)entries=applyEntryPatches(entries,patch);
  assert.equal(entries.find(e=>e.id==='tool-fs').disabled,true,'the real Web bundle removes host tools');
  const originalFs=entries.find(e=>e.id==='tool-fs');
  const execution=parse(await readFile(await writeExecutionPatch(root,{webEmbed:true}),'utf8'));
  entries=applyEntryPatches(entries,execution);
  for(const id of ['tool-fs','tool-fs-search','compaction-basic','command-compact','tool-result-pruner'])assert.equal(entries.find(e=>e.id===id).disabled,false,id);
  assert.equal(entries.find(e=>e.id==='tool-fs').name,originalFs.name,'the upstream file plugin owns behavior');
  assert.equal(entries.find(e=>e.id==='tool-subagent').disabled,true);
  entries=applyEntryPatches(entries,parse(await readFile(await writeExecutionPatch(root,{webEmbed:true,subagents:true}),'utf8')));
  entries=applyEntryPatches(entries,parse(await readFile(await writeSubagentPatch(root),'utf8')));
  assert.equal(entries.filter(e=>e.name==='@deepseek-ai/dsh-subagent-spawn-in-process').length,1);
  assert.equal(entries.find(e=>e.id==='tool-subagent').disabled,false);
  assert.equal(entries.find(e=>e.id==='sandbox-policy').name,'@deepseek-ai/dsh-sandbox-policy','restoring tools cannot replace the permission boundary');
});

test('task overlay disables browser handoff on the actual upstream web-runtime row', async t => {
  const root = await mkdtemp(join(tmpdir(), 'web-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const upstream = parse(await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-web-app/cordis.patch.yml')), 'utf8'));
  const entries = upstream.flatMap(patch => patch.insert ?? [])
    .filter(entry => ['@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-host-webserver'].includes(entry.name));
  assert.equal(entries.length, 2, 'use the installed upstream entry IDs and config');
  const path = await writeWebEmbedPatch(root, { port: 8891, urlFile: join(root, 'url.json') });
  const warnings = [];
  const effective = applyEntryPatches(entries, parse(await readFile(path, 'utf8')), (...warning) => warnings.push(warning));
  assert.deepEqual(warnings, [], 'no overlay target may be silently skipped');
  const runtime = effective.find(entry => entry.name === '@deepseek-ai/dsh-web-app');
  assert.equal(runtime.config.openBrowser, false);
  assert.equal(runtime.config.printUrl, false);
  const validated = WebApp.Config['~standard'].validate(runtime.config);
  assert.equal(validated.issues, undefined, 'the complete replacement config satisfies the actual upstream schema');
  const injections = [];
  const provided = [];
  // Execute upstream runtime glue without mounting any plugin or invoking an
  // injected callback: even a regression cannot launch a browser in this test.
  WebApp.apply({
    webServer: { host: '127.0.0.1', protocol: 'http:', getOrigin: () => 'http://127.0.0.1:8891' },
    provide: name => provided.push(name), plugin: () => {},
    inject: dependencies => injections.push(dependencies),
  }, validated.value);
  assert.ok(provided.includes('webApp'));
  assert.ok(!injections.some(dependencies => dependencies.includes('connection')), 'no URL announcement or browser handoff callback registered');
});

test('refreshing an existing profile replaces the obsolete web-app override without installing or serving', async t => {
  const home = await mkdtemp(join(tmpdir(), 'web-profile-refresh-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, 'profiles', 'sdk-web');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"sdk-web","private":true}\n');
  await writeFile(join(dir, 'cordis.patch.yml'), '- id: web-app\n  config:\n    openBrowser: false\n');
  await run(process.execPath, [fileURLToPath(new URL('../scripts/init-sdk-web-profile.mjs', import.meta.url)), '--home', home], {
    env: { ...process.env, DSH_NATIVE_REPLAY: 'off' }, timeout: 5000,
  });
  const patch = parse(await readFile(join(dir, 'cordis.patch.yml'), 'utf8'));
  assert.equal(patch[0].id, 'web-runtime');
  assert.equal(patch[0].config.openBrowser, false);
  assert.equal(patch[0].config.printUrl, false);
  assert.match(await readFile(join(dir, 'web-embed', 'lib', 'index.js'), 'utf8'), /connectionCtx\.webServer/);
});

test('a fresh sdk-web profile can be prepared without any existing Web home or model dispatch',async t=>{
  const home=await mkdtemp(join(tmpdir(),'web-profile-fresh-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await run(process.execPath,[fileURLToPath(new URL('../scripts/init-sdk-web-profile.mjs',import.meta.url)),'--home',home,'--prepare-only'],{timeout:5000});
  const profile=JSON.parse(await readFile(join(home,'profiles/sdk-web/package.json'),'utf8'));
  assert.deepEqual(profile.dsh.profile.bundles,['@deepseek-ai/dsh-base','@deepseek-ai/dsh-sdk-app','@deepseek-ai/dsh-web-app']);
  assert.equal(profile.dependencies['@deepseek-ai/dsh-sdk-app'],'0.2.1-rc.2');
  const patch=parse(await readFile(join(home,'profiles/sdk-web/cordis.patch.yml'),'utf8'));
  assert.equal(patch[0].config.openBrowser,false);
});
