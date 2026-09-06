// Pure decision logic for surfacing GCP uptime alerts to the FLEET.
//
// WHY THIS EXISTS: measured 2026-09-05, the project has ONE notification channel
// -- an email to Isti. Nothing about a production outage reaches the agents, so
// if the backend dies at 03:00 nobody here knows until he says so. Isti's words
// on card 71349fe1: "Te is minden ertesitest megkapsz, ugye? Arra szukseg van,
// hogy javithassa a csapat."
//
// WHY IT POLLS THE RAW RESULT INSTEAD OF RECEIVING A WEBHOOK, which was the
// card's original plan and is the more obvious design:
//
//   - Google cannot reach this machine. A webhook needs a publicly routable
//     endpoint; this runs on a Mac Mini behind NAT. That is an exposure
//     decision and a permanent attack surface, for a signal we can pull.
//   - There is no incidents API to poll instead. Measured: GET
//     /v3/projects/<p>/incidents -> HTTP 404 "Method not found". You cannot ask
//     Cloud Monitoring what is currently firing.
//   - But the INPUT is readable: GET /v3/projects/<p>/timeSeries -> HTTP 200,
//     the raw `uptime_check/check_passed` booleans, one point per minute per
//     (check x checker location). 12 series on 2026-09-05: backend + frontend
//     across apac-singapore, eur-belgium, sa-brazil, usa-iowa, usa-oregon,
//     usa-virginia.
//
// AND THE PROPERTY THAT DECIDED IT: a poller over the raw result does not
// depend on GCP's notification DELIVERY. The defect on the card IS that
// delivery reaches one address and not us -- a webhook would fix the
// destination while still riding the mechanism that failed. This does not.
// Same shape as `busyEvidence`'s comment: do not build the guard on the thing
// it guards.
//
// ZERO IMPORTS, so it is testable against captured API payloads. The HTTP and
// the queue writes live in src/web/uptime-alert-watcher.ts.

/** One point of an uptime check series, as Cloud Monitoring returns it. */
export interface UptimePoint {
  /** RFC3339. `interval.endTime` in the API payload. */
  endTime: string
  /** `value.boolValue`. Absent/undefined means the API gave us no reading. */
  passed: boolean | undefined
}

/** One (check x checker location) series. */
export interface UptimeSeries {
  checkId: string
  checkerLocation: string
  /** `resource.labels.host` -- what a human recognises. */
  host: string
  points: UptimePoint[]
}

/**
 * The alert condition, READ FROM THE POLICY rather than hardcoded.
 *
 * Hardcoding 600s would let this drift from the policy silently, and the drift
 * would be invisible precisely because both numbers look reasonable. The
 * watcher fetches alertPolicies and passes what it finds; measured on
 * 2026-09-05 the live policy is COMPARISON_LT 0.5 over 600s, trigger count 1.
 */
export interface UptimeCondition {
  /** Seconds a series must fail CONTINUOUSLY before the policy fires. */
  durationSeconds: number
  /**
   * How many series must be failing. The live policy uses 1, which means a
   * SINGLE flaky checker location fires it -- 1 of 12. That is noisy, and it is
   * deliberately mirrored rather than "improved": this exists so the fleet sees
   * what Isti sees. If we quietly required more, we would be building a second,
   * different alerting system and calling it visibility.
   */
  triggerCount: number
}

export type UptimeVerdict = 'firing' | 'clear' | 'unknown'

export interface SeriesVerdict {
  series: UptimeSeries
  verdict: UptimeVerdict
  why: string
}

/**
 * Is this ONE series failing for the whole condition window?
 *
 * 'unknown' is a first-class answer and not a convenience. A window with no
 * points, or with points carrying no boolean, means we did not measure it --
 * and the entire reason this card exists is an alerting path that was silent
 * for months while looking healthy. "No data" must never collapse into "clear".
 */
