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

/**
 * The preflight line the script prints when it cannot READ the queue.
 *
 * WHY THIS CONSTANT EXISTS (card da1c72ab, 2026-08-23). Two tests below used to
 * assert on the WHOLE of stderr -- "exactly two lines", "empty". They were
 * written on 2026-08-20 against a helper that had no preflight at all. The base
 * has since grown one (`53f33c9`: measure the recipient queue BEFORE sending),
 * and in a throwaway install there is no database to read, so the script says
 * so. Both tests then failed on the MERGED state, while each side alone was
 * green.
 *
 * The fix is NOT to silence the preflight. That sentence states exactly the
 * distinction this fleet defends everywhere else -- "the queue is 0" and "I
 * could not measure the queue" are not the same -- and deleting a TRUE signal
 * to keep an OLD contract green is the failure mode these tests exist to catch.
 * So the assertions move to the ADVICE, and the preflight gets its own tests,
 * in BOTH directions.
 */
const PREFLIGHT_BLIND = 'a sor melyseget NEM tudtam megmerni'

/** stderr without the preflight line: what the SERVER's advice actually produced. */
function adviceOnly(stderr: string): string[] {
  return stderr.split('\n').filter((l) => l.trim() && !l.includes(PREFLIGHT_BLIND))
}

/** execFileSync only hands back stderr on failure, so capture it explicitly.
 *  `withDb` creates a real (empty) queue database, so the preflight CAN measure. */
function runCapturingStderr(responseJson: string, withDb = false): { stdout: string; stderr: string } {
  const base = mkdtempSync(join(tmpdir(), 'agent-msg-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(base, 'store', '.dashboard-token'), 'test-token\n')
  if (withDb) {
    // A REAL sqlite file, not a stub: the preflight reads it with python3, and
    // a fake would test the fake.
    execFileSync('python3', ['-c',
      `import sqlite3;c=sqlite3.connect(${JSON.stringify(join(base, 'store', 'claudeclaw.db'))});` +
      `c.execute("create table agent_messages (id integer primary key, from_agent text, to_agent text, content text, status text, created_at text)");c.commit()`])
  }
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
    // The ADVICE is what this test is about. The preflight may add a line of
    // its own (no database in a throwaway install) and that line is not advice.
    const lines = adviceOnly(stderr)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('elso sor')
    expect(lines[1]).toBe('  masodik sor')
  })

  it('says nothing on stderr when the server had nothing to say', () => {
    // Advice printed on every send is advice nobody reads by the third day.
    const { stderr } = runCapturingStderr('{"id":42,"queue":{"queueDepth":1,"advice":null}}')
    expect(adviceOnly(stderr)).toHaveLength(0)
  })

  it('SAYS SO when it cannot read the queue -- silence would mean "the queue is 0"', () => {
    // The direction that must never regress. If this line ever disappears, the
    // sender cannot tell "nobody is waiting" from "I did not look" -- and the
    // second one is the reason the preflight exists.
    const { stderr } = runCapturingStderr('{"id":42,"queue":{"queueDepth":1,"advice":null}}')
    expect(stderr).toContain(PREFLIGHT_BLIND)
  })

  it('and does NOT say it when the queue IS readable', () => {
    // The other direction, and the one that makes the first assertion worth
    // something: a warning printed on every send is a warning nobody reads by
    // the third day. Without this test the "fix" for the line above could be
    // to print it unconditionally.
    const { stderr } = runCapturingStderr('{"id":42,"queue":{"queueDepth":1,"advice":null}}', true)
    expect(stderr).not.toContain(PREFLIGHT_BLIND)
    expect(adviceOnly(stderr)).toHaveLength(0)
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
