// Card a4ae5970: a script FILE a command runs is judged on its content by both mail gates.
// `python3 x.py` used to pass whatever x.py held, and the heredoc deny's way out told the agent
// to do exactly that. The recognition itself is pinned case by case in send-invocation-cases.json
// (both twins, with a `cwd`); this file pins what the case list cannot: that the HOOK PROCESSES
// take the cwd from the payload, that a deny caused only by the file names the data-file way out,
// and the named limits (size cap, a directory, no known cwd).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error -- plain .mjs hook script, no types
import { gateDecision, isSendInvocation, scriptFileHit, SCRIPT_FILE_WAY_OUT } from '../../scripts/email-send-gate.mjs'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const ROOT = join(__dirname, '..', '..')
const FX = join(ROOT, 'src', '__tests__', 'fixtures', 'script-file-gate')
const COPY_GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')
const HARD_GATE = join(ROOT, 'scripts', 'email-send-gate.mjs')
const WAY_OUT = 'A futtatott szkriptfajl tartalma kodnak olvasodik'
const HEREDOC_WAY_OUT = 'A heredoc torzse kodnak olvasodik'

function hardGate(cmd: string, payloadCwd: string | undefined, procCwd: string = ROOT): string {
  const payload: Record<string, unknown> = { tool_name: 'Bash', tool_input: { command: cmd } }
  if (payloadCwd !== undefined) payload.cwd = payloadCwd
  const r = spawnSync(process.execPath, [HARD_GATE], { input: JSON.stringify(payload), encoding: 'utf-8', cwd: procCwd })
  return r.stdout + r.stderr
}

function copyGate(cmd: string, payloadCwd: string | undefined, procCwd: string): { code: number | null; err: string } {
  const payload: Record<string, unknown> = { tool_name: 'Bash', tool_input: { command: cmd }, hook_event_name: 'PreToolUse' }
  if (payloadCwd !== undefined) payload.cwd = payloadCwd
  const rules = join(procCwd, 'rules.json')
  writeFileSync(rules, '{"bad_name_patterns": []}\n')
  const r = spawnSync('python3', [COPY_GATE], {
    input: JSON.stringify(payload),
    encoding: 'utf-8',
    cwd: procCwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, OUTGOING_COPY_GATE_RULES: rules },
  })
  return { code: r.status, err: r.stderr }
}

const isDeny = (out: string) => out.includes('"permissionDecision":"deny"')

describe('hard gate (sub-agents): the script file a command runs', () => {
  it('gives kind script-file when the file is the whole reason, the ordinary deny otherwise', () => {
    expect(gateDecision('Bash', { command: 'python3 sender.py' }, FX)).toEqual({ deny: true, kind: 'script-file' })
    expect(gateDecision('Bash', { command: 'python3 harmless.py' }, FX)).toEqual({ deny: false })
    // a visible send in the command text wins: no file way out for it
    expect(gateDecision('Bash', { command: 'sendmail a@b.hu < x; python3 sender.py' }, FX)).toEqual({ deny: true })
    expect(scriptFileHit('sendmail a@b.hu < x; python3 sender.py', { cwd: FX, files: true })).toBe(false)
  })

  it('the hook process resolves a relative script against the PAYLOAD cwd, not its own', () => {
    // CONTROL: the process runs in the repo root, where sender.py does not exist
    const out = hardGate('python3 sender.py', FX, ROOT)
    expect(isDeny(out)).toBe(true)
    expect(out).toContain('Email-kuldes sub-agentkent tiltott')
    expect(out).toContain(WAY_OUT)
    expect(out).not.toContain(HEREDOC_WAY_OUT)
    expect(isDeny(hardGate('python3 harmless.py', FX, ROOT))).toBe(false)
  })

  it('with no cwd in the payload, the process cwd is used', () => {
    expect(isDeny(hardGate('python3 sender.py', undefined, FX))).toBe(true)
    expect(isDeny(hardGate('python3 sender.py', undefined, ROOT))).toBe(false)
  })

  it('the way out offers a data file, not running the script as a file', () => {
    expect(SCRIPT_FILE_WAY_OUT).toContain('adatfajlba')
    expect(SCRIPT_FILE_WAY_OUT).not.toContain('KULON Bash-hivasban')
  })
})

describe('copy gate: the script file a command runs', () => {
  it('a sending script file from the payload cwd: blocked, and told the data-file way out', () => {
    const proc = mkTmp('script-file-copy-')
    const r = copyGate('python3 sender.py', FX, proc)
    expect(r.code).toBe(2)
    expect(r.err).toContain('a kuldes egy futtatott szkriptfajlban all')
    expect(r.err).toContain(WAY_OUT)
    expect(r.err).not.toContain(HEREDOC_WAY_OUT)
  })

  it('an ordinary script file from the same cwd passes', () => {
    const proc = mkTmp('script-file-copy-')
    expect(copyGate('python3 harmless.py', FX, proc).code).toBe(0)
  })

  it('with no cwd in the payload, the process cwd is used', () => {
    const proc = mkTmp('script-file-copy-')
    expect(copyGate('python3 sender.py', undefined, proc).code).toBe(0) // not there
    writeFileSync(join(proc, 'sender.py'), "import subprocess\nsubprocess.run(['sendmail', '-t'])\n")
    expect(copyGate('python3 sender.py', undefined, proc).code).toBe(2)
  })
})

describe('named limits: judged as before, not a send', () => {
  const both = (cmd: string, cwd: string | null) => {
    const py = spawnSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(COPY_GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
i = json.load(sys.stdin)
print(json.dumps(g.is_send_invocation(i["cmd"], ctx={"cwd": i["cwd"], "files": True})))
`], { input: JSON.stringify({ cmd, cwd }), encoding: 'utf-8' })
    return { js: isSendInvocation(cmd, 0, { cwd, files: true }), py: JSON.parse(py.stdout.trim()) }
  }

  it('a file over 1 MB is not read; the same content under the cap is', () => {
    const dir = mkTmp('script-file-big-')
    const send = "import subprocess\nsubprocess.run(['sendmail', '-t'])\n"
    writeFileSync(join(dir, 'small.py'), send)
    writeFileSync(join(dir, 'big.py'), send + '#'.repeat(1_000_001))
    expect(both('python3 small.py', dir)).toEqual({ js: true, py: true })
    expect(both('python3 big.py', dir)).toEqual({ js: false, py: false })
  })

  it('a directory with a script name is not read', () => {
    const dir = mkTmp('script-file-dir-')
    mkdirSync(join(dir, 'x.py'))
    expect(both('python3 x.py', dir)).toEqual({ js: false, py: false })
  })

  it('an absolute path is read with no known cwd; a relative one is not resolved', () => {
    expect(both(`python3 ${join(FX, 'sender.py')}`, null)).toEqual({ js: true, py: true })
    expect(both('python3 sender.py', null)).toEqual({ js: false, py: false })
  })
})
