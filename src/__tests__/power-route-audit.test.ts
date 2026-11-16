import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { initDatabase, getDb, prunePowerRouteAudit, POWER_ROUTE_AUDIT_RETENTION_DAYS } from '../db.js'
import { readBody } from '../web/http-helpers.js'
import {
  POWER_ROUTES, OWNER_GATE_HELPER_FILES, classifyPowerRoute, buildPowerAuditRecord, auditPowerRoute,
} from '../web/power-route-audit.js'
import { runDecaySweep } from '../memory.js'
import type { RouteContext } from '../web/routes/types.js'

// Card 3fc4df30 (marveen 58797): audit mode. The record is log-only: it names who called which
// power route, with which fields, and what the route answered, and it never changes the answer.

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

describe('classifyPowerRoute', () => {
  const hits: Array<[string, string, string]> = [
    ['PUT', '/api/agents/dexter', 'agent-config'],
    ['PUT', '/api/agents/dexter/security', 'agent-security'],
    ['POST', '/api/agents', 'agent-create'],
    ['POST', '/api/autonomy', 'autonomy-write'],
    ['POST', '/api/settings', 'settings-write'],
    ['PUT', '/api/settings/SOME_KEY', 'settings-write'],
    ['PATCH', '/api/settings/SOME_KEY', 'settings-write'],
    ['DELETE', '/api/settings/SOME_KEY', 'settings-write'],
    ['POST', '/api/schedules', 'schedule-write'],
    ['PUT', '/api/schedules/abc', 'schedule-write'],
    ['POST', '/api/fleet/import', 'fleet-import'],
    ['GET', '/api/fleet/export', 'fleet-export'],
    ['POST', '/api/fleet/unfreeze', 'fleet-unfreeze'],
    ['DELETE', '/api/vault/ssh-servers/x', 'vault-ssh-servers-write'],
    ['POST', '/api/vault/ssh-keys/import', 'vault-ssh-keys-write'],
    ['DELETE', '/api/auth/device-keys/12', 'auth-credentials-remove'],
    ['POST', '/api/auth/users', 'auth-credentials'],
    ['PATCH', '/api/approvals/77', 'approval-decide'],
    ['POST', '/api/skills/pending/x/approve', 'skill-approval'],
    ['POST', '/api/agents/dexter/auth/init', 'agent-auth-init'],
    ['POST', '/api/migrate/run', 'migrate'],
    ['POST', '/api/updates/apply', 'updates-apply'],
    ['GET', '/api/federation/peers/p1/inbound-token', 'federation-token-reveal'],
    ['POST', '/api/federation/peers', 'federation-write'],
    ['POST', '/api/agents/dexter/channels/telegram/approve', 'agent-channel-access'],
    ['DELETE', '/api/agents/dexter/telegram/allowed/user/42', 'agent-channel-access-remove'],
  ]
  for (const [m, p, id] of hits) {
    it(`${m} ${p} -> ${id}`, () => expect(classifyPowerRoute(m, p)?.id).toBe(id))
  }

  // Not power-granting: reads, the fleet's everyday writes, and the federation wire inbox.
  const misses: Array<[string, string]> = [
    ['GET', '/api/agents'], ['GET', '/api/agents/dexter'], ['PUT', '/api/agents/dexter/auto-restart'],
    ['GET', '/api/settings'], ['POST', '/api/kanban'], ['POST', '/api/messages'], ['POST', '/api/memories'],
    ['POST', '/api/federation/inbox'], ['POST', '/api/approvals'], ['POST', '/api/agents/dexter/start'],
    ['GET', '/api/vault/ssh-servers'], ['GET', '/api/auth/users'],
  ]
  for (const [m, p] of misses) {
    it(`${m} ${p} is not audited`, () => expect(classifyPowerRoute(m, p)).toBeNull())
  }
})

