/**
 * Parse ps `etime` ([[dd-]hh:]mm:ss) into seconds. `etimes` is GNU-only (BSD ps on macOS answers
 * "keyword not found"), so every caller asks for `etime`. One copy: context-restart-gate-runner and
 * channel-monitor both read process ages, and the runner cannot be imported from the monitor
 * (context-guard-runner imports the monitor, the runner imports context-guard-runner).
 */
export function parseEtimeSeconds(raw: string): number | null {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(raw.trim())
  if (!m) return null
  const [, d, h, mi, s] = m
  return ((Number(d ?? 0) * 24 + Number(h ?? 0)) * 60 + Number(mi)) * 60 + Number(s)
}
