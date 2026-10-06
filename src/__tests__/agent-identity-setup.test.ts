import { describe, it, expect } from 'vitest'
import {
  identitySlashCommands,
  submitOwnSlashCommand,
  sendRecoveryBriefWhenIdle,
  IDENTITY_SUBMIT_MAX_EXTRA_ENTERS,
  RECOVERY_BRIEF_BUSY_RETRIES,
} from '../web/agent-process.js'

// Locks the identity slash commands sent on every Claude Code session
// (re)start -- both the normal startup and the channel-monitor recovery
// respawns route through scheduleIdentitySetup, which uses these. Only `/rename`
// is sent now; `/remote-control` was dropped (the operator no longer uses it).
//
// The `/name` case below is not a style assertion. `/name` is not a Claude Code
// command -- the CLI answers "Unknown command: /name. Did you mean /rename?" and
// leaves the rejected line PARKED in the input box, where it lands only when the
// current turn ends. A parked input line makes the router read the session as
// busy, so inter-agent messages stop being delivered and the channel goes quiet
// with no error. The previous version of this test asserted `/name`, which is
// why CI stayed green while no session was ever renamed.
describe('identitySlashCommands', () => {
  it('returns just /rename with the display name', () => {
    expect(identitySlashCommands('Zoé')).toEqual(['/rename Zoé'])
  })

  it('never sends /name -- there is no such Claude Code command', () => {
    expect(identitySlashCommands('Zoé').some((c) => c.startsWith('/name'))).toBe(false)
  })

  it('does not send /remote-control', () => {
    expect(identitySlashCommands('Mr. Wolf').some((c) => c.includes('/remote-control'))).toBe(false)
  })
})

// Card e9f66084 (measured 2026-10-06 on computress and dexter): the /rename was
// left PARKED (its Enter did not submit), and the recovery brief was then pasted
// onto that line and submitted with it -- the brief became the session title.
function fakePane(enterSubmitsOnPress: number) {
  const events: string[] = []
  let box = ''
  let presses = 0
  return {
    events,
    deps: {
      typeLiteral: (t: string) => { box += t; events.push(`type:${t}`) },
      pressEnter: () => {
        presses++
        events.push('enter')
        if (presses >= enterSubmitsOnPress) box = ''
      },
      readParked: () => (box.length > 0 ? box : null),
      delay: async () => undefined,
    },
  }
}

describe('submitOwnSlashCommand', () => {
  it('types the command and presses Enter separately, once, when the first Enter lands', async () => {
    const p = fakePane(1)
    expect(await submitOwnSlashCommand('/rename Dexter', p.deps)).toBe('submitted')
    expect(p.events).toEqual(['type:/rename Dexter', 'enter'])
  })

  it('presses Enter again while its own command is still parked (the 10-06 case)', async () => {
    const p = fakePane(2)
    expect(await submitOwnSlashCommand('/rename Dexter', p.deps)).toBe('submitted')
    expect(p.events.filter((e) => e === 'enter')).toHaveLength(2)
  })

  it('gives up after the bounded extra Enters and SAYS so', async () => {
    const p = fakePane(Number.POSITIVE_INFINITY)
    expect(await submitOwnSlashCommand('/rename Dexter', p.deps)).toBe('still-parked')
    expect(p.events.filter((e) => e === 'enter')).toHaveLength(1 + IDENTITY_SUBMIT_MAX_EXTRA_ENTERS)
  })

  it('never presses an extra Enter on FOREIGN parked text', async () => {
    const events: string[] = []
    const res = await submitOwnSlashCommand('/rename Dexter', {
      typeLiteral: () => events.push('type'),
      pressEnter: () => events.push('enter'),
      readParked: () => 'someone else typed this',
      delay: async () => undefined,
    })
    expect(res).toBe('submitted')
    expect(events).toEqual(['type', 'enter'])
  })
})

describe('sendRecoveryBriefWhenIdle', () => {
  it('sends once when the pane is idle', async () => {
    const calls: string[] = []
    const res = await sendRecoveryBriefWhenIdle('s', 'brief', async (_s, t) => { calls.push(t); return 'sent' as const }, async () => undefined)
    expect(res).toBe('sent')
    expect(calls).toHaveLength(1)
  })

  it('retries on aborted-busy instead of pasting, then delivers', async () => {
    const results = ['aborted-busy', 'aborted-busy', 'sent'] as const
    let i = 0
    const res = await sendRecoveryBriefWhenIdle('s', 'brief', async () => results[i++], async () => undefined)
    expect(res).toBe('sent')
    expect(i).toBe(3)
  })

  it('gives up after the bounded retries, never forcing a send', async () => {
    let n = 0
    const res = await sendRecoveryBriefWhenIdle('s', 'brief', async () => { n++; return 'aborted-busy' as const }, async () => undefined)
    expect(res).toBe('gave-up-busy')
    expect(n).toBe(RECOVERY_BRIEF_BUSY_RETRIES)
  })
})
