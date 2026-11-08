// The post-send follow-up must see a prompt parked in a WRAPPED box (card b1f0011b).
//
// Measured on didi's 2026-11-08 22:01 capture (80 columns): the context guard's
// resume directive sat in a 6-row box, and only its TAIL was visible (the TUI
// scrolls a long box). The follow-up looked for the first 96 chars verbatim, so it
// read 'done'. Even the tail did not match verbatim: every row break is a newline
// plus a two-space indent. Both are fixed: head AND tail hints, compared with the
// whitespace removed. And a multi-row box gets no key from this loop (a bare Enter
// inserts a newline there): it is named 'parked-multirow' and left to the
// stuck-input recovery.

import { describe, it, expect } from 'vitest'
import { decideSubmitFollowup, shouldRetrySubmit } from '../pane-state.js'

const SEP = '─'.repeat(80)
const FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'

// didi's box, verbatim from measurements/b1f0011b/20261108-220153-agent-didi-start+025s.txt
// (ANSI stripped; the glyph is followed by a no-break space, as captured).
const DIDI_BOX_ROWS = [
  '❯ 400-at kap -- az ilyen tételt PUT /api/messages/<id>',
  '  {"status":"done","result":"[RESTART-ABLAK] felvéve a friss',
  '  sessionben","notify":false} zárja, ez a nyoma. KORLÁT: a futó prod fán (a',
  '  repo fő checkoutján) NE válts ágat, NE commitolj és NE nyiss belőle PR-t --',
  '  ha repo-munka kell, használj worktree-t (git worktree add). Röviden jelezz a',
  '  csatornádon, hogy friss kontextussal folytatod.',
]
const DIDI_PANE = [
  "  tmux focus-events off · add 'set -g focus-events on' to ~/.tmux.conf and re…",
  SEP,
  ...DIDI_BOX_ROWS,
  '',
  SEP,
  FOOTER,
].join('\n')
// What was typed: a long directive whose head scrolled out of the box. The visible
// part is the box text with the wrap folded back into single spaces.
const VISIBLE = DIDI_BOX_ROWS.map((r) => r.replace(/^❯ /, '').trim()).join(' ')
const PROMPT = '[SYSTEM-DIREKTIVA msg_id:10011693 -- vegrehajtas elott hitelesitsd] [CONTEXT-GUARD] Friss kontextussal indultál. ' +
  'KIVÉTEL: a "system" feladó nem ágens, neki küldött nyugta ' + VISIBLE
const HEAD = PROMPT.slice(0, 96)
const TAIL = PROMPT.slice(-96)

describe('submit follow-up on a wrapped, partly scrolled box (didi 2026-11-08 22:01)', () => {
  it('the head alone does not see it (it scrolled off): this is the blind spot', () => {
    expect(shouldRetrySubmit(DIDI_PANE, HEAD)).toBe(false)
    expect(decideSubmitFollowup(DIDI_PANE, HEAD, 0, 4)).toBe('done')
  })

  it('the tail sees it across the wrap', () => {
    expect(shouldRetrySubmit(DIDI_PANE, TAIL)).toBe(true)
  })

  it('head + tail: named parked-multirow, no key pressed by this loop, at any attempt below the cap', () => {
    expect(decideSubmitFollowup(DIDI_PANE, [HEAD, TAIL], 0, 4)).toBe('parked-multirow')
    expect(decideSubmitFollowup(DIDI_PANE, [HEAD, TAIL], 3, 4)).toBe('parked-multirow')
    expect(decideSubmitFollowup(DIDI_PANE, [HEAD, TAIL], 4, 4)).toBe('give-up')
  })

  it('a wrapped box whose head IS visible: the head now matches across the wrap too', () => {
    const typed = 'Please re-run the batch gate on the new merge base and post the summary line on the card, thanks.'
    const pane = ['', SEP, '❯ Please re-run the batch gate on the new merge base and post the summary', '  line on the card, thanks.', SEP, FOOTER].join('\n')
    expect(decideSubmitFollowup(pane, [typed.slice(0, 96), typed.slice(-96)], 0, 4)).toBe('parked-multirow')
  })

  it('a single-row parked prompt still gets the retry Enter', () => {
    const typed = 'ack: the dashboard restart finished, resuming the census now'
    const pane = ['', SEP, `❯ ${typed}`, SEP, FOOTER].join('\n')
    expect(decideSubmitFollowup(pane, [typed.slice(0, 96), typed.slice(-96)], 0, 4)).toBe('retry-enter')
  })

  it('no false match: a draft that is not the prompt, and a hint that is only whitespace', () => {
    const draft = ['', SEP, '❯ my own half-written note about the census, not sent yet', SEP, FOOTER].join('\n')
    expect(decideSubmitFollowup(draft, [HEAD, TAIL], 0, 4)).toBe('done')
    expect(shouldRetrySubmit(DIDI_PANE, ' '.repeat(40))).toBe(false)
  })

  it('an empty hint list falls back to the placeholder path only', () => {
    expect(decideSubmitFollowup(DIDI_PANE, [], 0, 4)).toBe('done')
  })
})
