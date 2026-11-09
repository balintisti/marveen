import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

// Card 22d2288a (didi, verdict 56889): the exclusion of the guard's own rows from the restart-loss
// window keys on the first characters of the body, `substr(content, 1, 40)` in db.ts. A hand-written
// row proves the regex, not that the guard's REAL prompts start with the tag: a builder that gains a
// prefix would drop out of the exclusion and wake the coordinator again. So the heads come from the
// six real builders, cut the way the query cuts them.
const SANDBOX = mkTmp('guard-prompt-heads-test-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
const getAgentCommentsSince = vi.fn()
const getAgentMessagesSince = vi.fn()
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getAgentCommentsSince, getAgentMessagesSince }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  // The not-ready-path modal clear: false = no modal, so every caller keeps
  // its existing skip/busy behaviour and these fixtures are unaffected.
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'stopped',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => null,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
  paneEchoesInput: async () => 'echoed',
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))



const { resumePrompt, handoffPrompt, idleFlushHandoffPrompt, dailyHandoffPrompt, subagentGateHandoffPrompt, staleRefreshHandoffPrompt } =
  await import('../web/context-guard-runner.js')
const { restartLossNeedsAction } = await import('../context-guard.js')

const RESTART = Date.UTC(2026, 10, 9, 8, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)
const H = '/Users/isti/marveen/agents/dexter/HANDOFF.md'
const T = '/Users/isti/marveen/agents/dexter/HANDOFF-RESTART-TAIL.md'

const builders: [string, () => string][] = [
  ['handoffPrompt (act tier)', () => handoffPrompt(93, H)],
  ['idleFlushHandoffPrompt', () => idleFlushHandoffPrompt(501_234, 45, H)],
  ['dailyHandoffPrompt', () => dailyHandoffPrompt('04:00', H)],
  ['subagentGateHandoffPrompt', () => subagentGateHandoffPrompt(80, H)],
  ['staleRefreshHandoffPrompt', () => staleRefreshHandoffPrompt(37, H)],
  ['resumePrompt, fresh handoff', () => resumePrompt('dexter', H, true)],
  ['resumePrompt, stale handoff + tail', () => resumePrompt('dexter', H, true, 42, T)],
  ['resumePrompt, no handoff', () => resumePrompt('dexter', H, false)],
]

// What getRestartLossCandidates selects: the first 40 characters, delivered inside the window.
const row = (from: string, content: string) => ({
  id: 1, status: 'delivered', created_at: sec(RESTART - 180_000), delivered_at: sec(RESTART - 180_000),
  from_agent: from, head: content.slice(0, 40),
})

describe('the guard\'s own prompts, cut to the 40-character head the query reads', () => {
  it.each(builders)('%s: a system row with this head needs no action', (_n, make) => {
    expect(restartLossNeedsAction([row('system', make())], RESTART)).toBe(false)
  })

  // The same text from a real sender is a request, so the exclusion is by sender AND tag.
  it.each(builders)('%s: CONTROL, the same head from an agent needs action', (_n, make) => {
    expect(restartLossNeedsAction([row('didi', make())], RESTART)).toBe(true)
  })

  it('every real prompt starts with the tag (the property the exclusion relies on)', () => {
    for (const [, make] of builders) expect(make().startsWith('[CONTEXT-GUARD] ')).toBe(true)
  })
})
