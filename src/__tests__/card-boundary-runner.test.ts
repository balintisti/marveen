// Card 00262e3f: the card-aligned restart THROUGH THE REAL RUNNER.
//
// The decisions are tested as functions (context-guard-card-restart, card-boundary-signal). What
// only the runner does, and what is asked here:
//   - at the move: the anchor row and the signal file exist before the caller's command returns,
//     nothing happens for an agent that is not armed, and nothing can fail the move;
//   - on a sweep: an agent that was shown the stop and stands idle is answered, with a restart or
//     with a "carry on", and a "carry on" that did not land is owed again;
//   - the restart is a card restart: no handoff request, the fresh session's first message lists
//     the agent's own open requests, and the line the trial is counted from names the half;
//   - the stand after the answer is followed, and one over the limit switches the active half off.
//
// Harness of context-guard-survives-dashboard-restart.test.ts: the real runner and the real signal
// files in a sandbox, fake clock. The hook is played by a write of its mark; the real script is in
// card-boundary-signal-hook.test.ts.
//
// NOT PROVEN HERE: the board and queue reads (mocked to a value; real in card-restart-facts.test.ts
// on a real database), the transcript readings (mocked to numbers), tmux.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { CARD_RESTART_SKIPPED_REQUEST_MARK, type CardRestartFacts, type ContextGuardConfig, type GuardState } from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('cardrunner-')
const STORE = join(SANDBOX, 'store')
const SIGDIR = join(STORE, 'card-boundary-signals')
const STATE_FILE = join(STORE, 'context-guard-state.json')
const MIN = 60_000
const T0 = 1_800_000_000_000
const A = 'computress'
const CARD = 'c0ffee11'
// Above the card threshold (80k), below the cap's act threshold (90% of 200k).
const HEAVY = 120_000
const LIGHT = 54_000

type Sent = { id: number; from: string; to: string; content: string }
type Outbound = { total: number; rows: { id: number; to_agent: string; created_at: number; head: string }[] }

const world = vi.hoisted(() => ({
  cfg: {} as Record<string, unknown>,
  tokens: 0 as number | null,
  running: true,
  runningSinceSec: null as number | null,
  paneState: 'busy' as 'idle' | 'busy' | 'unknown',
  backgroundWork: 0,
  sessionReady: false,
  facts: null as unknown,
  factsThrow: false,
  // The config and the board answer for ANY name as they do for computress: what an actor string
  // that names no agent would meet if nothing refused it first.
  armAnyone: false,
  firstToolUseMs: null as number | null,
  outbound: { total: 0, rows: [] } as unknown,
  outboundThrows: false,
  nextId: 9000,
  created: [] as unknown[],
  createThrows: false,
  delivered: [] as number[],
  failed: [] as [number, string][],
  done: [] as [number, string][],
  outboundArgs: [] as unknown[][],
  writeCfg: vi.fn((..._args: unknown[]) => {}),
  send: vi.fn(async (..._args: unknown[]): Promise<string> => 'sent'),
  restart: vi.fn(async (..._args: unknown[]) => ({ ok: true })),
  log: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({ logger: world.log }))
vi.mock('../db.js', () => ({
  createAgentMessage: (from: string, to: string, content: string) => {
    if (world.createThrows) throw new Error('db is locked')
    const row = { id: world.nextId++, from, to, content }
    world.created.push(row)
    return row
  },
  markMessageDelivered: (id: number) => { world.delivered.push(id) },
  markMessageFailed: (id: number, why: string) => { world.failed.push([id, why]) },
  markMessageDone: (id: number, result: string) => { world.done.push([id, result]) },
  listOpenOwnOutbound: (...args: unknown[]) => {
    world.outboundArgs.push(args)
    if (world.outboundThrows) throw new Error('db is locked')
    return world.outbound
  },
  getRestartLossCandidates: () => [],
  getAgentCommentsSince: () => [],
  getAgentMessagesSince: () => [],
}))
vi.mock('../notify.js', () => ({ notifyChannel: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
  markAgentRestartPending: vi.fn(),
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/system-directive.js', () => ({
  sendSystemDirective: world.send,
  SYSTEM_DIRECTIVE_SENDER: 'system',
  systemDirectiveEnvelope: (id: number) => `[SYSTEM-DIREKTIVA msg_id:${id} -- envelope]`,
}))
vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  listAllAgentNames: () => ['computress'],
  readAgentRemoteHost: () => null,
  readAgentModel: () => 'claude-opus-5-5',
}))
vi.mock('../web/active-model.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  readContextTokensFromProjectDir: () => world.tokens,
  readTranscriptMtimeFromProjectDir: () => Date.now(),
  readLastTurnActivityMs: () => Date.now(),
  readActiveModelFromProjectDir: () => null,
  readLastCompactionMs: () => null,
  predatesSession: () => false,
  readFirstToolUseMsAfter: () => world.firstToolUseMs,
}))
vi.mock('../pane-state.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  runningBackgroundWork: () => world.backgroundWork,
  detectPaneState: () => world.paneState,
}))
vi.mock('../heavy-run-jobs.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  liveHeavyRunJobs: () => [],
}))
vi.mock('../web/card-restart-facts.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  gatherCardRestartFacts: (name: string) => {
    if (world.factsThrow) throw new Error('board unreadable')
    return name === 'computress' || world.armAnyone ? world.facts : { boundary: null, blockers: [] }
  },
}))
vi.mock('../web/context-guard-store.js', async (orig) => {
  const actual = await orig<typeof import('../web/context-guard-store.js')>()
  const { DEFAULT_CONTEXT_GUARD } = await import('../context-guard.js')
  const allOff = { ...DEFAULT_CONTEXT_GUARD, enabled: false, saturationRestart: false, idleFlushEnabled: false, dailyHandoffEnabled: false, cardRestartEnabled: false, cardRestartSignal: false }
  return {
    ...actual,
    readContextGuardConfig: (name: string) =>
      name === 'computress' || world.armAnyone ? { ...allOff, limitTokens: 200_000, actPct: 0.9, hardPct: 0.97, cardRestartTokens: 80_000, ...world.cfg } : allOff,
    writeContextGuardConfig: world.writeCfg,
    readAllContextGuardConfigs: () => ({}),
  }
})
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => (world.running ? 'running' : 'stopped'),
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: world.restart,
  capturePane: () => '',
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => world.sessionReady,
  paneEchoesInput: async () => 'echoed',
  noteSaturationBannerUntrusted: vi.fn(),
  clearSaturationBannerOverride: vi.fn(),
  getAgentRunningSince: () => world.runningSinceSec,
}))

