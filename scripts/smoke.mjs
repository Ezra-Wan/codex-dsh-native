import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Bridge } from '../src/bridge.mjs';

if (!process.env.DEEPSEEK_API_KEY) throw new Error('Set DEEPSEEK_API_KEY in the launching environment. Never paste it into a task.');
const root = fileURLToPath(new URL(`../.local/smoke-${Date.now()}/`, import.meta.url));
const cwd = join(root, 'workspace');
await mkdir(cwd, { recursive: true });
const label = `bridge-${randomUUID().slice(0, 8)}`;
await writeFile(join(cwd, 'input.json'), JSON.stringify({ label, numbers: [13, 29, 47] }));
let bridge = await new Bridge({ root }).init();
async function settled(id) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const result = await bridge.wait(id, 50_000);
    console.log(JSON.stringify({ agent_id: id, status: result.status, progress: result.progress, error: result.error }));
    if (!['starting', 'running', 'stopping'].includes(result.status)) return result;
  }
  throw new Error('Live smoke exceeded 3 minutes; task remains incomplete.');
}
try {
  await bridge.setEnabled(true);
  const first = await bridge.start({ cwd, mode: 'light', name: 'P0 file and context smoke',
    task: 'Use your native file tools to read input.json in the workspace. Sum its numbers. Write result.txt containing the label and total. Remember both in this conversation. Reply only with the label and total. Do not change any other files.' });
  const parallel = await bridge.start({ cwd, permission: 'read-only', mode: 'light', name: 'P0 parallel smoke',
    task: 'Reply exactly PARALLEL_OK. No tools needed.' });
  assert.equal(first.status, 'starting');
  assert.equal(parallel.status, 'starting');
  const results = await Promise.all([settled(first.agent_id), settled(parallel.agent_id)]);
  for (const result of results) assert.equal(result.status, 'completed', JSON.stringify(result));
  assert.match(results[1].final, /PARALLEL_OK/);
  const artifact = await readFile(join(cwd, 'result.txt'), 'utf8');
  assert.ok(artifact.includes(label) && artifact.includes('89'), artifact);
  await bridge.close();
  bridge = await new Bridge({ root }).init();
  const continued = await bridge.followup(first.agent_id,
    'Without using tools or reading files, recall the label and total from the previous turn. Reply only those two values.');
  assert.equal(continued.session_id, first.session_id);
  const restored = await settled(first.agent_id);
  assert.equal(restored.status, 'completed', JSON.stringify(restored));
  assert.ok(restored.final.includes(label) && restored.final.includes('89'), restored.final);
  console.log(JSON.stringify({ passed: true, nativeFileTools: true, parallelDispatch: true, processRestartResume: true,
    session_id: first.session_id, reportRoot: root }));
} finally { await bridge.close(); }
