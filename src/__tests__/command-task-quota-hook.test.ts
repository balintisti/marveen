import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ScheduledTask } from '../web/scheduled-tasks-io.js'

// THE WIRE, NOT THE DECISION (card 0114968c, decision (B), 2026-08-23).
//
// The quota alarm's own logic is covered in data-source-alarm.test.ts, and the
// command-task failure policy is covered in command-task-eval.test.ts. What
// neither of them touches is the LINK between the two: that `runCommandTask`
// actually reads the quota snapshot and actually hands the transition to the
// coordinator.
//
// That link is the whole point of the decision. The alarm was moved onto the
// 10-minute command-task tick precisely BECAUSE the heartbeat has zero ticks
// between 23:00 and 09:00. A hook that is never called would reproduce the
// exact silent failure this card exists to remove -- and it would do so with
// 24 green tests standing behind it.
//
// So these tests run the real alarm module against a real (temporary) store
// directory, and only the outbound edges are faked.

const mockCreateAgentMessage = vi.fn()
const mockAppendTaskRun = vi.fn()

// CREATED BEFORE THE DYNAMIC IMPORT, ON PURPOSE. `data-source-alarm.ts` freezes
// its state-file path in a module-level const at import time. A STORE assigned
// later (in beforeEach) would leave that path pointing at `''`, i.e. the REPO
// ROOT -- which is exactly what the first version of this test did: it dropped
// two stray json files next to package.json and let state leak between cases.
// One directory for the whole file, wiped between tests, is the honest shape.
const STORE = mkdtempSync(join(tmpdir(), 'friday-quota-hook-'))

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../db.js', () => ({
  appendTaskRun: (...a: unknown[]) => mockAppendTaskRun(...a),
  createAgentMessage: (...a: unknown[]) => mockCreateAgentMessage(...a),
}))

// The owner-facing Telegram path is a different concern (and is off in tests:
// no bot token). Stubbed so a missing token cannot mask a hook failure.
vi.mock('../owner-chat.js', () => ({ resolveOwnerChatId: () => null }))
vi.mock('../web/telegram.js', () => ({ sendTelegramMessage: vi.fn(async () => undefined) }))

// STORE_DIR is read at call time by both modules under test, so pointing it at
// a temp directory keeps the real file logic and touches no live store.
vi.mock('../config.js', () => ({
  STORE_DIR: STORE,
  TELEGRAM_BOT_TOKEN: '',
  MAIN_AGENT_ID: 'marveen',
}))

const { runCommandTask } = await import('../web/command-task.js')

const TASK: ScheduledTask = {
  name: 'usage-snapshot',
  description: 'kvota-pillanatfelvetel',
  command: 'true',
  schedule: '*/10 * * * *',
  agent: 'system',
  type: 'command',
} as unknown as ScheduledTask

function writeSnapshot(body: Record<string, unknown>): void {
  writeFileSync(join(STORE, 'usage-latest.json'), JSON.stringify(body))
}

const NOW = Date.parse('2026-08-23T03:00:00Z')

beforeEach(() => {
  // The alarm is EDGE-driven, so a leftover state file from the previous case
  // would swallow the very transition under test.
  rmSync(join(STORE, 'data-source-alarm.json'), { force: true })
  rmSync(join(STORE, 'usage-latest.json'), { force: true })
  rmSync(join(STORE, 'command-task-health.json'), { force: true })
  mockCreateAgentMessage.mockClear()
  mockAppendTaskRun.mockClear()
})

afterAll(() => {
  rmSync(STORE, { recursive: true, force: true })
})

describe('runCommandTask -- the quota alarm rides the command-task tick', () => {
  it('reports a degraded meter to the COORDINATOR, without any heartbeat round', () => {
    writeSnapshot({ generated_at: new Date(NOW).toISOString(), claude: { ok: true, source: 'estimate' } })

    runCommandTask(TASK, NOW)

    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
    const [from, to, text] = mockCreateAgentMessage.mock.calls[0] as [string, string, string]
    expect(to).toBe('marveen')
    expect(from).toBe('system')
    expect(text).toContain('quota')
    expect(text).toContain('ELROMLOTT')
  })

  it('reports a STALE snapshot too -- the failure of the tick it rides on', () => {
    // 40 minutes old against a 10-minute cadence: the meter is not running.
    // Without this the alarm would die together with the task that feeds it.
    writeSnapshot({
      generated_at: new Date(NOW - 40 * 60_000).toISOString(),
      claude: { ok: true, source: 'authoritative' },
    })

    runCommandTask(TASK, NOW)

    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
    expect(String(mockCreateAgentMessage.mock.calls[0]![2])).toContain('elavult snapshot')
  })

  it('says nothing when the meter is healthy, and nothing again on the next tick', () => {
    writeSnapshot({ generated_at: new Date(NOW).toISOString(), claude: { ok: true, source: 'authoritative' } })

    runCommandTask(TASK, NOW)
    runCommandTask(TASK, NOW + 600_000)

    expect(mockCreateAgentMessage).not.toHaveBeenCalled()
  })

  it('is EDGE-driven: a meter that stays broken is announced once, not every 10 minutes', () => {
    writeSnapshot({ generated_at: new Date(NOW).toISOString(), claude: { ok: true, source: 'estimate' } })

    runCommandTask(TASK, NOW)
    writeSnapshot({ generated_at: new Date(NOW + 600_000).toISOString(), claude: { ok: true, source: 'estimate' } })
    runCommandTask(TASK, NOW + 600_000)
    writeSnapshot({ generated_at: new Date(NOW + 1_200_000).toISOString(), claude: { ok: true, source: 'estimate' } })
    runCommandTask(TASK, NOW + 1_200_000)

    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
  })

  it('fires on ANY command task, not only one named usage-snapshot', () => {
    // Binding the hook to the task NAME would make a rename silence it, which
    // is the same class of failure as the one being fixed.
    writeSnapshot({ generated_at: new Date(NOW).toISOString(), claude: { ok: true, source: 'estimate' } })

    runCommandTask({ ...TASK, name: 'some-other-check' } as ScheduledTask, NOW)

    expect(mockCreateAgentMessage).toHaveBeenCalledTimes(1)
  })

  it('stays silent when there is no snapshot at all, instead of inventing a failure', () => {
    // No file means the meter has never run here (fresh install), which is not
    // the same claim as "the meter broke".
    runCommandTask(TASK, NOW)

    expect(mockCreateAgentMessage).not.toHaveBeenCalled()
  })

  it('an alarm failure does not stop the command task itself from being recorded', () => {
    writeFileSync(join(STORE, 'usage-latest.json'), '{ this is not json')

    expect(() => runCommandTask(TASK, NOW)).not.toThrow()
    expect(mockAppendTaskRun).toHaveBeenCalledTimes(1)
  })
})
