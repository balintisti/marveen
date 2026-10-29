// KILLSWITCH1022: the fleet freeze ("piros gomb"). Switching it on is open to any
// dashboard credential (an agent may pull the brake); lifting it takes the owner,
// through mayLiftFleetFreeze (a local copy of upstream's mayIssueCredentials, #2163, which is not in this tree).
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const ROOT = mkTmp('fleet-freeze-')
mkdirSync(join(ROOT, 'store'), { recursive: true })

vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), PROJECT_ROOT: ROOT, MAIN_AGENT_ID: 'marveen' }))
const running = new Set<string>()
const stopSpy = vi.hoisted(() => vi.fn())
const startSpy = vi.hoisted(() => vi.fn())
vi.mock('../web/agent-process.js', () => ({
  isAgentRunning: (n: string) => running.has(n),
  agentHasChannel: (n: string) => n === 'zara',
  stopAgentProcess: async (n: string) => { stopSpy(n); running.delete(n); return { ok: true } },
  startAgentProcess: async (n: string, o: unknown) => { startSpy(n, o); running.add(n); return { ok: true } },
}))
vi.mock('../web/agent-config.js', async (orig) => ({ ...(await orig<typeof import('../web/agent-config.js')>()), listAgentNames: () => ['samu', 'zara', 'iris', 'marveen', 'kint'], readAgentRemoteHost: (n: string) => (n === 'kint' ? 'vps.example' : null) }))
const notifySpy = vi.hoisted(() => vi.fn(async (_text: string) => {}))
vi.mock('../notify.js', async (orig) => ({ ...(await orig<typeof import('../notify.js')>()), notifyOwner: notifySpy }))

const { initDatabase, getDb } = await import('../db.js')
const { tryHandleFleetFreeze } = await import('../web/routes/fleet-freeze.js')
const { tryHandleAuth } = await import('../web/routes/auth.js')
const { FLEET_FREEZE_PATH, isFleetFrozen, readFleetFreeze, frozenSkip, whileNotFrozen } = await import('../web/fleet-freeze.js')
const { _clearSessionCacheForTest, createSession } = await import('../web/auth-sessions.js')
const { SESSION_COOKIE_NAME } = await import('../web/auth-gate.js')
type Ctx = import('../web/routes/types.js').RouteContext

const TOKEN: Ctx['auth'] = { kind: 'token' }
const SESSION: Ctx['auth'] = { kind: 'session', user: 'owner' }

async function call(method: string, path: string, auth: Ctx['auth'], body?: unknown, headers: Record<string, string> = {}, handler = tryHandleFleetFreeze) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage
  req.headers = headers
  const out = { status: 0, body: '' }
  const res = { writeHead(s: number) { out.status = s; return res }, setHeader() {}, end(d?: string) { if (d !== undefined) out.body += d } }
  const url = new URL(`http://127.0.0.1:3420${path}`)
  expect(await handler({ req, res: res as unknown as http.ServerResponse, path: url.pathname, method, url, auth })).toBe(true)
  return { status: out.status, json: JSON.parse(out.body || '{}') as Record<string, any> }
}
const freeze = (auth: Ctx['auth'], body: unknown = { reason: 'teszt' }) => call('POST', '/api/fleet/freeze', auth, body)
const unfreeze = (auth: Ctx['auth'], headers: Record<string, string> = {}) => call('POST', '/api/fleet/unfreeze', auth, undefined, headers)
const addOwner = () => call('POST', '/api/auth/users', TOKEN, { username: 'owner', password: 'super-secret-pw' }, {}, tryHandleAuth)

beforeAll(() => { process.env.NODE_ENV = 'test'; initDatabase(':memory:') })
beforeEach(() => {
  getDb().exec('DELETE FROM auth_sessions; DELETE FROM dashboard_users')
  _clearSessionCacheForTest()
  rmSync(FLEET_FREEZE_PATH, { force: true })
  running.clear(); stopSpy.mockClear(); startSpy.mockClear(); notifySpy.mockClear()
})

