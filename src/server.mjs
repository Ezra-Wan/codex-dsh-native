import { fileURLToPath } from 'node:url';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Bridge } from './bridge.mjs';
import { WorkerTasks } from './worker-tasks.mjs';
import { TaskRouter } from './task-router.mjs';
import { registerNativeTaskUi, NATIVE_TASK_URI } from './native-task-ui.mjs';

const root = process.env.CODEX_DSH_BRIDGE_HOME ?? fileURLToPath(new URL('../.local/', import.meta.url));
const webEmbedBasePort = Number(process.env.CODEX_DSH_WEB_BASE_PORT ?? 8800);
if (!Number.isInteger(webEmbedBasePort) || webEmbedBasePort < 1024 || webEmbedBasePort > 65533) {
  throw new Error('CODEX_DSH_WEB_BASE_PORT must be an integer between 1024 and 65533.');
}
const nativeBridge = await new Bridge({ root, webEmbedBasePort }).init();
const worker = await new WorkerTasks({ root, enabled: async () => (await nativeBridge.config()).enabled }).init();
const bridge = new TaskRouter(nativeBridge,worker);
const nativeMcpUi = process.env.CODEX_DSH_UI === 'mcp';
const uiDiagnostics = process.env.CODEX_DSH_UI_DIAGNOSTICS === 'on';
const arg = process.argv[2];
if (arg) {
  if (arg === '--enable' || arg === '--disable') console.log(JSON.stringify(await bridge.setEnabled(arg === '--enable')));
  else if (arg === '--status') console.log(JSON.stringify(await bridge.list(), null, 2));
  else throw new Error('Use --enable, --disable, --status, or no argument for MCP stdio.');
} else {
  const server = new McpServer({ name: 'codex-dsh-native-p0', version: '0.1.1' }, {
    instructions: 'Optional native DSH bridge. Caller chooses light or coding per task. After ds_start, retain agent_id and continue independent work in parallel; the dispatch call itself renders the task card, which is the single user-visible entry tracking this task. Do not emit extra observe/panel calls to show progress — observation belongs to the card (and ds_panel only when the user asks for a persistent side entry). ds_observe is only for attaching a card to a task dispatched before this card-bearing flow. Collect with ds_wait only when results are needed; a timeout means pending, not completion. There is no native Codex desktop wakeup callback in P0; do not end the parent task with uncollected work. Use ds_followup for the same task/session. Worker corrections require ds_review revise and obey its existing issue budget. Do not duplicate a task in both agents. Use ds_fallback only after inspecting existing edits and terminal status; unknown acceptance must be reconciled, never replayed. Assign exclusive files or separate worktrees to concurrent writers, including yourself. Native DSH SDK manages context and compaction; summaries returned here do not replace native history. completed means the turn ended, not that requested artifacts or commands passed: inspect warnings, real tool results and actual artifacts before acceptance. Token caps are per model request, not total task cost.',
  });
  const add = (name, description, inputSchema, handler, presentation = {}) => server.registerTool(name, { description, inputSchema, ...presentation }, async args => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error.message) }] };
    }
  });
  const agent = z.string().uuid().describe('Retain the ID returned by ds_start; followups reuse it.');
  const resourceUri = nativeMcpUi ? NATIVE_TASK_URI : 'ui://dsh-native/observer.html';
  const nativeUi = nativeMcpUi ? registerNativeTaskUi(server, {
    diagnostics: uiDiagnostics,
    onSignal: async args => {
      if (!uiDiagnostics) return;
      const dir = join(root, 'review');
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'native-ui-evidence.jsonl'), JSON.stringify({ ...args, at: new Date().toISOString() }) + '\n');
    },
    resolveTask: (id,wait) => bridge.resolveTask(id,wait),
    retainView: id => nativeBridge.retainView(id),
    workerEvents: (id,after,limit) => worker.events(id,after,limit),
    listTasks: async () => (await bridge.list()).items,
  }) : null;
  if (!nativeMcpUi) server.registerResource('dsh-observer', resourceUri, { title: 'DSH 执行记录', mimeType: 'text/html;profile=mcp-app' }, async () => ({
    contents: [{ uri: resourceUri, mimeType: 'text/html;profile=mcp-app',
      text: await readFile(new URL('../dist/observer.html', import.meta.url), 'utf8'),
      // MCP Apps blocks nested frames by default. Only allow the loopback
      // origin served by this bridge; task ports vary between runtimes.
      _meta: { ui: { prefersBorder: true, csp: { frameDomains: ['http://127.0.0.1:*'] } }, 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } },
    }],
  }));
  add('ds_bridge', 'Inspect native bridge tasks or explicitly turn new dispatches on/off. Turning off does not interrupt running tasks.', {
    enabled: z.boolean().optional(),
  }, async ({ enabled }) => {
    if (enabled !== undefined) await bridge.setEnabled(enabled);
    return bridge.list();
  });
  add('ds_start', 'Start a persistent DSH task asynchronously. backend:native uses the original native harness and body stream; backend:worker uses the retained configured deepseek_worker through MCP, with durable wrapper and worker_agent_id identities. Worker requires stable issue_id and ds_review(pass/revise) before revision; it cannot promise native UI streaming or subagents. An explicit unsupported maxTokens is rejected before dispatch, never silently dropped. Native light defaults to 8192 output tokens/request, coding to 32768; caps are not context or total-cost limits. Continue independent parent work and collect with ds_wait. Caller prepares cwd/separate worktrees; role peer/sub is an organizational label. subagents:true mounts official native delegation. User takeover is not implemented; native message input is hidden. Never duplicate an unknown or possibly running task on the other backend; inspect and stop/reconcile first.', {
    task: z.string().min(1).describe('Self-contained bounded task, artifacts to produce, verification and concise final delivery.'),
    cwd: z.string().min(1).describe('Absolute task workspace; separate worktree for concurrent code writers.'),
    name: z.string().max(100).optional(),
    mode: z.enum(['light', 'coding']).default('light'),
    role: z.enum(['sub', 'peer']).default('peer'),
    subagents: z.boolean().default(false),
    backend: z.enum(['native', 'worker']).default('native'),
    issue_id: z.string().min(1).max(200).optional().describe('Required for worker: stable issue identity across corrections; never change it to evade the worker correction budget.'),
    webEmbed: z.boolean().default(true),
    permission: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
    model: z.string().optional(),
    provider: z.string().optional(),
    effort: z.string().optional(),
    maxTokens: z.number().int().min(1024).max(32768).optional().describe('Caller-selected per-request output cap, 1024..32768. Choose to fit the bounded task; omission uses the mode preset. Existing followups retain this cap. Not a total task budget.'),
  }, args => bridge.start(args), {
    // P0-A single entry: the dispatch call itself renders the task card, so
    // one dsh-xxx row owns the whole task lifecycle; collection and
    // observation ride the card instead of separate user-visible calls.
    title: 'DS 任务',
    _meta: { ui: { resourceUri } },
  });
  add('ds_fallback','Hand off a failed native task to retained worker. A completed turn also needs explicit rejectionReason based on inspected artifacts: a protocol end is not artifact acceptance. Supply bounded remaining work and stable issue_id. Closes native runtime first; running/unknown/user-interrupted tasks are refused. Repeating returns the same fallback. Native conversation is retired. Worker does not inherit native output cap: omission uses its worker-policy warning; unsupported explicit cap fails before handoff.',{
    agent_id:agent,task:z.string().min(1),issue_id:z.string().min(1).max(200),rejectionReason:z.string().min(1).max(2000).optional(),name:z.string().max(100).optional(),maxTokens:z.number().int().min(1024).max(32768).optional(),
  },args=>bridge.fallback(args),{title:'DS worker 兜底',_meta:{ui:{resourceUri}}});
  add('ds_followup', 'Continue an idle task with the same backend, workspace and retained conversation. Native output cap is retained. Worker requires ds_review revise, obeys its correction cap, and retains worker_agent_id. Unknown acceptance cannot be replayed.', {
    agent_id: agent,
    task: z.string().min(1),
  }, ({ agent_id, task }) => bridge.followup(agent_id, task));
  add('ds_review','Review a settled worker delivery as pass or revise after inspecting actual artifacts. The retained worker owns correction limits; do not bypass takeover_required with a new issue_id. Not a native-session review ledger.',{
    agent_id:agent,verdict:z.enum(['pass','revise']),feedback:z.string().min(1).max(12000),
  },({agent_id,verdict,feedback})=>bridge.review(agent_id,verdict,feedback));
  add('ds_wait', 'Collect compact progress, warnings or a bounded final answer from either backend. Native wait wakes on a fresh event; worker uses its asynchronous retained collector. timeoutMs<=50000. Running remains pending. completed means protocol settlement, not artifact acceptance; completed_with_warnings includes native tool failures. Inspect actual ds_events and artifacts, never accept a claim that tests passed without evidence. Full final text is in resultPath.', {
    agent_id: agent,
    timeoutMs: z.number().int().min(0).max(50000).default(50000),
  }, ({ agent_id, timeoutMs }) => bridge.wait(agent_id, timeoutMs));
  add('ds_stop', 'Interrupt only this task: native closes its dedicated SDK runtime, worker calls its retained interrupt interface. History remains; filesystem edits are not rolled back. Unknown worker identity cannot be stopped by guessing. Other bridge tasks continue.', {
    agent_id: agent,
  }, ({ agent_id }) => bridge.stop(agent_id));
  add('ds_events', 'Read actual DSH tool calls, results, visible messages and turn boundaries from native session storage. Read-only, no model calls. Continue from cursor with after_seq. Also accepts a native child session id (subagent) listed in a task summary — children are observation-only. Omits reasoning and provider request headers. Does not itself prove that the host renders a live UI.', {
    agent_id: agent,
    after_seq: z.union([z.number().int().min(-1),z.string().max(2000)]).default(-1).describe('Native numeric sequence or worker opaque next_cursor; return the cursor unchanged.'),
    limit: z.number().int().min(1).max(50).default(30),
  }, ({ agent_id, after_seq, limit }) => bridge.events(agent_id, after_seq, limit), {
    annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['model', 'app'] } },
  });
  add('ds_observe', nativeMcpUi
    ? 'Attach the original DSH frontend to one existing task using the MCP carrier. Exact native session navigation and the executing runtime own the live body; opening the view sends no model prompt. Ordinary user message input is hidden. Use only to attach a missing/old task card, not as a second progress entry.'
    : 'Attach the legacy official-Web iframe card to an existing task. It requires an available per-task URL or explicitly enabled legacy replay; the host may block loopback frames. Prefer the MCP native UI switch on verified hosts. Opening the view sends no model prompt.', {
    agent_id: agent,
  }, ({ agent_id }) => bridge.status(agent_id), {
    title: '查看 DS 执行过程', annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri } },
  });
  add('ds_panel', 'Open the DSH observer as an optional conversation side-panel entrypoint on compatible hosts. Same official-UI container as ds_observe: select a task for status, children and takeover hints; the embedded native UI owns all conversation rendering. UI placement depends on host support.', {}, () => bridge.list(), {
    title: 'DS 并行任务', annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
  });

  let exiting = false;
  const close = async () => {
    if (exiting) return;
    exiting = true;
    nativeUi?.close();
    await bridge.close();
    await server.close();
  };
  process.once('SIGINT', () => { void close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void close().catch(() => { process.exitCode = 1; }); });
  process.stdin.once('end', () => { void close().catch(() => { process.exitCode = 1; }); });
  await server.connect(new StdioServerTransport());
  // Retired loopback replay never starts implicitly. Task-owned runtimes and
  // the MCP native UI are independent of this optional legacy service.
  if (!nativeMcpUi && process.env.DSH_NATIVE_REPLAY === 'on') nativeBridge.ensureNativeReplay().catch(() => {});
}
