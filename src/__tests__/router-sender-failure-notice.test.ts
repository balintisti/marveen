// Card cd404a64 (upstream 71263d15 A): when the router fails a message for good, the SENDER learns
// of it, not only the main agent. The id the sender got back on posting confirms acceptance, not
// delivery, so without this a lost message looked sent.
//
// Part 1 pins the pure rule (who gets a notice, what it says). Part 2 drives runMessageRouterTick
// over the three places that close a row as failed: continuous absence, repeated inject throws,
// and the fault-isolation catch.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetPendingMessages = vi.fn()
const mockMarkFailed = vi.fn((..._a: unknown[]) => true)
const mockCreateAgentMessage = vi.fn((..._a: unknown[]) => ({ id: 999 }))
const mockSendPrompt = vi.fn(async (..._a: unknown[]) => 'sent' as const)
let sessionAlive = true
let classifyThrows = false

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  MAIN_AGENT_ID: 'orin',
  SUBAGENT_TELEGRAM_WAKE_ENABLED: false,
}))

vi.mock('../db.js', () => ({
  getPendingMessages: (toAgent?: string) => (toAgent ? [] : mockGetPendingMessages()),
  getMessageStatus: (_id: number) => 'pending',
  markMessageDelivered: (..._a: unknown[]) => true,
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

vi.mock('../web/voice-directive.js', () => ({ resolveAgentChannelStateDir: () => '/tmp/none' }))

vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [],
  readAgentRemoteHost: () => null,
  readAgentVoiceConfig: () => ({ responseMode: 'text' }),
  readAgentWorksourceChannel: () => false,
}))

vi.mock('../web/agent-process.js', () => ({
  withTmuxBatch: (fn: () => unknown) => fn(),
  clearFeedbackModalAndRecheck: () => false,
  agentSessionName: (name: string) => `agent-${name}`,
  isSessionReadyForPrompt: vi.fn(async () => true),
  clearStaleParkedInput: vi.fn(async () => false),
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...a),
  sessionExistsOnHost: (..._a: unknown[]) => sessionAlive,
  capturePane: (..._a: unknown[]) => '',
}))

vi.mock('../web/voice-modality.js', () => ({ setLastInboundModality: vi.fn() }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'orin-channels' }))

// The real isChannelInboundSender (the rule under test uses it); only classify/wrap are faked.
vi.mock('../web/agent-message-wrap.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../web/agent-message-wrap.js')>()),
  classifyAgentMessage: () => {
    if (classifyThrows) throw new Error('boom in the delivery path')
    return { category: 'trusted-peer', safeFrom: 'geri' }
  },
  wrapAgentMessageForDelivery: () => ({ prefix: '', wrapped: 'payload' }),
}))

vi.mock('../web/telegram-inbox-wake.js', () => ({ maybeWakeSubAgentsForTelegram: vi.fn() }))

import { COORDINATOR_AGENT_ID, VOICE_CHANNEL_AGENT_ID } from '../channel-coordinator/ingest.js'
import type { AgentMessage } from '../db.js'

const MIN = 60 * 1000
const T0 = Date.parse('2026-10-23T08:00:00Z')

type Router = typeof import('../web/message-router.js')
let router: Router

describe('cd404a64: who may get a sender notice, and what it says', () => {
  beforeEach(async () => {
    vi.resetModules()
    router = await import('../web/message-router.js')
  })

  it('no receipt for system, the main agent, federated, channel-inbound or empty senders', () => {
    expect(router.shouldNotifySenderOfFailure('system', 'orin')).toBe(false)
    expect(router.shouldNotifySenderOfFailure('orin', 'orin')).toBe(false)
    expect(router.shouldNotifySenderOfFailure('peer/agent', 'orin')).toBe(false)
    expect(router.shouldNotifySenderOfFailure(COORDINATOR_AGENT_ID, 'orin')).toBe(false)
    expect(router.shouldNotifySenderOfFailure(VOICE_CHANNEL_AGENT_ID, 'orin')).toBe(false)
    expect(router.shouldNotifySenderOfFailure('', 'orin')).toBe(false)
  })

  it('an ordinary sub-agent sender gets one', () => {
    expect(router.shouldNotifySenderOfFailure('geri', 'orin')).toBe(true)
  })

  it('the notice says the id confirmed acceptance, and marks how much of the preview it cut', () => {
    const long = { id: 7, from_agent: 'geri', to_agent: 'dex', content: 'x'.repeat(300) } as AgentMessage
    const text = router.formatSenderFailureNotice(long, 'ok')
    expect(text.startsWith('[handoff-failure]')).toBe(true)
    expect(text).toContain('#7')
    expect(text).toContain('a befogadást igazolta, nem a kézbesítést')
    expect(text).toContain('[... +80 karakter]')
    const short = router.formatSenderFailureNotice({ ...long, content: 'rövid' } as AgentMessage, 'ok')
    expect(short).not.toContain('karakter]')
  })
})