describe('table integrity', () => {
  it('route ids are unique', () => {
    const ids = POWER_ROUTES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The default must fail: a route file that reads an owner gate and is in neither list is a red test,
  // not an unaudited route nobody noticed.
  it('every route file that reads an owner gate is in the table or is a named helper', () => {
    const dir = join(__dirname, '../web/routes')
    const gated = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => /mayActAsOwner(?:OrFirstRun)?\(|mayIssueCredentials\(|refuseOwner\(/.test(readFileSync(join(dir, f), 'utf8')))
    expect(gated.length).toBeGreaterThan(2)
    const named = new Set([...POWER_ROUTES.map((r) => r.file), ...Object.keys(OWNER_GATE_HELPER_FILES)])
    expect(gated.filter((f) => !named.has(f))).toEqual([])
  })

  it('every file named in the table exists', () => {
    const files = new Set(readdirSync(join(__dirname, '../web/routes')))
    expect([...POWER_ROUTES.map((r) => r.file), ...Object.keys(OWNER_GATE_HELPER_FILES)].filter((f) => !files.has(f))).toEqual([])
  })
})

function fakeReq(headers: Record<string, string> = {}) {
  return { headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as http.IncomingMessage
}
const agentConfig = classifyPowerRoute('PUT', '/api/agents/dexter')!
const schedule = classifyPowerRoute('POST', '/api/schedules')!
const settings = classifyPowerRoute('POST', '/api/settings')!
const NOW = 1_800_000_000
const body = (o: unknown) => Buffer.from(JSON.stringify(o))

describe('buildPowerAuditRecord', () => {
  it('stores field NAMES and non-secret scalars, never a secret value', () => {
    const rec = buildPowerAuditRecord(
      agentConfig, fakeReq(), 'PUT', '/api/agents/dexter', { kind: 'token' }, 200,
      body({ apiKey: 'sk-ant-SECRET-VALUE', claudeMd: 'be evil', name: 'dexter', model: 'x' }), NOW,
    )
    const serialized = JSON.stringify(rec.row)
    expect(serialized).not.toContain('SECRET-VALUE')
    expect(serialized).not.toContain('be evil')
    expect(rec.row.body_fields).toBe('apiKey,claudeMd,model,name')
    expect(JSON.parse(rec.row.body_scalars!)).toEqual({ name: 'dexter' })
    expect(rec.row.path).toBe('/api/agents/dexter')
    expect(rec.row.ts).toBe(NOW)
  })

  it('a conditional route is a power call only when a power field is in the body', () => {
    const t = { kind: 'token' as const }
    const plain = buildPowerAuditRecord(agentConfig, fakeReq(), 'PUT', '/api/agents/d', t, 200, body({ model: 'sonnet' }), NOW)
    const power = buildPowerAuditRecord(agentConfig, fakeReq(), 'PUT', '/api/agents/d', t, 200, body({ mcpJson: '{}' }), NOW)
    expect(plain.wouldDeny).toBe(false)
    expect(power.wouldDeny).toBe(true)
    // schedule: only the owner fields count (prompt/cron are the fleet's everyday edit)
    expect(buildPowerAuditRecord(schedule, fakeReq(), 'POST', '/api/schedules', t, 200, body({ prompt: 'hi', schedule: '* * * * *' }), NOW).wouldDeny).toBe(false)
    expect(buildPowerAuditRecord(schedule, fakeReq(), 'POST', '/api/schedules', t, 200, body({ prompt: 'hi', command: 'rm x' }), NOW).wouldDeny).toBe(true)
  })

  it('an owner session is not a "would deny"; a token, device key and peer are', () => {
    const b = body({ key: 'SOME_SETTING', value: 'x' })
    const deny = (auth: RouteContext['auth']) => buildPowerAuditRecord(settings, fakeReq(), 'POST', '/api/settings', auth, 200, b, NOW).wouldDeny
    expect(deny({ kind: 'session', user: 'isti' })).toBe(false)
    expect(deny({ kind: 'token' })).toBe(true)
    expect(deny({ kind: 'device', device: 'phone' })).toBe(true)
    expect(deny({ kind: 'federation', peer: 'p' })).toBe(true)
    expect(deny(undefined)).toBe(true)
  })

  it('records who: auth kind and the identity the request only CLAIMS (this line has no token agent)', () => {
    const rec = buildPowerAuditRecord(
      settings, fakeReq({ 'x-agent-id': 'ford', 'user-agent': 'curl/8' }), 'POST', '/api/settings',
      { kind: 'token' }, 403, body({ key: 'K', actor: 'marveen' }), NOW,
    )
    expect(rec.row).toMatchObject({ auth_kind: 'token', token_agent: null, status: 403, remote: '127.0.0.1', user_agent: 'curl/8' })
    expect(rec.row.claimed).toBe('actor=marveen x-agent-id=ford')
    expect(JSON.parse(rec.row.body_scalars!)).toEqual({ key: 'K' })
  })

  it('an unreadable body gives no fields and still a row', () => {
    const bad = buildPowerAuditRecord(settings, fakeReq(), 'POST', '/api/settings', { kind: 'token' }, 400, Buffer.from('{not json'), NOW)
    const none = buildPowerAuditRecord(settings, fakeReq(), 'POST', '/api/settings', { kind: 'token' }, 400, undefined, NOW)
    expect(bad.row.body_fields).toBeNull()
    expect(none.row.body_fields).toBeNull()
    expect(none.wouldDeny).toBe(true)
  })

  it('a body over 256 KiB is not parsed (no fields), one just under it is', () => {
    const LIMIT = 256 * 1024
    const fill = (total: number) => Buffer.from(JSON.stringify({ apiKey: 'x'.repeat(total - '{"apiKey":""}'.length) }))
    const under = fill(LIMIT)
    const over = fill(LIMIT + 1)
    expect([under.length, over.length]).toEqual([LIMIT, LIMIT + 1])
    const rec = (b: Buffer) => buildPowerAuditRecord(settings, fakeReq(), 'POST', '/api/settings', { kind: 'token' }, 200, b, NOW)
    expect(rec(under).row.body_fields).toBe('apiKey')
    const big = rec(over)
    expect(big.row.body_fields).toBeNull()
    expect(big.wouldDeny).toBe(true)
    expect(JSON.stringify(big.row)).not.toContain('xxxxxxxx')
  })

  it('long values are clipped: scalars and user agent 80, claims 64, path 200', () => {
    const long = 'a'.repeat(300)
    const rec = buildPowerAuditRecord(
      settings, fakeReq({ 'user-agent': long, 'x-agent-id': long }), 'POST', `/api/settings/${long}`,
      { kind: 'token' }, 200, body({ name: long, actor: long }), NOW,
    )
    expect((JSON.parse(rec.row.body_scalars!) as { name: string }).name).toHaveLength(80)
    expect(rec.row.user_agent).toHaveLength(80)
    expect(rec.row.path).toHaveLength(200)
    expect(rec.row.claimed!.split(' ')).toEqual([`actor=${'a'.repeat(64)}`, `x-agent-id=${'a'.repeat(64)}`])
  })

  it('stores the value of the act or target: who resolved an approval, the schedule pane, autoStash (review 58885)', () => {
    const t = { kind: 'token' as const }
    const approval = classifyPowerRoute('PATCH', '/api/approvals/77')!
    const a = buildPowerAuditRecord(approval, fakeReq(), 'PATCH', '/api/approvals/77', t, 200, body({ status: 'approved', resolved_by: 'isti', telegram_message_id: 5 }), NOW)
    expect(JSON.parse(a.row.body_scalars!)).toEqual({ status: 'approved', resolved_by: 'isti' })
    expect(a.row.claimed).toBe('resolved_by=isti')
    const sch = buildPowerAuditRecord(schedule, fakeReq(), 'POST', '/api/schedules', t, 200, body({ targetSession: 'agent-ford', command: 'rm x' }), NOW)
    expect(JSON.parse(sch.row.body_scalars!)).toEqual({ targetSession: 'agent-ford' })
    expect(sch.row.body_fields).toBe('command,targetSession')
    const upd = buildPowerAuditRecord(classifyPowerRoute('POST', '/api/updates/apply')!, fakeReq(), 'POST', '/api/updates/apply', t, 200, body({ autoStash: true, rebaseApproval: 'SECRET-APPROVAL' }), NOW)
    expect(JSON.parse(upd.row.body_scalars!)).toEqual({ autoStash: true })
    expect(JSON.stringify(upd.row)).not.toContain('SECRET-APPROVAL')
  })

  it('a call that never got an answer is recorded with status null, not the default 200 (review 58885, A10)', () => {
    const rec = buildPowerAuditRecord(settings, fakeReq(), 'POST', '/api/settings', { kind: 'token' }, null, undefined, NOW)
    expect(rec.row.status).toBeNull()
  })
})

describe('auditPowerRoute on a real HTTP server', () => {
  let server: http.Server
  let base = ''
  let mode: 'ok' | 'forbidden' | 'dropped' = 'ok'
  let auth: RouteContext['auth'] = { kind: 'token' }

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      auditPowerRoute({ req, res, path: url.pathname, method: req.method ?? 'GET', auth })
      const raw = await readBody(req)
      if (mode === 'dropped') {
        res.destroy()
        return
      }
      res.writeHead(mode === 'ok' ? 200 : 403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ echoed: raw.toString() }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))
  beforeEach(() => {
    mode = 'ok'
    auth = { kind: 'token' }
    getDb().exec('DELETE FROM power_route_audit')
  })

  const rows = () => getDb().prepare('SELECT * FROM power_route_audit ORDER BY id').all() as Array<Record<string, unknown>>
  async function settled(n: number) {
    for (let i = 0; i < 100 && rows().length < n; i++) await new Promise((r) => setTimeout(r, 10))
  }

  it('records the call AFTER the answer, with the status, and the handler still reads the whole body', async () => {
    const payload = JSON.stringify({ key: 'SOME_SETTING', value: 'secret-value', actor: 'dexter' })
    const r = await fetch(`${base}/api/settings`, { method: 'POST', body: payload })
    expect(r.status).toBe(200)
    expect((await r.json()).echoed).toBe(payload)
    await settled(1)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({
      method: 'POST', route_id: 'settings-write', path: '/api/settings', auth_kind: 'token', token_agent: null,
      status: 200, would_deny: 1, body_fields: 'actor,key,value',
    })
    expect(rows()[0].claimed).toBe('actor=dexter')
    expect(JSON.stringify(rows()[0])).not.toContain('secret-value')
  })

  it('records a refused call too, with its 403', async () => {
    mode = 'forbidden'
    await fetch(`${base}/api/fleet/import`, { method: 'POST', body: '{}' })
    await settled(1)
    expect(rows()[0]).toMatchObject({ route_id: 'fleet-import', status: 403 })
  })

  it('a call whose connection dies before any answer is recorded with status null (review 58885, A10)', async () => {
    mode = 'dropped'
    await fetch(`${base}/api/fleet/import`, { method: 'POST', body: '{}' }).catch(() => undefined)
    await settled(1)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toMatchObject({ route_id: 'fleet-import', status: null })
  })

  it('writes nothing for a route that does not grant power', async () => {
    await fetch(`${base}/api/kanban`, { method: 'POST', body: '{}' })
    await fetch(`${base}/api/settings`)
    // a power call afterwards proves the listener path works at all (positive control)
    await fetch(`${base}/api/autonomy`, { method: 'POST', body: JSON.stringify({ key: 'k', level: 2 }) })
    await settled(1)
    expect(rows().map((r) => r.route_id)).toEqual(['autonomy-write'])
    expect(JSON.parse(rows()[0].body_scalars as string)).toEqual({ key: 'k', level: 2 })
  })

  it('a failing audit write changes nothing the caller sees', async () => {
    const db = getDb()
    db.exec('ALTER TABLE power_route_audit RENAME TO power_route_audit_away')
    try {
      const r = await fetch(`${base}/api/settings`, { method: 'POST', body: '{"key":"K"}' })
      expect(r.status).toBe(200)
      expect((await r.json()).echoed).toBe('{"key":"K"}')
      await new Promise((r2) => setTimeout(r2, 50))
    } finally {
      db.exec('ALTER TABLE power_route_audit_away RENAME TO power_route_audit')
    }
    expect(rows()).toHaveLength(0)
  })
})

describe('the audit is wired in (review 58885, A1 and A2)', () => {
  it('the daily decay sweep prunes the audit table: an old row goes, a fresh one stays', () => {
    const db = getDb()
    db.exec('DELETE FROM power_route_audit')
    const ins = db.prepare("INSERT INTO power_route_audit (ts, method, route_id, path, auth_kind) VALUES (?, 'POST', 'x', '/p', 'token')")
    const now = Math.floor(Date.now() / 1000)
    ins.run(now - (POWER_ROUTE_AUDIT_RETENTION_DAYS + 1) * 86400)
    ins.run(now - 60)
    runDecaySweep()
    expect(db.prepare('SELECT COUNT(*) AS n FROM power_route_audit').get()).toEqual({ n: 1 })
  })

  // startWebServer binds a port and loads the dashboard token from the real store, so a unit test cannot boot
  // it (commands-dispatch-route.test.ts pins its wiring the same way). The pin is on ORDER, not mere presence:
  // the call must come after ctxAuth exists, with it, and before the first route handler can answer.
  it('web.ts calls auditPowerRoute with ctxAuth after the auth is resolved and before the route chain', () => {
    const src = readFileSync(resolve(__dirname, '../web.ts'), 'utf8')
    const call = "auditPowerRoute({ req, res, path, method, auth: ctxAuth })"
    expect(src).toContain("import { auditPowerRoute } from './web/power-route-audit.js'")
    expect(src.split(call).length - 1).toBe(1)
    const at = src.indexOf(call)
    expect(src.indexOf('const ctxAuth =')).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(src.indexOf('const ctxAuth ='))
    expect(at).toBeLessThan(src.indexOf('tryHandleAuth(routeCtx)'))
  })
})

describe('retention', () => {
  it('keeps 30 days: a row older than that is pruned, a newer one stays', () => {
    const db = getDb()
    db.exec('DELETE FROM power_route_audit')
    const ins = db.prepare("INSERT INTO power_route_audit (ts, method, route_id, path, auth_kind) VALUES (?, 'POST', 'x', '/p', 'token')")
    const now = 1_800_000_000
    ins.run(now - (POWER_ROUTE_AUDIT_RETENTION_DAYS + 1) * 86400)
    ins.run(now - 8 * 86400)
    ins.run(now)
    expect(prunePowerRouteAudit(now)).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM power_route_audit').get()).toEqual({ n: 2 })
    // the 7-day audit window the card promises is inside the retention
    expect(POWER_ROUTE_AUDIT_RETENTION_DAYS).toBeGreaterThan(7)
  })
})
