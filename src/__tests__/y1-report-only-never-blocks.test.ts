/**
 * y1-report-only: the hook NEVER decides (card 5b639edb).
 *
 * A PreToolUse hook that exits non-zero or prints a decision stops a tool call. This one is registered for every
 * Bash, file-tool and MCP call of every agent, so whatever happens inside it, the harness must see exit code 0 and
 * an empty stdout. That is asked here of the commands AS THEY ARE REGISTERED (read from .claude/settings.json and
 * from the settings template), run on a copy of the hook in a made-up install, healthy and broken in every way the
 * card names: it throws while loading, it exits 2, it prints a deny decision, the gate never returns, stdin never
 * closes, the input is garbage, the log is full, the watchdog or the hook file itself is gone.
 *
 * Where the hook cannot save itself (an exit code set by broken code, a SIGKILL from its own watchdog, bytes written
 * straight to fd 1), the RAW run is asserted to fail first: that proves the mutant is live, and that the layer which
 * holds is the registered `>/dev/null 2>&1; ... exit 0`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, readFileSync, rmSync, statSync, truncateSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { makeInstall, type Y1Install } from './helpers/y1-install.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { CAP_BYTES } from '../../scripts/hooks/y1-report-only/core.mjs'

const ROOT = join(__dirname, '..', '..')
const ENTRY = join('scripts', 'hooks', 'y1-report-only.mjs')
const PARTS = join('scripts', 'hooks', 'y1-report-only')
const mkTmp = tmpDirs()

interface Registered { event: string; matcher: string; command: string; timeout: number }

function registered(file: string): Registered[] {
  const doc = JSON.parse(readFileSync(join(ROOT, file), 'utf8')) as { hooks: Record<string, { matcher?: string; hooks: { command?: string; timeout?: number }[] }[]> }
  const found: Registered[] = []
  for (const [event, groups] of Object.entries(doc.hooks)) {
    for (const g of groups) {
      for (const h of g.hooks) {
        if (h.command?.includes('y1-report-only.mjs')) found.push({ event, matcher: String(g.matcher), command: h.command, timeout: Number(h.timeout) })
      }
    }
  }
  return found
}

interface Form { name: string; file: string; caller: 'main' | 'dexter' }
const FORMS: Form[] = [
  { name: 'project settings, the main agent calling', file: '.claude/settings.json', caller: 'main' },
  { name: 'settings template, a sub-agent calling', file: 'templates/settings.json.template', caller: 'dexter' },
]

function install(): Y1Install {
  const I = makeInstall(mkTmp('y1-never-blocks-'), 'symlinked')
  cpSync(join(ROOT, ENTRY), join(I.root, ENTRY))
  cpSync(join(ROOT, PARTS), join(I.root, PARTS), { recursive: true })
  return I
}

const logDir = (I: Y1Install): string => join(I.root, 'store', 'y1-report-only')
const commandOf = (form: Form, I: Y1Install): string => registered(form.file)[0].command.replaceAll('{{PROJECT_ROOT}}', I.root)

function envOf(form: Form, I: Y1Install, extra: Record<string, string> = {}): Record<string, string> {
  const sub = form.caller !== 'main'
  return {
    // the node that runs this suite, so the hook is not judged on another version
    PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
    HOME: I.home,
    CLAUDE_PROJECT_DIR: sub ? I.homeOf(form.caller) : I.root,
    CLAUDE_CONFIG_DIR: sub ? join(I.lexical(form.caller), '.claude-config') : join(I.root, '.channels-config'),
    ...extra,
  }
}

interface Ran { rc: number | null; signal: string | null; stdout: string; stderr: string }
const ran = (r: ReturnType<typeof spawnSync>): Ran => ({ rc: r.status, signal: r.signal, stdout: String(r.stdout), stderr: String(r.stderr) })

/** the registered command, as the harness runs it: through a shell, the payload on stdin */
function viaShell(form: Form, I: Y1Install, input: string, extra: Record<string, string> = {}): Ran {
  return ran(spawnSync('/bin/sh', ['-c', commandOf(form, I)], { input, env: envOf(form, I, extra), encoding: 'utf8', timeout: 60_000 }))
}

