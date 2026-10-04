/**
 * THE PLACEHOLDER RECOVERY DOES NOT PRESS Ctrl-C BEHIND A RUNNING TURN -- card f5bb2626, didi 27204.
 *
 * Measured on the real decideSubmitFollowup: a `[Pasted text #N]` stub under a footer that says
 * `esc to interrupt`, with six background-agent rows below it, decides 'clear-and-resend' -- an
 * ordinary pane of a busy agent, not a contrived one. The discard's Ctrl-C would interrupt that
 * turn. Two moments to cover: the turn is already visible when the follow-up decides (the loop
 * stops), and it starts between the decision and the discard (the discard refuses, and the loop
 * must not resend on top of the stub that is still there -- that would type the prompt twice).
 *
 * Drives the real sendPromptToSession with `node:child_process` stubbed, like
 * send-prompt-permission-guard.test.ts: every tmux call is seen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  /** what a RAW capture (no -e) returns -- the permission guard reads this */
  raw: (() => '') as () => string,
  /** what a colour capture (-e) returns; n = how many colour captures came after the first Enter */
  colour: ((_sentEnter: boolean, _n: number) => '') as (sentEnter: boolean, n: number) => string,
  colourAfterEnter: 0,
  keys: [] as string[][],
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => (String(cmd).startsWith('which ') ? '/usr/bin/stub\n' : '')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  execFileSync: vi.fn((_file: string, args: string[]) => {
    const a = args.map(String)
    const sentEnter = h.keys.some((k) => k[k.length - 1] === 'Enter')
    if (a.includes('capture-pane')) {
      if (!a.includes('-e')) return h.raw()
      return h.colour(sentEnter, sentEnter ? h.colourAfterEnter++ : -1)
    }
    if (a.includes('send-keys')) h.keys.push(a.slice(a.indexOf('send-keys') + 1))
    return ''
  }),
}))

const { sendPromptToSession } = await import('../web/agent-process.js')
const { decideSubmitFollowup, liveTurnFooterVisible } = await import('../pane-state.js')

const SEP = '─'.repeat(80)
const PANEL = ['', '  ⏺ main', ...[0, 1, 2, 3, 4, 5].map((i) => `  ◯ general-purpose  Checking row ${i}…  3h 53m`)]
const STUB = '❯ [Pasted text #1 +2 lines]'
const PH_LIVE = ['', SEP, STUB, SEP, '  ⏵⏵ bypass permissions on · 3 shells · esc to interrupt · ↓ to manage', ...PANEL].join('\n')
const PH_IDLE = ['', SEP, STUB, SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')
const EMPTY_IDLE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')

const WAKEUP = '[inbox-wakeup: pending inter-agent messages]'
const send = (session: string) => sendPromptToSession(session, WAKEUP, null, {
  waitForIdle: false, survival: 'redelivered', survivalReason: 'test',
})
const ctrlC = () => h.keys.filter((k) => k.includes('C-c'))
const typed = () => h.keys.filter((k) => k.includes('-l'))

describe('the paste-placeholder recovery behind a running turn (f5bb2626)', () => {
  beforeEach(() => {
    h.keys.length = 0
    h.colourAfterEnter = 0
    h.raw = () => EMPTY_IDLE
  })

  it('PRECONDITION: the real follow-up decision picks clear-and-resend on the live pane', () => {
    expect(decideSubmitFollowup(PH_LIVE, WAKEUP.slice(0, 96), 0, 3)).toBe('clear-and-resend')
    expect(liveTurnFooterVisible(PH_LIVE)).toBe(true)
    expect(decideSubmitFollowup(PH_IDLE, WAKEUP.slice(0, 96), 0, 3)).toBe('clear-and-resend')
    expect(liveTurnFooterVisible(PH_IDLE)).toBe(false)
  })

  it('the turn is visible when the follow-up decides: no Ctrl-C, typed once', async () => {
    h.colour = (sentEnter) => (sentEnter ? PH_LIVE : EMPTY_IDLE)
    expect(await send('agent-ph-1')).toBe('sent')
    expect(ctrlC()).toEqual([])
    expect(typed()).toHaveLength(1)
  })

  it('the turn starts between the decision and the discard: no Ctrl-C, and NOT typed a second time', async () => {
    // 1st colour capture after Enter = the follow-up loop's (idle stub -> clear-and-resend),
    // 2nd = the discard's own re-check (the turn is now running)
    h.colour = (sentEnter, n) => (!sentEnter ? EMPTY_IDLE : n === 0 ? PH_IDLE : PH_LIVE)
    expect(await send('agent-ph-2')).toBe('sent')
    expect(ctrlC()).toEqual([])
    expect(typed()).toHaveLength(1)
  })

  it('CONTROL: an idle stub IS discarded with Ctrl-C and the prompt resent', async () => {
    h.colour = (sentEnter, n) => (sentEnter && n < 2 ? PH_IDLE : EMPTY_IDLE)
    expect(await send('agent-ph-3')).toBe('sent')
    expect(ctrlC().length).toBeGreaterThan(0)
    expect(typed()).toHaveLength(2)
  })
})
