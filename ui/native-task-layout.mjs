// Codex owns expand/collapse/close controls. The app only negotiates its open
// height; it has no second, competing "collapsed" presentation state.
export async function requestNativeViewClose(app, host = globalThis.openai) {
  // Optional documented host extension. Detect it, never assume Codex has
  // the ChatGPT shim. The standard notification remains the fallback.
  if (typeof host?.requestClose === 'function') {
    try { await host.requestClose(); return 'openai'; } catch { /* fall back */ }
  }
  await app.requestTeardown();
  return 'mcp';
}

export function createNativeTaskLayout({ app, doc, changed = () => {}, close = () => requestNativeViewClose(app) }) {
  let mode = 'inline', lastSize, repaired = false, closing = false;
  const apply = (force = false) => {
    const full = mode === 'fullscreen';
    doc.documentElement.style.height = full || closing ? '100%' : '600px';
    doc.body.style.height = full || closing ? '100%' : '600px';
    const sizeKey = `${mode}:${closing}`;
    if (!full && !closing && (force || lastSize !== sizeKey)) void app.sendSizeChanged({ height: 600 }).catch(() => {});
    lastSize = sizeKey;
    changed({ mode });
  };
  return {
    get mode() { return mode; },
    async context(context = {}) {
      const next = context.displayMode ?? mode;
      if (next === mode) {
        apply();
        const actual = context.containerDimensions?.height;
        if (mode === 'inline' && !closing && Number.isFinite(actual) && actual < 360 && !repaired) {
          repaired = true; apply(true);
        }
        return;
      }
      const previous = mode; mode = next;
      closing = previous === 'fullscreen' && next === 'inline';
      apply();
      // A request, not proof of closure. If accepted, the host sends our
      // ordinary teardown callback. Never blank the body or stop the model
      // runtime ourselves while waiting for the host's decision.
      if (closing) await close();
    },
    mounted() { repaired = false; apply(true); },
  };
}
