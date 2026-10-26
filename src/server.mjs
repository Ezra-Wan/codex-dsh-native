import { fileURLToPath } from 'node:url';
import { readFile, mkdir, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Bridge } from './bridge.mjs';
import { WorkerTasks } from './worker-tasks.mjs';
import { TaskRouter } from './task-router.mjs';
import { registerNativeTaskUi, NATIVE_TASK_URI, NATIVE_PEER_URI } from './native-task-ui.mjs';
import { conversationIdentity, tasksInConversation } from './call-observation.mjs';

const root = process.env.CODEX_DSH_BRIDGE_HOME ?? fileURLToPath(new URL('../.local/', import.meta.url));
const webEmbedBasePort = Number(process.env.CODEX_DSH_WEB_BASE_PORT ?? 0);
if (!Number.isInteger(webEmbedBasePort) || (webEmbedBasePort!==0&&(webEmbedBasePort < 1024 || webEmbedBasePort > 65533))) {
  throw new Error('CODEX_DSH_WEB_BASE_PORT must be 0 (OS assigned) or an integer between 1024 and 65533.');
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
  const server = new McpServer({ name: 'codex-dsh-native-p0', version: '0.1.3-preview.2' }, {
    instructions: 'Optional native DSH bridge. Dispatch sub with ds_start, peer with ds_start_peer; continue with the matching ds_followup or ds_followup_peer, and attach with ds_observe or ds_observe_peer. Static tool resource declarations choose inline versus fullscreen-only before the view loads; execution/session management remains shared. Explicit role controls presentation: sub is a subordinate task with invocation-only inline content and full native history in the side view; peer is independent parallel cooperation, side view only. Do not infer role from running counts or change presentation when another task ends. Choose role explicitly at dispatch and retain it across followups. Each ds_start and ds_followup returns its own observation.call_id on the same persistent agent/session. Keep the call_id when reopening an invocation. Inline history is bounded to that invocation and freezes at settlement; the side view retains complete native history. Observe is allowed whenever a current entry is missing or needs reattaching; reuse a working entry instead of duplicating it. No rule forbids the tool calls needed for observation, and MCP cannot promise to hide Codex tool-call rows. If a Codex reply ends while the agent is still active, use the matching ds_observe or ds_observe_peer with freeze:true to seal that invocation view without stopping execution. Use a host conversation identity when provided; otherwise supply conversation_id consistently if known. Unknown identity must not expose the global task list. For independent authorized tasks, dispatch multiple peer tasks before collecting. Continue independent parent work and collect with ds_wait only when results are needed. timeoutMs<=50000; timeout means pending, not completion. Native roots/resident runtimes are capped by ds_bridge maxParallel, not all children or worker tasks. Native DSH owns context and compaction. Worker revisions require ds_review revise and the existing issue budget. completed is protocol settlement, not artifact acceptance; inspect actual tools and artifacts. Do not duplicate tasks or replay unknown acceptance. Connection loss does not prove laptop offline or caller stop; inspect failure evidence and reconcile the same identity. Separate concurrent writers by files/worktrees. Output caps are per-request, not total cost. There is no native Codex wakeup callback in this preview.',
  });
  const add = (name, description, inputSchema, handler, presentation = {}) => server.registerTool(name, { description, inputSchema, ...presentation }, async (args, extra) => {
    try {
      const result = await handler(args, extra);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: String(error.message) }] };
    }
  });
  const agent = z.string().uuid().describe('Retain the ID returned by ds_start; followups reuse it.');
  const resourceUri = nativeMcpUi ? NATIVE_TASK_URI : 'ui://dsh-native/observer.html';
  const peerUri = nativeMcpUi ? NATIVE_PEER_URI : resourceUri;
  const requireRole=async(id,role)=>{const task=await bridge.status(id);if(task.role!==role)throw Error(`This is ${task.role}; use ds_${role==='sub'?'followup_peer / ds_observe_peer':'followup / ds_observe'} for the retained role`);return task;};
  const nativeUi = nativeMcpUi ? registerNativeTaskUi(server, {
    diagnostics: uiDiagnostics,
    onSignal: async args => {
      if (!uiDiagnostics) return;
      const dir = join(root, 'review');
      await mkdir(dir, { recursive: true });
      await appendFile(join(dir, 'native-ui-evidence.jsonl'), JSON.stringify({ ...args, at: new Date().toISOString() }) + '\n');
    },
    resolveTask: (id,wait,callId) => bridge.resolveTask(id,wait,callId),
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
  add('ds_bridge', 'Inspect tasks, toggle new dispatches, or dynamically set maxParallel (1..8). Default 2; applies to native root tasks and resident runtimes in this MCP process, not native child agents or the retained worker. Lowering never interrupts existing tasks/views; new work waits for capacity. Settings persist for the next connection. Dispatch first and collect later when independent tasks can overlap.', {
    enabled: z.boolean().optional(),
    maxParallel:z.number().int().min(1).max(8).optional(),
  }, async ({ enabled,maxParallel }) => {
    if (enabled !== undefined||maxParallel!==undefined) await bridge.configure({enabled,maxParallel});
    return bridge.list();
  });
  const startSchema = {
    task: z.string().min(1).describe('Self-contained bounded task, artifacts to produce, verification and concise final delivery.'),
    cwd: z.string().min(1).describe('Absolute task workspace; separate worktree for concurrent code writers.'),
    name: z.string().max(100).optional(),
    mode: z.enum(['light', 'coding']).default('light'),
    role: z.enum(['sub', 'peer']).default('sub').describe('Choose explicitly: sub = invocation-only inline plus full side history; peer = independent parallel agent, side view only. Not inferred from concurrency.'),
    conversation_id: z.string().min(1).max(200).optional().describe('Current Codex conversation identifier if known; host openai/session metadata takes precedence. Never invent another chat identity.'),
    subagents: z.boolean().default(false),
    ops:z.enum(['off','files','full']).default('off').describe('Opt-in original dsh-ops@0.3.0: files enables native file tools; full also enables bundled shell. Requires separately installed isolated OPS profiles. Full workspace-write shell may prepare directory permissions via the plugin; do not use it to bypass a pending permission decision. Background/PTC remain disabled. Retained worker OPS support is unverified.'),
    backend: z.enum(['native', 'worker']).default('native'),
    issue_id: z.string().min(1).max(200).optional().describe('Required for worker: stable issue identity across corrections; never change it to evade the worker correction budget.'),
    webEmbed: z.boolean().default(true),
    permission: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
    model: z.string().optional(),
    provider: z.string().optional(),
    effort: z.string().optional(),
    maxTokens: z.number().int().min(1024).max(32768).optional().describe('Caller-selected per-request output cap, 1024..32768. Choose to fit the bounded task; omission uses the mode preset. Existing followups retain this cap. Not a total task budget.'),
  };
  add('ds_start', 'Start a persistent DSH task asynchronously. backend:native uses the original native harness and body stream; backend:worker uses the retained configured deepseek_worker through MCP, with durable wrapper and worker_agent_id identities. Worker requires stable issue_id and ds_review(pass/revise) before revision; it cannot promise native UI streaming or subagents. An explicit unsupported maxTokens is rejected before dispatch, never silently dropped. Native light defaults to 8192 output tokens/request, coding to 32768; caps are not context or total-cost limits. Continue independent parent work and collect with ds_wait. Caller prepares cwd/separate worktrees; role sub/peer controls inline versus side-only presentation. subagents:true mounts official native delegation. User takeover is not implemented; native message input is hidden. Never duplicate an unknown or possibly running task on the other backend; inspect and stop/reconcile first.', {...startSchema,role:z.literal('sub').default('sub')}, (args,extra) => {if(args.role!=='sub')throw Error('Use ds_start_peer with role=peer for a declared side-only entry; no task was sent');return bridge.start({...args,conversation_id:conversationIdentity(args,extra)});}, {
    // Per-invocation UI declaration; not a promise to hide host tool rows.
    title: 'DS 子 agent〔sub〕',
    _meta: { ui: { resourceUri } },
  });
  add('ds_start_peer','Start an independent cooperating peer. The same DSH harness as ds_start; declared fullscreen-only BEFORE rendering, never an inline placeholder. role is explicitly peer. Retain agent_id and collect later; use ds_followup_peer for continuations.', {...startSchema,role:z.literal('peer').default('peer')},(args,extra)=>bridge.start({...args,conversation_id:conversationIdentity(args,extra)}),{title:'DS 协作 agent〔peer〕',_meta:{ui:{resourceUri:peerUri}}});
  add('ds_fallback','Hand off a failed native task to retained worker. A completed turn also needs explicit rejectionReason based on inspected artifacts: a protocol end is not artifact acceptance. Supply bounded remaining work and stable issue_id. Closes native runtime first; running/unknown/user-interrupted tasks are refused. Repeating returns the same fallback. Native conversation is retired. Worker does not inherit native output cap: omission uses its worker-policy warning; unsupported explicit cap fails before handoff.',{
    agent_id:agent,task:z.string().min(1),issue_id:z.string().min(1).max(200),rejectionReason:z.string().min(1).max(2000).optional(),name:z.string().max(100).optional(),maxTokens:z.number().int().min(1024).max(32768).optional(),
  },async args=>{await requireRole(args.agent_id,'sub');return bridge.fallback(args);},{title:'DS 子 agent worker 兜底',_meta:{ui:{resourceUri}}});
  add('ds_fallback_peer','Hand off a confirmed failed cooperating peer to the retained worker using a side-only entry. Same stop/reconcile safeguards as ds_fallback.',{agent_id:agent,task:z.string().min(1),issue_id:z.string().min(1).max(200),rejectionReason:z.string().min(1).max(2000).optional(),name:z.string().max(100).optional(),maxTokens:z.number().int().min(1024).max(32768).optional()},async args=>{await requireRole(args.agent_id,'peer');return bridge.fallback(args);},{title:'DS 协作 agent worker 兜底',_meta:{ui:{resourceUri:peerUri}}});
  add('ds_followup', 'Continue an idle task with the same backend, workspace and retained conversation. Native output cap is retained. Worker requires ds_review revise, obeys its correction cap, and retains worker_agent_id. Unknown acceptance cannot be replayed.', {
    agent_id: agent,
    task: z.string().min(1),
    conversation_id: z.string().min(1).max(200).optional(),
  }, async ({ agent_id, task, conversation_id },extra) => {await requireRole(agent_id,'sub');return bridge.followup(agent_id, task, {conversation_id:conversationIdentity({conversation_id},extra)});}, {title:'DS 子 agent〔sub〕续接',_meta:{ui:{resourceUri}}});
  add('ds_followup_peer','Continue the same cooperating peer/session with a new invocation and a side-only entry. Never change its role or duplicate the conversation.',{agent_id:agent,task:z.string().min(1),conversation_id:z.string().min(1).max(200).optional()},async(args,extra)=>{await requireRole(args.agent_id,'peer');return bridge.followup(args.agent_id,args.task,{conversation_id:conversationIdentity(args,extra)});},{title:'DS 协作 agent〔peer〕续接',_meta:{ui:{resourceUri:peerUri}}});
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
    ? 'Attach the original DSH frontend to one existing task using the MCP carrier. Exact native session navigation and the executing runtime own the live body; opening the view sends no model prompt. Ordinary user message input is hidden. Attach whenever the desired invocation has no usable entry; retain its call_id. Side view shows full native history. freeze:true seals only the invocation view, never stops the task.'
    : 'Attach the legacy official-Web iframe card to an existing task. It requires an available per-task URL or explicitly enabled legacy replay; the host may block loopback frames. Prefer the MCP native UI switch on verified hosts. Opening the view sends no model prompt.', {
    agent_id: agent,
    call_id: z.string().uuid().optional(),
    freeze: z.boolean().default(false),
  }, async ({ agent_id, call_id, freeze }) => {await requireRole(agent_id,'sub');return freeze?bridge.freezeObservation(agent_id,call_id):bridge.resolveTask(agent_id,false,call_id);}, {
    title: '查看 DS 子 agent〔sub〕', annotations: { readOnlyHint: true }, _meta: { ui: { resourceUri } },
  });
  add('ds_observe_peer','Attach a cooperating peer directly in the side view. No model prompt; retain call_id to identify the invocation. Full native session history is available.',{agent_id:agent,call_id:z.string().uuid().optional(),freeze:z.boolean().default(false)},async({agent_id,call_id,freeze})=>{await requireRole(agent_id,'peer');return freeze?bridge.freezeObservation(agent_id,call_id):bridge.resolveTask(agent_id,false,call_id);},{title:'查看 DS 协作 agent〔peer〕',annotations:{readOnlyHint:true},_meta:{ui:{resourceUri:peerUri}}});
  add('ds_panel', 'Open the DSH observer as an optional conversation side-panel entrypoint on compatible hosts. Same official-UI container as ds_observe: select a task for status, children and takeover hints; the embedded native UI owns all conversation rendering. UI placement depends on host support. Scope the list to this Codex conversation; without identity, anchor it to an explicit agent.', {agent_id:agent.optional(),conversation_id:z.string().min(1).max(200).optional()}, async(args,extra) => {const all=await bridge.list();const anchor=args.agent_id?await bridge.status(args.agent_id):null;return {...all,items:tasksInConversation(all.items,anchor,conversationIdentity(args,extra))};}, {
    title: 'DSH 会话历史', annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri:peerUri }, 'openai/ui': { entrypoints: [{ type: 'thread' }] } },
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
