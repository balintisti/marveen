// Card cb25d896: the runner side of the idle-shell release. The footer's shells are mapped to their
// processes (Claude Code's snapshot-wrapped `zsh -c`, children of the pane's claude process) and their
// subtree CPU is judged over SHELL_CPU_WINDOW_MS. Three measured cases are re-run here with REAL
// processes (raw 15-minute measurements: cb25d896 gate dir, cb25-cpu-raw.csv): an idle http.server and
// a sleeping poll loop read idle, a CPU job reads working. Every way the mapping can fail is a verdict
// of "not measured", and the guard then holds as before.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import {
  DEFAULT_CONTEXT_GUARD,
  SHELL_CPU_IDLE_FLOOR_SEC,
  SHELL_CPU_MIN_SPAN_MS,
  SHELL_CPU_WINDOW_MS,
  decideGuard,
  type GuardInputs,
  type GuardState,
} from '../context-guard.js'
import {
  BACKGROUND_SHELL_MARK,
  ShellCpuTracker,
  backgroundShellCommand,
  findBackgroundShells,
  parseCpuLines,
  readProcessTable,
  type ProcTable,
} from '../web/background-shell-cpu.js'
import { buildRestartTail } from '../web/restart-tail.js'

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('shellcpu-')

vi.mock('../config.js', async (orig) => {
  const actual = await orig<typeof import('../config.js')>()
  return { ...actual, MAIN_AGENT_ID: 'marveen', PROJECT_ROOT: SANDBOX, STORE_DIR: join(SANDBOX, 'store') }
})
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('../db.js', () => ({ createAgentMessage: vi.fn(), getAgentCommentsSince: vi.fn(() => []), getAgentMessagesSince: vi.fn(() => []) }))
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
  paneEchoesInput: async () => 'echoed',
}))
vi.mock('../web/main-agent.js', () => ({ MAIN_CHANNELS_SESSION: 'marveen-channels' }))

const { measureBackgroundShellCpu, withBackgroundStopHint, handoffPrompt, idleFlushHandoffPrompt, BACKGROUND_STOP_SENTENCE, writeRestartTail, resumePrompt } = await import('../web/context-guard-runner.js')

const HERE = dirname(fileURLToPath(import.meta.url))
// A live pane (computress, 2026-10-15): the turn is over, the footer counts `2 shells`.
const PANE_2_SHELLS = readFileSync(join(HERE, 'fixtures', 'pane', 'turn-ended-2-shells-still-running.txt'), 'utf8')

const MIN = 60_000
const T0 = 1_000_000_000
const SNAP = `${SANDBOX}/shell-snapshots/snapshot-zsh-1795200208820-test.sh`
mkdirSync(dirname(SNAP), { recursive: true })

/** Claude Code's wrapper, as measured on the live panes 2026-11-20 (only the paths differ). */
const shQuote = (s: string) => `'${s.split("'").join(`'"'"'`)}'`
const wrapper = (cmd: string) =>
  `source ${SNAP} 2>/dev/null || true && \\builtin setopt NO_EXTENDED_GLOB 2>/dev/null || true && eval ${shQuote(cmd)} < /dev/null && pwd -P >| ${SANDBOX}/claude-test-cwd`

function row(ppid: number, cpuSec: number, command: string) { return { ppid, cpuSec, command } }
const ROOT = 500
const shellRow = (cmd: string, cpu = 0) => row(ROOT, cpu, `/bin/zsh -c ${wrapper(cmd)}`)
/** A pane tree: claude (500), an MCP server and caffeinate (not shells), the given shells from pid 600. */
function table(shells: { cmd: string; cpu?: number; childCpu?: number }[]): ProcTable {
  const t: ProcTable = new Map([
    [1, row(0, 9000, '/sbin/launchd')],
    [ROOT, row(1, 50, '/Users/isti/.local/bin/claude --dangerously-skip-permissions')],
    [510, row(ROOT, 2, 'node /Users/isti/.npm/_npx/x/node_modules/.bin/mcp-server-memory')],
    [520, row(ROOT, 0, 'caffeinate -i -t 300')],
  ])
  shells.forEach((s, i) => {
    t.set(600 + i, shellRow(s.cmd, s.cpu ?? 0))
    if (s.childCpu !== undefined) t.set(700 + i, row(600 + i, s.childCpu, 'child'))
  })
  return t
}
const footer = (shells: number, monitors = 0, subagents = 0) => ({ shells, monitors, subagents })