type Runner = typeof import('../web/context-guard-runner.js')
let runner: Runner
let timer: NodeJS.Timeout | null = null
let startedAtMs = 0

async function dashboardStarts(): Promise<void> {
  vi.resetModules()
  startedAtMs = Date.now()
  runner = await import('../web/context-guard-runner.js')
  timer = runner.startContextGuardRunner()
}

/** See context-guard-survives-dashboard-restart.test.ts: clearAllTimers puts the fake clock back. */
function dashboardStops(): void {
  const now = Date.now()
  if (timer) clearInterval(timer)
  timer = null
  vi.clearAllTimers()
  vi.setSystemTime(now)
}

const ARMED = { cardRestartEnabled: true, cardRestartSignal: true }
const PASSIVE_ONLY = { cardRestartEnabled: true, cardRestartSignal: false }

const boundaryAt = (movedAtMs: number, cardId = CARD, blockers: string[] = []): CardRestartFacts =>
  ({ boundary: { cardId, toStatus: 'testing', movedAtMs }, blockers })

const created = () => world.created as Sent[]
const sentTo = (name: string) => world.send.mock.calls.filter((c) => c[0] === name).map((c) => String(c[2]))
const restartsOf = (name: string) => world.restart.mock.calls.filter((c) => c[0] === name).length
const files = (): string[] => (existsSync(SIGDIR) ? readdirSync(SIGDIR).sort() : [])
const readJson = <T,>(file: string): T => JSON.parse(readFileSync(join(SIGDIR, file), 'utf-8')) as T
const signalFile = () => readJson<{ agent: string; cardId: string; toStatus: string; movedAtMs: number; issuedAtMs: number; msgId: number; text: string }>(`${A}.json`)
const answered = () => readJson<{ cardId: string; half: string; how: string; turnEndMs: number; turnEndSource: string; limitReported?: boolean }>(`${A}.answered.json`)
const savedState = (name: string): GuardState | undefined =>
  (JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as { states: Record<string, GuardState> }).states[name]
/** Log lines with this text, as their field objects. */
const logged = (level: 'info' | 'warn' | 'error', text: string): Record<string, unknown>[] =>
  world.log[level].mock.calls.filter((c) => String(c[c.length - 1]).includes(text)).map((c) => c[0] as Record<string, unknown>)

/** The hook ran after the Bash call that made the move, and printed the text. */
function hookShows(): void {
  expect(files()).toContain(`${A}.json`)
  writeFileSync(join(SIGDIR, `${A}.shown`), String(Date.now()))
}

/**
 * The agent, four minutes into the dashboard's life and mid-turn, moves its card to testing. The
 * board then says so, and the kanban route calls the runner.
 */
async function movesCard(cardId = CARD): Promise<number> {
  await vi.advanceTimersByTimeAsync(4 * MIN)
  const movedAtMs = Date.now() - 200
  world.facts = boundaryAt(movedAtMs, cardId)
  runner.signalCardBoundaryAtMove(A, cardId, 'in_progress', 'testing')
  return movedAtMs
}

/**
 * To one second after the next sweep. The runner sweeps 4.5 min after its start, and then on every
 * fifth minute of its life (the interval is counted from the start, not from the first sweep): so
 * 4:30, 5:00, 10:00, 15:00.
 */
function nextSweep(): Promise<unknown> {
  const lived = Date.now() - startedAtMs
  const next = lived < 4.5 * MIN ? 4.5 * MIN : (Math.floor(lived / (5 * MIN)) + 1) * 5 * MIN
  return vi.advanceTimersByTimeAsync(next - lived + 1000)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  rmSync(STORE, { recursive: true, force: true })
  rmSync(join(SANDBOX, 'agents'), { recursive: true, force: true })
  Object.assign(world, {
    cfg: { ...ARMED }, tokens: HEAVY, running: true, runningSinceSec: T0 / 1000 - 3600, paneState: 'busy', backgroundWork: 0,
    sessionReady: false, facts: { boundary: null, blockers: [] }, factsThrow: false, armAnyone: false, firstToolUseMs: null,
    outbound: { total: 0, rows: [] }, outboundThrows: false, nextId: 9000, created: [], createThrows: false,
    delivered: [], failed: [], done: [], outboundArgs: [],
  })
  world.writeCfg.mockReset().mockImplementation((_name: unknown, cfg: unknown) => { world.cfg = { ...(cfg as Record<string, unknown>) } })
  world.send.mockReset().mockImplementation(async () => 'sent')
  world.restart.mockReset().mockImplementation(async () => ({ ok: true }))
  for (const fn of Object.values(world.log)) fn.mockClear()
})

