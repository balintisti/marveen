import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY THE STAMP EXISTS (2026-08-23). The fleet rule is that every handed-over
// measurement carries WHEN it was taken, ON WHAT STATE, and WHAT WOULD
// INVALIDATE IT. For kanban comments the timestamp is already in the TOOL --
// card-comment.sh substitutes __STAMP__, so it cannot be forgotten. For
// inter-agent messages there was nothing, and that is where most handovers
// happen. A rule that only holds where it was already enforced is not a rule.
//
// WHY `KULDVE` AND NOT `MERVE`: the helper knows only when it SENT. Stamping a
// send time under the word "measured" would be false, and machine-written, so
// more convincing than a human's mistake.
//
// WHY A FOOTER AND NOT A HEADER, which is what these tests mostly pin: two
// consumers match on the START of the content --
//   src/web/routes/messages.ts  !content.startsWith(COMPLETION_REPORT_PREFIX)
//   src/db.ts getDispatchedPendingStats  content NOT LIKE '[Eredmény]%'
// The second feeds the soft-restart gate, and on 2026-08-12 counting
// acknowledgements as blocking work made the main agent permanently ineligible
// for a soft restart. A prefix would shift any `[Eredmény] ...` sent through
// this helper out of both patterns and re-open that incident.

const REPO = join(__dirname, '..', '..')
const servers: Server[] = []

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()))
})

/** A stand-in for the dashboard: records every POSTed body, answers like the real one. */
function fakeDashboard(): Promise<{ port: number; bodies: Array<Record<string, string>> }> {
  const bodies: Array<Record<string, string>> = []
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        try { bodies.push(JSON.parse(raw)) } catch { /* recorded as absent */ }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ id: 4242, status: 'pending' }))
      })
    })
    servers.push(server)
    // Bind EVERY interface, not just 127.0.0.1. The script targets
    // `http://localhost:<port>`, and on macOS localhost resolves to ::1 first --
    // an IPv4-only listener then gets a refused connection, the helper burns its
    // three retries, and the whole suite takes 420 seconds to tell you nothing.
    // Measured that, exactly once.
    server.listen(0, () => {
      const a = server.address()
      resolve({ port: typeof a === 'object' && a ? a.port : 0, bodies })
    })
  })
}

/** A throwaway install root: the script resolves BASE from its own location. */
function installRoot(label: string, pending?: { to: string; count: number }): string {
  const root = mkdtempSync(join(tmpdir(), `agentmsg-${label}-`))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'store'), { recursive: true })
  copyFileSync(join(REPO, 'scripts', 'agent-msg.sh'), join(root, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(root, 'store', '.dashboard-token'), 'test-token\n')
  if (pending) {
    // The preflight reads the queue straight from SQLite, so the fixture has to
    // be a real database rather than a stubbed HTTP answer.
    const py = `
import sqlite3
c = sqlite3.connect(${JSON.stringify(join(root, 'store', 'claudeclaw.db'))})
c.execute("create table agent_messages (id integer primary key, from_agent text, to_agent text, content text, status text, created_at text)")
for i in range(${pending.count}):
    c.execute("insert into agent_messages (from_agent,to_agent,content,status,created_at) values (?,?,?,?,?)",
              ("x", ${JSON.stringify(pending.to)}, "c", "pending", "1"))
c.commit()
`
    const r = spawnSync('python3', ['-c', py], { encoding: 'utf-8' })
    if (r.status !== 0) throw new Error(`fixture db failed: ${r.stderr}`)
  }
  return root
}

/**
 * ASYNC, and that is not a style choice: `spawnSync` blocks the Node event
 * loop, so the in-process fake dashboard above can never accept the
 * connection. The helper then burns its three retries against a server that is
 * listening but cannot answer, and the suite takes 420 seconds to report
 * nothing useful. Measured twice before the cause was obvious.
 */
function send(root: string, port: number, args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', [join(root, 'scripts', 'agent-msg.sh'), ...args], {
      env: { ...process.env, MARVEEN_WEB_PORT: String(port) },
    })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (c) => (stdout += c))
    p.stderr.on('data', (c) => (stderr += c))
    p.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }))
  })
}

describe('agent-msg.sh -- the send stamp', () => {
  it('appends the stamp, and the ORIGINAL text still starts the message', async () => {
    // The regression this whole design is shaped around. `[Eredmény]` must stay
    // the first thing in the content or the ping-pong breaker and the
    // soft-restart gate both stop matching.
    const { port, bodies } = await fakeDashboard()
    const root = installRoot('prefix')
    const r = await send(root, port, ['friday', 'marveen', '[Eredmény] msg_id:7 status:done\n\nkesz'])
    expect(r.status).toBe(0)
    expect(bodies).toHaveLength(1)
    const content = bodies[0].content
    expect(content.startsWith('[Eredmény]')).toBe(true)
    expect(content).toMatch(/\[KULDVE: /)
    expect(content.trimEnd().endsWith(']')).toBe(true)
  })

  it('names the sender and a real timestamp, not a placeholder', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('stamp'), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toMatch(/\[KULDVE: \d{4}-\d{2}-\d{2} \d{2}:\d{2} \S+ \| .* \| kuldo: friday\]/)
  })

  it('says the queue could not be measured instead of leaving the field out', async () => {
    // A missing field reads as "nothing to report". With no database present
    // the depth is unknown, and unknown must look different from zero.
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('nodb'), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('sor: nem merheto')
    expect(r.stderr).toMatch(/NEM tudtam megmerni/)
  })

  it('carries the depth measured BEFORE the send, not after', async () => {
    // Two pending for the recipient: the number the message is joining.
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('depth', { to: 'marveen', count: 2 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('sor: 2')
  })

  it('counts only the RECIPIENT queue, not every pending message', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('other', { to: 'dexter', count: 4 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('sor: 0')
  })

  it('still refuses at 3+ waiting -- the stamp did not weaken the gate', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('full', { to: 'marveen', count: 5 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(2)
    expect(bodies).toHaveLength(0)
    expect(r.stderr).toMatch(/NEM KULDTEM/)
  })

  it('marks the queue as UNMEASURED under --force, rather than printing a stale zero', async () => {
    // --force skips the preflight, so there is no depth. Printing `sor: 0`
    // there would be the same failure the whole change exists to prevent: a
    // number that was never measured, wearing the shape of one that was.
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('force', { to: 'marveen', count: 5 }), port, ['friday', 'marveen', 'torzs', '--force'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('nem merve (--force)')
    expect(bodies[0].content).not.toMatch(/sor: \d/)
  })

  it('keeps the OK id= contract intact -- callers and CLAUDE.md grep for it', async () => {
    const { port } = await fakeDashboard()
    const r = await send(installRoot('contract'), port, ['friday', 'marveen', 'torzs'])
    expect(r.stdout.startsWith('OK id=4242')).toBe(true)
  })
})
