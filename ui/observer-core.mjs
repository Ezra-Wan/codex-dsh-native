// Observer loop core, separated from the DOM shell for controller tests.
// Owns: task-switch invalidation (stale responses never apply), terminal
// stop + slow watch, error backoff, and minimum pacing on every path.
export const TERMINAL = new Set(['completed', 'completed_with_warnings', 'failed', 'interrupted']);
const MIN_LOOP_MS = 800;
const MAX_BACKOFF_MS = 10_000;
const IDLE_HIDDEN_MS = 1000;
const IDLE_TERMINAL_MS = 5000;

export function createObserverCore({ wait, apply, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), visible = () => true }) {
  let seq = 0;
  let stopped = false;
  let errorStreak = 0;
  let terminalSeen = false;

  return {
    // Task switch: in-flight responses land with a stale seq and are dropped.
    switchTask() {
      seq++;
      terminalSeen = false;
      errorStreak = 0;
    },
    // A tool result (followup etc.) may revive a terminal task.
    observeStatus(status) {
      if (status && TERMINAL.has(status.status)) terminalSeen = true;
      else if (status) {
        terminalSeen = false;
        errorStreak = 0;
      }
    },
    stop() { stopped = true; },
    async run(getTaskId) {
      while (!stopped) {
        const id = getTaskId();
        if (!id || !visible()) { await sleep(IDLE_HIDDEN_MS); continue; }
        if (terminalSeen) {
          // Slow watch: re-check at a low rate so a followup driven from the
          // native UI (no tool result reaching this card) still surfaces.
          // Without this re-check the loop would sleep forever.
          await sleep(IDLE_TERMINAL_MS);
          if (stopped) break;
          const slowId = getTaskId();
          if (!slowId) continue;
          const slowSeq = seq;
          const slowStartedAt = now();
          try {
            const status = await wait(slowId);
            if (slowSeq !== seq) continue;
            apply(status);
            if (!TERMINAL.has(status.status)) {
              terminalSeen = false;
              errorStreak = 0;
            }
          } catch {
            errorStreak++;
          }
          // Revival re-enters the hot loop; pace it like every other path so
          // the slow check and the first hot request never fire back-to-back.
          const slowSpent = now() - slowStartedAt;
          const slowIdle = Math.max(MIN_LOOP_MS - slowSpent, errorStreak ? Math.min(1000 * 2 ** (errorStreak - 1), MAX_BACKOFF_MS) : 0);
          if (slowIdle > 0) await sleep(slowIdle);
          continue;
        }
        const mySeq = seq;
        const startedAt = now();
        try {
          const status = await wait(id);
          if (mySeq !== seq) continue; // stale: a switch happened meanwhile
          errorStreak = 0;
          apply(status);
          if (TERMINAL.has(status.status)) terminalSeen = true;
        } catch {
          errorStreak++;
        }
        const spent = now() - startedAt;
        const backoff = errorStreak ? Math.min(1000 * 2 ** (errorStreak - 1), MAX_BACKOFF_MS) : 0;
        const idle = Math.max(MIN_LOOP_MS - spent, backoff);
        if (idle > 0) await sleep(idle);
      }
    },
  };
}