export function seriesVerdict(
  s: UptimeSeries,
  cond: UptimeCondition,
  nowMs: number,
): SeriesVerdict {
  const windowStart = nowMs - cond.durationSeconds * 1000
  const inWindow = s.points.filter(p => {
    const t = Date.parse(p.endTime)
    return Number.isFinite(t) && t >= windowStart && t <= nowMs
  })

  if (inWindow.length === 0) {
    return { series: s, verdict: 'unknown', why: 'no points inside the condition window' }
  }
  if (inWindow.some(p => typeof p.passed !== 'boolean')) {
    return { series: s, verdict: 'unknown', why: 'a point in the window carries no boolean reading' }
  }
  // A single pass inside the window breaks the "continuously failing" condition,
  // which is what COMPARISON_LT over a duration means.
  if (inWindow.some(p => p.passed === true)) {
    return { series: s, verdict: 'clear', why: `${inWindow.filter(p => p.passed).length}/${inWindow.length} checks passed in the window` }
  }
  return { series: s, verdict: 'firing', why: `all ${inWindow.length} checks failed for the full ${cond.durationSeconds}s window` }
}

/**
 * How long a CONTINUOUS blind spell stays quiet between notices.
 *
 * NOT the same rule as an outage, and the asymmetry is the point (didi found the
 * gap, marveen decided the shape). An outage has a RECOVERY event that closes
 * the story, so announcing it on the edge alone is safe: silence after a firing
 * notice ends with a "RECOVERED" line. "I cannot measure" has no such closing
 * event -- announce it once on the edge and then go quiet, and the fleet is left
 * believing the watcher is working. That is the silent failure this whole card
 * exists to remove, rebuilt one level up.
 *
 * So: neither the level (every 2-minute tick, ~30/hour, unbounded) nor a bare
 * edge (once, ever). The hour comes from this module's own worked example, the
 * outage "lasting an hour" in decideUptimeAlerts.
 *
 * WHY 30/hour was not merely noisy: `message-router.ts:830` skips expiry for the
 * main agent (`if (isMainAgent) continue`), so these pile up rather than age out,
 * and `agent-msg.sh:295` refuses to send at >=3 pending PER RECIPIENT. Roughly six
 * minutes of an undrained queue cuts every other agent off from the coordinator --
 * over a notice whose content is "I can see nothing".
 */
export const BLIND_REANNOUNCE_MS = 3_600_000

/** What the poller remembers between ticks, so an ongoing outage is announced once. */
export interface UptimeAlertState {
  /** `checkId::checkerLocation` for every series currently announced as firing. */
  firing: string[]
  /** When the current blind spell was last announced. Absent = not currently blind. */
  blindAnnouncedAtMs?: number
  /** When the current blind spell STARTED, so a repeat can say how long it has run. */
  blindSinceMs?: number
}

export const NO_UPTIME_STATE: UptimeAlertState = { firing: [] }

export function seriesKey(s: UptimeSeries): string {
  return `${s.checkId}::${s.checkerLocation}`
}

export interface UptimeDecision {
  /** Series that just started firing -- these produce an outage notice. */
  newlyFiring: SeriesVerdict[]
  /** Series that were firing and are now clear -- these produce a recovery notice. */
  recovered: SeriesVerdict[]
  /** Series we could not read. Never silent: the caller must say so. */
  unknown: SeriesVerdict[]
  /**
   * NO SERIES CAME BACK AT ALL -- and this field exists because its absence was
   * a hole. A total fetch failure (no token, 401, network down) hands in an
   * empty array, and every other field then reports the shape of good news:
   * zero firing, zero unknown, policyWouldFire false, both notices null.
   * **Silence, which is what health looks like.** That is byte-for-byte the
   * backup alert that sat on a 403 for months.
   *
   * Fourteen tests and seven caught mutations did not find this, because every
   * one of them handed in at least one series: the gap was in the INPUT SPACE,
   * not the logic. It was found by taking "the no-token path must be as loud as
   * a real alert" as a requirement and asking what the code actually does.
   *
   * Zero series is loud under BOTH readings: either the fetch failed, or no
   * uptime checks are configured -- and "we have no monitoring" is not a state
   * anyone should learn about by silence either.
   */
  noSeries: boolean
  /** True when the policy's trigger threshold is met across all series. */
  policyWouldFire: boolean
  /**
   * Whether the unreadable notice is DUE this tick -- the edge of a blind spell,
   * or an hour of continuous blindness since the last one. The builder formats;
   * this decides, so the window is testable without touching I/O.
   */
  announceBlind: boolean
  /** Start of the current blind spell, or null when this tick can see. */
  blindSinceMs: number | null
  next: UptimeAlertState
}

