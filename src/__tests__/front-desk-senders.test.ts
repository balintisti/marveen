// Card 074149c2, stage 2: THE GUARDS' OWN SENDERS ask the front-desk rule. The idle guard is driven
// through the REAL tick() (same harness as idle-guard-still-idle-routing.test.ts: only the pane, the
// process table, the registry and the database rows are mocked); the context guard's restart case
// cannot be driven without a tmux session, so its call site is pinned on the syntax tree and the
// header's content is tested on the function that measures it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const h = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('node:os') as typeof import('node:os')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'front-desk-senders-'))
  for (const d of ['root', 'x', 'desk']) {
    fs.mkdirSync(path.join(tmp, d))
    fs.writeFileSync(path.join(tmp, d, 'workcheck.json'), '{"kind":"assigned_open_cards"}')
  }
  fs.mkdirSync(path.join(tmp, 'nocheck'))   // an agent with NO workcheck.json: a 'no-work-check' alert
  return {
    tmp,
    setting: '',
    agents: ['x'] as string[],
    cardsFor: ['x', 'marveen'] as string[],
    running: new Map<string, boolean>(),
    stuck: new Set<string>(),
    idleOnly: new Set<string>(),
    deskDepth: 0,
    createAgentMessage: vi.fn(),
    sendAlert: vi.fn(),
  }
})
mkTmp.adopt(h.tmp)

vi.mock('../config.js', async (orig) => ({
  ...(await orig<typeof import('../config.js')>()),
  PROJECT_ROOT: `${h.tmp}/root`,
}))
vi.mock('../logger.js', () => ({ logger: { debug: () => {}, error: () => {}, info: () => {}, warn: () => {} } }))
vi.mock('../settings-store.js', async (orig) => {
  const actual = await orig<typeof import('../settings-store.js')>()
  return {
    ...actual,
    getEffectiveSettingValue: (key: string) => (key === 'FRONT_DESK_AGENT_ID' ? h.setting : actual.getEffectiveSettingValue(key)),
  }
})
vi.mock('../web/agent-process.js', () => ({
  capturePane: () => 'pane',
  isAgentRunning: (a: string) => h.running.get(a) ?? true, saturationRefusesDispatch: () => false,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => h.agents,
  agentDir: (a: string) => `${h.tmp}/${a}`,
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
  isKnownAgent: (a: string) => a === 'desk' || h.agents.includes(a),
}))
vi.mock('../pane-state.js', () => ({ detectPaneState: () => 'idle', busyEvidence: () => 'none', detectsUsageLimitReached: () => false, runningBackgroundWork: () => 0, detectsMidTurnApiError: () => false }))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: (...a: unknown[]) => h.sendAlert(...a) }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  listKanbanCards: () => h.cardsFor.map((a) => ({
    id: `card-${a}`, title: `t-${a}`, status: 'planned', assignee: a, priority: 'normal',
    archived_at: null, updated_at: Math.floor(Date.now() / 1000), due_date: null,
  })),
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (...a: unknown[]) => h.createAgentMessage(...a),
  getRecipientQueueState: () => ({ queueDepth: h.deskDepth }),
  saveIdleGuardState: () => {},
  // `stuck`: woken 20 minutes ago and still idle (stage 2, 'still-idle'). `idleOnly`: idle for an
  // hour and never woken, which with no card on the name is the "nothing assigned" notice.
  loadIdleGuardState: (agent: string) => {
    const now = Date.now()
    if (h.stuck.has(agent)) return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, updatedAt: now }
    if (h.idleOnly.has(agent)) return { idleSinceMs: now - 60 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: now }
    return null
  },
}))

const { MAIN_AGENT_ID } = await import('../config.js')
const { parseFrontDeskHeader } = await import('../front-desk.js')

async function sweep(): Promise<void> {
  vi.resetModules()
  const { tick } = await import('../web/idle-agent-watcher.js')
  tick()
}

type Call = [string, string, string, unknown?, unknown?, { wake?: boolean }?]
const sentTo = (to: string, needle: string) =>
  (h.createAgentMessage.mock.calls as Call[]).filter((c) => c[0] === 'system' && c[1] === to && String(c[2]).includes(needle))

beforeEach(() => {
  h.setting = 'desk'
  h.agents = ['x']; h.cardsFor = ['x', 'marveen']
  h.running.clear(); h.stuck.clear(); h.idleOnly.clear()
  h.deskDepth = 0
  h.createAgentMessage.mockReset(); h.sendAlert.mockReset()
})

