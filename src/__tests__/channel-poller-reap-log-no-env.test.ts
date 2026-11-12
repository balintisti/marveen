// Ported from upstream 0788102db0 (card 09861207); our tree scans with `ps eww -e`.
// TESTENVLEAK1101: a failed `ps axeww` must never put the process environment into a log line. execSync's error
// carries the child's whole stdout; logged as `{ err }`, pino wrote it into dashboard.log (measured 2026-11-01: an
// 8.4 MB err.stdout from an ENOBUFS scan, every ~11 minutes, tokens included), and a failing reap test printed it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SECRET = 'leakprobe-7f3c9a1e5d'
const envDump = `  PID   TT  STAT      TIME COMMAND\n  42 ??  S  0:00.01 /usr/bin/bun server.ts GH_TOKEN=${SECRET} CLAUDE_CODE_OAUTH_TOKEN=${SECRET}x\n`
const failing = () => Object.assign(new Error('spawnSync /bin/sh ENOBUFS'), { code: 'ENOBUFS', status: null, signal: 'SIGTERM', stdout: envDump, stderr: '' })

vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execSync: () => { throw failing() },
}))

const { execFailure, collectPollerEvidence } = await import('../web/channel-poller-reap.js')
const { logger } = await import('../logger.js')

afterEach(() => { vi.restoreAllMocks() })

describe('TESTENVLEAK1101: no environment in a failed scan\'s log line', () => {
  it('execFailure keeps the kind of failure and the output size, never the output', () => {
    const f = execFailure(failing())
    expect(f).toEqual({ code: 'ENOBUFS', signal: 'SIGTERM', status: null, stdoutBytes: Buffer.byteLength(envDump) })
    expect(JSON.stringify(f)).not.toContain(SECRET)
    expect(execFailure(undefined)).toEqual({ code: null, signal: null, status: null, stdoutBytes: 0 })
    expect(execFailure(Object.assign(new Error('x'), { stdout: Buffer.from(envDump) })).stdoutBytes).toBe(Buffer.byteLength(envDump))
  })

  it('a failing env scan and process snapshot log no token-like value and no stdout field (the real catches, execSync failing)', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined as never)
    const ev = collectPollerEvidence('telegram', '/nonexistent/leakprobe-agent', 4242)
    expect(ev.envScanPids).toEqual([])
    // Both catches fired: the `ps eww -e` env scan and the `ps -axww` snapshot.
    expect(warn.mock.calls.map((c) => c[1])).toEqual(expect.arrayContaining([
      'channel-poller-reap: ps scan failed',
      'channel-poller-reap: ps -axww snapshot failed',
    ]))
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain(SECRET)
    expect(logged).not.toMatch(/[A-Z][A-Z0-9_]*(TOKEN|SECRET|PASSWORD|KEY)=\S/)
    expect(logged).not.toContain('"stdout"')
    expect(logged).toContain('"stdoutBytes"')
  })

  it('channel-poller-reap.ts never logs a raw error object (source pin)', () => {
    const src = readFileSync(join(__dirname, '..', 'web', 'channel-poller-reap.ts'), 'utf8')
    // `{ err }`, `{ x, err }`, `{ err: e }`, `{ ...execFailure(err), cause: err }`: the error object as a
    // field, spaced as this repo writes it (didi 59355). execFailure(err) is the allowed form.
    expect(src).not.toMatch(/logger\.\w+\(\s*\{[^}]*\berr\b\s*[,}:]/)
    expect(src).not.toMatch(/logger\.\w+\(\s*err\s*[,)]/)
    // Whatever the catch variable is called and wherever in the catch the log line stands: every
    // logger call inside a catch names the error only through execFailure(<it>).
    const logging = catchBlocks(src).filter((c) => /logger\.\w+\(/.test(c.body))
    expect(logging.length).toBeGreaterThanOrEqual(5)
    for (const { name, body } of logging) {
      for (const call of loggerCalls(body)) {
        expect(call, call).toContain(`execFailure(${name})`)
        expect(call.split(`execFailure(${name})`).join(''), call).not.toMatch(new RegExp(`\\b${name}\\b`))
      }
    }
  })
})

/** The text from `open` (an opening bracket) to its matching close; brackets inside strings are not special-cased. */
function balanced(src: string, open: number): string {
  const pair: Record<string, string> = { '{': '}', '(': ')' }
  const close = pair[src[open]!]!
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === src[open]) depth++
    else if (src[i] === close && --depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

function catchBlocks(src: string): Array<{ name: string; body: string }> {
  return [...src.matchAll(/catch \((\w+)\) \{/g)].map((m) => ({
    name: m[1]!,
    body: balanced(src, m.index! + m[0].length - 1),
  }))
}

function loggerCalls(body: string): string[] {
  return [...body.matchAll(/logger\.\w+\(/g)].map((m) => balanced(body, m.index! + m[0].length - 1))
}