/**
 * Decide what to announce this tick.
 *
 * DEDUPLICATED BY DESIGN: an outage lasting an hour must not produce a notice
 * every poll. The fleet queue is the same queue agents work from, and this page
 * already measured what repeated injection costs -- 5 908 wakeups for 1 286
 * distinct messages. So a series announces on the EDGE, not on the level.
 *
 * RECOVERY IS ANNOUNCED TOO, and that is not symmetry for its own sake: an
 * outage notice with no closing note leaves the fleet believing production is
 * still down, and the natural repair -- checking by hand -- is exactly the
 * manual step this card exists to remove.
 */
export function decideUptimeAlerts(
  all: UptimeSeries[],
  cond: UptimeCondition,
  prev: UptimeAlertState,
  nowMs: number,
): UptimeDecision {
  const verdicts = all.map(s => seriesVerdict(s, cond, nowMs))
  const firingNow = verdicts.filter(v => v.verdict === 'firing')
  const firingKeys = firingNow.map(v => seriesKey(v.series))
  const was = new Set(prev.firing)

  const newlyFiring = firingNow.filter(v => !was.has(seriesKey(v.series)))
  const recovered = verdicts.filter(
    v => v.verdict === 'clear' && was.has(seriesKey(v.series)),
  )

  const unknown = verdicts.filter(v => v.verdict === 'unknown')
  const blindNow = all.length === 0 || unknown.length > 0
  // A spell that ENDS resets both marks, so the next blind spell announces on its
  // own edge instead of serving out a window that started an hour ago.
  const blindSinceMs = blindNow ? (prev.blindSinceMs ?? nowMs) : null
  const announceBlind =
    blindNow &&
    (prev.blindAnnouncedAtMs == null || nowMs - prev.blindAnnouncedAtMs >= BLIND_REANNOUNCE_MS)

  return {
    newlyFiring,
    recovered,
    unknown,
    noSeries: all.length === 0,
    policyWouldFire: firingNow.length >= cond.triggerCount,
    announceBlind,
    blindSinceMs,
    // An 'unknown' series keeps whatever state it had: we did not learn that it
    // recovered, so dropping it here would silently retract an open outage and
    // then re-announce it on the next readable tick.
    next: {
      ...(blindNow
        ? {
            blindSinceMs: blindSinceMs ?? nowMs,
            blindAnnouncedAtMs: announceBlind ? nowMs : prev.blindAnnouncedAtMs,
          }
        : {}),
      firing: [
        ...firingKeys,
        ...prev.firing.filter(k => {
          const v = verdicts.find(x => seriesKey(x.series) === k)
          return v != null && v.verdict === 'unknown'
        }),
      ].filter((k, i, a) => a.indexOf(k) === i),
    },
  }
}

/**
 * The notice that reaches the fleet.
 *
 * It names the HOST and the checker location, because "production is down" with
 * no locus sends every reader to look in a different place. And it says what
 * the reader should NOT conclude: one failing location out of six is the
 * policy's own trigger, not proof the service is globally unreachable.
 */
export function buildUptimeNotice(d: UptimeDecision, totalSeries: number): string | null {
  if (d.newlyFiring.length === 0 && d.recovered.length === 0) return null
  const parts: string[] = []

  if (d.newlyFiring.length > 0) {
    const where = d.newlyFiring
      .map(v => `${v.series.host} (${v.series.checkerLocation})`)
      .join(', ')
    parts.push(
      `[uptime] ${d.newlyFiring.length}/${totalSeries} uptime series FAILING: ${where}. ` +
      `${d.newlyFiring[0].why}. This is the same condition that emails Isti, surfaced to the fleet ` +
      `so a production outage is not a thing only he can see. ` +
      `NOTE the policy trigger is ${d.newlyFiring.length === 1 ? 'ONE series' : 'per-series'}: a single ` +
      `failing checker location fires it, which is not by itself proof the service is globally down.`,
    )
  }
  if (d.recovered.length > 0) {
    const where = d.recovered
      .map(v => `${v.series.host} (${v.series.checkerLocation})`)
      .join(', ')
    parts.push(`[uptime] RECOVERED: ${where}. ${d.recovered[0].why}.`)
  }
  return parts.join(' ')
}