afterEach(() => {
  dashboardStops()
  vi.useRealTimers()
})

describe('at the move: the signal is out before the caller\'s command returns', () => {
  it('armed, heavy, nothing in the way: an anchor row from "system", delivered, and the file the hook prints', async () => {
    await dashboardStarts()
    const movedAtMs = await movesCard()

    expect(created()).toHaveLength(1)
    const anchor = created()[0]
    expect(anchor).toMatchObject({ from: 'system', to: A })
    expect(anchor.content).toMatch(/^\[KARTYAHATAR\] A\(z\) c0ffee11 kártyát most tetted át in_progress-ből testing állapotba/)
    expect(anchor.content).toContain('~120k token (a küszöb 80k)')
    // Delivered, not pending: the router must not type the same text into the pane a second time.
    expect(world.delivered).toEqual([anchor.id])
    expect(world.failed).toEqual([])

    expect(files()).toEqual([`${A}.json`])
    const sig = signalFile()
    expect(sig).toMatchObject({ agent: A, cardId: CARD, toStatus: 'testing', movedAtMs, issuedAtMs: Date.now(), msgId: anchor.id })
    // What the agent verifies: the envelope names the row whose content is the rest of the text.
    expect(sig.text).toBe(`[SYSTEM-DIREKTIVA msg_id:${anchor.id} -- envelope]\n${anchor.content}`)
    expect(logged('info', 'card-boundary signal issued')).toEqual([expect.objectContaining({ name: A, cardId: CARD, msgId: anchor.id, contextTokens: HEAVY })])
    // The move alone restarts nobody and asks for nothing.
    expect(restartsOf(A)).toBe(0)
    expect(world.send).not.toHaveBeenCalled()
  })

  it.each([
    ['the active half is off', PASSIVE_ONLY],
    ['the tier is off, whatever the signal switch says', { cardRestartEnabled: false, cardRestartSignal: true }],
    ['nothing is on', {}],
  ])('not armed (%s): no row, no file, not a word in the log', async (_what, cfg) => {
    world.cfg = cfg
    await dashboardStarts()
    for (const fn of Object.values(world.log)) fn.mockClear()
    await movesCard()
    expect(created()).toEqual([])
    expect(files()).toEqual([])
    expect(logged('info', 'card-boundary')).toEqual([])
    expect(logged('warn', 'card-boundary')).toEqual([])
  })

  it.each([
    ['planned', 'in_progress'],
    ['in_progress', 'planned'],
    ['testing', 'done'],
    ['in_progress', 'in_progress'],
    [undefined, 'testing'],
  ])('armed, but %s -> %s hands nothing over: silent', async (from, to) => {
    await dashboardStarts()
    await vi.advanceTimersByTimeAsync(4 * MIN)
    world.facts = boundaryAt(Date.now())
    runner.signalCardBoundaryAtMove(A, CARD, from, to)
    expect(created()).toEqual([])
    expect(files()).toEqual([])
    expect(logged('info', 'card-boundary signal')).toEqual([])
  })

  it.each([
    ['the session is not running', () => { world.running = false }, 'no running session'],
    ['the context is light', () => { world.tokens = LIGHT }, 'context 54k is below 80k'],
    ['the context cannot be measured', () => { world.tokens = null }, 'context size unmeasurable'],
    ['the session start is not known', () => { world.runningSinceSec = null }, 'session start is not known'],
    ['background work runs', () => { world.backgroundWork = 2 }, 'background work is running'],
    ['a message waits for the agent', () => { world.facts = boundaryAt(Date.now(), CARD, ['1 undelivered message waits']) }, '1 undelivered message waits'],
    ['the board\'s last event is another card', () => { world.facts = boundaryAt(Date.now(), 'another1') }, 'not this move'],
    ['the board cannot be read', () => { world.facts = { boundary: 'unknown', blockers: [] } }, 'could not be read'],
    ['the fleet is frozen', () => { mkdirSync(STORE, { recursive: true }); writeFileSync(join(STORE, 'fleet-freeze.json'), JSON.stringify({ mode: 'freeze' })) }, 'frozen'],
  ])('armed, but %s: NOT issued, and the log says why', async (_what, arrange, reason) => {
    await dashboardStarts()
    await vi.advanceTimersByTimeAsync(4 * MIN)
    world.facts = boundaryAt(Date.now())
    arrange()
    runner.signalCardBoundaryAtMove(A, CARD, 'in_progress', 'testing')
    expect(created()).toEqual([])
    expect(files()).toEqual([])
    const lines = logged('info', 'card-boundary signal NOT issued')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ name: A, cardId: CARD })
    expect(String(lines[0].reason)).toContain(reason)
  })

  it('a sequence of the guard is under way: NOT issued (that sequence speaks to the agent itself)', async () => {
    await dashboardStarts()
    runner._setGuardStateForTest(A, { phase: 'await-handoff', deadlineMs: T0 + 30 * MIN, saturatedStreak: 0 } as GuardState)
    await movesCard()
    expect(files()).toEqual([])
    expect(String(logged('info', 'card-boundary signal NOT issued')[0]?.reason)).toContain('phase await-handoff')
  })

  it('a LATER move of the agent ends an earlier stop: the file goes, its row is closed, the log says "not followed"', async () => {
    await dashboardStarts()
    await movesCard()
    const first = signalFile()
    hookShows()
    // The agent did not stop: it picked the next card up and now hands that one over too.
    world.cfg = { ...PASSIVE_ONLY }   // even with the active half switched off since: the old stop is still ended
    world.facts = boundaryAt(Date.now(), 'next0002')
    runner.signalCardBoundaryAtMove(A, 'next0002', 'in_progress', 'testing')
    expect(files()).toEqual([])
    expect(world.done).toEqual([[first.msgId, expect.stringContaining('cleared: the agent moved a card after the signal')]])
    expect(logged('info', 'not followed: the agent moved a card after it')).toEqual([expect.objectContaining({ name: A, cardId: CARD, shown: true, laterCardId: 'next0002' })])
    expect(created()).toHaveLength(1)
  })

  it('...and if the later move is a boundary itself, it gets its own signal', async () => {
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.facts = boundaryAt(Date.now(), 'next0002')
    runner.signalCardBoundaryAtMove(A, 'next0002', 'in_progress', 'waiting')
    expect(files()).toEqual([`${A}.json`])   // the old mark went with the old signal
    expect(signalFile()).toMatchObject({ cardId: 'next0002', toStatus: 'waiting', msgId: created()[1].id })
  })

  it('any move at all ends the earlier stop, a pick-up included', async () => {
    await dashboardStarts()
    await movesCard()
    runner.signalCardBoundaryAtMove(A, 'next0002', 'planned', 'in_progress')
    expect(files()).toEqual([])
    expect(created()).toHaveLength(1)
  })

  describe('the move is never failed by it', () => {
    it('the anchor row cannot be written: no throw, no file, a warning', async () => {
      await dashboardStarts()
      world.createThrows = true
      await expect(movesCard()).resolves.toBeTypeOf('number')
      expect(files()).toEqual([])
      expect(logged('warn', 'card-boundary signal step failed')).toHaveLength(1)
    })

    it('the file cannot be written: no throw, and the anchor row is failed, not left as a delivered order', async () => {
      await dashboardStarts()
      mkdirSync(STORE, { recursive: true })
      writeFileSync(SIGDIR, 'a file where the directory should be')
      await expect(movesCard()).resolves.toBeTypeOf('number')
      expect(created()).toHaveLength(1)
      expect(world.failed).toEqual([[created()[0].id, expect.stringContaining('file not written')]])
      expect(logged('warn', 'card-boundary signal step failed')).toHaveLength(1)
      expect(logged('info', 'card-boundary signal issued')).toEqual([])
      rmSync(SIGDIR)
    })

    it('the board read throws: no throw', async () => {
      await dashboardStarts()
      world.factsThrow = true
      await expect(movesCard()).resolves.toBeTypeOf('number')
      expect(files()).toEqual([])
      expect(logged('warn', 'card-boundary signal step failed')).toHaveLength(1)
    })

    it.each([[undefined], [''], ['../etc'], ['a b']])('an actor that is not an agent id (%j): nothing', async (actor) => {
      await dashboardStarts()
      await vi.advanceTimersByTimeAsync(4 * MIN)
      world.facts = boundaryAt(Date.now())
      expect(() => runner.signalCardBoundaryAtMove(actor, CARD, 'in_progress', 'testing')).not.toThrow()
      expect(created()).toEqual([])
      expect(files()).toEqual([])
    })

    // The `actor` of a kanban call is free text. Here everything downstream would say yes to it (an
    // armed config, a clean boundary): only the check at the door keeps an order addressed to
    // nobody out of the queue. The file itself is refused a second time, by its path.
    it.each([['../etc'], ['a b'], ['computress/../computress'], ['x'.repeat(65)]])('an actor that is not an agent id (%j) while everything else says yes: no row, no file, no warning', async (actor) => {
      world.armAnyone = true
      await dashboardStarts()
      await vi.advanceTimersByTimeAsync(4 * MIN)
      world.facts = boundaryAt(Date.now())
      expect(() => runner.signalCardBoundaryAtMove(actor, CARD, 'in_progress', 'testing')).not.toThrow()
      expect(created()).toEqual([])
      expect(world.failed).toEqual([])
      expect(files()).toEqual([])
      expect(logged('warn', 'card-boundary')).toEqual([])
      expect(logged('info', 'card-boundary signal')).toEqual([])
    })

    it('CONTROL: with the same switch a real agent id other than computress does get its signal', async () => {
      world.armAnyone = true
      await dashboardStarts()
      await vi.advanceTimersByTimeAsync(4 * MIN)
      world.facts = boundaryAt(Date.now())
      runner.signalCardBoundaryAtMove('ford', CARD, 'in_progress', 'testing')
      expect(created()).toHaveLength(1)
      expect(created()[0]).toMatchObject({ from: 'system', to: 'ford' })
      expect(files()).toEqual(['ford.json'])
    })
  })
})

