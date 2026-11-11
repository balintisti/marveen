/**
 * y1-report-only: the seven-day table (card 5b639edb).
 *
 * The log is written here by core.run(), the same call the hook makes, in a made-up install; rows the hook writes
 * only when something goes wrong (timeouts, a cut line, rows over the cap) are added by hand. What is asked of the
 * report:
 *   - an agent directory without a row is NAMED (there the hook did not run), never shown as a zero;
 *   - every would-deny / exempted row is judged again, and one that comes out differently is counted as
 *     unreproducible, never under a class;
 *   - a would-deny counts under a class only when it names a protected file, under every class it has, and the
 *     classes the live hook did not finish are found here, within the budget;
 *   - nothing that went wrong is dropped silently: timeouts by phase, rows over the cap, lines that are not JSON,
 *     the last-resort file, slow calls without a watchdog;
 *   - rows older than the window are out, and the report changes nothing in the log.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { makeInstall, type Y1Install } from './helpers/y1-install.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { run } from '../../scripts/hooks/y1-report-only/core.mjs'
// @ts-expect-error -- plain .mjs hook script, no types
import { SLOW_MS, buildReport, jobOf, render } from '../../scripts/hooks/y1-report-only/report.mjs'

const ROOT = join(__dirname, '..', '..')
const mkTmp = tmpDirs()
const DAY = 86_400_000

type Row = Record<string, unknown>
interface ClassRow { class: string; rows: number; upstream: number; supplement_only: number; main: number; sub: number; agents: Record<string, number> }
interface AgentRow { agent: string; calls: number; kinds: Record<string, number>; ms_median: number | null; ms_total_median: number | null; ms_total_p95: number | null; ms_total_max: number | null; last: string | null }
interface Report {
  days: number
  dir: string
  since: string
  upstream: string
  agents: AgentRow[]
  silent_agents: string[]
  would_deny_rows: number
  classes: ClassRow[]
  exempted: { rule: string; rows: number; agents: Record<string, number> }[]
  other: { kind: string; rows: number; agents: Record<string, number> }[]
  replay: { rows: number; unreproducible: { agent: string; logged: string; now: string }[] }
  watchdog: { slow_calls: number; not_up: number }
  dropped: { calls: number; findings: number }
  unreadable_lines: { calls: number; findings: number }
  last_resort_lines: number
}
interface Verdict { kind: string; reason?: string; exemption?: string; base_deny?: boolean }

let I: Y1Install
let dir: string
let settings: string
// the reasons the gate gave for the two rows that name no protected file
let anyNameReason: string
let noTargetReason: string
// and the reasons of the two rows that are logged a second time with something changed
let settingsReason: string
let exemptedReason: string

const readRows = (file: string): Row[] => readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
const writeRows = (file: string, rows: Row[]): void => writeFileSync(join(dir, file), rows.map((r) => JSON.stringify(r) + '\n').join(''))
const add = (file: string, ...rows: Row[]): void => appendFileSync(join(dir, file), rows.map((r) => JSON.stringify(r) + '\n').join(''))

async function call(agent: string, tool_name: string, tool_input: Record<string, unknown>): Promise<Verdict> {
  const sub = agent !== 'main'
  const env = {
    CLAUDE_PROJECT_DIR: sub ? I.homeOf(agent) : I.root,
    CLAUDE_CONFIG_DIR: sub ? join(I.lexical(agent), '.claude-config') : join(I.root, '.channels-config'),
  }
  return run({ root: I.root, env, dir, stdin: () => JSON.stringify({ session_id: 's-1', tool_name, tool_input, cwd: env.CLAUDE_PROJECT_DIR }) }) as Promise<Verdict>
}

const report = (opts: Record<string, unknown> = {}): Promise<Report> => buildReport({ root: I.root, dir, now: Date.now() + 1000, ...opts }) as Promise<Report>
const classOf = (rep: Report, name: string): ClassRow | undefined => rep.classes.find((c) => c.class === name)
const agentOf = (rep: Report, name: string): AgentRow | undefined => rep.agents.find((a) => a.agent === name)

beforeAll(async () => {
  I = makeInstall(mkTmp('y1-report-'), 'symlinked', ['dexter', 'didi', 'ford'])
  dir = join(I.root, 'store', 'y1-report-only')
  settings = join(I.root, '.claude', 'settings.json')
  vi.stubEnv('HOME', I.home)

  // ---- what the hook itself writes. The fixture is asserted, so a gate that changed its mind fails HERE, by name.
  expect(await call('dexter', 'Write', { file_path: settings, content: 'x' })).toMatchObject({ kind: 'would-deny', base_deny: true })
  expect(await call('main', 'Write', { file_path: settings, content: 'x' })).toMatchObject({ kind: 'would-deny', base_deny: true })
  expect(await call('dexter', 'Write', { file_path: join(I.homeOf('dexter'), 'agent-config.json'), content: 'x' })).toMatchObject({ kind: 'would-deny', base_deny: false })
  // a `*` in inline code, run from the agent's home: it reaches whatever lies there, and of what lies in THIS home
  // only the agent-config.json this hook adds is protected (a live home also holds files upstream protects)
  const anyName = await call('dexter', 'Bash', { command: 'node -e "console.log(2 * 3)"' })
  expect(anyName).toMatchObject({ kind: 'would-deny', base_deny: false })
  anyNameReason = String(anyName.reason)
  const noTarget = await call('dexter', 'Bash', { command: 'claude mcp add probe -- node server.js' })
  expect(noTarget).toMatchObject({ kind: 'would-deny', base_deny: true })
  noTargetReason = String(noTarget.reason)
  expect(await call('dexter', 'Bash', { command: `python3 -c "print(len(open('${settings}').read()))"` })).toMatchObject({ kind: 'exempted', exemption: 'interpreter-read-only' })
  expect(await call('dexter', 'Bash', { command: 'ls' })).toMatchObject({ kind: 'allow' })
  expect(await call('didi', 'Bash', { command: 'ls' })).toMatchObject({ kind: 'allow' })

  // in this process "ms since process start" is the age of the test worker: give the rows a hook's numbers
  writeRows('calls.jsonl', readRows('calls.jsonl').map((r) => ({ ...r, ms_total: 40, dog: true })))
  const found = readRows('findings.jsonl')
  expect(found.map((r) => `${String(r.agent)}:${String(r.kind)}`)).toEqual(['dexter:would-deny', 'main:would-deny', 'dexter:would-deny', 'dexter:would-deny', 'dexter:would-deny', 'dexter:exempted'])
  const [subSettings, mainSettings, ownConfig, anyNameRow, noTargetRow, exemptedRow] = found
  settingsReason = String(subSettings.reason)
  exemptedReason = String(exemptedRow.reason)
  // one row as the live hook finishes it, two as it leaves them when its time for the classes is up
  writeRows('findings.jsonl', [
    { ...subSettings, classes: ['.claude/settings.json'] },
    { ...mainSettings, classes: null },
    { ...ownConfig, classes: null },
    anyNameRow,
    noTargetRow,
    exemptedRow,
  ])

  // ---- what only a bad day writes
  const ts = new Date().toISOString()
  const old = new Date(Date.now() - 8 * DAY).toISOString()
  add('findings.jsonl',
    { ts, agent: 'didi', kind: 'timeout', phase: 'decision', tool: 'Bash', input: { command: 'ls' }, deadline_ms: 4000 },
    { ts, agent: 'didi', kind: 'timeout', phase: 'stdin', deadline_ms: 4000 },
    { ts, agent: 'unknown', kind: 'error', error: 'no payload: Unexpected end of JSON input' },
    // logged with a reason the gate does not give for it now
    { ...subSettings, reason: 'made-up' },
    // logged as exempted by a rule that does not exempt it now
    { ...exemptedRow, exemption: 'sqlite-mode-ro' },
    // cut at the input cap: it cannot be judged again
    { ...anyNameRow, input_truncated: true, input_bytes: 999_999, input_sha256: '0'.repeat(64) },
    { ...subSettings, ts: old },
  )
  appendFileSync(join(dir, 'findings.jsonl'), '{"ts":"2026-11-11T10:00:00.000Z","agent":"dex\n')
  add('calls.jsonl',
    { ts, agent: 'didi', tool: 'Bash', kind: 'allow', ms: 5, ms_total: SLOW_MS, dog: false },
    { ts, agent: 'didi', tool: 'Bash', kind: 'allow', ms: 5, ms_total: SLOW_MS + 1 },
    { ts, agent: 'didi', tool: 'Bash', kind: 'allow', ms: 5, ms_total: 900, dog: false },
    { ts, agent: 'didi', tool: 'Bash', kind: 'allow', ms: 5, ms_total: 900, dog: true },
    { ts: old, agent: 'ford', tool: 'Bash', kind: 'allow', ms: 5, ms_total: 40, dog: true },
  )
  appendFileSync(join(dir, 'calls.jsonl'), '{"ts":"2026-11-11T10:00:00.000Z","age\n')
  writeFileSync(join(dir, 'calls.jsonl.FULL'), '...')
  writeFileSync(join(dir, 'findings.jsonl.FULL'), '..')
  writeFileSync(join(dir, 'ERRORS.txt'), 'first line\nsecond line\n')
}, 120_000)

afterAll(() => vi.unstubAllEnvs())

describe('y1-report-only report: who the hook ran for', () => {
  it('names the agent directory that has no row in the window, and counts the others', async () => {
    const rep = await report()
    expect(rep.agents.map((a) => a.agent)).toEqual(['main', 'dexter', 'didi', 'ford'])
    expect(rep.silent_agents).toEqual(['ford'])
    expect(agentOf(rep, 'main')).toMatchObject({ calls: 1, kinds: { 'would-deny': 1 } })
    expect(agentOf(rep, 'dexter')).toMatchObject({ calls: 6, kinds: { 'would-deny': 4, exempted: 1, allow: 1 }, ms_total_median: 40, ms_total_max: 40 })
    expect(agentOf(rep, 'didi')).toMatchObject({ calls: 5, kinds: { allow: 5 }, ms_total_median: SLOW_MS + 1, ms_total_p95: 900, ms_total_max: 900 })
    expect(agentOf(rep, 'ford')).toMatchObject({ calls: 0, last: null })
  })

  it('prints the silent agent as a finding, not as a zero', async () => {
    const text = render(await report()) as string
    expect(text).toMatch(/^ {3}ford +NO ROWS: the hook did not run here in the window/m)
    expect(text).toMatch(/^ {3}dexter +6 +1 +4 +1 +0 +0 /m)
  })

  it('takes a row back in when the window reaches it', async () => {
    const rep = await report({ days: 9 })
    expect(rep.silent_agents).toEqual([])
    expect(agentOf(rep, 'ford')).toMatchObject({ calls: 1 })
    expect(rep.would_deny_rows).toBe(8)
  })

  it('names the upstream commit of the vendored gate', async () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'hooks', 'y1-report-only', 'upstream', 'MANIFEST.json'), 'utf8')) as { commit: string }
    expect((await report()).upstream).toBe(manifest.commit)
  })
})

describe('y1-report-only report: would-deny by target class', () => {
  it('counts a named row under its classes, for the main agent and the sub-agent apart', async () => {
    const rep = await report()
    expect(rep.would_deny_rows).toBe(7)
    expect(classOf(rep, '.claude/settings.json')).toEqual({ class: '.claude/settings.json', rows: 2, upstream: 2, supplement_only: 0, main: 1, sub: 1, agents: { dexter: 1, main: 1 } })
    expect(classOf(rep, 'own:agents/*/agent-config.json')).toEqual({ class: 'own:agents/*/agent-config.json', rows: 1, upstream: 0, supplement_only: 1, main: 0, sub: 1, agents: { dexter: 1 } })
  })

  it('keeps a row that names no protected file out of the classes', async () => {
    const rep = await report()
    expect(classOf(rep, `(any name) ${anyNameReason}`)).toMatchObject({ rows: 1, agents: { dexter: 1 } })
    expect(classOf(rep, `(no target) ${noTargetReason}`)).toMatchObject({ rows: 1, agents: { dexter: 1 } })
    expect(rep.classes.map((c) => c.class).sort()).toEqual([
      '(unreproducible) made-up',
      `(unreproducible) ${anyNameReason}`,
      `(any name) ${anyNameReason}`,
      `(no target) ${noTargetReason}`,
      '.claude/settings.json',
      'own:agents/*/agent-config.json',
    ].sort())
  })

  it('says so when the classes the live hook did not finish are not found within the budget', async () => {
    const rep = await report({ budgetMs: 0 })
    // the row the live hook finished keeps its class; the two it did not are counted, not guessed
    expect(classOf(rep, '.claude/settings.json')).toMatchObject({ rows: 1, sub: 1, main: 0 })
    expect(classOf(rep, '(classes not found within the budget)')).toMatchObject({ rows: 2, upstream: 1, supplement_only: 1, agents: { main: 1, dexter: 1 } })
    expect(classOf(rep, 'own:agents/*/agent-config.json')).toBeUndefined()
  })
})

