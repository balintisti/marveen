import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// THE CARD'S CENTRAL DECISION, MEASURED AS BEHAVIOUR (card 0114968c).
//
// The claim is: the data-source alarm runs BEFORE the shouldNotify gate, so a
// broken source still reaches the coordinator on a round that has nothing to
// tell the owner. That is precisely the round it matters on -- a failed
// calendar makes `calendar.length === 0`, which is itself one of the gate's
// conditions, so the outage would silence its own alarm.
//
// Until now that claim was pinned only by TEXT POSITION in the source
// (`indexOf('detectTransitions(') < indexOf('if (!shouldNotify(data))')`).
// Didi's review said the honest assertion would be to call `executeHeartbeat`
// with the gate closed and watch the alarm fire anyway, and called that bigger
// work than the moment allowed. It is about fifty lines, and this is it.
//
// AND IT SUBSUMES A SECOND FINDING (didi, low). The old
// `never lets an alarm failure stop the heartbeat` asserted only that the text
// `catch (err)` existed -- not what the catch DOES. Didi measured that putting
// `throw err` in that catch body left all 17 tests green, while the heartbeat
// would then die exactly as the test's own name denies. The second case below
// makes the alarm throw for real and watches the heartbeat continue.
//
// Everything the heartbeat reaches out to is faked; nothing here touches the
// live store, the database, Google, or python.

const mockCreateAgentMessage = vi.fn()
const mockRunAgent = vi.fn(async () => undefined)
const mockNotifyTelegram = vi.fn(async () => undefined)
const mockDetectTransitions = vi.fn(() => [] as Array<{ source: string; message: string }>)
const mockReadQuotaSourceState = vi.fn(() => null)
const mockLogInfo = vi.fn()
const mockLogWarn = vi.fn()

vi.mock('../logger.js', () => ({
  logger: { info: mockLogInfo, warn: mockLogWarn, debug: vi.fn(), error: vi.fn() },
}))

// A window that is always open, so the test's clock decides nothing but the
// GATE. (`executeHeartbeat` returns early outside the active hours, which would
// skip the alarm for an unrelated reason and prove nothing.)
vi.mock('../settings-store.js', () => ({
  getEffectiveSettingValue: (k: string) =>
    k === 'HEARTBEAT_START_HOUR' ? 0 : k === 'HEARTBEAT_END_HOUR' ? 24 : '',
}))

vi.mock('../db.js', () => ({
  // An empty board: no urgent cards, nothing waiting -- so the gate says no.
  getHeartbeatKanbanSummary: () => ({ urgent: [], in_progress: [], waiting: [] }),
  getActiveScheduledTaskCount: () => ({ count: 0, nextRun: null }),
  createAgentMessage: (...a: unknown[]) => mockCreateAgentMessage(...a),
}))

// An empty calendar -- the same value a BROKEN calendar used to produce, which
// is the whole reason this card exists.
vi.mock('../google-api.js', () => ({
  fetchCalendarEvents: async () => ({ ok: true, events: [] }),
  calendarApiError: null,
}))

vi.mock('../data-source-alarm.js', () => ({
  detectTransitions: (...a: unknown[]) => mockDetectTransitions(...(a as [])),
  readQuotaSourceState: (...a: unknown[]) => mockReadQuotaSourceState(...(a as [])),
}))

vi.mock('../agent.js', () => ({ runAgent: (...a: unknown[]) => mockRunAgent(...(a as [])) }))
vi.mock('../notify.js', () => ({ notifyTelegram: (...a: unknown[]) => mockNotifyTelegram(...(a as [])) }))

// No python, no mail: an empty inbox, gathered without leaving the process.
vi.mock('node:child_process', () => ({
  execFileSync: () => JSON.stringify({ ok: true, messages: [] }),
  spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
}))

const { executeHeartbeat } = await import('../heartbeat.js')

/** The log line the heartbeat emits when the gate turns it away. */
const GATE_CLOSED = 'Heartbeat ellenorzes kesz -- nincs ertesitendo'
const gateClosed = () => mockLogInfo.mock.calls.some((c) => c.some((a) => a === GATE_CLOSED))

beforeEach(() => {
  vi.clearAllMocks()
  mockDetectTransitions.mockReturnValue([])
  mockReadQuotaSourceState.mockReturnValue(null)
  // A Tuesday morning: inside every plausible window, and with an empty board
  // and an empty calendar the gate closes. 2026-08-25 is a Tuesday.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-25T10:00:00+02:00'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('executeHeartbeat -- the alarm fires on the round that reports nothing', () => {
  it('CLOSES the gate on an empty round (the precondition these tests rest on)', async () => {
    // If this ever stops holding, the two tests below would pass for the wrong
    // reason -- they would be measuring a round that had something to say.
    await executeHeartbeat()

    expect(gateClosed()).toBe(true)
    expect(mockRunAgent).not.toHaveBeenCalled()
    expect(mockNotifyTelegram).not.toHaveBeenCalled()
  })

  it('still reports a broken source to the COORDINATOR, gate closed', async () => {
    mockDetectTransitions.mockReturnValue([
      { source: 'calendar', message: '[adatforras] calendar: ELROMLOTT.' },
    ])

    await executeHeartbeat()

    // The gate said "nothing to tell the owner" -- and the alarm spoke anyway.
    expect(gateClosed()).toBe(true)
    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
    const [from, , text] = mockCreateAgentMessage.mock.calls[0] as [string, string, string]
    expect(from).toBe('system')
    expect(text).toContain('ELROMLOTT')
    // The owner channel must NOT be used for this: a 2 a.m. buzz is exactly
    // what the coordinator-not-owner decision avoids.
    expect(mockNotifyTelegram).not.toHaveBeenCalled()
  })

  it('survives an alarm that THROWS, instead of dying with it', async () => {
    // Didi's Z4, as behaviour rather than as the presence of the word `catch`.
    mockDetectTransitions.mockImplementation(() => {
      throw new Error('a riaszto elszallt')
    })

    await expect(executeHeartbeat()).resolves.toBeUndefined()

    // Reaching the gate is the proof it kept going: the alarm sits before it.
    expect(gateClosed()).toBe(true)
    expect(mockLogWarn).toHaveBeenCalled()
  })
})
