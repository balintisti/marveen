import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// The prompt-prefix branch (schedule-runner.ts: `if (task.type === 'heartbeat')`
// and the nested `if (boundChatId)`), pinned by BEHAVIOUR -- on the prompt the
// agent actually receives.
//
// Why this file exists (card 9fc38d4b, 2026-08-24). The polarity sweep found
// both conditions among the 32 that survive an inversion against the full
// suite. The existing coverage is split in a way that looks complete and is
// not: schedule-runner-bound-chatid.test.ts proves the PURE CORE
// (chatIdFromAccessConfig) behaviourally, and then asserts the WIRING by
// reading the source text. A proven resolver plus a source-text join is the
// same gap b4898de5 documented -- both pieces correct, the join unmeasured.
//
// What the inversions actually do:
//   `task.type === 'heartbeat'` inverted -- heartbeats get the task prefix and
//     are told to report over Telegram (they are silent by design), while real
//     tasks get the bare heartbeat tag and their result never reaches anyone.
//   `boundChatId` inverted -- an agent WITH a binding loses the delivery
//     instruction, and one WITHOUT gets `chat_id: undefined`, which is the
//     revival of the dead `chat_id: 0` sentinel the resolver was built to kill.
//
// Three cases pin both conditions: 1 vs 2 fixes the heartbeat branch, 2 vs 3
// fixes the binding branch.
//
// No production code changes.

const mockSendPrompt = vi.fn((..._a: unknown[]) => 'sent')
const mockListScheduledTasks = vi.fn(() => [] as ScheduledTask[])

let tmpRoot: string

// Named so the ambiguity warn can be asserted: with two allowlist entries the
// bound chat is a GUESS (first wins), and the warn is the only thing that says
// so. Nothing pinned which way round it fires.
const mockWarn = vi.fn()

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => mockWarn(...a), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../web/atomic-write.js', () => ({ atomicWriteFileSync: vi.fn() }))

vi.mock('../db.js', () => ({
  appendTaskRun: vi.fn(),
  listPendingTaskRetries: () => [],
  deletePendingTaskRetry: vi.fn(),
  updatePendingTaskRetry: vi.fn(() => true),
  insertPendingTaskRetryIfNew: vi.fn(),
  markPendingTaskRetryAlert: vi.fn(() => false),
  clearPendingTaskRetryAlert: vi.fn(),
  markScheduledTaskKanbanWaiting: vi.fn(),
}))

vi.mock('../web/telegram.js', () => ({
  sendTelegramMessage: vi.fn(async () => {}),
  sendTelegramPhoto: vi.fn(async () => {}),
}))

vi.mock('../web/scheduled-tasks-io.js', () => ({
  listScheduledTasks: () => mockListScheduledTasks(),
  SCHEDULED_TASKS_DIR: '/tmp/marveen-prompt-prefix-no-tasks-dir',
}))

// The binding is resolved by READING access.json, so the test controls the
// real file rather than stubbing the resolver -- the resolver's own behaviour
// stays under test, and only its location is redirected.
// Keep the rest of the module intact: config.ts imports several other
// exports from it at load time, so a bare factory blanks them and the whole
// import graph dies before a single assertion runs.
vi.mock('../channel-provider.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../channel-provider.js')>()),
  channelStateDir: () => join(tmpRoot, 'telegram'),
}))

const SEP = '─'.repeat(80)
const HEALTHY_PANE = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n')

vi.mock('../web/agent-process.js', () => ({
  agentSessionName: (name: string) => `agent-${name}`,
  isAgentRunning: () => true,
  isSessionReadyForPrompt: () => true,
  sendPromptToSession: (...a: unknown[]) => mockSendPrompt(...(a as [])),
  startAgentProcess: vi.fn(() => ({ ok: true })),
  sessionExistsOnHost: () => true,
  capturePane: () => HEALTHY_PANE,
  sendEnterToSession: vi.fn(),
  clearStaleParkedInput: vi.fn(() => false),
}))

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    name: 'prefix-polarity-fixture',
    description: 'prompt prefix polarity fixture',
    prompt: 'Do the thing.',
    schedule: '30 10 * * *',
    agent: 'prefixagent',
    enabled: true,
    createdAt: 0,
    type: 'task',
    targetSession: 'prefix-polarity-session',
    ...overrides,
  } as ScheduledTask
}