describe('y1-report-only report: the replay', () => {
  it('judges every would-deny and exempted row again and lists the ones that changed', async () => {
    const rep = await report()
    expect(rep.replay.rows).toBe(9)
    expect(rep.replay.unreproducible.map((u) => `${u.agent}: ${u.logged} -> ${u.now}`).sort()).toEqual([
      `dexter: exempted:${exemptedReason}(sqlite-mode-ro) -> exempted:${exemptedReason}(interpreter-read-only)`,
      `dexter: would-deny:${anyNameReason} -> input not whole`,
      `dexter: would-deny:made-up -> would-deny:${settingsReason}`,
    ].sort())
  })

  it('counts an exempted row by its rule only when it is exempted again', async () => {
    expect((await report()).exempted).toEqual([{ rule: 'interpreter-read-only', rows: 1, agents: { dexter: 1 } }])
  })

  it('prints the count and the rows', async () => {
    const text = render(await report()) as string
    expect(text).toContain('replay: 9 rows judged again, 3 came out differently')
    expect(text).toMatch(/dexter: logged would-deny:made-up, now would-deny:/)
  })
})

describe('y1-report-only report: what went wrong is counted', () => {
  it('counts timeouts by the phase they ended in, and errors', async () => {
    expect((await report()).other.sort((x, y) => (x.kind < y.kind ? -1 : 1))).toEqual([
      { kind: 'error', rows: 1, agents: { unknown: 1 } },
      { kind: 'timeout in decision', rows: 1, agents: { didi: 1 } },
      { kind: 'timeout in stdin', rows: 1, agents: { didi: 1 } },
    ])
  })

  it('counts dropped rows, cut lines, last-resort lines and slow calls without a watchdog', async () => {
    const rep = await report()
    expect(rep.dropped).toEqual({ calls: 3, findings: 2 })
    expect(rep.unreadable_lines).toEqual({ calls: 1, findings: 1 })
    expect(rep.last_resort_lines).toBe(2)
    // slower than SLOW_MS: three rows; of them one says the watchdog was up
    expect(rep.watchdog).toEqual({ slow_calls: 3, not_up: 2 })
  })

  it('prints each of them', async () => {
    const text = render(await report()) as string
    expect(text).toContain('rows dropped at the size cap: calls 3, findings 2')
    expect(text).toContain('lines that are not JSON (a kill in mid-write): calls 1, findings 1')
    expect(text).toContain('lines in ERRORS.txt (the log code itself failed): 2')
    expect(text).toContain(`watchdog not up on calls slower than ${SLOW_MS} ms: 2 of 3`)
    expect(text).toMatch(/^ +1 {2}timeout in decision {2}\[didi 1\]$/m)
    expect(text).toMatch(/^ +1 {2}interpreter-read-only {2}\[dexter 1\]$/m)
  })

  it('reports zeros for an empty log, with every agent silent', async () => {
    const rep = await report({ dir: mkTmp('y1-report-empty-') })
    expect(rep.silent_agents).toEqual(['main', 'dexter', 'didi', 'ford'])
    expect(rep).toMatchObject({ would_deny_rows: 0, classes: [], exempted: [], other: [], replay: { rows: 0, unreproducible: [] }, dropped: { calls: 0, findings: 0 }, unreadable_lines: { calls: 0, findings: 0 }, last_resort_lines: 0, watchdog: { slow_calls: 0, not_up: 0 } })
  })
})

