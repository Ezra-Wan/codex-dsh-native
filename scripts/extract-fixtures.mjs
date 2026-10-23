// Extract real visible events from the local native session logs into offline
// replay fixtures, using the production reader so the fixture shape is exactly
// what ds_events returns. Fixture refresh is manual; committed fixtures are static.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readNativeEvents } from '../src/trace.mjs';

const home = process.argv[2] ?? '.local/dsh-home';
const outDir = fileURLToPath(new URL('../ui/prototype/fixture/', import.meta.url));
const sources = [
  { file: 'demo-1792663550562.json', label: '演示任务：读→写→命令失败→读回恢复', sessionId: 'bc243aa7-57aa-47b5-b219-c73a6a45c5ed' },
  { file: 'ui-check-1792664983899.json', label: '界面小测试：读→写→读回校验通过', sessionId: 'a87de710-cab5-4c2e-bb9d-df546c70d212' },
];

await mkdir(outDir, { recursive: true });
for (const source of sources) {
  const events = [];
  let cursor = -1;
  for (;;) {
    const page = await readNativeEvents(home, source.sessionId, cursor, 50);
    events.push(...page.events);
    if (!page.hasMore) break;
    cursor = page.cursor;
  }
  const fixture = {
    label: source.label,
    session_id: source.sessionId,
    source: 'native-dsh-session-log',
    extractedAt: new Date().toISOString(),
    extractor: 'scripts/extract-fixtures.mjs (production readNativeEvents)',
    events,
  };
  const path = `${outDir}${source.file}`;
  await writeFile(path, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`${path}: ${events.length} events`);
}
