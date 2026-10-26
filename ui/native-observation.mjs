import { BoundConversation } from '../vendor/deepseek-bound-conversation/binding.mjs';

// A presentation source over the SAME native log. Side mode is unfiltered.
// The original assembler, view definitions and all row renderers remain native.
export function createObservationFeed(source, context) {
  const listeners = new Set();
  let snapshot, revision = 0, key, frozenEntries;
  const refresh = () => {
    const { mode, role, observation } = context.getSnapshot();
    const original = source.getSnapshot();
    const full = mode === 'fullscreen';
    const nextKey = `${observation?.call_id}:${observation?.start_seq}:${observation?.end_seq}:${observation?.frozen}`;
    if (key !== nextKey) { key = nextKey; frozenEntries = undefined; }
    let entries, hasMore;
    if (full) { entries = original.entries; hasMore = original.hasMore; }
    else {
      const start = observation?.start_seq, end = observation?.end_seq;
      entries = role === 'sub' && Number.isInteger(start)
        ? original.entries.filter(({ event }) => event.seq >= start && (end == null || event.seq <= end)) : [];
      // Native turn/end freezes the range immediately, before the next status poll.
      const closed = entries.findIndex(({ event }) => event.type === 'turn/end');
      if (closed >= 0) entries = entries.slice(0, closed + 1);
      if (frozenEntries) entries = frozenEntries;
      else if ((closed >= 0 || observation?.frozen) && !entries.some(entry => entry.type === 'transient')
        && entries.some(({ event }) => event.seq === start)) frozenEntries = entries;
      hasMore = false;
    }
    if (snapshot && hasMore === snapshot.hasMore && entries.length === snapshot.entries.length
      && entries.every((entry, i) => entry === snapshot.entries[i])) return;
    // Preserve the native incremental hot path while the filtered tail grows.
    const previous = snapshot?.entries ?? [];
    const append = previous.length > 0 && entries.length > previous.length && previous.every((entry, i) => entry === entries[i]);
    snapshot = { entries, hasMore, revision: revision++, change: append
      ? { kind: 'append', entries: entries.slice(previous.length) }
      : { kind: 'replace', entries } };
    for (const listener of listeners) listener();
  };
  const offSource = source.subscribe(refresh), offContext = context.subscribe(refresh);
  refresh();
  return { getSnapshot: () => snapshot, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { offSource(); offContext(); listeners.clear(); } };
}

export function createObservationContext(mode, task) {
  let current = task;
  const listeners = new Set();
  const notify = () => { for (const fn of listeners) fn(); };
  const off = mode.subscribe(notify);
  return { getSnapshot: () => ({ mode: mode.getSnapshot(), role: current.role, observation: current.observation }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    update(next) { current = next; notify(); }, dispose() { off(); listeners.clear(); } };
}

export function registerNativeObservation({ loader, boot, context, sessionId }) {
  const id = 'integration:codex-observation';
  loader.load({ id, factory: require => {
    const { ConversationNodeAssembler } = require('@deepseek-ai/dsh-client-ui-conversation/client');
    return { inject: ['sessions', 'uiConversation'], apply(ctx) {
      const service = ctx.get('uiConversation'), sessions = ctx.get('sessions');
      const original = service.binding;
      const previousDescriptor = Object.getOwnPropertyDescriptor(service, 'binding');
      const records = new Map();
      const rebuild = () => { for (const record of records.values()) record.binding.rebuild(); };
      const offRegistries = [service.events.subscribe(rebuild), service.views.subscribe(rebuild), service.groups.subscribe(rebuild)];
      const wrapped = function(source) {
        const owner = typeof source === 'string' ? sessions.binding(source) : source;
        if (!owner || owner.sessionId !== sessionId) return original.call(this, source);
        if (sessions.binding(owner.sessionId) !== owner) throw new Error('Observation session is no longer current');
        if (!records.has(owner)) {
          const feed = createObservationFeed(owner.eventSource, context);
          const binding = new BoundConversation(feed, new ConversationNodeAssembler(service.events, service.views, service.groups));
          const record = { feed, binding, loadedStart: null };
          records.set(owner, record);
          const load = () => {
            const start = context.getSnapshot().observation?.start_seq;
            if (!Number.isInteger(start) || record.loadedStart === start) return;
            record.loadedStart = start;
            // Public native history paging, never a prompt or a duplicate session.
            void owner.session.loadThrough(start).catch(() => { record.loadedStart = null; });
          };
          const off = context.subscribe(load); load();
          record.dispose = () => { off(); feed.dispose(); binding.dispose(); records.delete(owner); };
          owner.ctx.effect(() => record.dispose, 'codex-observation');
        }
        return records.get(owner).binding;
      };
      service.binding = wrapped;
      return () => {
        // Cordis rebinds method reads to the requesting context. Compare the
        // stored descriptor, not a rebound function returned by a getter.
        if (Object.getOwnPropertyDescriptor(service, 'binding')?.value === wrapped) {
          if (previousDescriptor) Object.defineProperty(service, 'binding', previousDescriptor);
          else delete service.binding;
        }
        for (const off of offRegistries) off();
        for (const record of [...records.values()]) record.dispose();
        records.clear();
      };
    } };
  } });
  boot.entries.push({ id, url: '/codex-observation.js', rev: '1', immediately: true,
    inject: ['@deepseek-ai/dsh-client-ui-conversation'] });
  boot.batches ??= [];
  boot.batches.push({ phase: 'application', url: '/codex-observation.js', rev: '1', entries: [id] });
}
