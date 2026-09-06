/**
 * Sentry unresolved-issue reader: the DECISION half, with no I/O.
 *
 * WHY THIS EXISTS (card 21634d17, and the reason is not cost):
 * Isti declined to buy a Sentry seat, so nobody on the fleet receives Sentry's
 * own notifications. The obvious reading is that this module is the cheap
 * substitute. It is not -- it has a DIFFERENT property, and it is better in the
 * one where we actually failed:
 *
 *   the `sentry-or` SCHEDULE ..... runs as an injected prompt on an agent turn.
 *                                  Measured 09-05: the 15:23 slot retried 628
 *                                  times against `busy` and never ran -- during
 *                                  the one hour of that day when 135 commits
 *                                  went live.
 *   THIS ......................... runs on the dashboard's own interval, out of
 *                                  `dist/`. There is no turn to be held back.
 *
 * So the closing condition of the card is structural, not stylistic: if this
 * ran from a prompt it would inherit the same `busy` withholding and the card
 * would go green without fixing the measured problem.
 *
 * THE LOUD-FAILURE REQUIREMENT IS THE POINT OF THE MODULE, NOT A SAFEGUARD.
 * A zero-issue tick and a failed fetch must never look alike. That exact
 * collapse kept the backup alarm quiet for months on a 403, and I shipped the
 * same hole in my own uptime core two weeks ago: an empty series array made
 * every field report the shape of good news. `noIssues` and `orgsFailed` exist
 * so the caller CANNOT be silent about either.
 *
 * READ-ONLY BY MEASUREMENT, not by intent: the provisioned token answers 200 to
 * the issues endpoint and 403 to a status write (measured 2026-09-06). Nothing
 * in this module writes to Sentry, and nothing needs to.
 */

/** One unresolved issue, flattened to the fields a reader of the notice needs. */
export interface SentryIssue {
  /** Sentry's numeric issue id, unique within the org. */
  id: string
  /** Which organization it came from -- two are configured, and they differ. */
  org: string
  /** Human-facing short id (`BACKEND-1A`), null when the payload omits it. */
  shortId: string | null
  title: string
  /** Where it fired. Often the only thing that distinguishes two Prisma errors. */
  culprit: string | null
  level: string | null
  /** Event count. Null when absent -- NOT zero, which would read as "harmless". */
  count: number | null
  firstSeen: string | null
  lastSeen: string | null
  permalink: string | null
}

export function issueKey(i: SentryIssue): string {
  return `${i.org}::${i.id}`
}

/**
 * Did this issue first appear AFTER the given watermark? (card 65a324b2)
 *
 * UNPARSEABLE OR ABSENT `firstSeen` COUNTS AS HISTORY, NOT AS AN ARRIVAL, and
 * the direction is deliberate. The opposite default would turn one malformed
 * payload into a burst of announcements about a backlog nobody asked for --
 * the exact outcome the seeding rule exists to prevent. The cost is the stated
 * one: an arrival whose timestamp we cannot read stays silent.
 */
export function firstSeenAfter(i: SentryIssue, sinceMs: number): boolean {
  if (i.firstSeen == null) return false
  const t = Date.parse(i.firstSeen)
  return Number.isFinite(t) && t > sinceMs
}

/**
 * How many individual issues one tick may announce.
 *
 * NOT arbitrary, and not a tuning knob: the fleet queue is the same queue the
 * agents work from, and `agent-msg.sh` refuses to send at >=3 pending PER
 * RECIPIENT. Measured today the two orgs carry 66 unresolved issues between
 * them. Announcing them individually would cut the coordinator off from every
 * other agent over a notice whose content is "here is a list you could have
 * read". Past the cap the decision reports a COUNT, which is still loud and
 * costs one message.
 */
export const MAX_ANNOUNCE_PER_TICK = 5

/**
 * How long a blind spell may run before it is announced again.
 * One hour, same as the uptime poller, and for the same measured reason: a
 * repeated "I can see nothing" notice is itself an outage of the message queue.
 */
export const BLIND_REANNOUNCE_MS = 3_600_000

