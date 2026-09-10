// THE ROUTER'S DELIVERY DECISION HAD NO ASSERTION AT ALL (card e94a209e).
//
// `message-router.ts` decides, per message, between TWO delivery paths:
//
//   main agent  -> PULL: the router `continue`s and leaves the message pending.
//                  The main agent drains its own inbox each turn. Injecting into
//                  its perpetually-busy channel session is the race that stalled
//                  inter-agent delivery to it for ~1h on a busy day.
//   sub-agent   -> tmux INJECT: they have idle gaps, so the router types into them.
//
// didi measured 2026-08-23 that inverting that one comparison broke NOTHING:
// zero tests failed across the whole suite. Re-measured on today's tree
// (2026-09-11) and it still holds -- 450 files / 5737 tests, EXIT=0 WITH the
// condition reversed. Three weeks, the line moved from :518 to :835, and the
// gap did not close.
//
// WHAT A REVERSAL WOULD DO IN PRODUCTION, which is why this is worth pinning:
// every sub-agent message would take the pull path -- `continue`d, never
// injected, and never even abandoned (the `continue` precedes shouldAbandon), so
// the queue would stall SILENTLY with no error. And the main agent would get the
// tmux inject its own docblock exists to prevent.
//
// THIS PINS THE DECISION, IT DOES NOT CHANGE IT. The pull model is a deliberate,
// documented upstream choice; the point is that a merge cannot flip it unnoticed.
//
// MEASURED FROM BEHAVIOUR, NOT SOURCE TEXT. An assertion on the source line would
// pass on a file that merely mentions it, and the router already carries a second
// copy of this concept -- `isPullModelRecipient` in recipient-advice.ts, whose own
// tests are behavioural. Deliberately NOT unified with it: marveen's ruling on
// this card is that calling the shared helper here would make the gap invisible
// WITHOUT filling it, since the decision branch would still carry no assertion.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetPendingMessages = vi.fn()
const mockMarkDelivered = vi.fn((..._a: unknown[]) => true)
const mockMarkFailed = vi.fn((..._a: unknown[]) => true)
const mockSendPrompt = vi.fn()

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
  markMessageDelivered: (...a: unknown[]) => mockMarkDelivered(...a),
  markMessageFailed: (...a: unknown[]) => mockMarkFailed(...a),
  markMessageDone: (..._a: unknown[]) => true,
  createAgentMessage: (..._a: unknown[]) => ({ id: 999 }),
  stampMessageTrace: (..._a: unknown[]) => false,
  upsertOtelSpan: (..._a: unknown[]) => undefined,
  closeOtelSpan: (..._a: unknown[]) => false,
}))

vi.mock('../web/voice-directive.js', () => ({ resolveAgentChannelStateDir: () => '/tmp/none' }))

vi.mock('../web/agent-config.js', () => ({
  readAgentRemoteHost: () => null,
  readAgentVoiceConfig: () => ({ responseMode: 'text' }),
  listAgentNames: () => [],
  agentDir: (name: string) => `/tmp/nonexistent-agents/${name}`,
}))

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isSessionReadyForPrompt: vi.fn(() => true),
  clearStaleParkedInput: vi.fn(() => false),
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...a),
  sessionExistsOnHost: (..._a: unknown[]) => true,
}))

vi.mock('../web/voice-modality.js', () => ({ setLastInboundModality: vi.fn() }))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'orin-channels' }))
vi.mock('../web/agent-message-wrap.js', () => ({
  classifyAgentMessage: () => ({ category: 'trusted-peer', safeFrom: 'orin' }),
  wrapAgentMessageForDelivery: () => ({ prefix: '', wrapped: 'BODY' }),
}))

import { runMessageRouterTick } from '../web/message-router.js'

const nowSec = () => Math.floor(Date.now() / 1000)
const msg = (id: number, to: string) => ({
  id, from_agent: to === 'orin' ? 'dex' : 'orin', to_agent: to, content: 'ping', created_at: nowSec(),
})

/** Every session name the router actually typed into this tick. */
const injectedSessions = () => mockSendPrompt.mock.calls.map((c) => String(c[0]))

describe('the router routes by RECIPIENT KIND, and the two paths are opposite', () => {
  beforeEach(() => vi.clearAllMocks())

  it('a SUB-agent message is injected into its own session', async () => {
    mockGetPendingMessages.mockReturnValue([msg(1, 'dex')])
    await runMessageRouterTick()
    expect(injectedSessions()).toContain('agent-dex')
  })

  it('a MAIN-agent message is NOT injected -- it is left for the pull model', async () => {
    // The inverted condition makes this one inject into 'orin-channels', which is
    // precisely the race the router's own docblock says it exists to avoid.
    mockGetPendingMessages.mockReturnValue([msg(2, 'orin')])
    await runMessageRouterTick()
    expect(injectedSessions()).toEqual([])
  })

  it('and it is not failed or abandoned either -- pending is the CORRECT resting state', async () => {
    // The `continue` precedes shouldAbandon, so a main-agent message must leave no
    // trace at all this tick. If a future change makes it "fail" instead, the queue
    // would look drained while nothing was delivered.
    mockGetPendingMessages.mockReturnValue([msg(3, 'orin')])
    await runMessageRouterTick()
    expect(mockMarkFailed).not.toHaveBeenCalled()
    expect(mockMarkDelivered).not.toHaveBeenCalled()
  })

  it('THE DISCRIMINATOR: mixed queue -- the sub-agent is typed to, the main agent is not', async () => {
    // One tick, both kinds. This is the case a reversal cannot survive: it does not
    // merely change a count, it SWAPS which of the two gets typed into.
    mockGetPendingMessages.mockReturnValue([msg(4, 'orin'), msg(5, 'dex')])
    await runMessageRouterTick()
    const sessions = injectedSessions()
    expect(sessions).toContain('agent-dex')
    expect(sessions).not.toContain('orin-channels')
  })
})
