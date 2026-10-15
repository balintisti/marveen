import { describe, it, expect } from 'vitest'
import {
  detectPaneState,
  detectPermissionMode,
  detectsPermissionDialog,
  detectsThinkingBlockError,
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
// The idle footer cut INSIDE its parenthesis: the other separator the truncated tail accepts.
const TRUNCATED_PAREN_IDLE_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cyc…'

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

  it('an idle footer cut inside its parenthesis is still the footer (empty box idle, text typing)', () => {
    expect(detectPaneState(pane({ footer: TRUNCATED_PAREN_IDLE_FOOTER, spinner: false, agents: 9 }))).toBe('idle')
    expect(detectPaneState(pane({ footer: TRUNCATED_PAREN_IDLE_FOOTER, box: QUEUED, spinner: false, agents: 9 }))).toBe('typing')
    expect(detectPermissionMode(pane({ footer: TRUNCATED_PAREN_IDLE_FOOTER, spinner: false, agents: 3 })))
      .toBe('bypass permissions')
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

// didi, card f0ca2dc1, 2026-10-15: the first version matched the truncated tail anywhere in the
// pane. A clipped footer left in the scrollback, or prose ending in `on · ...…`, then hid an open
// permission dialog (permDialog false, state idle), and a delivery could type into `❯ 1. Yes`.
// The dialog lines are the live capture's (pane-permission-prompt.test.ts, agent-dexter 09-03).
const DIALOG = [
  ' │ grep on \'src/forms/submission.service.ts\' after a cd would search a',
  ' │ directory that cannot be determined here; only you can approve running it anyway.',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. No',
  '',
  ' Esc to cancel · Tab to amend',
]
const CLIPPED_IN_SCROLLBACK = '  ⏵⏵ bypass permissions on · 3 shells, 2 monitors · ↓ to m…'
const PROSE_ENDING_LIKE_A_TAIL = 'the guard stays on · see the report on the card…'

describe('a truncated footer counts only under the live box (didi, f0ca2dc1)', () => {
  it.each([
    ['a clipped footer in the scrollback', ['  ⎿  done', CLIPPED_IN_SCROLLBACK, '', ...DIALOG]],
    ['prose ending like a truncated tail', [PROSE_ENDING_LIKE_A_TAIL, '', ...DIALOG]],
    // A whole old box with its clipped footer above a dialog drawn without a separator.
    ['an old box with its clipped footer', [NAMED_SEP, '❯ ', SEP, CLIPPED_IN_SCROLLBACK, '', ...DIALOG]],
    // A dialog that opens with a separator line, the tail-like line right under it.
    ['a tail-like line under a dialog border', [NAMED_SEP, '❯ ', SEP, '', SEP, PROSE_ENDING_LIKE_A_TAIL, ...DIALOG]],
  ])('%s does not hide an open permission dialog', (_name, lines) => {
    const p = (lines as string[]).join('\n')
    expect(detectsPermissionDialog(p)).toBe(true)
    expect(detectPaneState(p)).not.toBe('idle')
    expect(detectPermissionMode(p)).toBeNull()
  })

  // Two separator lines with no prompt between them are not an input box (a Markdown-style rule
  // pair in the output), so a tail-like line under them is not a footer.
  it('a separator pair without a prompt line is not the input box', () => {
    const p = [SEP, ' Summary', SEP, PROSE_ENDING_LIKE_A_TAIL].join('\n')
    expect(detectPaneState(p)).toBe('unknown')
    expect(detectPermissionMode(p)).toBeNull()
  })

  // Control: the same dialog with no tail-like line anywhere.
  it('the bare dialog is a dialog', () => {
    expect(detectsPermissionDialog(DIALOG.join('\n'))).toBe(true)
  })

  // The live position still counts with a panel under it (the f5bb2626 case), and a line that
  // is not directly under the box does not. The paren-cut footer, because TRUNCATED_IDLE_FOOTER
  // still carries `← for agents` and so matches the full form wherever it stands.
  it('counts only within the footer lines under the last box separator', () => {
    expect(detectPaneState(pane({ footer: TRUNCATED_PAREN_IDLE_FOOTER, spinner: false, agents: 25 }))).toBe('idle')
    const lowered = [NAMED_SEP, '❯ ', SEP, '', '', '', TRUNCATED_PAREN_IDLE_FOOTER].join('\n')
    expect(detectPaneState(lowered)).not.toBe('idle')
  })
})

// didi 35742 (LOW, @8b8865245): three readings the cases above did not pin.
describe('the truncated footer in the other readers (didi 35742)', () => {
  // M6: detectsThinkingBlockError finds its footer through lastIdleFooterIndex, so the wedged
  // error must still be seen when the live footer is the truncated one.
  it('a thinking-block error above a truncated footer is still the error', () => {
    const p = [
      '  ⎿  API Error: 400 messages.55.content.19: `thinking` or `redacted_thinking` blocks in the latest assistant message',
      '      cannot be modified. These blocks must remain as they were in the original response.',
      '',
      '✻ Sauteed for 1s',
      '',
      NAMED_SEP,
      '❯ ',
      SEP,
      TRUNCATED_PAREN_IDLE_FOOTER,
      ...panel(9),
    ].join('\n')
    expect(detectsThinkingBlockError(p)).toBe(true)
  })

  // M8: the ellipsis ends the truncated footer. A line under the box where text goes on after
  // it is something else, and the pane is not idle because of it.
  it('a line whose text goes on after the ellipsis is not a footer', () => {
    const p = [NAMED_SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on · 3 shells… and the build went on'].join('\n')
    expect(detectPaneState(p)).not.toBe('idle')
  })

  // Item 3: a dialog drawn under the old footer, without the `❯` cursor the check knew. Each
  // case carries only ONE of the two dialog signs, so each sign is pinned on its own.
  it.each([
    ['a `>` cursor, no question', [' Allow this edit', ' > 1. Yes', '   2. No', ' Esc to cancel · Tab to amend']],
    ['a question, no cursor', [' Do you want to proceed?', '  1. Yes', '  2. No']],
  ])('%s under the truncated footer is still a dialog', (_name, dialog) => {
    const p = [NAMED_SEP, '❯ hi', SEP, TRUNCATED_PAREN_IDLE_FOOTER, ...(dialog as string[])].join('\n')
    expect(detectsPermissionDialog(p)).toBe(true)
    expect(detectPaneState(p)).not.toBe('idle')
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

// The interrupting keys themselves are covered by BEHAVIOUR tests (what is actually typed into a
// stubbed tmux): live-turn-keys-refused, live-turn-placeholder-resend, live-turn-stuck-recovery.
// The source-order checks that stood here let 8 of 11 mutants survive (didi 27204 D).
