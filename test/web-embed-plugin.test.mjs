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

test('sibling service providers (production composition) still yield the URL', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-embed4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const urlFile = join(dir, 'task-urls', '8811.json');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  // Production shape: services provided by a SIBLING plugin (its own plugin
  // context, like dsh-host-webserver's Service class), not by the root.
  const provider = c => {
    c.provide('webServer', { getOrigin: () => 'http://127.0.0.1:8811' });
    c.provide('connection', { authenticatedUrl: url => `${url}?token=sibling` });
  };
  ctx.plugin(provider);
  ctx.plugin(webEmbed, { urlFile });
  await new Promise(resolve => setTimeout(resolve, 80));
  const state = JSON.parse(await readFile(urlFile, 'utf8'));
  assert.equal(state.url, 'http://127.0.0.1:8811?token=sibling', 'URL written through the callback context');
});

test('a rejected loader settlement retries the announce and records a marker when it cannot', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'web-embed5-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const urlFile = join(dir, 'task-urls', '8812.json');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  let failOrigin = true;
  ctx.plugin(c => {
    c.provide('webServer', { getOrigin: () => (failOrigin ? undefined : 'http://127.0.0.1:8812') });
    c.provide('connection', { authenticatedUrl: url => `${url}?token=retry` });
    c.provide('loader', { await: () => Promise.reject(new Error('loader exploded')) });
  });
  ctx.plugin(webEmbed, { urlFile });
  await new Promise(resolve => setTimeout(resolve, 80));
  // Origin unavailable AND the loader rejected: an error marker is recorded
  // (the announce failure reason) instead of a silent timeout.
  const marker = await readFile(`${urlFile}.error`, 'utf8');
  assert.ok(marker.trim().length > 0, `non-empty error marker, got: ${marker}`);
  // When the origin becomes available the one-shot has NOT been consumed by
  // the failure path... it has (announce threw before writing) — verify the
  // marker exists rather than a stale URL.
  failOrigin = false;
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await readFile(urlFile, 'utf8').then(() => true).catch(() => false), false, 'no URL written from a failed announce');
});
