import { describe, it, expect } from 'vitest'
import {
  decideSentryIssues,
  buildSentryNotice,
  buildUnreadableSentryNotice,
  issueKey,
  NO_SENTRY_STATE,
  MAX_ANNOUNCE_PER_TICK,
  BLIND_REANNOUNCE_MS,
  type SentryIssue,
  type SentryReading,
} from '../sentry-issues.js'
import {
  orgsFromPayload,
  issuesFromPayload,
  loadWatermark,
  saveWatermark,
} from '../web/sentry-issue-watcher.js'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const NOW = 1_788_000_000_000

function issue(id: string, org = 'delta-crm', over: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id,
    org,
    shortId: `BACKEND-${id}`,
    project: 'backend',
    title: `PrismaClientKnownRequestError ${id}`,
    culprit: 'Array.$allOperations(prisma-cache-invalidation)',
    level: 'error',
    count: 7,
    firstSeen: '2026-09-01T00:00:00Z',
    lastSeen: '2026-09-06T11:00:00Z',
    permalink: null,
    ...over,
  }
}

function reading(over: Partial<SentryReading> = {}): SentryReading {
  return { issues: [], orgsQueried: ['delta-crm'], orgsFailed: [], ...over }
}

/** Seeded state that has already "seen" the given issues. */
function seeded(...ids: SentryIssue[]) {
  return { seen: ids.map(issueKey), seeded: true }
}

describe('cold start', () => {
  it('SEEDS instead of announcing the standing backlog one by one', () => {
    const all = Array.from({ length: 66 }, (_, n) => issue(String(n)))
    const d = decideSentryIssues(reading({ issues: all }), NO_SENTRY_STATE, NOW)

    expect(d.coldStart).toBe(true)
    // The whole point: 66 standing issues must NOT become 66 announcements.
    expect(d.newlySeen).toHaveLength(0)
    expect(d.suppressed).toBe(0)
    expect(d.totalIssues).toBe(66)
    // ...but every one is RECORDED, or the next tick replays the backlog.
    expect(d.next.seen).toHaveLength(66)
    expect(d.next.seeded).toBe(true)

    const notice = buildSentryNotice(d)
    expect(notice).toContain('66 unresolved')
    expect(notice).toContain('FIRST READ')
  })

  it('does NOT mark itself seeded when it could not query anyone', () => {
    // Otherwise a tick that failed before it asked anything would count as the
    // cold start, and the real first read would then dump the backlog as "new".
    const d = decideSentryIssues(reading({ orgsQueried: [] }), NO_SENTRY_STATE, NOW)
    expect(d.next.seeded).toBe(false)
    expect(d.coldStart).toBe(true)
  })
})

describe('arrivals are announced on the EDGE, not the level', () => {
  it('announces an issue the first time and never again', () => {
    const a = issue('1')
    const first = decideSentryIssues(reading({ issues: [a] }), seeded(), NOW)
    expect(first.newlySeen.map(i => i.id)).toEqual(['1'])

    const second = decideSentryIssues(reading({ issues: [a] }), first.next, NOW + 60_000)
    expect(second.newlySeen).toHaveLength(0)
    expect(buildSentryNotice(second)).toBeNull()
  })

  it('counts the same issue once when it appears twice in one tick', () => {
    const a = issue('1')
    const d = decideSentryIssues(reading({ issues: [a, a] }), seeded(), NOW)
    expect(d.newlySeen).toHaveLength(1)
    expect(d.totalIssues).toBe(1)
  })

  it('treats the same id in a DIFFERENT org as a different issue', () => {
    // Sentry ids are unique per org, not globally. Keying on the bare id would
    // silently swallow one of the two orgs' issues.
    const d = decideSentryIssues(
      reading({ issues: [issue('1', 'delta-crm'), issue('1', 'agrotech-cv')], orgsQueried: ['delta-crm', 'agrotech-cv'] }),
      seeded(),
      NOW,
    )
    expect(d.totalIssues).toBe(2)
    expect(d.newlySeen).toHaveLength(2)
  })
})

