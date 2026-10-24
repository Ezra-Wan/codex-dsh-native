import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Bridge } from './bridge.mjs';

const root = process.env.CODEX_DSH_BRIDGE_HOME ?? fileURLToPath(new URL('../.local/', import.meta.url));
const webEmbedBasePort = Number(process.env.CODEX_DSH_WEB_BASE_PORT ?? 8800);
if (!Number.isInteger(webEmbedBasePort) || webEmbedBasePort < 1024 || webEmbedBasePort > 65533) {
  throw new Error('CODEX_DSH_WEB_BASE_PORT must be an integer between 1024 and 65533.');
}
const bridge = await new Bridge({ root, webEmbedBasePort }).init();
const arg = process.argv[2];
if (arg) {
  if (arg === '--enable' || arg === '--disable') console.log(JSON.stringify(await bridge.setEnabled(arg === '--enable')));
  else if (arg === '--status') console.log(JSON.stringify(await bridge.list(), null, 2));
  else throw new Error('Use --enable, --disable, --status, or no argument for MCP stdio.');
} else {
  const server = new McpServer({ name: 'codex-dsh-native-p0', version: '0.1.1' }, {
    instructions: 'Optional native DSH bridge. Caller chooses light or coding per task. After ds_start, retain agent_id and continue independent work in parallel; the dispatch call itself renders the task card, which is the single user-visible entry tracking this task. Do not emit extra observe/panel calls to show progress — observation belongs to the card (and ds_panel only when the user asks for a persistent side entry). ds_observe is only for attaching a card to a task dispatched before this card-bearing flow. Collect with ds_wait only when results are needed; a timeout means pending, not completion. There is no native Codex desktop wakeup callback in P0; do not end the parent task with uncollected work. Use ds_followup for the same task/session. Do not duplicate a task in both agents. Assign exclusive files or separate worktrees to concurrent writers, including yourself. Native DSH SDK manages context and compaction; summaries returned here do not replace native history. Inspect warnings, output and actual artifacts before accepting completion. Token caps are per model request, not total task cost.',
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
  const resourceUri = 'ui://dsh-native/observer.html';
  server.registerResource('dsh-observer', resourceUri, { title: 'DSH 执行记录', mimeType: 'text/html;profile=mcp-app' }, async () => ({
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
  add('ds_start', 'Start an independent native DeepSeek Harness task asynchronously. Both modes retain native tools, workspace, history and automatic compaction. light defaults to 8192 output tokens/request; coding to 32768. These are not context-window or total-spend limits. Return immediately, continue independent parent work, then collect with ds_wait. Do not use for work outside the user-authorized scope. role: peer works a copied workspace (git worktree of the parent repo) and may later be driven by the user in the native web UI; role: sub marks a derived X__<task> workspace whose session may spawn native subagents (subagents: true mounts the official delegation tool; children are observable via ds_events using their session ids but can never be followed up directly). backend: native (default) runs here; backend: worker returns an explicit failover directive to dispatch through the retained deepseek_worker MCP instead — choose it only when this executor cannot take the work, and never rerun a status-unknown native task on the worker without checking it first.', {
    task: z.string().min(1).describe('Self-contained bounded task, artifacts to produce, verification and concise final delivery.'),
    cwd: z.string().min(1).describe('Absolute task workspace; separate worktree for concurrent code writers.'),
    name: z.string().max(100).optional(),
    mode: z.enum(['light', 'coding']).default('light'),
    role: z.enum(['sub', 'peer']).default('peer'),
    subagents: z.boolean().default(false),
    backend: z.enum(['native', 'worker']).default('native'),
    webEmbed: z.boolean().default(true),
    permission: z.enum(['read-only', 'workspace-write']).default('workspace-write'),
    model: z.string().optional(),
    provider: z.string().optional(),
    effort: z.string().optional(),
    maxTokens: z.number().int().min(1024).max(32768).optional(),
  }, args => bridge.start(args), {
    // P0-A single entry: the dispatch call itself renders the task card, so
    // one dsh-xxx row owns the whole task lifecycle; collection and
    // observation ride the card instead of separate user-visible calls.
    title: 'DS 任务',
    _meta: { ui: { resourceUri } },
  });
  add('ds_followup', 'Continue an idle native DSH session with its persisted context. The same workspace, model, permission and output cap are retained. Missing native history fails; it is never silently replaced with a fresh session.', {
    agent_id: agent,
    task: z.string().min(1),
  }, ({ agent_id, task }) => bridge.followup(agent_id, task));
  add('ds_wait', 'Collect compact progress, actual recent actions, warnings or a bounded final answer. Returns as soon as a fresh native event arrives (event-driven bounded wait), at the timeout, or at completion. Running remains pending. completed_with_warnings means native tool failures occurred and must be inspected using ds_events. Full final text is in resultPath. failed/interrupted is not success.', {
    agent_id: agent,
    timeoutMs: z.number().int().min(0).max(50000).default(50000),
  }, ({ agent_id, timeoutMs }) => bridge.wait(agent_id, timeoutMs));
  add('ds_stop', 'Interrupt this bridge task by closing its dedicated SDK runtime. Native history remains resumable; filesystem edits are not rolled back. Other bridge tasks continue.', {
    agent_id: agent,
  }, ({ agent_id }) => bridge.stop(agent_id));
  add('ds_events', 'Read actual DSH tool calls, results, visible messages and turn boundaries from native session storage. Read-only, no model calls. Continue from cursor with after_seq. Also accepts a native child session id (subagent) listed in a task summary — children are observation-only. Omits reasoning and provider request headers. Does not itself prove that the host renders a live UI.', {
    agent_id: agent,
    after_seq: z.number().int().min(-1).default(-1),
    limit: z.number().int().min(1).max(50).default(30),
  }, ({ agent_id, after_seq, limit }) => bridge.events(agent_id, after_seq, limit), {
    annotations: { readOnlyHint: true }, _meta: { ui: { visibility: ['model', 'app'] } },
  });
  add('ds_observe', 'Show one DSH task in the conversation: the card is a container for the OFFICIAL native web UI (same implementation as the desktop app), embedding it via the local native-replay adapter. The fallback panel lists tasks and status when embedding is unavailable. The view itself reads official session storage; it never calls the model.', {
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
    await bridge.close();
    await server.close();
  };
  process.once('SIGINT', () => { void close().catch(() => { process.exitCode = 1; }); });
  process.once('SIGTERM', () => { void close().catch(() => { process.exitCode = 1; }); });
  process.stdin.once('end', () => { void close().catch(() => { process.exitCode = 1; }); });
  await server.connect(new StdioServerTransport());
  // The observer card embeds the official web UI; boot it out-of-band so the
  // first open is ready. Failure only degrades the card to its fallback.
  // DSH_NATIVE_REPLAY=off keeps tests (and other side-effect-free embedders)
  // from ever spawning the local web process.
  if (process.env.DSH_NATIVE_REPLAY !== 'off') bridge.ensureNativeReplay().catch(() => {});
}
