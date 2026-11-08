import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Card b1f0011b. Measured 2026-11-08 17:16:47 (didi, guard restart): the fresh session drew an
// empty, idle-looking box, the resume directive was typed at +7.4s and `/rename Didi` at +14.5s,
// and the box was STILL EMPTY at +15s. Around +20s the TUI read everything as ONE burst, took it
// for a paste, and both Enters became newlines: a parked multi-row box. These tests drive the real
// probe and the real /rename lane against a fake TUI that buffers keystrokes until it "boots",
// then reads the buffer as a burst in which an Enter is a newline -- the measured behaviour.

const h = vi.hoisted(() => {
  const SEP = '─'.repeat(80)
  const IDLE_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
  type Key = { text: string } | { enter: true } | { bspace: number }
  const tui = {
    reading: true,
    // a burst may drop the BSpaces (the residue case the next probe must erase)
    burstDropsBspace: false,
    // the next N typed sentinels make the keystroke call throw (a keystroke-failed probe)
    failSentinelSends: 0,
    box: '',
    buffered: [] as Key[],
    submitted: [] as string[],
    // every box content any capture ever showed, to catch a /rename glued onto other text
    seenBoxes: [] as string[],
  }
  const apply = (k: Key, burst: boolean) => {
    if ('text' in k) tui.box += k.text
    else if ('enter' in k) {
      if (burst) tui.box += '\n'
      else { if (tui.box) tui.submitted.push(tui.box); tui.box = '' }
    } else if (!(burst && tui.burstDropsBspace)) tui.box = tui.box.slice(0, Math.max(0, tui.box.length - k.bspace))
  }
  const send = (k: Key) => { if (tui.reading) apply(k, false); else tui.buffered.push(k) }
  const startReading = () => {
    tui.reading = true
    const burst = tui.buffered.splice(0)
    for (const k of burst) apply(k, burst.length > 1)
  }
  const render = () => {
    tui.seenBoxes.push(tui.box)
    const [first, ...rest] = tui.box.split('\n')
    return ['', ' ▐▛███▛█   Claude Code v2.1.314', '', SEP, `❯ ${first}`, ...rest.map((l) => `  ${l}`), SEP, IDLE_FOOTER].join('\n')
  }
  return { tui, send, startReading, render, calls: [] as string[][] }
})

vi.mock('node:child_process', async (orig) => ({
  ...(await orig() as object),
  execFileSync: vi.fn((_file: string, args?: string[]) => {
    if (!Array.isArray(args)) return ''
    h.calls.push(args)
    if (args.includes('capture-pane')) return h.render()
    const at = args.indexOf('send-keys')
    if (at >= 0) {
      const rest = args.slice(at + 3) // drop 'send-keys', '-t', <session>
      if (rest[0] === '-l' && rest[1] === 'x' && h.tui.failSentinelSends > 0) {
        h.tui.failSentinelSends--
        throw new Error('keystroke failed (test)')
      }
      if (rest[0] === '-l') h.send({ text: rest[1] })
      else if (rest[0] === '-N' && rest[2] === 'BSpace') h.send({ bspace: Number(rest[1]) })
      else if (rest[0] === 'BSpace') h.send({ bspace: 1 })
      else if (rest[0] === 'Enter') h.send({ enter: true })
    }
    return ''
  }),
}))
vi.mock('../notify.js', () => ({ alertIsRedirected: () => false, notifyChannel: vi.fn(async () => {}), notifyTelegram: vi.fn(async () => {}) }))

import { probeInputEcho, ECHO_SENTINEL, type EchoProbeDeps } from '../web/input-echo-probe.js'
import { paneEchoesInput, scheduleIdentitySetup } from '../web/agent-process.js'
import { parkedInputText, stripGhostSuggestion } from '../pane-state.js'
import { __resetSessionSendLocks } from '../web/session-send-lock.js'

const typedTexts = () => h.calls.filter((a) => a.includes('send-keys') && a.includes('-l')).map((a) => a[a.length - 1])

beforeEach(() => {
  h.calls.length = 0
  Object.assign(h.tui, { reading: true, burstDropsBspace: false, failSentinelSends: 0, box: '', buffered: [], submitted: [], seenBoxes: [] })
  __resetSessionSendLocks()
})

