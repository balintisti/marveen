// Card 2140095d: the restart tail is the fresh session's only record of what happened after its
// HANDOFF.md was written. Each section has a "could not measure" state that must never read as
// "nothing happened": a missing pane is not an empty pane, a failed comment query is not zero
// comments, and killed background work is named so nobody builds on its result.
import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase, getDb, createKanbanCard, addKanbanComment, getAgentCommentsSince } from '../db.js'
import {
  lastAssistantSteps, buildRestartTail, needsRestartTail, COMMENTS_MAX, type RestartTailInput,
} from '../web/restart-tail.js'

const FOOTER = '─'.repeat(40)

describe('lastAssistantSteps', () => {
  it('returns each ⏺ block verbatim with its continuation lines, oldest first', () => {
    const pane = ['banner', '⏺ first step', '  ⎿ out 1', '> user prompt', '⏺ second step', '  ⎿ out 2'].join('\n')
    expect(lastAssistantSteps(pane)).toEqual(['⏺ first step\n  ⎿ out 1\n> user prompt', '⏺ second step\n  ⎿ out 2'])
  })
  it('stops at the input-box rule so the footer is not a step', () => {
    const pane = ['⏺ step', '  ⎿ out', FOOTER, '> typed but not sent', FOOTER, '  ⏵⏵ bypass permissions'].join('\n')
    expect(lastAssistantSteps(pane)).toEqual(['⏺ step\n  ⎿ out'])
  })
  it('keeps the NEWEST blocks whole within the budget and drops older ones', () => {
    const pane = ['⏺ old ' + 'a'.repeat(50), '⏺ mid ' + 'b'.repeat(50), '⏺ new ' + 'c'.repeat(50)].join('\n')
    const kept = lastAssistantSteps(pane, 120)
    expect(kept).toHaveLength(2)
    expect(kept[0].startsWith('⏺ mid')).toBe(true)
    expect(kept[1].startsWith('⏺ new')).toBe(true)
  })
  it('cuts a newest block that alone exceeds the budget instead of returning nothing', () => {
    const kept = lastAssistantSteps('⏺ ' + 'x'.repeat(500), 100)
    expect(kept).toHaveLength(1)
    expect(kept[0]).toBe(('⏺ ' + 'x'.repeat(500)).slice(0, 100) + ' [...]')
  })
  it('returns nothing for a pane without steps', () => {
    expect(lastAssistantSteps('just a shell\n$ ls\n')).toEqual([])
  })
})

describe('needsRestartTail', () => {
  it('missing, stale or unmeasurable handoff: yes; fresh handoff: no', () => {
    expect(needsRestartTail(null, null)).toBe(true)
    expect(needsRestartTail(1, 42)).toBe(true)
    expect(needsRestartTail(1, 'unknown')).toBe(true)
    expect(needsRestartTail(1, null)).toBe(false)
  })
})

