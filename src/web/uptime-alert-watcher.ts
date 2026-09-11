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

const GCLOUD_TIMEOUT_MS = 15_000
/** Cap on any borrowed text (stderr, HTTP body) that can reach a log or the fleet queue. */
const MAX_REASON_CHARS = 300

export type Probe<T> = { ok: true; value: T } | { ok: false; reason: string }

/**
 * Strip anything credential-shaped before it can reach a log line or the queue.
 *
 * NOT paranoia in general, but specific to this file: the command whose failure
 * we are now quoting is `gcloud auth print-access-token`. The token itself goes
 * to stdout and we never quote stdout -- but a future gcloud could warn on
 * stderr with a token fragment in it, and this notice is fleet-visible. The
 * module already refuses to put the token on a command line (see the header);
 * capturing stderr must not become the hole that rule closed.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/ya29\.[A-Za-z0-9._-]+/g, 'ya29.[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[REDACTED]')
}

/**
 * Turn a failed execFileSync into a sentence that names ONE cause.
 *
 * THE DEFECT THIS FIXES (card 8fe678ef): stderr went to 'ignore' and the catch
 * was bare, so "gcloud is not installed", "gcloud timed out" and "gcloud said
 * you are not authenticated" all arrived as the same `null`. The notice then had
 * to list three possibilities and could rule out none of them -- which is what
 * marveen had to close BY HAND tonight (production was up; 12 series, 275 points,
 * zero failures; the token worked in the service's own environment; ~30x timeout
 * headroom). The poller was RIGHT to be loud. It just could not say why.
 */
export function describeExecFailure(err: unknown, timeoutMs = GCLOUD_TIMEOUT_MS): string {
  const e = err as NodeJS.ErrnoException & {
    status?: number | null
    signal?: string | null
    stderr?: Buffer | string | null
  }
  if (e?.code === 'ENOENT') return `gcloud is not on PATH for this process (ENOENT)`
  if (e?.code === 'ETIMEDOUT') return `gcloud timed out after ${timeoutMs} ms`
  // A SIGNAL IS NOT A TIMEOUT, and the disjunction that used to be on the line above could only
  // ever produce a FALSE sentence. Measured on node 22 (card f3a2b3d9), four shapes with controls:
  //   node's OWN timeout kill   -> code=ETIMEDOUT  signal=SIGTERM   <- the branch above ALREADY has it
  //   an EXTERNAL SIGTERM       -> code=undefined  signal=SIGTERM   <- only this reached the old
  //                                disjunct, and it reported "timed out after 15000 ms" for a
  //                                budget that never expired
  //   control, plain exit 3     -> code=undefined  signal=null
  //   control, ENOENT           -> code=ENOENT     signal=null
  // So the old `|| signal === 'SIGTERM'` added NOTHING to real-timeout coverage and its only
  // unique case was the lie. The test that pinned it carried the premise "node reports the SIGNAL,
  // not the code" -- that is what the measurement refutes.
  if (typeof e?.signal === 'string' && e.signal.length > 0) {
    return `gcloud was killed by ${e.signal}, NOT by our ${timeoutMs} ms timeout (that path sets ETIMEDOUT too)`
  }
  const stderr = redactSecrets(String(e?.stderr ?? '').trim()).slice(0, MAX_REASON_CHARS)
  const status = typeof e?.status === 'number' ? `gcloud exited ${e.status}` : 'gcloud failed'
  return stderr.length > 0 ? `${status}: ${stderr}` : `${status}, and printed nothing to stderr`
}

/**
 * stdio[2] is 'pipe', NOT 'ignore' -- this IS the card.
 *
 * Named and exported ON PURPOSE. As a bare literal inside the options object it
 * was untestable: reverting it to 'ignore' left all fifteen tests green, because
 * they feed describeExecFailure a synthetic error that already HAS a .stderr.
 * They proved the formatter, never the wiring -- the subject was narrower than
 * the claim. As a value, the revert is a red test.
 */
