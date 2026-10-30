// Card 664a0f5d (upstream 89cc2f33d): approving is the owner's decision. Before this, PATCH
// status=approved accepted the shared dashboard token, which every agent holds, so any agent could
// approve any request (its own too, under a made-up resolved_by). PATCH status=approved now goes
// through mayIssueCredentials: the owner's session, also when the browser sends the stored token
// alongside it; the bare token only before the first dashboard login exists. Reject and timeout
// stay open to the token: with them an agent can only cancel a request, never gain a right.
import { describe, it, expect, vi, afterAll, beforeAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

vi.mock('../config.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../config.js')>()), MAIN_AGENT_ID: 'marveen', TELEGRAM_BOT_TOKEN: '' }))
vi.mock('../web/telegram.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../web/telegram.js')>()), sendTelegramMessage: vi.fn(async () => 4242) }))

import { initDatabase, createApproval, getApproval, createDashboardUser } from '../db.js'
import { tryHandleApprovals } from '../web/routes/approvals.js'
import { createSession, _clearSessionCacheForTest } from '../web/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../web/auth-gate.js'

const td = mkdtempSync(join(tmpdir(), 'approvals-owner-only-'))
afterAll(() => rmSync(td, { recursive: true, force: true }))
const store = join(td, 'store'); mkdirSync(store, { recursive: true })
initDatabase(join(store, 'claudeclaw.db'))

type Auth = { kind: 'token' | 'session' | 'device'; agent?: string; user?: string; scope?: 'full' | 'operator' }
const TOKEN: Auth = { kind: 'token', agent: 'soma' }
const OWNER: Auth = { kind: 'session', user: 'owner' }

function pending(): string {
  const id = randomUUID()
  createApproval({ id, agent_id: 'soma', category: 'email_send', action_description: 'x' })
  return id
}

async function patch(id: string, body: unknown, auth: Auth, headers: Record<string, string> = {}) {
  const out: { status: number; body: any } = { status: 0, body: null }
  const res: any = { writeHead(s: number) { out.status = s; return res }, setHeader() {}, end(c?: string) { if (c) out.body = JSON.parse(c) } }
  const str = JSON.stringify(body)
  const req: any = { headers, on(ev: string, cb: (c?: Buffer) => void) { if (ev === 'data') cb(Buffer.from(str)); if (ev === 'end') cb() } }
  const url = new URL(`http://localhost/api/approvals/${id}`)
  expect(await tryHandleApprovals({ req, res, path: url.pathname, method: 'PATCH', url, auth } as any)).toBe(true)
  return out
}

describe('first run (no dashboard login yet)', () => {
  it('the bare token still approves: it is the one credential there is', async () => {
    const id = pending()
    const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, TOKEN)
    expect(r.status).toBe(200)
    expect(getApproval(id)?.status).toBe('approved')
  })
})

describe('a dashboard login exists (the normal state)', () => {
  let cookie = ''
  beforeAll(() => {
    const u = createDashboardUser('owner', 'x'.repeat(60))
    cookie = `${SESSION_COOKIE_NAME}=${createSession({ userId: u.id, username: 'owner' })}`
  })

  it('the shared token cannot approve: 403 owner_session_required, the row stays pending', async () => {
    const id = pending()
    const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, TOKEN)
    expect(r.status).toBe(403)
    expect(r.body.code).toBe('owner_session_required')
    expect(getApproval(id)?.status).toBe('pending')
  })

  it('POSITIVE CONTROL: the owner session approves', async () => {
    const id = pending()
    const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, OWNER)
    expect(r.status).toBe(200)
    expect(getApproval(id)?.status).toBe('approved')
  })

  it('a browser that sends the stored token AND a live session cookie approves (no 403 for the owner)', async () => {
    const id = pending()
    const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, TOKEN, { cookie })
    expect(r.status).toBe(200)
    expect(getApproval(id)?.status).toBe('approved')
  })

  it('the token with a forged session cookie is 403', async () => {
    _clearSessionCacheForTest()
    const id = pending()
    const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, TOKEN, { cookie: `${SESSION_COOKIE_NAME}=not-a-session` })
    expect(r.status).toBe(403)
    expect(getApproval(id)?.status).toBe('pending')
  })

  it('a device key of either scope cannot approve', async () => {
    for (const scope of ['full', 'operator'] as const) {
      const id = pending()
      const r = await patch(id, { status: 'approved', resolved_by: 'dashboard' }, { kind: 'device', scope })
      expect(r.status).toBe(403)
      expect(getApproval(id)?.status).toBe('pending')
    }
  })

  it('the token can still reject and time out a request', async () => {
    for (const status of ['rejected', 'timeout'] as const) {
      const id = pending()
      const r = await patch(id, { status, resolved_by: 'marveen' }, TOKEN)
      expect(r.status).toBe(200)
      expect(getApproval(id)?.status).toBe(status)
    }
  })
})
