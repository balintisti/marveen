// A delivery sendPromptToSession WITHHELD (a tool-permission prompt was on screen) must not be
// marked delivered -- the message would be lost silently. Card 2a8cb07f. The mocks are the ones
// message-router-tick-cap.test.ts uses, with the receiver present and ready (the race window:
// ready at the check, a prompt by the time of the send).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetPendingMessages = vi.fn()
const mockMarkDelivered = vi.fn((..._a: unknown[]) => true)
const mockMarkFailed = vi.fn((..._a: unknown[]) => true)
const mockSessionExistsOnHost = vi.fn((..._a: unknown[]) => true)
const mockSend = vi.fn()

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  MAIN_AGENT_ID: 'orin',
  // message-router imports maybeWakeSubAgentsForTelegram, which reads this flag
  // from config; keep it OFF so the wake watcher early-returns and this test
  // stays isolated to the per-tick message cap.
  SUBAGENT_TELEGRAM_WAKE_ENABLED: false,
}))

vi.mock('../db.js', () => ({
  getPendingMessages: (toAgent?: string) => {
    if (toAgent) return [] // per-agent query for reconnect pre-pass
    return mockGetPendingMessages()
  },
  markMessageDelivered: (...a: unknown[]) => mockMarkDelivered(...a),
  markMessageFailed: (...a: unknown[]) => mockMarkFailed(...a),
  markMessageDone: (..._a: unknown[]) => true,
  createAgentMessage: (..._a: unknown[]) => ({ id: 999 }),
  // card def5a189: OTel trace stubs -- no-ops in this test
  stampMessageTrace: (..._a: unknown[]) => false,
  upsertOtelSpan: (..._a: unknown[]) => undefined,
  closeOtelSpan: (..._a: unknown[]) => false,
  // the merged router (88c366f2) reads these on the delivery path
  countNewerMessagesFromSameSender: (..._a: unknown[]) => 0,
  getMessageStatus: (..._a: unknown[]) => 'pending',
  markPendingFederatedFailed: (..._a: unknown[]) => 0,
  setMessageResult: (..._a: unknown[]) => true,
}))

vi.mock('../web/voice-directive.js', () => ({
  resolveAgentChannelStateDir: () => '/tmp/none',
}))

vi.mock('../web/agent-config.js', () => ({
  readAgentRemoteHost: () => null,
  readAgentVoiceConfig: () => ({ responseMode: 'text' }),
  // Added for the quiet-agent busy-stuck sweep (card bd7de2ba). Empty on
  // purpose: this file measures the per-tick MESSAGE cap, and a sweep with a
  // population would add tmux probes that have nothing to do with that cap.
  listAgentNames: () => [],
  agentDir: (name: string) => `/tmp/nonexistent-agents/${name}`,
  // the merged router asks this first; false = the tmux path, which is the one this file measures
  readAgentWorksourceChannel: () => false,
}))

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isSessionReadyForPrompt: vi.fn(() => true),
  clearStaleParkedInput: vi.fn(() => false),
  sendPromptToSession: (...a: unknown[]) => mockSend(...a),
  sessionExistsOnHost: (...a: unknown[]) => mockSessionExistsOnHost(...a),
}))

vi.mock('../web/voice-modality.js', () => ({
  setLastInboundModality: vi.fn(),
}))

vi.mock('../web/main-agent.js', () => ({
  MAIN_CHANNELS_SESSION: 'orin-channels',
}))

vi.mock('../web/agent-message-wrap.js', () => ({
  classifyAgentMessage: () => ({ category: 'trusted-peer', safeFrom: 'orin' }),
  wrapAgentMessageForDelivery: () => ({ prefix: '', wrapped: '' }),
}))

import { runMessageRouterTick } from '../web/message-router.js'

const pending = () => [{ id: 7, from_agent: 'orin', to_agent: 'dex', content: 'ping', created_at: Math.floor(Date.now() / 1000) }]

describe('the router does not mark a WITHHELD delivery as delivered (2a8cb07f)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSessionExistsOnHost.mockReturnValue(true)
    mockMarkDelivered.mockReturnValue(true)
    mockGetPendingMessages.mockReturnValue(pending())
  })

  it('a permission prompt on screen: nothing typed, and the message STAYS PENDING', async () => {
    mockSend.mockResolvedValue('withheld-permission')
    await runMessageRouterTick()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockMarkDelivered).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('CONTROL: a sent delivery is marked delivered (the harness reaches the send)', async () => {
    mockSend.mockResolvedValue('sent')
    await runMessageRouterTick()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockMarkDelivered).toHaveBeenCalledWith(7)
  })
})

// The merged router (88c366f2) has a SECOND tmux send: the multi-envelope batch, which marks the
// head AND every mate delivered after one send. A withheld batch must leave all of them pending.
describe('the multi-envelope batch path does not mark a WITHHELD batch delivered either', () => {
  const two = () => [
    { id: 7, from_agent: 'orin', to_agent: 'dex', content: 'ping', created_at: Math.floor(Date.now() / 1000) },
    { id: 8, from_agent: 'orin', to_agent: 'dex', content: 'pong', created_at: Math.floor(Date.now() / 1000) },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ROUTER_BATCH_INJECT_AGENTS', 'dex')
    mockSessionExistsOnHost.mockReturnValue(true)
    mockMarkDelivered.mockReturnValue(true)
    mockGetPendingMessages.mockReturnValue(two())
  })
  afterEach(() => { vi.unstubAllEnvs() })

  it('a permission prompt on screen: ONE withheld send, and neither the head nor the mate is delivered', async () => {
    mockSend.mockResolvedValue('withheld-permission')
    await runMessageRouterTick()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockMarkDelivered).not.toHaveBeenCalled()
    expect(mockMarkFailed).not.toHaveBeenCalled()
  })

  it('CONTROL: a sent batch is ONE send and marks both delivered (the batch path is really taken)', async () => {
    mockSend.mockResolvedValue('sent')
    await runMessageRouterTick()
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockMarkDelivered).toHaveBeenCalledWith(7)
    expect(mockMarkDelivered).toHaveBeenCalledWith(8)
  })
})
