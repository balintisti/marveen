// Card a85a9acd: the router injects a quiet (wake=0) row only in the company of a waking row for
// the same recipient. Delivering IS the wake for a sub-agent, so a recipient with nothing but
// quiet rows must get nothing. Real tick, mocked tmux and database, like the fair-window test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetPendingMessages = vi.fn()
const mockMarkDelivered = vi.fn((..._a: unknown[]) => true)
const mockSendPrompt = vi.fn(async (..._a: unknown[]) => 'sent' as const)
const mockCreateMessage = vi.fn((..._a: unknown[]) => ({ id: 999 }))
const mockExpire = vi.fn((..._a: unknown[]) => 0)
const mockMarkFailed = vi.fn((..._a: unknown[]) => true)
const liveStatus = new Map<number, string | null>()
let sessionUp = true

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
    const all = mockGetPendingMessages() as Array<{ id: number; to_agent: string }>
    return toAgent ? all.filter((r) => r.to_agent === toAgent && liveStatus.get(r.id) === 'pending') : all
  },
  getMessageStatus: (id: number) => liveStatus.get(id) ?? null,
  markMessageDelivered: (...a: unknown[]) => mockMarkDelivered(...a),
  markMessageFailed: (...a: unknown[]) => mockMarkFailed(...a),
  markMessageDone: (..._a: unknown[]) => true,
  markPendingFederatedFailed: (..._a: unknown[]) => true,
  setMessageResult: (..._a: unknown[]) => true,
  createAgentMessage: (...a: unknown[]) => mockCreateMessage(...a),
  expireUnwokenMessages: (...a: unknown[]) => mockExpire(...a),
  countNewerMessagesFromSameSender: (..._a: unknown[]) => 0,
  stampMessageTrace: (..._a: unknown[]) => false,
  upsertOtelSpan: (..._a: unknown[]) => undefined,
  closeOtelSpan: (..._a: unknown[]) => false,
  getLastOutboundMessageAt: (..._a: unknown[]) => null,
}))
vi.mock('../web/voice-directive.js', () => ({ resolveAgentChannelStateDir: () => '/tmp/none' }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => [],
  readAgentRemoteHost: () => null,
  readAgentVoiceConfig: () => ({ responseMode: 'text' }),
  readAgentWorksourceChannel: () => false,
}))
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentSessionName: (name: string) => `agent-${name}`,
  isSessionReadyForPrompt: vi.fn(async () => true),
  clearStaleParkedInput: vi.fn(async () => false),
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...a),
  sessionExistsOnHost: (..._a: unknown[]) => sessionUp,
  capturePane: (..._a: unknown[]) => '',
}))
vi.mock('../web/voice-modality.js', () => ({ setLastInboundModality: vi.fn() }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'orin-channels' }))
vi.mock('../web/agent-message-wrap.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../web/agent-message-wrap.js')>()
  return { ...real, classifyAgentMessage: (from: string) => ({ category: 'trusted-peer', safeFrom: from }) }
})
vi.mock('../web/telegram-inbox-wake.js', () => ({ maybeWakeSubAgentsForTelegram: vi.fn() }))

import { runMessageRouterTick, sweepUnwokenExpiry, _resetUnwokenExpiryForTest, readStuckEvidence } from '../web/message-router.js'
import type { AgentMessage } from '../db.js'

const NOW_SEC = Math.floor(Date.now() / 1000)
function row(id: number, to: string, wake: number, ageS = 60): AgentMessage {
  return {
    id, from_agent: 'system', to_agent: to, content: `payload ${id}`, created_at: NOW_SEC - ageS, wake,
    origin_note: null, trace_id: null, span_id: null,
  } as unknown as AgentMessage
}
function load(rows: AgentMessage[]) {
  for (const r of rows) liveStatus.set(r.id, 'pending')
  mockGetPendingMessages.mockReturnValue(rows)
}
const deliveredIds = () => mockMarkDelivered.mock.calls.map((c) => c[0])
const sessions = () => mockSendPrompt.mock.calls.map((c) => c[0])

