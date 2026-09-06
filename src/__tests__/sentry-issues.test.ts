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
import { orgsFromPayload, issuesFromPayload } from '../web/sentry-issue-watcher.js'

const NOW = 1_788_000_000_000

function issue(id: string, org = 'delta-crm', over: Partial<SentryIssue> = {}): SentryIssue {
  return {
    id,
    org,
    shortId: `BACKEND-${id}`,
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

  it('orgsFromPayload keeps string slugs and drops everything else', () => {
    expect(orgsFromPayload([{ slug: 'delta-crm' }, { slug: 'agrotech-cv' }])).toEqual(['delta-crm', 'agrotech-cv'])
    expect(orgsFromPayload([{ slug: 1 }, { slug: '' }, {}, null])).toEqual([])
    expect(orgsFromPayload(null)).toEqual([])
  })
})