describe('switching it on', () => {
  it('any agent may pull the brake with the token; the state names who and why, and the owner is told', async () => {
    const r = await freeze(TOKEN, { reason: 'elszabadult levélküldés' })
    expect(r.status).toBe(200)
    expect(isFleetFrozen()).toBe(true)
    expect(readFleetFreeze()).toMatchObject({ mode: 'freeze', reason: 'elszabadult levélküldés', by: 'token' })
    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect((await call('GET', '/api/fleet/freeze', TOKEN)).json).toMatchObject({ frozen: true, state: { mode: 'freeze' } })
  })

  it('a reason is required, and the mode is freeze or stop only', async () => {
    expect((await freeze(TOKEN, {})).status).toBe(400)
    expect((await freeze(TOKEN, { reason: 'x'.repeat(501) })).status).toBe(400)
    expect((await freeze(TOKEN, { reason: 'x', mode: 'nuke' })).status).toBe(400)
    expect(isFleetFrozen()).toBe(false)
  })

  it('a federation peer cannot pull our brake', async () => {
    expect((await freeze({ kind: 'federation', peer: 'teodor' })).status).toBe(403)
    expect(isFleetFrozen()).toBe(false)
  })

  it('freeze keeps every session; stop stops the running sub-agents, never the main agent', async () => {
    running.add('samu'); running.add('zara'); running.add('marveen')
    await freeze(TOKEN)
    expect(stopSpy).not.toHaveBeenCalled()
    const r = await freeze(SESSION, { reason: 'mindent le', mode: 'stop' })
    expect(r.json.state.mode).toBe('stop')
    expect(stopSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['samu', 'zara'])
    expect(running.has('marveen')).toBe(true)
    expect(readFleetFreeze()!.stoppedAgents!.sort()).toEqual(['samu', 'zara'])
    // the first reason stays; a later 'freeze' never downgrades a stop
    expect(readFleetFreeze()!.reason).toBe('teszt')
    await freeze(TOKEN, { reason: 'megint', mode: 'freeze' })
    expect(readFleetFreeze()!.mode).toBe('stop')
  })
})

describe('lifting it: the owner only (mayLiftFleetFreeze)', () => {
  it('once a login exists the token is refused, and the fleet stays frozen', async () => {
    expect((await addOwner()).status).toBe(201)
    await freeze(TOKEN)
    const r = await unfreeze(TOKEN)
    expect(r.status).toBe(403)
    expect(r.json.code).toBe('owner_session_required')
    expect(isFleetFrozen()).toBe(true)
  })

  it('a device key is refused too, with or without a login on the install', async () => {
    await freeze(TOKEN)
    expect((await unfreeze({ kind: 'device', device: 'phone' })).status).toBe(403)
    expect((await addOwner()).status).toBe(201)
    expect((await unfreeze({ kind: 'device', device: 'phone' })).status).toBe(403)
    expect(isFleetFrozen()).toBe(true)
  })

  it('the owner session lifts it, restarts exactly the stopped agents (a channel agent fresh) and tells the owner', async () => {
    expect((await addOwner()).status).toBe(201)
    running.add('samu'); running.add('zara')
    await freeze(TOKEN, { reason: 'x', mode: 'stop' })
    notifySpy.mockClear()
    const r = await unfreeze(SESSION)
    expect(r.status).toBe(200)
    expect(isFleetFrozen()).toBe(false)
    expect(r.json.restarted.sort()).toEqual(['samu', 'zara'])
    expect(startSpy).toHaveBeenCalledWith('zara', { fresh: true })
    expect(startSpy).toHaveBeenCalledWith('samu', { fresh: false })
    expect(notifySpy).toHaveBeenCalledTimes(1)
  })

  it('the token with the owner\'s live session cookie counts as the owner (the browser sends both)', async () => {
    expect((await addOwner()).status).toBe(201)
    await freeze(TOKEN)
    const owner = getDb().prepare("SELECT id FROM dashboard_users WHERE username = 'owner'").get() as { id: number }
    const cookieValue = createSession({ userId: owner.id, username: 'owner' })
    expect((await unfreeze(TOKEN, { cookie: `${SESSION_COOKIE_NAME}=${cookieValue}` })).status).toBe(200)
    expect(isFleetFrozen()).toBe(false)
  })

  it('before the first login exists the token is the one owner credential there is', async () => {
    await freeze(TOKEN)
    expect((await unfreeze(TOKEN)).status).toBe(200)
    expect(isFleetFrozen()).toBe(false)
  })
})

