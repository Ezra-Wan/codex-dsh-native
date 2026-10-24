// Inline content must not size itself from the very iframe being resized.
// A 100vh body plus automatic size reporting forms a host/guest feedback loop.
export const INLINE_HEIGHT = 560;
export const APP_OPTIONS = Object.freeze({ autoResize: false });

export function configureCardLayout({ app, doc }) {
  if (!doc.body) return;
  let mode;
  const apply = context => {
    const next = context?.displayMode ?? mode ?? 'inline';
    if (next === mode) return;
    mode = next;
    doc.body.style.height = mode === 'inline' ? `${INLINE_HEIGHT}px` : '100vh';
    if (mode === 'inline') {
      // Report once on entry, never on every ResizeObserver/host resize.
      void app.sendSizeChanged({ height: INLINE_HEIGHT }).catch(() => {});
    }
  };
  app.onhostcontextchanged = apply;
  apply(app.getHostContext());
}
