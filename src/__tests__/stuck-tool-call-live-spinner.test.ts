import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stuckToolCallSignature, detectPaneState } from '../pane-state.js'
import { liveSpinnerCounter, liveTurnProgressed } from '../web/stuck-tool-call-watcher.js'

// Card 0fc42aaa. The three respawns of 10-14 18:17, 10-14 21:38 and 10-16 00:28
// all had this shape: the PREVIOUS turn's summary ("Baked for 33s") still on
// screen, a NEW turn running a foreground Bash, and the respawn killing it.
const SEP = '─'.repeat(80)
const liveTurnPane = (counter: string) => [
  '✻ Baked for 33s',
  '',
  '❯ [Inbox] 1 new message',
  '',
  '⏺ Bash(python3 scripts/dev-gc.py --apply-worktrees)',
  '  ⎿  Running…',
  '',
  `✻ Imagining… (${counter} · ↓ 733 tokens · thought for 9s)`,
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt',
].join('\n')
// The 2026-06-02 wedge shape: no running-turn spinner at all.
const WEDGE_0602 = ['  hírlevél-welcome-ot...', '', '✻ Worked for 31s', '', '❯ Maradjon, jó így.'].join('\n')

describe('live-turn progress guard (card 0fc42aaa)', () => {
  it('the signature reads the PREVIOUS turn summary on a live-turn pane: the bug', () => {
    expect(stuckToolCallSignature(liveTurnPane('43s'))).toEqual({ tag: 'baked', seconds: 33 })
    expect(detectPaneState(liveTurnPane('43s'))).not.toBe('idle')
  })

  it('reads the live spinner counter, including minute form', () => {
    expect(liveSpinnerCounter(liveTurnPane('43s'))).toBe('43s')
    expect(liveSpinnerCounter(liveTurnPane('1m 13s'))).toBe('1m 13s')
  })

  it('a spinner that moved between two polls is progress', () => {
    expect(liveTurnProgressed(liveSpinnerCounter(liveTurnPane('43s')), liveSpinnerCounter(liveTurnPane('1m 13s')))).toBe(true)
  })

  it('a frozen spinner is NOT progress (a really wedged live turn still recovers)', () => {
    expect(liveTurnProgressed(liveSpinnerCounter(liveTurnPane('43s')), liveSpinnerCounter(liveTurnPane('43s')))).toBe(false)
  })

  it('no spinner (2026-06-02 wedge shape, capture failure, first poll) -> no veto', () => {
    expect(liveSpinnerCounter(WEDGE_0602)).toBeNull()
    expect(liveSpinnerCounter(null)).toBeNull()
    expect(liveTurnProgressed(null, '43s')).toBe(false)
    expect(liveTurnProgressed('43s', null)).toBe(false)
  })
})

describe('wiring: the progress guard runs first in the recover branch and clears the spell', () => {
  const src = readFileSync(join(__dirname, '../web/stuck-tool-call-watcher.ts'), 'utf-8')
  const call = src.indexOf('if (liveTurnProgressed(prevSpinner, spinner))')
  it('precedes the idle-prompt, CPU and stale-verdict gates', () => {
    expect(call).toBeGreaterThan(-1)
    for (const later of ["detectPaneState(pane) === 'idle'", '!confirmsWedgeProfile(cpuPercent, WEDGE_MAX_CPU_PERCENT)', 'verdictStaleByTranscript(transcriptMtime']) {
      const at = src.indexOf(later)
      expect(at, later).toBeGreaterThan(-1)
      expect(call, later).toBeLessThan(at)
    }
  })
  it('records the spinner every poll, before the recover branch', () => {
    expect(src.indexOf('spinnerState.set(session, spinner)')).toBeGreaterThan(-1)
    expect(src.indexOf('spinnerState.set(session, spinner)')).toBeLessThan(src.indexOf('  if (recover) {'))
  })
  it('clears the spell on a skip', () => {
    const block = src.slice(call, src.indexOf('return', call))
    expect(block).toMatch(/watchState\.delete\(session\)/)
  })
})
