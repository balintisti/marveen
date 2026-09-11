import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordPaneSource,
  getPaneSource,
  paneSourceSurvivesDrop,
  resetPaneSourcesForTest,
} from '../web/pane-source-survival.js'
import { decideStuckInputAction, type StuckInputActionFacts } from '../pane-state.js'

beforeEach(() => { resetPaneSourcesForTest() })

function facts(over: Partial<StuckInputActionFacts>): StuckInputActionFacts {
  return {
    escalate: true,
    rowCount: 4,
    blockComplete: false,
    blockTruncated: false,
    truncatedPreamble: false,
    allowPlainReinject: false,
    hasPlainText: false,
    machineOrigin: false,
    scheduledTaskBlock: false,
    sourceSurvives: false,
    recordedMatch: false,
    ...over,
  }
}

describe('per-pane survival record (card c4b99fa7)', () => {
  it('reports FALSE for a pane it has never seen -- the fail-safe direction', () => {
    // The load-bearing default. A missing record must never read as "safe to drop":
    // losing the record has to return today's conservative behaviour, not a weaker one.
    expect(paneSourceSurvivesDrop('agent-never-written')).toBe(false)
    expect(getPaneSource('agent-never-written')).toBeNull()
  })

  it('only "redelivered" counts as surviving -- degrades and lost do not', () => {
    recordPaneSource('a', 'redelivered', 'next schedule fire re-delivers')
    recordPaneSource('b', 'degrades', 'deadline force-restarts instead')
    recordPaneSource('c', 'lost', 'markMessageDelivered on the next line')
    const got = ['a', 'b', 'c'].map(paneSourceSurvivesDrop)
    // Asserted as a SHAPE, not three separate truths: this fails both if the predicate
    // collapses to always-true and if it collapses to always-false.
    expect(got).toEqual([true, false, false])
  })

  it('keeps one entry per pane, and the last write wins', () => {
    recordPaneSource('p', 'redelivered', 'first')
    recordPaneSource('p', 'lost', 'second')
    expect(getPaneSource('p')?.reason).toBe('second')
    expect(paneSourceSurvivesDrop('p')).toBe(false)
  })

  it('carries the declared reason for diagnosis', () => {
    recordPaneSource('p', 'lost', 'markMessageDelivered on the next line')
    expect(getPaneSource('p')?.reason).toContain('markMessageDelivered')
  })
})

describe('the survival fact reaches the recovery decision (card c4b99fa7)', () => {
  it('clears a multi-row dead-end park when origin AND survival BOTH hold', () => {
    // Without this branch these facts land in 'hold' -- the 2026-07-25 hermes deadlock.
    expect(decideStuckInputAction(facts({ machineOrigin: true, sourceSurvives: true })))
      .toBe('clear-redelivered')
  })

  it('needs BOTH halves: either alone still holds', () => {
    // The control that matters. machineOrigin alone is today's behaviour (hold, because
    // allowPlainReinject is false); sourceSurvives alone must NOT clear, because the
    // declaration says what WE last sent, not that the parked text IS that thing.
    const originOnly = decideStuckInputAction(facts({ machineOrigin: true, sourceSurvives: false }))
    const survivalOnly = decideStuckInputAction(facts({ machineOrigin: false, sourceSurvives: true }))
    const neither = decideStuckInputAction(facts({}))
    expect([originOnly, survivalOnly, neither]).toEqual(['hold', 'hold', 'hold'])
  })

  it('does not outrank the lossless paths', () => {
    // A complete block and a registry match are both LOSSLESS; clearing would cost a
    // cycle for no reason, so they must still win over the new branch.
    expect(decideStuckInputAction(facts({ machineOrigin: true, sourceSurvives: true, blockComplete: true })))
      .toBe('reinject-block')
    expect(decideStuckInputAction(facts({ machineOrigin: true, sourceSurvives: true, recordedMatch: true })))
      .toBe('reinject-recorded')
  })

  it('leaves the single-row Enter remedy alone', () => {
    expect(decideStuckInputAction(facts({ machineOrigin: true, sourceSurvives: true, rowCount: 1, escalate: false })))
      .toBe('enter')
  })
})
