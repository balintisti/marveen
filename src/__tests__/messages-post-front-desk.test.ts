// Card 074149c2, stage 2: a fresh session's "[RESTART-ABLAK] <id> felveve" line addressed to the
// coordinator is stored for the configured front desk. Driven through the real POST handler and a
// real (in-memory) table; the setting, the registry and the process table are the mocked edges.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
import type { RouteContext } from '../web/routes/types.js'

const mkTmp = tmpDirs()

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

const { initDatabase, getAgentMessage, createAgentMessage, getDb } = await import('../db.js')
const { MAIN_AGENT_ID, OWNER_NAME } = await import('../config.js')
const { tryHandleMessages } = await import('../web/routes/messages.js')
const { parseFrontDeskHeader, FRONT_DESK_DOWN_TAG, FRONT_DESK_STALL_SEC } = await import('../front-desk.js')

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

// THE PAGE GUARD'S DEFECT ALARM (follow-up, coordinator's comment 57647). The text under test is
// not typed here: the checker's REAL summary() writes the closing lines, the REAL
// scripts/fleet-page-guard.sh turns them into the alarm, and only the two edges are stubs (the
// checker's page scan and the sender). So a change of the name line on either side of the seam
// (python -> bash -> this route) fails here.
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts')

function realGuardAlarm(bad: string[], waiting: string[]): string {
  const root = mkTmp('page-guard-seam-')
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'store'))
  const closing = execFileSync('python3', ['-c', [
    'import importlib.util, json, sys',
    "spec = importlib.util.spec_from_file_location('agent_core_check', sys.argv[1])",
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'print(m.summary(12, json.loads(sys.argv[2]), json.loads(sys.argv[3])))',
  ].join('\n'), join(SCRIPTS, 'agent-core-check.py'), JSON.stringify(bad), JSON.stringify(waiting)], { encoding: 'utf-8' })
  writeFileSync(join(root, 'checker-out.txt'), `  didi           39,962 kar.  kanari 22/23, szakasz 12/12, generalt 10/10\n\n${closing}`)
  writeFileSync(join(root, 'scripts', 'agent-core-check.py'),
    `import sys\nsys.stdout.write(open(${JSON.stringify(join(root, 'checker-out.txt'))}, encoding='utf-8').read())\nsys.exit(3)\n`)
  writeFileSync(join(root, 'scripts', 'alert-coordinator.sh'),
    `#!/bin/bash\ncat > "${join(root, 'sent.txt')}"\necho "OK coordinator OK id=1"\n`)
  const r = spawnSync('bash', [join(SCRIPTS, 'fleet-page-guard.sh')], { env: { ...process.env, FLEET_PAGE_GUARD_ROOT: root }, encoding: 'utf-8' })
  expect(r.status).toBe(3)
  return readFileSync(join(root, 'sent.txt'), 'utf-8')
}

describe('POST /api/messages: the page guard\'s defect alarm, sent as the coordinator to the coordinator', () => {
  const useDesk = (name: string) => { h.agents.add(name); h.running.set(name, true); h.setting = name }
  const stays = async (body: { from: string; to: string; content: string }) => {
    const r = await post(body)
    expect(r.statusCode).toBe(200)
    expect(stored(r)?.to_agent).toBe(body.to)
    expect(stored(r)?.content).toBe(body.content.trim())
    expect(r.json.rerouted).toBeUndefined()
  }
  const ALARM = (names: string) => `[fleet-page-guard] LAPOK: ${names}\nEGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT.`

  it('THE REAL ALARM goes to the front desk: the row, the header with the pages, the text unchanged, the response', async () => {
    useDesk('pgdesk1')
    const alarm = realGuardAlarm(['didi', 'ford'], ['desk'])
    expect(alarm.split('\n')[0]).toBe('[fleet-page-guard] LAPOK: didi, ford')
    const r = await post({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: alarm })
    expect(r.statusCode).toBe(200)
    const row = stored(r)
    expect(row?.to_agent).toBe('pgdesk1')
    expect(row?.from_agent).toBe(MAIN_AGENT_ID)
    const [first, ...rest] = String(row?.content).split('\n')
    expect(parseFrontDeskHeader(first)).toMatchObject({ v: 1, type: 'fleet-page-guard', subjects: ['didi', 'ford'] })
    expect(rest.join('\n')).toBe(alarm.trim())
    expect(r.json.rerouted).toEqual({ requested: MAIN_AGENT_ID, to: 'pgdesk1', why: 'front-desk' })
  })

  it('FAIL-OPEN: the front desk\'s own page is among the pages', async () => {
    useDesk('pgdesk2')
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: ALARM('didi, pgdesk2') })
  })

  it('FAIL-OPEN: the coordinator\'s own page is among the pages', async () => {
    useDesk('pgdesk3')
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: ALARM(`didi, ${MAIN_AGENT_ID}`) })
  })

  it('FAIL-OPEN: one named page is not an agent of this fleet', async () => {
    useDesk('pgdesk4')
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: ALARM('didi, nobody') })
  })

  it('FAIL-OPEN: no front desk configured, or it is not running', async () => {
    h.setting = ''
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: ALARM('didi') })
    useDesk('pgdesk5')
    h.running.set('pgdesk5', false)
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: ALARM('didi') })
  })

  it('an AGENT that writes the same first line to the coordinator is not the page guard', async () => {
    useDesk('pgdesk6')
    await stays({ from: 'didi', to: MAIN_AGENT_ID, content: ALARM('ford') })
    await stays({ from: OWNER_NAME, to: MAIN_AGENT_ID, content: ALARM('ford') })
  })

  it('the blind guard (rc=4) and a headline without names stay with the coordinator', async () => {
    useDesk('pgdesk7')
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: '[fleet-page-guard] AZ AGENS-LAP OR NEM TUDOTT MERNI (rc=4): a lapokrol MOST semmit nem tudunk.\n\nHIBAS-LAPOK: didi' })
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: '[fleet-page-guard] EGY VAGY TOBB AGENS-LAP NEM HORDOZZA A TEHERHORDO MONDATOKAT.' })
  })

  it('the same text addressed to ANOTHER agent is not touched', async () => {
    useDesk('pgdesk8')
    await stays({ from: MAIN_AGENT_ID, to: 'ford', content: ALARM('didi') })
  })

  it('a receipt keeps its own type: the coordinator\'s own receipt is about the coordinator and stays', async () => {
    useDesk('pgdesk9')
    await stays({ from: MAIN_AGENT_ID, to: MAIN_AGENT_ID, content: RECEIPT })
  })
})