export const GCLOUD_STDIO = ['ignore', 'pipe', 'pipe'] as const

/**
 * Runs gcloud with stderr CAPTURED, so the failure can name its own cause.
 *
 * `timeoutMs` IS A PARAMETER SO THE TIMEOUT PATH CAN BE PROVEN END TO END in a fifth of a
 * second instead of fifteen -- and it exists because of a MEASUREMENT THAT REFUTED A PLANNED
 * FIX (card 3d038bac). The refutation is worth more than the fix would have been:
 *
 *   Of sixteen `gcloud timed out after 15000 ms` notices, FIVE have a COMPLETE gcloud log --
 *   the value was printed within a second and the call still consumed the whole 15 s. The
 *   obvious remedy is therefore "on timeout, use the stdout we already captured".
 *
 *   IT IS NOT RELIABLY POSSIBLE, and the way that came out is the part worth keeping. Measured
 *   on node v22 against a fake gcloud that prints a value and then keeps running -- same child,
 *   same options, same 200 ms budget -- the answer FLIPS with the runtime:
 *
 *                      plain `node` run        under vitest
 *       execFileSync   err.stdout = ""         err.stdout = "delta-crm-483922\n"
 *       spawnSync      stdout = "delta-..."    stdout = ""
 *
 *   Both APIs were tried, and each delivered the bytes in exactly the environment where the
 *   other did not. A remedy whose firing depends on which runtime is asking is worse than no
 *   remedy: it would work in the test and not in production, or the reverse, and nothing about
 *   its output would say which.
 *
 *   THE COST OF FINDING OUT, recorded because it is the reusable part: the first version was a
 *   pure helper with nine green unit tests over synthetic error objects. It was a NO-OP. Only
 *   running it against a real process said so, and only running it TWICE, in two runtimes, said
 *   why. A pure test of a salvage proves the shape of the salvage, never that anything hands it
 *   the bytes.
 *
 * A working remedy would need an ASYNC spawn, where stdout arrives as data events and is in hand
 * before any timer fires. That is a larger change than this card is worth while the retry
 * (card 213abf0d, already written) answers the 10 of 16 cases that are real hangs.
 *
 * This file already
 * records why that matters: GCLOUD_STDIO had to become a named value because as a bare literal
 * inside the options object, reverting it left every test green -- they proved the formatter
 * and never the wiring. The same trap caught the salvage above: a pure helper can be perfect
 * and still never fire, and whether node even DELIVERS stdout on a timeout is an assumption
 * until a real process is run against it.
 */
export function runGcloud(args: string[], what: string, timeoutMs = GCLOUD_TIMEOUT_MS): Probe<string> {
  try {
    const out = execFileSync('gcloud', args, {
      encoding: 'utf8', timeout: timeoutMs, stdio: [...GCLOUD_STDIO],
    }).trim()
    if (out.length === 0) return { ok: false, reason: `${what}: gcloud exited 0 but printed nothing` }
    return { ok: true, value: out }
  } catch (err) {
    return { ok: false, reason: `${what}: ${describeExecFailure(err, timeoutMs)}` }
  }
}

function accessToken(): Probe<string> {
  return runGcloud(['auth', 'print-access-token'], 'access token')
}

function project(): Probe<string> {
  const p = runGcloud(['config', 'get-value', 'project'], 'project')
  if (!p.ok) return p
  // '(unset)' is gcloud SUCCEEDING and telling us there is no project -- a
  // different cause from a failed call, and it used to collapse into the same null.
  if (p.value === '(unset)') return { ok: false, reason: 'project: gcloud reports the project is (unset)' }
  return p
}

