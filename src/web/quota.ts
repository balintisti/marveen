import { readFileSync } from 'node:fs'

// The subscription quota the whole fleet draws from, as the statusLine command
// last saw it. scripts/statusline-ratelimit.sh writes the block to
// store/.claude-rate-limits.json on every render, costing no tokens; this is
// the read side, so the dashboard shows the same numbers the monitor alerts on.
//
// Reading it has one rule, and it is why this module exists instead of a few
// lines in the route: a quota reading is only worth showing while it is fresh.
// A number from six hours ago looks exactly like a number from six seconds ago
// and reassures just as much, so age travels with the data and the caller is
// made to deal with it. Same for a window whose reset time has passed: the
// block only changes when an API response brings new numbers, so after a
// rollover the old percentage sits there describing a window that no longer
// exists (measured at the 2026-08-18 22:00 rollover, and the reason
// scripts/lib/quota-check.py skips those too).

/** Same default as QUOTA_MAX_AGE_SEC in scripts/limit-monitor.sh. */
export const DEFAULT_MAX_AGE_SEC = 21600

// The Fable/Opus weekly window is not part of the statusLine block above --
// it only shows up there while a session is actively using Fable, which is
// rarely true. scripts/usage-collect.py is the authoritative source instead,
// writing store/usage-latest.json on its own schedule (a heartbeat task,
// every 15 minutes). Its freshness bar has to be much tighter than the
// statusLine's 6h: a missed run here means the collector itself is down, not
// just "no session lately". ~3x the collection interval, the same margin
// usage-collect.py's own alert refire windows use.
export const DEFAULT_FABLE_MAX_AGE_SEC = 2700

export interface QuotaWindow {
  /** Percentage of the window already spent, 0-100. */
  usedPercentage: number
  /** Unix seconds when the window rolls over, null when the payload had none. */
  resetsAt: number | null
  /** The reset time has passed: this reading describes a window that is gone. */
  expired: boolean
}

export interface QuotaSnapshot {
  /** ok: fresh reading. stale: too old to trust. missing: no reading at all. */
  status: 'ok' | 'stale' | 'missing'
  /** Seconds since the statusLine wrote the file, null when there is no file. */
  ageSec: number | null
  maxAgeSec: number
  fiveHour: QuotaWindow | null
  sevenDay: QuotaWindow | null
  /** Why there is nothing to show; only set when status is 'missing'. */
  reason?: 'no-file' | 'unreadable' | 'no-rate-limits'
}

function readWindow(raw: unknown, nowSec: number): QuotaWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as { used_percentage?: unknown; resets_at?: unknown }
  if (typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return null
  const resetsAt = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at) ? w.resets_at : null
  return {
    usedPercentage: w.used_percentage,
    resetsAt,
    expired: resetsAt !== null && resetsAt <= nowSec,
  }
}

/**
 * Read the quota snapshot the statusLine last wrote.
 *
 * Never throws: a missing or corrupt file is an answer ('missing'), not an
 * error, because the dashboard must still render. The caller is expected to
 * say WHY the strip is absent rather than drop it silently.
 */
export function readQuotaSnapshot(
  file: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): QuotaSnapshot {
  const empty = { ageSec: null, maxAgeSec, fiveHour: null, sevenDay: null }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    return { status: 'missing', reason: code === 'ENOENT' ? 'no-file' : 'unreadable', ...empty }
  }
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'missing', reason: 'unreadable', ...empty }
  }

  const d = parsed as { written_at?: unknown; rate_limits?: unknown }
  const fiveHour = readWindow((d.rate_limits as Record<string, unknown>)?.five_hour, nowSec)
  const sevenDay = readWindow((d.rate_limits as Record<string, unknown>)?.seven_day, nowSec)
  if (!fiveHour && !sevenDay) {
    // An API-key account never gets a rate_limits block, and neither does a
    // subscription session before its first API response.
    return { status: 'missing', reason: 'no-rate-limits', ...empty }
  }

  const writtenAt = typeof d.written_at === 'number' && Number.isFinite(d.written_at) ? d.written_at : 0
  const ageSec = Math.max(0, nowSec - writtenAt)
  return {
    status: ageSec > maxAgeSec ? 'stale' : 'ok',
    ageSec,
    maxAgeSec,
    fiveHour,
    sevenDay,
  }
}

