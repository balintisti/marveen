// Card ad730515: detached background work (nohup / disown, reparented to launchd) holds the idle
// guard like footer work does. Fixtures are the 2026-10-14 measurement: jarvis's whisper job, the
// mandark adb server, the dashboard and the tmux server.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  parsePs, busyDetachedGroups, attributeDetached, parseLsofCwd, parseLaunchctlPids, type DetachedGroup,
} from '../web/detached-work.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const PS = [
  '    1     0     1   0,0 16-04:57:15 /sbin/launchd',
  ' 1066     1  1066   0,0 16-04:55:16 /opt/homebrew/bin/tmux new-session -d -s marveen-channels',
  ' 2182     1  2182   0,0 14-21:39:06 adb -L tcp:5037 fork-server server --reply-fd 4',
  '46912     1 46912   1,9    18:00:44 /opt/homebrew/opt/node@22/bin/node /Users/isti/marveen/dist/index.js',
  '50341     1 50339   0,0    21:11:33 bash wjob4.sh /Users/Shared/marveen-jarvis/research/x',
  '50345 50341 50339   0,0    21:11:33 xargs -P1 -I{} bash -c one "$@" _ {}',
  '90053 50345 50339   0,0    03:15:58 bash -c one "$@" _ KFf-2wD0X0k',
  '90056 90053 50339 204,5    03:15:58 /opt/homebrew/bin/whisper KFf-2wD0X0k.mp3 --model small',
  '47300 47290 47300  12,0    05:00:00 claude',
  '47400 47300 47300  30,0    05:00:00 bun run telegram',
].join('\n')
const CWD = new Map<number, string>([
  [1066, '/Users/isti/marveen'], [2182, '/Users/Shared/marveen-mandark'], [46912, '/Users/isti/marveen'],
  [50341, '/Users/Shared/marveen-jarvis/research/x'], [90056, '/Users/Shared/marveen-jarvis/research/x/wh'],
])
const PANES = new Map([
  ['jarvis', '/Users/Shared/marveen-jarvis'], ['mandark', '/Users/Shared/marveen-mandark'], ['marveen', '/Users/isti/marveen'],
])
const EXCLUDE = new Set([46912, 1066])

describe('ad730515: which orphan groups count as work, and whose', () => {
  const rows = parsePs(PS)

  it('parses every row, decimal comma included', () => {
    expect(rows).toHaveLength(10)
    expect(rows.find((r) => r.pid === 90056)?.pcpu).toBe(204.5)
  })

  it('the whisper job counts, for jarvis, and nothing else does', () => {
    const groups = busyDetachedGroups(rows, EXCLUDE)
    expect(groups.map((g) => g.pgid)).toEqual([50339])
    expect(groups[0].root.pid).toBe(50341)
    expect([...attributeDetached(groups, CWD, PANES)].map(([a, gs]) => [a, gs.map((g) => g.pgid)])).toEqual([['jarvis', [50339]]])
  })

  it('CONTROL: a group with no member on launchd (a pane child) never counts, however busy', () => {
    expect(busyDetachedGroups(rows, EXCLUDE).some((g) => g.pgid === 47300)).toBe(false)
  })

  it('CONTROL: the idle adb orphan is under the CPU floor; given CPU it would count for mandark', () => {
    expect(busyDetachedGroups(rows, EXCLUDE).some((g) => g.pgid === 2182)).toBe(false)
    const busyAdb = parsePs(PS.replace(' 2182     1  2182   0,0', ' 2182     1  2182  40,0'))
    const groups = busyDetachedGroups(busyAdb, EXCLUDE)
    expect(attributeDetached(groups, CWD, PANES).get('mandark')?.map((g) => g.pgid)).toEqual([2182])
  })

  it('CONTROL: without the launchd exclusion the dashboard would be the coordinator\'s work', () => {
    const groups = busyDetachedGroups(rows, new Set(), 1)
    expect(attributeDetached(groups, CWD, PANES).get('marveen')?.map((g) => g.pgid)).toEqual([46912])
    expect(attributeDetached(busyDetachedGroups(rows, EXCLUDE, 1), CWD, PANES).has('marveen')).toBe(false)
  })

  it('the longest pane path wins, and a sibling path with the same prefix is not "under"', () => {
    const g: DetachedGroup[] = [{ pgid: 7, pcpu: 50, root: rows[4], members: [{ ...rows[4], pid: 7 }] }]
    const nested = new Map([['marveen', '/Users/isti/marveen'], ['wt', '/Users/isti/marveen/agents/x']])
    expect([...attributeDetached(g, new Map([[7, '/Users/isti/marveen/agents/x/run']]), nested).keys()]).toEqual(['wt'])
    expect(attributeDetached(g, new Map([[7, '/Users/isti/marveen-wt-foo']]), nested).size).toBe(0)
  })

  it('parses lsof -Fpn and launchctl list', () => {
    expect([...parseLsofCwd('p50341\nfcwd\nn/a/b\np90056\nfcwd\nn/c\n')]).toEqual([[50341, '/a/b'], [90056, '/c']])
    expect([...parseLaunchctlPids('PID\tStatus\tLabel\n46912\t0\tcom.marveen.dashboard\n-\t0\tcom.x\n')]).toEqual([46912])
  })
})

