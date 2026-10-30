import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card ab8b23d0 (c). Comment ids and message ids are both AUTOINCREMENT from 1, so a
// bare number resolves in BOTH spaces and each answer looks plausible (didi, 2026-09-19:
// 17 155 colliding ids). The two helpers now print a copyable reference that carries
// its space: `ref=uzenet:<id>` and `ref=komment:<id>@<card>`.

const mkTmp = tmpDirs()
const REPO = join(__dirname, '..', '..')
const servers: Server[] = []
afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()))
})

// postId: what the POST answers (null = no id field); echo: whether the read-back
// returns the posted body as the last comment (false = someone else's comment is last).
function fakeDashboard(opts: { postId?: number | null; echo?: boolean } = {}): Promise<number> {
  const postId = opts.postId === undefined ? 555 : opts.postId
  const echo = opts.echo ?? true
  let lastBody = ''
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        if (req.method === 'POST' && /\/comments$/.test(req.url ?? '')) {
          lastBody = JSON.parse(raw).content
          res.end(JSON.stringify(postId === null ? { card_id: 'c2ea2564' } : { id: postId, card_id: 'c2ea2564' }))
        } else if (req.method === 'GET' && /\/comments$/.test(req.url ?? '')) {
          res.end(JSON.stringify([{ id: 554, content: 'older' }, { id: 555, content: echo ? lastBody : 'idegen' }]))
        } else {
          res.end(JSON.stringify({ id: 17156, status: 'pending' }))
        }
      })
    })
    servers.push(server)
    // Every interface: on macOS localhost resolves to ::1 first.
    server.listen(0, () => {
      const a = server.address()
      resolve(typeof a === 'object' && a ? a.port : 0)
    })
  })
}

function root(): string {
  const r = mkTmp('helper-ref-')
  mkdirSync(join(r, 'scripts'), { recursive: true })
  mkdirSync(join(r, 'store'), { recursive: true })
  for (const f of ['agent-msg.sh', 'card-comment.sh']) copyFileSync(join(REPO, 'scripts', f), join(r, 'scripts', f))
  writeFileSync(join(r, 'store', '.dashboard-token'), 'test-token\n')
  writeFileSync(join(r, 'body.txt'), 'egy komment\n')
  return r
}

// Async: spawnSync would block the in-process fake dashboard.
function run(r: string, port: number, args: string[], input = ''): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', args, {
      cwd: r,
      env: {
        ...process.env,
        MARVEEN_WEB_PORT: String(port),
        MARVEEN_API_BASE: `http://localhost:${port}`,
        MARVEEN_TOKEN_FILE: join(r, 'store', '.dashboard-token'),
      },
    })
    // agent-msg.sh takes its body on STDIN only (card 16d66942); card-comment.sh ignores it
    p.stdin.end(input)
    let stdout = ''
    p.stdout.on('data', (c) => (stdout += c))
    p.on('close', (code) => resolve({ status: code ?? -1, stdout }))
  })
}

describe('helper output names the id space (ab8b23d0)', () => {
  it('agent-msg.sh: the OK id= contract stays first, the ref carries the message space', async () => {
    const port = await fakeDashboard()
    const r = root()
    const out = await run(r, port, [join(r, 'scripts', 'agent-msg.sh'), 'friday', 'marveen', '-'], 'torzs\n')
    expect(out.status).toBe(0)
    const line = out.stdout.split('\n').find((l) => l.startsWith('OK id='))
    expect(line).toMatch(/^OK id=17156\b/)
    expect(line).toMatch(/ ref=uzenet:17156$/)
  })

  it('card-comment.sh: prints the comment id (not only the count) with its space and card', async () => {
    const port = await fakeDashboard()
    const r = root()
    const out = await run(r, port, [join(r, 'scripts', 'card-comment.sh'), 'friday', 'c2ea2564', join(r, 'body.txt')])
    expect(out.status).toBe(0)
    expect(out.stdout).toMatch(/^OK kartya=c2ea2564 komment=2 id=555 ref=komment:555@c2ea2564 stamp=/m)
  })

  it('card-comment.sh: no id in the POST answer -> the read-back id, but only when the content matched', async () => {
    const port = await fakeDashboard({ postId: null })
    const r = root()
    const out = await run(r, port, [join(r, 'scripts', 'card-comment.sh'), 'friday', 'c2ea2564', join(r, 'body.txt')])
    expect(out.status).toBe(0)
    expect(out.stdout).toMatch(/^OK kartya=c2ea2564 komment=2 id=555 ref=komment:555@c2ea2564 stamp=/m)
  })

  it('card-comment.sh: no id in the POST answer and a foreign last comment -> no ref at all, not a wrong one', async () => {
    const port = await fakeDashboard({ postId: null, echo: false })
    const r = root()
    const out = await run(r, port, [join(r, 'scripts', 'card-comment.sh'), 'friday', 'c2ea2564', join(r, 'body.txt')])
    expect(out.status).toBe(1)
    expect(out.stdout).toMatch(/^GYANUS kartya=c2ea2564 komment=2 stamp=/m)
    expect(out.stdout).not.toMatch(/ref=komment/)
  })
})