describe("the owner's phone: /stop and /resume", () => {
  async function cmd(text: string): Promise<string[]> {
    const { registerBuiltinCommands } = await import('../web/builtin-commands.js')
    const { dispatchCommand } = await import('../web/commands.js')
    registerBuiltinCommands()
    const replies: string[] = []
    await dispatchCommand(text, { reply: async (t: string) => { replies.push(t) }, ownerId: 1, now: Date.now() })
    return replies
  }

  it('/stop <reason> freezes the fleet as the owner command; a bare /stop only asks for the reason', async () => {
    const bare = await cmd('/stop')
    expect(isFleetFrozen()).toBe(false)
    expect(bare.join(' ')).toMatch(/indok/)
    const r = await cmd('/stop furcsa levelek mennek ki')
    expect(isFleetFrozen()).toBe(true)
    expect(readFleetFreeze()).toMatchObject({ mode: 'freeze', reason: 'furcsa levelek mennek ki', by: 'owner-command' })
    expect(r.join(' ')).toMatch(/FAGYASZTVA/)
  })

  it('/resume never lifts it: it points to the dashboard login', async () => {
    await freeze(TOKEN)
    const r = await cmd('/resume')
    expect(isFleetFrozen()).toBe(true)
    expect(r.join(' ')).toMatch(/dashboard/)
  })
})

describe("the owner's phone: /stop through the dispatch route (dispatchForChat)", () => {
  // The deepest level this suite reaches: the route's own decision function with the
  // REAL builtin registry. Above it (the Telegram plugin's message:text handler and
  // the UserPromptSubmit hook process) is covered by marveen-commands-hook.test.ts
  // against a stub dashboard, not by this file.
  const OWNER = '42'
  const OK = () => ({ ok: true as const })
  async function stop(text: string, opts: { chat?: string; main?: boolean; defer?: boolean; fwd?: boolean; ev?: () => { ok: true } | { ok: false; reason: string } } = {}) {
    const { registerBuiltinCommands } = await import('../web/builtin-commands.js')
    const { clearCommandsForTest } = await import('../web/commands.js')
    const { dispatchForChat } = await import('../web/routes/commands.js')
    clearCommandsForTest()
    registerBuiltinCommands()
    return dispatchForChat(text, opts.chat ?? OWNER, OWNER, Date.now(), opts.main ?? true, opts.defer ?? false, opts.fwd ?? false, '777', (opts.ev ?? OK) as never)
  }

  it('the owner chat, main session, with inbound evidence: /stop <reason> freezes the fleet', async () => {
    const r = await stop('/stop furcsa levelek mennek ki')
    expect(r).toMatchObject({ handled: true, outcome: 'ran' })
    expect(r.replies.join(' ')).toMatch(/FAGYASZTVA/)
    expect(readFleetFreeze()).toMatchObject({ mode: 'freeze', reason: 'furcsa levelek mennek ki', by: 'owner-command' })
  })

  it('the hook first call (deferWrites) only defers: nothing is frozen until the re-send', async () => {
    const r = await stop('/stop teszt', { defer: true })
    expect(r).toEqual({ handled: true, outcome: 'deferred', replies: [] })
    expect(isFleetFrozen()).toBe(false)
  })

  it.each([
    ['a foreign chat', { chat: '43' }, 'not-owner'],
    ['a sub-agent session', { main: false }, 'sub-agent-write-refused'],
    ['a forwarded message', { fwd: true }, 'forwarded-refused'],
    ['no inbound evidence', { ev: () => ({ ok: false as const, reason: 'not-found' }) }, 'write-evidence-refused'],
  ])('%s: /stop does not freeze', async (_label, opts, outcome) => {
    const r = await stop('/stop teszt', opts as never)
    expect(r.outcome).toBe(outcome)
    expect(isFleetFrozen()).toBe(false)
  })

  it('/resume is a read: it runs for the owner without evidence and never lifts a freeze', async () => {
    await stop('/stop teszt')
    const r = await stop('/resume', { ev: () => ({ ok: false as const, reason: 'not-found' }) })
    expect(r).toMatchObject({ handled: true, outcome: 'ran' })
    expect(isFleetFrozen()).toBe(true)
  })
})