// --- the wiring, through the real tick() ------------------------------------------------------
const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'detached-work-'))
  for (const d of ['root', 'x']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  fs.mkdirSync(path.join(tmp, 'root', 'store'))
  return {
    tmp,
    detached: new Map<string, unknown[]>(),
    probeCalls: 0,
    footerWork: 0,
    // when set: background work has been seen since then (the ghost guard's clock)
    subagentsSinceAgoMs: null as number | null,
    createAgentMessage: vi.fn(),
  }
})
tmpDirs().adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({ logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } }))
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => 'pane', isAgentRunning: () => true, saturationRefusesDispatch: () => false,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: () => 'idle', busyEvidence: () => 'none',
  detectsUsageLimitReached: () => false, detectsMidTurnApiError: () => false,
  runningBackgroundWork: () => h.footerWork,
}))
vi.mock('../web/detached-work.js', async (orig) => ({
  ...(await orig<typeof import('../web/detached-work.js')>()),
  readPaneCwds: () => new Map([['agent-x', '/work/x']]),
  probeDetachedWork: (paths: Map<string, string>) => {
    h.probeCalls++
    return new Map([...h.detached].filter(([a]) => paths.has(a)))
  },
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  getLastOutboundMessageAt: () => null,
  listKanbanCards: () => [{
    id: 'own00001', title: 't-own', status: 'planned', assignee: 'x', priority: 'normal',
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: null, project: null,
  }],
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => { h.createAgentMessage(...a); return { id: 1 } },
  saveIdleGuardState: () => {},
  // idle for an hour with an own card, so a wake is due on this tick
  loadIdleGuardState: () => {
    const now = Date.now()
    return {
      idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: now,
      ...(h.subagentsSinceAgoMs === null ? {} : { subagentsSinceMs: now - h.subagentsSinceAgoMs }),
    }
  },
}))

async function sweep(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}
const wakesToX = () => h.createAgentMessage.mock.calls.filter((c) => c[1] === 'x')
const GROUP = { pgid: 50339, pcpu: 204.5, root: { pid: 50341, ppid: 1, pgid: 50339, pcpu: 0, etime: '21:11:33', command: 'bash wjob4.sh' }, members: [] }

describe('tick(): detached work holds the wake (ad730515)', () => {
  beforeEach(() => {
    h.detached = new Map(); h.probeCalls = 0; h.footerWork = 0; h.subagentsSinceAgoMs = null
    h.createAgentMessage.mockReset()
  })

  it('an idle agent with a busy detached job on its path is not woken', async () => {
    h.detached = new Map([['x', [GROUP]]])
    await sweep()
    expect(wakesToX()).toHaveLength(0)
    expect(h.probeCalls).toBe(1)
  })

  it('CONTROL: the same agent with no detached job is woken', async () => {
    await sweep()
    expect(wakesToX()).toHaveLength(1)
  })

  it('the probe does not run when the footer already shows work (it is the only consumer)', async () => {
    h.footerWork = 1
    await sweep()
    expect(h.probeCalls).toBe(0)
    expect(wakesToX()).toHaveLength(0)
  })

  // The way out (trillian 48798): a detached job goes through the SAME ghost guard as a footer
  // row, so a runaway process cannot hide a stuck agent for longer than a silent sub-agent row
  // can. Without lastActionAtMs on detached work the ghost branch never fires and the hold is
  // forever.
  it('a detached hold that has been silent for 3 h is released by the ghost guard: he is woken', async () => {
    h.detached = new Map([['x', [GROUP]]])
    h.subagentsSinceAgoMs = 3 * 60 * 60_000
    await sweep()
    expect(h.probeCalls).toBe(1)
    expect(wakesToX()).toHaveLength(1)
  })
})