/**
 * THE CALL HAS NO TIMEOUT, AND THIS INSTRUMENTATION IS DELIBERATELY NOT ONE (card 77c305a4).
 *
 * The gap is real: `getJson` is a bare fetch while the two gcloud calls in this same file
 * carry GCLOUD_TIMEOUT_MS, so the author knew the concept and this one path was missed. A
 * hung fetch never returns, so the retry added by card 213abf0d never even gets its turn:
 *
 *     no timeout    -> the tick STOPS, and the next tick starts beside it two minutes later
 *     timeout hit   -> the tick FAILS, and the failure NAMES ITSELF
 *
 * WHY NOT JUST ADD A TIMEOUT. marveen's ruling on this card forbids guessing the threshold,
 * and the reason is in his words: an UNMEASURED number inside a guard is worse than no guard,
 * because the guard's verdict then travels as if it had been measured. A too-tight limit would
 * call a SLOW BUT WORKING API unreachable -- the alarming direction, and it lands in other
 * people's rounds. Nothing here retains a response-time distribution for this API, so there is
 * nothing to set a limit from.
 *
 * SO THIS IS THE CHEAP FIRST STEP THE CARD NAMES: record how long the call takes. With the
 * distribution the threshold is one line; without it, it is a guess.
 *
 * AND THE PART THAT IS EASY TO LEAVE OUT: a duration is only recorded when the call RETURNS,
 * so a hang -- the very thing we are looking for -- leaves NO sample. The in-flight registry is
 * the other half: a call still running when the next tick begins is, BY OUR OWN CONFIGURATION,
 * overdue. That threshold is not a guess about Google; it is INTERVAL_MS, which we chose.
 */
export type InFlightCall = { url: string; startedAt: number }

let inFlight: InFlightCall[] = []

/** Pure, so the overdue rule is testable without a clock or a socket. */
export function overdueCalls(calls: InFlightCall[], now: number, limitMs = INTERVAL_MS): InFlightCall[] {
  return calls.filter((c) => now - c.startedAt >= limitMs)
}

/** Test seam: the registry is module state, and a test must be able to see and clear it. */
export function pollerInFlight(): InFlightCall[] {
  return [...inFlight]
}

export function resetPollerInFlight(): void {
  inFlight = []
}

