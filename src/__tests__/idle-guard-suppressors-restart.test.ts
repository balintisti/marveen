// Card e6045a1b: the suppressors the guard persists come back through the real tick() after a
// restart. Before the fix the watcher restored only idleSinceMs / lastAlertAt / lastWakeAt, so a
// restart re-sent the pull notice and the first-of-spell live notice the previous process had
// already sent.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { MAIN_AGENT_ID } from '../config.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suppressors-restart-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  // the repeat path writes the daily digest here; without the directory it falls back to a message
  fs.mkdirSync(path.join(tmp, 'root', 'store'))
  return {
    tmp,
    orphans: [] as string[],
    stored: null as Record<string, unknown> | null,
    createAgentMessage: vi.fn(),
    saveIdleGuardState: vi.fn(),
  }
})
tmpDirs().adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => 'pane', isAgentRunning: () => true }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: () => 'idle', busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false, runningBackgroundWork: () => 0,
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  getLastOutboundMessageAt: () => null,
  listKanbanCards: () => h.orphans.map((id) => ({
    id, title: `t-${id}`, status: 'planned', assignee: null, priority: 'normal',
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: null, project: null,
  })),
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => { h.createAgentMessage(...a); return { id: 1 } },
  saveIdleGuardState: (...a: unknown[]) => h.saveIdleGuardState(...a),
  loadIdleGuardState: () => h.stored,
}))

/** What the previous process wrote: idle for an hour, so a decision is due on this tick. */
function stored(over: Record<string, unknown>): Record<string, unknown> {
  const now = Date.now()
  return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, updatedAt: now, ...over }
}
/** A fresh module graph each time: the watcher's in-memory map is empty, exactly as after a restart. */
async function firstTickAfterRestart(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}
const pullNoticesToX = () =>
  h.createAgentMessage.mock.calls.filter((c) => c[1] === 'x' && String(c[2]).includes('GAZDATLAN'))
const digestPath = () => `${h.tmp}/root/store/idle-digest.jsonl`
// x's lines only: the coordinator is in the sweep too and gets the same stored row from the mock
const digestLines = () => existsSync(digestPath())
  ? readFileSync(digestPath(), 'utf8').trim().split('\n').filter((l) => JSON.parse(l).agent === 'x')
  : []
const liveNoticesToCoordinator = () =>
  h.createAgentMessage.mock.calls.filter((c) => c[1] === MAIN_AGENT_ID && String(c[2]).includes('x'))

describe('e6045a1b: the first tick after a restart honours the stored suppressors', () => {
  beforeEach(() => {
    h.orphans = []; h.stored = null; h.createAgentMessage.mockReset(); h.saveIdleGuardState.mockReset(); rmSync(digestPath(), { force: true })
  })

  it('a pull notice sent 5 minutes before the restart is not repeated (lastNoWorkNoticeAt)', async () => {
    h.orphans = ['nrm00001']
    h.stored = stored({ lastNoWorkNoticeAt: Date.now() - 5 * 60_000, lastNoWorkNoticeIds: ['nrm00001'] })
    await firstTickAfterRestart()
    expect(pullNoticesToX()).toHaveLength(0)
  })

  it('CONTROL: with no stored notice time the same board does send the pull notice', async () => {
    h.orphans = ['nrm00001']
    h.stored = stored({})
    await firstTickAfterRestart()
    expect(pullNoticesToX()).toHaveLength(1)
  })

  it('past realertMs, an unchanged pull list is still not news (lastNoWorkNoticeIds)', async () => {
    h.orphans = ['nrm00001']
    h.stored = stored({ lastNoWorkNoticeAt: Date.now() - 40 * 60_000, lastNoWorkNoticeIds: ['nrm00001'] })
    await firstTickAfterRestart()
    expect(pullNoticesToX()).toHaveLength(0)
  })

  it('CONTROL: past realertMs, a CHANGED pull list is sent', async () => {
    h.orphans = ['nrm00001']
    h.stored = stored({ lastNoWorkNoticeAt: Date.now() - 40 * 60_000, lastNoWorkNoticeIds: ['other001'] })
    await firstTickAfterRestart()
    expect(pullNoticesToX()).toHaveLength(1)
  })

  it('the live first-of-spell notice to the coordinator is not re-sent for the same spell (noWorkLiveSpellSince)', async () => {
    const s = stored({})
    h.stored = { ...s, noWorkLiveSpellSince: s.idleSinceMs }
    await firstTickAfterRestart()
    expect(liveNoticesToCoordinator()).toHaveLength(0)
    expect(digestLines()).toHaveLength(1)
  })

  it('CONTROL: a different spell stamp lets the live notice out', async () => {
    const s = stored({})
    h.stored = { ...s, noWorkLiveSpellSince: (s.idleSinceMs as number) - 1 }
    await firstTickAfterRestart()
    expect(liveNoticesToCoordinator()).toHaveLength(1)
    expect(digestLines()).toHaveLength(0)
  })

  it('the live-notice stamp is persisted on the tick that sent it, not one tick later', async () => {
    const s = stored({})
    h.stored = s
    await firstTickAfterRestart()
    expect(liveNoticesToCoordinator()).toHaveLength(1)
    const rowsForX = h.saveIdleGuardState.mock.calls.filter((c) => c[0] === 'x')
    expect(rowsForX.at(-1)?.[1]).toMatchObject({ noWorkLiveSpellSince: s.idleSinceMs })
  })
})
