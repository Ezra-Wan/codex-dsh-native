// Build the labeled synthetic stress fixture: one real tool result inflated
// past the 8000-char projection cap so the truncation UI can be verified offline.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../ui/prototype/fixture/demo-1792663550562.json', import.meta.url));
const target = fileURLToPath(new URL('../ui/prototype/fixture/stress-long.json', import.meta.url));
const fixture = JSON.parse(await readFile(source, 'utf8'));
const result = fixture.events.findLast(event => event.type === 'tool/result');
const filler = '行 ' + '0123456789'.repeat(1) + '：订单数据校验样本，用于把该结果拉长到投影上限之外。\n';
let text = result.text;
while (text.length < 9200) text += filler + `${text.length}: 2026-10-22 订单 ${String(text.length).padStart(5, '0')} 金额 34.23 状态正常\n`;
result.text = text;
result.truncated = true;
fixture.label = '压力样本：长结果截断（合成，基于演示任务）';
fixture.synthetic = { basedOn: 'demo-1792663550562.json', reason: '把一条真实工具结果拉长到 >8000 字符，验证截断展示', inflatedEventSeq: result.seq };
await writeFile(target, JSON.stringify(fixture, null, 2) + '\n');
console.log(`${target}: result seq ${result.seq} now ${text.length} chars`);