describe('cd404a64: the router tells the sender when it closes a row as failed', () => {
  function row(over: Partial<AgentMessage> = {}) {
    return [{
      id: 17523,
      from_agent: 'geri',
      to_agent: 'dex',
      content: 'payload',
      created_at: Math.floor((T0 - 2 * 60 * MIN) / 1000),
      origin_note: null,
      trace_id: null,
      span_id: null,
      ...over,
    }]
  }
  const notices = () => mockCreateAgentMessage.mock.calls
    .filter((c) => String(c[2]).startsWith('[handoff-failure]'))
    .map((c) => ({ from: String(c[0]), to: String(c[1]), text: String(c[2]) }))

  async function tickAt(offsetMs: number, alive: boolean) {
    vi.setSystemTime(T0 + offsetMs)
    sessionAlive = alive
    await router.runMessageRouterTick()
  }
  async function abandonAfterAbsence() {
    await tickAt(0, false)
    await tickAt(61 * MIN, false)
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    vi.resetModules()
    router = await import('../web/message-router.js')
    mockMarkFailed.mockReturnValue(true)
    mockSendPrompt.mockImplementation(async () => 'sent' as const)
    mockGetPendingMessages.mockImplementation(() => row())
    sessionAlive = true
    classifyThrows = false
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('continuous absence: the orchestrator AND the sender are told, the sender in its own inbox', async () => {
    await abandonAfterAbsence()
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
    const n = notices()
    expect(n.map((x) => x.to).sort()).toEqual(['geri', 'orin'])
    const toSender = n.find((x) => x.to === 'geri')!
    expect(toSender.from).toBe('system')
    expect(toSender.text).toContain('(#17523)')
    expect(toSender.text).toContain('61 percig')
  })

  it('a failed message FROM system gets no sender notice (no loop), the orchestrator still hears', async () => {
    mockGetPendingMessages.mockImplementation(() => row({ from_agent: 'system' }))
    await abandonAfterAbsence()
    expect(notices().map((x) => x.to)).toEqual(['orin'])
  })

  it('a row closed concurrently (markMessageFailed returned false) earns no sender notice', async () => {
    mockMarkFailed.mockReturnValue(false)
    await abandonAfterAbsence()
    expect(notices().map((x) => x.to)).not.toContain('geri')
  })

  it('a quiet row (wake=0) stays quiet: no notice for it, while the waking row beside it is told', async () => {
    // A quiet row alone is not even evaluated (deliverableRows); it rides with a waking row to the same recipient.
    mockGetPendingMessages.mockImplementation(() => [
      ...row(),
      ...row({ id: 17524, wake: 0 }),
    ])
    await abandonAfterAbsence()
    expect(mockMarkFailed.mock.calls.map((c) => c[0]).sort()).toEqual([17523, 17524])
    const texts = notices().map((x) => x.text)
    expect(texts.some((t) => t.includes('(#17523)') && t.startsWith('[handoff-failure] A(z)'))).toBe(true)
    expect(texts.filter((t) => t.includes('#17524'))).toEqual([])
  })

  it('three inject failures give ONE sender notice, not three', async () => {
    mockSendPrompt.mockImplementation(async () => { throw new Error('tmux send-keys failed') })
    await tickAt(0, true)
    await tickAt(5_000, true)
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(notices()).toEqual([])
    await tickAt(10_000, true)
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
    const toSender = notices().filter((x) => x.to === 'geri')
    expect(toSender).toHaveLength(1)
    expect(toSender[0].text).toContain('3-szer elbukott')
  })

  it('the fault-isolation branch no longer fails a row silently: the sender is told', async () => {
    classifyThrows = true
    await tickAt(0, true)
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
    expect(String(mockMarkFailed.mock.calls[0][1])).toContain('Delivery error')
    const toSender = notices().filter((x) => x.to === 'geri')
    expect(toSender).toHaveLength(1)
    expect(toSender[0].text).toContain('kézbesítési hiba a routerben')
  })

  it('the fault-isolation branch: a row another writer closed first (markMessageFailed false) earns no sender notice', async () => {
    classifyThrows = true
    mockMarkFailed.mockReturnValue(false)
    await tickAt(0, true)
    expect(mockMarkFailed).toHaveBeenCalledTimes(1)
    expect(notices().map((x) => x.to)).not.toContain('geri')
  })
})
