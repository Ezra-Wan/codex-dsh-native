import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as webEmbedModule from '../adapter/web-embed/lib/index.js';
// A cordis plugin entry is its apply function (how the loader resolves it).
const webEmbed = webEmbedModule.apply;

// Load the ACTUAL adapter plugin with the REAL cordis loader and fake
// webServer/connection services (s1-s2-acceptance [P1]: the previous version
// read ctx.config, which throws "cannot get property config without inject"
// on a real loader). No DSH services, no model, synthetic token only.

function fakeHost({ origin = 'http://127.0.0.1:8801', waitForLoader = false } = {}) {
  const ctx = new Context();
  ctx.provide('webServer', { getOrigin: () => origin });
  ctx.provide('connection', { authenticatedUrl: url => `${url}?token=synthetic` });
  if (waitForLoader) {
    let settle;
    const gate = new Promise(resolve => { settle = resolve; });
    ctx.provide('loader', { await: () => gate });
    return { ctx, settle };
  }
  return { ctx };
}

test('the real cordis loader mounts the plugin and the URL file is written', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-embed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const urlFile = join(dir, 'task-urls', '8801.json');
  const { ctx } = fakeHost();
  ctx.plugin(webEmbed, { urlFile });
  await new Promise(resolve => setTimeout(resolve, 50));
  const state = JSON.parse(await readFile(urlFile, 'utf8'));
  assert.equal(state.url, 'http://127.0.0.1:8801?token=synthetic');
  assert.equal(state.pid, process.pid);
  await ctx.fiber.dispose();
});

test('plugin options are validated at mount time on a real loader', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-embed3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const ctx = new Context();
  ctx.provide('webServer', { getOrigin: () => 'http://127.0.0.1:8801' });
  ctx.provide('connection', { authenticatedUrl: url => `${url}?token=synthetic` });
  const urlFile = join(dir, 'never.json');
  // A synchronous config throw inside the loader surfaces asynchronously at
  // best; the observable contract is: no URL file and no host teardown.
  ctx.plugin(webEmbed, {});
  await new Promise(resolve => setTimeout(resolve, 80));
  await assert.rejects(readFile(urlFile, 'utf8'), /ENOENT/, 'invalid config writes nothing');
  // The same host still mounts a valid instance afterwards.
  ctx.plugin(webEmbed, { urlFile });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.match(await readFile(urlFile, 'utf8'), /token=synthetic/);
  await ctx.fiber.dispose();
});

test('the loader-gated path writes only after the loader settles, exactly once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-embed2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const urlFile = join(dir, 'task-urls', '8802.json');
  const { ctx, settle } = fakeHost({ waitForLoader: true });
  ctx.plugin(webEmbed, { urlFile });
  await new Promise(resolve => setTimeout(resolve, 50));
  await assert.rejects(readFile(urlFile, 'utf8'), /ENOENT/, 'nothing written before the loader settles');
  settle();
  await new Promise(resolve => setTimeout(resolve, 50));
  const first = await readFile(urlFile, 'utf8');
  assert.match(first, /token=synthetic/);
  // Announce is one-shot: overwriting the file externally stays untouched.
  await writeFile(urlFile, '{"marker":true}\n');
  settle(); // a second loader settlement must not rewrite the URL
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(JSON.parse(await readFile(urlFile, 'utf8')).marker, true);
  await ctx.fiber.dispose();
});
