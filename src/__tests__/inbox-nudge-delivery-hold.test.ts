// While the context-guard restarts the main agent its drain-inbox claims nothing
// (delivery-hold.ts), so the inbox nudge watcher must not nudge: each empty drain would
// count as a stale nudge, and three of them fire a false "drain hook broken" alert.
// Driven through the real tick(), like inbox-nudge-quiet.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  rows: [] as Array<{ id: number; created_at: number; wake?: number }>,
  send: vi.fn(async (..._a: unknown[]) => 'sent'),
  alert: vi.fn(),
  idle: { value: true },
}))

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))
vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), MAIN_AGENT_ID: 'orin' }))
vi.mock('../db.js', () => ({ getPendingMessages: () => h.rows }))
vi.mock('../settings-store.js', () => ({ getEffectiveSettingValue: () => 'hu' }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'orin-channels' }))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: (...a: unknown[]) => h.alert(...a) }))
vi.mock('../pane-state.js', () => ({ promptAlreadyQueued: () => false }))
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => 'pane',
  sessionExistsOnHost: () => true,
  isSessionReadyForPrompt: async () => h.idle.value,
  clearFeedbackModalAndRecheck: async () => false,
  sendPromptToSession: (...a: unknown[]) => h.send(...a),
}))

const { _tickForTest, _resetNudgeStateForTest, nudgeText } = await import('../web/inbox-nudge-watcher.js')
const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')

const secs = () => Math.floor(Date.now() / 1000)
const row = (id: number, ageS: number) => ({ id, created_at: secs() - ageS, wake: 1 })

/** `n` ticks, 6 minutes apart (past the nudge debounce and cooldown). */
async function ticks(n: number): Promise<void> {
  const realNow = Date.now
  try {
    let t = realNow()
    for (let i = 0; i < n; i++) {
      t += 6 * 60_000
      Date.now = () => t
      await _tickForTest()
    }
  } finally {
    Date.now = realNow
  }
}

beforeEach(() => {
  h.rows = [row(1, 3600)]
  h.idle.value = true
  h.send.mockClear()
  h.alert.mockClear()
  _resetNudgeStateForTest()
})
afterEach(() => setDeliveryHoldProbe(null))

describe('inbox nudge watcher honours the context-guard delivery hold on the main agent', () => {
  it('POSITIVE CONTROL: no hold -> the idle pane gets one nudge', async () => {
    await _tickForTest()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][1]).toBe(nudgeText('hu'))
  })

  it('held: no nudge and no stale alert however many ticks pass (idle pane)', async () => {
    setDeliveryHoldProbe((a) => (a === 'orin' ? { phase: 'await-handoff', untilMs: Date.now() + 3_600_000 } : null))
    await ticks(8)
    expect(h.send).not.toHaveBeenCalled()
    expect(h.alert).not.toHaveBeenCalled()
  })

  it('held: no busy wakeup line either (busy pane)', async () => {
    h.idle.value = false
    setDeliveryHoldProbe(() => ({ phase: 'await-ready', untilMs: Date.now() + 3_600_000 }))
    await ticks(3)
    expect(h.send).not.toHaveBeenCalled()
  })

  it('a long hold does not eat the stale budget: after the release the first tick nudges, with no alert', async () => {
    let held = true
    setDeliveryHoldProbe(() => (held ? { phase: 'await-ready', untilMs: Date.now() + 3_600_000 } : null))
    await ticks(6)
    held = false
    await ticks(1)
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.alert).not.toHaveBeenCalled()
  })
})
