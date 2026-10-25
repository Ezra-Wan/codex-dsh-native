// Observer card: a CONTAINER adapter for the official DSH web UI.
//
// Per the 2026-10-24 acceptance reviews, the main display path carries the
// official implementation, not a re-implementation. This card embeds the
// official web UI (native-replay adapter URL) and falls back to a minimal
// task-status list. All loop discipline (pacing, backoff, stale-response
// dropping, terminal slow watch) lives in observer-core.mjs, which is
// controller-tested; createCard below is the DOM/app wiring, covered by
// test/observer-wiring.test.mjs with a fake app host and minimal DOM.
import { App } from '@modelcontextprotocol/ext-apps';
import { createObserverCore, TERMINAL } from './observer-core.mjs';
import { APP_OPTIONS, configureCardLayout } from './layout.mjs';

const LABELS = { starting: '启动中', running: '运行中', stopping: '停止中', completed: '已完成', completed_with_warnings: '完成·有异常', failed: '失败', interrupted: '已中断' };

export function createCard({ app, doc = globalThis.document }) {
  const $ = id => doc.getElementById(id);
  const parse = result => {
    if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '请求失败');
    return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
  };
  const call = async (name, args = {}) => parse(await app.callServerTool({ name, arguments: args }));

  let selected = null;
  let tasks = [];

  function applyStatus(status) {
    // The wait result is the async delivery path for a task's nativeUrl.
    // Protocol: webEmbed tasks always carry nativeUrl (string = live, null =
    // revoked/not-yet-collected). null must CLEAR the cache too — a cached
    // dead URL would remount on the next A/B round-trip.
    if (status?.agent_id && status.nativeUrl !== undefined) {
      const cached = tasks.find(task => task.agent_id === status.agent_id);
      if (cached) cached.nativeUrl = status.nativeUrl;
      if (status.agent_id === selected) {
        if (status.nativeUrl) applyTaskBinding();
        else withdrawBinding();
      }
    }
    const bits = [LABELS[status.status] ?? status.status];
    if (status.children?.length) bits.push(`${status.children.length} 个子会话`);
    if (status.userTakeover) bits.push('用户接管中');
    $('state').textContent = bits.join(' · ');
    // Latest durable assistant message, hover hint only — NOT the native
    // streaming view; the embedded official UI owns that.
    const lastText = [...(status.recentActions ?? [])].reverse().find(action => action.type === 'assistant/message' && action.text);
    if (lastText) $('state').title = lastText.text.slice(0, 120);
  }

  const core = createObserverCore({
    wait: async id => call('ds_wait', { agent_id: id, timeoutMs: 2000 }),
    apply: applyStatus,
    visible: () => !doc.hidden,
  });

  // The selected task's own executing-process UI (S2 binding): each web-embed
  // task serves the official UI from ITS OWN process, so switching tasks is
  // switching URLs — click A shows A, switch B shows B, no shared state to
  // cross. Legacy summaries without URL state can still use global replay.
  function applyTaskBinding() {
    if (!selected) return false;
    const status = tasks.find(task => task.agent_id === selected);
    if(status?.backend==='worker'){
      withdrawBinding();
      const heading=$('fallback').querySelector('.hint');
      if(heading)heading.textContent='旧 worker 兜底：此载体仅显示状态，结果由 ds_wait 收取；不提供原生正文流。';
      return true;
    }
    const url = status?.nativeUrl ?? null;
    if (url) {
      mountOfficial(url);
      return true;
    }
    withdrawBinding();
    return false;
  }

  // The selected task has no live URL (pending first collection, or its
  // runtime was released): the previous task's page must NOT stay on screen
  // under the new selection — withdraw to an explicit waiting state.
  function withdrawBinding() {
    const frame = $('frame');
    frame.style.display = 'none';
    delete frame.dataset.mounted;
    $('open').removeAttribute('href');
    $('fallback').style.display = 'block';
    const heading = $('fallback').querySelector('.hint');
    if (heading) heading.textContent = '该任务的官方界面尚未就绪（执行进程启动后自动接入；已释放的任务在续接后重新接入）。';
  }

  function renderFallback(message) {
    $('frame').style.display = 'none';
    $('fallback').style.display = 'block';
    if (message) { $('notice').style.display = 'block'; $('notice').textContent = message; }
    const rows = $('rows');
    rows.replaceChildren();
    const heading = $('fallback').querySelector('.hint');
    if (heading) heading.textContent = message ? '暂显示任务状态：' : '官方界面未运行（npm run native-replay），暂显示任务状态：';
    for (const task of tasks) {
      const row = doc.createElement('div');
      row.className = 'row';
      const name = doc.createElement('span');
      name.className = 'name';
      name.textContent = `${task.name || task.agent_id.slice(0, 8)} · ${task.role ?? 'peer'}`;
      const state = doc.createElement('span');
      state.className = 'state';
      state.textContent = LABELS[task.status] ?? task.status;
      row.append(name, state);
      rows.append(row);
    }
    if (!tasks.length) rows.replaceChildren(Object.assign(doc.createElement('p'), { className: 'hint', textContent: '暂无桥接任务。' }));
  }

  function mountOfficial(url) {
    const frameDomains = app.getHostCapabilities?.()?.sandbox?.csp?.frameDomains;
    if (Array.isArray(frameDomains) && frameDomains.length === 0) {
      // Use the host's effective grant, not merely our requested metadata.
      // This Codex build strips HTTP frame origins before initializing us.
      delete $('frame').dataset.mounted;
      renderFallback('当前应用未允许内嵌此 DSH 页面。可点「新窗口打开」查看；卡片内正文暂不可用。');
      $('open').href = url;
      return;
    }
    // Restore the embed explicitly: a later fallback must never leave the
    // frame hidden once a valid URL arrives, in either arrival order.
    $('fallback').style.display = 'none';
    $('frame').style.display = 'block';
    $('notice').style.display = 'none';
    const frame = $('frame');
    if (frame.dataset.mounted === url) return;
    frame.dataset.mounted = url;
    let loaded = false;
    frame.addEventListener('load', () => { loaded = true; }, { once: true });
    frame.src = url;
    $('open').href = url;
    setTimeout(() => {
      if (!loaded) {
        $('notice').style.display = 'block';
        $('notice').textContent = '官方界面嵌入超时（宿主可能限制 iframe）。可用右上角「新窗口打开」。';
      }
    }, 5000);
  }

  // Both result shapes must create the selected option before assigning value.
  function syncOptions() {
    $('tasks').replaceChildren(...tasks.map(item => {
      const option = doc.createElement('option');
      option.value = item.agent_id;
      option.textContent = item.name || item.agent_id.slice(0, 8);
      return option;
    }));
    $('tasks').value = selected;
  }

  function receive(data) {
    const items = data.items ?? (data.agent_id ? [data] : []);
    const soloDispatch = !Array.isArray(data.items) && data.agent_id ? data : null;
    if (soloDispatch) {
      // A dispatch/followup result for ONE task carries this card's ownership:
      // it selects that task (the global list never overrides it afterwards).
      if (selected !== soloDispatch.agent_id) {
        selected = soloDispatch.agent_id;
        core.switchTask();
        $('state').textContent = '';
        $('state').removeAttribute('title');
      }
      const cached = tasks.find(task => task.agent_id === soloDispatch.agent_id);
      if (cached) {
        if (soloDispatch.nativeUrl !== undefined) cached.nativeUrl = soloDispatch.nativeUrl;
      } else tasks.push(soloDispatch);
      syncOptions();
      core.observeStatus(soloDispatch);
      applyTaskBinding();
      return;
    }
    if (items.length) {
      tasks = items;
      const fresh = selected ?? items.at(-1).agent_id;
      const switched = fresh !== selected;
      selected = fresh;
      if (switched) {
        core.switchTask();
        $('state').textContent = '';
        $('state').removeAttribute('title');
      }
      syncOptions();
      // A followup/tool result may have revived the task: resume hot watching,
      // or mark it terminal so the paced loop parks in slow watch.
      const status = items.find(item => item.agent_id === selected);
      if (status) core.observeStatus(status);
      // Prefer this task's own executing-process UI; the nativeReplay field
      // below only decides when the task carries no per-task URL.
      if (applyTaskBinding()) return;
      // Explicit null belongs to a task-scoped view that is pending/revoked.
      // The global replay can contain other sessions; it is not this task.
      if (status && Object.hasOwn(status, 'nativeUrl')) return;
    }
    // Shared replay is a fallback for legacy summaries only. A bare result
    // without nativeReplay must not change an already mounted view.
    if ('nativeReplay' in data) {
      const replay = data.nativeReplay;
      if (replay && replay.running !== false) mountOfficial(replay.url);
      else renderFallback(replay ? '官方界面进程已退出，可重启：npm run native-replay' : null);
    }
  }

  $('tasks').addEventListener('change', () => {
    // Switching tasks: invalidate in-flight responses for the old task and
    // clear its status text; the core drops stale results by sequence.
    selected = $('tasks').value;
    core.switchTask();
    $('state').textContent = '';
    $('state').removeAttribute('title');
    // Bind the embed to the newly selected task's own executing-process UI
    // (per-task URL — the receiving side is this task's official web stack).
    applyTaskBinding();
  });

  async function start() {
    try {
      await app.connect();
      configureCardLayout({ app, doc });
      const initial = await app.callServerTool({ name: 'ds_bridge', arguments: {} });
      receive(parse(initial));
      // Single paced loop with controller-tested discipline (observer-core).
      void core.run(() => selected);
    } catch (error) {
      renderFallback(`宿主界面尚未连通：${error?.message ?? error}`);
    }
  }

  return { core, receive, start, fail: renderFallback };
}

// Browser auto-boot only: tests import createCard with an injected doc/app.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const app = new App({ name: 'DSH observer container', version: '0.2.1' }, { availableDisplayModes: ['inline', 'fullscreen'] }, APP_OPTIONS);
  const card = createCard({ app });
  app.ontoolresult = result => {
    try {
      if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text ?? '请求失败');
      card.receive(result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text));
    } catch {
      card.fail('读取任务状态失败');
    }
  };
  void card.start();
}