describe('reading the pane tree and its CPU', () => {
  const PS = `    1     0 /sbin/launchd\n  500     1 claude\n  600   500 /bin/zsh -c x\n  601   600 python3 -m http.server\n  900     1 other\n`
  it('only the pane subtree is read for CPU, and each member carries own + children seconds', () => {
    const asked: number[][] = []
    const t = readProcessTable(500, () => PS, (pids) => { asked.push([...pids].sort()); return new Map(pids.map((p) => [p, p / 100])) })
    expect(asked).toEqual([[600, 601]])
    expect([...t!.keys()].sort()).toEqual([500, 600, 601])
    expect(t!.get(601)).toEqual({ ppid: 600, cpuSec: 6.01, command: 'python3 -m http.server' })
  })
  it('a member gone between ps and the CPU read is left out (its CPU is in its parent now)', () => {
    const t = readProcessTable(500, () => PS, () => new Map([[600, 1]]))
    expect(t!.has(601)).toBe(false)
    expect(t!.get(600)!.cpuSec).toBe(1)
  })
  it('ps failing, or the CPU read failing, is null: never an empty (all idle) table', () => {
    expect(readProcessTable(500, () => { throw new Error('ps: not found') })).toBeNull()
    expect(readProcessTable(500, () => '')).toBeNull()
    expect(readProcessTable(500, () => PS, () => null)).toBeNull()
  })
  it('a pane root that is not in ps gives a table without it (judged: pane process not found)', () => {
    expect(readProcessTable(4242, () => PS, () => new Map())!.size).toBe(0)
  })
  it('the CPU lines: one unreadable line makes the whole reading not measured', () => {
    expect(parseCpuLines('600 0.25\n601 1e-05\n')).toEqual(new Map([[600, 0.25], [601, 0.00001]]))
    expect(parseCpuLines('600 0.25\nTraceback (most recent call last):\n')).toBeNull()
  })
  it('REAL: a child that EXITED is still counted, in the shell that reaped it (the gate-of-short-processes case)', async () => {
    // `; sleep 30; true`: the trailing true keeps zsh from exec()ing sleep, as Claude's wrapper does.
    const k = spawn('/bin/zsh', ['-c', 'sh -c "i=0; while [ \\$i -lt 400000 ]; do i=\\$((i+1)); done"; sleep 30; true'], { stdio: 'ignore', detached: true })
    try {
      const kidsOf = (t: ReturnType<typeof readProcessTable>) => [...(t?.values() ?? [])].filter((r) => r.ppid === k.pid).map((r) => r.command)
      let t = readProcessTable(process.pid)
      for (let i = 0; i < 150 && JSON.stringify(kidsOf(t)) !== '["sleep 30"]'; i++) {
        await new Promise((r) => setTimeout(r, 100))
        t = readProcessTable(process.pid)
      }
      expect(t, 'ps + CPU read').not.toBeNull()
      // The busy child is gone, only sleep is left under the shell...
      expect(kidsOf(t)).toEqual(['sleep 30'])
      // ...and its CPU is in the shell's reading (own CPU alone is ~0.01 s).
      expect(t!.get(k.pid!)!.cpuSec).toBeGreaterThan(0.2)
    } finally {
      try { process.kill(-k.pid!, 'SIGKILL') } catch { /* gone */ }
    }
  }, 20_000)
  it('the wrapper gives back the command the agent ran: unquoted, newlines restored', () => {
    // The shape of ford's monitor, 2026-11-20 (ps prints a newline as \012).
    const raw = `/bin/zsh -c source /x${BACKGROUND_SHELL_MARK}zsh-1.sh 2>/dev/null || true && eval 'S=/tmp/s; until [ -f $S/gates.done ]; do sleep 5; done\\012grep -E '"'"'rc='"'"' $S/log' < /dev/null && pwd -P >| /tmp/claude-a1-cwd`
    expect(backgroundShellCommand(raw)).toBe("S=/tmp/s; until [ -f $S/gates.done ]; do sleep 5; done\ngrep -E 'rc=' $S/log")
    expect(backgroundShellCommand('python3 -m http.server')).toBe('python3 -m http.server')
  })
})

