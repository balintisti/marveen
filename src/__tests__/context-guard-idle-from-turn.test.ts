// The context-guard's idle time is measured from the last TURN, not from the transcript's mtime
// (card 12aece6a). Measured 2026-09-20: a /name sweep wrote a rename into four agents' transcripts
// -- meta lines, two `system` lines and a local-command `user` line, zero `usage` -- and their
// ~21 hours of idleness read as 1 minute, so the idle-flush tier never reached its threshold.
// Each case below writes the file NOW (fresh mtime) and asserts on the value measureIdleMs returns:
// with the old mtime reading every one of them is "seconds".

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const FIXTURE = mkTmp('guard-idle-turn-')
const PROJECT_ROOT = '/Users/x/marveen'
const CONFIG = join(FIXTURE, 'channels-config')
const DIR = join(CONFIG, 'projects', '-Users-x-marveen')
const FILE = join(DIR, 'session.jsonl')

const HOUR = 3600_000

vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  const home = () => join(FIXTURE, 'home')
  return { ...actual, default: { ...actual, homedir: home }, homedir: home }
})
vi.mock('../web/inbound-probe.js', () => ({ mainConfigRoots: () => [CONFIG] }))
vi.mock('../config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  MAIN_AGENT_ID: 'marveen',
  PROJECT_ROOT,
}))
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../web/claude-plans.js', () => ({ resolveAgentConfigDirForRead: () => null }))

const iso = (ms: number) => new Date(ms).toISOString()
const turn = (atMs: number) =>
  JSON.stringify({ type: 'assistant', timestamp: iso(atMs), message: { usage: { input_tokens: 200_000 } } })
/** What a session rename writes, in the measured shape: meta lines without a timestamp, two
 *  system lines and a local-command user line, all of it now. No model call. */
const rename = (atMs: number) => [
  JSON.stringify({ type: 'custom-title', customTitle: 'Friday' }),
  JSON.stringify({ type: 'agent-name', agentName: 'Friday' }),
  JSON.stringify({ type: 'mode', mode: 'default' }),
  JSON.stringify({ type: 'permission-mode', permissionMode: 'bypassPermissions' }),
  JSON.stringify({ type: 'system', timestamp: iso(atMs), content: 'Session renamed' }),
  JSON.stringify({ type: 'system', timestamp: iso(atMs), content: 'Set session /name' }),
  JSON.stringify({ type: 'user', timestamp: iso(atMs), message: { content: '<command-name>/rename</command-name>' } }),
]
const write = (lines: string[], mtimeMs = Date.now()) => {
  mkdirSync(DIR, { recursive: true })
  writeFileSync(FILE, lines.join('\n') + '\n')
  utimesSync(FILE, new Date(mtimeMs), new Date(mtimeMs))
}

describe('measureIdleMs counts from the last turn, not from the file mtime (12aece6a)', () => {
  beforeEach(() => rmSync(DIR, { recursive: true, force: true }))
  afterAll(() => rmSync(FIXTURE, { recursive: true, force: true }))

  it('a renamed but idle session stays idle: ~21 hours, not the minute since the rename', async () => {
    const { measureIdleMs } = await import('../web/context-guard-runner.js')
    const now = Date.now()
    write([turn(now - 21 * HOUR), ...rename(now - 60_000)])
    const idle = measureIdleMs('marveen', now)
    expect(idle).not.toBeNull()
    expect(idle as number).toBeGreaterThan(20 * HOUR)
  })

  it('CONTROL: a session that just ran a turn reads as busy', async () => {
    const { measureIdleMs } = await import('../web/context-guard-runner.js')
    const now = Date.now()
    write([turn(now - 21 * HOUR), ...rename(now - 2 * HOUR), turn(now - 30_000)])
    const idle = measureIdleMs('marveen', now)
    expect(idle).not.toBeNull()
    expect(idle as number).toBeLessThan(60_000)
  })

  it('the session start is the floor: a session started after its last turn is idle only since then', async () => {
    const { measureIdleMs } = await import('../web/context-guard-runner.js')
    const now = Date.now()
    write([turn(now - 21 * HOUR), ...rename(now - 60_000)])
    const sinceSec = Math.floor((now - 10 * 60_000) / 1000)
    const idle = measureIdleMs('marveen', now, sinceSec)
    expect(idle).toBe(now - sinceSec * 1000)
  })

  it('a transcript last written before the session started is still a dead reading (6f362eb3)', async () => {
    const { measureIdleMs } = await import('../web/context-guard-runner.js')
    const now = Date.now()
    write([turn(now - 3 * HOUR)], now - 2 * HOUR)
    expect(measureIdleMs('marveen', now, Math.floor((now - HOUR) / 1000))).toBeNull()
    // CONTROL: the same file without a session start is measured
    expect(measureIdleMs('marveen', now)).toBeGreaterThan(2.9 * HOUR)
  })
})