describe('probeInputEcho (pure)', () => {
  const deps = (boxes: Array<string | null | undefined>, extra: Partial<EchoProbeDeps> = {}) => {
    const log: string[] = []
    let i = 0
    const d: EchoProbeDeps = {
      readBox: () => boxes[Math.min(i++, boxes.length - 1)],
      typeSentinel: () => { log.push('type') },
      backspace: (n) => { log.push(`bs${n}`) },
      permissionBlocks: () => false,
      delay: async () => undefined,
      ...extra,
    }
    return { d, log }
  }

  it('echoed: the sentinel shows up, is erased, and the box reads empty again', async () => {
    const { d, log } = deps([null, null, 'x', null])
    expect(await probeInputEcho(d)).toBe('echoed')
    expect(log).toEqual(['type', 'bs1'])
  })

  it('no-echo: the box stays empty for the whole budget; the BSpace still follows the sentinel', async () => {
    const { d, log } = deps([null])
    expect(await probeInputEcho(d, { budgetMs: 1500, pollMs: 150 })).toBe('no-echo')
    expect(log).toEqual(['type', 'bs1'])
  })

  it('foreign text in the box: nothing is typed', async () => {
    const { d, log } = deps(['Csendes heartbeat.'])
    expect(await probeInputEcho(d)).toBe('foreign-text')
    expect(log).toEqual([])
  })

  it('a late-drawn residue of our own sentinels is erased exactly and counts as an echo', async () => {
    const { d, log } = deps(['xx', null])
    expect(await probeInputEcho(d)).toBe('echoed')
    expect(log).toEqual(['bs2'])
  })

  it('left-residue: a late-drawn residue is erased but the box never empties (didi 56466 #1)', async () => {
    const { d, log } = deps(['x', 'x'])
    expect(await probeInputEcho(d)).toBe('left-residue')
    expect(log).toEqual(['bs1'])
  })

  it('left-residue: the sentinel appeared but the box never emptied', async () => {
    const { d } = deps([null, 'x'])
    expect(await probeInputEcho(d)).toBe('left-residue')
  })

  it('a permission prompt or an unreadable pane: nothing is typed', async () => {
    const p = deps([null], { permissionBlocks: () => true })
    expect(await probeInputEcho(p.d)).toBe('permission-prompt')
    expect(p.log).toEqual([])
    const c = deps([undefined])
    expect(await probeInputEcho(c.d)).toBe('capture-failed')
    expect(c.log).toEqual([])
  })
})

describe('the box reader on a REAL fresh-session capture', () => {
  // didi 2026-11-08 17:21:21, start+5s, capture-pane -p -e (measurements/b1f0011b, friday's dir).
  const real = readFileSync(join(__dirname, 'fixtures', 'pane', 'b1f0011b-fresh-empty-box.txt'), 'utf8')

  it('reads the empty box as empty', () => {
    expect(parkedInputText(stripGhostSuggestion(real))).toBeNull()
  })

  // SYNTHESIZED from the real capture (the sentinel inserted after the prompt glyph): the live
  // shape of an echoed sentinel has not been captured yet.
  it('reads a typed sentinel as exactly the sentinel', () => {
    const typed = real.replace('❯ \n', `❯ ${ECHO_SENTINEL}\n`)
    expect(typed).not.toBe(real)
    expect(parkedInputText(stripGhostSuggestion(typed))).toBe(ECHO_SENTINEL)
  })
})

describe('paneEchoesInput against a TUI that buffers until it boots', () => {
  it('a reading TUI echoes; the box is empty afterwards and only the sentinel was typed', async () => {
    expect(await paneEchoesInput('agent-didi')).toBe('echoed')
    expect(h.tui.box).toBe('')
    expect(typedTexts()).toEqual([ECHO_SENTINEL])
  })

  it('a TUI that is not reading yet: no-echo, and the buffered sentinel + BSpace cancel out', async () => {
    h.tui.reading = false
    expect(await paneEchoesInput('agent-didi')).toBe('no-echo')
    h.startReading()
    expect(h.tui.box).toBe('')
  })

  it('a late echo whose burst left the sentinel behind: the next probe erases it and verifies empty', async () => {
    h.tui.reading = false
    h.tui.burstDropsBspace = true
    expect(await paneEchoesInput('agent-didi')).toBe('no-echo')
    h.startReading()
    expect(h.tui.box).toBe(ECHO_SENTINEL)
    expect(await paneEchoesInput('agent-didi')).toBe('echoed')
    expect(h.tui.box).toBe('')
    // the second probe typed nothing new: it only erased the residue
    expect(typedTexts()).toEqual([ECHO_SENTINEL])
  })
})

describe('the identity /rename lane waits for an echo (marveen 10011456 c)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('types nothing while the TUI does not read, then submits /rename alone once it does', async () => {
    h.tui.reading = false
    await scheduleIdentitySetup('agent-didi', 'Didi')
    // the first /rename attempt is at 8 s + 5 s; stay unreadable well past it
    await vi.advanceTimersByTimeAsync(20_000)
    expect(typedTexts().filter((t) => t.startsWith('/rename'))).toEqual([])
    h.startReading()
    expect(h.tui.box).toBe('')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.tui.submitted).toEqual(['/rename Didi'])
    expect(h.tui.box).toBe('')
    expect(h.tui.seenBoxes.some((b) => b.includes('\n'))).toBe(false)
  })

  it('defers on every non-echo result, not only no-echo: a failed keystroke types no /rename (didi 56466 #2)', async () => {
    h.tui.failSentinelSends = 1
    await scheduleIdentitySetup('agent-didi', 'Didi')
    // first attempt at 8 s + 5 s: the probe's keystroke throws -> keystroke-failed -> defer
    await vi.advanceTimersByTimeAsync(16_000)
    expect(h.tui.failSentinelSends).toBe(0)
    expect(typedTexts().filter((t) => t.startsWith('/rename'))).toEqual([])
    expect(h.tui.submitted).toEqual([])
    // the 6 s echo retry probes again on a working pane and submits
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.tui.submitted).toEqual(['/rename Didi'])
  })

  it('control: a TUI that reads from the start gets /rename on the first attempt', async () => {
    await scheduleIdentitySetup('agent-didi', 'Didi')
    await vi.advanceTimersByTimeAsync(16_000)
    expect(h.tui.submitted).toEqual(['/rename Didi'])
  })
})