describe('mapping the footer to processes', () => {
  it('only the snapshot-wrapped shells count: not the MCP server, not caffeinate, not a nested shell', () => {
    const t = table([{ cmd: 'python3 -m http.server 8765' }])
    t.set(601, row(600, 0, `/bin/zsh -c ${wrapper('nested')}`))
    expect(findBackgroundShells(ROOT, t)).toEqual([600])
  })
  it('a wrapper one level down (claude under a launcher shell) is still found', () => {
    const t = table([])
    t.set(800, row(ROOT, 0, '/bin/bash launcher'))
    t.set(801, row(800, 0, `/bin/zsh -c ${wrapper('python3 -m http.server')}`))
    expect(findBackgroundShells(ROOT, t)).toEqual([801])
  })
})

describe('the verdict over the window', () => {
  it('first sample: no verdict, not measured (the guard holds)', () => {
    const tr = new ShellCpuTracker()
    const v = tr.judge('zara', T0, footer(1), ROOT, table([{ cmd: 'python3 -m http.server 8765' }]))
    expect(v).toEqual({ ok: false, why: 'no CPU verdict yet for 1 shell(s): the first sample is younger than 9m' })
  })
  it('a baseline counts from SHELL_CPU_MIN_SPAN_MS, not before', () => {
    const tr = new ShellCpuTracker()
    const t = table([{ cmd: 'python3 -m http.server 8765' }])
    tr.judge('zara', T0, footer(1), ROOT, t)
    expect(tr.judge('zara', T0 + 5 * MIN, footer(1), ROOT, t).ok).toBe(false)
    expect(tr.judge('zara', T0 + SHELL_CPU_MIN_SPAN_MS, footer(1), ROOT, t)).toEqual({ ok: true, idle: ['python3 -m http.server 8765'] })
  })
  it('under the floor is idle, at the floor is working (CPU of the whole subtree, per window)', () => {
    const tr = new ShellCpuTracker()
    const cmds = ['python3 -m http.server 8765', 'npx vitest run']
    tr.judge('a', T0, footer(2), ROOT, table([{ cmd: cmds[0], childCpu: 1 }, { cmd: cmds[1], childCpu: 1 }]))
    const later = table([{ cmd: cmds[0], childCpu: 1 + SHELL_CPU_IDLE_FLOOR_SEC - 0.01 }, { cmd: cmds[1], childCpu: 1 + SHELL_CPU_IDLE_FLOOR_SEC }])
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(2), ROOT, later)).toEqual({ ok: true, idle: [cmds[0]] })
  })
  it('a busy child that EXITS between samples does not make the subtree read idle (per-process deltas)', () => {
    const tr = new ShellCpuTracker()
    tr.judge('a', T0, footer(1), ROOT, table([{ cmd: 'gate.sh', childCpu: 500 }]))
    // The 500 s child is gone; a new child has 30 s. A subtree SUM would fall by 470.
    const t = table([{ cmd: 'gate.sh' }])
    t.set(900, row(600, 30, 'next step'))
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), ROOT, t)).toEqual({ ok: true, idle: [] })
  })
  it('a child pid reused between samples (its counter went BACKWARDS) counts whole, never as a negative delta (didi L2, M7)', () => {
    const tr = new ShellCpuTracker()
    tr.judge('a', T0, footer(1), ROOT, table([{ cmd: 'gate.sh', childCpu: 500 }]))
    // pid 700 is now another process with 30 s: a delta would be -470 and hide the busy shell as idle.
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), ROOT, table([{ cmd: 'gate.sh', childCpu: 30 }]))).toEqual({ ok: true, idle: [] })
  })
  it('a reused pid with another command starts over: no verdict', () => {
    const tr = new ShellCpuTracker()
    tr.judge('a', T0, footer(1), ROOT, table([{ cmd: 'old' }]))
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), ROOT, table([{ cmd: 'new' }])).ok).toBe(false)
  })
})

