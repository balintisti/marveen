// Card 00262e3f, the ACTIVE half: the stop signal at the move, its answer, and the stand
// (marveen's decision, comment 58608). These are the decisions; the effects (the row, the files,
// the directive, the switch-off) are driven through the real runner in card-boundary-runner.test.ts.
//
// The three removals the decision names (point 6) each have a case here that turns red:
//   the signal ........ "everything holds at the move: the signal is issued"
//   the continue ...... "shown and idle, no restart decided: carry on, on this sweep"
//   the switch-off .... "a stand over the limit on an active event switches the active half off"

import { describe, it, expect, afterEach } from 'vitest'
import { rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { DEFAULT_CONTEXT_GUARD, type CardRestartFacts, type ContextGuardConfig } from '../context-guard.js'
import {
  SHOW_WINDOW_MS, STAND_FOLLOW_MS, STAND_LIMIT_MS,
  signalApplies, decideSignalAtMove, decideSignalAnswer, judgeStand,
  cardBoundarySignalBody, cardBoundaryContinueText,
  isSignalAgentId, signalPath, shownPath, answeredPath,
  writeSignal, readSignal, readShownMs, clearSignal, hasSignalFile, writeAnswered, readAnswered, clearAnswered,
  type AnswerFacts, type AnsweredBoundary, type CardBoundarySignal, type MoveFacts, type StandJudgement,
} from '../web/card-boundary-signal.js'

const mkTmp = tmpDirs()
const NOW = 1_800_000_000_000
const MIN = 60_000
const MOVED = NOW - 1_000
const ARMED: ContextGuardConfig = { ...DEFAULT_CONTEXT_GUARD, cardRestartEnabled: true, cardRestartSignal: true, cardRestartTokens: 80_000 }
const FACTS: CardRestartFacts = { boundary: { cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: MOVED }, blockers: [] }

function move(overrides: Partial<MoveFacts> = {}): MoveFacts {
  return {
    cfg: ARMED, cardId: 'c0ffee11', fromStatus: 'in_progress', toStatus: 'testing',
    frozen: false, running: true, guardPhase: 'idle', sessionStartSec: NOW / 1000 - 3600,
    contextTokens: 120_000, backgroundWork: 0, facts: FACTS,
    ...overrides,
  }
}

describe('the signal at the move', () => {
  it('everything holds at the move: the signal is issued', () => {
    expect(decideSignalAtMove(move())).toEqual({ issue: true })
  })

  it('every hand-over target, and only a move out of in_progress', () => {
    for (const to of ['testing', 'waiting', 'done']) expect(signalApplies(ARMED, 'in_progress', to), to).toBe(true)
    expect(signalApplies(ARMED, 'in_progress', 'planned')).toBe(false)
    expect(signalApplies(ARMED, 'planned', 'testing')).toBe(false)
    expect(signalApplies(ARMED, 'testing', 'done')).toBe(false)
    expect(signalApplies(ARMED, undefined, 'testing')).toBe(false)
  })

  it('not armed, or not a hand-over: no signal and NO reason, so an unarmed agent leaves no log line', () => {
    const silent = { issue: false, reason: null }
    expect(decideSignalAtMove(move({ cfg: { ...ARMED, cardRestartSignal: false } }))).toEqual(silent)
    // The signal promises a restart the passive half would not make.
    expect(decideSignalAtMove(move({ cfg: { ...ARMED, cardRestartEnabled: false } }))).toEqual(silent)
    expect(decideSignalAtMove(move({ fromStatus: 'planned' }))).toEqual(silent)
    expect(decideSignalAtMove(move({ toStatus: 'planned' }))).toEqual(silent)
  })

  // Point 1 of the decision: anything that cannot be known at the move means NO signal, with the reason.
  const cases: Array<[string, Partial<MoveFacts>, string]> = [
    ['the fleet is frozen', { frozen: true }, 'frozen'],
    ['the agent has no running session', { running: false }, 'no running session'],
    ['the guard is mid-sequence', { guardPhase: 'await-handoff' }, 'phase await-handoff'],
    ['the session start is unknown', { sessionStartSec: undefined }, 'session start is not known'],
    ['the context cannot be measured', { contextTokens: null }, 'context size unmeasurable'],
    ['the context is below the threshold', { contextTokens: 79_999 }, 'context 80k is below 80k'],
    ['background work could not be measured', { backgroundWork: null }, 'could not be measured'],
    ['background work is running', { backgroundWork: 2 }, 'background work is running'],
    ['the board facts are missing', { facts: null }, 'could not be read'],
    ['the last move is unreadable', { facts: { boundary: 'unknown', blockers: [] } }, 'could not be read'],
    ['the agent has no boundary event', { facts: { boundary: null, blockers: [] } }, 'not this move'],
    ['the last board event is another card', { facts: { boundary: { cardId: 'other', toStatus: 'testing', movedAtMs: MOVED }, blockers: [] } }, 'not this move'],
    ['a blocker stands', { facts: { ...FACTS, blockers: ['another own card is in_progress: aa11', '1 approval(s) pending'] } }, 'another own card is in_progress: aa11; 1 approval(s) pending'],
  ]
  for (const [name, overrides, words] of cases) {
    it(`no signal when ${name}`, () => {
      const v = decideSignalAtMove(move(overrides))
      expect(v.issue).toBe(false)
      expect((v as { reason: string | null }).reason).toContain(words)
    })
  }

  it('the threshold is the passive half\'s: exactly at it the signal goes out', () => {
    expect(decideSignalAtMove(move({ contextTokens: 80_000 }))).toEqual({ issue: true })
  })

  it('the text says the two things the agent has to do, and that no HANDOFF is wanted', () => {
    const t = cardBoundarySignalBody('c0ffee11', 'testing', 123_400, 80_000)
    expect(t.startsWith('[KARTYAHATAR] ')).toBe(true)
    expect(t).toContain('c0ffee11')
    expect(t).toContain('in_progress-ből testing állapotba')
    expect(t).toContain('~123k token (a küszöb 80k)')
    // (1) head-only knowledge to the card, (2) end the turn.
    expect(t).toContain('írd fel MOST a kártyára kommentként')
    expect(t).toContain('FEJEZD BE a kört')
    expect(t).toContain('ne vegyél fel új kártyát')
    expect(t).toContain('NE írj HANDOFF.md-t')
    // Where the order comes from, so the agent can check it instead of trusting the text.
    expect(t).toContain('kártya 00262e3f')
    expect(t).toContain('58608')
    // The promise the continue signal keeps.
    expect(t).toContain('folytatás-jelzést kapsz')
    expect(t).not.toContain('\n')
  })
})

const SIGNAL: CardBoundarySignal = {
  agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: MOVED, issuedAtMs: NOW - 4 * MIN, msgId: 77, text: 'x',
}
const SHOWN = SIGNAL.issuedAtMs + 500

function answer(overrides: Partial<AnswerFacts> = {}): AnswerFacts {
  return {
    signal: SIGNAL, shownAtMs: SHOWN, nowMs: NOW, running: true, sessionStartSec: NOW / 1000 - 3600, paneIdle: true,
    decision: { action: 'none', reason: 'below threshold' },
    ...overrides,
  }
}
const cardRestartDecision = (cardId = 'c0ffee11', movedAtMs = MOVED) =>
  ({ action: 'restart', reason: 'card-restart (...)', cardRestart: { cardId, movedAtMs } })

describe('the answer on a sweep', () => {
  it('no signal, no card restart: nothing', () => {
    expect(decideSignalAnswer(answer({ signal: null, shownAtMs: null }))).toEqual({ kind: 'none' })
  })

  it('no signal, a card restart: the PASSIVE half', () => {
    expect(decideSignalAnswer(answer({ signal: null, shownAtMs: null, decision: cardRestartDecision() }))).toEqual({ kind: 'restart', half: 'passive' })
  })

  it('the agent was shown the signal and the guard restarts on that same move: the ACTIVE half', () => {
    expect(decideSignalAnswer(answer({ decision: cardRestartDecision() }))).toEqual({ kind: 'restart', half: 'active' })
  })

  it('a restart is credited to the signal only if the agent saw it, and only for that move', () => {
    expect(decideSignalAnswer(answer({ shownAtMs: null, decision: cardRestartDecision() }))).toEqual({ kind: 'restart', half: 'passive' })
    expect(decideSignalAnswer(answer({ decision: cardRestartDecision('other') }))).toEqual({ kind: 'restart', half: 'passive' })
    expect(decideSignalAnswer(answer({ decision: cardRestartDecision('c0ffee11', MOVED + 1) }))).toEqual({ kind: 'restart', half: 'passive' })
  })

  // Point 3 of the decision: work must not stand.
  it('shown and idle, no restart decided: carry on, on this sweep', () => {
    const a = decideSignalAnswer(answer({ decision: { action: 'none', reason: 'card-restart: refused at a card boundary (...) -- 1 approval(s) pending' } }))
    expect(a).toEqual({ kind: 'continue', reason: 'card-restart: refused at a card boundary (...) -- 1 approval(s) pending' })
  })

  it('...whatever the guard\'s reason was: a reason from another tier is still an answer', () => {
    const a = decideSignalAnswer(answer({ decision: { action: 'none', reason: 'below threshold' } }))
    expect(a).toEqual({ kind: 'continue', reason: 'the guard did not decide a restart on this check (below threshold)' })
  })

  it('shown but still working: wait, it has not stopped yet', () => {
    expect(decideSignalAnswer(answer({ paneIdle: false }))).toEqual({ kind: 'wait' })
    // The same boundary is still its last board event: still within the signal.
    expect(decideSignalAnswer(answer({ paneIdle: false, facts: FACTS }))).toEqual({ kind: 'wait' })
    expect(decideSignalAnswer(answer({ paneIdle: false, facts: { boundary: 'unknown', blockers: [] } }))).toEqual({ kind: 'wait' })
  })

  it('shown, working, and the board has moved on: not followed, the signal is dropped without a stop to answer', () => {
    for (const boundary of [null, { cardId: 'next', toStatus: 'testing', movedAtMs: NOW - MIN }, { cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: MOVED + 5 }] as const) {
      const a = decideSignalAnswer(answer({ paneIdle: false, facts: { boundary, blockers: [] } }))
      expect(a.kind).toBe('clear')
      expect((a as { why: string }).why).toContain('not followed')
      expect((a as { warn: boolean }).warn).toBe(false)
    }
  })

  it('never shown: wait inside the show window, then drop it LOUDLY (nobody was told to stop)', () => {
    const fresh = { ...SIGNAL, issuedAtMs: NOW - SHOW_WINDOW_MS }
    expect(decideSignalAnswer(answer({ signal: fresh, shownAtMs: null }))).toEqual({ kind: 'wait' })
    const stale = { ...SIGNAL, issuedAtMs: NOW - SHOW_WINDOW_MS - 1 }
    const a = decideSignalAnswer(answer({ signal: stale, shownAtMs: null }))
    expect(a.kind).toBe('clear')
    expect((a as { warn: boolean }).warn).toBe(true)
    expect((a as { why: string }).why).toContain('never shown')
  })

  it('never shown and idle is NOT a stop to answer: no continue text for an agent that was told nothing', () => {
    const a = decideSignalAnswer(answer({ signal: { ...SIGNAL, issuedAtMs: NOW - SHOW_WINDOW_MS - 1 }, shownAtMs: null, paneIdle: true }))
    expect(a.kind).toBe('clear')
  })

  it('the session is gone or replaced: nobody stands on the signal', () => {
    expect(decideSignalAnswer(answer({ running: false })).kind).toBe('clear')
    const replaced = decideSignalAnswer(answer({ sessionStartSec: SIGNAL.issuedAtMs / 1000 + 1 }))
    expect(replaced.kind).toBe('clear')
    expect((replaced as { why: string }).why).toContain('replaced')
    // A session that started before the signal is the one that was told.
    expect(decideSignalAnswer(answer({ sessionStartSec: SIGNAL.issuedAtMs / 1000 - 1 })).kind).toBe('continue')
    // An unknown start does not pass for "replaced".
    expect(decideSignalAnswer(answer({ sessionStartSec: undefined })).kind).toBe('continue')
  })

  it('another sequence takes the agent over: the signal ends, and that sequence does the talking', () => {
    for (const action of ['restart', 'request-handoff']) {
      const a = decideSignalAnswer(answer({ decision: { action, reason: 'context at 98%' } }))
      expect(a.kind, action).toBe('clear')
      expect((a as { why: string }).why).toContain(`superseded by ${action}: context at 98%`)
    }
    for (const action of ['inject-resume', 'release']) {
      expect(decideSignalAnswer(answer({ decision: { action, reason: 'x' } })), action).toEqual({ kind: 'wait' })
    }
  })

  it('the continue text names the card and the reason, and ends the stop', () => {
    const t = cardBoundaryContinueText('c0ffee11', 'card-restart: refused -- 1 approval(s) pending')
    expect(t.startsWith('[KARTYAHATAR] Az újraindítás NEM történt meg a(z) c0ffee11 kártya után: card-restart: refused -- 1 approval(s) pending.')).toBe(true)
    expect(t).toContain('Folytasd ebben a munkamenetben')
    expect(t).toContain('vedd fel a következő kártyádat')
    expect(t).toContain('nincs mire várnod')
  })
})

describe('the stand', () => {
  const answered = (overrides: Partial<AnsweredBoundary> = {}): AnsweredBoundary => ({
    agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', half: 'active', how: 'restart',
    atMs: NOW, turnEndMs: NOW - 3 * MIN, turnEndSource: 'transcript', ...overrides,
  })
  // 'gave-up' carries no switch-off at all: undefined here, so a toBe(false) on it would fail.
  const switchOff = (j: StandJudgement): boolean | undefined => (j.kind === 'gave-up' ? undefined : j.switchOff)

  it('measured from the end of the turn to the first tool call after the answer', () => {
    expect(judgeStand(answered(), NOW + 2 * MIN, NOW + 5 * MIN)).toEqual({ kind: 'measured', standMs: 5 * MIN, switchOff: false })
  })

  it('a stand over the limit on an active event switches the active half off', () => {
    // Still standing, the limit just passed.
    expect(judgeStand(answered(), null, NOW + 7 * MIN + 1)).toEqual({ kind: 'standing', standMs: 10 * MIN + 1, overLimit: true, switchOff: true })
    // Measured late, never reported while standing.
    expect(judgeStand(answered(), NOW + 8 * MIN, NOW + 9 * MIN)).toEqual({ kind: 'measured', standMs: 11 * MIN, switchOff: true })
  })

  it('exactly the limit is not over it', () => {
    expect(STAND_LIMIT_MS).toBe(10 * MIN)
    expect(judgeStand(answered(), null, NOW + 7 * MIN)).toEqual({ kind: 'standing', standMs: 10 * MIN, overLimit: false, switchOff: false })
    expect(switchOff(judgeStand(answered(), NOW + 7 * MIN, NOW + 8 * MIN))).toBe(false)
  })

  it('the PASSIVE half is measured but never switches anything off: nobody was told to stop', () => {
    const j = judgeStand(answered({ half: 'passive' }), null, NOW + 20 * MIN)
    expect(j).toEqual({ kind: 'standing', standMs: 23 * MIN, overLimit: true, switchOff: false })
    expect(switchOff(judgeStand(answered({ half: 'passive' }), NOW + 20 * MIN, NOW + 21 * MIN))).toBe(false)
  })

  it('a continue answer counts like a restart: the agent stood either way', () => {
    expect(switchOff(judgeStand(answered({ how: 'continue' }), null, NOW + 8 * MIN))).toBe(true)
  })

  it('reported once: after the switch-off the same event does not fire again', () => {
    expect(judgeStand(answered({ limitReported: true }), null, NOW + 30 * MIN)).toEqual({ kind: 'standing', standMs: 33 * MIN, overLimit: true, switchOff: false })
    expect(switchOff(judgeStand(answered({ limitReported: true }), NOW + 30 * MIN, NOW + 31 * MIN))).toBe(false)
  })

  it('followed for an hour, then the record is dropped', () => {
    expect(judgeStand(answered(), null, NOW + STAND_FOLLOW_MS).kind).toBe('standing')
    expect(judgeStand(answered(), null, NOW + STAND_FOLLOW_MS + 1)).toEqual({ kind: 'gave-up', standMs: STAND_FOLLOW_MS + 1 + 3 * MIN })
  })

  it('a clock that runs backwards gives 0, not a negative stand', () => {
    expect(judgeStand(answered({ turnEndMs: NOW + MIN }), NOW + 1, NOW + 2).standMs).toBe(0)
  })
})

describe('the files', () => {
  let dir = ''
  const mk = () => (dir = mkTmp('cardsignal-'))
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = '' })

  it('a signal reads back whole', () => {
    mk()
    writeSignal(SIGNAL, dir)
    expect(hasSignalFile('computress', dir)).toBe(true)
    expect(readSignal('computress', dir)).toEqual(SIGNAL)
    expect(readShownMs('computress', dir)).toBeNull()
    // No temp file is left beside it: the hook lists this directory on every call.
    expect(readdirSync(dir)).toEqual(['computress.json'])
  })

  it('a new signal removes the old shown mark, or the hook would stay silent on it', () => {
    mk()
    writeSignal(SIGNAL, dir)
    writeFileSync(shownPath('computress', dir), String(SHOWN))
    expect(readShownMs('computress', dir)).toBe(SHOWN)
    writeSignal({ ...SIGNAL, cardId: 'next', msgId: 78 }, dir)
    expect(readShownMs('computress', dir)).toBeNull()
    expect(readSignal('computress', dir)?.cardId).toBe('next')
  })

  it('clearing removes the signal and its mark, and is harmless when nothing is there', () => {
    mk()
    writeSignal(SIGNAL, dir)
    writeFileSync(shownPath('computress', dir), String(SHOWN))
    clearSignal('computress', dir)
    expect(readdirSync(dir)).toEqual([])
    expect(() => clearSignal('computress', dir)).not.toThrow()
    expect(hasSignalFile('computress', dir)).toBe(false)
  })

  it('a file that is not a whole signal is no signal', () => {
    mk()
    const broken: unknown[] = [
      '{', 'null', '[]',
      { ...SIGNAL, agent: 'ford' },      // another agent's content under this name
      { ...SIGNAL, text: '' },
      { ...SIGNAL, msgId: '77' },
      { ...SIGNAL, issuedAtMs: null },
      { ...SIGNAL, cardId: undefined },
    ]
    for (const b of broken) {
      writeFileSync(signalPath('computress', dir), typeof b === 'string' ? b : JSON.stringify(b))
      expect(readSignal('computress', dir), JSON.stringify(b)).toBeNull()
    }
  })

  it('a shown mark that is not a time is "not shown"', () => {
    mk()
    for (const bad of ['', 'yes', '0', '-5', 'NaN']) {
      writeFileSync(shownPath('computress', dir), bad)
      expect(readShownMs('computress', dir), bad).toBeNull()
    }
  })

  it('an answered record reads back, with and without the reported mark', () => {
    mk()
    const rec: AnsweredBoundary = { agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', half: 'active', how: 'continue', atMs: NOW, turnEndMs: NOW - MIN, turnEndSource: 'signal-shown' }
    writeAnswered(rec, dir)
    expect(readAnswered('computress', dir)).toEqual(rec)
    writeAnswered({ ...rec, limitReported: true }, dir)
    expect(readAnswered('computress', dir)).toEqual({ ...rec, limitReported: true })
    // It is not a signal: the hook and hasSignalFile must not see it as one.
    expect(hasSignalFile('computress', dir)).toBe(false)
    for (const bad of [{ ...rec, half: 'both' }, { ...rec, how: 'stop' }, { ...rec, turnEndSource: 'guess' }, { ...rec, agent: 'ford' }, { ...rec, turnEndMs: 'x' }]) {
      writeFileSync(answeredPath('computress', dir), JSON.stringify(bad))
      expect(readAnswered('computress', dir), JSON.stringify(bad)).toBeNull()
    }
    clearAnswered('computress', dir)
    expect(existsSync(answeredPath('computress', dir))).toBe(false)
  })

  it('a kanban actor that is not a plain agent id never becomes a file name', () => {
    mk()
    for (const bad of ['../marveen', 'a/b', '', ' computress', 'isti (dashboard)', '.hidden', 'x'.repeat(65)]) {
      expect(isSignalAgentId(bad), bad).toBe(false)
      expect(() => signalPath(bad, dir), bad).toThrow(/not an agent id/)
      expect(() => writeSignal({ ...SIGNAL, agent: bad }, dir), bad).toThrow(/not an agent id/)
      // Asked on every sweep for every name: a plain "no", not a throw.
      expect(hasSignalFile(bad, dir), bad).toBe(false)
    }
    expect(readdirSync(dir)).toEqual([])
    for (const ok of ['computress', 'ford', 'agent_2', 'a-b']) expect(isSignalAgentId(ok), ok).toBe(true)
  })
})