describe('idle guard, still idle after a wake: the front desk reads it', () => {
  const STILL = 'FELEBRESZTETTEM'

  it('configured -> ONE message, to the front desk, header first, the old text after it, still waking', async () => {
    h.stuck.add('x')
    await sweep()
    expect(sentTo(MAIN_AGENT_ID, STILL)).toHaveLength(0)
    const letters = sentTo('desk', STILL)
    expect(letters).toHaveLength(1)
    const [first, ...rest] = letters[0][2].split('\n')
    expect(parseFrontDeskHeader(first)).toMatchObject({ v: 1, type: 'idle-still-idle', subjects: ['x'], reason: 'still-idle' })
    expect(rest.join('\n')).toContain('"x"')
    expect(letters[0][5]).toEqual({ wake: true })
    expect(h.sendAlert).not.toHaveBeenCalled()
  })

  it('not configured -> the coordinator, and the text has no header', async () => {
    h.setting = ''
    h.stuck.add('x')
    await sweep()
    const letters = sentTo(MAIN_AGENT_ID, STILL)
    expect(letters).toHaveLength(1)
    expect(letters[0][2].startsWith('[FRONT-DESK]')).toBe(false)
    expect(sentTo('desk', STILL)).toHaveLength(0)
  })

  it('front desk not running -> the coordinator', async () => {
    h.running.set('desk', false)
    h.stuck.add('x')
    await sweep()
    expect(sentTo(MAIN_AGENT_ID, STILL)).toHaveLength(1)
    expect(sentTo('desk', STILL)).toHaveLength(0)
  })

  it('front desk has 3 pending -> the coordinator', async () => {
    h.deskDepth = 3
    h.stuck.add('x')
    await sweep()
    expect(sentTo(MAIN_AGENT_ID, STILL)).toHaveLength(1)
    expect(sentTo('desk', STILL)).toHaveLength(0)
  })

  it('the front desk is the one standing -> the coordinator hears it, not the front desk', async () => {
    h.agents = ['desk']; h.cardsFor = ['desk', 'marveen']
    h.stuck.add('desk')
    await sweep()
    const letters = sentTo(MAIN_AGENT_ID, STILL)
    expect(letters).toHaveLength(1)
    expect(letters[0][2]).toContain('"desk"')
    expect(sentTo('desk', STILL)).toHaveLength(0)
  })

  it('a sweep with any OTHER kind in it stays ONE message to the coordinator, front desk healthy or not', async () => {
    h.agents = ['x', 'nocheck']
    h.stuck.add('x')
    await sweep()
    const letters = (h.createAgentMessage.mock.calls as Call[]).filter((c) => c[0] === 'system' && c[1] === MAIN_AGENT_ID)
    expect(letters).toHaveLength(1)
    expect(letters[0][2]).toMatch(/EBRESZTES UTAN IS ALL|FELEBRESZTETTEM/)   // x's still-idle row is in it
    expect(letters[0][2]).toContain('nocheck')
    expect(letters[0][2].startsWith('[FRONT-DESK]')).toBe(false)
    expect((h.createAgentMessage.mock.calls as Call[]).filter((c) => c[1] === 'desk')).toHaveLength(0)
  })

  it('the guard\'s report on a missing workcheck alone is not front-desk work', async () => {
    h.agents = ['nocheck']
    await sweep()
    expect((h.createAgentMessage.mock.calls as Call[]).filter((c) => c[0] === 'system' && c[1] === MAIN_AGENT_ID && c[2].includes('nocheck'))).toHaveLength(1)
    expect((h.createAgentMessage.mock.calls as Call[]).filter((c) => c[1] === 'desk')).toHaveLength(0)
  })

  it('the owner fallback is untouched: coordinator not running -> the owner, nobody else', async () => {
    h.running.set(MAIN_AGENT_ID, false)
    h.stuck.add('x')
    await sweep()
    expect(h.sendAlert).toHaveBeenCalledTimes(1)
    expect(sentTo('desk', STILL)).toHaveLength(0)
    expect(sentTo(MAIN_AGENT_ID, STILL)).toHaveLength(0)
  })
})