describe('measurement failed or ambiguous: not measured, never a release', () => {
  const t1 = table([{ cmd: 'python3 -m http.server 8765' }])
  const warm = () => { const tr = new ShellCpuTracker(); tr.judge('a', T0, footer(1), ROOT, t1); return tr }
  it('ps failed', () => {
    expect(warm().judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), ROOT, null)).toEqual({ ok: false, why: 'ps failed' })
  })
  it('the pane process is not in the table', () => {
    expect(warm().judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), 4242, t1)).toEqual({ ok: false, why: 'pane process not found' })
    expect(warm().judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), null, t1)).toEqual({ ok: false, why: 'pane process not found' })
  })
  it('no descendant found for the footer shell', () => {
    const tr = new ShellCpuTracker()
    expect(tr.judge('a', T0, footer(1), ROOT, table([]))).toEqual({ ok: false, why: 'the footer counts 1 shell(s)/monitor(s), the process table has 0' })
  })
  it('more marked processes than the footer counts (a foreground call, a stale shell): ambiguous', () => {
    const tr = new ShellCpuTracker()
    const t2 = table([{ cmd: 'python3 -m http.server 8765' }, { cmd: 'sleep 15' }])
    tr.judge('a', T0, footer(1), ROOT, t2)
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1), ROOT, t2)).toEqual({ ok: false, why: 'the footer counts 1 shell(s)/monitor(s), the process table has 2' })
  })
  it('a sub-agent row: its shells look the same, so no verdict even with baselines in place', () => {
    const tr = warm()
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1, 0, 1), ROOT, t1)).toEqual({ ok: false, why: '1 sub-agent(s) running, their shells look the same in ps' })
    // ...but the samples were kept: once the sub-agent is gone, the verdict is there at once.
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS + 1, footer(1), ROOT, t1)).toEqual({ ok: true, idle: ['python3 -m http.server 8765'] })
  })
  it('monitors count with shells: `1 shell, 1 monitor` needs two marked processes', () => {
    const tr = new ShellCpuTracker()
    const t2 = table([{ cmd: 'gate' }, { cmd: 'until [ -f x ]; do sleep 5; done' }])
    tr.judge('a', T0, footer(1, 1), ROOT, t2)
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS, footer(1, 1), ROOT, t2).ok).toBe(true)
    expect(tr.judge('a', T0 + SHELL_CPU_WINDOW_MS + 1, footer(1, 0), ROOT, t2).ok).toBe(false)
  })
})

