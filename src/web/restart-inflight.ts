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
// WHAT THIS COVERS, AND WHAT IT DOES NOT -- narrowed after jarvis's review, because a
// claim of completeness is the one thing the next reader will not re-derive. Marking
// inside restartAgentProcess covers its five callers (context-guard, auto-restart,
// model-fallback, the API restart route, and any future one) by construction. It does NOT
// cover a hand-rolled stop->start pair, and there were three of those:
//     routes/agents.ts     the Google Chat provider switch
//     routes/agents.ts     the generic provider switch
//     channel-monitor.ts   the channel-plugin-down restart (an EIGHT second gap)
// All three are now marked at their own call sites -- but that is a fact about today, not
// a property of the design. A fourth hand-rolled pair would be unprotected again, and the
// only thing standing between it and this defect is that its author reads this paragraph.
//
// A TIMESTAMP, NOT A FLAG, and the reason is the failure direction. A bare "in flight"
// set that leaks -- a crash between mark and clear -- would make the reconciler refuse to
// start that agent FOREVER, turning a half-second race into a permanent outage. With an
// expiry the worst case is that the reconciler waits out the bound and then behaves
// exactly as it does today.
// REFCOUNTED, not a boolean. Two restarts of the same agent can overlap -- the guard and
// an API call, say -- and an unconditional clear would let the FIRST one's finally open
// the window while the SECOND is still stopped. Depth plus the newest timestamp; the entry
// disappears when the last holder clears it. (jarvis raised this in review; the shape is
// his, the choice of refcount over owner tokens is mine -- refcount needs no plumbing at
// the call sites, and the call sites are exactly where this gets forgotten.)
const inFlight = new Map<string, { depth: number; at: number }>()

/** How long a restart may be considered in progress. Generous next to a restart (stop +
 *  start is seconds), short next to an outage. CHOSEN, not measured: it is a leak bound,
 *  not a timing figure -- nothing here should ever run for two minutes. */
export const RESTART_INFLIGHT_MAX_MS = 2 * 60_000

export function markRestartStarted(name: string, now: number = Date.now()): void {
  const cur = inFlight.get(name)
  inFlight.set(name, { depth: (cur?.depth ?? 0) + 1, at: now })
}

export function clearRestart(name: string): void {
  const cur = inFlight.get(name)
  if (!cur) return
  if (cur.depth <= 1) inFlight.delete(name)
  else inFlight.set(name, { depth: cur.depth - 1, at: cur.at })
}

/** Is a restart of this agent in progress right now? Expired entries answer NO -- see the
 *  header on why the leak must heal itself rather than latch. */
export function isRestartInFlight(name: string, now: number = Date.now()): boolean {
  const cur = inFlight.get(name)
  if (cur === undefined) return false
  if (now - cur.at >= RESTART_INFLIGHT_MAX_MS) {
    inFlight.delete(name)
    return false
  }
  return true
}

/** Test seam: one case's state must not leak into the next. */
export function resetRestartInFlight(): void {
  inFlight.clear()
}