describe('the sweep answers an agent that stopped: with a restart', () => {
  it('ACTIVE half: shown, idle -> restarted on the next sweep, no handoff asked, the event recorded', async () => {
    await dashboardStarts()
    // An older restart tail must not pass for this restart's.
    mkdirSync(join(SANDBOX, 'agents', A), { recursive: true })
    const oldTail = join(SANDBOX, 'agents', A, 'HANDOFF-RESTART-TAIL.md')
    writeFileSync(oldTail, 'from an earlier restart')
    const movedAtMs = await movesCard()
    const sig = signalFile()
    hookShows()
    world.paneState = 'idle'
    await nextSweep()

    expect(restartsOf(A)).toBe(1)
    expect(sentTo(A)).toEqual([])   // no handoff request and no "carry on"
    const done = logged('info', 'card-boundary restart done')
    expect(done).toEqual([expect.objectContaining({ name: A, cardId: CARD, toStatus: 'testing', half: 'active', contextTokens: HEAVY, thresholdRequestSkipped: false })])
    expect(files()).toEqual([`${A}.answered.json`])
    expect(answered()).toMatchObject({ cardId: CARD, half: 'active', how: 'restart', turnEndSource: 'transcript' })
    expect(world.done).toEqual([[sig.msgId, '[KARTYAHATAR] answered: restart (active)']])
    expect(existsSync(oldTail)).toBe(false)
    expect(runner.getHardGuardPhase(A)).toBe('await-ready')
    expect(savedState(A)?.cardRestart).toEqual({ cardId: CARD, toStatus: 'testing', movedAtMs })
  })

  it('PASSIVE half: no signal was ever issued, the agent just stands at a boundary -> restarted, and counted as passive', async () => {
    world.cfg = { ...PASSIVE_ONLY }
    await dashboardStarts()
    await movesCard()
    expect(files()).toEqual([])
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(1)
    expect(sentTo(A)).toEqual([])
    expect(logged('info', 'card-boundary restart done')).toEqual([expect.objectContaining({ name: A, cardId: CARD, half: 'passive' })])
    expect(answered()).toMatchObject({ half: 'passive', how: 'restart' })
    expect(world.done).toEqual([])
  })

  it('issued but NOT shown, and the restart happens anyway: passive (nobody was told to stop), the signal is closed', async () => {
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(1)
    expect(logged('info', 'card-boundary restart done')).toEqual([expect.objectContaining({ half: 'passive' })])
    expect(files()).toEqual([`${A}.answered.json`])
    expect(world.done).toEqual([[sig.msgId, '[KARTYAHATAR] answered: restart (passive)']])
  })

  it('the tier alone keeps the sweep alive: every other tier is off, and the agent is still measured and restarted', async () => {
    // The disarm check at the top of the sweep lists every tier that can act. Without this one in
    // it, an agent armed for the card restart only would be skipped before any decision.
    world.cfg = { ...PASSIVE_ONLY }
    await dashboardStarts()
    await movesCard()
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(1)
  })

  it('a light context at the same boundary: nothing happens, and nothing is said', async () => {
    world.cfg = { ...PASSIVE_ONLY }
    world.tokens = LIGHT
    await dashboardStarts()
    await movesCard()
    world.paneState = 'idle'
    await nextSweep()
    await nextSweep()
    expect(restartsOf(A)).toBe(0)
    expect(world.send).not.toHaveBeenCalled()
    expect(logged('info', 'card-boundary restart')).toEqual([])
  })

  it('a restart that FAILS is not recorded as an answered boundary: the signal stays for the retry', async () => {
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.paneState = 'idle'
    world.restart.mockImplementation(async () => { throw new Error('tmux: no server') })
    await nextSweep()
    expect(logged('info', 'card-boundary restart done')).toEqual([])
    expect(files()).toEqual([`${A}.json`, `${A}.shown`])
    world.restart.mockImplementation(async () => ({ ok: true }))
    await nextSweep()
    expect(logged('info', 'card-boundary restart done')).toEqual([expect.objectContaining({ half: 'active' })])
    expect(files()).toEqual([`${A}.answered.json`])
  })
})