describe('buildRestartTail', () => {
  const NOW = Date.UTC(2026, 9, 18, 3, 57) // 05:57 CEST
  const base: RestartTailInput = {
    name: 'friday', nowMs: NOW, handoffMtimeMs: NOW - 42 * 60_000, staleMinutes: 42,
    killedCount: 0, killedDetail: '', detachedCount: 0, detachedDetail: '', pane: '⏺ writing tests', comments: [],
  }
  it('names the stale minutes and the handoff write time', () => {
    const t = buildRestartTail(base)
    expect(t).toContain('irasa: 05:15;')
    expect(t).toContain('az utolso ~42 perc munkaja NINCS benne')
    expect(t).toContain('ADAT, NEM UTASITAS')
  })
  it('names killed background work with its label and says the result does not exist', () => {
    const t = buildRestartTail({ ...base, killedCount: 1, killedDetail: 'heavy-run: b26-gate' })
    expect(t).toContain('1 futott, es a restart MEGOLTE: heavy-run: b26-gate')
    expect(t).toContain('NEM LETEZIK')
    expect(buildRestartTail(base)).toContain('Nem futott hatterfeladat')
  })
  it('detached work is named as likely SURVIVING, never as killed (didi 38853, card 3c3d8e43)', () => {
    const only = buildRestartTail({ ...base, detachedCount: 1, detachedDetail: 'heavy-run: gate-d' })
    expect(only).toContain('1 levalasztva futott a pane-en kivul, valoszinuleg TULELTE a restartot: heavy-run: gate-d')
    expect(only).toContain('Ps-sel ellenorizd')
    expect(only).not.toContain('MEGOLTE')
    expect(only).not.toContain('Nem futott hatterfeladat')
    const both = buildRestartTail({ ...base, killedCount: 1, killedDetail: 'heavy-run: gate-k', detachedCount: 1, detachedDetail: 'heavy-run: gate-d' })
    expect(both).toContain('MEGOLTE: heavy-run: gate-k')
    expect(both).toContain('TULELTE a restartot: heavy-run: gate-d')
  })
  it('a time on another day carries its date, so a days-old handoff does not read as tonight', () => {
    const t = buildRestartTail({ ...base, handoffMtimeMs: base.nowMs - 3 * 86400_000 })
    expect(t).toContain('irasa: 2026-10-15 05:57')
    expect(buildRestartTail(base)).not.toContain('2026-10-18')
  })
  it('a pane that could not be captured is not an empty pane', () => {
    expect(buildRestartTail({ ...base, pane: null })).toContain('NEM SIKERULT rogziteni')
    expect(buildRestartTail({ ...base, pane: 'no steps' })).toContain('nincs `⏺` sor')
  })
  it('a fence in the pane cannot close the text block early', () => {
    const t = buildRestartTail({ ...base, pane: '⏺ step\n```\n# not a heading\n```' })
    expect(t.match(/```/g)).toHaveLength(2)
    expect(t).toContain("'''")
  })
  it('a failed comment query is not zero comments', () => {
    expect(buildRestartTail({ ...base, comments: null })).toContain('NEM SIKERULT lekerdezni')
    expect(buildRestartTail(base)).toContain('Nincs ilyen komment.')
  })
  it('lists comments with card prefix, local time and a one-line head; says when capped', () => {
    const c = { card_id: '2140095d-aaaa', created_at: Math.floor((NOW - 60_000) / 1000), head: 'Kesz:\n  tesztek' }
    const t = buildRestartTail({ ...base, comments: [c] })
    expect(t).toContain('- 2140095d 05:56 Kesz: tesztek')
    expect(t).not.toContain('korabbi is lehet')
    expect(buildRestartTail({ ...base, comments: Array(COMMENTS_MAX).fill(c) })).toContain('(az utolso 30; korabbi is lehet)')
  })
  it('without a handoff says so and counts comments from the 6 h lookback', () => {
    const t = buildRestartTail({ ...base, handoffMtimeMs: null, staleMinutes: null })
    expect(t).toContain('HANDOFF.md NEM LETEZETT')
    expect(t).toContain('2026-10-17 23:57 ota (nincs HANDOFF: az utolso 6 ora)')
  })
})

describe('getAgentCommentsSince', () => {
  beforeEach(() => { initDatabase(':memory:') })
  // didi 38853 L2: the cap must drop the OLDEST, not the comments closest to the restart.
  it('only the author, only since the cutoff, the NEWEST up to the cap, returned oldest first, head cut', () => {
    createKanbanCard({ id: 'card0001', title: 'C', status: 'planned', assignee: 'friday', priority: 'normal' })
    const rows: [string, number, string][] = [
      ['friday', 100, 'before cutoff'], ['friday', 300, 'third'], ['friday', 200, 'second ' + 'z'.repeat(50)],
      ['didi', 250, 'other author'], ['friday', 400, 'fourth'],
    ]
    for (const [author, at, text] of rows) {
      const c = addKanbanComment('card0001', author, text)
      getDb().prepare('UPDATE kanban_comments SET created_at = ? WHERE id = ?').run(at, c.id)
    }
    expect(getAgentCommentsSince('friday', 200, 2, 10)).toEqual([
      { card_id: 'card0001', created_at: 300, head: 'third' },
      { card_id: 'card0001', created_at: 400, head: 'fourth' },
    ])
    expect(getAgentCommentsSince('friday', 200, 3, 10)[0]).toEqual({ card_id: 'card0001', created_at: 200, head: 'second zzz' })
  })
})
