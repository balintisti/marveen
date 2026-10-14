// PUT /api/agents/:name { claudePlan } must not accept a token-mode plan.
//
// A sub-agent launch takes a plan only as a configDir (resolveAgentConfigDir);
// a token-mode plan has none, so the field would name the plan while the agent
// keeps launching on its current login. Measured 2026-10-13 through the sibling
// path, POST /api/claude-plans/rotate: 8 sub-agents answered ok:true, and the
// CLAUDE_CODE_OAUTH_TOKEN hash in each process was still the first plan's.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PROJECT_ROOT } from '../config.js'
import { agentDir, readAgentClaudePlan, writeAgentClaudePlan } from '../web/agent-config.js'
import { CLAUDE_PLANS_PATH, getClaudePlan, tokenSecretIdFor, writeClaudePlans } from '../web/claude-plans.js'
import { tryHandleAgents } from '../web/routes/agents.js'
import type { RouteContext } from '../web/routes/types.js'

const THROWAWAY = 'zz-claude-plan-token-probe'

function fakeCtx(path: string, method: string, body: unknown): {
  ctx: RouteContext
  out: { status: number; body: Record<string, unknown> | null }
} {
  const out: { status: number; body: Record<string, unknown> | null } = { status: 0, body: null }
  const res = {
    writeHead(status: number) {
      out.status = status
      return res
    },
    end(chunk?: string) {
      if (chunk) out.body = JSON.parse(chunk) as Record<string, unknown>
    },
  }
  const bodyStr = JSON.stringify(body)
  const req = {
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data') cb(Buffer.from(bodyStr))
      if (event === 'end') cb()
    },
  }
  const url = new URL(`http://localhost:3420${path}`)
  return {
    ctx: { req: req as unknown as RouteContext['req'], res, path: url.pathname, method, url } as RouteContext,
    out,
  }
}

let plansBefore: string | null = null

beforeEach(() => {
  plansBefore = existsSync(CLAUDE_PLANS_PATH) ? readFileSync(CLAUDE_PLANS_PATH, 'utf-8') : null
  writeClaudePlans([
    { id: 'dir-plan', label: 'Dir plan', configDir: '/opt/claude-dir-plan', planType: 'personal', channelsAllowed: true },
    { id: 'tok-plan', label: 'Token plan', tokenSecretId: tokenSecretIdFor('tok-plan'), planType: 'personal', channelsAllowed: true },
  ])
  mkdirSync(agentDir(THROWAWAY), { recursive: true })
})

afterEach(() => {
  rmSync(agentDir(THROWAWAY), { recursive: true, force: true })
  if (plansBefore === null) rmSync(CLAUDE_PLANS_PATH, { force: true })
  else writeClaudePlans(JSON.parse(plansBefore))
})

async function put(claudePlan: string) {
  const { ctx, out } = fakeCtx(`/api/agents/${THROWAWAY}`, 'PUT', { claudePlan })
  await tryHandleAgents(ctx, join(PROJECT_ROOT, 'web'))
  return out
}

describe('PUT /api/agents/:name claudePlan and token-mode plans', () => {
  it('rejects a token-mode plan with 400 and leaves the field unset', async () => {
    // Positive control on the fixture: the registry must hold the token plan, or the 400
    // below is the unknown-id rejection and proves nothing about token mode.
    expect(getClaudePlan('tok-plan')?.tokenSecretId).toBe(tokenSecretIdFor('tok-plan'))
    const out = await put('tok-plan')
    expect(out.status).toBe(400)
    expect(String(out.body?.error)).toMatch(/token-módú/)
    expect(readAgentClaudePlan(THROWAWAY)).toBeNull()
  })

  it('CONTROL: a configDir plan is still accepted and written', async () => {
    // Without this, the 400 above would also pass on a route that rejects every plan.
    const out = await put('dir-plan')
    expect(out.body?.ok).toBe(true)
    expect(readAgentClaudePlan(THROWAWAY)).toBe('dir-plan')
  })

  it('the way out stays open: an agent already on a token-mode plan can clear the field', async () => {
    // The state the old route left behind, written the way it wrote it.
    writeAgentClaudePlan(THROWAWAY, 'tok-plan')
    expect(readAgentClaudePlan(THROWAWAY)).toBe('tok-plan')
    const out = await put('')
    expect(out.body?.ok).toBe(true)
    expect(readAgentClaudePlan(THROWAWAY)).toBeNull()
  })
})