describe('the fresh session\'s first message after a card restart', () => {
  async function restartedAtBoundary(): Promise<void> {
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(1)
  }

  it('names the card, forbids HANDOFF.md, and LISTS the agent\'s own open requests', async () => {
    world.outbound = { total: 9, rows: [
      { id: 501, to_agent: 'didi', created_at: 1, head: 'Review request: card [00262e3f] tip a57675bb' },
      { id: 498, to_agent: 'friday', created_at: 1, head: 'Is the deploy\nfreeze still on?' },
    ] } satisfies Outbound
    await restartedAtBoundary()
    world.sessionReady = true
    const nowMs = Date.now()
    await vi.advanceTimersByTimeAsync(30_000)

    const texts = sentTo(A)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/^\[CONTEXT-GUARD\] Friss kontextussal indultál KÁRTYAHATÁRON/)
    expect(texts[0]).toContain(`a(z) ${CARD} kártyát testing állapotba tette`)
    expect(texts[0]).toContain('HANDOFF.md-t szándékosan NEM kértem')
    expect(texts[0]).toContain('9 db, itt a legfrissebb 2')
    // Quoted as data, on one line, with no bracket that could read as a directive of its own.
    expect(texts[0]).toContain('#501 -> didi: "Review request: card 00262e3f tip a57675bb"')
    expect(texts[0]).toContain('#498 -> friday: "Is the deploy freeze still on?"')
    // The last 24 hours, six rows named at most.
    expect(world.outboundArgs).toHaveLength(1)
    const [agent, sinceSec, limit] = world.outboundArgs[0] as [string, number, number]
    expect(agent).toBe(A)
    expect(Math.abs(sinceSec - (nowMs - 24 * 3600_000) / 1000)).toBeLessThan(60)
    expect(limit).toBe(6)
    expect(runner.getHardGuardPhase(A)).toBe('cooldown')
  })

  it('no open requests: says so', async () => {
    await restartedAtBoundary()
    world.sessionReady = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sentTo(A)[0]).toContain('Megválaszolatlan saját kimenő kérésed az elmúlt 24 órából nincs.')
  })

  it('the list cannot be read: the message says it could NOT, instead of saying there are none', async () => {
    world.outboundThrows = true
    await restartedAtBoundary()
    world.sessionReady = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sentTo(A)).toHaveLength(1)
    expect(sentTo(A)[0]).toContain('NEM tudtam kiolvasni')
    expect(sentTo(A)[0]).not.toContain('nincs.')
  })

  it('a dashboard restart between the restart and the message: it is still the card message', async () => {
    await restartedAtBoundary()
    dashboardStops()
    await dashboardStarts()
    expect(runner.getHardGuardPhase(A)).toBe('await-ready')
    world.sessionReady = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(sentTo(A)).toHaveLength(1)
    expect(sentTo(A)[0]).toContain('KÁRTYAHATÁRON')
  })
})

