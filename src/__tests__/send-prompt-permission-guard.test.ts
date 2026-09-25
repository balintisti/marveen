/**
 * NO MACHINE DELIVERY ANSWERS A TOOL-PERMISSION PROMPT -- card 2a8cb07f, didi's review 18764.
 *
 * The first version guarded the two stuck-input recovery Enters. didi walked every `send-keys ...
 * Enter` in src/ and found the coordinator's inbox wakeup typing text + Enter into a NOT-ready pane
 * (waitForIdle:false) -- and a permission prompt IS a not-ready pane, with "1. Yes" preselected.
 * The guard now sits inside sendPromptToSession, before the FIRST keystroke, so every caller is
 * covered. Drives the real function with `node:child_process` stubbed: every tmux call is seen.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  /** what a RAW capture (`capture-pane -p`, no -e) returns -- the guard reads this */
  raw: ((_sentEnter: boolean) => '') as (sentEnter: boolean) => string,
  /** what a colour capture (`-e`) returns -- the post-send follow-up loop reads this */
  colour: ((_sentEnter: boolean) => '') as (sentEnter: boolean) => string,
  keys: [] as string[][],
}))

vi.mock('node:child_process', () => ({
  execSync: vi.fn((cmd: string) => (String(cmd).startsWith('which ') ? '/usr/bin/stub\n' : '')),
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
  execFileSync: vi.fn((_file: string, args: string[]) => {
    const a = args.map(String)
    const sentEnter = h.keys.some((k) => k[k.length - 1] === 'Enter')
    if (a.includes('capture-pane')) return a.includes('-e') ? h.colour(sentEnter) : h.raw(sentEnter)
    if (a.includes('send-keys')) h.keys.push(a.slice(a.indexOf('send-keys') + 1))
    return ''
  }),
}))

const { sendPromptToSession, sendEnterToSession } = await import('../web/agent-process.js')

const PERMISSION_PANE = [
  ' Bash command',
  '   cd "$API" && npx tsc -b 2>&1 | tail -3',
  '',
  ' Do you want to proceed?',
  ' ❯ 1. Yes',
  '   2. Yes, and don\'t ask again for this command',
  '   3. No, and tell Claude what to do differently (esc)',
  '',
  ' Esc to cancel · Tab to amend',
].join('\n')
const IDLE_PANE = ['╭────────────╮', '│ >          │', '╰────────────╯', '  ? for shortcuts'].join('\n')
// decideSubmitFollowup reads this as 'clear-and-resend' (checked against the real function)
const PLACEHOLDER_PANE = ['╭────────────────────────────────╮', '│ > [Pasted text #1 +2 lines]    │', '╰────────────────────────────────╯', '  ? for shortcuts'].join('\n')

const WAKEUP = '[inbox-wakeup: pending inter-agent messages]'
const send = (session: string, text = WAKEUP) => sendPromptToSession(session, text, null, {
  waitForIdle: false, survival: 'redelivered', survivalReason: 'test',
})

describe('sendPromptToSession never types into a tool-permission prompt (2a8cb07f)', () => {
  beforeEach(() => { h.keys.length = 0 })

  it("didi's path: a permission prompt on screen -> withheld, and NOT ONE key is sent", async () => {
    h.raw = () => PERMISSION_PANE
    h.colour = () => PERMISSION_PANE
    expect(await send('agent-perm-1')).toBe('withheld-permission')
    // not the text, not the Enter, not a clear -- any key could answer the menu
    expect(h.keys).toEqual([])
  })

  it('CONTROL: a ready pane still gets the text and the Enter', async () => {
    h.raw = () => IDLE_PANE
    h.colour = () => IDLE_PANE
    expect(await send('agent-perm-2')).toBe('sent')
    expect(h.keys.some((k) => k.includes('-l'))).toBe(true)
    expect(h.keys.some((k) => k[k.length - 1] === 'Enter')).toBe(true)
  })

  it('a prompt that appears AFTER the send stops the follow-up keys (no Ctrl-C, no resend)', async () => {
    // before the first Enter the pane is ready; after it, the delivered line started a turn that
    // asks for a tool -- while the follow-up loop still sees a parked placeholder to clear
    h.raw = (sentEnter) => (sentEnter ? PERMISSION_PANE : IDLE_PANE)
    h.colour = (sentEnter) => (sentEnter ? PLACEHOLDER_PANE : IDLE_PANE)
    expect(await send('agent-perm-3')).toBe('withheld-permission')
    const afterFirstEnter = h.keys.slice(h.keys.findIndex((k) => k[k.length - 1] === 'Enter') + 1)
    expect(afterFirstEnter).toEqual([])
  })

  it('CONTROL for the above: without the prompt, the same parked placeholder IS cleared and resent', async () => {
    h.raw = () => IDLE_PANE
    let colourCalls = 0
    // two reads see the stub: the follow-up loop's (-> clear-and-resend) and the discard's (-> Ctrl-C)
    h.colour = (sentEnter) => (sentEnter && colourCalls++ < 2 ? PLACEHOLDER_PANE : IDLE_PANE)
    expect(await send('agent-perm-4')).toBe('sent')
    const afterFirstEnter = h.keys.slice(h.keys.findIndex((k) => k[k.length - 1] === 'Enter') + 1)
    expect(afterFirstEnter.some((k) => k.includes('C-c'))).toBe(true)
  })

  it('an unreadable pane is withheld too (fail-closed, like the recovery Enters)', async () => {
    h.raw = () => { throw new Error('capture failed') }
    h.colour = () => IDLE_PANE
    expect(await send('agent-perm-5')).toBe('withheld-permission')
    expect(h.keys).toEqual([])
  })
})

describe('sendEnterToSession, the other shared bare-Enter path, asks the same guard', () => {
  beforeEach(() => { h.keys.length = 0 })

  it('a permission prompt on screen -> false, and no Enter', () => {
    h.raw = () => PERMISSION_PANE
    expect(sendEnterToSession('agent-perm-6')).toBe(false)
    expect(h.keys).toEqual([])
  })

  it('CONTROL: a pane without the prompt gets its Enter', () => {
    h.raw = () => IDLE_PANE
    expect(sendEnterToSession('agent-perm-7')).toBe(true)
    expect(h.keys).toEqual([['-t', 'agent-perm-7', 'Enter']])
  })
})
