import { contextLimitForModel } from '../context-guard.js'

/**
 * Context fill as a fraction of the session's window, or null when it cannot be
 * stated.
 *
 * WHY THIS EXISTS SEPARATELY FROM `measurePct` (card d5798819). The guard has a
 * percentage of its own in `context-guard-runner.ts`, and it is DORMANT:
 * measured 2026-08-28, `store/context-guard.json` does not exist, every agent
 * sits at the opt-in `enabled: false` default, and both `measurePct` call sites
 * are gated on it. So the denominator's code is correct by inspection but has
 * ZERO live executions -- and code that has never run in production is not
 * "working, just not wired up". Whatever consumes it first is its first test,
 * which is why the raw token count stays beside the percentage below.
 *
 * TWO DELIBERATE DIVERGENCES FROM `measurePct`, both stated rather than hidden:
 *
 * 1. THE MODEL IS THE ACTIVE ONE, NOT THE CONFIGURED ONE. `measurePct` reads a
 *    sub-agent's CONFIGURED model. The tokens being divided came from the
 *    RUNNING session, so the running session's window is the honest
 *    denominator; a configured-sonnet / running-opus agent would otherwise be
 *    divided by 200k while its real window is 1M, and read 400% full. The
 *    configured model remains the fallback for when the active one is unknown.
 *
 * 2. NO HIGHWATER CALIBRATION. `measurePct` widens the limit using a persisted
 *    per-(agent, model) maximum -- and learning it WRITES to disk. This runs on
 *    a GET, and a read that mutates persistent state is the wrong shape for a
 *    listing route; it would also start seeding a store the guard reads.
 *
 * The cost of (2) is a small, KNOWN overshoot: the observation is input +
 * cache_read + cache_creation of the last request, which measured up to 1.066x
 * the nominal window (see the calibration note in context-guard.ts). So a value
 * slightly above 1 is expected at the very top and is NOT clamped. Clamping
 * would hide the one number that betrays a wrong denominator -- the documented
 * incident this whole card guards against had a 21% session reading as 106%,
 * and it force-restarted working agents for days. An absurd number argues with
 * the reader; a plausible wrong one does not.
 */
export function contextPctFor(
  tokens: number | null | undefined,
  activeModel: string | null | undefined,
  configuredModel: string | null | undefined,
  limitOverride: number | null | undefined,
): number | null {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return null
  // An operator-set limit wins, so the API and the guard cannot disagree about
  // an agent someone has deliberately pinned.
  const limit = (typeof limitOverride === 'number' && limitOverride > 0)
    ? limitOverride
    : contextLimitForModel(activeModel ?? configuredModel ?? null)
  if (!Number.isFinite(limit) || limit <= 0) return null
  return tokens / limit
}
