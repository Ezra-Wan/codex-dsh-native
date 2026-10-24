import test from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { nativeUiResource } from '../src/native-ui-resource.mjs';
import { gunzipSync } from 'node:zlib';

test('native UI carrier preserves independent compiled module scopes and gates upstream startup', async () => {
  const adapter='let minified = 1; globalThis.__DSH_MCP_READY__.resolve();';
  const frontend='let minified = 2; globalThis.official = minified;';
  const html=nativeUiResource({css:'body{margin:0}',injected:'',adapter,frontend});
  const modules=[...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  assert.equal(modules.length,2,'separately compiled bundles must never share one declaration scope');
  for(const code of modules)await transform(code,{loader:'js',logLevel:'silent'});
  assert.match(modules[1],/^await globalThis\.__DSH_MCP_READY__\.promise;/);
  const encoded=/atob\('([^']+)'\)/.exec(modules[1])[1];
  assert.equal(gunzipSync(Buffer.from(encoded,'base64')).toString(),frontend);
  assert.match(modules[1],/entry\.type='module'/,'the native bundle executes in its own module scope');
  assert.doesNotMatch(html,/<iframe|\bsrc=["']https?:/);
});
