// The main agent's mail is pulled, not pushed (drain-inbox, called by its
// UserPromptSubmit hook), so the router's delivery hold does not cover it. While the
// context-guard restarts the main agent, the drain must claim nothing: a row claimed
// into the old pane is marked 'delivered' and dies with the pane.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { MAIN_AGENT_ID, PROJECT_ROOT } from '../config.js'
import type { RouteContext } from '../web/routes/types.js'

const claim = vi.hoisted(() => vi.fn((_to: string, _limit: number) => [] as unknown[]))
vi.mock('../db.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  claimPendingForAgent: claim,
}))

const { tryHandleAgents } = await import('../web/routes/agents.js')
const { setDeliveryHoldProbe } = await import('../web/delivery-hold.js')

function drain(agent: string) {
  const out: { status: number; body: Record<string, unknown> | null } = { status: 0, body: null }
  const res = {
    writeHead(status: number) { out.status = status; return res },
    end(chunk?: string) { if (chunk) out.body = JSON.parse(chunk) as Record<string, unknown> },
  }
  const url = new URL(`http://localhost:3420/api/agents/${agent}/drain-inbox`)
  const ctx = { req: {} as RouteContext['req'], res, path: url.pathname, method: 'POST', url } as RouteContext
  return { ctx, out }
}

describe('drain-inbox honours the context-guard delivery hold', () => {
  afterEach(() => {
    setDeliveryHoldProbe(null)
    claim.mockClear()
  })

  it('claims NOTHING while the main agent is held, and says so', async () => {
    setDeliveryHoldProbe((agent) => (agent === MAIN_AGENT_ID ? { phase: 'await-handoff', untilMs: Date.now() + 60_000 } : null))
    const { ctx, out } = drain(MAIN_AGENT_ID)
    expect(await tryHandleAgents(ctx, join(PROJECT_ROOT, 'web'))).toBe(true)
    expect(claim).not.toHaveBeenCalled()
    expect(out.body).toMatchObject({ count: 0, text: '', held: true, phase: 'await-handoff' })
  })

  it('control: with no hold the drain claims as before', async () => {
    const { ctx, out } = drain(MAIN_AGENT_ID)
    expect(await tryHandleAgents(ctx, join(PROJECT_ROOT, 'web'))).toBe(true)
    expect(claim).toHaveBeenCalledTimes(1)
    expect(out.body).toMatchObject({ count: 0, text: '' })
    expect(out.body).not.toHaveProperty('held')
  })

  it('a failing probe means claim (fail-open)', async () => {
    setDeliveryHoldProbe(() => { throw new Error('probe down') })
    const { ctx } = drain(MAIN_AGENT_ID)
    await tryHandleAgents(ctx, join(PROJECT_ROOT, 'web'))
    expect(claim).toHaveBeenCalledTimes(1)
  })
})
