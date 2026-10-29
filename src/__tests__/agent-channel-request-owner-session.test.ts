// Card 1befbdb3 (DEVKEYFOLLOW1022 applied by hand, upstream #2175 does not touch it):
// POST /api/agents/:name/channel-requests/:id/approve writes the channel (and the user
// allowed in it) into access.json, so like the pairing approve (agent-pairing-owner-session
// .test.ts) it takes the owner's session once a dashboard login exists; the bearer token
// keeps it for the first-run setup only. GET channel-requests (ids only) and /deny stay open.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs'

vi.mock('../web/agent-config.js', async (orig) => ({
  ...(await orig<typeof import('../web/agent-config.js')>()),
  readAgentChannelProvider: () => 'slack',
}))

import { initDatabase, getDb, getDashboardUser, upsertChannelRequest, listPendingChannelRequests } from '../db.js'
import { MAIN_AGENT_ID, PROJECT_ROOT } from '../config.js'
import { tryHandleAgents } from '../web/routes/agents.js'
import { tryHandleAuth } from '../web/routes/auth.js'
import { _clearSessionCacheForTest, createSession } from '../web/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../web/auth-gate.js'
import type { RouteContext } from '../web/routes/types.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const STATE = mkTmp('channel-request-owner-session-')
const ACCESS = join(STATE, 'access.json')
const CHANNEL = 'C0TESTCHAN'
const USER = 'U0TESTUSER'
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
  return { status: out.status || 200, json: () => JSON.parse(out.body || '{}') as any }
}
const agents = (method: string, suffix: string, auth: RouteContext['auth'], body?: unknown, headers: Record<string, string> = {}) =>
  call((ctx) => tryHandleAgents(ctx, join(PROJECT_ROOT, 'web')), method, `/api/agents/${MAIN_AGENT_ID}/channel-requests${suffix}`, auth, body, headers)
const addOwner = () => call(tryHandleAuth, 'POST', '/api/auth/users', TOKEN_AUTH, { username: 'owner', password: 'super-secret-pw' })
const ownerCookie = () => {
  const u = getDashboardUser('owner')!
  return `${SESSION_COOKIE_NAME}=${createSession({ userId: u.id, username: u.username })}`
}
const channels = (): Record<string, unknown> => (existsSync(ACCESS) ? JSON.parse(readFileSync(ACCESS, 'utf8')).channels ?? {} : {})

let reqId = 0
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  process.env.SLACK_STATE_DIR = STATE
  initDatabase(':memory:')
})
beforeEach(() => {
  getDb().exec('DELETE FROM auth_sessions; DELETE FROM dashboard_users; DELETE FROM pending_channel_requests')
  _clearSessionCacheForTest()
  rmSync(STATE, { recursive: true, force: true })
  mkdirSync(STATE, { recursive: true })
  upsertChannelRequest(MAIN_AGENT_ID, CHANNEL, USER)
  reqId = listPendingChannelRequests(MAIN_AGENT_ID)[0].id
})

describe('POST /api/agents/:name/channel-requests/:id/approve', () => {
  it('first-run setup (no dashboard user yet): the token approves and the channel lands in access.json', async () => {
    const r = await agents('POST', `/${reqId}/approve`, TOKEN_AUTH, {})
    expect(r.status).toBe(200)
    expect(channels()).toEqual({ [CHANNEL]: { requireMention: true, allowFrom: [USER] } })
  })

  it('once a login exists the token and a device key are refused 403 owner_session_required, nothing is written, the request stays pending', async () => {
    expect((await addOwner()).status).toBe(201)
    for (const auth of [TOKEN_AUTH, DEVICE_AUTH]) {
      const r = await agents('POST', `/${reqId}/approve`, auth, {})
      expect(r.status).toBe(403)
      expect(r.json().code).toBe('owner_session_required')
    }
    expect(existsSync(ACCESS)).toBe(false)
    expect(listPendingChannelRequests(MAIN_AGENT_ID).map((p) => p.id)).toEqual([reqId])
  })

  it('the owner session approves (positive control), also the token with the owner\'s live session cookie; a forged cookie does not', async () => {
    expect((await addOwner()).status).toBe(201)
    expect((await agents('POST', `/${reqId}/approve`, TOKEN_AUTH, {}, { cookie: `${SESSION_COOKIE_NAME}=forged` })).status).toBe(403)
    expect(existsSync(ACCESS)).toBe(false)
    expect((await agents('POST', `/${reqId}/approve`, TOKEN_AUTH, {}, { cookie: ownerCookie() })).status).toBe(200)
    expect(Object.keys(channels())).toEqual([CHANNEL])
    upsertChannelRequest(MAIN_AGENT_ID, 'C0SECOND', USER)
    const second = listPendingChannelRequests(MAIN_AGENT_ID)[0].id
    expect((await agents('POST', `/${second}/approve`, SESSION_AUTH, {})).status).toBe(200)
    expect(Object.keys(channels()).sort()).toEqual(['C0SECOND', CHANNEL])
  })
})

describe('the rest of the channel-request routes stay open after a login', () => {
  it('GET list (ids only, no credential) and POST deny still work with the token', async () => {
    expect((await addOwner()).status).toBe(201)
    const list = await agents('GET', '', TOKEN_AUTH)
    expect(list.status).toBe(200)
    expect(list.json().map((p: any) => p.id)).toEqual([reqId])
    expect((await agents('POST', `/${reqId}/deny`, TOKEN_AUTH, {})).status).toBe(200)
    expect(listPendingChannelRequests(MAIN_AGENT_ID)).toEqual([])
  })
})
