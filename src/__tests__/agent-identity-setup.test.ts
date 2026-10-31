import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  identityAttemptResult,
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

  it('never presses an extra Enter on FOREIGN parked text that shows up after its own Enter', async () => {
    const events: string[] = []
    let reads = 0
    const res = await submitOwnSlashCommand('/rename Dexter', {
      typeLiteral: () => events.push('type'),
      pressEnter: () => events.push('enter'),
      readParked: () => (reads++ === 0 ? null : 'someone else typed this'),
      delay: async () => undefined,
    })
    expect(res).toBe('submitted')
    expect(events).toEqual(['type', 'enter'])
  })

  // Card c91a1989 (store/dashboard.log 2026-10-26): computress's directive 10001251 sat parked
  // from 07:44:12; the /rename typed onto it at 07:44:24 and one Enter submitted both.
  it('types NOTHING onto a box that already holds parked text', async () => {
    const events: string[] = []
    let cleared = 0
    const res = await submitOwnSlashCommand('/rename Computress', {
      typeLiteral: () => events.push('type'),
      pressEnter: () => events.push('enter'),
      readParked: () => '[SYSTEM-DIREKTIVA msg_id:10001251 -- vegrehajtas elott hitelesitsd',
      delay: async () => undefined,
      clearOwnLine: async () => { cleared++; return true },
    })
    expect(res).toBe('foreign-parked')
    expect(events).toEqual([])
    expect(cleared).toBe(0)
  })

  it('clears its OWN line when it would not submit, so no later writer pastes onto it', async () => {
    const p = fakePane(Number.POSITIVE_INFINITY)
    let cleared = 0
    const res = await submitOwnSlashCommand('/rename Dexter', {
      ...p.deps,
      clearOwnLine: async () => { cleared++; p.events.push('clear'); return true },
    })
    expect(res).toBe('cleared-own')
    expect(cleared).toBe(1)
    expect(p.events.at(-1)).toBe('clear')
    expect(p.events.filter((e) => e === 'enter')).toHaveLength(1 + IDENTITY_SUBMIT_MAX_EXTRA_ENTERS)
  })

  it('a refused or unverified clear stays still-parked (the caller logs it)', async () => {
    const p = fakePane(Number.POSITIVE_INFINITY)
    const res = await submitOwnSlashCommand('/rename Dexter', { ...p.deps, clearOwnLine: async () => false })
    expect(res).toBe('still-parked')
  })

  it('never clears a line where foreign text joined its own command', async () => {
    let cleared = 0
    let reads = 0
    const res = await submitOwnSlashCommand('/rename Dexter', {
      typeLiteral: () => undefined,
      pressEnter: () => undefined,
      readParked: () => (reads++ === 0 ? null : '/rename Dexter[Uzenet @marveen-tol]: half a message'),
      delay: async () => undefined,
      clearOwnLine: async () => { cleared++; return true },
    })
    expect(res).toBe('still-parked')
    expect(cleared).toBe(0)
  })
  // Card 9c182807 (trillian 2026-10-14 18:11:50): `tmux send-keys Enter` threw (SIGABRT), and the
  // throw skipped the re-read, so the command stayed parked. A throwing Enter is a missed Enter.
  it('an Enter that THROWS is retried through the same re-read, not abandoned', async () => {
    const p = fakePane(2)
    let first = true
    const pressEnter = p.deps.pressEnter
    p.deps.pressEnter = () => {
      if (first) { first = false; p.events.push('enter-threw'); throw new Error('Command failed: tmux send-keys -t agent-trillian Enter (signal SIGABRT)') }
      pressEnter()
    }
    expect(await submitOwnSlashCommand('/rename Trillian', p.deps)).toBe('submitted')
    expect(p.events).toEqual(['type:/rename Trillian', 'enter-threw', 'enter', 'enter'])
  })

  it('an Enter that always throws ends as still-parked (the caller logs it), not as a throw', async () => {
    const p = fakePane(1)
    p.deps.pressEnter = () => { throw new Error('tmux gone') }
    expect(await submitOwnSlashCommand('/rename Trillian', p.deps)).toBe('still-parked')
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

// didi 49996 F3: the success line used to sit next to the outcomes behind a flag no test reached.
describe('identityAttemptResult', () => {
  it('a submitted command is the only success', () => {
    expect(identityAttemptResult(['submitted'])).toEqual({ retry: false, level: 'info', message: 'Set session /rename' })
  })

  it('a parked box (foreign text, or our own line we cleared) retries and never logs success', () => {
    for (const o of ['foreign-parked', 'cleared-own'] as const) {
      const r = identityAttemptResult(['submitted', o])
      expect(r.retry).toBe(true)
      expect(r.message).not.toBe('Set session /rename')
    }
  })

  it('a line that stayed parked is a loud non-success, not a retry', () => {
    expect(identityAttemptResult(['still-parked'])).toEqual({ retry: false, level: 'warn', message: 'Identity /rename NOT confirmed -- its line stayed parked' })
  })

  it('no command sent is not a success', () => {
    expect(identityAttemptResult([]).level).toBe('warn')
  })

  it('the success line is written only through identityAttemptResult', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')
    expect(src.match(/'Set session \/rename'/g) ?? []).toHaveLength(1)
    expect(src).toContain('logger[result.level]({ session, displayName, attempt }, result.message)')
  })
})