describe('idle guard, idle with nothing assigned: the front desk reads it', () => {
  const noWork = (to: string) => (h.createAgentMessage.mock.calls as Call[]).filter((c) => c[0] === 'system' && c[1] === to)

  it('CONTROL of the harness: with the front desk off, the coordinator gets exactly one notice about x', async () => {
    h.setting = ''
    h.cardsFor = ['marveen']
    h.idleOnly.add('x')
    await sweep()
    expect(noWork(MAIN_AGENT_ID)).toHaveLength(1)
    expect(noWork(MAIN_AGENT_ID)[0][2]).toContain('x')
    expect(noWork(MAIN_AGENT_ID)[0][2].startsWith('[FRONT-DESK]')).toBe(false)
  })

  it('configured -> the same notice goes to the front desk, with the header', async () => {
    h.setting = ''
    h.cardsFor = ['marveen']
    h.idleOnly.add('x')
    await sweep()
    const plain = noWork(MAIN_AGENT_ID)[0][2]
    h.createAgentMessage.mockReset()

    h.setting = 'desk'
    await sweep()
    expect(noWork(MAIN_AGENT_ID)).toHaveLength(0)
    const letters = noWork('desk')
    expect(letters).toHaveLength(1)
    const [first, ...rest] = letters[0][2].split('\n')
    expect(parseFrontDeskHeader(first)).toMatchObject({ v: 1, type: 'idle-no-work', subjects: ['x'] })
    // the clock in the text moves between two sweeps; everything else is the coordinator's text
    const noClock = (s: string) => s.replace(/\d{2}:\d{2}:\d{2}/g, 'HH:MM:SS')
    expect(noClock(rest.join('\n'))).toBe(noClock(plain))
  })

  it('front desk not running -> the coordinator', async () => {
    h.running.set('desk', false)
    h.cardsFor = ['marveen']
    h.idleOnly.add('x')
    await sweep()
    expect(noWork(MAIN_AGENT_ID)).toHaveLength(1)
    expect(noWork('desk')).toHaveLength(0)
  })
})

describe('context guard restart notice: the call site asks the rule (syntax tree, not text)', () => {
  it('the recipient of the "Ujrainditottam" row is desk.to, and desk is resolveMachineNoticeRecipient([name]) in the same block', async () => {
    const ts = (await import('typescript')).default
    const file = join(__dirname, '..', 'web', 'context-guard-runner.ts')
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const found: string[] = []
    ;(function visit(n: import('typescript').Node) {
      if (ts.isBlock(n)) {
        n.statements.forEach((st, i) => {
          if (!ts.isVariableStatement(st)) return
          const init = st.declarationList.declarations[0]?.initializer
          if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== 'createAgentMessage') return
          if (!init.getText(sf).includes('Ujrainditottam')) return
          const prev = n.statements[i - 1]
          found.push(`${init.arguments[1].getText(sf)} | ${prev ? prev.getText(sf).replace(/\s+/g, ' ') : 'NONE'}`)
          // the header is added only on the rerouted branch, and it is the FIRST thing in the text
          expect(init.arguments[2].getText(sf).replace(/\s+/g, ' ').startsWith('(desk.rerouted ? frontDeskHeader({')).toBe(true)
        })
      }
      ts.forEachChild(n, visit)
    })(sf)
    expect(found).toEqual(['desk.to | const desk = resolveMachineNoticeRecipient([name])'])
  })

  it('the rescue-failure alert is NOT a routine notice: it still names the coordinator', () => {
    const text = readFileSync(join(__dirname, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    expect(text.match(/resolveMachineNoticeRecipient\(/g)).toHaveLength(1)
  })
})

describe('the restart header carries the same window the loss line was built from', () => {
  const T = 1_800_000_000_000
  const sec = T / 1000

  it('ids by class; the idle guard\'s moot self-wake is not a delivered row; seconds, 30-minute window', async () => {
    const { measureRestartLoss } = await import('../web/context-guard-runner.js')
    const r = measureRestartLoss('x', () => [
      { id: 1, status: 'pending', created_at: sec - 50, delivered_at: null, from_agent: 'didi', head: 'var' },
      { id: 2, status: 'failed', created_at: sec - 120, delivered_at: null, from_agent: 'didi', head: 'bukott' },
      { id: 3, status: 'failed', created_at: sec - 3 * 3600, delivered_at: null, from_agent: 'didi', head: 'regen bukott' },
      { id: 4, status: 'delivered', created_at: sec - 500, delivered_at: sec - 300, from_agent: 'didi', head: 'kerdes' },
      { id: 5, status: 'delivered', created_at: sec - 900, delivered_at: sec - 600, from_agent: 'marveen', head: 'sorrend' },
      { id: 6, status: 'delivered', created_at: sec - 400, delivered_at: sec - 200, from_agent: 'system', head: '[tetlen-or] 31 perce allsz ures promptnal' },
      { id: 7, status: 'delivered', created_at: sec - 9000, delivered_at: sec - 2 * 3600, from_agent: 'didi', head: 'regi' },
    ], T)
    expect(r.lossWindow).toEqual({ windowSec: [sec - 1800, sec], delivered: [5, 4], pending: [1], failed: [2] })
    expect(r.lossNeedsAction).toBe(true)
  })

  it('a measurement that failed is null, not an empty window', async () => {
    const { measureRestartLoss } = await import('../web/context-guard-runner.js')
    const r = measureRestartLoss('x', () => { throw new Error('db locked') }, T)
    expect(r.lossWindow).toBeNull()
    expect(r.lossNeedsAction).toBeNull()
  })
})