describe('the loops', () => {
  it('a wrapped tick does nothing while frozen and runs again after', async () => {
    const tick = vi.fn(() => 'ran')
    const wrapped = whileNotFrozen('test-loop', tick)
    expect(wrapped()).toBe('ran')
    await freeze(TOKEN)
    expect(wrapped()).toBeUndefined()
    expect(frozenSkip('test-loop-2')).toBe(true)
    rmSync(FLEET_FREEZE_PATH)
    expect(wrapped()).toBe('ran')
    expect(tick).toHaveBeenCalledTimes(2)
  })

  it('an unreadable freeze file still counts as frozen', () => {
    writeFileSync(FLEET_FREEZE_PATH, '{not json')
    expect(isFleetFrozen()).toBe(true)
    expect(readFleetFreeze()).toMatchObject({ mode: 'freeze' })
  })

  // The binding: every loop that acts on agents carries the gate in its tick, in
  // the shape that has the effect (a wrapper the timer actually calls, or an
  // early return), not just the name somewhere in the file.
  const SRC = join(__dirname, '..')
  it.each([
    ['web/message-router.ts', /setInterval\(whileNotFrozen\('message-router', async \(\) => \{/],
    ['web/schedule-runner.ts', /setInterval\(whileNotFrozen\('schedule-runner', \(\) => \{ void runCheck\(\) \}\), SCHEDULE_TICK_MS\)/],
    ['web/auto-restart-runner.ts', /setInterval\(whileNotFrozen\('auto-restart', sweep\), INTERVAL_MS\)/],
    ['web/reauth-healer.ts', /setInterval\(whileNotFrozen\('reauth-healer', sweep\), PROBE_INTERVAL_MS\)/],
    ['web/context-guard-runner.ts', /setInterval\(whileNotFrozen\('context-guard', sweep\), INTERVAL_MS\)/],
    // Ours (not in upstream 964acff3e): the await-ready poll types the resume prompt into a session.
    ['web/context-guard-runner.ts', /setInterval\(whileNotFrozen\('context-guard-ready-poll', readyPoll\), READY_POLL_MS\)/],
    ['web/context-restart-gate-runner.ts', /if \(frozenSkip\('context-restart-gate'\)\) \{\s*scheduleSweep\(name, DISABLED_RECHECK_MS\)\s*return\s*\}/],
    ['web/model-fallback-runner.ts', /setInterval\(whileNotFrozen\('model-fallback', sweep\), INTERVAL_MS\)/],
    ['web/inbox-nudge-watcher.ts', /setInterval\(whileNotFrozen\('inbox-nudge', \(\) => \{ void tick\(\) \}\), INBOX_NUDGE_INTERVAL_MS\)/],
    ['web/stuck-input-watcher.ts', /setInterval\(whileNotFrozen\('stuck-input', \(\) => \{ void sweep\(\) \}\), INTERVAL_MS\)/],
    ['web/stuck-tool-call-watcher.ts', /setInterval\(whileNotFrozen\('stuck-tool-call', \(\) => \{ void sweep\(\) \}\), INTERVAL_MS\)/],
    ['web/channel-monitor.ts', /setInterval\(whileNotFrozen\('channel-monitor', \(\) => \{ void check\(\) \}\), 60000\)/],
    ['web/channel-health-monitor.ts', /setInterval\(whileNotFrozen\('channel-health', check\), 60_000\)/],
    ['web/worker-liveness.ts', /setInterval\(whileNotFrozen\('worker-liveness', tick\), LIVENESS_POLL_MS\)/],
    ['web/federation/poller.ts', /setInterval\(whileNotFrozen\('federation-poller', \(\) => \{ refreshFederationStatus\(\)/],
    ['web/federation/capability-runner.ts', /setInterval\(whileNotFrozen\('capability-runner', tick\), CAPABILITY_RUNNER_INTERVAL_MS\)/],
  ])('%s gates its tick in the effective shape (%s)', (file, re) => {
    const src = readFileSync(join(SRC, file), 'utf-8')
    expect(src).toMatch(re)
    // and the timer is started only once, through the gate
    expect(src.match(/return setInterval\(/g)?.length ?? 0).toBeLessThanOrEqual(2)
  })

  // Ours (not in upstream 964acff3e): the one-shot first tick of a loop is gated too. A
  // dashboard restart WHILE frozen would otherwise run every loop's first tick once
  // (channel-monitor's would revive the stopped agents 30 s after boot).
  it.each([
    ['web/auto-restart-runner.ts', /setTimeout\(whileNotFrozen\('auto-restart', sweep\), INITIAL_DELAY_MS\)/],
    ['web/channel-monitor.ts', /setTimeout\(whileNotFrozen\('channel-monitor', \(\) => \{ void check\(\) \}\), 30000\)/],
    ['web/channel-health-monitor.ts', /setTimeout\(whileNotFrozen\('channel-health', check\), 45_000\)/],
    ['web/context-guard-runner.ts', /setTimeout\(whileNotFrozen\('context-guard', sweep\), INITIAL_DELAY_MS\)/],
    ['web/inbox-nudge-watcher.ts', /setTimeout\(whileNotFrozen\('inbox-nudge', \(\) => \{ void tick\(\) \}\), INBOX_NUDGE_INITIAL_DELAY_MS\)/],
    ['web/model-fallback-runner.ts', /setTimeout\(whileNotFrozen\('model-fallback', sweep\), INITIAL_DELAY_MS\)/],
    ['web/reauth-healer.ts', /setTimeout\(whileNotFrozen\('reauth-healer', sweep\), INITIAL_DELAY_MS\)/],
    ['web/schedule-runner.ts', /setTimeout\(whileNotFrozen\('schedule-runner', \(\) => \{ void runCheck\(\) \}\), 5000\)/],
    ['web/stuck-input-watcher.ts', /setTimeout\(whileNotFrozen\('stuck-input', \(\) => \{ void sweep\(\) \}\), INITIAL_DELAY_MS\)/],
    ['web/stuck-tool-call-watcher.ts', /setTimeout\(whileNotFrozen\('stuck-tool-call', \(\) => \{ void sweep\(\) \}\), INITIAL_DELAY_MS\)/],
    ['web/federation/poller.ts', /setTimeout\(whileNotFrozen\('federation-poller', \(\) => \{ refreshFederationStatus\(\)/],
    ['web/federation/capability-runner.ts', /setTimeout\(whileNotFrozen\('capability-runner', tick\), CAPABILITY_RUNNER_INITIAL_DELAY_MS\)/],
  ])('%s gates its first one-shot tick too (%s)', (file, re) => {
    expect(readFileSync(join(SRC, file), 'utf-8')).toMatch(re)
  })

  // Behaviour, not text, for the timer wiring of the three loops that matter most:
  // a fake clock drives the real start function; frozen, the wrapped body never runs.
  it('a wrapper handed to setInterval runs nothing while frozen, and runs again after', async () => {
    vi.useFakeTimers()
    try {
      const body = vi.fn()
      const t = setInterval(whileNotFrozen('fake-loop', body), 1000)
      await freeze(TOKEN)
      vi.advanceTimersByTime(3000)
      expect(body).not.toHaveBeenCalled()
      rmSync(FLEET_FREEZE_PATH)
      vi.advanceTimersByTime(2000)
      expect(body).toHaveBeenCalledTimes(2)
      clearInterval(t)
    } finally { vi.useRealTimers() }
  })
})

describe("the dashboard's own Claude calls and the worker session", () => {
  it('runAgent refuses while frozen and starts no worker turn', async () => {
    const runViaWorker = vi.fn(async () => ({ text: 'ok' }))
    vi.doMock('../web/agent-worker.js', async (orig) => ({ ...(await orig<typeof import('../web/agent-worker.js')>()), runViaWorker }))
    const { runAgent } = await import('../agent.js')
    await freeze(TOKEN)
    expect(await runAgent('napi naplo', undefined, undefined, true)).toEqual({ text: null, error: 'fleet frozen (KILLSWITCH1022)' })
    expect(runViaWorker).not.toHaveBeenCalled()
    rmSync(FLEET_FREEZE_PATH)
    expect((await runAgent('napi naplo')).text).toBe('ok')
    expect(runViaWorker).toHaveBeenCalledTimes(1)
    vi.doUnmock('../web/agent-worker.js')
  })

  it("the worker's own settings get the gate first in PreToolUse, once, and keep everything else", async () => {
    const { withFleetFreezeGate, WORKER_FREEZE_GATE_CMD } = await import('../web/agent-worker.js')
    const other = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }
    const once = withFleetFreezeGate({ enabledPlugins: { x: false }, hooks: { PreToolUse: [other], Stop: [{ hooks: [] }] } })
    const twice = withFleetFreezeGate(once)
    const pre = (twice.hooks as any).PreToolUse
    expect(pre).toHaveLength(2)
    expect(pre[0]).toEqual({ matcher: '*', hooks: [{ type: 'command', command: WORKER_FREEZE_GATE_CMD, timeout: 5 }] })
    expect(pre[1]).toEqual(other)
    expect((twice.hooks as any).Stop).toEqual([{ hooks: [] }])
    expect(twice.enabledPlugins).toEqual({ x: false })
    expect(WORKER_FREEZE_GATE_CMD).toContain(join('scripts', 'hooks', 'fleet-freeze-gate.sh'))
  })

  it('ensureWorkerCwd writes the worker settings through withFleetFreezeGate', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'agent-worker.ts'), 'utf-8')
    expect(src).toMatch(/writeFileSync\(settingsPath, JSON\.stringify\(withFleetFreezeGate\(\{/)
  })
})

describe('agents on another machine', () => {
  it('are named as not frozen in the answer, the status and the owner notice', async () => {
    const r = await freeze(TOKEN)
    expect(r.json.notFrozen).toEqual(['kint'])
    expect((await call('GET', '/api/fleet/freeze', TOKEN)).json.notFrozen).toEqual(['kint'])
    expect(String(notifySpy.mock.calls[0]![0])).toMatch(/NEM fagyasztva.*kint/)
  })
})

describe('the tool-call hook', () => {
  const REPO = join(__dirname, '..', '..')
  function hookCommandFrom(settingsText: string): string {
    const pre = (JSON.parse(settingsText).hooks.PreToolUse as Array<{ matcher: string; hooks: Array<{ command: string }> }>)
    const e = pre.find((x) => x.hooks.some((h) => h.command.includes('fleet-freeze-gate.sh')))
    expect(e?.matcher).toBe('*')
    return e!.hooks[0]!.command
  }
  // The real script, pointed at this test's freeze file.
  function run(command: string, env: Record<string, string> = {}) {
    return spawnSync('bash', ['-c', command], { encoding: 'utf-8', env: { ...process.env, FLEET_FREEZE_FILE: FLEET_FREEZE_PATH, ...env } })
  }

  it('the sub-agent template denies every tool (exit 2) while the file exists, and nothing otherwise', () => {
    const cmd = hookCommandFrom(readFileSync(join(REPO, 'templates', 'settings.json.template'), 'utf-8').split('{{PROJECT_ROOT}}').join(REPO))
    rmSync(FLEET_FREEZE_PATH, { force: true })
    expect(run(cmd).status).toBe(0)
    writeFileSync(FLEET_FREEZE_PATH, '{}')
    const r = run(cmd)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/FLOTTA FAGYASZTVA/)
  })

  it('the main agent (project settings) runs the same gate from its project dir', () => {
    const cmd = hookCommandFrom(readFileSync(join(REPO, '.claude', 'settings.json'), 'utf-8'))
    rmSync(FLEET_FREEZE_PATH, { force: true })
    expect(run(cmd, { CLAUDE_PROJECT_DIR: REPO }).status).toBe(0)
    writeFileSync(FLEET_FREEZE_PATH, '{}')
    expect(run(cmd, { CLAUDE_PROJECT_DIR: REPO }).status).toBe(2)
    expect(existsSync(FLEET_FREEZE_PATH)).toBe(true)
  })

  it('without the override the gate watches <install>/store/fleet-freeze.json', () => {
    const script = readFileSync(join(REPO, 'scripts', 'hooks', 'fleet-freeze-gate.sh'), 'utf-8')
    expect(script).toContain('FREEZE="${FLEET_FREEZE_FILE:-$ROOT/store/fleet-freeze.json}"')
  })
})
