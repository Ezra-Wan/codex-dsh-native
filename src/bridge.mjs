import { mkdir, readFile, writeFile, rename, stat, readdir, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRuntime } from './runtime.mjs';
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
  constructor({ root, runtimeFactory = createRuntime, idleMs = 120_000, maxParallel = 2, patches = [] }) {
    this.root = resolve(root);
    this.home = join(this.root, 'dsh-home');
    this.tasks = join(this.root, 'tasks');
    this.runtimeFactory = runtimeFactory;
    this.idleMs = idleMs;
    this.maxParallel = maxParallel;
    this.patches = patches;
    this.live = new Map();
    this.admission = Promise.resolve();
    this.closing = false;
  }

  async init() {
    await mkdir(this.tasks, { recursive: true });
    await mkdir(this.home, { recursive: true });
    return this;
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

  async start({ task, cwd, mode = 'light', name = '', model = 'deepseek-v4-flash', provider = 'deepseek-official', maxTokens, effort, permission = 'workspace-write' }) {
    return this.admit(async () => {
      if (!isAbsolute(cwd) || !(await stat(cwd)).isDirectory()) throw new Error('cwd must be an existing absolute directory');
      if (!MODES[mode]) throw new Error('mode must be light or coding');
      if (!['read-only', 'workspace-write'].includes(permission)) throw new Error('P0 supports read-only or workspace-write');
      const cap = maxTokens ?? MODES[mode].maxTokens;
      if (!Number.isInteger(cap) || cap < 1024 || cap > 32768) throw new Error('maxTokens must be 1024..32768');
      const id = randomUUID();
      const record = {
        agent_id: id, session_id: id, name, cwd: resolve(cwd), mode, model, provider,
        maxTokens: cap, effort, permission, returnChars: MODES[mode].returnChars,
        status: 'new', turn: 0, createdAt: new Date().toISOString(), persisted: false,
      };
      return this.launch(record, task);
    });
  }

  async followup(id, task) {
    return this.admit(async () => {
      const current = this.live.get(id);
      if (current?.busy) throw new Error('Agent is busy. Wait or stop before followup.');
      const record = current?.record ?? await this.read(id);
      return this.launch(record, task);
    });
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
        entry.runtime = this.runtimeFactory(record, { home: this.home, patches: this.patches });
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
      const result = await entry.runtime.run(task, {
        sessionId: record.session_id,
        onNotification: notification => {
          if (notification.method !== 'session.event' || notification.params.sessionId !== record.session_id) return;
          const event = notification.params.event;
          record.progress.eventCount++;
          record.progress.lastEvent = event.type;
          record.progress.lastActivityAt = new Date().toISOString();
          const action = visibleEvent(event);
          if (action) {
            record.recentActions.push(action);
            if (record.recentActions.length > 12) record.recentActions.shift();
          }
          if (event.type === 'tool/result' && event.data.message.isError) {
            record.warnings.push({ seq: event.seq, callId: event.data.message.toolCallId, message: errorText(action?.text) });
          }
        },
      });
      record.final = result.finalResponse;
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
    return { agent_id, session_id, name, mode, model, maxTokens, permission, cwd, turn, status, progress, error,
      warnings: record.warnings ?? [],
      recentActions: (record.recentActions ?? []).slice(-6).map(action => ({ ...action, text: action.text?.slice(0, 600), truncated: action.truncated || action.text?.length > 600 })),
      ...(final || resultPath ? { final, resultPath, resultTruncated: final.length < (record.final ?? '').length, finishReason, usage } : {}) };
  }

  async events(id, afterSeq = -1, limit = 30) {
    const record = this.live.get(id)?.record ?? await this.read(id);
    if (!record.persisted) return { session_id: record.session_id, source: 'native-dsh-session-log', events: [], cursor: afterSeq, hasMore: false };
    return readNativeEvents(this.home, record.session_id, afterSeq, limit);
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
      let timer;
      try { await Promise.race([entry.done, new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })]); }
      finally { clearTimeout(timer); }
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
    if (entry.runtime) await entry.runtime.close();
    await entry.release();
    this.live.delete(id);
  }

  async list() {
    const names = (await readdir(this.tasks)).filter(name => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
    const items = await Promise.all(names.map(name => this.status(name.slice(0, -5))));
    return { ...(await this.config()), maxParallel: this.maxParallel, items };
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
