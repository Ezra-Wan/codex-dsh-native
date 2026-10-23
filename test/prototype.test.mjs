import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildLedger, toolTitle } from '../ui/prototype/records.mjs';

const load = async name => JSON.parse(await readFile(fileURLToPath(new URL(`../ui/prototype/fixture/${name}`, import.meta.url)), 'utf8'));
let fixtures;
test.before(async () => { fixtures = Object.fromEntries(await Promise.all(['demo-1792663550562.json', 'ui-check-1792664983899.json', 'stress-long.json'].map(async name => [name, await load(name)]))); });

test('fixtures are real replay records with expected beats', () => {
  const demo = fixtures['demo-1792663550562.json'];
  const check = fixtures['ui-check-1792664983899.json'];
  assert.equal(demo.events.length, 18);
  assert.equal(demo.source, 'native-dsh-session-log');
  const errorAt = demo.events.findIndex(event => event.type === 'tool/result' && event.isError);
  assert.ok(errorAt > 0, 'demo contains a real tool failure');
  assert.ok(demo.events.slice(errorAt + 1).some(event => event.type === 'tool/call' && event.name === 'read'), 'demo recovers by reading back after the failure');
  assert.equal(check.events.length, 12);
  assert.ok(!check.events.some(event => event.isError), 'ui-check has no tool failures');
  const stress = fixtures['stress-long.json'];
  assert.ok(stress.synthetic, 'stress fixture is labeled synthetic');
  assert.ok(stress.events.some(event => event.truncated && event.text.length > 8000), 'stress carries an over-cap result');
});

test('fixtures contain no credentials or reasoning content', () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    const raw = JSON.stringify(fixture);
    for (const pattern of [/sk-[A-Za-z0-9]{16,}/, /Bearer\s+[A-Za-z0-9._-]{10,}/, /api[_-]?key["'\s:=]+[A-Za-z0-9]{8,}/i]) {
      assert.doesNotMatch(raw, pattern, `${name} must not contain credential-like strings`);
    }
    assert.ok(!fixture.events.some(event => String(event.text ?? '').includes('<think>')), `${name} exposes no reasoning blocks`);
  }
});

test('buildLedger pairs tools, keeps the error and groups by turn (demo)', () => {
  const demo = fixtures['demo-1792663550562.json'];
  const ledger = buildLedger(demo.events);
  assert.equal(ledger.stats.events, 18);
  assert.equal(ledger.stats.turns, 1);
  assert.equal(ledger.stats.tools, 6);
  assert.equal(ledger.stats.errors, 1);
  const tools = ledger.turns[0].records.filter(record => record.kind === 'tool');
  assert.deepEqual(tools.map(record => record.state).sort(), ['error', 'ok', 'ok', 'ok', 'ok', 'ok']);
  const tasks = ledger.turns[0].records.filter(record => record.kind === 'task');
  assert.equal(tasks.length, 3, 'prompt messages join the turn they started');
  assert.equal(ledger.turns[0].records.findIndex(record => record.kind === 'tool'), 3, 'tasks precede the first tool call');
  const failed = tools.find(record => record.state === 'error');
  assert.equal(failed.name, 'pwsh');
  const recovered = tools.filter(record => record.state === 'ok' && record.seq > failed.seq);
  assert.ok(recovered.length >= 1, 'recovery reads stay visible after the failure');
  assert.equal(ledger.turns[0].end.reason, 'completed');
  assert.equal(ledger.turns[0].records.at(-1).kind, 'message', 'assistant reply is the last record before the boundary');
});

test('buildLedger handles pending calls and orphan results', () => {
  const demo = fixtures['demo-1792663550562.json'];
  const lastResult = demo.events.findLastIndex(event => event.type === 'tool/result');
  const withoutLastResult = buildLedger(demo.events.filter((event, index) => index !== lastResult));
  assert.ok(withoutLastResult.turns[0].records.some(record => record.kind === 'tool' && record.state === 'pending'), 'dropping a result leaves the call pending, not silently ok');
  const firstCall = demo.events.findIndex(event => event.type === 'tool/call');
  const orphan = buildLedger(demo.events.filter((event, index) => index !== firstCall));
  assert.ok(orphan.turns[0].records.some(record => record.kind === 'tool' && record.orphan), 'a result without its call stays visible as orphan');
});

test('truncation flags pass through and titles map tool names', () => {
  const stress = fixtures['stress-long.json'];
  const ledger = buildLedger(stress.events);
  const long = ledger.turns[0].records.find(record => record.kind === 'tool' && record.result?.truncated);
  assert.ok(long, 'over-cap result keeps its truncation flag');
  assert.deepEqual(toolTitle({ name: 'read', argsText: '{}' }), { label: '读取', path: null });
  assert.deepEqual(toolTitle({ name: 'write', argsText: JSON.stringify({ file_path: 'D:/x/result.json' }) }), { label: '写入', path: 'D:/x/result.json' });
  assert.equal(toolTitle({ orphan: true }).label, '工具结果（未配对）');
});
