// Bundle the vendored upstream assistant-stream contract sources (MIT, see
// file headers) into importable ESM for test/official-stream-contract.test.mjs.
// dsh-llm stays external and resolves from the project's node_modules.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = fileURLToPath(new URL('../test/vendor/session-controller/dist/', import.meta.url));
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    'host-accumulator': `${root}test/vendor/session-controller/assistant-stream.ts`,
    'client-fold': `${root}test/vendor/session-controller/client/sessions/assistant-stream.ts`,
  },
  outdir,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['es2022'],
  external: ['@deepseek-ai/*'],
  outExtension: { '.js': '.mjs' },
  logLevel: 'silent',
});
console.log('contract-test vendor bundles written.');
