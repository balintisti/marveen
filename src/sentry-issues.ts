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
  /**
   * Orgs whose STANDING BACKLOG has already been absorbed -- one entry per org
   * that has ANSWERED at least once in this process (card f248371b).
   *
   * WHY PER ORG AND NOT ONE BOOLEAN. `seeded` closes on orgs ASKED, while `seen`
   * fills from orgs that ANSWERED, and those are not the same set the moment one
   * org times out. Measured 2026-09-11 14:1x, on a real restart: delta-crm threw
   * a timeout on the seeding tick, the other org answered, `seeded` went true --
   * and on the first tick delta-crm came back, its entire standing backlog was
   * missing from `seen`, so 31 issues were announced ONE BY ONE as NEW. Every one
   * of them was stale; the newest `last` was four days old.
   *
   * AND THE OBVIOUS ONE-WORD FIX IS WORSE: closing `seeded` only on a FLAWLESS
   * read would make a permanently failing org turn every tick into a cold start,
   * repeating the FIRST READ / RESUMED notice forever. Same alert fatigue, other
   * direction. Seeding is per-population, and the population is per-org.
   */
  seededOrgs?: string[]
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
  /**
   * On a COLD START THAT HAD A WATERMARK: how long the poller was not reading,
   * in ms. Null on a genuine first run (no watermark to compare against) and on
   * every warm tick.
   *
   * ONE FIELD, TWO JOBS, AND THE FIRST ONE IS THE POINT (card 1dec3f4b): null
   * versus non-null is the only thing that separates a FIRST READ from a
   * RESTART, and `coldStart` alone cannot -- every process start is a cold
   * start, while the watermark survives (card 65a324b2). `gapArrivals` does not
   * separate them either: it is zero both on a first run and on a restart
   * during which nothing arrived.
   */
  restartGapMs: number | null
  /**
   * Standing issues absorbed as BACKLOG because their org answered for the first
   * time this process -- counted, never listed (card f248371b). Zero on almost
   * every tick; non-zero exactly once per org, on the tick it first answers.
   */
  absorbedBacklog: number
  /** Which orgs that absorption came from, so the notice can name them. */
  absorbedOrgs: string[]
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

  // AN ORG THAT WAS UNREADABLE WHEN WE SEEDED HAS ITS OWN FIRST TICK (card
  // f248371b). `answered` is what came back, NOT what we asked: the difference is
  // the whole defect. An issue from an org nobody has read yet is BACKLOG, and it
  // is counted rather than listed -- the same rule the seeding tick applies, just
  // scoped to the org it is true for.
  const failedOrgs = new Set(orgsFailed.map(f => f.org))
  const answered = orgsQueried.filter(o => !failedOrgs.has(o))
  // BACK-COMPAT, AND THE EXISTING TESTS FOUND IT TWICE. A state written before
  // this field exists is `seeded: true` with NO per-org record, and reading that
  // as "no org is seeded" makes the fix ABSORB a genuinely new issue -- swallowing
  // the one thing this module exists to report. My first attempt derived the set
  // from `seen`, which is wrong for the seeded-but-empty case ("we looked, nothing
  // was standing"): there a later issue IS new, and the derivation called it
  // backlog. So a legacy state keeps the OLD semantics exactly -- every org counts
  // as seeded -- and the per-org protection starts from the first tick this code
  // writes the field. That costs nothing in production: `seeded` is per-process,
  // so a restart always re-seeds and always writes it.
  const legacySeeded = prev.seededOrgs === undefined && prev.seeded
  const seededOrgs = new Set(prev.seededOrgs ?? [])
  const isSeededOrg = (org: string) => legacySeeded || seededOrgs.has(org)
  const freshFromSeeded = fresh.filter(i => isSeededOrg(i.org))
  const absorbed = fresh.filter(i => !isSeededOrg(i.org))
  const absorbedOrgs = [...new Set(absorbed.map(i => i.org))].sort()

  // A COLD START IS NOT ALWAYS A FIRST RUN -- card 65a324b2. With a watermark
  // from a previous process, the issues that appeared DURING the gap are news;
  // without one (a genuine first run) every standing issue is backlog, which is
  // the behaviour this module shipped with and which stays unchanged.
  const since = prev.lastReadAtMs
  const gapArrivals = coldStart && since != null ? fresh.filter(i => firstSeenAfter(i, since)) : []
  // The same condition, kept as a number so the notice can tell a restart from a
  // first read WITHOUT re-deriving it from state it does not receive.
  const restartGapMs = coldStart && since != null ? Math.max(0, nowMs - since) : null

  // On the seeding tick nothing is "new" -- everything standing is history,
  // EXCEPT what arrived while nobody was looking.
  // The warm path announces only what came from an org we have already read. The
  // rest is that org's backlog and travels as a COUNT.
  const announced = coldStart
    ? gapArrivals.slice(0, MAX_ANNOUNCE_PER_TICK)
    : freshFromSeeded.slice(0, MAX_ANNOUNCE_PER_TICK)
  const suppressed = coldStart
    ? Math.max(0, gapArrivals.length - announced.length)
    : Math.max(0, freshFromSeeded.length - announced.length)

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
    restartGapMs,
    // On a cold start EVERYTHING standing is already treated as backlog by the
    // seeding rule, so reporting an absorption there would double-count the same
    // silence. This number is about the warm path only.
    absorbedBacklog: coldStart ? 0 : absorbed.length,
    absorbedOrgs: coldStart ? [] : absorbedOrgs,
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
      // ONLY AN ORG THAT ANSWERED IS SEEDED. A failed org keeps its backlog
      // unabsorbed until it actually answers -- which is the point.
      seededOrgs: [...new Set([...(prev.seededOrgs ?? []), ...answered])].sort(),
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
    // A COLD START IS NOT A FIRST READ -- card 1dec3f4b, and the label was the
    // whole of the defect. Every process start is a cold start, so this notice
    // announced itself as the FIRST READ on every restart, for the Nth time,
    // saying "from here on this poller reports ARRIVALS" to a reader who had
    // already been told that. The discriminator was already in the decision
    // (`restartGapMs`, from the watermark of card 65a324b2); only the text
    // ignored it. Nothing about WHAT is announced changes here.
    const gapMin =
      d.restartGapMs != null ? Math.max(0, Math.round(d.restartGapMs / 60_000)) : null
    const head =
      gapMin != null
        ? `[sentry] RESUMED after ${gapMin} min not reading: ${d.totalIssues} unresolved issue(s) standing. `
        : `[sentry] FIRST READ: ${d.totalIssues} unresolved issue(s) standing in the silent band. `
    if (d.newlySeen.length === 0) {
      // AND THE TAIL SPLITS WITH THE HEAD, or the restart line would still end
      // in a sentence that only makes sense the first time.
      if (gapMin != null) {
        return (
          head +
          'NOTHING first appeared during the gap, so there is nothing to announce: the same ' +
          'backlog stands, and it was already reported. Still reporting ARRIVALS.'
        )
      }
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
  // AN ABSORPTION IS WORTH ONE LINE ON EVERY WARM TICK, NOT ONLY A QUIET ONE.
  //
  // It first shipped INSIDE the `newlySeen.length === 0` branch, and didi measured
  // what that cost (card f248371b, review on the built module, four cases with
  // controls both ways): with 31 absorbed AND one genuinely new issue on the same
  // tick, the notice was BYTE-IDENTICAL to the one for zero absorbed and one new
  // issue -- 70 characters, same text. Control: the zero-new case did differ, so
  // the meter could tell them apart and these two really were the same string.
  //
  // The reason written two paragraphs down applies verbatim to the branch that
  // did not have it: that org's backlog would vanish without any reader ever
  // learning it existed. A two-branch case where one branch inherited the
  // rationale and the other did not -- and the silent one is the likelier shape,
  // because an org coming back after an outage is exactly when new issues arrive.
  const absorbedLine =
    d.absorbedBacklog > 0
      ? `[sentry] ${d.absorbedOrgs.join(', ')} answered for the first time since this poller ` +
        `started: ${d.absorbedBacklog} standing issue(s) absorbed as BACKLOG, not listed. ` +
        'They were unreadable when everything else was seeded, so they are old news arriving ' +
        'late, not new failures. From here on this org reports ARRIVALS like the others.'
      : null

  if (d.newlySeen.length === 0) return absorbedLine
  const lines = d.newlySeen.map(i => `  - ${describe(i)}`)
  const tail =
    d.suppressed > 0
      ? `\n  ...and ${d.suppressed} more new issue(s) this tick, not listed so this notice cannot ` +
        'flood the fleet queue. They ARE recorded, so they will not be repeated next tick -- ' +
        'read them in Sentry.'
      : ''
  const announcement =
    `[sentry] ${d.newlySeen.length + d.suppressed} NEW unresolved issue(s):\n${lines.join('\n')}${tail}`
  // SEPARATE PARAGRAPH, NOT A CLAUSE: the two say different things and call for
  // different actions -- read these, and ignore those. One merged sentence
  // swallows whichever half the reader is not looking for, which is the same
  // argument the archived-card warning makes about travelling in its own field.
  return absorbedLine ? `${announcement}\n\n${absorbedLine}` : announcement
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

// ---------------------------------------------------------------------------
// THE ERROR LANE (card 6db77c30, the B half of 32f40913)
//
// Everything above reads ISSUES, and an issue can only appear if Sentry ACCEPTED
// an event for it. Measured 2026-09-24 (marveen, with a control): delta-crm's
// `error` category had accepted 0 and rate_limited ~2000/day since 09-19 -- the
// monthly quota was spent -- while `transaction` and `span` were accepted in the
// same minute. In that state this module's quiet outputs ("NOTHING first
// appeared during the gap", a silent warm tick) are TRUE and byte-identical to a
// healthy week. marveen saw the RESUMED line twice in one hour while ~2000 error
// events a day were being dropped.
//
// What this adds does NOT make the dropped events visible -- they are gone. It
// makes the SILENCE stop reading as calm: a closed lane is its own state, said
// once on the edge, once a day while it lasts, and carried by every issue notice
// that goes out meanwhile.
// ---------------------------------------------------------------------------

/** One org's `error` category over the stats window, hour by hour, oldest first. */
export type SentryLaneReading =
  | { org: string; ok: true; accepted: number[]; rateLimited: number[] }
  | { org: string; ok: false; reason: string }

export type SentryLaneState = 'closed' | 'throttled' | 'open' | 'no-traffic'

/**
 * THE LANE STATE COMES FROM THE SHARE DROPPED, NOT FROM WHETHER ANYTHING GOT THROUGH (didi's review
 * of this card, marveen 2026-09-25). The first version called a lane open as soon as ONE event was
 * accepted in the deciding hour: 1 accepted beside 999 rate-limited read "open", and on an open
 * lane the watcher said nothing about the drops -- the silence was calm again, in exactly the
 * quota-running-out transition this card exists for.
 *   closed ...... at least LANE_CLOSED_SHARE of the deciding hour's events were dropped
 *   throttled ... at least LANE_THROTTLED_SHARE, but not closed: part of the errors arrive
 *   open ........ below that
 */
export const LANE_CLOSED_SHARE = 0.9
export const LANE_THROTTLED_SHARE = 0.1
/** An OPEN lane whose 24 h window dropped at least this share still gets a caveat line. */
export const LANE_LEAK_SHARE = 0.1

export interface SentryLaneClass {
  state: SentryLaneState
  /** rate_limited summed over the whole window. */
  dropped: number
  /** accepted summed over the whole window. */
  accepted: number
  /** The deciding hour -- the last one with any traffic -- so a notice can say what decided it. */
  hourAccepted: number
  hourDropped: number
}

/**
 * Classify one org's lane from its hourly series.
 *
 * THE STATE COMES FROM THE LAST HOUR THAT HAD ANY TRAFFIC, not from the window
 * total and not from the last hour. Both obvious shapes are wrong, measured:
 *   - the 24 h TOTAL keeps saying "open" for up to a day after the quota runs out
 *     (09-18: accepted 155 and rate_limited 1257 on the same day);
 *   - the LAST hour is often empty (09-24 14:4x CEST: the three newest buckets were
 *     0/0 while the lane was closed), and "empty" would flap the state to open and
 *     back, one edge notice per quiet hour.
 * An hour with neither accepted nor rate-limited events says nothing about the
 * lane, so it is skipped. No such hour in the whole window is `no-traffic`: the
 * lane may be open or closed, and nothing was sent to tell which. Within the
 * deciding hour the dropped SHARE sets the state (see LANE_CLOSED_SHARE).
 */
export function classifyLane(accepted: number[], rateLimited: number[]): SentryLaneClass {
  const n = Math.max(accepted.length, rateLimited.length)
  const at = (a: number[], i: number) => (Number.isFinite(a[i]) ? a[i] : 0)
  let dropped = 0
  let acc = 0
  let hourAccepted = 0
  let hourDropped = 0
  for (let i = 0; i < n; i++) {
    const a = at(accepted, i)
    const r = at(rateLimited, i)
    acc += a
    dropped += r
    if (a + r > 0) { hourAccepted = a; hourDropped = r }
  }
  const total = hourAccepted + hourDropped
  const share = total > 0 ? hourDropped / total : 0
  const state: SentryLaneState = total === 0 ? 'no-traffic'
    : share >= LANE_CLOSED_SHARE ? 'closed'
    : share >= LANE_THROTTLED_SHARE ? 'throttled'
    : 'open'
  return { state, dropped, accepted: acc, hourAccepted, hourDropped }
}

/**
 * How often a lane that STAYS closed is said again. A day, because the state
 * is slow (it lasted six days on 09-19..09-24, and it only ends with the quota
 * cycle), and because every issue notice sent meanwhile already carries it.
 */
export const LANE_REANNOUNCE_MS = 24 * 3_600_000

/** Per org: which degraded state it is in, since when, and when that was last said. A record
 *  without `state` predates the throttled state and was written for a CLOSED lane. */
export type SentryLaneMemory = Record<string, { sinceMs: number; announcedAtMs: number; state?: 'closed' | 'throttled' }>

type Degraded = 'closed' | 'throttled'

export interface SentryLaneDecision {
  /** Orgs whose lane is closed or throttled right now, with the window's counts. */
  degraded: { org: string; state: Degraded; dropped: number; accepted: number }[]
  /** OPEN lanes that still dropped a significant share over the window -- caveat only, no edge. */
  leaky: { org: string; dropped: number; accepted: number }[]
  /** Orgs whose lane could not be read this tick -- neither closed nor open. */
  unmeasured: { org: string; reason: string }[]
  /** Entered a degraded state, changed between closed and throttled, or due the daily repeat. */
  announce: {
    org: string; state: Degraded; dropped: number; accepted: number
    hourAccepted: number; hourDropped: number; sinceMs: number; repeat: boolean
  }[]
  /** Were degraded, now open again. */
  reopened: { org: string; accepted: number; dropped: number }[]
  next: SentryLaneMemory
}

/**
 * Decide what the lane readings mean against what was already said.
 *
 * AN UNREADABLE LANE KEEPS ITS PREVIOUS STATE. A failed stats call is not a
 * reopening: dropping the org from memory would announce "reopened" on a 429 and
 * "closed" again on the next tick -- two false edges from one failed request.
 * `no-traffic` is treated the same way for a lane that was degraded: nothing was
 * sent, so nothing says the quota came back.
 */
export function decideSentryLanes(
  lanes: SentryLaneReading[],
  prev: SentryLaneMemory,
  nowMs: number,
): SentryLaneDecision {
  const next: SentryLaneMemory = {}
  const degraded: SentryLaneDecision['degraded'] = []
  const leaky: SentryLaneDecision['leaky'] = []
  const unmeasured: SentryLaneDecision['unmeasured'] = []
  const announce: SentryLaneDecision['announce'] = []
  const reopened: SentryLaneDecision['reopened'] = []

  for (const lane of lanes) {
    const was = prev[lane.org]
    const wasState: Degraded | undefined = was ? (was.state ?? 'closed') : undefined
    if (!lane.ok) {
      unmeasured.push({ org: lane.org, reason: lane.reason })
      if (was) next[lane.org] = was
      continue
    }
    const c = classifyLane(lane.accepted, lane.rateLimited)
    if (c.state === 'closed' || c.state === 'throttled') {
      degraded.push({ org: lane.org, state: c.state, dropped: c.dropped, accepted: c.accepted })
      const say = (sinceMs: number, repeat: boolean) => {
        announce.push({
          org: lane.org, state: c.state as Degraded, dropped: c.dropped, accepted: c.accepted,
          hourAccepted: c.hourAccepted, hourDropped: c.hourDropped, sinceMs, repeat,
        })
        next[lane.org] = { sinceMs, announcedAtMs: nowMs, state: c.state as Degraded }
      }
      if (!was || wasState !== c.state) say(nowMs, false)          // a new state is an edge
      else if (nowMs - was.announcedAtMs >= LANE_REANNOUNCE_MS) say(was.sinceMs, true)
      else next[lane.org] = { ...was, state: wasState }
    } else if (c.state === 'open') {
      if (was) reopened.push({ org: lane.org, accepted: c.accepted, dropped: c.dropped })
      const total = c.accepted + c.dropped
      if (total > 0 && c.dropped / total >= LANE_LEAK_SHARE) {
        leaky.push({ org: lane.org, dropped: c.dropped, accepted: c.accepted })
      }
    } else if (was) {
      // no-traffic on a degraded lane: still degraded as far as anyone can tell
      degraded.push({ org: lane.org, state: wasState!, dropped: c.dropped, accepted: c.accepted })
      next[lane.org] = was
    }
  }
  // An org that disappeared from the org list is not "reopened" either: keep it
  // until it answers again, so a transient org-list gap cannot fake an edge.
  for (const [org, mem] of Object.entries(prev)) {
    if (!lanes.some(l => l.org === org)) next[org] = mem
  }
  return { degraded, leaky, unmeasured, announce, reopened, next }
}

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((100 * part) / whole)}%` : '0%')

/** The edge / daily notice for the lane itself. Null when there is nothing to say.
 *  Every number in it is MEASURED (didi): the first version said "accepted 0 in 24 h" as a fixed
 *  phrase, which on the closing day was false -- the window still held the hours before the close. */
export function buildLaneNotice(d: SentryLaneDecision, nowMs: number): string | null {
  const parts: string[] = []
  for (const c of d.announce) {
    const days = Math.floor((nowMs - c.sinceMs) / 86_400_000)
    const word = c.state === 'closed' ? 'CLOSED' : 'THROTTLED'
    const lead = c.repeat
      ? `[sentry] ERROR LANE STILL ${word} for ${c.org} (known to this poller for ${days} day(s))`
      : `[sentry] ERROR LANE ${word} for ${c.org}`
    const hour = c.hourAccepted + c.hourDropped
    const measured =
      `in the last hour with traffic Sentry dropped ${c.hourDropped} of ${hour} error events ` +
      `(${pct(c.hourDropped, hour)}); over the last 24 h it accepted ${c.accepted} and rate-limited ${c.dropped}.`
    const meaning = c.state === 'closed'
      ? ' No NEW error issue can appear from this org while it lasts, so "nothing new" from this ' +
        'poller does NOT mean nothing broke. The dropped events are gone; only the quota reset ' +
        'or a lower event rate reopens the lane.'
      : ' Only part of the errors arrive: a new issue may be missing and every count is low, so ' +
        '"nothing new" from this poller is not an all-clear either. The dropped events are gone.'
    parts.push(`${lead}: ${measured}${meaning}`)
  }
  for (const r of d.reopened) {
    parts.push(
      `[sentry] ERROR LANE REOPENED for ${r.org}: in the last hour with traffic under ` +
      `${Math.round(LANE_THROTTLED_SHARE * 100)}% was dropped; over the last 24 h ${r.accepted} error ` +
      `event(s) accepted and ${r.dropped} rate-limited. New error issues from this org are visible again.`,
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : null
}

/**
 * The caveat an ISSUE notice carries while a lane is closed or unmeasured.
 *
 * On the notice itself and not only in the daily lane message, because the
 * reassuring line is the one that gets read at the moment of a decision --
 * and "NOTHING first appeared during the gap" is exactly that line.
 */
export function laneCaveat(d: SentryLaneDecision): string | null {
  const bits: string[] = []
  const closed = d.degraded.filter(c => c.state === 'closed')
  const throttled = d.degraded.filter(c => c.state === 'throttled')
  const list = (xs: { org: string; dropped: number; accepted: number }[]) =>
    xs.map(c => `${c.org} (${c.dropped} dropped, ${c.accepted} accepted in 24 h)`).join(', ')
  if (closed.length > 0) {
    bits.push(
      `ERROR LANE CLOSED for ${list(closed)}: no new error issue CAN appear from it, so a quiet ` +
      'line above is not an all-clear.',
    )
  }
  if (throttled.length > 0) {
    bits.push(
      `ERROR LANE THROTTLED for ${list(throttled)}: only part of the errors arrive, so a quiet ` +
      'line above is not an all-clear.',
    )
  }
  if (d.leaky.length > 0) {
    bits.push(
      `Error lane open now, but ${list(d.leaky)}: an issue from the dropped share may be missing.`,
    )
  }
  if (d.unmeasured.length > 0) {
    const ul = d.unmeasured.map(u => `${u.org}: ${u.reason}`).join('; ')
    bits.push(`Error lane NOT MEASURED this tick (${ul}), so a quiet line above is unverified.`)
  }
  return bits.length > 0 ? `[sentry] ${bits.join(' ')}` : null
}