describe('the per-tick cap protects the queue without losing anything', () => {
  it('lists at most the cap, reports the remainder as a COUNT, and remembers ALL', () => {
    const many = Array.from({ length: MAX_ANNOUNCE_PER_TICK + 4 }, (_, n) => issue(`n${n}`))
    const d = decideSentryIssues(reading({ issues: many }), seeded(), NOW)

    expect(d.newlySeen).toHaveLength(MAX_ANNOUNCE_PER_TICK)
    expect(d.suppressed).toBe(4)
    // Recorded, not just announced -- otherwise the cap becomes a rolling drip.
    expect(d.next.seen).toHaveLength(many.length)

    const notice = buildSentryNotice(d)
    expect(notice).toContain(`${many.length} NEW`)
    expect(notice).toContain('and 4 more')

    // The remainder is NOT re-announced on the next tick.
    const next = decideSentryIssues(reading({ issues: many }), d.next, NOW + 60_000)
    expect(next.newlySeen).toHaveLength(0)
    expect(buildSentryNotice(next)).toBeNull()
  })
})

describe('THE LOUD-FAILURE REQUIREMENT -- a zero and a failure must never read alike', () => {
  it('a clean zero is SAID OUT LOUD, not passed over as absence of news', () => {
    const d = decideSentryIssues(reading(), seeded(), NOW)
    expect(d.noIssues).toBe(true)
    expect(d.blind).toBe(false)

    const notice = buildUnreadableSentryNotice(d, reading())
    expect(notice).not.toBeNull()
    expect(notice).toContain('ZERO unresolved')
    // And it must NOT claim we could not look -- that is the other case.
    expect(notice).not.toContain('NOT MEASURED')
  })

  it('a tick that queried NOBODY is blind -- NOT a clean zero', () => {
    // This is the hole that made the backup alarm quiet for months, and the one
    // I shipped in my own uptime core: with no orgs queried every other field
    // reports the shape of good news.
    const r = reading({ orgsQueried: [] })
    const d = decideSentryIssues(r, seeded(), NOW)

    expect(d.blind).toBe(true)
    expect(d.announceBlind).toBe(true)

    const notice = buildUnreadableSentryNotice(d, r)
    expect(notice).toContain('NOT MEASURED')
    expect(notice).toContain('NOT ruled out')
    // The clean-zero wording must NOT appear: it would assert health.
    expect(notice).not.toContain('ZERO unresolved')
  })

  it('a failed org names the org AND the reason, and calls the count a FLOOR', () => {
    const r = reading({
      issues: [issue('1')],
      orgsQueried: ['delta-crm', 'agrotech-cv'],
      orgsFailed: [{ org: 'agrotech-cv', reason: 'HTTP 403 from https://sentry.io/api/0/organizations/agrotech-cv/issues/' }],
    })
    const d = decideSentryIssues(r, seeded(), NOW)
    expect(d.blind).toBe(true)

    const notice = buildUnreadableSentryNotice(d, r)
    expect(notice).toContain('agrotech-cv')
    expect(notice).toContain('HTTP 403')
    expect(notice).toContain('FLOOR')
    expect(notice).toContain('1 of 2')
  })

  it('a failed org does NOT retract issues it reported earlier', () => {
    const a = issue('1')
    const state = seeded(a)
    const d = decideSentryIssues(
      reading({ issues: [], orgsQueried: ['delta-crm'], orgsFailed: [{ org: 'delta-crm', reason: 'HTTP 500' }] }),
      state,
      NOW,
    )
    expect(d.next.seen).toContain(issueKey(a))
    // ...so a recovery does not re-announce a backlog already delivered.
    const after = decideSentryIssues(reading({ issues: [a] }), d.next, NOW + 60_000)
    expect(after.newlySeen).toHaveLength(0)
  })
})