function writeBinding(chatId: string | null) {
  writeAllowFrom(chatId ? [chatId] : [])
}

function writeAllowFrom(allowFrom: string[]) {
  const dir = join(tmpRoot, 'telegram')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'access.json'), JSON.stringify({ allowFrom, groups: {} }))
}

function ambiguityWarns() {
  return mockWarn.mock.calls.filter((c) => String(c[1] ?? '').includes('ambiguous')).length
}

async function deliveredPrompt(): Promise<string> {
  vi.resetModules()
  const { startScheduleRunner } = await import('../web/schedule-runner.js')
  const stop = startScheduleRunner()
  await vi.advanceTimersByTimeAsync(61_000)
  clearInterval(stop)
  expect(mockSendPrompt).toHaveBeenCalled()
  return String(mockSendPrompt.mock.calls[0]?.[1] ?? '')
}

describe('prompt prefix: heartbeats stay silent, tasks get a concrete chat', () => {
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'marveen-prefix-'))
    vi.stubEnv('SCHEDULER_TZ', 'Europe/Budapest')
    vi.stubEnv('MARVEEN_ROOT', tmpRoot)
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-31T08:29:30.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('a HEARTBEAT gets the bare tag and is never told to message Telegram', async () => {
    writeBinding('1268077055')
    mockListScheduledTasks.mockReturnValue([task({ type: 'heartbeat' })])
    const prompt = await deliveredPrompt()

    expect(prompt).toContain('[Heartbeat: prefix-polarity-fixture]')
    expect(prompt).not.toContain('Telegramon')
    expect(prompt).not.toContain('chat_id')
  })

  it('a TASK with a binding is told the CONCRETE chat id -- the half that fixes both polarities', async () => {
    writeBinding('1268077055')
    mockListScheduledTasks.mockReturnValue([task({ type: 'task' })])
    const prompt = await deliveredPrompt()

    expect(prompt).toContain('[Utemezett feladat: prefix-polarity-fixture]')
    expect(prompt).toContain('chat_id: 1268077055')
    expect(prompt).not.toContain('[Heartbeat:')
  })

  it('a TASK with NO binding omits the instruction rather than guessing a chat', async () => {
    writeBinding(null)
    mockListScheduledTasks.mockReturnValue([task({ type: 'task' })])
    const prompt = await deliveredPrompt()

    expect(prompt).toContain('[Utemezett feladat: prefix-polarity-fixture]')
    expect(prompt).not.toContain('chat_id')
    // The dead sentinel class: never ship a placeholder chat id.
    expect(prompt).not.toContain('undefined')
    expect(prompt).not.toMatch(/chat_id:\s*0[,)]/)
  })

  it('TWO allowlist entries make the bound chat a guess, and the runner says so', async () => {
    // First-entry-wins is a heuristic: access.json has no owner field, so a
    // reordering silently redirects task results to another person. The warn is
    // the only thing that makes the guess visible.
    writeAllowFrom(['1268077055', '999888777'])
    mockListScheduledTasks.mockReturnValue([task({ type: 'task' })])
    const prompt = await deliveredPrompt()

    expect(prompt).toContain('chat_id: 1268077055')
    expect(ambiguityWarns()).toBeGreaterThan(0)
  })

  it('ONE entry is not ambiguous -- no warn, or the signal becomes noise', async () => {
    // The other direction. A warn on every single-entry install would train the
    // reader to ignore it, which is how a real ambiguity gets missed.
    writeAllowFrom(['1268077055'])
    mockListScheduledTasks.mockReturnValue([task({ type: 'task' })])
    await deliveredPrompt()

    expect(ambiguityWarns()).toBe(0)
  })
})
