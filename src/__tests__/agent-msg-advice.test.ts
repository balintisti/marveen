/**
 * THE LAST MILE: the sender only benefits from what the SCRIPT prints.
 *
 * Card bbb8557c. The server can compose a perfect warning and it is worth
 * nothing if the shell drops it -- and until now nothing tested this script at
 * all, so the whole chain (server -> JSON -> the python parse inside bash ->
 * stderr) ended in an untested step. That is the shape where a green suite and
 * a silent tool live side by side.
 *
 * `curl` is stubbed rather than a server started: the point is what the script
 * does with a RESPONSE, and a stub makes the response exact instead of
 * approximately right.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REAL_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'agent-msg.sh')

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

/** Stage the real script in a throwaway install, with `curl` replaced. */
function run(responseJson: string, httpCode = '200'): { stdout: string; stderr: string; code: number } {
  const base = mkdtempSync(join(tmpdir(), 'agent-msg-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(base, 'store', '.dashboard-token'), 'test-token\n')

  const binDir = join(base, 'bin')
  mkdirSync(binDir)
  const curl = join(binDir, 'curl')
  // -w '\n%{http_code}' is what the script asks for, so the stub answers in
  // exactly that shape: body, newline, status.
  writeFileSync(curl, `#!/usr/bin/env bash\ncat <<'JSON'\n${responseJson}\nJSON\nprintf '%s' '${httpCode}'\n`)
  chmodSync(curl, 0o755)

  try {
    const stdout = execFileSync('bash', [join(base, 'scripts', 'agent-msg.sh'), 'a', 'b', 'szia'], {
      encoding: 'utf-8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { stdout, stderr: '', code: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number }
    return { stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? ''), code: err.status ?? -1 }
  }
}

/** execFileSync only hands back stderr on failure, so capture it explicitly. */
function runCapturingStderr(responseJson: string): { stdout: string; stderr: string } {
  const base = mkdtempSync(join(tmpdir(), 'agent-msg-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(base, 'store', '.dashboard-token'), 'test-token\n')
  const binDir = join(base, 'bin')
  mkdirSync(binDir)
  writeFileSync(join(binDir, 'curl'),
    `#!/usr/bin/env bash\ncat <<'JSON'\n${responseJson}\nJSON\nprintf '%s' '200'\n`)
  chmodSync(join(binDir, 'curl'), 0o755)

  const errFile = join(base, 'stderr.txt')
  const stdout = execFileSync(
    'bash', ['-c', `"${join(base, 'scripts', 'agent-msg.sh')}" a b szia 2>"${errFile}"`],
    { encoding: 'utf-8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` } })
  return { stdout, stderr: execFileSync('cat', [errFile], { encoding: 'utf-8' }) }
}

describe('agent-msg.sh', () => {
  it('still prints the "OK id=" contract every caller greps for', () => {
    const { stdout } = run('{"id":42,"status":"pending"}')
    expect(stdout).toContain('OK id=42')
  })

  it('prints the queue depth when the server returns one', () => {
    const { stdout } = run('{"id":42,"queue":{"queueDepth":4,"estimatedDelaySec":300}}')
    expect(stdout).toContain('queue=4')
    expect(stdout).toContain('(~5 perc)')
  })

  it('prints the ADVICE the server composed, on stderr', () => {
    // The whole card in one assertion: a warning the script drops is a warning
    // that does not exist.
    const { stderr } = runCapturingStderr(
      '{"id":42,"queue":{"queueDepth":1,"advice":"FIGYELEM: a címzett nem fut."}}')
    expect(stderr).toContain('a címzett nem fut')
  })

  it('keeps a two-line advice on two lines', () => {
    // The advice crosses the shell as one tab-separated field with the
    // newlines escaped; if the restore is wrong the second line -- which is
    // the one that says what to DO -- silently disappears or eats the first.
    const { stderr } = runCapturingStderr(
      '{"id":42,"queue":{"queueDepth":4,"advice":"elso sor\\n  masodik sor"}}')
    const lines = stderr.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('elso sor')
    expect(lines[1]).toBe('  masodik sor')
  })

  it('says nothing on stderr when the server had nothing to say', () => {
    // Advice printed on every send is advice nobody reads by the third day.
    const { stderr } = runCapturingStderr('{"id":42,"queue":{"queueDepth":1,"advice":null}}')
    expect(stderr.trim()).toBe('')
  })

  it('still reports the id when the response carries no queue at all', () => {
    // Federated recipients get no queue block. The id is the proof of sending
    // and must survive a missing field, not be shifted by it.
    const { stdout } = run('{"id":7,"status":"pending"}')
    expect(stdout.trim()).toBe('OK id=7')
  })

  it('FAILS loudly on a rejected request instead of reporting success', () => {
    // The reason this helper exists: `curl -s ... && echo sent` exits 0 on a
    // 401 too.
    const { stdout, code } = run('{"error":"unauthorized"}', '401')
    expect(stdout).toContain('FAIL')
    expect(code).not.toBe(0)
  })
})