describe('the blind notice is capped, and the cap resets when sight returns', () => {
  it('does not repeat within the hour, and does after it', () => {
    const r = reading({ orgsQueried: [] })
    const first = decideSentryIssues(r, seeded(), NOW)
    expect(first.announceBlind).toBe(true)

    const soon = decideSentryIssues(r, first.next, NOW + BLIND_REANNOUNCE_MS - 1)
    expect(soon.announceBlind).toBe(false)
    expect(buildUnreadableSentryNotice(soon, r)).toBeNull()

    const later = decideSentryIssues(r, first.next, NOW + BLIND_REANNOUNCE_MS)
    expect(later.announceBlind).toBe(true)
  })

  it('the repeat notice says HOW LONG the blindness has run', () => {
    // The hourly cap means duration is the only thing separating a blip from an
    // outage of our own eyesight: without it every repeat reads like the first.
    const r = reading({ orgsQueried: [] })
    const first = decideSentryIssues(r, seeded(), NOW)
    expect(buildUnreadableSentryNotice(first, r, NOW)).not.toContain('blind for')

    const later = decideSentryIssues(r, first.next, NOW + BLIND_REANNOUNCE_MS)
    expect(later.blindSinceMs).toBe(NOW)
    expect(buildUnreadableSentryNotice(later, r, NOW + BLIND_REANNOUNCE_MS)).toContain('blind for 60 min')
  })

  it('a spell that ENDS clears both marks, so the next one announces on its own edge', () => {
    const blindR = reading({ orgsQueried: [] })
    const blind = decideSentryIssues(blindR, seeded(), NOW)
    // Sight returns.
    const clear = decideSentryIssues(reading({ issues: [issue('1')] }), blind.next, NOW + 1000)
    expect(clear.blind).toBe(false)
    // The DECISION field too, not only what is carried forward: a stale
    // blindSinceMs on a sighted tick would let any future consumer report
    // "blind for 6 hours" while we can see perfectly well.
    expect(clear.blindSinceMs).toBeNull()
    expect(clear.next.blindSinceMs).toBeUndefined()
    expect(clear.next.blindAnnouncedAtMs).toBeUndefined()
    // A NEW spell one minute later announces immediately, not an hour on.
    const again = decideSentryIssues(blindR, clear.next, NOW + 60_000)
    expect(again.announceBlind).toBe(true)
  })
})

describe('payload parsing keeps ABSENT distinct from zero', () => {
  it('reads the count when Sentry sends it as a STRING', () => {
    const [i] = issuesFromPayload([{ id: '9', count: '2595', title: 'Error: Command timed out' }], 'delta-crm')
    expect(i.count).toBe(2595)
  })

  it('leaves an absent or unparseable count NULL, never 0', () => {
    // 0 reads as "harmless" in the notice; null reads as "not reported".
    const [a] = issuesFromPayload([{ id: '9', title: 'x' }], 'delta-crm')
    expect(a.count).toBeNull()
    const [b] = issuesFromPayload([{ id: '9', count: 'not-a-number', title: 'x' }], 'delta-crm')
    expect(b.count).toBeNull()
  })

  it('drops entries with no usable id and keeps the rest', () => {
    const out = issuesFromPayload([{ id: '' }, { title: 'no id' }, { id: '3', title: 'ok' }], 'delta-crm')
    expect(out.map(i => i.id)).toEqual(['3'])
    expect(out[0].org).toBe('delta-crm')
  })

  it('returns an empty list for a non-array payload rather than throwing', () => {
    expect(issuesFromPayload(null, 'x')).toEqual([])
    expect(issuesFromPayload({ detail: 'forbidden' }, 'x')).toEqual([])
  })

  /**
   * CARD 2b78538c -- `org` alone cannot say what a count is about.
   *
   * One org carries a DEAD project, the live backend and a mobile client at once,
   * so an org-level total merges three surfaces. The payload has carried `project`
   * all along (measured 69/69 on 2026-09-06); the flattener dropped it.
   *
   * THE FIXTURE PUTS THREE DIFFERENT PROJECTS IN ONE PAYLOAD ON PURPOSE. With a
   * single entry, an implementation that hardcodes a slug -- or returns the ORG --
   * passes; the merge is only expressible when the projects have to stay apart.
   */
  it('keeps the project slug and holds three projects APART in one payload -- card 2b78538c', () => {
    const out = issuesFromPayload(
      [
        { id: '1', title: 'a', project: { id: '10', slug: 'backend' } },
        { id: '2', title: 'b', project: { id: '11', slug: 'sajat-crm-backend' } },
        { id: '3', title: 'c', project: { id: '12', slug: 'mobile' } },
      ],
      'delta-crm',
    )
    expect(out.map(i => i.project)).toEqual(['backend', 'sajat-crm-backend', 'mobile'])
    // and the org is still the org -- the two fields answer different questions
    expect(new Set(out.map(i => i.org))).toEqual(new Set(['delta-crm']))
  })

  it('leaves an absent or malformed project NULL, and never substitutes the org name', () => {
    // Substituting the org would be the ALARMING failure: a null would read as a
    // real project, and the merge this card exists to expose would look repaired.
    const out = issuesFromPayload(
      [
        { id: '1', title: 'no project at all' },
        { id: '2', title: 'not an object', project: 'backend' },
        { id: '3', title: 'object without slug', project: { id: '10' } },
        { id: '4', title: 'empty slug', project: { slug: '' } },
        { id: '5', title: 'the CONTROL -- a real one in the same call', project: { slug: 'mobile' } },
      ],
      'delta-crm',
    )
    expect(out.slice(0, 4).map(i => i.project)).toEqual([null, null, null, null])
    // CONTROL: the extractor is not simply always-null
    expect(out[4].project).toBe('mobile')
  })

  it('orgsFromPayload keeps string slugs and drops everything else', () => {
    expect(orgsFromPayload([{ slug: 'delta-crm' }, { slug: 'agrotech-cv' }])).toEqual(['delta-crm', 'agrotech-cv'])
    expect(orgsFromPayload([{ slug: 1 }, { slug: '' }, {}, null])).toEqual([])
    expect(orgsFromPayload(null)).toEqual([])
  })
})


