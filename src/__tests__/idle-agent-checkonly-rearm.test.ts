import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  decideIdleAlert,
  buildWakeMessage,
  selectDeclaredWork,
  splitWakeItems,
  wakeHasPickableWork,
  wakeRearmFor,
  hasOpenFinding,
  NO_IDLE_STATE,
  type IdleAgentInput,
  type IdleAgentState,
  type IdleAgentThresholds,
  type WorkCheckKind,
  type WorkCountCard,
} from '../idle-agent.js'

// Card 52abd0d4 (marveen 44126, option 1). Measured 2026-10-23 over 7 days: 374 direct wakes, 74
// check-only (no FELVEHETO section); 18 of those repeated the previous set and ALL 18 sat exactly at
// the 4 h re-arm. Decision: a check-only wake with an UNCHANGED set waits 12 h instead of 4. A changed
// set, and every wake with pickable work, are untouched.
//
// PORTED onto the tree that has card 860db8cd (a testing card closed by its reviewer is not on the
// assignee's list at all) and card 1affb872 (a bounced fix heads the wake). On that tree a testing
// card that IS on the list is an owed answer (marveen 44180), so the check-only wake is the one that
// names floor expiries and nothing else.

const H = 60 * 60_000
const at = (h: number) => h * H
const TH: IdleAgentThresholds = {
  sustainedMs: 12 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
  wakeStaleRearmMs: 4 * H,
  wakeStaleRearmCheckOnlyMs: 12 * H,
}
const base: IdleAgentInput = { agent: 'ford', running: true, paneIdle: true, pendingMessages: 0, ownWorkCount: 5 }
const woken = (ids: string[], wakeAtH: number): IdleAgentState => ({
  ...NO_IDLE_STATE, idleSinceMs: at(wakeAtH) + 20 * 60_000, lastWakeAt: at(wakeAtH), lastWakeWorkIds: ids,
})

type Item = { id: string; status: string; priority: string }
const items = (ids: string[], status: string): Item[] => ids.map((id) => ({ id, status, priority: 'normal' }))
const idsOf = (xs: Item[]) => xs.map((c) => c.id)

// ford's 10-19 04:54 wake, as a fixture: five cards he can pick up (the ids are made up; the SHAPE is
// the measured one -- 5 pickable items, nothing waiting on a checker).
const fordItems = items(['f1', 'f2', 'f3', 'f4', 'f5'], 'planned')
const fordIds = idsOf(fordItems)
// Waiting cards whose floor ran out: the only thing an assignee's list holds that is a check.
const floorItems = items(['w1', 'w2', 'w3'], 'waiting')
const floorIds = idsOf(floorItems)
// Testing cards still on an assignee's list: a reviewer's last word that did not close, or the label.
const owedItems = items(['c1', 'c2', 'c3'], 'testing')
const owedIds = idsOf(owedItems)

// The watcher's way: the open-finding measurement is made only for a check-only list.
const input = (kind: WorkCheckKind, list: Item[], bouncedIds?: ReadonlySet<string>): IdleAgentInput => {
  const pickable = wakeHasPickableWork(kind, list, bouncedIds)
  return {
    ...base,
    ownWorkCount: list.length,
    ownWorkIds: idsOf(list),
    ownWorkPickable: pickable,
    ownWorkOpenFinding: pickable ? undefined : hasOpenFinding(list),
  }
}
const rearm = (kind: WorkCheckKind, list: Item[], bouncedIds?: ReadonlySet<string>) => {
  const i = input(kind, list, bouncedIds)
  return wakeRearmFor(TH, i.ownWorkPickable, i.ownWorkOpenFinding)
}

