/**
 * THE 'HOLD' ON A PARKED BOX IS BOUNDED -- card b0181f2b, marveen's decision 2026-09-25 03:19.
 *
 * didi (2b6a7359) measured three paths on which the recovery falls back to the origin check and the
 * box stays on 'hold' forever: the injected-prompt record EXPIRED, the registry is EMPTY (restart),
 * the record was OVERWRITTEN by a newer prompt. The bound does not care which: the same box, unchanged
 * past PARKED_HOLD_ALERT_MS, is announced ONCE. Driven through the real recoverStuckInputForSession
 * for the MAIN session -- the one whose hold had no bound at all (its give-up alert is off) -- with
 * the pane, tmux and the registry stubbed, and the clock moved by hand.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  pane: '',
  record: null as null | { text: string; at: number },
  alerts: [] as string[],
  letters: [] as { to: string; text: string }[],
}))

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: vi.fn(() => ''),
  spawn: vi.fn(() => ({ on: () => {}, unref: () => {} })),
}))
vi.mock('../notify.js', () => ({ notifyChannel: (t: string) => { h.alerts.push(t); return Promise.resolve(true) } }))
vi.mock('../db.js', async (orig) => ({
  ...(await orig<typeof import('../db.js')>()),
  createAgentMessage: (_from: string, to: string, text: string) => { h.letters.push({ to, text }); return { id: 1 } },
}))
// observe-only diagnostics that read the database; they never branch the recovery
vi.mock('../web/parked-record-probe.js', () => ({ probeParkedRecord: () => {}, PROBE_FRESHNESS_MS: 600_000 }))
vi.mock('../web/stuck-sig-transition-probe.js', () => ({ probeSigTransition: () => {}, sigTransitionFacts: () => ({}) }))
vi.mock('../web/injected-prompt-registry.js', () => ({
  getInjectedPrompt: () => h.record,
  matchesInjectedPrompt: (_scrape: string | null, rec: { text: string } | null) => rec != null && rec.text === 'THE-PARKED-TEXT',
  recordInjectedPrompt: () => {},
}))
vi.mock('../web/agent-process.js', async (orig) => ({
  ...(await orig<typeof import('../web/agent-process.js')>()),
  captureParkedInputView: () => h.pane,
  capturePane: () => h.pane,
  clearInputBuffer: async () => {},
  dismissModelConsentDialogIfPresent: async () => false,
}))

const { recoverStuckInputForSession, resetParkedHoldAnnounced } = await import('../web/channel-monitor.js')
const { MAIN_AGENT_ID } = await import('../config.js')
const { MAIN_CHANNELS_SESSION } = await import('../web/main-agent.js')
const { PARKED_HOLD_ALERT_MS } = await import('../pane-state.js')

// A multi-row parked box that is NOT a <channel> block: on the main session (no plain re-inject)
// and without a matching record, the recovery's only move is 'hold'.
const SEP = '─'.repeat(80)
const box = (...rows: string[]) => ['', SEP, ...rows, SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')
const PARKED = box('❯ egy hosszabb, tobb soros szoveg, ami ott ragadt', '  a dobozban, es nem kuldte be senki')
const THRESH = { confirmMs: 90_000, dedupMs: 45_000, maxAttempts: 4 }
const T0 = Date.parse('2026-09-25T03:00:00Z')
const MIN = 60_000

async function tickAt(ms: number, prev: Parameters<typeof recoverStuckInputForSession>[2]) {
  vi.setSystemTime(ms)
  return recoverStuckInputForSession(MAIN_CHANNELS_SESSION, MAIN_AGENT_ID, prev, THRESH, false)
}
async function runFor(minutes: number) {
  let s = { parkedSig: null, firstSeenAt: null, lastRecoverAt: null, attempts: 0 } as Parameters<typeof recoverStuckInputForSession>[2]
  for (let m = 0; m <= minutes; m++) s = await tickAt(T0 + m * MIN, s)
  return s
}

describe('the bounded hold, on the three paths didi measured (b0181f2b)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.pane = PARKED; h.alerts = []; h.letters = []
    resetParkedHoldAnnounced()
  })
  afterEach(() => vi.useRealTimers())

  const paths: [string, () => void][] = [
    ['an EXPIRED record (the registry answers nothing)', () => { h.record = null }],
    ['an EMPTY registry (a restart)', () => { h.record = null }],
    ['an OVERWRITTEN record (a newer prompt)', () => { h.record = { text: 'a newer, different prompt', at: T0 } }],
  ]
  for (const [label, setup] of paths) {
    it(`${label}: exactly ONE alert after the bound, none before, no repeat`, async () => {
      setup()
      await runFor(PARKED_HOLD_ALERT_MS / MIN - 1)
      expect(h.alerts, 'nothing before the bound').toEqual([])
      await runFor(PARKED_HOLD_ALERT_MS / MIN + 30)       // well past it, many more ticks
      expect(h.alerts).toHaveLength(1)
      expect(h.alerts[0]).toContain(MAIN_CHANNELS_SESSION)
      expect(h.alerts[0]).toContain('egy hosszabb')          // the box's first line
      expect(h.alerts[0]).toContain('Automatikus torles NINCS')
    })
  }

  it("the coordinator's OWN pane goes to the owner, not into the coordinator's queue", async () => {
    h.record = null
    await runFor(PARKED_HOLD_ALERT_MS / MIN + 1)
    expect(h.letters).toEqual([])
    expect(h.alerts).toHaveLength(1)
  })

  it('a DIFFERENT box later is a new spell: announced again after its own bound', async () => {
    h.record = null
    let s = await runFor(PARKED_HOLD_ALERT_MS / MIN + 1)
    expect(h.alerts).toHaveLength(1)
    h.pane = box('❯ MAS szoveg, egy masik doboz, ami szinten ott ragadt', '  es szinten nem kuldte be senki')
    for (let m = 0; m <= PARKED_HOLD_ALERT_MS / MIN + 1; m++) s = await tickAt(T0 + (PARKED_HOLD_ALERT_MS / MIN + 2 + m) * MIN, s)
    expect(h.alerts).toHaveLength(2)
  })

  it('CONTROL: a box that clears before the bound is never announced', async () => {
    h.record = null
    let s = await runFor(5)
    h.pane = box('❯ ')
    for (let m = 6; m <= 40; m++) s = await tickAt(T0 + m * MIN, s)
    expect(h.alerts).toEqual([])
  })
})

describe('a SUB-AGENT box goes to the coordinator, the owner only as fallback', () => {
  beforeEach(() => { vi.useFakeTimers(); h.pane = PARKED; h.alerts = []; h.letters = []; h.record = null; resetParkedHoldAnnounced() })
  afterEach(() => vi.useRealTimers())

  it('held past the bound in agent-dex -> ONE letter to the coordinator, nothing to the owner', async () => {
    let s = { parkedSig: null, firstSeenAt: null, lastRecoverAt: null, attempts: 0 } as Parameters<typeof recoverStuckInputForSession>[2]
    for (let m = 0; m <= PARKED_HOLD_ALERT_MS / MIN + 10; m++) {
      vi.setSystemTime(T0 + m * MIN)
      s = await recoverStuckInputForSession('agent-dex', 'dex', s, THRESH, false)
    }
    expect(h.letters.map((l) => l.to)).toEqual([MAIN_AGENT_ID])
    expect(h.letters[0].text).toContain('agent-dex')
    expect(h.alerts).toEqual([])
  })
})
