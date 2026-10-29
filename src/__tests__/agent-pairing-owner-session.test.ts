// Card 1befbdb3 (DEVKEYFOLLOW1022 applied by hand, upstream #2175 does not touch it):
// the routes around an agent's channel pairing take the owner's session once a dashboard
// login exists, like POST .../invites (agent-invite-owner-session.test.ts):
//   GET  .../invites  returns the live invite tokens (sidesteps the POST gate),
//   GET  .../pending  returns the live pairing codes,
//   POST .../approve  turns a pairing code into an allowlist entry.
// The bearer token keeps them for the first-run setup (no dashboard user yet) only.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import type http from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { initDatabase, getDb, getDashboardUser } from '../db.js'
import { MAIN_AGENT_ID, PROJECT_ROOT } from '../config.js'
import { tryHandleAgents } from '../web/routes/agents.js'
import { tryHandleAuth } from '../web/routes/auth.js'
import { createInvite } from '../web/channel-invites.js'
import { _clearSessionCacheForTest, createSession } from '../web/auth-sessions.js'
import { SESSION_COOKIE_NAME } from '../web/auth-gate.js'
import type { RouteContext } from '../web/routes/types.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const STATE = mkTmp('pairing-owner-session-')
const ACCESS = join(STATE, 'access.json')
const CODE = 'abc123'
const SENDER = '777000111'
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
  return { status: out.status || 200, text: out.body, json: () => JSON.parse(out.body || '{}') as any }
}
const agents = (method: string, suffix: string, auth: RouteContext['auth'], body?: unknown, headers: Record<string, string> = {}) =>
  call((ctx) => tryHandleAgents(ctx, join(PROJECT_ROOT, 'web')), method, `/api/agents/${MAIN_AGENT_ID}/channels/slack/${suffix}`, auth, body, headers)
const addOwner = () => call(tryHandleAuth, 'POST', '/api/auth/users', TOKEN_AUTH, { username: 'owner', password: 'super-secret-pw' })
const ownerCookie = () => {
  const u = getDashboardUser('owner')!
  return `${SESSION_COOKIE_NAME}=${createSession({ userId: u.id, username: u.username })}`
}
const allowFrom = (): string[] => JSON.parse(readFileSync(ACCESS, 'utf8')).allowFrom ?? []

let inviteToken = ''
beforeAll(() => {
  process.env.NODE_ENV = 'test'
  // The main agent's Slack state dir, pinned to a temp dir (channelStateDir honours it first).
  process.env.SLACK_STATE_DIR = STATE
  initDatabase(':memory:')
})
beforeEach(() => {
  getDb().exec('DELETE FROM auth_sessions; DELETE FROM dashboard_users')
  _clearSessionCacheForTest()
  rmSync(STATE, { recursive: true, force: true })
  mkdirSync(STATE, { recursive: true })
  writeFileSync(ACCESS, JSON.stringify({ dmPolicy: 'pairing', allowFrom: [], pending: { [CODE]: { senderId: SENDER, chatId: SENDER, createdAt: 1, expiresAt: Date.now() + 3_600_000 } } }))
  inviteToken = createInvite(ACCESS, undefined, 'slack').token
})

describe('GET .../invites (live invite tokens)', () => {
  it('first-run setup (no dashboard user yet): the token lists them', async () => {
    const r = await agents('GET', 'invites', TOKEN_AUTH)
    expect(r.status).toBe(200)
    expect(r.json().map((i: any) => i.token)).toContain(inviteToken)
  })

  it('once a login exists the token and a device key are refused 403 owner_session_required, no token in the body', async () => {
    expect((await addOwner()).status).toBe(201)
    for (const auth of [TOKEN_AUTH, DEVICE_AUTH]) {
      const r = await agents('GET', 'invites', auth)
      expect(r.status).toBe(403)
      expect(r.json().code).toBe('owner_session_required')
      expect(r.text).not.toContain(inviteToken)
    }
  })

  it('the owner session lists them (positive control), also the token with the owner\'s live session cookie', async () => {
    expect((await addOwner()).status).toBe(201)
    const viaSession = await agents('GET', 'invites', SESSION_AUTH)
    expect(viaSession.status).toBe(200)
    expect(viaSession.json().map((i: any) => i.token)).toContain(inviteToken)
    expect((await agents('GET', 'invites', TOKEN_AUTH, undefined, { cookie: ownerCookie() })).status).toBe(200)
    expect((await agents('GET', 'invites', TOKEN_AUTH, undefined, { cookie: `${SESSION_COOKIE_NAME}=forged` })).status).toBe(403)
  })
})

describe('GET .../pending (live pairing codes)', () => {
  it('first-run setup: the token lists the pending code', async () => {
    const r = await agents('GET', 'pending', TOKEN_AUTH)
    expect(r.status).toBe(200)
    expect(r.json().map((p: any) => p.code)).toEqual([CODE])
  })

  it('once a login exists the token and a device key are refused 403, no code in the body', async () => {
    expect((await addOwner()).status).toBe(201)
    for (const auth of [TOKEN_AUTH, DEVICE_AUTH]) {
      const r = await agents('GET', 'pending', auth)
      expect(r.status).toBe(403)
      expect(r.json().code).toBe('owner_session_required')
      expect(r.text).not.toContain(CODE)
    }
  })

  it('the owner session lists it (positive control), also the token with the owner\'s live session cookie', async () => {
    expect((await addOwner()).status).toBe(201)
    expect((await agents('GET', 'pending', SESSION_AUTH)).json().map((p: any) => p.code)).toEqual([CODE])
    expect((await agents('GET', 'pending', TOKEN_AUTH, undefined, { cookie: ownerCookie() })).status).toBe(200)
    expect((await agents('GET', 'pending', TOKEN_AUTH, undefined, { cookie: `${SESSION_COOKIE_NAME}=forged` })).status).toBe(403)
  })
})

describe('POST .../approve (pairing code -> allowlist)', () => {
  it('first-run setup: the token approves the code and the sender lands on the allowlist', async () => {
    const r = await agents('POST', 'approve', TOKEN_AUTH, { code: CODE })
    expect(r.status).toBe(200)
    expect(allowFrom()).toEqual([SENDER])
  })

  it('once a login exists the token and a device key are refused 403 and the allowlist stays empty', async () => {
    expect((await addOwner()).status).toBe(201)
    for (const auth of [TOKEN_AUTH, DEVICE_AUTH]) {
      const r = await agents('POST', 'approve', auth, { code: CODE })
      expect(r.status).toBe(403)
      expect(r.json().code).toBe('owner_session_required')
    }
    expect(allowFrom()).toEqual([])
    expect(JSON.parse(readFileSync(ACCESS, 'utf8')).pending).toHaveProperty(CODE)
    expect(existsSync(join(STATE, 'approved', SENDER))).toBe(false)
  })

  it('the owner session approves it (positive control); a token with a forged cookie does not', async () => {
    expect((await addOwner()).status).toBe(201)
    expect((await agents('POST', 'approve', TOKEN_AUTH, { code: CODE }, { cookie: `${SESSION_COOKIE_NAME}=forged` })).status).toBe(403)
    expect(allowFrom()).toEqual([])
    expect((await agents('POST', 'approve', SESSION_AUTH, { code: CODE })).status).toBe(200)
    expect(allowFrom()).toEqual([SENDER])
    expect(existsSync(join(STATE, 'approved', SENDER))).toBe(true)
  })
})
