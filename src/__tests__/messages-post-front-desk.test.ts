// Card 074149c2, stage 2: a fresh session's "[RESTART-ABLAK] <id> felveve" line addressed to the
// coordinator is stored for the configured front desk. Driven through the real POST handler and a
// real (in-memory) table; the setting, the registry and the process table are the mocked edges.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { RouteContext } from '../web/routes/types.js'

const h = vi.hoisted(() => ({ setting: '', running: new Map<string, boolean>(), agents: new Set<string>() }))

vi.mock('../settings-store.js', async (orig) => {
  const actual = await orig<typeof import('../settings-store.js')>()
  return {
    ...actual,
    getEffectiveSettingValue: (key: string) => (key === 'FRONT_DESK_AGENT_ID' ? h.setting : actual.getEffectiveSettingValue(key)),
  }
})
vi.mock('../web/agent-process.js', async (orig) => ({
  ...(await orig<typeof import('../web/agent-process.js')>()),
  isAgentRunning: (a: string) => h.running.get(a) ?? false,
  agentRunState: (a: string) => ((h.running.get(a) ?? false) ? 'running' : 'stopped'),
}))
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  const { MAIN_AGENT_ID } = await import('../config.js')
  return {
    ...actual,
    isKnownAgent: (a: string) => a === MAIN_AGENT_ID || h.agents.has(a),
    listAllAgentNames: () => [...h.agents],
  }
})

const { initDatabase, getAgentMessage, createAgentMessage } = await import('../db.js')
const { MAIN_AGENT_ID, OWNER_NAME } = await import('../config.js')
const { tryHandleMessages } = await import('../web/routes/messages.js')
const { parseFrontDeskHeader } = await import('../front-desk.js')

function fakeCtx(body: unknown): { ctx: RouteContext; res: { statusCode: number; body: string } } {
  const req = new EventEmitter() as unknown as RouteContext['req'] & { destroy(): void }
  ;(req as unknown as { headers: Record<string, string> }).headers = {}
  ;(req as { destroy(): void }).destroy = () => { /* readBody over-limit hook */ }
  const state = { statusCode: 0, body: '' }
  const res = {
    writeHead(code: number) { state.statusCode = code; return res },
    end(data?: unknown) { state.body = String(data ?? '') },
    setHeader() { /* not used by json() */ },
  } as unknown as RouteContext['res']
  process.nextTick(() => {
    ;(req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)))
    ;(req as unknown as EventEmitter).emit('end')
  })
  const path = '/api/messages'
  return { ctx: { req, res, path, method: 'POST', url: new URL(`http://localhost${path}`), fedPeer: null }, res: state }
}

async function post(body: unknown): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  const { ctx, res } = fakeCtx(body)
  expect(await tryHandleMessages(ctx)).toBe(true)
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : {} }
}

const RECEIPT = '[RESTART-ABLAK] 10012840 felvéve a friss sessionben'
const stored = (r: { json: Record<string, unknown> }) => getAgentMessage(r.json.id as number)

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})
beforeEach(() => {
  h.setting = 'desk'
  h.agents.clear(); h.running.clear()
  for (const a of ['desk', 'didi', 'ford']) { h.agents.add(a); h.running.set(a, true) }
  h.running.set(MAIN_AGENT_ID, true)
})

describe('POST /api/messages: a restart-window receipt to the coordinator', () => {
  it('goes to the front desk: the row, the header line, the text after it, and the response all say so', async () => {
    const r = await post({ from: 'didi', to: MAIN_AGENT_ID, content: RECEIPT })
    expect(r.statusCode).toBe(200)
    const row = stored(r)
    expect(row?.to_agent).toBe('desk')
    expect(row?.from_agent).toBe('didi')
    const [first, ...rest] = String(row?.content).split('\n')
    expect(parseFrontDeskHeader(first)).toMatchObject({ v: 1, type: 'restart-window-receipt', subjects: ['didi'], delivered: null, window_sec: null })
    expect(rest.join('\n')).toBe(RECEIPT)
    expect(r.json.rerouted).toEqual({ requested: MAIN_AGENT_ID, to: 'desk', why: 'front-desk' })
    expect(r.json.to_agent).toBe('desk')
  })

  const staysWithCoordinator = async (body: { from: string; to: string; content: string }) => {
    const r = await post(body)
    expect(r.statusCode).toBe(200)
    const row = stored(r)
    expect(row?.to_agent).toBe(MAIN_AGENT_ID)
    expect(row?.content).toBe(body.content)
    expect(r.json.rerouted).toBeUndefined()
  }

  it('FAIL-OPEN: the front desk is not configured', async () => {
    h.setting = ''
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: RECEIPT })
  })

  it('FAIL-OPEN: the front desk is not running', async () => {
    h.running.set('desk', false)
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: RECEIPT })
  })

  it('FAIL-OPEN: the front desk wrote the line itself', async () => {
    await staysWithCoordinator({ from: 'desk', to: MAIN_AGENT_ID, content: RECEIPT })
  })

  it('FAIL-OPEN: the front desk has 3 pending', async () => {
    for (let i = 0; i < 3; i++) createAgentMessage('ford', 'desk', `varakozik ${i}`)
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: RECEIPT })
  })

  it('a receipt that asks something stays with the coordinator', async () => {
    h.agents.add('desk2'); h.running.set('desk2', true); h.setting = 'desk2'
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: `${RECEIPT}. Melyik menjen elöl?` })
  })

  it('an ordinary message to the coordinator is never rerouted', async () => {
    h.agents.add('desk3'); h.running.set('desk3', true); h.setting = 'desk3'
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: 'DECISION: push or hold' })
    await staysWithCoordinator({ from: 'didi', to: MAIN_AGENT_ID, content: 'Kész: a [RESTART-ABLAK] sorok lezárva' })
  })

  it('the owner\'s own line always reaches the coordinator, whatever it starts with', async () => {
    h.agents.add('desk4'); h.running.set('desk4', true); h.setting = 'desk4'
    await staysWithCoordinator({ from: OWNER_NAME, to: MAIN_AGENT_ID, content: RECEIPT })
  })

  it('a receipt addressed to ANOTHER agent is not touched', async () => {
    h.agents.add('desk5'); h.running.set('desk5', true); h.setting = 'desk5'
    const r = await post({ from: 'didi', to: 'ford', content: RECEIPT })
    expect(stored(r)?.to_agent).toBe('ford')
    expect(stored(r)?.content).toBe(RECEIPT)
    expect(r.json.rerouted).toBeUndefined()
  })
})
