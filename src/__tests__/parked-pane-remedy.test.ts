import { describe, it, expect } from 'vitest'
import { paneRemedy } from '../web/parked-pane-remedy.js'
import { detectPaneState, parkedInputText } from '../pane-state.js'
import { formatStuckSessionAlert } from '../web/message-router.js'

// Real-shaped fixtures. The 25-line window is not arbitrary: measured
// 2026-09-05, all nine live fleet panes captured exactly 25 lines.
const FOOTER = '⏵⏵ bypass permissions on (shift+tab to cycle)'
const RULE = '─'.repeat(60)
const WINDOW = 25

function pane(lines: string[]): string {
  return lines.slice(-WINDOW).join('\n')
}

function parkedPane(wrapLines: number, text = '[inbox-wakeup] pending inter-agent messages'): string {
  const body = Array.from({ length: wrapLines }, (_, i) => `  wrapped continuation ${i}`)
  return pane(['scrollback a', 'scrollback b', RULE, `❯ ${text}`, ...body, RULE, FOOTER])
}

const EMPTY_PANE = pane(['scrollback a', RULE, '❯ ', RULE, FOOTER])
const WORKING_PANE = pane([
  'scrollback a',
  '✻ Thinking… (12s · ↓ 3.1k tokens · esc to interrupt)',
  RULE, '❯ ', RULE, FOOTER,
])
// A real permission prompt REPLACES the idle footer -- it does not sit under
// one. Shape taken from the live agent-dexter capture in
// pane-permission-prompt.test.ts (2026-09-03 07:24).
const PERMISSION_PANE = [
  ' │ a Read() deny rule is configured; only you can approve running it anyway.',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n')

describe('paneRemedy: the two opposite misreadings of a stuck-session alert', () => {
  it('a VISIBLE parked box asks for one Enter, not a restart', () => {
    const v = paneRemedy(parkedPane(4))
    expect(v.remedy).toBe('press-enter')
    // parkedInputText flattens the WHOLE box, wrapped continuations included.
    expect(v.parkedText).toMatch(/^\[inbox-wakeup\] pending inter-agent messages/)
  })

  it('a live turn is left alone', () => {
    expect(paneRemedy(WORKING_PANE).remedy).toBe('leave-it')
  })

  it('an empty visible box carries no remedy', () => {
    expect(paneRemedy(EMPTY_PANE).remedy).toBe('none')
  })

  it('no capture is an admission, never idle', () => {
    expect(paneRemedy(null).remedy).toBe('read-the-pane')
    expect(paneRemedy('   ').remedy).toBe('read-the-pane')
  })
})

describe('the blind spot this predicate exists for', () => {
  // THE CARD'S MECHANISM. The box scan needs BOTH rules inside the capture; a
  // long enough parked message pushes the top rule out and the pane reads
  // 'idle'. These two assertions are the reason paneRemedy cannot be built on
  // parkedInputText() alone -- they pin the upstream behaviour we work around,
  // so if it is ever fixed upstream this test says so instead of going quiet.
  it('detectPaneState flips typing -> idle once the box top scrolls off', () => {
    expect(detectPaneState(parkedPane(10))).toBe('typing')
    expect(parkedInputText(parkedPane(10))).not.toBeNull()

    expect(detectPaneState(parkedPane(30))).toBe('idle')
    expect(parkedInputText(parkedPane(30))).toBeNull()
  })

  it('reports that it cannot tell, rather than inheriting the idle answer', () => {
    // wrap 22: the box top is gone but the prompt line survives -- the band
    // where the contradiction is visible and 'idle' is a lie.
    const v = paneRemedy(parkedPane(22))
    expect(v.remedy).toBe('read-the-pane')
    expect(v.remedy).not.toBe('none')
    expect(v.why).toMatch(/not fully inside the capture/)
  })

  // THE DOCUMENTED LIMIT, PINNED SO IT CANNOT BE MISTAKEN FOR COVERAGE. Past
  // wrap 22 the prompt line scrolls off too and NOTHING in the capture says the
  // box holds anything. 'none' here is not a pass -- it is this predicate
  // failing, on purpose and in the open. Widening the capture is the only fix
  // and it is not this predicate's to make.
  it('goes blind once the prompt line itself scrolls off, and the docblock says so', () => {
    expect(paneRemedy(parkedPane(30)).remedy).toBe('none')
  })
})

describe('formatStuckSessionAlert: the remedy reaches the reader', () => {
  const call = (p: string | null, state: Parameters<typeof formatStuckSessionAlert>[5] = null) =>
    formatStuckSessionAlert('computress', 'marveen', 'agent-computress', 90 * 60000, 2, state, p)

  it('a parked pane is tagged [input-parked] and names the one keystroke', () => {
    const a = call(parkedPane(4))!
    expect(a).toContain('[input-parked]')
    expect(a).toContain('ONE Enter')
    // The old text sent the reader to diagnose a stall. That is the defect.
    expect(a).not.toContain('delivery-stall diagnosis')
  })

  it('a working pane never goes out as [approval-needed]', () => {
    // A permission prompt rendered WHILE a turn is live: the 2026-09-05 15:46
    // false positive. Busy evidence must win.
    const p = [
      '✻ Thinking… (17s · ↓ 71.4k tokens · esc to interrupt)',
      ' Do you want to proceed?',
      ' ❯ 1. Yes',
      '   2. No',
      '',
      ' Esc to cancel · Tab to amend',
    ].join('\n')
    const a = call(p)!
    expect(a).not.toContain('[approval-needed]')
    expect(a).toContain('WORKING')
  })

  it('a genuine permission prompt with nothing running still asks a person', () => {
    expect(call(PERMISSION_PANE)!).toContain('[approval-needed]')
  })

  it('an unreadable capture says so instead of saying idle', () => {
    const a = call(parkedPane(22))!
    expect(a).toContain('does NOT settle')
    expect(a).not.toContain('[input-parked]')
  })

  it('the empty-box case keeps the existing generic text', () => {
    expect(call(EMPTY_PANE)!).toContain('delivery-stall diagnosis')
  })

  it('an explicitly busy paneState still short-circuits first, unchanged', () => {
    expect(call(WORKING_PANE, 'busy')!).toContain('BUSY (actively working')
  })
})
