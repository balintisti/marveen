// THE WATCHER MEASURES A SATURATED RECIPIENT AS SATURATED, NOT IDLE -- card a466a216.
//
// detectPaneState reads a saturated pane as idle (no spinner), so the message-guard notice called
// deeper's pane "URES -- NEM a munka tartja fel" and lifted the resend ban, on the one pane the
// router refuses to inject into. The watcher now asks saturationRefusesDispatch first. These run
// the real tick() -> sweepStalePending() -> buildPendingStillWaitingNotice path.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'saturated-recipient-'))
  fs.mkdirSync(path.join(tmp, 'root'))
  return {
    tmp,
    saturated: new Set<string>(),
    createAgentMessage: vi.fn(),
  }
})
tmpDirs().adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}))
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => 'pane',
  isAgentRunning: () => true,
  saturationRefusesDispatch: (_pane: string, session: string) => h.saturated.has(session),
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  // What deeper's saturated pane measured on 2026-09-20: idle by the spinner test.
  detectPaneState: () => 'idle',
  busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false,
  runningBackgroundWork: () => 0,
  detectsMidTurnApiError: () => false,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  listKanbanCards: () => [],
  getLabelsForAllCards: () => new Map(),
  // created_at in epoch SECONDS, like the real table; 70 min is past PENDING_NOTICE_AFTER_MS.
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => sql.includes("status = 'pending'")
        ? [{ id: 41, from_agent: 'friday', to_agent: 'deeper', created_at: Math.floor((Date.now() - 70 * 60_000) / 1000) }]
        : [],
      get: () => undefined,
      run: () => ({ changes: 0 }),
    }),
  }),
  createAgentMessage: (...a: unknown[]) => h.createAgentMessage(...a),
  getLastOutboundMessageAt: () => null,
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => null,
}))

async function noticeToFriday(): Promise<string> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
  const call = h.createAgentMessage.mock.calls.find((c) => c[0] === 'system' && c[1] === 'friday')
  return call ? String(call[2]) : ''
}

describe('tick(): a saturated recipient is reported saturated (a466a216)', () => {
  beforeEach(() => { h.saturated.clear(); h.createAgentMessage.mockReset() })

  it('saturated pane: TELITETT label, resend and restart both forbidden, never "URES"', async () => {
    h.saturated.add('agent-deeper')
    const msg = await noticeToFriday()
    expect(msg).toMatch(/#41 deeper: .*TELITETT KONTEXTUST/)
    expect(msg).toMatch(/NE inditsd ujra innen/)
    expect(msg).not.toMatch(/URES/)
    expect(msg).not.toMatch(/ujrakuldest NEM tiltom/)
  })

  it('CONTROL: the same pane without saturation still reads idle, as before', async () => {
    const msg = await noticeToFriday()
    expect(msg).toMatch(/#41 deeper: .*URES/)
    expect(msg).toMatch(/ujrakuldest NEM tiltom/)
    expect(msg).not.toMatch(/TELITETT/)
  })
})