describe('y1-report-only report: it only reads', () => {
  const state = (): Record<string, string> =>
    Object.fromEntries(readdirSync(dir).sort().map((f) => [f, createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')]))

  it('leaves the log as it found it', async () => {
    const before = state()
    expect(Object.keys(before)).toEqual(['ERRORS.txt', 'calls.jsonl', 'calls.jsonl.FULL', 'findings.jsonl', 'findings.jsonl.FULL'])
    render(await report())
    expect(state()).toEqual(before)
  })

  it('runs from the command line on a log directory, as text and as JSON', () => {
    const empty = mkTmp('y1-report-cli-')
    const cli = (...args: string[]): ReturnType<typeof spawnSync> =>
      spawnSync(process.execPath, [join(ROOT, 'scripts', 'hooks', 'y1-report-only', 'report.mjs'), '--dir', empty, ...args], { encoding: 'utf8', timeout: 60_000 })
    const json = cli('--days', '3', '--json')
    expect(json.status).toBe(0)
    expect(JSON.parse(String(json.stdout))).toMatchObject({ days: 3, dir: empty, would_deny_rows: 0 })
    const text = cli()
    expect(text.status).toBe(0)
    expect(String(text.stdout)).toMatch(/^Y1 report-only: what the upstream gate \(4bdb49da2\) WOULD have denied\nwindow .* \(7 days\), log /)
    expect(readdirSync(empty)).toEqual([])
  })
})

describe('y1-report-only report: a row back into the job the hook judged', () => {
  const base = { cwd: '/w', project_dir: '/p', config_dir: '/c' }

  it('rebuilds a Bash, a file-tool and an MCP call', () => {
    expect(jobOf({ ...base, tool: 'Bash', input: { command: 'ls -l' } }, '/r')).toEqual({ root: '/r', toolName: 'Bash', toolInput: { command: 'ls -l' }, cwd: '/w', projectDir: '/p', configDir: '/c' })
    expect(jobOf({ ...base, tool: 'Write', input: { file_path: '/a' } }, '/r')).toMatchObject({ toolName: 'Write', toolInput: { file_path: '/a' } })
    expect(jobOf({ ...base, tool: 'mcp__fs__write', input: { json: '{"path":"/a"}' } }, '/r')).toMatchObject({ toolName: 'mcp__fs__write', toolInput: { path: '/a' } })
  })

  it.each<[string, Row]>([
    ['cut at the input cap', { ...base, tool: 'Bash', input: { command: 'ls' }, input_truncated: true }],
    ['without an input', { ...base, tool: 'Bash' }],
    ['without a tool', { ...base, input: { command: 'ls' } }],
    ['with an MCP input that is not JSON', { ...base, tool: 'mcp__fs__write', input: { json: '{"path":' } }],
  ])('gives no job for a row %s', (_what, row) => {
    expect(jobOf(row, '/r')).toBeNull()
  })
})
