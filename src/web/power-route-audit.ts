import type http from 'node:http'
import { logPowerRouteAudit } from '../db.js'
import { logger } from '../logger.js'
import { bodyReadFor } from './http-helpers.js'
import type { RouteContext } from './routes/types.js'

// Card 3fc4df30 (marveen 58797, GO): AUDIT MODE for the routes that GRANT power (didi 58738 point 2).
// For 7+ days every call on these routes is recorded: who (as far as the request identifies the caller), which
// route, which target, when, and what the route answered. NOTHING is refused or delayed: the record is written
// after the response has finished, inside a try/catch, so a failing audit can never change a request.
// Compared to what: before this, these calls passed (or were refused) with no trace beyond the 24 h tool_call_log.
//
// What is recorded about the body: the FIELD NAMES, and the values of a closed list of non-secret scalar fields
// (BODY_SCALAR_FIELDS). Values of anything else (apiKey, prompt, command, claudeMd, tokens) are never stored.

interface PowerRoute {
  /** The route file that owns the handler; power-route-audit.test.ts pins that every owner-gated file is named. */
  file: string
  id: string
  methods: readonly string[]
  re: RegExp
  /** Body fields that make the call a power call. Absent = every call on the route is one. */
  ownerFields?: readonly string[]
}

// Same list as SCHEDULE_OWNER_FIELDS in routes/schedules.ts (pinned equal by the test).
export const SCHEDULE_POWER_FIELDS = [
  'type', 'command', 'timeoutMs', 'preCheck', 'preCheckTimeoutSeconds', 'targetSession', 'telegramChatId', 'channelProvider',
] as const

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'] as const

