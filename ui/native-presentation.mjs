// Presentation only. Native services, stores, session scopes and plugin tools
// stay mounted; fullscreen restores original drawers without a new app.
// DSH 0.2.1-rc.2 has no public "remove columns" action. Its stable frame data
// attributes identify the original three-column frame; no hashed class names
// or copied conversation DOM are involved.
import { nativeCreationPolicyCss } from './native-creation-policy.mjs';
export const INLINE_NATIVE_CSS = `
html[data-codex-native-mode="inline"] #root :has(> [data-rightbar-col]) {
  grid-template-columns: 0px minmax(0px, 1fr) 0px !important;
  transition: none !important;
}
/* display:none removes the left column from grid auto-placement. Keep the
   ORIGINAL center (the rightbar's preceding sibling) in the 1fr track. */
html[data-codex-native-mode="inline"] #root :has(> [data-rightbar-col]) > :has(+ [data-rightbar-col]) {
  grid-column: 2 !important;
  grid-row: 1 !important;
}
html[data-codex-native-mode="inline"] #root :has(> [data-rightbar-col]) > :first-child,
html[data-codex-native-mode="inline"] #root [data-rightbar-col],
html[data-codex-native-mode="inline"] #root :has(> [data-rightbar-col]) > [data-side],
html[data-codex-native-mode="inline"] #root [data-shell-leading] {
  display: none !important;
}
`;

export function createNativeDisplayMode() {
  let mode = 'inline';
  const listeners = new Set();
  return {
    getSnapshot: () => mode,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next) {
      next = next === 'fullscreen' ? 'fullscreen' : 'inline';
      if (mode === next) return;
      mode = next;
      for (const fn of listeners) fn();
    },
  };
}

export function registerNativePresentation({ loader, boot, mode, doc = document }) {
  const id = 'integration:codex-native-presentation';
  loader.load({ id, factory: () => ({
    inject: ['slots', 'locale'],
    apply(ctx) {
      const style = doc.createElement('style');
      const updateStyle = () => { style.textContent = INLINE_NATIVE_CSS + nativeCreationPolicyCss(ctx.locale); };
      updateStyle();
      doc.head.appendChild(style);
      const offLocale = ctx.locale.subscribe(updateStyle);
      // Bridge-owned task views do not offer a second free-text prompter.
      // Hide only the resident composer BAR through its native slot. Keep
      // the separate composer chain intact (native questions/approvals and
      // true subagent read-only replacements own that interaction surface).
      // This is UI policy, not an RPC authorization or takeover state machine.
      const disposeComposerPolicy = ctx.slots.inject('conversation.composer.bar',
        () => ctx.slots.register({ name: 'conversation.composer.bar', priority: -1000 }, () => null));
      let unshadow;
      const sync = () => {
        const inline = mode.getSnapshot() !== 'fullscreen';
        doc.documentElement.dataset.codexNativeMode = inline ? 'inline' : 'fullscreen';
        // The official corner slot is specifically the native right-drawer
        // toggle. Shadow it through the public priority contract; preserve
        // the original registration and its shared session-store adoption.
        if (inline && !unshadow) unshadow = ctx.slots.inject('conversation.session.header.corner',
          () => ctx.slots.register({ name: 'conversation.session.header.corner', priority: -1000 }, () => null));
        if (!inline && unshadow) { unshadow(); unshadow = undefined; }
      };
      const off = mode.subscribe(sync);
      sync();
      return () => { off(); offLocale(); unshadow?.(); disposeComposerPolicy(); style.remove(); delete doc.documentElement.dataset.codexNativeMode; };
    },
  }) });
  boot.entries.push({ id, url: '/codex-native-presentation.js', rev: '1', immediately: true,
    inject: ['@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-client-locale'] });
  boot.batches ??= [];
  boot.batches.push({ phase: 'application', url: '/codex-native-presentation.js', rev: '1', entries: [id] });
}