// Card f043d3f5: an agent's REPORT addressed to the front desk, when the desk cannot read it.
describe('POST /api/messages: a report to a front desk that cannot read it', () => {
  const REPORT = 'Kész: 645a3ea3 javítási kör, a kártyán a bizonyíték'
  const deskOf = (name: string) => { h.agents.add(name); h.running.set(name, true); h.setting = name }
  const header = (content: unknown) => {
    const [first, ...rest] = String(content).split('\n')
    expect(first.startsWith(`${FRONT_DESK_DOWN_TAG} `)).toBe(true)
    return { head: JSON.parse(first.slice(FRONT_DESK_DOWN_TAG.length + 1)), text: rest.join('\n') }
  }

  it('the desk is not running: the coordinator gets it, with the reason on the first line, and the response says so', async () => {
    deskOf('rdesk1'); h.running.set('rdesk1', false)
    const r = await post({ from: 'didi', to: 'rdesk1', content: REPORT })
    expect(r.statusCode).toBe(200)
    const row = stored(r)
    expect(row?.to_agent).toBe(MAIN_AGENT_ID)
    expect(row?.from_agent).toBe('didi')
    expect(header(row?.content)).toEqual({ head: { v: 1, requested: 'rdesk1', why: 'desk-not-running', oldest_pending_sec: null }, text: REPORT })
    expect(r.json.rerouted).toEqual({ requested: 'rdesk1', to: MAIN_AGENT_ID, why: 'desk-not-running' })
    // the sender is not told to start the coordinator: the stopped-recipient warning is the old path
    expect(r.json.warning).toBeUndefined()
  })

  it('the desk runs but its oldest pending row is FRONT_DESK_STALL_SEC old: the coordinator, with the measured age', async () => {
    deskOf('rdesk2')
    const old = createAgentMessage('ford', 'rdesk2', 'régi jelentés')
    getDb().prepare('UPDATE agent_messages SET created_at = created_at - ? WHERE id = ?').run(FRONT_DESK_STALL_SEC + 5, old.id)
    const r = await post({ from: 'didi', to: 'rdesk2', content: REPORT })
    const row = stored(r)
    expect(row?.to_agent).toBe(MAIN_AGENT_ID)
    const { head, text } = header(row?.content)
    expect(head.why).toBe('desk-stalled')
    expect(head.oldest_pending_sec).toBeGreaterThanOrEqual(FRONT_DESK_STALL_SEC)
    expect(text).toBe(REPORT)
    expect(r.json.rerouted).toEqual({ requested: 'rdesk2', to: MAIN_AGENT_ID, why: 'desk-stalled' })
  })

  const reachesDesk = async (body: { from: string; to: string; content: string }) => {
    const r = await post(body)
    expect(r.statusCode).toBe(200)
    expect(stored(r)?.to_agent).toBe(body.to)
    expect(stored(r)?.content).toBe(body.content)
    expect(r.json.rerouted).toBeUndefined()
  }

  it('a running desk with a young queue keeps the report, unchanged', async () => {
    deskOf('rdesk3')
    createAgentMessage('ford', 'rdesk3', 'friss')
    await reachesDesk({ from: 'didi', to: 'rdesk3', content: REPORT })
  })

  it('the owner, and the coordinator itself, reach a stopped desk as they asked', async () => {
    deskOf('rdesk4'); h.running.set('rdesk4', false)
    await reachesDesk({ from: OWNER_NAME, to: 'rdesk4', content: REPORT })
    await reachesDesk({ from: MAIN_AGENT_ID, to: 'rdesk4', content: REPORT })
  })

  it('a stopped agent that is NOT the front desk is not rerouted (the old warning still comes)', async () => {
    deskOf('rdesk5'); h.agents.add('ford2'); h.running.set('ford2', false)
    const r = await post({ from: 'didi', to: 'ford2', content: REPORT })
    expect(stored(r)?.to_agent).toBe('ford2')
    expect(r.json.rerouted).toBeUndefined()
    expect(r.json.targetRunning).toBe(false)
  })

  it('no front desk configured: a message to a stopped agent stays where it was sent', async () => {
    h.setting = ''; h.agents.add('rdesk6'); h.running.set('rdesk6', false)
    const r = await post({ from: 'didi', to: 'rdesk6', content: REPORT })
    expect(stored(r)?.to_agent).toBe('rdesk6')
    expect(r.json.rerouted).toBeUndefined()
  })
})
