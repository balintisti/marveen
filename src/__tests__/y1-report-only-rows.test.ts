/**
 * y1-report-only: what a row holds, and who writes it (card 5b639edb). core.run() called in-process, on a made-up
 * install, with a stand-in for the entry's handle on the watchdog thread.
 *
 *   - the label of a row is the caller's home (CLAUDE_PROJECT_DIR), wherever the call is run from;
 *   - a finding holds the input the gate read, whole; of a file tool that is the path, never the content;
 *   - before each step that can hang, the watchdog is handed the rows for THAT step; and once the watchdog has
 *     taken a run, the main thread writes nothing (the same call would be in the log twice, once as a timeout).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { makeInstall, type Y1Install } from './helpers/y1-install.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { INPUT_CAP_BYTES, agentLabel, isJudgedTool, logDir, loggedInput, run } from '../../scripts/hooks/y1-report-only/core.mjs'

const mkTmp = tmpDirs()

type Row = Record<string, unknown>
type Armed = [file: string, row: Row][]
interface Dog { arm(rows: Armed): void; up(): boolean; finish(): boolean }

let I: Y1Install
let settings: string
beforeAll(() => {
  I = makeInstall(mkTmp('y1-rows-'), 'symlinked')
  settings = join(I.root, '.claude', 'settings.json')
  vi.stubEnv('HOME', I.home)
})
afterAll(() => vi.unstubAllEnvs())

const rowsIn = (dir: string, file: string): Row[] =>
  existsSync(join(dir, file)) ? readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row) : []

interface Ran { verdict: { kind: string }; dir: string; armed: Armed[] }
async function hook(tool_name: string, tool_input: Record<string, unknown>, o: { cwd?: string; taken?: boolean; noDog?: boolean } = {}): Promise<Ran> {
  const dir = mkTmp('y1-rows-log-')
  const armed: Armed[] = []
  const dog: Dog = { arm: (rows) => { armed.push(rows) }, up: () => true, finish: () => !o.taken }
  const env = { CLAUDE_PROJECT_DIR: I.homeOf('dexter'), CLAUDE_CONFIG_DIR: join(I.lexical('dexter'), '.claude-config') }
  const stdin = (): string => JSON.stringify({ session_id: 's-1', agent_type: 'general-purpose', tool_name, tool_input, cwd: o.cwd ?? I.homeOf('dexter') })
  const verdict = await run({ root: I.root, env, dir, dog: o.noDog ? null : dog, stdin }) as { kind: string }
  return { verdict, dir, armed }
}

describe('y1-report-only rows: whose row it is', () => {
  it('labels a call by the home of the caller, not by where it runs', async () => {
    const r = await hook('Bash', { command: 'ls' }, { cwd: I.scratch })
    expect(rowsIn(r.dir, 'calls.jsonl')).toHaveLength(1)
    expect(rowsIn(r.dir, 'calls.jsonl')[0]).toMatchObject({ agent: 'dexter', kind: 'allow', tool: 'Bash', dog: true })
  })

  it.each<[string, (i: Y1Install) => [Record<string, string>, string | null], string]>([
    ['the install root', (i) => [{ CLAUDE_PROJECT_DIR: i.root }, null], 'main'],
    ["an agent's home by its real path", (i) => [{ CLAUDE_PROJECT_DIR: i.homeOf('didi') }, null], 'didi'],
    ["an agent's home as the install spells it", (i) => [{ CLAUDE_PROJECT_DIR: i.lexical('didi') }, null], 'didi'],
    ["a directory inside an agent's home", (i) => [{ CLAUDE_PROJECT_DIR: join(i.homeOf('didi'), 'notes') }, null], 'didi'],
    ['the home, when the call runs in another agent\'s', (i) => [{ CLAUDE_PROJECT_DIR: i.homeOf('dexter') }, i.homeOf('didi')], 'dexter'],
    ['the working directory when there is no project directory', (i) => [{}, join(i.homeOf('didi'), 'notes')], 'didi'],
    ['a directory that is nobody\'s', (i) => [{ CLAUDE_PROJECT_DIR: i.scratch }, null], 'other:scratch'],
    ['nothing at all', () => [{}, null], 'unknown'],
  ])('labels %s', (_what, make, want) => {
    const [env, cwd] = make(I)
    expect(agentLabel(I.root, env, cwd)).toBe(want)
  })

  it('keeps the log under the install unless the environment names another place', () => {
    expect(logDir('/r', {})).toBe('/r/store/y1-report-only')
    expect(logDir('/r', { Y1_REPORT_ONLY_DIR: '/elsewhere/log' })).toBe('/elsewhere/log')
  })

  it('judges Bash, the file tools and MCP calls, and nothing else', () => {
    for (const tool of ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'mcp__fs__write_file', 'MCP__x__y']) expect(isJudgedTool(tool), tool).toBe(true)
    for (const tool of ['Read', 'Grep', 'Glob', 'Agent', 'WebFetch', 'bash', '', undefined, null]) expect(isJudgedTool(tool), String(tool)).toBe(false)
  })
})

describe('y1-report-only rows: what a finding holds', () => {
  it('holds the path of a file-tool call and none of its content', async () => {
    const r = await hook('Write', { file_path: settings, content: 'CONTENT-THAT-MUST-NOT-BE-LOGGED' })
    expect(r.verdict.kind).toBe('would-deny')
    const [finding] = rowsIn(r.dir, 'findings.jsonl')
    expect(finding).toMatchObject({ kind: 'would-deny', tool: 'Write', input: { file_path: settings }, session: 's-1', agent_type: 'general-purpose', cwd: I.homeOf('dexter'), project_dir: I.homeOf('dexter') })
    expect(readFileSync(join(r.dir, 'findings.jsonl'), 'utf8')).not.toContain('CONTENT-THAT-MUST-NOT-BE-LOGGED')
    expect(r.armed.map((rows) => JSON.stringify(rows)).join('')).not.toContain('CONTENT-THAT-MUST-NOT-BE-LOGGED')
  })

  it('holds an MCP call as the JSON the gate read', () => {
    expect(loggedInput('mcp__fs__write_file', { path: '/a', n: 1 })).toEqual({ input: { json: '{"path":"/a","n":1}' } })
    expect(loggedInput('mcp__fs__list', undefined)).toEqual({ input: { json: 'null' } })
  })

  it('says so when a command is longer than the cap: the head, the length and a hash of the whole', () => {
    const atCap = 'x'.repeat(INPUT_CAP_BYTES as number)
    expect(loggedInput('Bash', { command: atCap })).toEqual({ input: { command: atCap } })
    const over = `${atCap}y`
    expect(loggedInput('Bash', { command: over })).toEqual({
      input: { command: atCap },
      input_truncated: true,
      input_bytes: (INPUT_CAP_BYTES as number) + 1,
      input_sha256: createHash('sha256').update(over).digest('hex'),
    })
  })
})

describe('y1-report-only rows: the hand-over to the watchdog', () => {
  const phases = (armed: Armed[]): string[] => armed.map((rows) => String(rows[0][1].phase))

  it('hands over the rows of each step before it starts: stdin, the decision, the classes', async () => {
    const command = `python3 -c "open('${settings}','w').write('{}')"`
    const r = await hook('Bash', { command })
    expect(r.verdict.kind).toBe('would-deny')
    expect(phases(r.armed)).toEqual(['stdin', 'decision', 'attribute'])
    for (const rows of r.armed) {
      expect(rows.map(([file]) => file)).toEqual(['calls.jsonl', 'findings.jsonl'])
      for (const [, row] of rows) expect(row).toMatchObject({ kind: 'timeout', agent: 'dexter' })
    }
    // from the decision on, a run that is cut still leaves the whole command
    expect(r.armed[1][1][1]).toMatchObject({ phase: 'decision', tool: 'Bash', input: { command } })
    expect(r.armed[1][0][1]).not.toHaveProperty('input')
    // and once there is a verdict, a cut in the classes does not lose it
    expect(r.armed[2][1][1]).toMatchObject({ phase: 'attribute', verdict: 'would-deny', base_deny: true, classes: null, input: { command } })
  })

  it('hands over nothing for the classes of an allow', async () => {
    expect(phases((await hook('Bash', { command: 'ls' })).armed)).toEqual(['stdin', 'decision'])
  })

  it('writes nothing once the watchdog has taken the run', async () => {
    const r = await hook('Write', { file_path: settings, content: 'x' }, { taken: true })
    expect(r.verdict.kind).toBe('would-deny')
    expect(rowsIn(r.dir, 'calls.jsonl')).toEqual([])
    expect(rowsIn(r.dir, 'findings.jsonl')).toEqual([])
  })

  it('writes the rows itself when it runs without a watchdog, and the row does not claim one', async () => {
    const r = await hook('Write', { file_path: settings, content: 'x' }, { noDog: true })
    expect(rowsIn(r.dir, 'calls.jsonl')).toHaveLength(1)
    expect(rowsIn(r.dir, 'calls.jsonl')[0]).not.toHaveProperty('dog')
    expect(rowsIn(r.dir, 'findings.jsonl')).toHaveLength(1)
  })
})