/** the hook file alone, without the registered wrapper */
function raw(form: Form, I: Y1Install, input: string, extra: Record<string, string> = {}): Ran {
  return ran(spawnSync(process.execPath, [join(I.root, ENTRY)], { input, env: envOf(form, I, extra), encoding: 'utf8', timeout: 60_000 }))
}

type Row = Record<string, unknown> & { kind?: string; input?: { command?: string } }
function rows(I: Y1Install, file: string): Row[] {
  const path = join(logDir(I), file)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Row)
}

const payload = (I: Y1Install, form: Form, tool_name: string, tool_input: Record<string, unknown>): string =>
  JSON.stringify({ session_id: 's-1', hook_event_name: 'PreToolUse', tool_name, tool_input, cwd: form.caller === 'main' ? I.root : I.homeOf(form.caller) })

// a write of the install's own settings: a would-deny for the main agent and for a sub-agent alike. The tail makes it
// long, so a row that carries only a head of the command fails the comparison.
const denied = (I: Y1Install): string =>
  `python3 -c "open('${join(I.root, '.claude', 'settings.json')}','w').write('{}')" # ${'the whole command must reach the row '.repeat(120)}end`

const SILENT_OK = { rc: 0, signal: null, stdout: '', stderr: '' }

describe.each(FORMS)('y1-report-only never blocks: $name', (form) => {
  const mutate = (I: Y1Install, rel: string, text: string): void => appendFileSync(join(I.root, rel), `\n${text}\n`)

  it('is registered once, as a PreToolUse hook', () => {
    expect(registered(form.file)).toHaveLength(1)
    expect(registered(form.file)[0].event).toBe('PreToolUse')
  })

  it('logs a would-deny with the whole command, and decides nothing', () => {
    const I = install()
    const command = denied(I)
    expect(viaShell(form, I, payload(I, form, 'Bash', { command }))).toEqual(SILENT_OK)
    const [call, ...moreCalls] = rows(I, 'calls.jsonl')
    const [finding, ...moreFindings] = rows(I, 'findings.jsonl')
    expect(moreCalls).toEqual([])
    expect(moreFindings).toEqual([])
    expect(call).toMatchObject({ kind: 'would-deny', agent: form.caller, tool: 'Bash' })
    expect(call).not.toHaveProperty('input')
    expect(finding).toMatchObject({ kind: 'would-deny', agent: form.caller, tool: 'Bash', session: 's-1', base_deny: true })
    expect(finding.input?.command).toBe(command)
    expect(finding).not.toHaveProperty('input_truncated')
  })

  it('writes one short row for an allow, and no finding', () => {
    const I = install()
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: 'ls' }))).toEqual(SILENT_OK)
    expect(rows(I, 'calls.jsonl')).toHaveLength(1)
    expect(rows(I, 'calls.jsonl')[0]).toMatchObject({ kind: 'allow', agent: form.caller })
    expect(existsSync(join(logDir(I), 'findings.jsonl'))).toBe(false)
  })

  it('writes nothing for a tool the gate does not judge', () => {
    const I = install()
    expect(viaShell(form, I, payload(I, form, 'Read', { file_path: join(I.root, '.claude', 'settings.json') }))).toEqual(SILENT_OK)
    expect(existsSync(logDir(I))).toBe(false)
  })

  it.each([['garbage', '{"tool_name": "Bash", '], ['nothing', '']])('logs an error row when stdin holds %s', (_what, input) => {
    const I = install()
    expect(viaShell(form, I, input)).toEqual(SILENT_OK)
    expect(rows(I, 'findings.jsonl')).toHaveLength(1)
    expect(rows(I, 'findings.jsonl')[0]).toMatchObject({ kind: 'error', error: expect.stringMatching(/^no payload: /) })
    expect(rows(I, 'calls.jsonl')).toEqual([])
  })

  it('counts the rows it drops when the log is at its cap', () => {
    const I = install()
    mkdirSync(logDir(I), { recursive: true })
    for (const [file, cap] of Object.entries(CAP_BYTES as Record<string, number>)) {
      appendFileSync(join(logDir(I), file), '')
      truncateSync(join(logDir(I), file), cap)
    }
    for (let n = 1; n <= 2; n++) {
      expect(viaShell(form, I, payload(I, form, 'Bash', { command: denied(I) }))).toEqual(SILENT_OK)
      for (const [file, cap] of Object.entries(CAP_BYTES as Record<string, number>)) {
        expect(statSync(join(logDir(I), file)).size, file).toBe(cap)
        expect(statSync(join(logDir(I), `${file}.FULL`)).size, `${file}.FULL`).toBe(n)
      }
    }
  })

  it('lets the call through when its own code throws while loading', () => {
    const I = install()
    mutate(I, join(PARTS, 'core.mjs'), "throw new Error('mutant: core does not load')")
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: denied(I) }))).toEqual(SILENT_OK)
    expect(raw(form, I, payload(I, form, 'Bash', { command: denied(I) }))).toEqual(SILENT_OK)
    const lines = readFileSync(join(logDir(I), 'ERRORS.txt'), 'utf8').split('\n').filter(Boolean)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('mutant: core does not load')
  })

  it('lets the call through when the decision throws, and logs why', () => {
    const I = install()
    mutate(I, join(PARTS, 'decide.mjs'), "throw new Error('mutant: the decision does not load')")
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: 'ls' }))).toEqual(SILENT_OK)
    expect(rows(I, 'findings.jsonl')).toHaveLength(1)
    expect(rows(I, 'findings.jsonl')[0]).toMatchObject({ kind: 'error', input: { command: 'ls' }, error: expect.stringContaining('mutant: the decision does not load') })
    expect(rows(I, 'calls.jsonl')[0]).toMatchObject({ kind: 'error' })
  })

  it('lets the call through when its own code exits 2', () => {
    const I = install()
    mutate(I, join(PARTS, 'core.mjs'), 'process.exit(2)')
    expect(raw(form, I, payload(I, form, 'Bash', { command: 'ls' })).rc).toBe(2)
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: 'ls' }))).toEqual(SILENT_OK)
  })

  it('lets the call through when the gate prints a deny decision and exits 2', () => {
    const I = install()
    const decision = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'mutant' } })
    mutate(I, join(PARTS, 'decide.mjs'), [
      "import { writeSync as mutantWrite } from 'node:fs'",
      `console.log(${JSON.stringify(decision)})`,
      "console.error('mutant: blocked')",
      `mutantWrite(1, ${JSON.stringify(decision)})`,
      "mutantWrite(2, 'mutant: blocked')",
      'process.exit(2)',
    ].join('\n'))
    const bare = raw(form, I, payload(I, form, 'Bash', { command: 'ls' }))
    expect(bare.rc).toBe(2)
    // console.* is swallowed by the hook itself, a write to the descriptor is not: one copy arrives, not two
    expect(bare.stdout).toBe(decision)
    expect(bare.stderr).toBe('mutant: blocked')
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: 'ls' }))).toEqual(SILENT_OK)
  })

  it('ends a gate that never returns, logs the call as a timeout, and lets it through', () => {
    const I = install()
    mutate(I, join(PARTS, 'upstream', 'scripts', 'hooks', 'db-write-gate.mjs'), 'for (;;) {}')
    const command = denied(I)
    const short = { Y1_REPORT_ONLY_DEADLINE_MS: '400' }
    const r = viaShell(form, I, payload(I, form, 'Bash', { command }), short)
    // the shell may name the killed child on ITS stderr; a hook's stderr is not read at exit code 0
    expect({ rc: r.rc, signal: r.signal, stdout: r.stdout }).toEqual({ rc: 0, signal: null, stdout: '' })
    expect(rows(I, 'calls.jsonl')).toHaveLength(1)
    expect(rows(I, 'calls.jsonl')[0]).toMatchObject({ kind: 'timeout', phase: 'decision', agent: form.caller, deadline_ms: 400 })
    expect(rows(I, 'findings.jsonl')).toHaveLength(1)
    expect(rows(I, 'findings.jsonl')[0]).toMatchObject({ kind: 'timeout', phase: 'decision', agent: form.caller, deadline_ms: 400, input: { command } })
    // without the registered wrapper the same run is a killed process: the wrapper is what the harness is spared by
    expect(raw(form, I, payload(I, form, 'Bash', { command }), short)).toMatchObject({ rc: null, signal: 'SIGKILL', stdout: '' })
  })

  it('still logs, and says so, when its watchdog cannot start', () => {
    const I = install()
    rmSync(join(I.root, PARTS, 'watchdog.mjs'))
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: denied(I) }))).toEqual(SILENT_OK)
    expect(rows(I, 'calls.jsonl')).toHaveLength(1)
    expect(rows(I, 'calls.jsonl')[0]).toMatchObject({ kind: 'would-deny', dog: false })
    expect(rows(I, 'findings.jsonl')).toHaveLength(1)
  })

  it('lets the call through when the hook file is gone', () => {
    const I = install()
    rmSync(join(I.root, ENTRY))
    expect(viaShell(form, I, payload(I, form, 'Bash', { command: denied(I) }))).toEqual(SILENT_OK)
    expect(existsSync(logDir(I))).toBe(false)
  })

  describe('a stdin that never closes', () => {
    let child: ReturnType<typeof spawn> | null = null
    afterEach(() => { child?.stdin?.destroy(); child?.kill('SIGKILL'); child = null })

    it('is ended at the deadline, logged as a timeout, and let through', async () => {
      const I = install()
      const c = spawn('/bin/sh', ['-c', commandOf(form, I)], { env: envOf(form, I, { Y1_REPORT_ONLY_DEADLINE_MS: '400' }), stdio: ['pipe', 'pipe', 'ignore'] })
      child = c
      let stdout = ''
      c.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      c.stdin?.write('{"tool_name": "Bash", ')
      const rc = await new Promise<number | null>((done) => c.on('close', (code) => done(code)))
      expect({ rc, stdout }).toEqual({ rc: 0, stdout: '' })
      expect(rows(I, 'findings.jsonl')).toHaveLength(1)
      expect(rows(I, 'findings.jsonl')[0]).toMatchObject({ kind: 'timeout', phase: 'stdin', deadline_ms: 400 })
    }, 30_000)
  })
})