/** What the poller remembers between ticks, so an issue is announced once. */
export interface SentryIssueState {
  /** `org::id` for every issue already announced or seeded. */
  seen: string[]
  /**
   * Whether a first, seeding tick has happened.
   *
   * COLD START IS ITS OWN CASE, and leaving it out was the first shape of this
   * module: with an empty `seen` set the opening tick classifies all 66 standing
   * issues as new. That is not a burst of information -- it is the entire
   * backlog, delivered at the moment least likely to be useful, and it would
   * have been indistinguishable to a reader from 66 things breaking at once.
   * So the first tick SEEDS and reports one summary line; from then on the
   * module reports arrivals, which is what a watcher is for.
   */
  seeded: boolean
  /**
   * When the last SUCCESSFUL read happened -- the only field that survives a
   * restart, and the whole of card 65a324b2.
   *
   * The rest of this state is per-process, and that is deliberate: a restart
   * re-seeds, so whatever stands at that moment is backlog rather than 66
   * notices at once. The cost didi measured is that an issue which FIRST
   * APPEARS while the process is DOWN is absorbed by the same rule and never
   * announced -- the mirror of card 72cc2172, where per-process state caused
   * repeats instead of silence.
   *
   * One timestamp is enough to close it, because `firstSeen` already travels
   * with every issue: on a cold start anything newer than this watermark is an
   * ARRIVAL, not history. Keeping the whole `seen` set would buy nothing more
   * and would put 69 keys on disk to say what one number says.
   */
  lastReadAtMs?: number
  /** When the current blind spell was last announced. Absent = not blind. */
  blindAnnouncedAtMs?: number
  /** When the current blind spell STARTED, so a repeat can say how long. */
  blindSinceMs?: number
}

export const NO_SENTRY_STATE: SentryIssueState = { seen: [], seeded: false }

/** What one tick observed, before any decision is taken. */
export interface SentryReading {
  /** Every unresolved issue that came back, across all orgs that answered. */
  issues: SentryIssue[]
  /** Orgs we asked. Zero means the caller could not even build a query. */
  orgsQueried: string[]
  /**
   * Orgs whose fetch FAILED, with the reason. Never merged into `issues`:
   * an org that answered with an empty list and an org that returned 403 are
   * different facts, and collapsing them is the defect this card names.
   */
  orgsFailed: { org: string; reason: string }[]
}

export interface SentryIssueDecision {
  /** Issues seen for the first time -- capped at MAX_ANNOUNCE_PER_TICK. */
  newlySeen: SentryIssue[]
  /** New issues BEYOND the cap. Reported as a count, never dropped silently. */
  suppressed: number
  /** True on the seeding tick: report the standing total, not each issue. */
  coldStart: boolean
  /**
   * How many issues first appeared AFTER the last successful read -- non-zero
   * only on a cold start that had a watermark to compare against. Separate from
   * `newlySeen.length` because the cap applies to what is LISTED, never to what
   * is counted (card 65a324b2).
   */
  gapArrivals: number
  /** Unresolved issues visible this tick, across every org that answered. */
  totalIssues: number
  /**
   * NOTHING CAME BACK AT ALL. Kept separate from `orgsFailed` because it is
   * loud under BOTH readings: either every fetch failed, or production really
   * has no unresolved issues -- and after a week in which the silent band held
   * 66, a sudden clean zero is a claim that deserves to be said out loud rather
   * than to pass as the absence of news.
   */
  noIssues: boolean
  /** True when any org could not be read this tick. */
  blind: boolean
  /** Whether the unreadable notice is DUE this tick (edge, or an hour on). */
  announceBlind: boolean
  blindSinceMs: number | null
  next: SentryIssueState
}

/**
 * Decide what this tick should say.
 *
 * DEDUPLICATED BY EDGE, NOT BY LEVEL: an issue that stays unresolved for a week
 * must not be announced every ten minutes. An issue announces when it is first
 * seen; after that it is the reader's, not the poller's.
 *
 * A FAILED ORG DOES NOT RETRACT WHAT IT TOLD US EARLIER. Its issues stay in
 * `seen`, so a 403 followed by a recovery does not re-announce a backlog that
 * was already delivered -- the same reason the uptime core keeps an 'unknown'
 * series in its firing set.
 */
