// Who is mid-restart right now -- and therefore must not be "helpfully" started by
// somebody else. Card f65bc6ef.
//
// WHAT HAPPENED (measured live, 2026-08-29 03:07, computress):
//   03:07:17.797  context-guard: acting -- "pane saturated (100% context) for 2 sweeps"
//   03:07:18.243  WARN "Desired agent not running -- auto-starting (reconcile)"
//   03:07:18.375  Agent tmux session started        <- by the RECONCILER, not the guard
// `restartAgentProcess` stops first and starts second. In the half-second between, the
// channel-monitor reconciler saw a DESIRED agent that was not running and started it with
// `startAgentProcess(name)` -- no options. `opts.fresh` was undefined, so for a
// channel-less agent with a prior session the launcher added `--continue`, and the agent
// came back up carrying the very conversation whose saturation caused the restart. The
// guard's `{ fresh: true }` was correct and never reached the launcher, because the
// launcher it reached was a different one. computress then sat wedged for ten minutes.
//
// The existing 90-second grace does not cover it: `agentLastRestart` is written ONLY by
// the channel-monitor, so a restart from the guard, the model-fallback runner or the API
// leaves no trace the reconciler can see.
//
// A TIMESTAMP, NOT A FLAG, and the reason is the failure direction. A bare "in flight"
// set that leaks -- a crash between mark and clear -- would make the reconciler refuse to
// start that agent FOREVER, turning a half-second race into a permanent outage. With an
// expiry the worst case is that the reconciler waits out the bound and then behaves
// exactly as it does today.
const inFlight = new Map<string, number>()

/** How long a restart may be considered in progress. Generous next to a restart (stop +
 *  start is seconds), short next to an outage. CHOSEN, not measured: it is a leak bound,
 *  not a timing figure -- nothing here should ever run for two minutes. */
export const RESTART_INFLIGHT_MAX_MS = 2 * 60_000

export function markRestartStarted(name: string, now: number = Date.now()): void {
  inFlight.set(name, now)
}

export function clearRestart(name: string): void {
  inFlight.delete(name)
}

/** Is a restart of this agent in progress right now? Expired entries answer NO -- see the
 *  header on why the leak must heal itself rather than latch. */
export function isRestartInFlight(name: string, now: number = Date.now()): boolean {
  const at = inFlight.get(name)
  if (at === undefined) return false
  if (now - at >= RESTART_INFLIGHT_MAX_MS) {
    inFlight.delete(name)
    return false
  }
  return true
}

/** Test seam: one case's state must not leak into the next. */
export function resetRestartInFlight(): void {
  inFlight.clear()
}
