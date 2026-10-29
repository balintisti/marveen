// Card 1befbdb3 (DEVKEYFOLLOW1022 applied by hand, upstream #2175 does not touch it):
// creating an agent invite is credential issuance (the token lets an unknown sender
// pair itself into the agent's allowlist). Once a dashboard login exists it takes the
// owner's session; the bearer token keeps it for the first-run setup only.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'

const inviteSpy = vi.hoisted(() => vi.fn((_accessPath: string, _bot: string | undefined, _provider: string) => ({ token: 'tok123', expiresAt: 1 })))
vi.mock('../web/channel-invites.js', async (orig) => ({ ...(await orig<typeof import('../web/channel-invites.js')>()), createInvite: inviteSpy }))

import { initDatabase, getDb, getDashboardUser } from '../db.js'
import { MAIN_AGENT_ID, PROJECT_ROOT } from '../config.js'
import { tryHandleAgents } from '../web/routes/agents.js'
import { tryHandleAuth } from '../web/routes/auth.js'
import { _clearSessionCacheForTest, createSession } from '../web/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../web/auth-gate.js'
import type { RouteContext } from '../web/routes/types.js'

const TOKEN_AUTH: RouteContext['auth'] = { kind: 'token' }
const SESSION_AUTH: RouteContext['auth'] = { kind: 'session', user: 'owner' }
const DEVICE_AUTH: RouteContext['auth'] = { kind: 'device', device: 'phone', deviceId: 1 }

async function call(handler: (ctx: RouteContext) => Promise<boolean>, method: string, path: string, auth: RouteContext['auth'], body?: unknown, headers: Record<string, string> = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage
  req.headers = headers
  const out = { status: 0, body: '' }
  const res = { writeHead(s: number) { out.status = s; return res }, setHeader() {}, end(d?: string) { if (d !== undefined) out.body += d } }
  const url = new URL(`http://127.0.0.1:3420${path}`)
  expect(await handler({ req, res: res as unknown as http.ServerResponse, path: url.pathname, method, url, auth, fedPeer: null })).toBe(true)
  return { status: out.status || 200, json: () => JSON.parse(out.body || '{}') as Record<string, unknown> }
}
const invite = (auth: RouteContext['auth'], headers: Record<string, string> = {}) =>
  call((ctx) => tryHandleAgents(ctx, join(PROJECT_ROOT, 'web')), 'POST', `/api/agents/${MAIN_AGENT_ID}/channels/slack/invites`, auth, undefined, headers)
const addOwner = () => call(tryHandleAuth, 'POST', '/api/auth/users', TOKEN_AUTH, { username: 'owner', password: 'super-secret-pw' })

beforeAll(() => { process.env.NODE_ENV = 'test'; initDatabase(':memory:') })
beforeEach(() => {
  getDb().exec('DELETE FROM auth_sessions; DELETE FROM dashboard_users')
  _clearSessionCacheForTest()
  inviteSpy.mockClear()
})

describe('POST /api/agents/:name/channels/:provider/invites', () => {
  it('first-run setup (no dashboard user yet): the token still creates an invite', async () => {
    const r = await invite(TOKEN_AUTH)
    expect(r.status).toBe(200)
    expect(r.json().token).toBe('tok123')
    expect(inviteSpy).toHaveBeenCalledTimes(1)
  })

  it('once a login exists the token is refused 403 owner_session_required and nothing is created', async () => {
    expect((await addOwner()).status).toBe(201)
    const r = await invite(TOKEN_AUTH)
    expect(r.status).toBe(403)
    expect(r.json().code).toBe('owner_session_required')
    expect(r.json()).not.toHaveProperty('token')
    expect((await invite(DEVICE_AUTH)).status).toBe(403)
    expect(inviteSpy).not.toHaveBeenCalled()
  })

  it('the owner session creates it (positive control), also the token with the owner\'s live session cookie', async () => {
    expect((await addOwner()).status).toBe(201)
    expect((await invite(SESSION_AUTH)).status).toBe(200)
    const u = getDashboardUser('owner')!
    const cookie = `${SESSION_COOKIE_NAME}=${createSession({ userId: u.id, username: u.username })}`
    expect((await invite(TOKEN_AUTH, { cookie })).status).toBe(200)
    expect((await invite(TOKEN_AUTH, { cookie: `${SESSION_COOKIE_NAME}=forged` })).status).toBe(403)
    expect(inviteSpy).toHaveBeenCalledTimes(2)
  })
})
