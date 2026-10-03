import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectPaneState,
  detectPermissionMode,
  liveTurnFooterVisible,
  stuckInputSignature,
} from '../pane-state.js'

// Card f5bb2626, measured 2026-10-03 on didi's live pane. A long background count pushed the
// footer's action tail past the terminal width, and Claude Code cut it with `…`:
//
//     ⏵⏵ bypass permissions on · 72 shells, 2 monitors · esc to interrupt · ↓ to …
//
// IDLE_FOOTER_RX knew no truncated tail, so the pane had NO footer as far as detectPaneState
// could tell. The windows then counted from the end of the pane, where the background-agent
// panel sits, and the footer-less branch read the message queued in the box as 'typing'. The
// stuck-input recovery cleared it, Escape first, and interrupted the turn (07:37 and 09:13).
// Measured on the captured pane: queued line -> 'typing'; the same pane with the panel cut off
// -> 'busy'. The shape below is that pane's, the text is synthetic.

const SEP = '─'.repeat(80)
const NAMED_SEP = `${'─'.repeat(71)} Didi ─`
const TRUNCATED_BUSY_FOOTER = '  ⏵⏵ bypass permissions on · 72 shells, 2 monitors · esc to interrupt · ↓ to …'
const TRUNCATED_IDLE_FOOTER = '  ⏵⏵ bypass permissions on · 72 shells, 2 monitors · ← for agents · ↓ to …'

const panel = (n: number): string[] => [
  '',
  '  ⏺ main',
  ...Array.from({ length: n }, (_, i) =>
    `  ◯ general-purpose  Checking batch row ${i + 1}…  3h 53m 3s · ↓ 220.4k tokens`),
]

const pane = (opts: { footer: string; box?: string; spinner?: boolean; agents: number }): string => [
  '  ⎿  $ git fetch -q origin',
  '     for r in fix/a fix/b; do echo $r; done',
  '',
  ...(opts.spinner === false ? [] : ['✽ Gitifying… (1m 32s · ↓ 5.4k tokens)', '']),
  NAMED_SEP,
  `❯ ${opts.box ?? ''}`,
  SEP,
  opts.footer,
  ...panel(opts.agents),
].join('\n')

const QUEUED = '[uzenet-or] new message: friday -> didi'

describe('a width-truncated footer is still the footer (card f5bb2626)', () => {
  it.each([0, 5, 9, 25])('a running turn reads busy with %i background agents, box empty', (n) => {
    expect(detectPaneState(pane({ footer: TRUNCATED_BUSY_FOOTER, agents: n }))).toBe('busy')
  })

  // The measured failure: a message queued in the box mid-turn.
  it.each([5, 9, 25])('a message queued behind a running turn is not parked input (%i agents)', (n) => {
    const p = pane({ footer: TRUNCATED_BUSY_FOOTER, box: QUEUED, agents: n })
    expect(detectPaneState(p)).toBe('busy')
    expect(stuckInputSignature(p)).toBeNull()
  })

  // Isolates the footer: no spinner, so `esc to interrupt` on the truncated line is the only
  // busy signal, and it is only seen once the line is recognised as the footer.
  it('reads busy from the truncated footer alone', () => {
    const p = pane({ footer: TRUNCATED_BUSY_FOOTER, box: QUEUED, spinner: false, agents: 9 })
    expect(detectPaneState(p)).toBe('busy')
  })

  // The other direction: the recovery still has to see a REALLY parked box on such a pane.
  it('an idle pane with a truncated footer and text in the box reads typing', () => {
    const p = pane({ footer: TRUNCATED_IDLE_FOOTER, box: QUEUED, spinner: false, agents: 9 })
    expect(detectPaneState(p)).toBe('typing')
    expect(stuckInputSignature(p)).not.toBeNull()
  })

  it('an idle pane with a truncated footer and an empty box reads idle', () => {
    expect(detectPaneState(pane({ footer: TRUNCATED_IDLE_FOOTER, spinner: false, agents: 9 }))).toBe('idle')
  })

  it('names the permission mode from a truncated footer', () => {
    expect(detectPermissionMode(pane({ footer: TRUNCATED_IDLE_FOOTER, spinner: false, agents: 3 })))
      .toBe('bypass permissions')
  })

  // A line of prose that merely ends in an ellipsis is not chrome.
  it('does not take prose ending in an ellipsis for the footer', () => {
    const prose = ['The report is on the way…', '', NAMED_SEP, '❯ ', SEP].join('\n')
    expect(detectPaneState(prose)).toBe('unknown')
  })
})

describe('liveTurnFooterVisible', () => {
  it.each([0, 9, 25])('sees the running turn under the box with %i background agents', (n) => {
    expect(liveTurnFooterVisible(pane({ footer: TRUNCATED_BUSY_FOOTER, box: QUEUED, agents: n }))).toBe(true)
  })

  it('is false on an idle footer', () => {
    expect(liveTurnFooterVisible(pane({ footer: TRUNCATED_IDLE_FOOTER, box: QUEUED, agents: 9 }))).toBe(false)
  })

  // A quote of the phrase in the scrollback is above the box, never under it.
  it('ignores `esc to interrupt` quoted in the scrollback', () => {
    const p = ['  the footer said "esc to interrupt" at 09:13', '', NAMED_SEP, `❯ ${QUEUED}`, SEP,
      TRUNCATED_IDLE_FOOTER, ...panel(9)].join('\n')
    expect(liveTurnFooterVisible(p)).toBe(false)
  })

  it('is false when no input box is on screen', () => {
    expect(liveTurnFooterVisible('esc to interrupt')).toBe(false)
  })
})

// The keys that interrupt a turn check for one first. Source-level, like parked-clear-sequence:
// these paths drive tmux directly.
describe('the interrupting keys ask first (card f5bb2626)', () => {
  const ROOT = join(__dirname, '..', '..')
  const AGENT_PROCESS = readFileSync(join(ROOT, 'src', 'web', 'agent-process.ts'), 'utf-8')
  const CHANNEL_MONITOR = readFileSync(join(ROOT, 'src', 'web', 'channel-monitor.ts'), 'utf-8')
  const body = (src: string, start: string, end: string) => {
    const from = src.indexOf(start)
    expect(from).toBeGreaterThanOrEqual(0)
    return src.slice(from, src.indexOf(end, from))
  }

  it('clearInputBuffer checks before the Escape-led sequence', () => {
    const fn = body(AGENT_PROCESS, 'export async function clearInputBuffer', '\n}\n')
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeGreaterThan(0)
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeLessThan(fn.indexOf('parkedClearSequence('))
  })

  it('discardPlaceholderBuffer checks before its Ctrl-C', () => {
    const fn = body(AGENT_PROCESS, 'async function discardPlaceholderBuffer', '\n}\n')
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeGreaterThan(0)
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeLessThan(fn.indexOf("'C-c'"))
  })

  it('the clear-and-resend follow-up stops instead of discarding behind a running turn', () => {
    const fn = body(AGENT_PROCESS, "if (action === 'clear-and-resend') {", 'await sendChunks()')
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeGreaterThan(0)
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeLessThan(fn.indexOf('discardPlaceholderBuffer('))
  })

  it('the stuck-input recovery skips its move behind a running turn', () => {
    const fn = body(CHANNEL_MONITOR, 'export async function recoverStuckInputForSession', '\n}\n')
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeGreaterThan(0)
    expect(fn.indexOf('liveTurnFooterVisible(pane)')).toBeLessThan(fn.indexOf('performStuckInputAction('))
  })
})