// Exported for the contract test: the whole point is what this function RECORDS, and that
// cannot be asserted from the tick without also standing up gcloud.
export async function getJson(url: string, token: string): Promise<Probe<unknown>> {
  const where = url.split('?')[0]
  const startedAt = Date.now()
  const entry: InFlightCall = { url: where, startedAt }
  inFlight.push(entry)
  const done = (outcome: string) => {
    inFlight = inFlight.filter((c) => c !== entry)
    // INFO, not DEBUG, ON PURPOSE: the default level is info (src/logger.ts), so a debug line
    // would leave NOTHING retained -- and a retained distribution is the entire deliverable.
    logger.info({ ms: Date.now() - startedAt, url: where, outcome }, 'uptime poller: API call latency')
  }
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      done(`http-${res.status}`)
      logger.warn({ status: res.status, url: where }, 'uptime poller: API call failed')
      // The STATUS is the diagnosis: 401/403 is the credential, 404 is the
      // project or the path, 5xx is Google. Collapsing them into null is the
      // same defect as discarding stderr, one layer out.
      return { ok: false, reason: `HTTP ${res.status} from ${where}` }
    }
    // The body is read INSIDE the measurement: a response whose headers arrive fast and whose
    // body never finishes is the same hang, one layer down, and stopping the clock at the
    // header would hide exactly that case.
    const value = await res.json()
    done('ok')
    return { ok: true, value }
  } catch (err) {
    done('threw')
    logger.warn({ err, url: where }, 'uptime poller: API call threw')
    const msg = redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, MAX_REASON_CHARS)
    return { ok: false, reason: `request to ${where} threw: ${msg}` }
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
  // A call still running as this tick starts cannot complete inside its own tick any more, so
  // it is the hang this card is about -- and it is only visible HERE, because the hung call
  // itself never reaches its own logging. Warn, do not abort: we have no measured basis for
  // deciding it is dead rather than slow, and killing a slow-but-working call is the alarming
  // direction this card's ruling rules out.
  for (const c of overdueCalls(inFlight, now)) {
    logger.warn(
      { url: c.url, msSoFar: now - c.startedAt, limitMs: INTERVAL_MS },
      'uptime poller: an API call is still in flight as the next tick begins -- no timeout exists on this path (card 77c305a4)',
    )
  }
  const tokenProbe = accessToken()
  const projProbe = project()

  // NO TOKEN IS AN ALERT, NOT A QUIET SKIP. This is the whole point of the card:
  // the failure that looked like silence looked like health for months.
  if (!tokenProbe.ok || !projProbe.ok) {
    const decision = decideUptimeAlerts([], FALLBACK_CONDITION, state, now)
    // PERSIST ON THIS PATH TOO. Without it the re-announce window never advances
    // here -- and this is the likeliest blind path of all (missing/expired token),
    // so the one branch that most needs the cap would have been the one without it.
    state = decision.next
    // ONE NAMED CAUSE, not a disjunction the reader cannot close. Before this
    // the suffix said only WHICH CALL failed, never WHY -- so a reader had to
    // rule out "not installed", "timed out" and "not authenticated" by hand.
    // Narrowed explicitly: inside this branch TS knows ONE probe failed but not
    // which, so a ternary over both does not narrow either.
    const why = !tokenProbe.ok ? tokenProbe.reason : !projProbe.ok ? projProbe.reason : 'cause unavailable'
    // THE CAUSE GOES IN, NOT AFTER (card f3808792). It used to be appended, which left the
    // HEADLINE saying "zero series returned" -- a claim about an answer the poller never got.
    const notice = buildUnreadableNotice(decision, 0, now, `poller could not reach gcloud -- ${why}`)
    if (notice != null) enqueueVerified(notice)
    return
  }

  const token = tokenProbe.value
  const proj = projProbe.value
  const base = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(proj)}`
  const policyProbe = await getJson(`${base}/alertPolicies`, token)
  const policyPayload = policyProbe.ok ? policyProbe.value : null
  const cond = conditionFromPolicies(policyPayload) ?? FALLBACK_CONDITION
  const usingFallback = conditionFromPolicies(policyPayload) == null

  const start = new Date(now - cond.durationSeconds * 1000).toISOString()
  const end = new Date(now).toISOString()
  const q = new URLSearchParams({
    filter: 'metric.type="monitoring.googleapis.com/uptime_check/check_passed"',
    'interval.startTime': start,
    'interval.endTime': end,
  })
  const seriesProbe = await getJson(`${base}/timeSeries?${q}`, token)
  const series = seriesFromPayload(seriesProbe.ok ? seriesProbe.value : null)

  const decision = decideUptimeAlerts(series, cond, state, now)
  state = decision.next

  // THE SAME SPLIT ON THIS PATH (card f3808792). A failed timeSeries call also produced an
  // EMPTY list, so `noSeries` was true and the headline said "zero series returned" -- the very
  // conflation the comment below already named, but fixed only in an APPENDED clause. The
  // distinction now lives in the headline; the clause below stays for the policy axis, which is
  // a different question (WHICH condition was used, not whether anything was observed).
  const unreadable = buildUnreadableNotice(
    decision, series.length, now,
    seriesProbe.ok ? null : `the timeSeries call FAILED -- ${seriesProbe.reason}`,
  )
  if (unreadable != null) {
    const parts = [unreadable]
    if (usingFallback) parts.push(`(ALSO: the alert policy could not be read${policyProbe.ok ? '' : ` -- ${policyProbe.reason}`}, so the condition above is a FALLBACK, not the policy's)`)
    enqueueVerified(parts.join(' '))
  }
  const outage = buildUptimeNotice(decision, series.length)
  if (outage != null) enqueueVerified(outage)
}

export function startUptimeAlertWatcher(): NodeJS.Timeout {
  setTimeout(() => { void uptimeTick() }, INITIAL_DELAY_MS)
  return setInterval(() => { void uptimeTick() }, INTERVAL_MS)
}