export function decideSentryIssues(
  reading: SentryReading,
  prev: SentryIssueState,
  nowMs: number,
): SentryIssueDecision {
  const { issues, orgsQueried, orgsFailed } = reading
  const was = new Set(prev.seen)

  // Deduplicate by key FIRST: the same issue must not be announced twice within
  // one tick just because two queries overlapped.
  const unique: SentryIssue[] = []
  const seenThisTick = new Set<string>()
  for (const i of issues) {
    const k = issueKey(i)
    if (seenThisTick.has(k)) continue
    seenThisTick.add(k)
    unique.push(i)
  }

  const fresh = unique.filter(i => !was.has(issueKey(i)))
  const coldStart = !prev.seeded

  // A COLD START IS NOT ALWAYS A FIRST RUN -- card 65a324b2. With a watermark
  // from a previous process, the issues that appeared DURING the gap are news;
  // without one (a genuine first run) every standing issue is backlog, which is
  // the behaviour this module shipped with and which stays unchanged.
  const since = prev.lastReadAtMs
  const gapArrivals = coldStart && since != null ? fresh.filter(i => firstSeenAfter(i, since)) : []

  // On the seeding tick nothing is "new" -- everything standing is history,
  // EXCEPT what arrived while nobody was looking.
  const announced = coldStart
    ? gapArrivals.slice(0, MAX_ANNOUNCE_PER_TICK)
    : fresh.slice(0, MAX_ANNOUNCE_PER_TICK)
  const suppressed = coldStart
    ? Math.max(0, gapArrivals.length - announced.length)
    : Math.max(0, fresh.length - announced.length)

  // BLIND covers both halves: an org that failed, and a tick that could not ask
  // anyone at all. The second is the likelier one in practice (no token, vault
  // unreadable), so leaving it out would have made the most probable failure
  // the quietest.
  const blind = orgsFailed.length > 0 || orgsQueried.length === 0
  const blindSinceMs = blind ? (prev.blindSinceMs ?? nowMs) : null
  const announceBlind =
    blind &&
    (prev.blindAnnouncedAtMs == null || nowMs - prev.blindAnnouncedAtMs >= BLIND_REANNOUNCE_MS)

  return {
    newlySeen: announced,
    suppressed,
    coldStart,
    gapArrivals: gapArrivals.length,
    totalIssues: unique.length,
    noIssues: unique.length === 0,
    blind,
    announceBlind,
    blindSinceMs,
    next: {
      // EVERY fresh issue is recorded, including the ones past the cap. The cap
      // limits how loud one tick is, never what the poller remembers -- storing
      // only the announced ones would re-announce the remainder next tick, and
      // the cap would turn into a rolling drip instead of a one-off summary.
      seen: [...prev.seen, ...fresh.map(issueKey)].filter((k, n, a) => a.indexOf(k) === n),
      seeded: prev.seeded || orgsQueried.length > 0,
      // ONLY A SUCCESSFUL READ MOVES THE WATERMARK. A blind tick that advanced
      // it would erase the very gap the watermark exists to measure -- the same
      // shape as a global cursor that a zero-result round still costs.
      ...(orgsQueried.length > 0
        ? { lastReadAtMs: nowMs }
        : prev.lastReadAtMs != null
          ? { lastReadAtMs: prev.lastReadAtMs }
          : {}),
      ...(blind
        ? {
            blindSinceMs: blindSinceMs ?? nowMs,
            blindAnnouncedAtMs: announceBlind ? nowMs : prev.blindAnnouncedAtMs,
          }
        : {}),
    },
  }
}

function describe(i: SentryIssue): string {
  const bits = [i.shortId ?? i.id, i.org, i.title]
  if (i.culprit) bits.push(i.culprit)
  if (i.count != null) bits.push(`${i.count} events`)
  if (i.lastSeen) bits.push(`last ${i.lastSeen}`)
  return bits.join(' | ')
}

/**
 * The notice that reaches the fleet when there is something new to say.
 *
 * Returns null when this tick has nothing -- a watcher that speaks every ten
 * minutes teaches its readers to skip it, which is the failure mode of every
 * alarm that ever went unheeded.
 */