describe('the card restart and the threshold tiers', () => {
  it('above the act threshold at a boundary: the restart REPLACES the handoff request, and the log names the skip', async () => {
    world.cfg = { ...PASSIVE_ONLY, enabled: true }
    world.tokens = 184_000   // 92% of the 200k cap
    await dashboardStarts()
    await movesCard()
    world.paneState = 'idle'
    await nextSweep()
    expect(sentTo(A)).toEqual([])   // no "write your handoff" turn
    expect(restartsOf(A)).toBe(1)
    const done = logged('info', 'card-boundary restart done')
    expect(done).toEqual([expect.objectContaining({ half: 'passive', thresholdRequestSkipped: true })])
    expect(String(done[0].reason)).toContain(CARD_RESTART_SKIPPED_REQUEST_MARK)
  })

  it('CONTROL: the same context with no boundary gets the handoff request, as before', async () => {
    world.cfg = { ...PASSIVE_ONLY, enabled: true }
    world.tokens = 184_000
    await dashboardStarts()
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(0)
    expect(sentTo(A)).toHaveLength(1)
    expect(sentTo(A)[0]).toContain('HANDOFF.md')
    expect(logged('info', 'card-boundary restart done')).toEqual([])
  })

  it('a threshold request while a shown signal is out: the signal is dropped, the request is what the agent hears', async () => {
    world.cfg = { ...ARMED, enabled: true }
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    hookShows()
    // The context grew past the act threshold, and a message arrived: no card restart now.
    world.tokens = 184_000
    world.facts = boundaryAt(sig.movedAtMs, CARD, ['1 undelivered message waits'])
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(0)
    expect(sentTo(A)).toHaveLength(1)
    expect(sentTo(A)[0]).toContain('HANDOFF.md')
    expect(sentTo(A)[0]).not.toContain('[KARTYAHATAR]')
    expect(files()).toEqual([])
    expect(world.done).toEqual([[sig.msgId, expect.stringContaining('cleared: superseded by request-handoff')]])
  })
})

describe('the sweep answers an agent that stopped: with a "carry on"', () => {
  /** Shown and idle, but a message has arrived for the agent since the move: the restart is refused. */
  async function stoppedButRefused(): Promise<{ msgId: number }> {
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    hookShows()
    world.facts = boundaryAt(sig.movedAtMs, CARD, ['1 undelivered message waits'])
    world.paneState = 'idle'
    return { msgId: sig.msgId }
  }

  it('the restart is refused -> the agent is told to carry on, with the reason, on the same sweep', async () => {
    const { msgId } = await stoppedButRefused()
    await nextSweep()

    expect(restartsOf(A)).toBe(0)
    const texts = sentTo(A)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toMatch(/^\[KARTYAHATAR\] Az újraindítás NEM történt meg a\(z\) c0ffee11 kártya után: card-restart: refused at a card boundary/)
    expect(texts[0]).toContain('1 undelivered message waits')
    expect(texts[0]).toContain('Folytasd ebben a munkamenetben')
    // Redelivered: the caller keeps the signal until the text is out.
    expect((world.send.mock.calls[0][4] as { survival: string }).survival).toBe('redelivered')

    expect(files()).toEqual([`${A}.answered.json`])
    expect(answered()).toMatchObject({ cardId: CARD, half: 'active', how: 'continue' })
    expect(world.done).toEqual([[msgId, expect.stringContaining('answered: continue')]])
    expect(logged('info', 'answered with a continue signal')).toEqual([expect.objectContaining({ name: A, cardId: CARD, half: 'active' })])
    expect(logged('info', 'card-boundary restart not done')).toEqual([expect.objectContaining({ name: A, contextTokens: HEAVY })])
  })

  it('said ONCE: the next sweeps send nothing more, and the refusal is not logged again while it stands', async () => {
    await stoppedButRefused()
    await nextSweep()
    await nextSweep()
    await nextSweep()
    expect(sentTo(A)).toHaveLength(1)
    expect(logged('info', 'card-boundary restart not done')).toHaveLength(1)
    expect(restartsOf(A)).toBe(0)
  })

  it.each([
    ['is parked by the sender', async () => 'parked'],
    ['throws', async () => { throw new Error('tmux: no server') }],
  ])('a "carry on" that %s is still owed: the signal stays, the next sweep sends it again', async (_what, firstSend) => {
    const { msgId } = await stoppedButRefused()
    world.send.mockImplementationOnce(firstSend as () => Promise<string>)
    await nextSweep()
    expect(world.send).toHaveBeenCalledTimes(1)
    expect(files()).toEqual([`${A}.json`, `${A}.shown`])
    expect(world.done).toEqual([])
    expect(logged('warn', 'continue signal was not delivered')).toHaveLength(1)

    await nextSweep()
    expect(world.send).toHaveBeenCalledTimes(2)
    expect(files()).toEqual([`${A}.answered.json`])
    expect(world.done).toEqual([[msgId, expect.stringContaining('answered: continue')]])
  })

  it('the tier was switched OFF after the agent stopped: the agent is still answered', async () => {
    // Everything off is where the sweep returns before any decision. An agent standing on a shown
    // signal must not be left there.
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.cfg = {}
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(0)
    expect(sentTo(A)).toHaveLength(1)
    expect(sentTo(A)[0]).toContain('the guard did not decide a restart on this check')
    expect(files()).toEqual([`${A}.answered.json`])
  })
})