describe('router tick: quiet rows (card a85a9acd)', () => {
  const env = { ...process.env }
  beforeEach(() => {
    vi.clearAllMocks(); liveStatus.clear(); sessionUp = true
    mockMarkDelivered.mockReturnValue(true)
    mockSendPrompt.mockImplementation(async () => 'sent' as const)
    process.env.ROUTER_BATCH_INJECT_AGENTS = 'nobody-opted-in'
    _resetUnwokenExpiryForTest()
  })
  afterEach(() => { process.env = { ...env } })

  it('POSITIVE CONTROL: a waking row to an idle sub-agent is injected and marked delivered', async () => {
    load([row(1, 'eve', 1)])
    await runMessageRouterTick()
    expect(sessions()).toEqual(['agent-eve'])
    expect(deliveredIds()).toEqual([1])
  })

  it('a recipient with ONLY quiet rows gets nothing injected and nothing marked', async () => {
    load([row(1, 'eve', 0), row(2, 'eve', 0)])
    await runMessageRouterTick()
    expect(mockSendPrompt).not.toHaveBeenCalled()
    expect(mockMarkDelivered).not.toHaveBeenCalled()
  })

  it('a quiet row is delivered together with a waking row of the same recipient', async () => {
    load([row(1, 'eve', 0), row(2, 'eve', 1)])
    await runMessageRouterTick()
    expect(deliveredIds()).toEqual([1, 2])
    expect(sessions().every((s) => s === 'agent-eve')).toBe(true)
  })

  it("another recipient's waking row does not carry eve's quiet row", async () => {
    load([row(1, 'eve', 0), row(2, 'dex', 1)])
    await runMessageRouterTick()
    expect(sessions()).toEqual(['agent-dex'])
    expect(deliveredIds()).toEqual([2])
  })

  it('a batch injection pulls the quiet row into the same injection as the waking one', async () => {
    process.env.ROUTER_BATCH_INJECT_AGENTS = 'eve'
    load([row(1, 'eve', 1), row(2, 'eve', 0)])
    await runMessageRouterTick()
    expect(mockSendPrompt).toHaveBeenCalledTimes(1)
    expect(deliveredIds().sort()).toEqual([1, 2])
  })

  it('a quiet-only recipient costs no window slot: 25 quiet rows do not starve eve', async () => {
    load([...Array.from({ length: 30 }, (_, i) => row(i + 1, 'dex', 0)), row(31, 'eve', 1)])
    await runMessageRouterTick()
    expect(deliveredIds()).toEqual([31])
  })

  it('the window can cut a recipient\'s waking row off: its quiet row then waits, it is not sent alone', async () => {
    // eve: quiet row oldest, waking row newest. 30 other recipients sit between them, so the
    // 25-slot window takes eve's OLDEST row (the quiet one) and not her waking one.
    const others = Array.from({ length: 30 }, (_, i) => row(i + 10, `r${i}`, 1, 500))
    load([row(1, 'eve', 0, 600), ...others, row(2, 'eve', 1, 100)])
    await runMessageRouterTick()
    expect(deliveredIds()).not.toContain(1)
    expect(sessions()).not.toContain('agent-eve')
    expect(deliveredIds()).toHaveLength(24)
  })

  it('an absent recipient with only quiet rows is not failed and raises no handoff-failure', async () => {
    sessionUp = false
    // older than any abandon window
    load([row(1, 'eve', 0, 30 * 24 * 3600)])
    await runMessageRouterTick()
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockCreateMessage).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL: the same ancient row, waking, IS abandoned and reported', async () => {
    sessionUp = false
    load([row(1, 'eve', 1, 30 * 24 * 3600)])
    await runMessageRouterTick()
    expect(mockMarkFailed).toHaveBeenCalled()
    expect(mockCreateMessage.mock.calls.some((c) => String(c[2]).startsWith('[handoff-failure]'))).toBe(true)
  })

  it('a quiet row that rides with an abandoned waking row fails WITHOUT a notice of its own', async () => {
    sessionUp = false
    load([row(1, 'eve', 1, 30 * 24 * 3600), row(2, 'eve', 0, 30 * 24 * 3600)])
    await runMessageRouterTick()
    expect(mockMarkFailed.mock.calls.map((c) => c[0]).sort()).toEqual([1, 2])
    const notices = mockCreateMessage.mock.calls.filter((c) => String(c[2]).startsWith('[handoff-failure]'))
    expect(notices).toHaveLength(1)
    expect(String(notices[0][2])).toContain('(id 1)')
  })
})

