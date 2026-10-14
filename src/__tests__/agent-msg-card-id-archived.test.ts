import { describe, it, expect, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card 9ec6b45a. The outgoing card-ID check measured ids against the LIVE list only,
// so an ARCHIVED card -- the larger population (1347 archived vs 1050 live, 2026-09-19)
// and the usual reason to name a card at all -- was reported as missing, and the
// warning itself said "if archived, ignore this". Now the ids the live list does not
// know are decided one by one by GET /api/kanban/<id>: 200 exists, 404 missing,
// anything else is said to be unverified.

const mkTmp = tmpDirs()
const REPO = join(__dirname, '..', '..')
const servers: Server[] = []
afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()))
})

const LIVE = ['aaaaaaaa']
const DIRECT: Record<string, number> = { bbbbbbbb: 200, cccccccc: 404, dddddddd: 500 }

function fakeDashboard(): Promise<{ port: number; posts: number[]; direct: string[] }> {
  const posts: number[] = []
  const direct: string[] = []
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = ''
      req.on('data', (c) => (raw += c))
      req.on('end', () => {
        const url = new URL(req.url ?? '/', 'http://x')
        const one = url.pathname.match(/^\/api\/kanban\/([0-9a-f]{8})$/)
        if (req.method === 'GET' && url.pathname === '/api/kanban') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(LIVE.map((id) => ({ id }))))
        } else if (req.method === 'GET' && one) {
          direct.push(one[1])
          const code = DIRECT[one[1]] ?? 404
          res.writeHead(code, { 'Content-Type': 'application/json' })
          res.end(code === 200 ? JSON.stringify({ id: one[1], archived_at: 1 }) : '{}')
        } else {
          if (req.method === 'POST') posts.push(raw.length)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: 4242, status: 'pending' }))
        }
      })
    })
    servers.push(server)
    server.listen(0, () => {
      const a = server.address()
      resolve({ port: typeof a === 'object' && a ? a.port : 0, posts, direct })
    })
  })
}

function installRoot(): string {
  const root = mkTmp('agentmsg-cardid-')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'store'), { recursive: true })
  copyFileSync(join(REPO, 'scripts', 'agent-msg.sh'), join(root, 'scripts', 'agent-msg.sh'))
  writeFileSync(join(root, 'store', '.dashboard-token'), 'test-token\n')
  return root
}

// Async on purpose: spawnSync would block the in-process fake dashboard.
function send(port: number, text: string): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn('bash', [join(installRoot(), 'scripts', 'agent-msg.sh'), 'friday', 'marveen', text], {
      env: { ...process.env, MARVEEN_WEB_PORT: String(port) },
    })
    let stdout = ''
    let stderr = ''
    p.stdout.on('data', (c) => (stdout += c))
    p.stderr.on('data', (c) => (stderr += c))
    p.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }))
  })
}

const warnings = (out: string) => out.split('\n').filter((l) => l.startsWith('NEM FELOLDHATO KARTYA-ID'))

describe('agent-msg.sh card-ID check -- archived cards (9ec6b45a)', () => {
  it('a card on the live list: no warning, and no per-id lookup', async () => {
    const d = await fakeDashboard()
    const r = await send(d.port, 'lasd kartya aaaaaaaa')
    expect(r.status).toBe(0)
    expect(warnings(r.stdout)).toEqual([])
    expect(d.direct).toEqual([])
  })

  it('an ARCHIVED card (direct GET 200) is not reported as missing', async () => {
    const d = await fakeDashboard()
    const r = await send(d.port, 'lasd kartya bbbbbbbb')
    expect(r.status).toBe(0)
    expect(warnings(r.stdout)).toEqual([])
    expect(d.direct).toEqual(['bbbbbbbb'])
    expect(d.posts).toHaveLength(1)
  })

  it('a card that does not exist (404) is named, and the old "ignore it" advice is gone', async () => {
    const d = await fakeDashboard()
    const r = await send(d.port, 'lasd kartya bbbbbbbb es kartya cccccccc')
    expect(r.status).toBe(0)
    const w = warnings(r.stdout)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('cccccccc')
    expect(w[0]).not.toContain('bbbbbbbb')
    expect(w[0]).toContain('archivalt sem')
    expect(r.stdout + r.stderr).not.toMatch(/hagyd figyelmen kivul/)
    expect(d.posts).toHaveLength(1)
  })

  it('an unanswerable lookup (500) says NOT VERIFIED, never "missing" and never silence', async () => {
    const d = await fakeDashboard()
    const r = await send(d.port, 'lasd kartya dddddddd')
    expect(r.status).toBe(0)
    const w = warnings(r.stdout)
    expect(w).toHaveLength(1)
    expect(w[0]).toContain('NEM FUTOTT LE')
    expect(w[0]).toContain('dddddddd (HTTP 500)')
    expect(w[0]).not.toContain('archivalt sem')
  })
})