export function buildSentryNotice(d: SentryIssueDecision): string | null {
  if (d.coldStart) {
    if (d.totalIssues === 0) return null // the zero case is the unreadable notice's job
    const head =
      `[sentry] FIRST READ: ${d.totalIssues} unresolved issue(s) standing in the silent band. `
    if (d.newlySeen.length === 0) {
      return (
        head +
        'Nobody was notified about any of them -- there is no Sentry seat, so this poller is the ' +
        'only reader. Not announcing them one by one: they are backlog, not news. ' +
        'From here on this poller reports ARRIVALS.'
      )
    }
    // THE GAP HALF IS SAID FIRST-CLASS, not as a footnote on the backlog line:
    // these are the only issues in the payload that nobody could have seen.
    const gapLines = d.newlySeen.map(i => `  - ${describe(i)}`)
    const gapTail =
      d.suppressed > 0
        ? `\n  ...and ${d.suppressed} more that also arrived during the gap, not listed so this ` +
          'notice cannot flood the fleet queue. They are recorded and will not repeat.'
        : ''
    return (
      head +
      `${d.gapArrivals} of them FIRST APPEARED while this poller was NOT RUNNING, so they are ` +
      `ARRIVALS, not backlog:\n${gapLines.join('\n')}${gapTail}\n` +
      'The rest stands as backlog; from here on this poller reports arrivals.'
    )
  }
  if (d.newlySeen.length === 0) return null
  const lines = d.newlySeen.map(i => `  - ${describe(i)}`)
  const tail =
    d.suppressed > 0
      ? `\n  ...and ${d.suppressed} more new issue(s) this tick, not listed so this notice cannot ` +
        'flood the fleet queue. They ARE recorded, so they will not be repeated next tick -- ' +
        'read them in Sentry.'
      : ''
  return `[sentry] ${d.newlySeen.length + d.suppressed} NEW unresolved issue(s):\n${lines.join('\n')}${tail}`
}

/**
 * The notice for the case this card exists to prevent: we could not look.
 *
 * SEPARATE BUILDER, SEPARATE MESSAGE. Folding "I could not read" into the issue
 * notice would make an unreadable tick indistinguishable from a quiet one at a
 * glance -- and a glance is all these get.
 */
export function buildUnreadableSentryNotice(
  d: SentryIssueDecision,
  reading: SentryReading,
  nowMs = Date.now(),
): string | null {
  if (!d.announceBlind) {
    // NOT BLIND, BUT NOTHING CAME BACK: say so. A clean zero after a week of 66
    // is either very good news or a query that quietly stopped matching, and the
    // reader is the one who can tell which.
    if (d.noIssues && !d.blind && !d.coldStart) {
      return (
        '[sentry] ZERO unresolved issues returned, and every org answered cleanly. ' +
        'This is either genuinely clear or a query that stopped matching -- it is stated ' +
        'rather than passed over, because zero and "could not look" must never read alike.'
      )
    }
    return null
  }
  // HOW LONG THE BLINDNESS HAS RUN, because the hourly cap makes duration the
  // only thing that distinguishes a blip from an outage of our own eyesight.
  // Without it every repeat reads like the first one, and six hours of silence
  // is indistinguishable from six minutes.
  const forMin =
    d.blindSinceMs != null ? Math.max(0, Math.round((nowMs - d.blindSinceMs) / 60_000)) : 0
  const since = forMin >= 1 ? ` -- blind for ${forMin} min now` : ''

  if (reading.orgsQueried.length === 0) {
    return (
      `[sentry] NOT MEASURED${since} -- the poller could not query any organization ` +
      '(no credential, or the org list itself failed). Unresolved issues are NOT ruled out; ' +
      'this tick simply did not look.'
    )
  }
  const failed = reading.orgsFailed.map(f => `${f.org}: ${f.reason}`).join('; ')
  return (
    `[sentry] PARTIALLY UNREADABLE${since} -- ${reading.orgsFailed.length} of ${reading.orgsQueried.length} ` +
    `org(s) failed (${failed}). Any count below is a FLOOR, not a total.`
  )
}