export const POWER_ROUTES: readonly PowerRoute[] = [
  { file: 'agents.ts', id: 'agent-config', methods: ['PUT'], re: /^\/api\/agents\/[^/]+$/,
    ownerFields: ['claudeMd', 'soulMd', 'mcpJson', 'authMode', 'apiKey', 'claudePlan', 'customProvider'] },
  { file: 'agents.ts', id: 'agent-security', methods: ['PUT'], re: /^\/api\/agents\/[^/]+\/security$/ },
  { file: 'agents.ts', id: 'agent-create', methods: ['POST'], re: /^\/api\/agents$/ },
  { file: 'agents.ts', id: 'agent-import', methods: ['POST'], re: /^\/api\/agents\/import$/ },
  { file: 'agents.ts', id: 'agent-export', methods: ['GET'], re: /^\/api\/agents\/(?:export-all|[^/]+\/export)$/ },
  { file: 'agents.ts', id: 'agent-remote', methods: ['PUT'], re: /^\/api\/agents\/[^/]+\/remote$/ },
  { file: 'agents.ts', id: 'agent-auth-init', methods: ['POST'], re: /^\/api\/agents\/[^/]+\/auth\/init$/ },
  { file: 'agents.ts', id: 'agent-channel-access', methods: ['POST'],
    re: /^\/api\/agents\/[^/]+\/(?:channels\/[^/]+\/|telegram\/)?approve$|^\/api\/agents\/[^/]+\/channel-requests\/\d+\/approve$/ },
  { file: 'agents.ts', id: 'agent-channel-access-remove', methods: ['DELETE'],
    re: /^\/api\/agents\/[^/]+\/(?:channels\/[^/]+\/|telegram\/)(?:invites|allowed)\/.+$/ },
  { file: 'agent-terminal.ts', id: 'terminal-input', methods: ['POST'], re: /^\/api\/terminal-input$/ },
  { file: 'agent-terminal.ts', id: 'agent-session-input', methods: ['POST'], re: /^\/api\/agents\/[^/]+\/(?:keys|login)$/ },
  { file: 'autonomy.ts', id: 'autonomy-write', methods: ['POST'], re: /^\/api\/autonomy$/ },
  { file: 'claude-plans.ts', id: 'claude-plans-write', methods: WRITES, re: /^\/api\/claude-plans(?:\/.*)?$/ },
  { file: 'claude-plans-login.ts', id: 'claude-plans-login', methods: ['POST'], re: /^\/api\/claude-plans\/login\/.+$/ },
  { file: 'connectors.ts', id: 'connectors-write', methods: WRITES, re: /^\/api\/(?:connectors|mcp-catalog)(?:\/.*)?$/ },
  { file: 'custom-providers.ts', id: 'custom-providers-write', methods: WRITES, re: /^\/api\/custom-providers(?:\/.*)?$/ },
  { file: 'fleet.ts', id: 'fleet-export', methods: ['GET'], re: /^\/api\/fleet\/export$/ },
  { file: 'fleet.ts', id: 'fleet-import', methods: ['POST'], re: /^\/api\/fleet\/import$/ },
  { file: 'fleet-freeze.ts', id: 'fleet-unfreeze', methods: ['POST'], re: /^\/api\/fleet\/unfreeze$/ },
  { file: 'migrate.ts', id: 'migrate', methods: ['POST'], re: /^\/api\/migrate\/(?:run|scan)$/ },
  { file: 'updates.ts', id: 'updates-apply', methods: ['POST'], re: /^\/api\/updates\/(?:apply|cli\/apply)$/ },
  { file: 'approvals.ts', id: 'approval-decide', methods: ['PATCH'], re: /^\/api\/approvals\/[^/]+$/ },
  { file: 'auth.ts', id: 'auth-credentials', methods: ['POST'], re: /^\/api\/auth\/(?:users|device-keys)$/ },
  { file: 'auth.ts', id: 'auth-credentials-remove', methods: ['DELETE'], re: /^\/api\/auth\/(?:users\/[^/]+|device-keys\/\d+)$/ },
  { file: 'security.ts', id: 'bridge-enroll', methods: ['POST'], re: /^\/api\/security\/bridge-enroll$/ },
  { file: 'federation.ts', id: 'federation-write', methods: ['POST', 'PUT', 'DELETE'], re: /^\/api\/federation\/(?!inbox$).+$/ },
  { file: 'federation.ts', id: 'federation-token-reveal', methods: ['GET'], re: /^\/api\/federation\/peers\/[^/]+\/inbound-token$/ },
  { file: 'onboarding.ts', id: 'onboarding-write', methods: ['POST'], re: /^\/api\/onboarding\/(?:claude-auth|identity|launch)$/ },
  { file: 'schedules.ts', id: 'schedule-write', methods: ['POST', 'PUT'], re: /^\/api\/schedules(?:\/[^/]+)?$/, ownerFields: SCHEDULE_POWER_FIELDS },
  { file: 'settings.ts', id: 'settings-write', methods: WRITES, re: /^\/api\/settings(?:\/.*)?$/ },
  { file: 'skills.ts', id: 'skill-approval', methods: ['POST'], re: /^\/api\/skills\/pending\/[^/]+\/(?:approve|reject)$/ },
  { file: 'skills.ts', id: 'skill-install', methods: ['POST'], re: /^\/api\/skills(?:\/import)?$/ },
  { file: 'vault-ssh.ts', id: 'vault-ssh-servers-write', methods: WRITES, re: /^\/api\/vault\/ssh-servers(?:\/.*)?$/ },
  { file: 'vault-ssh-keys.ts', id: 'vault-ssh-keys-write', methods: WRITES, re: /^\/api\/vault\/ssh-keys(?:\/.*)?$/ },
]

/** Route files that read an owner gate but own no route of their own (helpers). The completeness test names them,
 *  so a NEW gated route file is a red test until it is in POWER_ROUTES or here with its reason. */
export const OWNER_GATE_HELPER_FILES: Readonly<Record<string, string>> = {
  'operator-access.ts': 'helper: operator-key checks, no route of its own',
  'cli-inventory.ts': 'helper: reads the owner gate for a CLI probe, no write route',
}

export function classifyPowerRoute(method: string, path: string): PowerRoute | null {
  for (const r of POWER_ROUTES) {
    if (r.methods.includes(method) && r.re.test(path)) return r
  }
  return null
}

// Non-secret scalar body fields whose VALUE is the target or the act (a setting name, an autonomy level, a
// decision). Everything else is recorded by name only.
// resolved_by is who decided an approval, targetSession the tmux pane a schedule types into, autoStash whether an
// update may stash a dirty tree: each is the target or the act of a power route (review 58885, item 3).
const BODY_SCALAR_FIELDS = [
  'key', 'level', 'name', 'agent', 'agent_id', 'id', 'status', 'type', 'provider', 'enabled', 'action',
  'resolved_by', 'targetSession', 'autoStash',
] as const
// Identity the request CLAIMS (unauthenticated on the shared token); tokenAgent is the authenticated one.
const CLAIM_BODY_FIELDS = ['actor', 'author', 'from_agent', 'updated_by', 'requested_by', 'resolved_by', 'agent_id', 'agent'] as const
const CLAIM_HEADERS = ['x-agent-id', 'x-agent-name', 'x-marveen-agent'] as const
const MAX_BODY_BYTES = 256 * 1024
const clip = (v: string, n = 80) => (v.length > n ? v.slice(0, n) : v)

