// Fixed inline sizes, host-owned fullscreen geometry. No ResizeObserver or
// viewport-sized inline reporting: only user/state transitions send a size.
export function createNativeTaskLayout({ app, doc, root, persist = async () => {}, changed = () => {} }) {
  let mode = 'inline', collapsed = false, key, revision = -1, saving = 0, lastSize, repaired = false;
  const apply = (force = false) => {
    const full = mode === 'fullscreen', height = collapsed ? 36 : 600;
    doc.documentElement.style.height = full ? '100%' : `${height}px`;
    doc.body.style.height = full ? '100%' : `${height}px`;
    root.style.display = full || !collapsed ? 'block' : 'none';
    const sizeKey = `${mode}:${height}`;
    if (!full && (force || lastSize !== sizeKey)) void app.sendSizeChanged({ height }).catch(() => {});
    lastSize = sizeKey;
    changed({ mode, collapsed });
  };
  const setCollapsed = async (value, save = true) => {
    if (collapsed !== value) repaired = false;
    collapsed = value; apply();
    if (save && key) {
      const task = key; saving++;
      try { const state = await persist(task, value); if (key === task && state) revision = Math.max(revision, state.revision); }
      finally { saving--; }
    }
  };
  return {
    get mode() { return mode; }, get collapsed() { return collapsed; },
    async context(context = {}) {
      const next = context.displayMode ?? mode;
      if (next === mode) {
        apply();
        const actual = context.containerDimensions?.height;
        // Some hosts reset inline height when the parent answer finishes.
        // Repair once per explicit unfold/mount, never chase every resize.
        if (mode === 'inline' && !collapsed && Number.isFinite(actual) && actual < 360 && !repaired) {
          repaired = true; apply(true);
        }
        return;
      }
      const previous = mode; mode = next;
      if (next === 'fullscreen' || previous === 'fullscreen') await setCollapsed(true);
      else apply();
    },
    task(id, state) {
      if (id !== key) { key = id; revision = -1; collapsed = false; }
      this.restore(state);
      if (mode === 'fullscreen') void setCollapsed(true).catch(() => {});
      else apply();
    },
    restore(state) {
      if (!state || saving || state.revision < revision) return;
      revision = state.revision;
      collapsed = mode === 'fullscreen' ? true : state.collapsed;
      apply();
    },
    setCollapsed,
    mounted() { repaired = false; apply(true); },
  };
}
