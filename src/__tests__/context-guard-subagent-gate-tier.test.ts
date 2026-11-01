// Card b83e079c (marveen, didi 10005439): the sub-agent gate refuses a new sub-agent at 75% of
// limitTokens and says "handoff first, the fresh session spawns it", but the guard asked for a
// handoff only at actPct (90%). Between the two a written HANDOFF.md brought no fresh session:
// didi stood at 78%, 79% and 76% on 2026-11-01, three manual restarts in one night. The gate now
// records its refusal, and the guard's sub-agent gate tier keeps the gate's promise.
import { describe, it, expect, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  DEFAULT_CONTEXT_GUARD,
  INITIAL_GUARD_STATE,
  SUBAGENT_GATE_REASON_PREFIX,
  decideGuard,
  type ContextGuardConfig,
  type GuardInputs,
} from '../context-guard.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('guardgate-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn() }))
vi.mock('../web/channel-monitor.js', () => ({
  hardRestartMarveenChannels: vi.fn(() => ({ ok: true })),
  lastMainRespawnAt: () => null,
  MARVEEN_POST_RESPAWN_GRACE_MS: 0,
}))
vi.mock('../web/stuck-tool-call-watcher.js', () => ({ shouldDeferForRecentRespawn: () => false }))
vi.mock('../web/agent-process.js', () => ({
  clearFeedbackModalAndRecheck: () => false,
  agentRunState: () => 'stopped',
  agentSessionName: (n: string) => `agent-${n}`,
  restartAgentProcess: vi.fn(),
  capturePane: () => null,
  sendPromptToSession: vi.fn(),
  isSessionReadyForPrompt: async () => false,
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))

const { readSubagentGateRefusal, subagentGateHandoffPrompt } = await import('../web/context-guard-runner.js')

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const NOW = 1_793_520_000_000
const MIN = 60_000
const REFUSED_AT = NOW - 20 * MIN

const cfg: ContextGuardConfig = {
  ...DEFAULT_CONTEXT_GUARD,
  enabled: true,
  actPct: 0.9,
  hardPct: 0.97,
  limitTokens: 200_000,
  idleFlushEnabled: false,
  dailyHandoffEnabled: false,
}

function inputs(overrides: Partial<GuardInputs> = {}): GuardInputs {
  return {
    nowMs: NOW,
    pct: 0.78,
    running: true,
    paneIdle: true,
    paneBusy: false,
    sessionReady: false,
    handoffMtime: null,
    paneSaturated: false,
    dailyHandoffDue: false,
    contextTokens: null,
    idleMs: 0,
    subagentGateRefusal: { atMs: REFUSED_AT, gatePct: 0.75 },
    ...overrides,
  }
}

describe('the card control: 78%, a refusal, a handoff written on the gate\'s word', () => {
  it('requests the handoff, and the handoff written after the refusal restarts on the next sweep', () => {
    const handoffAt = REFUSED_AT + 5 * MIN
    const first = decideGuard(INITIAL_GUARD_STATE, inputs({ handoffMtime: handoffAt }), cfg)
    expect(first.action).toBe('request-handoff')
    expect(first.reason.startsWith(SUBAGENT_GATE_REASON_PREFIX)).toBe(true)
    expect(first.reason).toContain('context now 78%')
    expect(first.nextState.phase).toBe('await-handoff')
    // The baseline is the refusal, so the handoff already on disk counts as written.
    expect(first.nextState.handoffMtimeAtRequest).toBe(REFUSED_AT)
    // idleMs 0 = the transcript's last activity is now; the handoff is 15 minutes behind it, so the
    // staleness check would ask for a refresh. Its last activity is the handoff itself here.
    const second = decideGuard(first.nextState, inputs({ nowMs: NOW + 5 * MIN, handoffMtime: handoffAt, idleMs: 5 * MIN + (NOW - handoffAt) }), cfg)
    expect(second.action).toBe('restart')
    expect(second.reason).toContain('handoff written')
  })
  it('negative control: the same session with no refusal stays below threshold (the gap the card measured)', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ subagentGateRefusal: null, handoffMtime: REFUSED_AT + 5 * MIN }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toBe('below threshold')
  })
  it('a HANDOFF.md older than the refusal is not the handoff: the agent is asked, and the old file does not restart it', () => {
    const first = decideGuard(INITIAL_GUARD_STATE, inputs({ handoffMtime: REFUSED_AT - 60 * MIN }), cfg)
    expect(first.action).toBe('request-handoff')
    const second = decideGuard(first.nextState, inputs({ nowMs: NOW + 5 * MIN, handoffMtime: REFUSED_AT - 60 * MIN }), cfg)
    expect(second.action).toBe('none')
    expect(second.reason).toBe('waiting for handoff')
    expect(second.nextState.phase).toBe('await-handoff')
  })
})