/**
 * The notice for series we could not read at all.
 *
 * SEPARATE FROM THE OUTAGE NOTICE ON PURPOSE. "We cannot measure production" is
 * a different fact from "production is down", and collapsing them is how the
 * backup alert sat on a 403 for months reading as success. A caller that has no
 * token, or an API that answers with nothing, must produce THIS -- never
 * silence, and never a clear verdict.
 */
export function buildUnreadableNotice(
  d: UptimeDecision,
  totalSeries: number,
  nowMs = Date.now(),
  /** NON-NULL WHEN THE POLLER NEVER REACHED THE API -- the named cause (card f3808792).
   *
   *  "Zero series returned" is a claim about what the API ANSWERED. When the token probe or the
   *  timeSeries call failed, the API was never asked, and the reader is owed the OTHER sentence:
   *  nothing was observed. The two prescribe opposite actions -- "no uptime checks are configured,
   *  go create one" versus "the poller is blind, production may be down right now".
   *
   *  THE FILE ALREADY KNEW THIS AND SAID IT IN THE WRONG PLACE. Both call sites APPENDED the cause
   *  after the notice, and the caller's own comment spells the distinction out. But an appended
   *  qualifier does not travel: what gets quoted, and what a severity filter matches, is the
   *  HEADLINE -- and the headline asserted a measurement that never happened. */
  unreachable: string | null = null,
): string | null {
  // THE WINDOW, not the level. Speaking on every tick is what made this path a
  // fleet-queue hazard; speaking once and never again is the silent failure it
  // was built to remove. See BLIND_REANNOUNCE_MS for why those are different
  // questions from the outage path's.
  if (!d.announceBlind) return null
  // On a repeat the reader must be able to tell an hour-old blind spell from a
  // fresh one -- otherwise identical hourly notices read as flapping.
  const ongoing =
    d.blindSinceMs != null && nowMs - d.blindSinceMs >= BLIND_REANNOUNCE_MS
      ? ` STILL BLIND since ${new Date(d.blindSinceMs).toISOString()} -- this is a repeat, not a new event.`
      : ''
  // CHECKED FIRST, because this is the case that was silent. An empty result has
  // no series to report as unknown, so an unknown-only check reads it as nothing
  // to say.
  if (d.noSeries) {
    // NOT MEASURED, and it says so in the HEADLINE. The old text opened with "zero series
    // returned" on this path too, which is an assertion about an answer nobody received.
    if (unreachable != null && unreachable !== '') {
      return (
        '[uptime] NOT MEASURED -- the poller never reached the monitoring API: ' + unreachable +
        '. This is NOT "zero uptime checks are configured" and NOT "production is down": it is ' +
        'NO OBSERVATION AT ALL, so nothing here rules either of them in or out. Production may ' +
        'be down right now and this path cannot see it. Fix the reach first -- an unreachable ' +
        'poller looks exactly like a healthy one.' +
        ongoing
      )
    }
    return (
      '[uptime] NO UPTIME DATA AT ALL -- zero series returned. The API answered and returned ' +
      'nothing, so either no uptime checks exist or none reported in this window. This is NOT a ' +
      'clear result and must not be read as one: production may be down right now and this path ' +
      'cannot see it.' +
      ongoing
    )
  }
  if (d.unknown.length === 0) return null
  return (
    `[uptime] CANNOT MEASURE ${d.unknown.length}/${totalSeries} uptime series: ` +
    `${d.unknown[0].why}. This is NOT a clear result -- production may be fine or may be down, ` +
    `and this path cannot currently tell you which.${ongoing}`
  )
}
