/**
 * THE SENDER'S OWN TRAFFIC -- the one number no sender could see (card f664f1a5).
 *
 * Every other figure this helper prints is scoped to the RECIPIENT: the pending
 * depth, the recipient's total inbound, the server's advice. None of them answer
 * "how much am I sending", and the sum across recipients is what saturates.
 *
 * Measured on the live board 2026-08-28 07:2x, 3-hour window: marveen stood at
 * 127 081 chars to 7 recipients -- 2.7x the documented saturating rate -- and
 * 79% of dexter's entire inbound load was his, while the line he saw said
 * "3 senders", which reads like shared load. Both recipients had saturated that
 * night. Every per-send check was green throughout.
 *
 * The fixture uses the PRODUCTION column types (`created_at INTEGER`), not a
 * convenient TEXT column: the whole assertion is about a time window, and a
 * fixture that differs from production in exactly the dimension under test is
 * the shape that keeps a broken check green.
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

type Row = { from: string; to: string; chars: number; agoMin: number }

/** Stage the real script over a real sqlite queue seeded with `rows`. */
function run(from: string, to: string, rows: Row[]): { stdout: string; stderr: string } {
  const base = mkdtempSync(join(tmpdir(), 'agent-msg-load-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(base, 'store', '.dashboard-token'), 'test-token\n')

  const dbPath = join(base, 'store', 'claudeclaw.db')
  execFileSync('python3', ['-c', `
import json, sqlite3, sys, time
db, rows = sys.argv[1], json.loads(sys.argv[2])
c = sqlite3.connect(db)
c.execute("create table agent_messages (id integer primary key autoincrement,"
          " from_agent text not null, to_agent text not null, content text not null,"
          " status text not null default 'pending', created_at integer not null)")
now = int(time.time())
for r in rows:
    c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at)"
              " values (?,?,?,?,?)",
              (r["from"], r["to"], "x" * r["chars"], "delivered", now - r["agoMin"] * 60))
c.commit()
`, dbPath, JSON.stringify(rows)])

  const binDir = join(base, 'bin')
  mkdirSync(binDir)
  writeFileSync(join(binDir, 'curl'),
    `#!/usr/bin/env bash\ncat <<'JSON'\n{"id":1,"queue":{"queueDepth":0}}\nJSON\nprintf '%s' '200'\n`)
  chmodSync(join(binDir, 'curl'), 0o755)

  const errFile = join(base, 'stderr.txt')
  const stdout = execFileSync(
    'bash', ['-c', `"${join(base, 'scripts', 'agent-msg.sh')}" ${from} ${to} szia 2>"${errFile}"`],
    { encoding: 'utf-8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` } })
  return { stdout, stderr: execFileSync('cat', [errFile], { encoding: 'utf-8' }) }
}

/** The line under test; `[sor]` is the recipient's and belongs to another card. */
function mineLine(stderr: string): string {
  return stderr.split('\n').find((l) => l.includes('[en]')) ?? ''
}

describe('agent-msg.sh -- the sender sees its OWN load at the moment of sending', () => {
  it('reports the total, the count and the number of recipients', () => {
    // 30 000 + 10 000 chars to two different agents inside the window.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'marveen', to: 'dexter', chars: 30_000, agoMin: 60 },
      { from: 'marveen', to: 'jarvis', chars: 10_000, agoMin: 30 },
    ])
    const line = mineLine(stderr)
    expect(line).toContain('40000 kar')
    expect(line).toContain('2 db')
    expect(line).toContain('2 cimzettnek')
  })

  it('gives the number a denominator: the rate against the documented saturating rate', () => {
    // 46 443 chars / 3 h = 15 481 chars/h, the rate that measurably saturated
    // an agent on 2026-08-20. A bare character count asserts nothing; "1.0x the
    // rate that saturated someone" does. If this ever prints without the ratio,
    // the sender is back to reading a number with no population.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'marveen', to: 'dexter', chars: 46_443, agoMin: 60 },
    ])
    expect(mineLine(stderr)).toContain('1.0x-e')
  })

  it('names MY share of THIS recipient, which "3 senders" hides', () => {
    // The exact shape marveen hit: the recipient line said the load came from
    // several senders, and 79% of it was his.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'marveen', to: 'dexter', chars: 7_900, agoMin: 40 },
      { from: 'didi', to: 'dexter', chars: 1_500, agoMin: 20 },
      { from: 'friday', to: 'dexter', chars: 600, agoMin: 10 },
    ])
    expect(mineLine(stderr)).toContain('ebbol dexter-nek 7900 kar (79%)')
  })

  it('omits the share when I have sent this recipient nothing -- not "0%"', () => {
    // A fabricated 0% would read as a measurement. The absence of the clause is
    // the honest answer: my load is elsewhere.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'marveen', to: 'jarvis', chars: 20_000, agoMin: 30 },
      { from: 'didi', to: 'dexter', chars: 5_000, agoMin: 30 },
    ])
    const line = mineLine(stderr)
    expect(line).toContain('20000 kar')
    expect(line).not.toContain('ebbol')
  })

  it('counts only the window: traffic older than 3 hours is not mine to answer for', () => {
    // Without an upper bound on the window the number only ever grows, and a
    // number that only grows stops meaning anything by the second day.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'marveen', to: 'dexter', chars: 50_000, agoMin: 400 },
      { from: 'marveen', to: 'dexter', chars: 1_000, agoMin: 10 },
    ])
    expect(mineLine(stderr)).toContain('1000 kar')
  })

  it('says NOTHING when I have sent nothing -- a line on every send is a line nobody reads', () => {
    // The other direction, and the one that makes the assertions above worth
    // something: without it the "fix" for a missing line is to print it always.
    const { stderr } = run('marveen', 'dexter', [
      { from: 'didi', to: 'dexter', chars: 5_000, agoMin: 30 },
    ])
    expect(mineLine(stderr)).toBe('')
  })

  it('does not fabricate a load when the queue cannot be read at all', () => {
    // Fail-open must stay silent about MY traffic too: "I could not look" and
    // "I sent nothing" are the same two states this helper exists to separate.
    const base = mkdtempSync(join(tmpdir(), 'agent-msg-load-'))
    made.push(base)
    mkdirSync(join(base, 'scripts'))
    mkdirSync(join(base, 'store'))
    copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'agent-msg.sh'))
    writeFileSync(join(base, 'store', '.dashboard-token'), 'test-token\n')
    const binDir = join(base, 'bin')
    mkdirSync(binDir)
    writeFileSync(join(binDir, 'curl'),
      `#!/usr/bin/env bash\ncat <<'JSON'\n{"id":1}\nJSON\nprintf '%s' '200'\n`)
    chmodSync(join(binDir, 'curl'), 0o755)
    const errFile = join(base, 'stderr.txt')
    execFileSync('bash', ['-c', `"${join(base, 'scripts', 'agent-msg.sh')}" a b szia 2>"${errFile}"`],
      { encoding: 'utf-8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ''}` } })
    const stderr = execFileSync('cat', [errFile], { encoding: 'utf-8' })
    expect(stderr).toContain('NEM tudtam megmerni')
    expect(mineLine(stderr)).toBe('')
  })
})