describe('(a) POSITIVE CONTROL: a wake with pickable work keeps the 4 h re-arm', () => {
  it('ford-shaped fixture: pickable items are recognised', () => {
    expect(wakeHasPickableWork('assigned_open_cards', fordItems)).toBe(true)
  })
  it('the first wake goes out', () => {
    const r = decideIdleAlert(input('assigned_open_cards', fordItems), { ...NO_IDLE_STATE, idleSinceMs: at(0) - 20 * 60_000 }, TH, at(0))
    expect(r.decision.alert).toBe(true)
    expect(r.decision.reason).toBe('wake-agent')
  })
  it('the SAME pickable set goes out again after 5 h (inside 4 h it is still suppressed)', () => {
    const inside = decideIdleAlert(input('assigned_open_cards', fordItems), woken(fordIds, 0), TH, at(3))
    expect(inside.decision.reason).toBe('unchanged-since-wake')
    const after = decideIdleAlert(input('assigned_open_cards', fordItems), woken(fordIds, 0), TH, at(5))
    expect(after.decision.alert).toBe(true)
    expect(after.decision.reason).toBe('wake-agent')
  })
})

describe('(b) a check-only wake with an UNCHANGED set waits 12 h', () => {
  it('floor expiries are recognised as check-only, with no owed answer', () => {
    expect(wakeHasPickableWork('assigned_open_cards', floorItems)).toBe(false)
    expect(hasOpenFinding(floorItems)).toBe(false)
  })
  it('NOT out at 5 h', () => {
    const r = decideIdleAlert(input('assigned_open_cards', floorItems), woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(false)
    expect(r.decision.reason).toBe('unchanged-since-wake')
  })
  it('NOT out just inside the 12 h window', () => {
    const r = decideIdleAlert(input('assigned_open_cards', floorItems), woken(floorIds, 0), TH, at(12) - 60_000)
    expect(r.decision.reason).toBe('unchanged-since-wake')
  })
  it('out again after 12 h', () => {
    const r = decideIdleAlert(input('assigned_open_cards', floorItems), woken(floorIds, 0), TH, at(12.1))
    expect(r.decision.alert).toBe(true)
    expect(r.decision.reason).toBe('wake-agent')
  })
  it('the same for a reviewer whose list is floor expiries only', () => {
    const r = decideIdleAlert(input('testing_without_my_comment', floorItems), woken(floorIds, 0), TH, at(5))
    expect(r.decision.reason).toBe('unchanged-since-wake')
  })
})

describe('(c) a check-only wake with a CHANGED set goes out at once', () => {
  it('a new floor expiry at 5 h', () => {
    const grown = [...floorItems, ...items(['w4'], 'waiting')]
    const r = decideIdleAlert(input('assigned_open_cards', grown), woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
    expect(r.decision.reason).toBe('wake-agent')
  })
  it('a removed card at 5 h', () => {
    const shrunk = floorItems.slice(1)
    const r = decideIdleAlert(input('assigned_open_cards', shrunk), woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
  })
  it('the set turning from check-only to PICKABLE goes out at once, not after 12 h', () => {
    const list = [...floorItems, ...items(['p1'], 'planned')]
    const r = decideIdleAlert(input('assigned_open_cards', list), woken(floorIds, 0), TH, at(1))
    expect(r.decision.reason === 'wake-agent' || r.decision.reason === 'wake-cooling-down').toBe(true)
    const r2 = decideIdleAlert(input('assigned_open_cards', list), woken(floorIds, 0), TH, at(5))
    expect(r2.decision.alert).toBe(true)
  })
})

describe('(e) a testing card on the assignee\'s list is an owed answer: the 4 h re-arm (marveen 44180)', () => {
  it('no pickable work, unchanged set, testing cards: NOT 12 h, out at 5 h', () => {
    expect(wakeHasPickableWork('assigned_open_cards', owedItems)).toBe(false)
    const r = decideIdleAlert(input('assigned_open_cards', owedItems), woken(owedIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
    expect(r.decision.reason).toBe('wake-agent')
  })
  it('still suppressed inside 4 h', () => {
    const r = decideIdleAlert(input('assigned_open_cards', owedItems), woken(owedIds, 0), TH, at(3))
    expect(r.decision.reason).toBe('unchanged-since-wake')
  })
  it('ONE testing card among floor expiries is enough', () => {
    const list = [...floorItems, ...items(['c1'], 'testing')]
    const r = decideIdleAlert(input('assigned_open_cards', list), woken(idsOf(list), 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
  })
  it('CONTROL: the same list without the testing card waits', () => {
    const r = decideIdleAlert(input('assigned_open_cards', floorItems), woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(false)
  })
  it('a caller that does not supply ownWorkOpenFinding keeps the 4 h behaviour', () => {
    const r = decideIdleAlert({ ...input('assigned_open_cards', floorItems), ownWorkOpenFinding: undefined }, woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
  })
  it('only TESTING cards count', () => {
    expect(hasOpenFinding(items(['p'], 'planned'))).toBe(false)
    expect(hasOpenFinding(items(['w'], 'waiting'))).toBe(false)
    expect(hasOpenFinding(items(['t'], 'testing'))).toBe(true)
    expect(hasOpenFinding([])).toBe(false)
  })
})

describe('(f) the selection is the reader: which testing cards reach the decision (cards 860db8cd, 52abd0d4)', () => {
  const card = { id: 'card0001', status: 'testing', assignee: 'x', archived_at: null } as WorkCountCard & { id: string }
  const floor = { id: 'card0002', status: 'waiting', assignee: 'x', archived_at: null, due_date: 50 } as WorkCountCard & { id: string }
  const comments = new Map([['card0001', new Map([['x', 100], ['rv', 200]])]])
  const reviewers = new Set(['rv'])
  const pick = (closing?: ReadonlyMap<string, string>) =>
    selectDeclaredWork({ kind: 'assigned_open_cards' }, 'x', [card, floor], comments, 'marveen', 1000, reviewers, undefined, closing)
      .map((c) => ({ id: c.id, status: c.status as string, priority: 'normal' }))

  it('CONTROL: the floor expiry is on the list either way', () => {
    expect(idsOf(pick()).includes('card0002')).toBe(true)
    expect(idsOf(pick(new Map([['card0001', 'rv']])))).toEqual(['card0002'])
  })
  it('the reviewer closed the testing card: it is not on the list, and the wake is check-only (12 h)', () => {
    expect(rearm('assigned_open_cards', pick(new Map([['card0001', 'rv']])))).toBe(12 * H)
  })
  it('the reviewer did not close it: an owed answer, 4 h', () => {
    expect(rearm('assigned_open_cards', pick(new Map()))).toBe(4 * H)
  })
  it('the closing-verdict lookup FAILED (no map): the card stays and the wake keeps 4 h', () => {
    expect(rearm('assigned_open_cards', pick(undefined))).toBe(4 * H)
  })
  it('closed by one reviewer while the last word is another\'s: not closed for the list, 4 h (didi 44208)', () => {
    expect(rearm('assigned_open_cards', pick(new Map([['card0001', 'didi']])))).toBe(4 * H)
  })
})

describe('(g) a BOUNCED fix is work: never the 12 h window (card 1affb872)', () => {
  const kinds: WorkCheckKind[] = ['assigned_open_cards', 'testing_without_my_comment']
  for (const kind of kinds) {
    for (const status of ['testing', 'in_progress']) {
      const list = [...floorItems, ...items(['b1'], status)]
      it(`${kind} / ${status}: 4 h with the bounced ids`, () => {
        expect(wakeHasPickableWork(kind, list, new Set(['b1']))).toBe(true)
        expect(rearm(kind, list, new Set(['b1']))).toBe(4 * H)
      })
      it(`${kind} / ${status}: 4 h WITHOUT them too, which is how the watcher decides`, () => {
        expect(rearm(kind, list)).toBe(4 * H)
        expect(rearm(kind, list, new Set())).toBe(4 * H)
      })
    }
  }
  it('CONTROL: the same lists without the bounced card are check-only', () => {
    for (const kind of kinds) expect(rearm(kind, floorItems, new Set(['b1']))).toBe(12 * H)
  })
  it('the split takes a bounced card out of every other group', () => {
    const list = [...fordItems.slice(0, 1), ...floorItems.slice(0, 1), ...items(['b1'], 'testing'), ...items(['b2'], 'in_progress')]
    const s = splitWakeItems('assigned_open_cards', list, new Set(['b1', 'b2']))
    expect(idsOf(s.bounced).sort()).toEqual(['b1', 'b2'])
    expect(idsOf(s.work)).toEqual(['f1'])
    expect(idsOf(s.floor)).toEqual(['w1'])
    expect(s.review).toEqual([])
  })
})

describe('(h) a reviewer\'s own open cards are work, not a check', () => {
  const own = items(['o1'], 'in_progress')
  it('the message names them as open work under the reviewer\'s name', () => {
    const text = buildWakeMessage('didi', 20, 1, own, Date.UTC(2026, 9, 23), 'testing_without_my_comment')
    expect(text).toMatch(/^SAJAT KARTYAID \(1\)/m)
  })
  it('and the wake keeps the 4 h re-arm', () => {
    expect(wakeHasPickableWork('testing_without_my_comment', own)).toBe(true)
    const r = decideIdleAlert(input('testing_without_my_comment', own), woken(idsOf(own), 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
  })
  it('CONTROL: the assignee\'s review group does not become pickable by the same rule', () => {
    expect(wakeHasPickableWork('assigned_open_cards', owedItems)).toBe(false)
  })
})

describe('wakeRearmFor: the longer window is only ever granted on a MEASURED check-only wake with no open finding', () => {
  it('pickable true or not measured: the ordinary re-arm', () => {
    expect(wakeRearmFor(TH, true, false)).toBe(4 * H)
    expect(wakeRearmFor(TH, undefined, false)).toBe(4 * H)
  })
  it('check-only, no open finding: the longer window', () => {
    expect(wakeRearmFor(TH, false, false)).toBe(12 * H)
  })
  it('check-only with an open finding, or the finding not measured: the ordinary re-arm', () => {
    expect(wakeRearmFor(TH, false, true)).toBe(4 * H)
    expect(wakeRearmFor(TH, false, undefined)).toBe(4 * H)
  })
  it('never shorter than the ordinary one', () => {
    expect(wakeRearmFor({ ...TH, wakeStaleRearmCheckOnlyMs: 1 * H }, false, false)).toBe(4 * H)
  })
  it('no check-only window configured: the old behaviour', () => {
    expect(wakeRearmFor({ ...TH, wakeStaleRearmCheckOnlyMs: undefined }, false, false)).toBe(4 * H)
  })
  it('no ordinary re-arm configured (permanent suppression) stays permanent', () => {
    expect(wakeRearmFor({ ...TH, wakeStaleRearmMs: undefined }, false, false)).toBeUndefined()
  })
  it('a caller that does not supply ownWorkPickable keeps the 4 h behaviour end to end', () => {
    const r = decideIdleAlert({ ...base, ownWorkIds: floorIds }, woken(floorIds, 0), TH, at(5))
    expect(r.decision.alert).toBe(true)
  })
})

describe('the decision and the message use ONE split', () => {
  const kinds: WorkCheckKind[] = ['assigned_open_cards', 'testing_without_my_comment', 'waiting_on_me']
  const mixes: Record<string, Item[]> = {
    pickable: fordItems,
    owedAnswer: owedItems,
    floorOnly: floorItems.slice(0, 1),
    floorAndOwed: [...floorItems, ...owedItems.slice(0, 1)],
    mixed: [...owedItems, ...fordItems.slice(0, 1)],
    inProgress: items(['i1'], 'in_progress'),
  }
  const bouncedSets: Record<string, ReadonlySet<string> | undefined> = {
    'not measured': undefined,
    none: new Set(),
    // Only a testing or an in_progress card can be bounced (bouncedCardIds).
    'the testing and in_progress ones': new Set(['c1', 'i1']),
  }
  // Every section but the floor one names something the agent has to act on.
  const actSection = /^(VISSZADOBOTT JAVITAS|FELVEHETO (MUNKA|ELLENORZES)|VALASZRA VARO ELLENORZES|SAJAT KARTYAID) \(\d+\)/m
  for (const kind of kinds) {
    for (const [name, list] of Object.entries(mixes)) {
      for (const [bname, bounced] of Object.entries(bouncedSets)) {
        it(`${kind} / ${name} / bounced ${bname}: 12 h exactly when the page names floor expiries only`, () => {
          const text = buildWakeMessage('x', 20, list.length, list, Date.UTC(2026, 9, 23), kind, bounced)
          // The watcher decides WITHOUT the bounced ids; the page is built WITH them.
          expect(rearm(kind, list) === 12 * H).toBe(!actSection.test(text))
          expect(rearm(kind, list, bounced)).toBe(rearm(kind, list))
          const s = splitWakeItems(kind, list, bounced)
          expect(/^FELVEHETO (MUNKA|ELLENORZES) \(\d+\)/m.test(text)).toBe(s.work.length > 0)
          expect(/^VISSZADOBOTT JAVITAS \(\d+\)/m.test(text)).toBe(s.bounced.length > 0)
          // The page is capped (WAKE_MAX_CHARS, card 2e78cf63) and the floor section is filled LAST, so beside a
          // bounced or owed section it can be left out: then the closing "+N tovabbi a tablan" line counts it.
          const floorShown = /^PADLO-LEJARAT \(\d+\)/m.test(text)
          if (s.floor.length === 0) expect(floorShown).toBe(false)
          else if (!floorShown) {
            // Left out: the closing line must count AT LEAST every floor item (didi K7: total without floor.length).
            const more = /^\+(\d+) tovabbi a tablan/m.exec(text)
            expect(more, 'floor section left out without a +N line').not.toBeNull()
            expect(Number(more![1])).toBeGreaterThanOrEqual(s.floor.length)
          }
        })
      }
    }
  }
  it('CONTROL: the table holds both outcomes', () => {
    expect(rearm('assigned_open_cards', mixes.floorOnly)).toBe(12 * H)
    expect(rearm('assigned_open_cards', mixes.pickable)).toBe(4 * H)
    expect(splitWakeItems('assigned_open_cards', mixes.floorOnly).floor).toHaveLength(1)
  })
})

describe('wiring in the watcher (source, because the tick is not driven as behaviour here)', () => {
  const src = readFileSync(join(__dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf8')
  it('the 12 h window is configured', () => {
    expect(src).toContain('wakeStaleRearmCheckOnlyMs: 12 * 60 * 60_000')
  })
  it('the decision gets the SAME split on the SAME ownItems the message is built from', () => {
    expect(src).toContain('const ownWorkPickable = ownItems && check ? wakeHasPickableWork(check.kind, ownItems) : undefined')
    expect(src).toContain('const ownWorkOpenFinding = ownItems && ownWorkPickable === false ? hasOpenFinding(ownItems) : undefined')
    expect(src).toMatch(/\n\s+ownWorkPickable,\n\s+ownWorkOpenFinding,\n/)
    expect(src).toContain('const items = ownItems ?? []')
    expect(src).toContain('buildWakeMessage(agent, minutes, decision.workCount, items, Date.now(), (check as WorkCheck).kind, bouncedCardIds(agent, items))')
  })
  it('the list the decision reads has been through the closing-verdict narrowing', () => {
    expect(src).toContain('selectDeclaredWork(check, agent, cards, comments, MAIN_AGENT_ID, nowSec, reviewers, realComments, closingVerdicts)')
  })
})