interface BodyView {
  fields: string[]
  scalars: Record<string, string | number | boolean>
  claims: string[]
}

function viewBody(raw: Buffer | undefined): BodyView {
  const out: BodyView = { fields: [], scalars: {}, claims: [] }
  if (!raw || raw.length === 0 || raw.length > MAX_BODY_BYTES) return out
  let data: unknown
  try { data = JSON.parse(raw.toString()) } catch { return out }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  const rec = data as Record<string, unknown>
  out.fields = Object.keys(rec).sort()
  for (const f of BODY_SCALAR_FIELDS) {
    const v = rec[f]
    if (typeof v === 'string') out.scalars[f] = clip(v)
    else if (typeof v === 'number' || typeof v === 'boolean') out.scalars[f] = v
  }
  for (const f of CLAIM_BODY_FIELDS) {
    const v = rec[f]
    if (typeof v === 'string' && v.trim()) out.claims.push(`${f}=${clip(v.trim(), 64)}`)
  }
  return out
}

export interface PowerAuditRecord {
  routeId: string
  wouldDeny: boolean
  fields: string[]
  row: Parameters<typeof logPowerRouteAudit>[0]
}

/** Pure: builds the row for one finished request. `body` is what the handler read (may be undefined). */
export function buildPowerAuditRecord(
  route: PowerRoute,
  req: Pick<http.IncomingMessage, 'headers' | 'socket'>,
  method: string,
  path: string,
  auth: RouteContext['auth'],
  status: number | null,
  body: Buffer | undefined,
  nowSecs: number,
): PowerAuditRecord {
  const view = viewBody(body)
  const claims = [...view.claims]
  for (const h of CLAIM_HEADERS) {
    const v = req.headers[h]
    if (typeof v === 'string' && v.trim()) claims.push(`${h}=${clip(v.trim(), 64)}`)
  }
  if (auth?.agent) claims.push(`token.agent=${clip(auth.agent, 64)}`)
  // Only the routes with ownerFields depend on the body; a call that names none of them is not a power call.
  const isPowerCall = route.ownerFields === undefined || view.fields.some((f) => route.ownerFields!.includes(f))
  // "Would deny" is the UPPER BOUND of what an owner-session rule would refuse: a power call that does not come
  // on an owner session. A shared token that rides beside the owner's cookie counts as refused here though the
  // real gate lets it through; the exact answer is the recorded status where a gate already exists (403).
  const wouldDeny = isPowerCall && auth?.kind !== 'session'
  const ua = req.headers['user-agent']
  return {
    routeId: route.id,
    wouldDeny,
    fields: view.fields,
    row: {
      ts: nowSecs,
      method,
      route_id: route.id,
      path: clip(path, 200),
      auth_kind: auth?.kind ?? 'none',
      auth_who: clip(auth?.user ?? auth?.device ?? auth?.peer ?? '', 64) || null,
      token_agent: auth?.tokenAgent ?? null,
      claimed: claims.length ? claims.join(' ') : null,
      body_fields: view.fields.length ? view.fields.join(',') : null,
      body_scalars: Object.keys(view.scalars).length ? JSON.stringify(view.scalars) : null,
      remote: req.socket?.remoteAddress ?? null,
      user_agent: typeof ua === 'string' ? clip(ua) : null,
      status,
      would_deny: wouldDeny,
    },
  }
}

/** Called once per request BEFORE the route chain. Registers a finish listener; never throws, never answers. */
export function auditPowerRoute(ctx: Pick<RouteContext, 'req' | 'res' | 'path' | 'method' | 'auth'>): void {
  try {
    const route = classifyPowerRoute(ctx.method, ctx.path)
    if (!route) return
    ctx.res.once('close', () => {
      try {
        const rec = buildPowerAuditRecord(
          route, ctx.req, ctx.method, ctx.path, ctx.auth,
          ctx.res.headersSent || ctx.res.writableEnded ? ctx.res.statusCode : null,
          bodyReadFor(ctx.req), Math.floor(Date.now() / 1000),
        )
        logPowerRouteAudit(rec.row)
      } catch (err) {
        logger.warn({ err }, 'power-route audit: record failed (the request is unaffected)')
      }
    })
  } catch (err) {
    logger.warn({ err }, 'power-route audit: install failed (the request is unaffected)')
  }
}
