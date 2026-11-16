// card 8f4b2cf4: the 'pane unreadable / unknown-state' alert must carry the frame it could not place.
//
// Measured 2026-11-16 in store/dashboard.log: 17 such alerts in three days (computress 4, dexter 4,
// marveen 4, didi 2, trillian 2, ford 1). The alert text guessed a pinned title banner, and no
// unknown frame was ever kept: re-read minutes later, the same panes classify as idle (12 of 12
// samples for marveen, 2026-11-16 14:2x). Without the frame the cause cannot be found, so the log
// line gets the last lines of the capture. The classifier itself is not changed here.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- a vizsgalt kor koruli vilag, mockolva -------------------------------------------
const warn = vi.fn()
const capture = vi.fn()
const paneState = vi.fn()
const pending = vi.fn()
const workCheckRaw = vi.fn()

vi.mock('../logger.js', () => ({
  logger: {
    debug: () => {},
    info: () => {}, warn: (...a: unknown[]) => warn(...a), error: () => {},
  },
}))
vi.mock('../web/agent-process.js', () => ({ capturePane: (...a: unknown[]) => capture(...a), isAgentRunning: () => true, saturationRefusesDispatch: () => false }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: () => 'agent-x' }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: () => '/tmp/nincs-ilyen-konyvtar-60060415',
  readAgentRemoteHost: () => null,
  // Added 2026-09-20 (card 88998fea): the watcher now reads the agent's lane before
  // the decision, to compare the pull-list it is about to name against the last one.
  // `null` is the documented "declares no lane" value -- filtered by NOTHING -- so this
  // mock widens nothing and no assertion below changes.
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: (...a: unknown[]) => paneState(...a),
  busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false,
  // card 3c27105f: readPane counts running sub-agents from the same capture.
  runningBackgroundWork: () => 0,
  // card 843a9ab6: readPane reads the mid-turn API error from the same capture.
  detectsMidTurnApiError: () => false,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: (...a: unknown[]) => pending(...a),
  listKanbanCards: () => [],
  // A trunk UJ fuggoseget tett a tick utjara (getLabelsForAllCards). A mock enelkul
  // `undefined`-ot ad, a tick eldobja magat, es a naplo URES marad -- ami PONTOSAN ugy nez
  // ki, mint a lelet, amit ez a spec keres, a POZITIV KONTROLLJAVAL egyutt. A mockot
  // egesziti ki, NEM a kodot lazitja: egy mock, amibol hianyzik, amit a modul MA igenyel,
  // HELYESEN torik el, es a tores maga a jelzes.
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: () => ({ id: 1 }),
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => null,
}))

const { paneTailForLog } = await import('../web/idle-agent-watcher.js')

// The watcher keeps per-agent alert state in module scope (the 6 h blind-alert floor), so every
// test that drives a tick imports a fresh copy: otherwise the first test's alert would silence
// the next ones and the positive control would pass for the wrong reason.
async function freshTick(): Promise<() => void> {
  vi.resetModules()
  return (await import('../web/idle-agent-watcher.js')).tick
}

const FOOTER_LIKE = '  \u23f5\u23f5 some new footer wording nobody taught the classifier'
const PANE = ['scrollback 1', '', 'scrollback 2', '\u2500'.repeat(40), '\u276f ', '\u2500'.repeat(40), '  Fable 5.2 | ctx 43% | 7d 76%', FOOTER_LIKE, '   ', ''].join('\n')

function blindWarns(): Array<Record<string, unknown>> {
  return warn.mock.calls
    .map(c => c[0] as Record<string, unknown>)
    .filter(o => o?.idleGuard === true && o?.agent === 'x' && o?.paneReason !== undefined)
}

describe('paneTailForLog', () => {
  it('keeps the last 6 non-empty lines, drops trailing blanks, cuts long lines', () => {
    const pane = ['a', 'b', '', 'c', 'd', 'e', 'f', 'g', 'h', '', '   '].join('\n')
    expect(paneTailForLog(pane)).toEqual(['c', 'd', 'e', 'f', 'g', 'h'])
    const long = paneTailForLog('x'.repeat(500))
    expect(long).toHaveLength(1)
    expect(long[0].length).toBe(163)
    expect(long[0].endsWith('...')).toBe(true)
  })
  it('an empty pane gives an empty tail', () => {
    expect(paneTailForLog('')).toEqual([])
  })
})

describe('the unknown-state alert carries the frame (8f4b2cf4)', () => {
  beforeEach(() => {
    warn.mockReset(); capture.mockReset(); paneState.mockReset(); pending.mockReset(); workCheckRaw.mockReset()
    pending.mockReturnValue([])
    capture.mockReturnValue(PANE)
  })

  it('an unknown classification logs paneTail with the footer-like line last', async () => {
    paneState.mockReturnValue('unknown')
    ;(await freshTick())()
    const w = blindWarns()
    expect(w).toHaveLength(1)
    expect(w[0].paneReason).toBe('unknown-state')
    const tail = w[0].paneTail as string[]
    expect(tail[tail.length - 1]).toBe(FOOTER_LIKE)
    expect(tail).toContain('  Fable 5.2 | ctx 43% | 7d 76%')
    expect(tail.length).toBeLessThanOrEqual(6)
  })

  it('POSITIVE CONTROL: an idle classification raises no blind alert and no tail', async () => {
    paneState.mockReturnValue('idle')
    ;(await freshTick())()
    expect(blindWarns()).toHaveLength(0)
  })

  it('a failed capture is a different reason and carries no tail', async () => {
    capture.mockReturnValue(null)
    paneState.mockReturnValue('unknown')
    ;(await freshTick())()
    const w = blindWarns()
    expect(w).toHaveLength(1)
    expect(w[0].paneReason).toBe('capture-failed')
    expect(w[0]).not.toHaveProperty('paneTail')
  })
})
