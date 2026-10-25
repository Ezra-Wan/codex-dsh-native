// Opt-in local acceptance diagnostics, never transcript extraction. These are
// DOM/layout facts, not a substitute for the user's visual acceptance.
export function sampleNativeRendering(root, { mode, doc = document, now = Date.now, styleOf = getComputedStyle }) {
  const box = root.getBoundingClientRect();
  const visible = !doc.hidden && box.width > 0 && box.height > 0
    && styleOf(root).visibility !== 'hidden' && styleOf(root).display !== 'none';
  const rows = visible ? [...root.querySelectorAll('[data-chat-flow-kind="assistant-step"]')]
    .filter(row => {
      const rect = row.getBoundingClientRect(), style = styleOf(row);
      return rect.width > 0 && rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom
        && rect.right > box.left && rect.left < box.right && style.visibility !== 'hidden' && style.display !== 'none';
    }) : [];
  const frame = root.querySelector(':has(> [data-rightbar-col])');
  return {
    at: now(), mode, visible, rootHeight: Math.round(box.height),
    grid: frame ? styleOf(frame).gridTemplateColumns : null,
    assistantRows: rows.slice(-3).map(row => ({ key: String(row.dataset.chatNodeKey).slice(0,100),
      chars: row.innerText.length, streaming: !!row.querySelector('[data-streaming="true"]') })),
    fixtureB: visible && root.innerText.includes('【隔离验收 B】'),
  };
}

export function observeNativeRendering(root, { mode, signal }) {
  let pending, disposed = false, previous;
  const sample = () => {
    pending = undefined;
    if (disposed) return;
    const value = sampleNativeRendering(root, { mode: mode.getSnapshot() });
    const signature = JSON.stringify({ ...value, at: undefined });
    if (signature !== previous) { previous = signature; void signal('native-render-sample', JSON.stringify(value)); }
  };
  const schedule = () => { if (!disposed && !pending) pending = setTimeout(sample, 250); };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['style','hidden','data-streaming'] });
  const resize = new ResizeObserver(schedule); resize.observe(root);
  const off = mode.subscribe(schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return () => { disposed = true; clearTimeout(pending); observer.disconnect(); resize.disconnect(); off(); document.removeEventListener('visibilitychange', schedule); };
}