describe('a signal nobody stands on', () => {
  it('shown, but the agent is still in its turn: the sweep waits, and answers when the pane is idle', async () => {
    await dashboardStarts()
    await movesCard()
    hookShows()
    await nextSweep()   // still busy: writing its last comment
    expect(world.send).not.toHaveBeenCalled()
    expect(restartsOf(A)).toBe(0)
    expect(files()).toEqual([`${A}.json`, `${A}.shown`])
    world.paneState = 'idle'
    await nextSweep()
    expect(restartsOf(A)).toBe(1)
    expect(logged('info', 'card-boundary restart done')).toEqual([expect.objectContaining({ half: 'active' })])
  })

  it('shown, the agent works on and the board\'s last event is a later one: dropped as not followed, nothing sent', async () => {
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    hookShows()
    world.facts = { boundary: null, blockers: [] }   // it picked a card up through a door that does not call the runner
    await nextSweep()
    expect(world.send).not.toHaveBeenCalled()
    expect(files()).toEqual([])
    expect(world.done).toEqual([[sig.msgId, expect.stringContaining('cleared: not followed')]])
    expect(logged('info', 'card-boundary signal cleared without an answer')).toEqual([expect.objectContaining({ name: A, cardId: CARD, shown: true })])
  })

  it('never shown: waits out the show window, then is dropped with a WARNING that names the hook', async () => {
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    await nextSweep()   // 30 s after the signal
    await nextSweep()   // 60 s: the hook may still run
    expect(files()).toEqual([`${A}.json`])
    expect(world.done).toEqual([])
    await nextSweep()   // 6 min
    expect(files()).toEqual([])
    expect(world.send).not.toHaveBeenCalled()
    expect(world.done).toEqual([[sig.msgId, expect.stringContaining('never shown')]])
    expect(logged('warn', 'card-boundary signal cleared without an answer')).toEqual([expect.objectContaining({ name: A, shown: false, why: expect.stringContaining('is the hook registered?') })])
  })

  it('the session was replaced after the signal: dropped, and the new session is not told to carry on', async () => {
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.runningSinceSec = Math.floor(Date.now() / 1000) + 5
    world.facts = { boundary: null, blockers: [] }
    world.paneState = 'idle'
    await nextSweep()
    expect(world.send).not.toHaveBeenCalled()
    expect(files()).toEqual([])
    expect(logged('info', 'card-boundary signal cleared without an answer')).toEqual([expect.objectContaining({ why: 'the session was replaced after the signal' })])
  })

  it('a signal file that cannot be parsed: removed, with a warning, and nobody is answered', async () => {
    await dashboardStarts()
    mkdirSync(SIGDIR, { recursive: true })
    writeFileSync(join(SIGDIR, `${A}.json`), '{"agent":')
    world.paneState = 'idle'
    await nextSweep()
    expect(files()).toEqual([])
    expect(world.send).not.toHaveBeenCalled()
    expect(logged('warn', 'signal file is not readable -- removed')).toHaveLength(1)
  })
})

