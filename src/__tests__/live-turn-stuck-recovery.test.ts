/**
 * THE STUCK-INPUT RECOVERY SKIPS ITS MOVE BEHIND A RUNNING TURN -- card f5bb2626, didi 27204 (D).
 *
 * On 2026-10-03 this recovery's clear (Escape first) interrupted didi's live turn twice, because a
 * width-truncated footer let the pane read 'typing'. The first version's test only checked that
 * the guard's TEXT stood in the source; two mutants of the guard survived it. This drives the real
 * recoverStuckInputForSession on a pane the classifier still misreads as typing mid-turn (a footer
 * without the "<mode> on" prefix, six panel rows below it), with a matching injected-prompt record
 * so the move it WOULD make is a clear + re-inject, and records what it actually did.
 *
 * Harness: stuck-input-bounded-hold.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  pane: '',
  clears: [] as string[],
  sends: [] as string[],
  tmux: [] as string[][],
  clearResult: true,
}))

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: vi.fn((_f: string, args?: string[]) => { if (Array.isArray(args)) h.tmux.push(args.map(String)); return '' }),
  spawn: vi.fn(() => ({ on: () => {}, unref: () => {} })),
}))
vi.mock('../notify.js', () => ({ notifyChannel: () => Promise.resolve(true) }))
vi.mock('../db.js', async (orig) => ({
  ...(await orig<typeof import('../db.js')>()),
  createAgentMessage: () => ({ id: 1 }),
}))
vi.mock('../web/parked-record-probe.js', () => ({ probeParkedRecord: () => {}, PROBE_FRESHNESS_MS: 600_000 }))
vi.mock('../web/stuck-sig-transition-probe.js', () => ({ probeSigTransition: () => {}, sigTransitionFacts: () => ({}) }))
vi.mock('../web/injected-prompt-registry.js', () => ({
  getInjectedPrompt: () => ({ text: 'Csendes heartbeat.', at: Date.now() }),
  matchesInjectedPrompt: (scrape: string | null) => scrape != null && scrape.includes('Csendes heartbeat.'),
  recordInjectedPrompt: () => {},
}))
vi.mock('../web/agent-process.js', async (orig) => ({
  ...(await orig<typeof import('../web/agent-process.js')>()),
  captureParkedInputView: () => h.pane,
  capturePane: () => h.pane,
  clearInputBuffer: async (s: string) => { h.clears.push(s); return h.clearResult },
  sendPromptToSession: async (s: string) => { h.sends.push(s); return 'sent' },
  dismissModelConsentDialogIfPresent: async () => false,
}))

const { recoverStuckInputForSession } = await import('../web/channel-monitor.js')
const { detectPaneState, liveTurnFooterVisible } = await import('../pane-state.js')

const SEP = '─'.repeat(80)
const NAMED = `${'─'.repeat(71)} Didi ─`
const PANEL = ['', '  ⏺ main', ...[0, 1, 2, 3, 4, 5].map((i) => `  ◯ general-purpose  Checking row ${i}…  3h 53m`)]
const divergent = (footer: string) => ['  ⎿  $ git fetch -q origin', '', NAMED, '❯ Csendes heartbeat.', SEP, footer, ...PANEL].join('\n')
const LIVE = divergent('  3 shells, 2 monitors · esc to interrupt · ↓ to manage')
const IDLE = divergent('  3 shells, 2 monitors · ↓ to manage')

const THRESH = { confirmMs: 90_000, dedupMs: 45_000, maxAttempts: 4 }
const T0 = Date.parse('2026-10-04T03:00:00Z')

/** Two ticks: the first starts the confirm window, the second is past it and would recover. */
async function twoTicks(session: string) {
  let s = { parkedSig: null, firstSeenAt: null, lastRecoverAt: null, attempts: 0 } as Parameters<typeof recoverStuckInputForSession>[2]
  vi.setSystemTime(T0)
  s = await recoverStuckInputForSession(session, 'didi', s, THRESH, true)
  vi.setSystemTime(T0 + THRESH.confirmMs + 1_000)
  return recoverStuckInputForSession(session, 'didi', s, THRESH, true)
}
const keysSent = () => h.tmux.filter((a) => a.includes('send-keys'))

describe('the stuck-input recovery behind a running turn (f5bb2626)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    h.clears = []; h.sends = []; h.tmux = []; h.clearResult = true
  })
  afterEach(() => vi.useRealTimers())

  it('PRECONDITION: the pane reads typing mid-turn, so only the guard stands in the way', () => {
    expect(detectPaneState(LIVE)).toBe('typing')
    expect(liveTurnFooterVisible(LIVE)).toBe(true)
    expect(detectPaneState(IDLE)).toBe('typing')
    expect(liveTurnFooterVisible(IDLE)).toBe(false)
  })

  it('past the confirm window, behind the running turn: no clear, no re-inject, no key', async () => {
    h.pane = LIVE
    await twoTicks('didi-live')
    expect(h.clears).toEqual([])
    expect(h.sends).toEqual([])
    expect(keysSent()).toEqual([])
  })

  it('CONTROL: the same box without the running turn IS recovered', async () => {
    h.pane = IDLE
    await twoTicks('didi-idle')
    expect(h.clears.length + h.sends.length + keysSent().length).toBeGreaterThan(0)
  })

  it('a REFUSED clear re-injects nothing: the parked text would be submitted with the copy (didi 27419)', async () => {
    // The first move is a bare Enter (marveen 26943: Enter first); the clear + re-inject comes on a
    // later attempt, so tick past the dedup window until the clear has been asked for.
    h.pane = IDLE
    h.clearResult = false
    let s = { parkedSig: null, firstSeenAt: null, lastRecoverAt: null, attempts: 0 } as Parameters<typeof recoverStuckInputForSession>[2]
    let t = T0
    for (let i = 0; i < THRESH.maxAttempts + 2 && h.clears.length === 0; i++) {
      vi.setSystemTime(t)
      s = await recoverStuckInputForSession('didi-refused', 'didi', s, THRESH, true)
      t += THRESH.confirmMs + THRESH.dedupMs + 1_000
    }
    expect(h.clears.length).toBeGreaterThan(0)
    expect(h.sends).toEqual([])
  })
})
