// HOW LONG A "LIMIT REACHED" BANNER COUNTS (card d3f92923, didi's finding 2026-09-28 19:22).
//
// detectsUsageLimitReached reads TEXT, with no time in it, and the banner outlives the limit: after
// the reset an idle pane still shows "resets 5:50pm" in its bottom lines until something new is
// drawn. A verdict built on the text alone therefore never expires -- and the owner the act-sites
// defer to (model-fallback) is off on this install, while the router ignores the limit, so only an
// incoming message would ever free the agent. A limit hit at 23:00 with a card waiting would sit
// until the first letter instead of the next wake.
//
// So the verdict holds from the moment the banner is FIRST SEEN until the reset the banner itself
// names (the next occurrence of that clock time, local time -- the time Claude Code renders), and
// NEVER longer than USAGE_LIMIT_MAX_HOLD_MS. Past that it releases, which is exactly the behaviour
// before card d3f92923: the failure direction is the old state, not a new one.
//
// The first-seen clock lives in this process. A dashboard restart restarts it, which can only
// extend one hold by at most the cap -- stated, not hidden.
import { detectsUsageLimitReached } from './pane-state.js'

/** The 5-hour window is the longest limit that names only a clock time. A weekly banner that names
 *  a day ("resets Oct 3") does not parse and gets the cap too: after it, the old behaviour. */
export const USAGE_LIMIT_MAX_HOLD_MS = 5 * 60 * 60_000
/** A reset is not instantaneous everywhere; one tick of slack before releasing. */
const RESET_SLACK_MS = 2 * 60_000

// "resets 5:50pm" / "resets 3pm" / "resets at 2am" / "limit will reset at 18:00"
const RESET_CLOCK_RX = /\bresets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i

/**
 * When the limit shown on `pane` lets go, given that the banner was first seen at `firstSeenMs`.
 * The next local occurrence of the named clock time at or after firstSeen, plus slack -- capped at
 * firstSeen + USAGE_LIMIT_MAX_HOLD_MS. No parseable time: the cap.
 */
export function usageLimitReleaseAt(pane: string, firstSeenMs: number): number {
  const cap = firstSeenMs + USAGE_LIMIT_MAX_HOLD_MS
  const m = RESET_CLOCK_RX.exec(pane.split('\n').slice(-15).join('\n'))
  if (!m) return cap
  let hour = Number(m[1])
  const minute = m[2] !== undefined ? Number(m[2]) : 0
  const ampm = m[3]?.toLowerCase()
  if (ampm === 'pm' && hour < 12) hour += 12
  if (ampm === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return cap
  const at = new Date(firstSeenMs)
  at.setHours(hour, minute, 0, 0)
  if (at.getTime() < firstSeenMs) at.setDate(at.getDate() + 1)
  return Math.min(at.getTime() + RESET_SLACK_MS, cap)
}

const firstSeen = new Map<string, number>()

/**
 * Does a reached usage limit hold for `key` right now? Remembers when the banner was first seen,
 * forgets it the moment the pane no longer shows one (so a NEW limit starts a new window).
 * Each consumer passes its own key, so two watchers with different cadences cannot move each
 * other's clock.
 */
export function usageLimitHolds(key: string, pane: string, nowMs: number): boolean {
  if (!detectsUsageLimitReached(pane)) {
    firstSeen.delete(key)
    return false
  }
  let since = firstSeen.get(key)
  if (since === undefined) {
    since = nowMs
    firstSeen.set(key, since)
  }
  return nowMs < usageLimitReleaseAt(pane, since)
}

/** Test seam: forget every first-seen clock. */
export function resetUsageLimitWindows(): void {
  firstSeen.clear()
}
