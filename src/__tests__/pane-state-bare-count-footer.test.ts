import { describe, it, expect } from 'vitest'
import { detectPaneState } from '../pane-state.js'

// Card 53521828 phase 2, measured 2026-10-30: a 4-hour tmux sample read 238 of the main agent's
// idle frames 'unknown'. Every one ended on a footer with the background count and no action
// tail (`· 1 shell`, no `· ↓ to manage`), under a custom status line. The shape below is those
// frames', the text is synthetic. Upstream's own fixtures for this form are in pane-state.test.ts.

const SEP = '─'.repeat(80)
const NAMED_SEP = `${'─'.repeat(70)} Marveen ─`
const STATUS = '  Opus 5.5 | ctx 11% | 5h 4% | 7d 53%'
const BARE = '  ⏵⏵ bypass permissions on · 1 shell'

const pane = (opts: { footer?: string; box?: string; after?: string[]; above?: string[] } = {}): string => [
  ...(opts.above ?? []),
  '  A 08:45-ös ébresztő be van állítva.',
  '✻ Sautéed for 31s · done 7:34 · 1 shell still running',
  NAMED_SEP,
  `❯ ${opts.box ?? ''}`,
  SEP,
  STATUS,
  opts.footer ?? BARE,
  ...(opts.after ?? []),
].join('\n')

describe('a footer that ends on the background count is the idle footer (card 53521828)', () => {
  it('the measured shape reads idle', () => {
    expect(detectPaneState(pane())).toBe('idle')
  })

  it.each([
    '  ⏵⏵ bypass permissions on · 3 shells',
    '  ⏵⏵ bypass permissions on · 2 shells, 1 monitor',
    '  ⏵⏵ accept edits on · 1 monitor',
  ])('other counts read idle too: %s', (footer) => {
    expect(detectPaneState(pane({ footer }))).toBe('idle')
  })

  it('the same footer quoted in scrollback does not make a footer-less pane idle', () => {
    const p = [
      '  Seen in the log: ⏵⏵ bypass permissions on · 1 shell',
      '✻ Sautéed for 31s',
      NAMED_SEP,
      '❯ ',
      SEP,
    ].join('\n')
    expect(detectPaneState(p)).not.toBe('idle')
  })

  it('an open dialog under an old bare footer is not idle', () => {
    const p = pane({ after: [' Do you want to proceed?', ' ❯ 1. Yes', '   2. No'] })
    expect(detectPaneState(p)).not.toBe('idle')
  })

  it('a count followed by an unknown tail is not the bare form', () => {
    // Anchored at the line end: an unrecognised tail stays unread, the safe side.
    expect(detectPaneState(pane({ footer: '  ⏵⏵ bypass permissions on · 1 shell · something new' }))).not.toBe('idle')
  })
})
