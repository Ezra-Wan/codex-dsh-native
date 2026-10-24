// Adapted from DSH-for-Vscode's MIT workspace-sync client (published 0.2.0).
// Exact source, license and publication hash are retained under vendor/.
// Our contract selects an existing exact identity; it never creates a session.
export function registerSessionTarget({ loader, boot, readTarget, onNavigate = () => {} }) {
  const id = 'integration:codex-session-target';
  loader.load({ id, factory: () => ({
    inject: ['workspaces', 'sessions', 'uiWorkspace'],
    apply(ctx) {
      let disposed = false, scheduled = false, selected;
      const schedule = () => {
        if (disposed || scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (disposed) return;
          const target = readTarget();
          if (!target || JSON.stringify(target) === selected) return;
          if (ctx.sessions.list.getSnapshot().phase !== 'ready' || ctx.workspaces.list.getSnapshot().phase !== 'ready') return;
          // openSession retains the exact native SessionTarget, including its
          // direct-parent subagent address, and performs native UI navigation.
          ctx.uiWorkspace.openSession(target);
          selected = JSON.stringify(target);
          onNavigate(target);
        });
      };
      const unsubscribe = ctx.sessions.list.subscribe(schedule);
      const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(schedule);
      const off = readTarget.subscribe?.(schedule);
      schedule();
      return () => { disposed = true; unsubscribe(); unsubscribeWorkspaces(); off?.(); };
    },
  }) });
  boot.entries.push({ id, url: '/codex-session-target.js', rev: '1', immediately: true,
    inject: ['@deepseek-ai/dsh-client-ui-workspace'] });
  boot.batches ??= [];
  boot.batches.push({ phase: 'application', url: '/codex-session-target.js', rev: '1', entries: [id] });
  return id;
}
