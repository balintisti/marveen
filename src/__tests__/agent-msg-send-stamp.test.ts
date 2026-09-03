import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
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

// Same as send(), but feeds a file into STDIN -- the `- < "$f"` form the path
// guard's refusal points people at. Needed so the guard's negative control runs
// through the ACTUAL route, not a paraphrase of it.
function sendStdin(root: string, port: number, args: string[], stdinFile: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', [join(root, 'scripts', 'agent-msg.sh'), ...args], {
      env: { ...process.env, MARVEEN_WEB_PORT: String(port) },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (c) => (stdout += c))
    p.stderr.on('data', (c) => (stderr += c))
    p.stdin.end(readFileSync(stdinFile))
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
    expect(bodies[0].content).toContain('cimzett sora: nem merheto')
    expect(r.stderr).toMatch(/NEM tudtam megmerni/)
  })

  it('carries the depth measured BEFORE the send, not after', async () => {
    // Two pending for the recipient: the number the message is joining.
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('depth', { to: 'marveen', count: 2 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('cimzett sora: 2 (kuldes elott)')
  })

  it('counts only the RECIPIENT queue, not every pending message', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('other', { to: 'dexter', count: 4 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('cimzett sora: 0 (kuldes elott)')
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
    expect(bodies[0].content).not.toMatch(/cimzett sora: \d/)
  })

  it('keeps the OK id= contract intact -- callers and CLAUDE.md grep for it', async () => {
    const { port } = await fakeDashboard()
    const r = await send(installRoot('contract'), port, ['friday', 'marveen', 'torzs'])
    expect(r.stdout.startsWith('OK id=4242')).toBe(true)
  })
})

// ===== A KOTEG-FELOLDAS BIZONYITEKA (friday, 2026-08-23) =====
//
// A `__STAMP__` helyettesites computress munkaja (81224f9, kartya a0fbeba0), es
// UGYANEBBE a fajlba nyul, mint a kuldesi belyeg. A koteg-beolvasztaskor a ketto
// utkozott, es a feloldas MINDKETTOT megtartja.
//
// AZERT VAN ITT TESZT, MERT COMPUTRESS SAJAT COMMITJA MONDJA KI, hogy a marveen
// TS-keszletet NEM futtatta ("it refuses to run in a live install by design"), es
// a szkript viselkedeset a keszlet addig nem merte. A harness fentebb viszont a
// VALODI szkriptet hajtja egy hamis dashboard ellen -- tehat itt merheto.
// Egy feloldas, ami csak forditasi ertelemben "megtartja" a masik szandekot,
// pontosan ugy nez ki, mint egy jo feloldas.
describe('agent-msg.sh -- a __STAMP__ es a kuldesi belyeg EGYUTT el', () => {
  it('a __STAMP__ helyere valodi idobelyeg kerul, es nyers helyorzo NEM megy ki', async () => {
    const { port, bodies } = await fakeDashboard()
    const root = installRoot('stamp')
    const r = await send(root, port, ['friday', 'marveen', 'MERVE: __STAMP__ -- a lelet'])
    expect(r.status).toBe(0)
    expect(bodies).toHaveLength(1)
    expect(bodies[0].content).not.toContain('__STAMP__')
    expect(bodies[0].content).toMatch(/MERVE: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  })

  it('NEGATIV KONTROLL: helyorzo nelkuli torzs valtozatlan marad', async () => {
    // Kulonben a teszt attol is zold lenne, hogy a szkript mindenre ratesz egy
    // idobelyeget -- ami mas hiba, csak eppen ugyanugy nez ki.
    const { port, bodies } = await fakeDashboard()
    const root = installRoot('nostamp')
    const r = await send(root, port, ['friday', 'marveen', 'sima szoveg, nincs benne helyorzo'])
    expect(r.status).toBe(0)
    expect(bodies[0].content.split('\n')[0]).toBe('sima szoveg, nincs benne helyorzo')
  })

  it('MINDKET MECHANIZMUS EGYSZERRE: helyettesites ES labjegyzet, az eredeti szoveg elol', async () => {
    // EZ A FELOLDAS ALLITASA. A `__STAMP__` a SZERZO szoveget javitja, a
    // labjegyzet a gep kuldesi idejet teszi a VEGERE -- ket kulonbozo kerdes,
    // es a sorrend szandekos: a helyettesites a hozzafuzes ELOTT fut.
    const { port, bodies } = await fakeDashboard()
    const root = installRoot('mindketto')
    const r = await send(root, port, ['friday', 'marveen', '[Eredmény] MERVE: __STAMP__\n\nkesz'])
    expect(r.status).toBe(0)
    const c = bodies[0].content
    expect(c.startsWith('[Eredmény]')).toBe(true)   // a prefix-fogyasztok miatt
    expect(c).not.toContain('__STAMP__')            // computress fele
    expect(c).toMatch(/\[KULDVE: /)                 // az en felem
    expect(c.trimEnd().endsWith(']')).toBe(true)
  })

  it('HANGOS, ha nem tud belyegezni: a `date` bukasakor NEM kuld', async () => {
    // computress kikotese, Marveen feltetele nyoman: nyers helyorzot kikuldeni
    // ujraepitene azt a lyukat, amit ez bezar -- es a kuldes a visszafordithatatlan fel.
    const { port, bodies } = await fakeDashboard()
    const root = installRoot('nodate')
    const stub = mkdtempSync(join(tmpdir(), 'nodate-bin-'))
    writeFileSync(join(stub, 'date'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const r = await new Promise<{ status: number }>((resolve) => {
      const p = spawn('bash', [join(root, 'scripts', 'agent-msg.sh'), 'friday', 'marveen', 'MERVE: __STAMP__'], {
        env: { ...process.env, MARVEEN_WEB_PORT: String(port), PATH: `${stub}:${process.env.PATH}` },
      })
      p.on('close', (code) => resolve({ status: code ?? -1 }))
    })
    expect(r.status).not.toBe(0)
    expect(bodies, 'a kuldesnek EL SEM KELLETT VOLNA INDULNIA').toHaveLength(0)
  })

  // Card 3caaaf62. The footnote is read by the RECIPIENT, so a bare `sor: 0` reads
  // as "nothing is waiting for me" -- while the number is the recipient's depth
  // BEFORE this message was added, so the one message they are holding is not in
  // it. Measured on marveen's own misreading: it produced a correct conclusion
  // with a false reason, which is the kind that travels because nothing catches it.
  it('names WHOSE queue and WHEN -- not just a number', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('label', { to: 'marveen', count: 2 }), port, ['friday', 'marveen', 'torzs'])
    expect(r.status).toBe(0)
    const stamp = /\[KULDVE:[^\]]*\]/.exec(bodies[0].content)![0]
    // Both halves, because either alone still misleads: a number without an owner,
    // or an owner without the timing (this message is not counted in it).
    expect(stamp).toContain('cimzett sora')
    expect(stamp).toContain('kuldes elott')
    // And the bare form must be gone -- this is what a later "tidy up" restores.
    expect(stamp).not.toMatch(/\| sor: /)
  })

  // A FILENAME IS NOT A MESSAGE (measured 2026-09-03). This helper takes CONTENT
  // in argument 3; the file form is `- < "$f"`. Passing a path there made the
  // helper answer `OK id=` for successfully delivering the WRONG thing -- the
  // recipient got a path, the text reached nobody, and the sender believed it
  // was sent. Eleven times in 9740 messages, six of them in one afternoon.
  // Precision measured, not estimated: single word + starts with / + the file
  // EXISTS matched 11 of 9740, and all 11 were the mistake. Existence is the
  // load-bearing term -- a message merely MENTIONING a path that does not exist
  // could not have been sent with `- < "$f"` and must pass.
  it('refuses a bare EXISTING file path as the message body', async () => {
    const { port } = await fakeDashboard()
    const tmp = join(tmpdir(), `am-guard-${Date.now()}`)
    writeFileSync(tmp, 'the real message\n')
    try {
      const r = await send(installRoot('pathguard', { to: 'marveen', count: 0 }), port, ['friday', 'marveen', tmp])
      // 3, not 2: exit 2 is already the queue-depth refusal in this script, and a
      // caller reading the code needs to know WHICH -- wait, versus rewrite the call.
      expect(r.status).toBe(3)
      expect(r.stderr).toContain('NEM KULDTEM')
      // The refusal must name the working form, or it only says no.
      expect(r.stderr).toContain('- < ')
    } finally { rmSync(tmp, { force: true }) }
  })

  it('THE NEGATIVE CONTROL: the same file through the stdin branch still SENDS', async () => {
    // Named on the card as load-bearing, and it is: without it a gate that refused
    // EVERYTHING would look green here. The positive case proves the gate can say
    // no; only this proves it can still say yes -- and through the very route the
    // refusal tells people to use.
    const { port, bodies } = await fakeDashboard()
    const tmp = join(tmpdir(), `am-stdin-${Date.now()}`)
    const body = 'x'.repeat(600)
    writeFileSync(tmp, body + '\n')
    try {
      const r = await sendStdin(installRoot('stdinok', { to: 'marveen', count: 0 }), port, ['friday', 'marveen', '-'], tmp)
      expect(r.status).toBe(0)
      expect(bodies[0].content.length).toBeGreaterThan(500)
      expect(bodies[0].content).toContain(body)
    } finally { rmSync(tmp, { force: true }) }
  })

  it('lets a path that does NOT exist through -- that is a mention, not a mistake', async () => {
    const { port, bodies } = await fakeDashboard()
    const r = await send(installRoot('mention', { to: 'marveen', count: 0 }), port, ['friday', 'marveen', '/no/such/path/anywhere'])
    expect(r.status).toBe(0)
    expect(bodies[0].content).toContain('/no/such/path/anywhere')
  })
})