describe('sweepUnwokenExpiry: throttled, fenced, called from the tick', () => {
  beforeEach(() => { vi.clearAllMocks(); liveStatus.clear(); sessionUp = true; _resetUnwokenExpiryForTest(); mockGetPendingMessages.mockReturnValue([]) })

  it('runs the expiry through the tick, and at most once a minute', async () => {
    await runMessageRouterTick()
    await runMessageRouterTick()
    expect(mockExpire).toHaveBeenCalledTimes(1)
    expect(sweepUnwokenExpiry(Date.now() + 61_000)).toBe(0)
    expect(mockExpire).toHaveBeenCalledTimes(2)
  })

  it('a throwing sweep costs nothing: the tick still delivers', async () => {
    mockExpire.mockImplementationOnce(() => { throw new Error('db locked') })
    load([row(1, 'eve', 1)])
    await runMessageRouterTick()
    expect(deliveredIds()).toEqual([1])
  })
})

describe('the other pending readers inside the router (card a85a9acd)', () => {
  beforeEach(() => {
    vi.clearAllMocks(); liveStatus.clear(); sessionUp = true; _resetUnwokenExpiryForTest()
    mockMarkDelivered.mockReturnValue(true)
    process.env.ROUTER_BATCH_INJECT_AGENTS = 'nobody-opted-in'
  })

  it('stuck-session evidence reports the oldest WAKING row, not a day-old quiet one', () => {
    load([row(1, 'eve', 0, 86_000), row(2, 'eve', 1, 120)])
    const ev = readStuckEvidence('eve')
    expect(ev?.oldestPendingAgeSec).toBeGreaterThanOrEqual(120)
    expect(ev?.oldestPendingAgeSec).toBeLessThan(600)
  })

  it('stuck-session evidence with only quiet rows reports no pending age', () => {
    load([row(1, 'eve', 0, 86_000)])
    expect(readStuckEvidence('eve')?.oldestPendingAgeSec).toBeNull()
  })

  // Reconnect backlog batching: more than 5 pending, oldest over 30 min, agent just came back.
  async function reconnect(agent: string, rows: AgentMessage[]) {
    sessionUp = false
    load(rows)
    await runMessageRouterTick()           // absent: remembered
    sessionUp = true
    mockCreateMessage.mockClear()
    await runMessageRouterTick()           // present again: reconnect pre-pass
  }

  it('POSITIVE CONTROL: a reconnecting agent with a big waking backlog gets ONE summary message', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 1, 'rc-a', 1, 40 * 60))
    await reconnect('rc-a', rows)
    expect(mockCreateMessage.mock.calls.filter((c) => c[1] === 'rc-a')).toHaveLength(1)
  })

  it('a reconnecting agent whose big backlog is ALL quiet is not summarised or delivered to', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(i + 101, 'rc-b', 0, 40 * 60))
    await reconnect('rc-b', rows)
    expect(mockCreateMessage.mock.calls.filter((c) => c[1] === 'rc-b')).toHaveLength(0)
    expect(mockSendPrompt).not.toHaveBeenCalled()
  })
})
