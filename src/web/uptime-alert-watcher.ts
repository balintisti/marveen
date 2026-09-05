// I/O for the uptime->fleet poller. The DECISIONS live in ../uptime-alert.ts,
// which has zero imports and is unit-tested; this file only fetches, enqueues,
// and reads back.
//
// WHY A POLLER AT ALL, in one line so it is not re-litigated at the call site:
// a webhook would fix the DESTINATION while still riding the notification
// delivery whose failure is the whole card. See ../uptime-alert.ts for the
// measurements.
//
// THE TOKEN NEVER TOUCHES A COMMAND LINE. `gcloud auth print-access-token`
// returns it on stdout, and it goes out in an Authorization header via fetch --
// never as an argv element, where `ps` would show it to every process on the
// machine. That is a live finding from this fleet (card 38bd8366, a backup
// script), not a general precaution.
import { execFileSync } from 'node:child_process'
import { logger } from '../logger.js'
import { MAIN_AGENT_ID } from '../config.js'
import { createAgentMessage, getAgentMessage } from '../db.js'
import {
  decideUptimeAlerts,
  buildUptimeNotice,
  buildUnreadableNotice,
  NO_UPTIME_STATE,
  type UptimeAlertState,
  type UptimeCondition,
  type UptimeSeries,
} from '../uptime-alert.js'

// The policy condition is 600s, so a 2-minute poll adds at most ~2 minutes to a
// signal that already takes ten to form. Polling faster would buy nothing and
// spend API quota on a question whose answer cannot change faster than that.
const INTERVAL_MS = 120_000
const INITIAL_DELAY_MS = 45_000

// FALLBACK ONLY, and it must never be reached silently. If the policy cannot be
// read we still want to look at the data rather than go dark -- but the notice
// says the condition is a guess, because a poller quietly answering yesterday's
// question with a straight face is the stale-artefact shape this repo keeps
// finding.
const FALLBACK_CONDITION: UptimeCondition = { durationSeconds: 600, triggerCount: 1 }

// In-memory: a dashboard restart re-announces an outage that is still open.
// DELIBERATE. The alternative is a new table for state whose only job is to
// suppress one duplicate notice after a restart -- and a duplicate notice about
// a real outage is the cheap direction to be wrong in.
let state: UptimeAlertState = NO_UPTIME_STATE

function accessToken(): string | null {
  try {
    const t = execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

function project(): string | null {
  try {
    const p = execFileSync('gcloud', ['config', 'get-value', 'project'], {
      encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return p.length > 0 && p !== '(unset)' ? p : null
  } catch {
    return null
  }
}

async function getJson(url: string, token: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      logger.warn({ status: res.status, url: url.split('?')[0] }, 'uptime poller: API call failed')
      return null
    }
    return await res.json()
  } catch (err) {
    logger.warn({ err, url: url.split('?')[0] }, 'uptime poller: API call threw')
    return null
  }
}

/**
 * The alert condition AS THE POLICY STATES IT.
 *
 * Read, never hardcoded -- marveen made this a requirement rather than a
 * mitigation, and the reason is that the day someone tightens the threshold in
 * the console, a hardcoded poller keeps answering the old question and nothing
 * about its output looks wrong.
 */
export function conditionFromPolicies(payload: unknown): UptimeCondition | null {
  const policies = (payload as { alertPolicies?: unknown[] } | null)?.alertPolicies
  if (!Array.isArray(policies)) return null
  for (const p of policies) {
    const conds = (p as { conditions?: unknown[] }).conditions
    if (!Array.isArray(conds)) continue
    for (const c of conds) {
      const t = (c as { conditionThreshold?: { duration?: string; trigger?: { count?: number } } }).conditionThreshold
      if (t?.duration == null) continue
      const secs = Number.parseInt(String(t.duration).replace(/s$/, ''), 10)
      if (!Number.isFinite(secs) || secs <= 0) continue
      return { durationSeconds: secs, triggerCount: t.trigger?.count ?? 1 }
    }
  }
  return null
}

/** Flatten the timeSeries payload into what the pure layer consumes. */
export function seriesFromPayload(payload: unknown): UptimeSeries[] {
  const raw = (payload as { timeSeries?: unknown[] } | null)?.timeSeries
  if (!Array.isArray(raw)) return []
  return raw.map(s => {
    const t = s as {
      metric?: { labels?: Record<string, string> }
      resource?: { labels?: Record<string, string> }
      points?: { interval?: { endTime?: string }; value?: { boolValue?: boolean } }[]
    }
    return {
      checkId: t.metric?.labels?.check_id ?? 'unknown-check',
      checkerLocation: t.metric?.labels?.checker_location ?? 'unknown-location',
      host: t.resource?.labels?.host ?? 'unknown-host',
      points: (t.points ?? []).map(p => ({
        endTime: p.interval?.endTime ?? '',
        passed: p.value?.boolValue,
      })),
    }
  })
}

/**
 * Enqueue, then READ IT BACK.
 *
 * The card requires this and the fleet rule behind it is measured: a write
 * counts as done when the row comes back, not when the call returns. An alert
 * path whose own delivery fails silently is the defect being fixed, so it would
 * be a poor joke to build it on an unverified insert.
 */
function enqueueVerified(content: string): boolean {
  try {
    const msg = createAgentMessage('system', MAIN_AGENT_ID, content)
    const back = getAgentMessage(msg.id)
    if (back == null || back.content !== content) {
      logger.error({ id: msg.id }, 'uptime poller: alert did NOT read back after insert')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err }, 'uptime poller: failed to enqueue alert')
    return false
  }
}

export async function uptimeTick(now = Date.now()): Promise<void> {
  const token = accessToken()
  const proj = project()

  // NO TOKEN IS AN ALERT, NOT A QUIET SKIP. This is the whole point of the card:
  // the failure that looked like silence looked like health for months.
  if (token == null || proj == null) {
    const decision = decideUptimeAlerts([], FALLBACK_CONDITION, state, now)
    const notice = buildUnreadableNotice(decision, 0)
    if (notice != null) {
      enqueueVerified(
        `${notice} (poller could not ${token == null ? 'obtain a gcloud access token' : 'resolve the gcloud project'})`,
      )
    }
    return
  }

  const base = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(proj)}`
  const policyPayload = await getJson(`${base}/alertPolicies`, token)
  const cond = conditionFromPolicies(policyPayload) ?? FALLBACK_CONDITION
  const usingFallback = conditionFromPolicies(policyPayload) == null

  const start = new Date(now - cond.durationSeconds * 1000).toISOString()
  const end = new Date(now).toISOString()
  const q = new URLSearchParams({
    filter: 'metric.type="monitoring.googleapis.com/uptime_check/check_passed"',
    'interval.startTime': start,
    'interval.endTime': end,
  })
  const series = seriesFromPayload(await getJson(`${base}/timeSeries?${q}`, token))

  const decision = decideUptimeAlerts(series, cond, state, now)
  state = decision.next

  const unreadable = buildUnreadableNotice(decision, series.length)
  if (unreadable != null) {
    enqueueVerified(usingFallback ? `${unreadable} (ALSO: the alert policy could not be read, so the condition above is a FALLBACK, not the policy's)` : unreadable)
  }
  const outage = buildUptimeNotice(decision, series.length)
  if (outage != null) enqueueVerified(outage)
}

export function startUptimeAlertWatcher(): NodeJS.Timeout {
  setTimeout(() => { void uptimeTick() }, INITIAL_DELAY_MS)
  return setInterval(() => { void uptimeTick() }, INTERVAL_MS)
}
