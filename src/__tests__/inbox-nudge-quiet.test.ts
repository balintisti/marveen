// Card a85a9acd: the inbox-nudge watcher ignores quiet (wake=0) rows. Driven through the real
// tick(), because the filter sits in the IO shell: the pure decisions never see a quiet row,
// which is exactly why a pure-only test could not tell a working filter from a missing one.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { _tickForTest, _resetNudgeStateForTest, nudgeText, BUSY_WAKEUP_TEXT } = await import('../web/inbox-nudge-watcher.js')

const secs = () => Math.floor(Date.now() / 1000)
const row = (id: number, ageS: number, wake?: number) => ({ id, created_at: secs() - ageS, wake })

beforeEach(() => {
  h.rows = []
  h.idle.value = true
  h.send.mockClear()
  h.alert.mockClear()
  _resetNudgeStateForTest()
})

describe('inbox-nudge tick: quiet rows never wake the main pane', () => {
  it('POSITIVE CONTROL: one waking row, idle pane -> exactly one nudge, with the nudge text', async () => {
    h.rows = [row(1, 3600, 1)]
    await _tickForTest()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][1]).toBe(nudgeText('hu'))
  })

  it('only quiet rows pending, idle pane -> no nudge, however old', async () => {
    h.rows = [row(1, 3600, 0), row(2, 7200, 0)]
    await _tickForTest()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('only quiet rows pending, BUSY pane -> no busy wakeup line either', async () => {
    h.idle.value = false
    h.rows = [row(1, 3600, 0)]
    await _tickForTest()
    expect(h.send).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL for the busy branch: a waking row on a busy pane queues one wakeup line', async () => {
    h.idle.value = false
    h.rows = [row(1, 3600, 1)]
    await _tickForTest()
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.send.mock.calls[0][1]).toBe(BUSY_WAKEUP_TEXT)
  })

  it('a quiet row OLDER than the waking row is not the "oldest": the stale spell tracks the waking id', async () => {
    h.rows = [row(1, 7200, 0), row(2, 3600, 1)]
    await _tickForTest()
    expect(h.send).toHaveBeenCalledTimes(1)
    // three more nudges on the same waking id, past debounce and cooldown, then the alert fires
    // for the WAKING id (2), never for the quiet one (1)
    const realNow = Date.now
    try {
      let t = realNow()
      for (let i = 0; i < 4; i++) {
        t += 6 * 60_000
        Date.now = () => t
        await _tickForTest()
      }
    } finally {
      Date.now = realNow
    }
    expect(h.alert).toHaveBeenCalledTimes(1)
    expect(String(h.alert.mock.calls[0][0])).toContain('#2 ')
    expect(String(h.alert.mock.calls[0][0])).not.toContain('#1 ')
  })

  it('a quiet row alone never reaches the stale alert, however many ticks pass', async () => {
    h.rows = [row(1, 86_000, 0)]
    const realNow = Date.now
    try {
      let t = realNow()
      for (let i = 0; i < 8; i++) {
        t += 6 * 60_000
        Date.now = () => t
        await _tickForTest()
      }
    } finally {
      Date.now = realNow
    }
    expect(h.send).not.toHaveBeenCalled()
    expect(h.alert).not.toHaveBeenCalled()
  })
})
