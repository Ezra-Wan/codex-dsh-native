import { mkdir, readFile, writeFile, rename, stat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRuntime, writeSubagentPatch, writeWebEmbedPatch } from './runtime.mjs';
import { visibleEvent, readNativeEvents } from './trace.mjs';

export const MODES = Object.freeze({
  light: { maxTokens: 8192, returnChars: 4000 },
  coding: { maxTokens: 32768, returnChars: 12000 },
});
const ID = /^[a-f0-9-]{36}$/;
const ACTIVE = new Set(['starting', 'running', 'stopping']);
export async function atomicJson(path, data) {
  await mkdir(resolve(path, '..'), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}

function errorText(error) {
  // Runtime errors can contain provider URLs. Avoid returning credentials in them.
  return String(error?.message ?? error)
    .replace(/([?&](?:token|api_key|key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .slice(0, 3000);
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return true;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

export class Bridge {
  constructor({ root, runtimeFactory = createRuntime, idleMs = 120_000, maxParallel = 2, patches = [], webEmbedBasePort = 8800 }) {
    this.root = resolve(root);
    this.home = join(this.root, 'dsh-home');
    this.tasks = join(this.root, 'tasks');
    this.runtimeFactory = runtimeFactory;
    this.idleMs = idleMs;
    this.maxParallel = maxParallel;
    this.patches = patches;
    this.webEmbedBasePort = webEmbedBasePort;
    this.live = new Map();
    this.admission = Promise.resolve();
    this.closing = false;
    this.portCursor = 0;
  }

  async init() {
    await mkdir(this.tasks, { recursive: true });
    await mkdir(this.home, { recursive: true });
    await mkdir(join(this.root, 'task-urls'), { recursive: true });
    return this;
  }

  // Each web-embed task owns one loopback port; allocation is deterministic
  // from the base and skips ports already handed out in this process.
  nextWebPort() {
    this.portCursor += 1;
    return this.webEmbedBasePort + this.portCursor;
  }

  path(id) {
    if (!ID.test(id)) throw new Error('Invalid agent_id');
    return join(this.tasks, `${id}.json`);
  }

  async config() {
    try { return JSON.parse(await readFile(join(this.root, 'settings.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { enabled: false }; throw error; }
  }

  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
    await atomicJson(join(this.root, 'settings.json'), { enabled });
    return { enabled, activeTasksContinue: true };
  }

  async read(id) { return JSON.parse(await readFile(this.path(id), 'utf8')); }
  async save(record) { await atomicJson(this.path(record.agent_id), record); }

  async claim(id) {
    this.path(id); // Validate before deriving any removable lock directory.
    const path = join(this.tasks, `${id}.lock`);
    try { await mkdir(path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = await readFile(join(path, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (!owner || alive(owner.pid)) throw new Error('This session is owned by another bridge process.');
      // Only this exact validated lock directory is removed; native history is untouched.
      await rm(path, { recursive: true });
      return this.claim(id);
    }
    await atomicJson(join(path, 'owner.json'), { pid: process.pid });
    return () => rm(path, { recursive: true, force: true });
  }

  admit(fn) {
    const result = this.admission.then(fn);
    this.admission = result.catch(() => {});
    return result;
  }

  async start({ task, cwd, mode = 'light', name = '', model = 'deepseek-v4-flash', provider = 'deepseek-official', maxTokens, effort, permission = 'workspace-write', subagents = false, role = 'peer', backend = 'native', webEmbed = true }) {
    return this.admit(async () => {
      if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('cwd must be an existing absolute directory');
      if (!MODES[mode]) throw new Error('mode must be light or coding');
      if (!['read-only', 'workspace-write'].includes(permission)) throw new Error('P0 supports read-only or workspace-write');
      if (typeof subagents !== 'boolean') throw new Error('subagents must be boolean');
      if (!['sub', 'peer'].includes(role)) throw new Error('role must be sub or peer');
      if (!['native', 'worker'].includes(backend)) throw new Error('backend must be native or worker');
      // worker backend is an explicit failover marker: execution goes through
      // the retained deepseek_worker MCP, not this bridge. Record it so task
      // directories and summaries never mix backends silently.
      if (backend === 'worker') {
        return { backend: 'worker', agent_id: null, routedTo: 'deepseek_worker',
          note: 'Worker failover is explicit: dispatch this task through the deepseek_worker MCP tools and keep its own session identity. Do not rerun an ambiguous native task on the worker without checking its status first.' };
      }
      const cap = maxTokens ?? MODES[mode].maxTokens;
      if (!Number.isInteger(cap) || cap < 1024 || cap > 32768) throw new Error('maxTokens must be 1024..32768');
      const id = randomUUID();
      const record = {
        agent_id: id, session_id: id, name, cwd: resolve(cwd), mode, model, provider,
        maxTokens: cap, effort, permission, subagents, role, backend: 'native',
        ...(webEmbed ? { webEmbed: true, webPort: this.nextWebPort() } : {}),
        returnChars: MODES[mode].returnChars,
        status: 'new', turn: 0, createdAt: new Date().toISOString(), persisted: false,
      };
      return this.launch(record, task);
    });
  }

  // Poll the adapter-written URL file (local read only; no model, no service
  // started by the bridge). A timeout degrades the card to the fallback and
  // never fails the task itself.
  async awaitWebUrl(entry, timeoutMs = 20_000) {
    const record = entry.record;
    for (let count = 0; count < timeoutMs / 500; count++) {
      if (record.nativeUrlGeneration === record.runtimeGeneration) return;
      const state = await readFile(record.webUrlFile, 'utf8').then(JSON.parse).catch(() => null);
      if (state?.url) {
        record.nativeUrl = state.url;
        record.nativeUrlGeneration = record.runtimeGeneration;
        record.updatedAt = new Date().toISOString();
        await this.save(record).catch(() => {});
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    record.progress.webEmbedMissed = record.webUrlFile;
  }

  async followup(id, task) {
    return this.admit(async () => {
      const current = this.live.get(id);
      if (current?.busy) throw new Error('Agent is busy. Wait or stop before followup.');
      const record = current?.record ?? await this.read(id);
      await this.assertSessionQuiet(record);
      return this.launch(record, task);
    });
  }

  // A peer the user drives in the native web UI keeps writing its session log.
  // Refuse to resume while that log is hot so two drivers never interleave.
  // Real layout: sessions/<workspace-dir>/<session-id>/<log files>. Writes at
  // or before lastSelfWriteAt (+ grace) are the bridge's own turn or its SDK
  // shutdown flush; only fresher writes count as external activity.
  async assertSessionQuiet(record, windowMs = 120_000) {
    if (!record.persisted) return;
    const ownMark = (record.lastSelfWriteAt ?? 0) + 2_000;
    const sessionsRoot = join(this.home, 'sessions');
    for (const workspace of await readdir(sessionsRoot).catch(() => [])) {
      const sessionDir = join(sessionsRoot, workspace, record.session_id);
      const entries = await readdir(sessionDir).catch(() => []);
      if (!entries.length) continue;
      for (const entry of entries) {
        const info = await stat(join(sessionDir, entry)).catch(() => null);
        if (info?.isFile() && Date.now() - info.mtimeMs < windowMs && info.mtimeMs > ownMark) {
          throw new Error('Session log shows external writes within the last 2 minutes; the user side may be driving this peer. Retry after it goes quiet.');
        }
      }
    }
  }

  async launch(record, task) {
    if (this.closing) throw new Error('Bridge is closing');
    if (!(await this.config()).enabled) throw new Error('Bridge is disabled. Enable it explicitly before dispatch.');
    if (typeof task !== 'string' || !task.trim()) throw new Error('task must not be empty');
    const active = [...this.live.values()].filter(entry => entry.busy);
    if (active.length >= this.maxParallel) throw new Error(`Parallel capacity ${this.maxParallel} reached. Wait for a task.`);
    // Read-only tasks may share a workspace. Concurrent writers need separate worktrees.
    if (record.permission !== 'read-only' && active.some(entry => entry.record.permission !== 'read-only' && entry.record.cwd.toLowerCase() === record.cwd.toLowerCase())) {
      throw new Error('Another bridge task is writing this workspace. Use a separate worktree or read-only.');
    }
    let entry = this.live.get(record.agent_id);
    if (!entry) {
      if (this.live.size >= this.maxParallel) {
        const idle = [...this.live.values()].find(item => !item.busy);
        if (idle) await this.release(idle.record.agent_id);
      }
      const release = await this.claim(record.agent_id);
      entry = { record, release, runtime: null, timer: null, done: null, cancel: false, busy: false };
      this.live.set(record.agent_id, entry);
    }
    clearTimeout(entry.timer);
    entry.cancel = false;
    Object.assign(record, {
      status: 'starting', turn: record.turn + 1, updatedAt: new Date().toISOString(),
      error: null, final: '', finishReason: null, usage: null, progress: { eventCount: 0 }, warnings: [], recentActions: [],
      children: {}, userTakeover: null,
    });
    try { await this.save(record); }
    catch (error) {
      record.status = 'failed';
      record.error = errorText(error);
      await this.release(record.agent_id);
      throw error;
    }
    entry.busy = true;
    entry.done = this.execute(entry, task).catch(error => {
      record.status = 'failed';
      record.error = `Could not persist task result: ${errorText(error)}`;
    }).finally(() => { entry.busy = false; });
    // execute catches its own failures; start returns without waiting for the model.
    return this.summary(record);
  }

  async execute(entry, task) {
    const record = entry.record;
    try {
      if (!entry.runtime) {
        // Subagent tasks add the official delegation patch below global ones;
        // web-embed tasks add the per-task webserver port + URL-file adapter
        // on the sdk-web profile (official UI in THIS process → native stream).
        let patches = this.patches;
        if (record.subagents) patches = [...patches, await writeSubagentPatch(this.root)];
        if (record.webEmbed) {
          const urlFile = join(this.root, 'task-urls', `${record.webPort}.json`);
          await rm(urlFile, { force: true });
          patches = [...patches, await writeWebEmbedPatch(this.root, { port: record.webPort, urlFile })];
          record.webUrlFile = urlFile;
          // A NEW runtime generation mints a NEW in-process token; any URL
          // from a previous generation is stale the moment its process died.
          record.runtimeGeneration = (record.runtimeGeneration ?? 0) + 1;
        }
        entry.runtime = this.runtimeFactory(record, { home: this.home, patches, ...(record.webEmbed ? { profile: 'sdk-web' } : {}) });
        await entry.runtime.start();
        if (record.persisted) await entry.runtime.resumeSession(record.session_id);
        else {
          // Create and persist the native identity before the first paid turn.
          await entry.runtime.session(record.session_id).getWorkingDirectory();
          record.persisted = true;
        }
      }
      if (entry.cancel) throw new Error('Interrupted before prompt');
      record.status = 'running';
      await this.save(record);
      // stop() may fire while this turn is between start and run(); re-check
      // after the awaited save, and keep a just-created run promise reachable
      // for interruption instead of outliving the closer's runtime.close().
      if (entry.cancel) throw new Error('Interrupted before prompt');
      // The in-process adapter writes the authenticated official-UI URL once
      // the web stack is live; pick it up without blocking the prompt. The
      // generation guard re-arms after release+followup rebuilt the runtime
      // (the new process mints a new token; the old URL is dead).
      if (record.webEmbed && record.nativeUrlGeneration !== record.runtimeGeneration) void this.awaitWebUrl(entry);
      const runPromise = entry.runtime.run(task, {
        sessionId: record.session_id,
        onNotification: notification => {
          if (notification.method !== 'session.event') return;
          const { sessionId, event } = notification.params;
          // Native descendant sessions (subagents) are observed, never driven:
          // their ids live in record.children only, never as bridge agents.
          if (sessionId !== record.session_id) {
            record.children ??= {};
            record.children[sessionId] = {
              lastEvent: event.type, lastAt: new Date().toISOString(),
              ...(event.seq !== undefined ? { seq: event.seq } : {}),
            };
            return;
          }
          record.progress.eventCount++;
          record.progress.lastEvent = event.type;
          record.progress.lastActivityAt = new Date().toISOString();
          // Wake event-driven ds_wait callers now, not at their timeout.
          if (entry.eventWaiters?.size) for (const wake of entry.eventWaiters) {
            try { wake(record.progress.eventCount); } catch { /* a waiter's own guard */ }
          }
          const action = visibleEvent(event);
          // Bridge prompts exactly one kind=user message per turn (runtime.run);
          // extras beyond record.turn are the user driving this peer elsewhere.
          // record.userPrompts accumulates across turns; record.turn likewise.
          if (event.type === 'user/message' && action?.sourceKind === 'user') {
            record.userPrompts = (record.userPrompts ?? 0) + 1;
          }
          if (action) {
            record.recentActions.push(action);
            if (record.recentActions.length > 12) record.recentActions.shift();
          }
          if (event.type === 'tool/result' && event.data.message.isError) {
            record.warnings.push({ seq: event.seq, callId: event.data.message.toolCallId, message: errorText(action?.text) });
          }
        },
      });
      runPromise.catch(() => {}); // transport close rejects the race loser
      const result = await Promise.race([runPromise, new Promise((_, reject) => {
        entry.interrupt = () => reject(new Error('Interrupted by stop'));
      })]);
      record.final = result.finalResponse;
      const extraUserPrompts = (record.userPrompts ?? 0) - record.turn;
      if (extraUserPrompts > 0) {
        record.userTakeover = { events: extraUserPrompts, lastAt: record.progress.lastActivityAt, hint: 'User drove this peer outside the bridge; read the session tail before continuing.' };
      }
      const turnEnd = result.events.findLast(event => event.type === 'turn/end');
      record.finishReason = turnEnd?.data?.reason?.kind ?? 'unknown';
      const measured = result.events.filter(event => event.type === 'assistant/message' && event.data.usage);
      record.usage = measured.length ? { measuredCalls: measured.length, scope: 'root committed model replies; excludes compaction, failed attempts and descendants' } : null;
      for (const event of measured) {
        for (const [key, value] of Object.entries(event.data.usage)) {
          if (typeof value === 'number') record.usage[key] = (record.usage[key] ?? 0) + value;
        }
      }
      const interrupted = entry.cancel || ['aborted', 'interrupted'].includes(record.finishReason);
      record.status = interrupted ? 'interrupted' : record.finishReason === 'completed' && record.final ? 'completed' : 'failed';
      if (record.status !== 'completed') record.error = errorText(turnEnd?.data?.reason?.error?.message ?? `Native turn ended: ${record.finishReason}`);
      if (record.finishReason === 'max-tokens') record.error = 'Output cap reached; partial answer is not accepted as complete.';
      if (!record.final && !record.error) record.error = 'Native session returned no final assistant text.';
      if (record.status === 'completed' && record.warnings.length) record.status = 'completed_with_warnings';
      const resultPath = join(this.tasks, `${record.agent_id}.turn-${record.turn}.txt`);
      await writeFile(resultPath, record.final, { mode: 0o600 });
      record.resultPath = resultPath;
    } catch (error) {
      record.status = entry.cancel ? 'interrupted' : 'failed';
      record.error = errorText(error);
      // A dead transport must never be reused; native resume is the next path.
      if (entry.runtime) {
        try { await entry.runtime.close(); entry.runtime = null; }
        catch (cleanup) { record.error += `; cleanup: ${errorText(cleanup)}`; }
      }
    } finally {
      record.updatedAt = new Date().toISOString();
      // The external-activity guard compares native-log freshness against
      // this mark so the bridge's own writes never read as a user takeover.
      record.lastSelfWriteAt = Date.now();
      try { await this.save(record); }
      finally {
        entry.timer = setTimeout(() => this.admit(() => this.release(record.agent_id)).catch(() => {}), this.idleMs);
        entry.timer.unref();
      }
    }
  }

  summary(record) {
    const { agent_id, session_id, name, mode, model, maxTokens, permission, cwd, turn, status, progress, error, resultPath, finishReason, usage } = record;
    const final = (record.final ?? '').slice(0, record.returnChars);
    const children = Object.entries(record.children ?? {}).map(([child_id, info]) => ({ child_id, ...info }));
    return { agent_id, session_id, name, role: record.role ?? 'peer', backend: record.backend ?? 'native', ...(record.subagents ? { subagents: true } : {}), ...(record.nativeUrl ? { nativeUrl: record.nativeUrl } : {}), mode, model, maxTokens, permission, cwd, turn, status, progress,
      ...(children.length ? { children } : {}),
      ...(record.userTakeover ? { userTakeover: record.userTakeover } : {}),
      error,
      warnings: record.warnings ?? [],
      recentActions: (record.recentActions ?? []).slice(-6).map(action => ({ ...action, text: action.text?.slice(0, 600), truncated: action.truncated || action.text?.length > 600 })),
      ...(final || resultPath ? { final, resultPath, resultTruncated: final.length < (record.final ?? '').length, finishReason, usage } : {}) };
  }

  async events(id, afterSeq = -1, limit = 30) {
    const live = this.live.get(id)?.record;
    if (live) {
      if (!live.persisted) return { session_id: live.session_id, source: 'native-dsh-session-log', events: [], cursor: afterSeq, hasMore: false };
      return readNativeEvents(this.home, live.session_id, afterSeq, limit);
    }
    // Children are readable while their parent task still runs: the in-memory
    // children index covers records not yet persisted to the task file.
    for (const entry of this.live.values()) {
      if (entry.record.children && id in entry.record.children) return readNativeEvents(this.home, id, afterSeq, limit);
    }
    try {
      const record = await this.read(id);
      if (!record.persisted) return { session_id: record.session_id, source: 'native-dsh-session-log', events: [], cursor: afterSeq, hasMore: false };
      return readNativeEvents(this.home, record.session_id, afterSeq, limit);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Not a bridge agent: may be a native child session of one. Children are
      // read-only observation targets recorded in their parent's task file.
      const owner = await this.childOwner(id);
      if (!owner) throw error;
      return readNativeEvents(this.home, id, afterSeq, limit);
    }
  }

  async childOwner(childId) {
    if (!ID.test(childId)) return null;
    const names = (await readdir(this.tasks)).filter(name => name.endsWith('.json') && ID.test(name.replace(/\.json$/, '')));
    for (const name of names) {
      const record = await this.read(name.slice(0, -5)).catch(() => null);
      if (record?.children && childId in record.children) return record;
    }
    return null;
  }

  async status(id) {
    const entry = this.live.get(id);
    if (entry) return this.summary(entry.record);
    const record = await this.read(id);
    if (ACTIVE.has(record.status)) {
      const owner = await readFile(join(this.tasks, `${id}.lock`, 'owner.json'), 'utf8').then(JSON.parse).catch(() => null);
      if (!owner || !alive(owner.pid)) {
        return { ...this.summary(record), status: 'interrupted', error: 'Previous bridge process ended. Use followup to resume native history.' };
      }
    }
    return this.summary(record);
  }

  async wait(id, timeoutMs = 50_000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 50_000) throw new Error('timeoutMs must be 0..50000');
    const entry = this.live.get(id);
    if (entry?.busy && timeoutMs) {
      // Event-driven bounded wait: return as soon as a fresh native event for
      // this task arrives, not only at completion or the full timeout (the
      // P0-B degraded push path — durable events, not provider token frames).
      const since = entry.record.progress.eventCount;
      let timer;
      let onEvent;
      try {
        await Promise.race([
          entry.done,
          new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); }),
          new Promise(resolve => {
            onEvent = () => { if (entry.record.progress.eventCount > since) resolve(); };
            (entry.eventWaiters ??= new Set()).add(onEvent);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        entry.eventWaiters?.delete(onEvent);
      }
    }
    return this.status(id);
  }

  async stop(id) {
    return this.admit(async () => {
      const entry = this.live.get(id);
      if (!entry) return this.status(id);
      if (!ACTIVE.has(entry.record.status)) {
        await entry.done;
        return this.status(id);
      }
      entry.cancel = true;
      entry.interrupt?.();
      entry.record.status = 'stopping';
      // SDK has no mid-turn cancel method. Closing this task's runtime does not affect other tasks.
      await entry.runtime?.close();
      await entry.done;
      await this.release(id);
      return this.status(id);
    });
  }

  async release(id) {
    const entry = this.live.get(id);
    if (!entry || entry.busy) return;
    clearTimeout(entry.timer);
    if (entry.runtime) {
      await entry.runtime.close();
      // The SDK's shutdown flush touches the native log after the turn ends.
      entry.record.lastSelfWriteAt = Date.now();
      await this.save(entry.record).catch(() => {});
    }
    if (entry.record.webUrlFile) await rm(entry.record.webUrlFile, { force: true }).catch(() => {});
    // The runtime generation is dead: its in-process token died with it. The
    // next followup re-arms collection (generation guard); until then the
    // summary must not present the stale URL as a live view.
    if (entry.record.webEmbed) {
      entry.record.nativeUrl = null;
      entry.record.updatedAt = new Date().toISOString();
      await this.save(entry.record).catch(() => {});
    }
    await entry.release();
    this.live.delete(id);
  }

  async list() {
    const names = (await readdir(this.tasks)).filter(name => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
    const items = await Promise.all(names.map(name => this.status(name.slice(0, -5))));
    return { ...(await this.config()), maxParallel: this.maxParallel, nativeReplay: await this.nativeReplay(), items };
  }

  // The native web UI adapter state (scripts/native-replay.mjs writes it).
  // Returns { url, running } or null when the official UI is not up.
  async nativeReplay() {
    const state = await readFile(join(this.root, 'native-replay.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!state?.url || !Number.isInteger(state.pid)) return null;
    let running = false;
    try { process.kill(state.pid, 0); running = true; }
    catch (error) { running = error.code !== 'ESRCH'; }
    return running ? { url: state.url, port: state.port } : { url: state.url, port: state.port, running: false };
  }

  // Boot the official web UI adapter if it is not already running. The
  // observer card embeds its URL; failures degrade to the fallback panel.
  // Callers that must stay side-effect free (tests) check the env guard first.
  async ensureNativeReplay() {
    if (process.env.DSH_NATIVE_REPLAY === 'off') return null;
    const current = await this.nativeReplay();
    if (current?.running !== false && current) return current;
    const script = fileURLToPath(new URL('../scripts/native-replay.mjs', import.meta.url));
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    const statePath = join(this.root, 'native-replay.json');
    for (let count = 0; count < 40; count++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const state = await readFile(statePath, 'utf8').then(JSON.parse).catch(() => null);
      if (state?.pid !== child.pid && state?.url) return this.nativeReplay();
      if (state?.pid === child.pid && state?.url) return this.nativeReplay();
    }
    throw new Error('native-replay did not report a URL within 12 seconds');
  }

  async close() {
    this.closing = true;
    await this.admission;
    await Promise.all([...this.live.keys()].map(async id => {
      const entry = this.live.get(id);
      if (entry.busy) await this.stop(id);
      await this.release(id);
    }));
  }
}
