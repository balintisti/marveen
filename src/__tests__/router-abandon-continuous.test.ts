// Router-level contract for card dd5a3f76: a pending message is abandoned only
// after the target session has been CONTINUOUSLY absent for the retry window.
//
// The old predicate was `!sessionExists && ageMs > windowMs`: an instantaneous
// reading. A context-guard restart tears the session down and rebuilds it in
// seconds, and a tick landing in that gap killed every message older than the
// window (measured 2026-09-20: abandon 14:35:57, new session 14:35:58) while the
// failure text claimed the session had been absent "for the entire retry
// window". These tests drive runMessageRouterTick across simulated ticks.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetPendingMessages = vi.fn()
const mockMarkDelivered = vi.fn((..._a: unknown[]) => true)
const mockMarkFailed = vi.fn((..._a: unknown[]) => true)
const mockCreateAgentMessage = vi.fn((..._a: unknown[]) => ({ id: 999 }))
const mockSendPrompt = vi.fn(async (..._a: unknown[]) => 'sent' as const)
// The session of the target agent, as tmux would answer it at this very tick.
let sessionAlive = true
// Whether the live session's prompt is ready (false = saturated pane, holds the message back).
let promptReady = true

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  MAIN_AGENT_ID: 'orin',
  SUBAGENT_TELEGRAM_WAKE_ENABLED: false,
}))

vi.mock('../db.js', () => ({
  getPendingMessages: (toAgent?: string) => {
    if (toAgent) return [] // per-agent query of the reconnect pre-pass
    return mockGetPendingMessages()
  },
  getMessageStatus: (_id: number) => 'pending',
  markMessageDelivered: (...a: unknown[]) => mockMarkDelivered(...a),
  markMessageFailed: (...a: unknown[]) => mockMarkFailed(...a),
  markMessageDone: (..._a: unknown[]) => true,
  markPendingFederatedFailed: (..._a: unknown[]) => true,
  setMessageResult: (..._a: unknown[]) => true,
  createAgentMessage: (...a: unknown[]) => mockCreateAgentMessage(...a),
  countNewerMessagesFromSameSender: (..._a: unknown[]) => 0,
  stampMessageTrace: (..._a: unknown[]) => false,
  upsertOtelSpan: (..._a: unknown[]) => undefined,
  closeOtelSpan: (..._a: unknown[]) => false,
}))

vi.mock('../web/voice-directive.js', () => ({
  resolveAgentChannelStateDir: () => '/tmp/none',
}))

vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [],
  readAgentRemoteHost: () => null,
  readAgentVoiceConfig: () => ({ responseMode: 'text' }),
  readAgentWorksourceChannel: () => false,
}))

vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentSessionName: (name: string) => `agent-${name}`,
  isSessionReadyForPrompt: vi.fn(async () => promptReady),
  clearStaleParkedInput: vi.fn(async () => false),
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...a),
  sessionExistsOnHost: (..._a: unknown[]) => sessionAlive,
  capturePane: (..._a: unknown[]) => '',
}))

vi.mock('../web/voice-modality.js', () => ({
  setLastInboundModality: vi.fn(),
}))

vi.mock('../web/main-agent.js', () => ({
  MAIN_CHANNELS_SESSION: 'orin-channels',
}))

vi.mock('../web/agent-message-wrap.js', () => ({
  classifyAgentMessage: () => ({ category: 'trusted-peer', safeFrom: 'orin' }),
  wrapAgentMessageForDelivery: () => ({ prefix: '', wrapped: 'payload' }),
}))

vi.mock('../web/telegram-inbox-wake.js', () => ({
  maybeWakeSubAgentsForTelegram: vi.fn(),
}))

const MIN = 60 * 1000
const T0 = Date.parse('2026-09-20T12:00:00Z')

// One message to a sub-agent, already older than the abandon window at T0.
function oldRow() {
  return [{
    id: 17523,
    from_agent: 'orin',
    to_agent: 'dex',
    content: 'payload',
    created_at: Math.floor((T0 - 2 * 60 * MIN) / 1000),
    origin_note: null,
    trace_id: null,
    span_id: null,
  }]
}

type Router = typeof import('../web/message-router.js')
let router: Router

// Advance the simulated clock and run one router tick against the given
// session state.
async function tickAt(offsetMs: number, alive: boolean) {
  vi.setSystemTime(T0 + offsetMs)
  sessionAlive = alive
  await router.runMessageRouterTick()
}

describe('message router: abandon needs CONTINUOUS absence for the window (card dd5a3f76)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    // The absent-since tracking is module state: a fresh module per test.
    vi.resetModules()
    router = await import('../web/message-router.js')
    mockMarkDelivered.mockReturnValue(true)
    mockMarkFailed.mockReturnValue(true)
    mockSendPrompt.mockImplementation(async () => 'sent' as const)
    mockGetPendingMessages.mockImplementation(() => oldRow())
    sessionAlive = true
    promptReady = true
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('a restart gap (one absent tick) does not kill an old pending message; it is delivered after reconnect', async () => {
    promptReady = false
    await tickAt(0, true)                 // session up but saturated: the message waits past the window
    await tickAt(5_000, false)            // context-guard restart: the one tick that sees no session
    expect(mockMarkFailed).not.toHaveBeenCalled()
    promptReady = true
    await tickAt(10_000, true)            // new session is up and idle
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockSendPrompt).toHaveBeenCalledTimes(1)
    expect(mockMarkDelivered.mock.calls[0][0]).toBe(17523)
  })

  it('an absence broken by a present tick restarts the clock', async () => {
    await tickAt(0, false)
    await tickAt(50 * MIN, false)         // 50 min absent so far
    await tickAt(55 * MIN, true)          // back for one tick
    await tickAt(70 * MIN, false)         // absent again: only just started
    await tickAt(100 * MIN, false)        // 30 min into the NEW absence, 100 min after the first
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('continuous absence for the whole window abandons, and the text states the measured duration', async () => {
    await tickAt(0, false)                // first seen absent
    await tickAt(59 * MIN, false)
    expect(mockMarkFailed).not.toHaveBeenCalled()
    await tickAt(61 * MIN, false)         // 61 min continuously absent
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
    const failText = String(mockMarkFailed.mock.calls[0][1])
    expect(failText).toContain('continuously absent for 61 min')
    expect(failText).toContain('retry window 60 min')
    expect(failText).not.toContain('full retry window')
    const notice = mockCreateAgentMessage.mock.calls.map((c) => String(c[2])).find((t) => t.startsWith('[handoff-failure]'))
    expect(notice).toContain('continuously absent for 61 min')
    expect(notice).not.toContain('entire retry window')
  })
})