/**
 * CARD 65a324b2 -- an issue that first appears while the poller is DOWN.
 *
 * The seeding rule (above) is right and stays: a restart must not replay the
 * backlog. What it also swallowed is an ARRIVAL during the gap, because a cold
 * start called everything standing "history". One persisted watermark separates
 * the two, and `firstSeen` was already in the payload.
 *
 * EVERY CASE HERE PUTS A GAP ARRIVAL AND A PRE-GAP ISSUE IN THE SAME READING.
 * With only arrivals, an implementation that announced the whole backlog on a
 * cold start would pass -- which is the exact behaviour the seeding rule exists
 * to prevent, so the fixture has to be able to fail in both directions.
 */
describe('an arrival during a restart gap is not backlog (card 65a324b2)', () => {
  const WATERMARK = Date.parse('2026-09-05T00:00:00Z')
  const BEFORE = { firstSeen: '2026-09-01T00:00:00Z' }
  const AFTER = { firstSeen: '2026-09-05T12:00:00Z' }

  it('announces ONLY what first appeared after the watermark, and seeds the rest', () => {
    const old1 = issue('1', 'delta-crm', BEFORE)
    const old2 = issue('2', 'delta-crm', BEFORE)
    const gap = issue('3', 'delta-crm', AFTER)
    const d = decideSentryIssues(
      reading({ issues: [old1, old2, gap] }),
      { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK },
      NOW,
    )
    expect(d.coldStart).toBe(true)
    expect(d.gapArrivals).toBe(1)
    expect(d.newlySeen.map(i => i.id)).toEqual(['3'])
    // The backlog is still counted and still not listed.
    expect(d.totalIssues).toBe(3)
    expect(d.suppressed).toBe(0)
  })

  it('WITHOUT a watermark the seeding behaviour is unchanged -- a genuine first run', () => {
    const d = decideSentryIssues(
      reading({ issues: [issue('1', 'delta-crm', BEFORE), issue('3', 'delta-crm', AFTER)] }),
      NO_SENTRY_STATE,
      NOW,
    )
    expect(d.coldStart).toBe(true)
    expect(d.gapArrivals).toBe(0)
    expect(d.newlySeen).toEqual([])
  })

  it('an UNREADABLE firstSeen counts as history, never as an arrival', () => {
    const d = decideSentryIssues(
      reading({
        issues: [
          issue('1', 'delta-crm', { firstSeen: null }),
          issue('2', 'delta-crm', { firstSeen: 'not-a-date' }),
          issue('3', 'delta-crm', AFTER),
        ],
      }),
      { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK },
      NOW,
    )
    // The control is the third issue: the meter CAN say yes, so the two zeros
    // are about the timestamps and not about a filter that rejects everything.
    expect(d.newlySeen.map(i => i.id)).toEqual(['3'])
  })

  it('EXACTLY AT the watermark is history -- we had already read that tick', () => {
    // Without this case a `>` / `>=` mutation is a tautology: no fixture would
    // sit between the two thresholds, so the probe could not fail either way.
    const d = decideSentryIssues(
      reading({
        issues: [
          issue('at', 'delta-crm', { firstSeen: '2026-09-05T00:00:00Z' }),
          issue('after', 'delta-crm', AFTER),
        ],
      }),
      { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK },
      NOW,
    )
    expect(d.newlySeen.map(i => i.id)).toEqual(['after'])
  })

  it('caps the listing like any other tick, and reports the remainder as a count', () => {
    const many = Array.from({ length: MAX_ANNOUNCE_PER_TICK + 3 }, (_, n) =>
      issue(`gap-${n}`, 'delta-crm', AFTER),
    )
    const d = decideSentryIssues(
      reading({ issues: [issue('old', 'delta-crm', BEFORE), ...many] }),
      { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK },
      NOW,
    )
    expect(d.gapArrivals).toBe(MAX_ANNOUNCE_PER_TICK + 3)
    expect(d.newlySeen).toHaveLength(MAX_ANNOUNCE_PER_TICK)
    expect(d.suppressed).toBe(3)
  })

  it('the notice says the arrivals are arrivals, and still reports the standing total', () => {
    const d = decideSentryIssues(
      reading({ issues: [issue('1', 'delta-crm', BEFORE), issue('3', 'delta-crm', AFTER)] }),
      { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK },
      NOW,
    )
    const notice = buildSentryNotice(d)
    expect(notice).toContain('FIRST READ: 2 unresolved')
    expect(notice).toContain('NOT RUNNING')
    expect(notice).toContain('BACKEND-3')
    // and the pre-gap issue is NOT listed -- the half that makes this a fix
    // rather than "announce everything after a restart".
    expect(notice).not.toContain('BACKEND-1')
  })

  it('a BLIND tick does not move the watermark -- that would erase the gap it measures', () => {
    const before = { ...NO_SENTRY_STATE, lastReadAtMs: WATERMARK }
    const blind = decideSentryIssues(
      reading({ orgsQueried: [], orgsFailed: [{ org: 'delta-crm', reason: '403' }] }),
      before,
      NOW,
    )
    expect(blind.next.lastReadAtMs).toBe(WATERMARK)
    // CONTROL: a tick that DID read moves it, so the assertion above is about
    // the blind branch and not about a watermark that never moves at all.
    const ok = decideSentryIssues(reading({ issues: [issue('1')] }), before, NOW)
    expect(ok.next.lastReadAtMs).toBe(NOW)
  })
})

describe('the watermark file (card 65a324b2)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sentry-wm-'))

  it('round-trips a value', () => {
    const path = join(dir, 'ok.json')
    saveWatermark(1_788_000_000_000, path)
    expect(loadWatermark(path)).toBe(1_788_000_000_000)
  })

  it('a MISSING file is a first run, not a zero', () => {
    expect(loadWatermark(join(dir, 'nope.json'))).toBeUndefined()
  })

  it('a CORRUPT file is a first run, not 1970 -- which would announce the backlog', () => {
    const path = join(dir, 'bad.json')
    writeFileSync(path, '{ this is not json', 'utf8')
    expect(loadWatermark(path)).toBeUndefined()
    const wrongType = join(dir, 'wrong.json')
    writeFileSync(wrongType, JSON.stringify({ lastReadAtMs: 'yesterday' }), 'utf8')
    expect(loadWatermark(wrongType)).toBeUndefined()
  })
})