/**
 * The Fable/Opus weekly window, read separately because it comes from a
 * different writer (scripts/usage-collect.py -> store/usage-latest.json)
 * with its own shape and its own freshness rule. Missing/stale/unreadable
 * all degrade to 'missing' or 'stale' rather than throwing, same rule as
 * readQuotaSnapshot: the dashboard must still render.
 */
export interface FableSnapshot {
  status: 'ok' | 'stale' | 'missing'
  ageSec: number | null
  window: QuotaWindow | null
}

/** usage-collect.py's window shape: `used_percent`, not the statusLine's `used_percentage`. */
function readOpusWindow(raw: unknown, nowSec: number): QuotaWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as { used_percent?: unknown; resets_at?: unknown }
  if (typeof w.used_percent !== 'number' || !Number.isFinite(w.used_percent)) return null
  const resetsAt = typeof w.resets_at === 'number' && Number.isFinite(w.resets_at) ? w.resets_at : null
  return {
    usedPercentage: w.used_percent,
    resetsAt,
    expired: resetsAt !== null && resetsAt <= nowSec,
  }
}

export function readFableSnapshot(
  file: string,
  nowSec: number = Math.floor(Date.now() / 1000),
  maxAgeSec: number = DEFAULT_FABLE_MAX_AGE_SEC,
): FableSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return { status: 'missing', ageSec: null, window: null }
  }
  if (!parsed || typeof parsed !== 'object') return { status: 'missing', ageSec: null, window: null }

  const d = parsed as { generated_at?: unknown; claude?: unknown }
  const claude = d.claude && typeof d.claude === 'object' ? (d.claude as Record<string, unknown>) : null
  const windows = claude?.windows && typeof claude.windows === 'object' ? (claude.windows as Record<string, unknown>) : null
  // Non-tiered accounts report this window as null forever, same as the
  // collector's own "skip gracefully" handling -- that's a permanent
  // "nothing to show", not a freshness problem, so it stays 'missing'.
  // NOTE: usage-collect.py's field is `used_percent`, not the statusLine's
  // `used_percentage` -- readWindow() above is the wrong shape for this source.
  const window = windows ? readOpusWindow(windows.seven_day_opus, nowSec) : null
  if (!window) return { status: 'missing', ageSec: null, window: null }

  // THE AGE IS THE DATA'S, NOT THE FILE'S (merge 88c366f2, T5; our collector's
  // rule, card 45b71d0b). usage-collect.py sets generated_at to NOW on every
  // run, cache hits included, so on its own it reads fresh while the numbers
  // are hours old (09-14..09-18: 720 cached runs, keychain token dead).
  // claude.authoritative_at is written only on a real authoritative answer and
  // carried unchanged through cache hits. Without that field: a plain
  // 'authoritative' (or upstream-shaped) file's generated_at IS the answer's
  // time; an 'authoritative_cached' one's true age is unknown, so it counts
  // as maximally old -- same as a missing timestamp.
  const answeredAt =
    typeof claude?.authoritative_at === 'string'
      ? claude.authoritative_at
      : claude?.source === 'authoritative_cached'
        ? undefined
        : d.generated_at
  let answeredAtSec = 0
  if (typeof answeredAt === 'string') {
    const ms = Date.parse(answeredAt)
    if (!Number.isNaN(ms)) answeredAtSec = Math.floor(ms / 1000)
  }
  const ageSec = Math.max(0, nowSec - answeredAtSec)
  return { status: ageSec > maxAgeSec ? 'stale' : 'ok', ageSec, window }
}
