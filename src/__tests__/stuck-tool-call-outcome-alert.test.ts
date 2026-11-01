import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Card 87687aca (owner TG 9187): with NOTIFY_ROUTINE_ALERTS off (this install's
// default), a wedge the watcher FIXED goes to the log only, but a wedge it could
// NOT fix must still reach the owner's channel. Driven through checkSession()
// (the poll step, as in stuck-tool-call-poll-step.test.ts) with the REAL
// routine-alert module, so the gate under test is the shipped one; only the
// channel (notify.js) and the boot-time switch are stubbed. sendAlert is stubbed
// with the same body it has in channel-monitor.ts (a bare notifyChannel call).
const h = vi.hoisted(() => ({
  pane: '' as string | null,
  resumeOk: true,
  routineAlerts: false,
  notify: [] as string[],
  logLines: [] as string[],
}))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return {
    ...actual,
    get NOTIFY_ROUTINE_ALERTS() {
      return h.routineAlerts
    },
  }
})
vi.mock('../notify.js', () => ({
  notifyChannel: (text: string) => {
    h.notify.push(text)
    return Promise.resolve()
  },
}))
vi.mock('../logger.js', async (orig) => {
  const actual = await orig<typeof import('../logger.js')>()
  const record = (_fields: unknown, msg: string) => { h.logLines.push(msg) }
  return { ...actual, logger: { info: record, warn: record, error: record, debug: record } }
})
vi.mock('../web/agent-process.js', () => ({ capturePane: () => h.pane }))
vi.mock('../web/channel-monitor.js', async () => {
  const { notifyChannel } = await import('../notify.js')
  return {
    resumeMarveenSession: async () => h.resumeOk,
    sendAlert: (text: string) => { notifyChannel(text).catch(() => {}) },
    lastMainRespawnAt: () => 0,
    MARVEEN_POST_RESPAWN_GRACE_MS: 1,
  }
})
vi.mock('../web/active-model.js', () => ({ readTranscriptMtimeFromProjectDir: () => null }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))
// CPU sample: an idle wedge profile (tmux pane pid, then ps %cpu).
vi.mock('node:child_process', () => ({
  execFileSync: (cmd: string) => (String(cmd).endsWith('ps') ? '0.5\n' : '12345\n'),
}))

import { checkSession } from '../web/stuck-tool-call-watcher.js'

const SEP = '─'.repeat(80)
// A frozen live spinner: the shape stuck-tool-call-poll-step.test.ts uses as its
// positive control (it does trigger a recovery).
const frozenPane = [
  '✻ Baked for 33s',
  '',
  '⏺ Bash(python3 scripts/dev-gc.py --apply-worktrees)',
  '  ⎿  Running…',
  '',
  '✻ Imagining… (43s · ↓ 733 tokens)',
  SEP,
  '❯ ',
  SEP,
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt',
].join('\n')

async function wedge(session: string) {
  for (let i = 0; i < 12; i++) {
    h.pane = frozenPane
    await checkSession('main', session)
    vi.advanceTimersByTime(30_000)
  }
}

describe('stuck main session: recovery outcome vs NOTIFY_ROUTINE_ALERTS (card 87687aca)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T18:00:00+01:00'))
    h.notify.length = 0
    h.logLines.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('gate off, recovery FAILED: the owner still gets the "NEM sikerült" alert', async () => {
    h.routineAlerts = false
    h.resumeOk = false
    await wedge('s-failed-off')
    expect(h.notify).toHaveLength(1)
    expect(h.notify[0]).toContain('az automatikus újraindítás NEM sikerült')
  })

  it('gate off, recovery succeeded: nothing on the channel, the occurrence is logged', async () => {
    h.routineAlerts = false
    h.resumeOk = true
    await wedge('s-ok-off')
    expect(h.notify).toHaveLength(0)
    expect(h.logLines.some((m) => m.includes('NOTIFY_ROUTINE_ALERTS=off'))).toBe(true)
  })

  it('gate on, recovery succeeded: the routine report goes out (positive control for the gate)', async () => {
    h.routineAlerts = true
    h.resumeOk = true
    await wedge('s-ok-on')
    expect(h.notify).toHaveLength(1)
    expect(h.notify[0]).toContain('Automatikusan újraindítottam')
  })
})