describe('edges', () => {
  it('below the gate threshold the refusal is no reason', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.74 }), cfg)
    expect(d.action).toBe('none')
  })
  it('at the act threshold the act tier answers, not this one', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: 0.91 }), cfg)
    expect(d.action).toBe('request-handoff')
    expect(d.reason.startsWith('act threshold')).toBe(true)
  })
  it('not while background work runs: the agent keeps working inline, the tier waits', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ backgroundWork: 1, backgroundWorkDetail: '1 shell' }), cfg)
    expect(d.action).toBe('none')
    expect(d.reason).toContain('not starting a handoff')
  })
  it('the proactive guard off: no tier', () => {
    const d = decideGuard(INITIAL_GUARD_STATE, inputs({ pct: null }), { ...cfg, enabled: false })
    expect(d.action).toBe('none')
  })
})

describe('the runner reads only a refusal from THIS session', () => {
  const dir = mkTmp('refusals-')
  const write = (name: string, body: unknown) => writeFileSync(join(dir, `${name}.json`), typeof body === 'string' ? body : JSON.stringify(body))
  write('didi', { atMs: REFUSED_AT, pct: 0.78, gatePct: 0.75 })
  write('bad', '{not json')
  write('nopct', { atMs: REFUSED_AT })
  it('a refusal after the session start is passed on', () => {
    expect(readSubagentGateRefusal('didi', (REFUSED_AT - MIN) / 1000, dir)).toEqual({ atMs: REFUSED_AT, gatePct: 0.75 })
  })
  it('a refusal from before the session start belongs to the restarted session: null', () => {
    expect(readSubagentGateRefusal('didi', (REFUSED_AT + MIN) / 1000, dir)).toBeNull()
  })
  it('unknown session start, no file, malformed file, missing gatePct: null', () => {
    expect(readSubagentGateRefusal('didi', undefined, dir)).toBeNull()
    expect(readSubagentGateRefusal('nobody', 0, dir)).toBeNull()
    expect(readSubagentGateRefusal('bad', 0, dir)).toBeNull()
    expect(readSubagentGateRefusal('nopct', 0, dir)).toBeNull()
  })
  it('the request does not tell an agent below actPct that its context is critical', () => {
    const text = subagentGateHandoffPrompt(78, '/x/HANDOFF.md')
    expect(text).toContain('~78%')
    expect(text).toContain('ne írd újra')
    expect(text).toContain('/x/HANDOFF.md')
    expect(text).not.toContain('kritikus')
  })
})

describe('the gate records its refusal where the runner reads it', () => {
  const root = mkTmp('gaterec-')
  const config = join(root, 'context-guard.json')
  writeFileSync(config, JSON.stringify({ dexter: { enabled: true, actPct: 0.9, hardPct: 0.97, limitTokens: 200_000 } }))
  const tdir = join(root, 'agents', 'dexter', '.claude-config', 'projects', '-Users-Shared-marveen-dexter')
  mkdirSync(tdir, { recursive: true })
  const usage = (tokens: number) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })
  const call = (tokens: number) => {
    const file = join(tdir, `t${tokens}.jsonl`)
    writeFileSync(file, usage(tokens) + '\n')
    return spawnSync('python3', [join(REPO, 'scripts', 'hooks', 'subagent-context-gate.py')], {
      input: JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: '/Users/Shared/marveen-dexter', transcript_path: file }),
      env: { ...process.env, SUBAGENT_GATE_CONFIG: config },
      encoding: 'utf8',
    })
  }
  const marker = join(root, 'subagent-gate-refusals', 'dexter.json')
  it('an allowed call writes nothing', () => {
    expect(call(100_000).status).toBe(0)
    expect(existsSync(marker)).toBe(false)
  })
  it('a refusal writes the marker the runner accepts, and the stderr names the guard\'s part', () => {
    const before = Date.now()
    const r = call(156_000)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('The context guard has this refusal')
    const rec = JSON.parse(readFileSync(marker, 'utf8'))
    expect(rec.gatePct).toBe(0.75)
    expect(rec.pct).toBe(0.78)
    expect(rec.atMs).toBeGreaterThanOrEqual(before)
    expect(readSubagentGateRefusal('dexter', Math.floor(before / 1000) - 1, join(root, 'subagent-gate-refusals'))).toEqual({ atMs: rec.atMs, gatePct: 0.75 })
  })
  it('the runner reads the same directory the gate writes in the live layout (store/, next to context-guard.json)', () => {
    const runner = readFileSync(join(REPO, 'src', 'web', 'context-guard-runner.ts'), 'utf8')
    expect(runner).toContain("join(PROJECT_ROOT, 'store', 'subagent-gate-refusals')")
    const gate = readFileSync(join(REPO, 'scripts', 'hooks', 'subagent-context-gate.py'), 'utf8')
    expect(gate).toContain('os.path.join(os.path.dirname(CONFIG_PATH), "subagent-gate-refusals")')
    expect(gate).toContain('"store", "context-guard.json"')
  })
})