describe('measureBackgroundShellCpu (the runner seam)', () => {
  it('no footer shells: no verdict at all, and the agent\'s samples are forgotten', () => {
    const tr = new ShellCpuTracker()
    const probe = vi.fn(() => ({ rootPid: ROOT, table: table([]) }))
    expect(measureBackgroundShellCpu('a', 'no footer here', T0, probe, tr)).toBeUndefined()
    expect(measureBackgroundShellCpu('a', null, T0, probe, tr)).toBeUndefined()
    expect(probe).not.toHaveBeenCalled()
  })
  it('the live 2-shell pane, ps not measurable: not measured', () => {
    const v = measureBackgroundShellCpu('a', PANE_2_SHELLS, T0, () => ({ rootPid: null, table: null }), new ShellCpuTracker())
    expect(v).toEqual({ ok: false, why: 'ps failed' })
  })
  it('a probe that throws is a verdict of not measured, not an exception in the sweep', () => {
    const v = measureBackgroundShellCpu('a', PANE_2_SHELLS, T0, () => { throw new Error('boom') }, new ShellCpuTracker())
    expect(v).toEqual({ ok: false, why: 'measurement error' })
  })
  it('the live 2-shell pane with two idle shells: both named after the window', () => {
    const tr = new ShellCpuTracker()
    const t = table([{ cmd: 'python3 -m http.server 8765' }, { cmd: 'until [ -f /tmp/x ]; do sleep 20; done' }])
    measureBackgroundShellCpu('a', PANE_2_SHELLS, T0, () => ({ rootPid: ROOT, table: t }), tr)
    expect(measureBackgroundShellCpu('a', PANE_2_SHELLS, T0 + SHELL_CPU_WINDOW_MS, () => ({ rootPid: ROOT, table: t }), tr))
      .toEqual({ ok: true, idle: ['python3 -m http.server 8765', 'until [ -f /tmp/x ]; do sleep 20; done'] })
  })
})

