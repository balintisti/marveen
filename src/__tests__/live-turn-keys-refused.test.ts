import { describe, it, expect, vi, beforeEach } from 'vitest'

// Card f5bb2626, didi 27204. The keys that clear a parked box start with Escape, and on a
// running turn Escape is an interrupt. The first version's tests only checked that the guard's
// TEXT came before the key send in the source -- 8 of 11 mutants survived (D). These drive the
// real functions with a captured pane and record what was actually typed: behind a running turn
// NOTHING may be sent, and the idle control must still send the clear.
//
// Same harness as janitor-under-send-lane.test.ts: capturePane/runTmux go through
// node:child_process execFileSync, mocked here with arg-inspection.

const h = vi.hoisted(() => {
  const SEP = '─'.repeat(80)
  const NAMED = `${'─'.repeat(71)} Didi ─`
  // didi 27204 (A): a real footer cut by the terminal width INSIDE the busy phrase.
  const LIVE_FOOTER = '  ⏵⏵ bypass permissions on · 3 shells · /tasks to see subagents · esc to inte…'
  const IDLE_FOOTER = '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
  const panel = ['', '  ⏺ main', '  ◯ general-purpose  Checking row 1…  3h 53m · ↓ 220.4k tokens',
    '  ◯ general-purpose  Checking row 2…  2h 10m · ↓ 120.1k tokens']
  const pane = (footer: string, box: string, withPanel: boolean) =>
    ['  ⎿  $ git fetch -q origin', '', NAMED, `❯ ${box}`, SEP, footer, ...(withPanel ? panel : [])].join('\n')
  // A footer WITHOUT the "<mode> on" prefix is not recognised by the footer regex, so
  // detectPaneState counts from the pane's end; with six panel rows the footer falls out of its
  // window and the pane reads 'typing' mid-turn -- the same misreading as 10-03, by another road.
  // On such a pane the liveTurnFooterVisible guards are the ONLY thing between the keys and the turn.
  const NOMODE_LIVE = '  3 shells, 2 monitors · esc to interrupt · ↓ to manage'
  // No background work in it: since didi 27419 a shells/monitors tail refuses the keys on its own
  // (see 'background work beside an idle prompt'), so it can no longer be the idle control.
  const NOMODE_IDLE = '  ? for shortcuts'
  const longPanel = ['', '  ⏺ main', ...[0, 1, 2, 3, 4, 5].map(i => `  ◯ general-purpose  Checking row ${i}…  3h 53m`)]
  const divergent = (footer: string) =>
    ['  ⎿  $ git fetch -q origin', '', NAMED, '❯ Csendes heartbeat.', SEP, footer, ...longPanel].join('\n')
  return {
    DIVERGENT_LIVE: divergent(NOMODE_LIVE),
    DIVERGENT_IDLE: divergent(NOMODE_IDLE),
    // a status line between the box and the footer: the busy phrase is the THIRD line under the box
    STATUS_LINE_LIVE: ['', NAMED, '❯ Csendes heartbeat.', SEP, '  ▸ Context left until auto-compact: 9%', '', LIVE_FOOTER].join('\n'),
    // an older frame's box higher up: only the LAST separator is the live box
    TWO_BOXES_LIVE: ['', SEP, '❯ ', SEP, IDLE_FOOTER, '', '  ⎿  ok', '', NAMED, '❯ Csendes heartbeat.', SEP, LIVE_FOOTER].join('\n'),
    TWO_BOXES_IDLE: ['', SEP, '❯ ', SEP, LIVE_FOOTER, '', '  ⎿  ok', '', NAMED, '❯ Csendes heartbeat.', SEP, IDLE_FOOTER].join('\n'),
    LIVE_PARKED: pane(LIVE_FOOTER, 'Csendes heartbeat.', true),
    LIVE_EMPTY: pane(LIVE_FOOTER, '', true),
    IDLE_PARKED: pane(IDLE_FOOTER, 'Csendes heartbeat.', false),
    // didi 27419, measured shapes: background work and NO "esc to interrupt" anywhere.
    BG_FOOTER_PARKED: ['', NAMED, '❯ Csendes heartbeat.', SEP, '  … 45 shells, 3 monitors · ↓ to manage'].join('\n'),
    BG_WAITING_PARKED: ['  ✻ Waiting for 2 background agents to finish', '', NAMED, '❯ Csendes heartbeat.', SEP, IDLE_FOOTER].join('\n'),
    // didi 27454, the live main-agent WORKER pane, idle: a navigation hint, no shell, no monitor
    WORKER_IDLE_PARKED: ['', NAMED, '❯ Csendes heartbeat.', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents'].join('\n'),
    MONITOR_HINT_PARKED: ['', NAMED, '❯ Csendes heartbeat.', SEP, '  ⏵⏵ bypass permissions on · 1 monitor · ← for agents · ↓ to manage'].join('\n'),
    // the same words QUOTED in the scrollback, far above the live box: not background work
    BG_QUOTED_IDLE: ['  ⎿  "✻ Waiting for 2 background agents to finish" (didi 27419)', '  ⎿  footer was: … 45 shells, 3 monitors · ↓ to manage',
      '', '  ⎿  ok', '', '  ⎿  ok', '', NAMED, '❯ Csendes heartbeat.', SEP, IDLE_FOOTER].join('\n'),
    pane: '',
    calls: [] as string[][],
  }
})

vi.mock('node:child_process', async (orig) => ({
  ...(await orig() as object),
  execFileSync: vi.fn((_file: string, args?: string[]) => {
    if (Array.isArray(args)) {
      h.calls.push(args)
      if (args.includes('capture-pane')) return h.pane
    }
    return ''
  }),
}))
vi.mock('../notify.js', () => ({ alertIsRedirected: () => false, notifyChannel: vi.fn(async () => {}), notifyTelegram: vi.fn(async () => {}) }))

import { clearInputBuffer, clearStaleParkedInput } from '../web/agent-process.js'
import { detectPaneState, liveTurnFooterVisible, backgroundWorkVisible, interruptingKeysUnsafe } from '../pane-state.js'
import { __resetSessionSendLocks } from '../web/session-send-lock.js'

const sentKeys = () => h.calls.filter(a => a.includes('send-keys'))

beforeEach(() => {
  h.calls.length = 0
  __resetSessionSendLocks()
})

describe('a footer cut inside "esc to interrupt" (didi 27204 A, B)', () => {
  it('reads busy with text in the box -- not typing, so no recovery fires', () => {
    expect(detectPaneState(h.LIVE_PARKED)).toBe('busy')
  })

  it('reads busy with an EMPTY box -- the first fix had turned this real pane idle (B)', () => {
    expect(detectPaneState(h.LIVE_EMPTY)).toBe('busy')
  })

  it('is seen by liveTurnFooterVisible', () => {
    expect(liveTurnFooterVisible(h.LIVE_PARKED)).toBe(true)
    expect(liveTurnFooterVisible(h.IDLE_PARKED)).toBe(false)
  })
})

describe('the clearing keys are not sent behind a running turn (didi 27204 C, D)', () => {
  it('clearInputBuffer sends nothing and reports failure', async () => {
    h.pane = h.LIVE_PARKED
    expect(await clearInputBuffer('agent-x')).toBe(false)
    expect(sentKeys()).toEqual([])
  })

  it('CONTROL: on an idle pane with parked text clearInputBuffer sends the Escape-led clear', async () => {
    h.pane = h.IDLE_PARKED
    await clearInputBuffer('agent-x')
    expect(sentKeys().length).toBeGreaterThan(0)
    expect(sentKeys()[0]).toContain('Escape')
  })

  it('clearStaleParkedInput (the router and scheduler janitor) sends nothing', async () => {
    h.pane = h.LIVE_PARKED
    expect(await clearStaleParkedInput('agent-x')).toBe(false)
    expect(sentKeys()).toEqual([])
  })

  it('CONTROL: on an idle pane with parked text the janitor does send keys', async () => {
    h.pane = h.IDLE_PARKED
    await clearStaleParkedInput('agent-x')
    expect(sentKeys().length).toBeGreaterThan(0)
  })
})

describe('the guard is found from the LIVE box, not from the footer text (M7, M8)', () => {
  it('sees the busy phrase on the third line under the box (a status line above the footer)', () => {
    expect(liveTurnFooterVisible(h.STATUS_LINE_LIVE)).toBe(true)
  })

  it('reads the LAST box: a live footer under an older idle frame is live, and the reverse is not', () => {
    expect(liveTurnFooterVisible(h.TWO_BOXES_LIVE)).toBe(true)
    expect(liveTurnFooterVisible(h.TWO_BOXES_IDLE)).toBe(false)
  })
})

describe('when the pane classifier misreads a running turn as typing, the keys still wait', () => {
  it('PRECONDITION: this pane reads typing mid-turn, so the guard below is the only defence', () => {
    // If this starts failing because detectPaneState got better, the tests below need a new pane
    // that still splits the two -- otherwise they stop measuring the guard.
    expect(detectPaneState(h.DIVERGENT_LIVE)).toBe('typing')
    expect(liveTurnFooterVisible(h.DIVERGENT_LIVE)).toBe(true)
    expect(detectPaneState(h.DIVERGENT_IDLE)).toBe('typing')
    expect(liveTurnFooterVisible(h.DIVERGENT_IDLE)).toBe(false)
  })

  it('clearStaleParkedInput sends nothing behind the misread turn', async () => {
    h.pane = h.DIVERGENT_LIVE
    expect(await clearStaleParkedInput('agent-div-live')).toBe(false)
    expect(sentKeys()).toEqual([])
  })

  it('CONTROL: the same pane shape without the running turn IS cleared', async () => {
    // its own session: the janitor's per-session cooldown would otherwise answer for an earlier test
    h.pane = h.DIVERGENT_IDLE
    await clearStaleParkedInput('agent-div-idle')
    expect(sentKeys().length).toBeGreaterThan(0)
  })

  it('clearInputBuffer sends nothing behind the misread turn', async () => {
    h.pane = h.DIVERGENT_LIVE
    expect(await clearInputBuffer('agent-x')).toBe(false)
    expect(sentKeys()).toEqual([])
  })
})

describe('background work beside an idle prompt (didi 27419; marveen 26943: no Escape if a running background task is visible)', () => {
  it('is seen from the footer tail and from the "Waiting for N background agents" line, not from quoted text', () => {
    expect(backgroundWorkVisible(h.BG_FOOTER_PARKED)).toBe(true)
    expect(backgroundWorkVisible(h.BG_WAITING_PARKED)).toBe(true)
    expect(backgroundWorkVisible(h.BG_QUOTED_IDLE)).toBe(false)
    expect(backgroundWorkVisible(h.IDLE_PARKED)).toBe(false)
    // none of them shows a running turn: only the background-work half can refuse them
    for (const p of [h.BG_FOOTER_PARKED, h.BG_WAITING_PARKED]) {
      expect(liveTurnFooterVisible(p)).toBe(false)
      expect(interruptingKeysUnsafe(p)).toBe(true)
    }
    expect(interruptingKeysUnsafe(h.DIVERGENT_LIVE)).toBe(true)
  })

  it('the old divergent footer "3 shells, 2 monitors · ↓ to manage" is background work too', () => {
    const old = h.DIVERGENT_IDLE.replace('  ? for shortcuts', '  3 shells, 2 monitors · ↓ to manage')
    expect(old).not.toBe(h.DIVERGENT_IDLE)
    expect(backgroundWorkVisible(old)).toBe(true)
  })

  for (const [name, shape] of [['footer tail', 'BG_FOOTER_PARKED'], ['waiting line', 'BG_WAITING_PARKED']] as const) {
    it(`clearInputBuffer sends nothing and reports failure (${name})`, async () => {
      h.pane = h[shape]
      expect(await clearInputBuffer('agent-bg')).toBe(false)
      expect(sentKeys()).toEqual([])
    })

    it(`the janitor sends nothing (${name})`, async () => {
      h.pane = h[shape]
      expect(detectPaneState(h[shape])).toBe('typing')
      expect(await clearStaleParkedInput(`agent-bg-${name}`)).toBe(false)
      expect(sentKeys()).toEqual([])
    })
  }

  it('CONTROL: the quoted words in the scrollback do not stop the janitor', async () => {
    h.pane = h.BG_QUOTED_IDLE
    await clearStaleParkedInput('agent-bg-quoted')
    expect(sentKeys().length).toBeGreaterThan(0)
  })

  it('the idle worker footer "· ← for agents" is NOT background work (didi 27454); a monitor beside it is', () => {
    expect(backgroundWorkVisible(h.WORKER_IDLE_PARKED)).toBe(false)
    expect(interruptingKeysUnsafe(h.WORKER_IDLE_PARKED)).toBe(false)
    expect(backgroundWorkVisible(h.MONITOR_HINT_PARKED)).toBe(true)
  })

  it('CONTROL: the janitor still clears parked text on an idle worker pane', async () => {
    h.pane = h.WORKER_IDLE_PARKED
    await clearStaleParkedInput('agent-worker-idle')
    expect(sentKeys().length).toBeGreaterThan(0)
  })
})
