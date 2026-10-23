import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const versions = {};
for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-sdk-client', '@modelcontextprotocol/sdk']) {
  const path = fileURLToPath(new URL(`../node_modules/${name}/package.json`, import.meta.url));
  versions[name] = JSON.parse(await readFile(path, 'utf8')).version;
}
console.log(JSON.stringify({ node: process.version, versions,
  keyAvailableInEnvironment: Boolean(process.env.DEEPSEEK_API_KEY),
  bridgeHome: process.env.CODEX_DSH_BRIDGE_HOME ?? fileURLToPath(new URL('../.local/', import.meta.url)),
  profile: 'sdk', bridgeEnabledByDefault: false, nativeDesktopWakeup: false,
}, null, 2));