describe('the fresh session gets the names: the restart tail lists every RELEASED shell with its command (marveen 10027438)', () => {
  // MAIN_AGENT_ID is mocked to marveen, whose working dir is PROJECT_ROOT = SANDBOX.
  const HANDOFF = join(SANDBOX, 'HANDOFF.md')
  const TAIL = join(SANDBOX, 'HANDOFF-RESTART-TAIL.md')
  const POLL_CMD = 'until [ -f /tmp/ci.done ]; do sleep 20; done'
  const released = {
    backgroundWork: 1, backgroundWorkDetail: '1 in the pane (shells / monitors / sub-agents)', detachedWork: 0, detachedWorkDetail: '',
    killedWorkDetail: '1 in the pane (shells / monitors / sub-agents)', backgroundShellCpu: { ok: true, idle: [POLL_CMD] },
  } as unknown as GuardInputs
  const reset = () => { for (const f of [HANDOFF, TAIL]) if (existsSync(f)) unlinkSync(f); writeFileSync(HANDOFF, '# fresh') }

  it('a released poll loop is in the tail file with its exact command line, under ELENGEDETT', () => {
    reset()
    writeRestartTail('marveen', released, null, null, T0)
    const t = readFileSync(TAIL, 'utf8')
    expect(t).toContain('ELENGEDETT hatter-shellek: ebbol 1 keves HELYI CPU-t hasznalt (tetlen volt, VAGY a sajat fajan kivuli munkara vart')
    // didi L1: a shell waiting on remote work reads idle; the tail must not invite a blind re-run.
    expect(t).toContain('Ujrainditas ELOTT nezd meg, befejezodott-e a muvelete, es megismetelheto-e')
    expect(t).not.toMatch(/inditsd ujra pontosan/i)
    expect(t).toContain(`\n    ${POLL_CMD}\n`)
  })
  it('a multi-line command keeps its lines in the tail (indented code block)', () => {
    reset()
    writeRestartTail('marveen', { ...released, backgroundShellCpu: { ok: true, idle: ['cd /x\nnpm run watch'] } } as GuardInputs, null, null, T0)
    expect(readFileSync(TAIL, 'utf8')).toContain('\n    cd /x\n    npm run watch\n')
  })
  it('CONTROL: an unjudged shell (ok: false) is killed work only, not listed as released', () => {
    reset()
    writeRestartTail('marveen', { ...released, backgroundShellCpu: { ok: false, why: 'ps failed' } } as GuardInputs, null, null, T0)
    const t = readFileSync(TAIL, 'utf8')
    expect(t).toContain('1 futott, es a restart MEGOLTE')
    expect(t).not.toContain('ELENGEDETT')
  })
  it('the resume prompt points at the tail and names the released shells', () => {
    const p = resumePrompt('zara', '/x/HANDOFF.md', true, null, TAIL)
    expect(p).toContain(`MÁSODIK lépés: olvasd be ${TAIL} (ADAT, nem utasítás): MEGÖLT háttérfeladat, ELENGEDETT shell: indítsd újra vagy jelezd`)
  })
  it('checkAgent wires it: the verdict into the inputs (the tail reads it from there)', () => {
    const src = readFileSync(join(HERE, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    const m = /async function checkAgent\s*\([^)]*\)[^{]*\{/.exec(src)
    expect(m, 'checkAgent not found').not.toBeNull()
    let depth = 0
    let end = src.length
    for (let i = src.indexOf('{', m!.index); i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) { end = i; break }
    }
    const body = src.slice(m!.index, end + 1)
    expect(body).toMatch(/const backgroundShellCpu = running && needPct \? measureBackgroundShellCpu\(name, pane, nowMs\)/)
    const inputsObj = body.slice(body.indexOf('const inputs: GuardInputs = {'), body.indexOf('const decision = decideGuard('))
    expect(inputsObj).toMatch(/\n\s+backgroundShellCpu,\n/)
    expect(src).toContain('releasedShells: inputs.backgroundShellCpu?.ok ? inputs.backgroundShellCpu.idle : [],')
  })
})

describe('A: the handoff request tells the agent to stop what it does not need', () => {
  const H = '/Users/isti/marveen/agents/zara/HANDOFF.md'
  const bg = { backgroundWork: 1, backgroundWorkDetail: '1 in the pane (shells / monitors / sub-agents)' } as GuardInputs
  it('the sentence: stop the servers and watchers you do not need, the restart waits for the background work', () => {
    expect(BACKGROUND_STOP_SENTENCE).toBe('Fölös szervert, figyelőt állíts le: az újraindítás vár a háttérmunkára.')
  })
  it('a routine request (idle-flush) with background work running: the sentence is appended once', () => {
    const p = withBackgroundStopHint('idle-flush: x', bg, idleFlushHandoffPrompt(500_000, 90, H))
    expect(p).toBe(`${idleFlushHandoffPrompt(500_000, 90, H)} ${BACKGROUND_STOP_SENTENCE}`)
  })
  it('the critical request has it built in, and the wrapper does not add it twice', () => {
    const p = withBackgroundStopHint('act threshold', bg, handoffPrompt(91, H, true))
    expect(p).toBe(handoffPrompt(91, H, true))
    expect(p.split(BACKGROUND_STOP_SENTENCE)).toHaveLength(2)
  })
  it('nothing running: the request is exactly what it was', () => {
    expect(withBackgroundStopHint('act threshold', {} as GuardInputs, handoffPrompt(91, H))).toBe(handoffPrompt(91, H))
    expect(handoffPrompt(91, H, false)).toBe(handoffPrompt(91, H))
  })
  it('the held-restart resume does not get it: it asks the agent to go on, not to stop', () => {
    expect(withBackgroundStopHint('api-error-held-restart-resume: x', bg, 'RESUME')).toBe('RESUME')
  })
  it('the runner sends every handoff request through it, and tells the critical one whether work runs', () => {
    const src = readFileSync(join(HERE, '..', 'web', 'context-guard-runner.ts'), 'utf8')
    expect(src).toContain('withBackgroundStopHint(decision.reason, inputs, decision.reason.startsWith(STALE_REFRESH_REASON_PREFIX)')
    expect(src).toContain(': handoffPrompt(pctRound ?? 0, handoffPathFor(name), (inputs.backgroundWork ?? 0) > 0)),')
  })
})

// THE THREE MEASURED CASES, AGAIN WITH REAL PROCESSES. The window is compressed: the samples are a few
// real seconds apart and the tracker is told SHELL_CPU_MIN_SPAN_MS passed, so a CPU job's real seconds
// count as its CPU over the window. The positive control is in the same run: the same tracker, on the
// same ps, reads the CPU job as working.
describe('REAL processes: idle server and sleeping poll loop released with their names, a CPU job holds', () => {
  const kids: ChildProcess[] = []
  afterEach(() => { for (const k of kids.splice(0)) { try { process.kill(-k.pid!, 'SIGKILL') } catch { /* gone */ } } })
  const start = (cmd: string) => {
    const k = spawn('/bin/zsh', ['-c', wrapper(cmd)], { stdio: 'ignore', detached: true })
    kids.push(k)
    return k
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('(a) http.server + (c) until/sleep 20 idle, (b) CPU job working; guard holds for (b), then releases (a)+(c) by name', async () => {
    // detached: true makes each a process-group leader, but its PARENT is still this process.
    const server = `cd ${SANDBOX} && python3 -m http.server 0 --bind 127.0.0.1`
    const poll = `until [ -f ${SANDBOX}/never ]; do sleep 20; done`
    const job = `node -e 'const e=Date.now()+60000;while(Date.now()<e){}'`
    start(server); start(poll); const burner = start(job)
    await sleep(1500)
    const tr = new ShellCpuTracker()
    const t0 = readProcessTable(process.pid)
    expect(t0, 'ps snapshot').not.toBeNull()
    expect(findBackgroundShells(process.pid, t0!)).toHaveLength(3)
    expect(tr.judge('real', T0, footer(3), process.pid, t0)).toMatchObject({ ok: false }) // first sample: no verdict
    await sleep(Math.ceil(SHELL_CPU_IDLE_FLOOR_SEC * 1000 * 1.6))
    const v = tr.judge('real', T0 + SHELL_CPU_MIN_SPAN_MS, footer(3), process.pid, readProcessTable(process.pid))
    expect(v).toEqual({ ok: true, idle: expect.arrayContaining([server, poll]) })
    expect(v.ok && v.idle).toHaveLength(2) // the CPU job is NOT idle: the positive control

    const state: GuardState = {
      phase: 'await-handoff', handoffMtimeAtRequest: 100, deadlineMs: T0 + 10 * MIN, cooldownUntilMs: 0,
      saturatedStreak: 0, staleRefreshCount: 0, handoffStaleMinutes: null,
    }
    const base: GuardInputs = {
      nowMs: T0 + SHELL_CPU_MIN_SPAN_MS, pct: 0.8, running: true, paneIdle: true, paneBusy: false, sessionReady: false,
      handoffMtime: 200, paneSaturated: false, dailyHandoffDue: false, contextTokens: null, idleMs: null,
    }
    const cfg = { ...DEFAULT_CONTEXT_GUARD, enabled: true }
    expect(decideGuard(state, { ...base, backgroundWork: 3, backgroundShellCpu: v }, cfg).action).toBe('none')

    // The job ends; the two idle shells are left, and the restart goes ahead naming both.
    process.kill(-burner.pid!, 'SIGKILL')
    await sleep(300)
    const v2 = tr.judge('real', T0 + SHELL_CPU_MIN_SPAN_MS + MIN, footer(2), process.pid, readProcessTable(process.pid))
    expect(v2).toEqual({ ok: true, idle: expect.arrayContaining([server, poll]) })
    const d = decideGuard(state, { ...base, nowMs: T0 + SHELL_CPU_MIN_SPAN_MS + MIN, backgroundWork: 2, backgroundShellCpu: v2 }, cfg)
    expect(d.action).toBe('restart')
    expect(d.reason).toContain(`idle shell \`${server}\``)
    expect(d.reason).toContain(`idle shell \`${poll}\``)
  }, 30_000)
})