describe('y1-report-only: the registered commands are fail-open by their shape', () => {
  const entry = readFileSync(join(ROOT, ENTRY), 'utf8')
  const ms = (name: string): number => Number(entry.match(new RegExp(`^const ${name} = (\\d+)$`, 'm'))?.[1])

  it.each(FORMS)('$file', ({ file }) => {
    const [r] = registered(file)
    // everything the hook prints is discarded before the harness can read a decision in it
    expect(r.command).toMatch(/y1-report-only\.mjs"? >\/dev\/null 2>&1; /)
    // the last word is exit 0, whatever ended the hook
    expect(r.command).toMatch(/; exit 0'?$/)
    // `exec node` would replace the shell, and a killed hook's signal would be the command's exit status
    expect(r.command).not.toMatch(/\bexec\b/)
    expect(r.command).not.toMatch(/\|\||set -e/)
    expect(r.matcher).toBe('Bash|Write|Edit|MultiEdit|NotebookEdit|mcp__.*')
  })

  it.each(FORMS)('$file gives the hook longer than its own deadline plus the grace', ({ file }) => {
    expect(ms('DEADLINE_MS')).toBeGreaterThan(0)
    expect(ms('GRACE_MS')).toBeGreaterThan(0)
    expect(registered(file)[0].timeout * 1000).toBeGreaterThan(ms('DEADLINE_MS') + ms('GRACE_MS'))
  })
})