describe('the stand after the answer', () => {
  /** Restarted on the signal at the 4.5 min sweep; the fresh session got its first message. */
  async function restartedActive(): Promise<number> {
    await dashboardStarts()
    await movesCard()
    hookShows()
    world.paneState = 'idle'
    await nextSweep()
    expect(answered()).toMatchObject({ half: 'active', how: 'restart' })
    const turnEndMs = answered().turnEndMs
    world.sessionReady = true
    world.runningSinceSec = Math.floor(Date.now() / 1000)
    world.facts = { boundary: null, blockers: [] }
    return turnEndMs
  }
  const switchOffMessages = () => created().filter((m) => m.to === 'marveen' && m.content.startsWith('[CARD-BOUNDARY] Active half switched OFF'))

  it('the next session works within the limit: the stand is measured and logged, nothing is switched off', async () => {
    const turnEndMs = await restartedActive()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    world.firstToolUseMs = turnEndMs + 95_000
    await nextSweep()
    expect(logged('info', 'card-boundary stand measured')).toEqual([
      expect.objectContaining({ name: A, cardId: CARD, half: 'active', how: 'restart', standMs: 95_000, turnEndSource: 'transcript' }),
    ])
    expect(files()).toEqual([])
    expect(world.writeCfg).not.toHaveBeenCalled()
    expect(switchOffMessages()).toEqual([])
  })

  it('no tool call for more than 10 minutes after an ACTIVE answer: the active half is switched off, marveen is told, ONCE', async () => {
    await restartedActive()
    await vi.advanceTimersByTimeAsync(31 * MIN)

    expect(world.writeCfg).toHaveBeenCalledTimes(1)
    const [name, cfg] = world.writeCfg.mock.calls[0] as [string, ContextGuardConfig]
    expect(name).toBe(A)
    // Only the active half: the passive tier and its threshold stay as they were.
    expect(cfg).toMatchObject({ cardRestartSignal: false, cardRestartEnabled: true, cardRestartTokens: 80_000 })
    expect(switchOffMessages()).toHaveLength(1)
    expect(switchOffMessages()[0]).toMatchObject({ from: A, to: 'marveen' })
    expect(switchOffMessages()[0].content).toContain(`card ${CARD}`)
    expect(switchOffMessages()[0].content).toContain('limit 10')
    expect(logged('warn', 'ACTIVE half switched off')).toHaveLength(1)
    expect(logged('warn', 'stand is over the limit')).toHaveLength(1)
    expect(answered().limitReported).toBe(true)

    // The next move of the agent gets no signal any more.
    world.facts = boundaryAt(Date.now(), 'next0002')
    runner.signalCardBoundaryAtMove(A, 'next0002', 'in_progress', 'testing')
    expect(files()).toEqual([`${A}.answered.json`])
  })

  it('...and when the tool call finally comes, the stand is measured, and nothing is switched off a second time', async () => {
    const turnEndMs = await restartedActive()
    await vi.advanceTimersByTimeAsync(21 * MIN)
    expect(world.writeCfg).toHaveBeenCalledTimes(1)
    world.firstToolUseMs = turnEndMs + 22 * MIN
    await nextSweep()
    expect(logged('info', 'card-boundary stand measured')).toEqual([expect.objectContaining({ standMs: 22 * MIN })])
    expect(world.writeCfg).toHaveBeenCalledTimes(1)
    expect(switchOffMessages()).toHaveLength(1)
    expect(files()).toEqual([])
  })

  it('a stand over the limit that is only SEEN at the first tool call switches off too', async () => {
    // The record is read on the sweep; a dashboard that was down in between sees the long stand late.
    const turnEndMs = await restartedActive()
    dashboardStops()
    await vi.advanceTimersByTimeAsync(14 * MIN)
    world.firstToolUseMs = turnEndMs + 13 * MIN
    await dashboardStarts()
    await vi.advanceTimersByTimeAsync(5 * MIN)
    expect(logged('info', 'card-boundary stand measured')).toEqual([expect.objectContaining({ standMs: 13 * MIN })])
    expect(world.writeCfg).toHaveBeenCalledTimes(1)
    expect(switchOffMessages()).toHaveLength(1)
  })

  it('a long stand after a PASSIVE restart is reported, and switches nothing off: no signal made the agent stop', async () => {
    world.cfg = { ...PASSIVE_ONLY }
    await dashboardStarts()
    await movesCard()
    world.paneState = 'idle'
    await nextSweep()
    expect(answered()).toMatchObject({ half: 'passive' })
    world.sessionReady = true
    world.facts = { boundary: null, blockers: [] }
    await vi.advanceTimersByTimeAsync(31 * MIN)
    expect(logged('warn', 'stand is over the limit')).toHaveLength(1)
    expect(world.writeCfg).not.toHaveBeenCalled()
    expect(switchOffMessages()).toEqual([])
  })

  it('a "carry on" is an active answer too: standing 10 minutes after it switches the half off', async () => {
    await dashboardStarts()
    await movesCard()
    const sig = signalFile()
    hookShows()
    world.facts = boundaryAt(sig.movedAtMs, CARD, ['1 undelivered message waits'])
    world.paneState = 'idle'
    await nextSweep()
    expect(answered()).toMatchObject({ how: 'continue' })
    await vi.advanceTimersByTimeAsync(16 * MIN)
    expect(world.writeCfg).toHaveBeenCalledTimes(1)
    expect(switchOffMessages()).toHaveLength(1)
    expect(switchOffMessages()[0].content).toContain('the guard\'s answer was: continue')
  })

  it('followed to its end even if every tier was switched off meanwhile', async () => {
    const turnEndMs = await restartedActive()
    await vi.advanceTimersByTimeAsync(2 * MIN)
    world.cfg = {}
    world.firstToolUseMs = turnEndMs + 60_000
    await vi.advanceTimersByTimeAsync(40 * MIN)
    expect(logged('info', 'card-boundary stand measured')).toHaveLength(1)
    expect(files()).toEqual([])
  })

  it('no tool call within the follow window: the record is dropped, and the log says the stand was NOT measured', async () => {
    world.cfg = { ...PASSIVE_ONLY }
    await dashboardStarts()
    await movesCard()
    world.paneState = 'idle'
    await nextSweep()
    world.sessionReady = true
    world.facts = { boundary: null, blockers: [] }
    await vi.advanceTimersByTimeAsync(70 * MIN)
    expect(logged('warn', 'stand NOT measured')).toHaveLength(1)
    expect(files()).toEqual([])
  })
})
