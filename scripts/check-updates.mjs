import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-sdk-client', '@modelcontextprotocol/sdk']) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${name}: registry HTTP ${response.status}`);
  const data = await response.json();
  console.log(JSON.stringify({ package: name, pinned: pkg.dependencies[name], tags: data['dist-tags'],
    sdkMatchesHarness: name === '@deepseek-ai/dsh-sdk-client' ? Boolean(data.versions[pkg.dependencies['@deepseek-ai/dsh']]) : undefined }));
}
console.log('Read-only check. Upgrade DSH and its SDK together, then run tests and smoke before switching.');
