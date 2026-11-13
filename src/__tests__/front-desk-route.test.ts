// Card 074149c2, stage 2: the live wiring behind the pure rule. The setting, the process table and
// the agent registry are the mocked edges; the queue depth is read from a REAL (in-memory) table,
// because "3+ pending" is a statement about rows.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  setting: '' as string | (() => string),
  running: new Map<string, boolean>(),
  known: new Set<string>(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('../logger.js', () => ({
  logger: { debug: () => {}, error: () => {}, info: (...a: unknown[]) => h.info(...a), warn: (...a: unknown[]) => h.warn(...a) },
}))
vi.mock('../settings-store.js', async (orig) => {
  const actual = await orig<typeof import('../settings-store.js')>()
  return {
    ...actual,
    getEffectiveSettingValue: (key: string) =>
      key === 'FRONT_DESK_AGENT_ID' ? (typeof h.setting === 'function' ? h.setting() : h.setting) : actual.getEffectiveSettingValue(key),
  }
})
vi.mock('../web/agent-process.js', () => ({ isAgentRunning: (a: string) => h.running.get(a) ?? false }))
vi.mock('../web/agent-config.js', () => ({ isKnownAgent: (a: string) => h.known.has(a) }))

const { initDatabase, createAgentMessage, markMessageDone } = await import('../db.js')
const { MAIN_AGENT_ID } = await import('../config.js')
const { resolveMachineNoticeRecipient, resolveReportRecipient } = await import('../web/front-desk-route.js')
const { getSettingDefinition } = await import('../config-registry.js')

beforeAll(() => { initDatabase(':memory:') })
beforeEach(() => {
  h.setting = ''
  h.running.clear(); h.known.clear()
  h.info.mockReset(); h.warn.mockReset()
})

/** A fresh, registered, running front desk with an empty queue. */
let n = 0
function desk(): string {
  const id = `desk-${++n}`
  h.setting = id
  h.known.add(id); h.running.set(id, true)
  return id
}

describe('resolveMachineNoticeRecipient', () => {
  it('the setting is registered, off by default, and needs no restart', () => {
    expect(getSettingDefinition('FRONT_DESK_AGENT_ID')).toMatchObject({ type: 'string', default: '', requiresRestart: false, secret: false })
  })

  it('off -> the coordinator, and nothing is logged', () => {
    expect(resolveMachineNoticeRecipient(['didi'])).toEqual({ to: MAIN_AGENT_ID, rerouted: false, why: 'not-configured' })
    expect(h.info).not.toHaveBeenCalled()
  })

  it('configured and healthy -> the front desk, and the log line says who and about whom', () => {
    const d = desk()
    expect(resolveMachineNoticeRecipient(['didi'])).toEqual({ to: d, rerouted: true, why: 'front-desk' })
    expect(h.info).toHaveBeenCalledWith(
      { frontDesk: d, to: d, subjects: ['didi'], why: 'front-desk' },
      'front desk: machine notice goes to the front desk',
    )
  })

  it('not running -> the coordinator, and the log line says why', () => {
    const d = desk()
    h.running.set(d, false)
    expect(resolveMachineNoticeRecipient(['didi'])).toEqual({ to: MAIN_AGENT_ID, rerouted: false, why: 'not-running' })
    expect(h.info.mock.calls[0][1]).toBe('front desk: machine notice stays with the coordinator')
  })

  it('not a registered agent -> the coordinator', () => {
    const d = desk()
    h.known.delete(d)
    expect(resolveMachineNoticeRecipient(['didi']).why).toBe('unknown-agent')
  })

  it('the front desk is the subject -> the coordinator', () => {
    const d = desk()
    expect(resolveMachineNoticeRecipient([d])).toEqual({ to: MAIN_AGENT_ID, rerouted: false, why: 'is-subject' })
  })

  it('THE QUEUE IS REAL ROWS: 2 pending still reroutes, the 3rd flips it, a closed row frees it again', () => {
    const d = desk()
    createAgentMessage('didi', d, 'egy')
    const second = createAgentMessage('didi', d, 'ketto')
    expect(resolveMachineNoticeRecipient(['didi']).rerouted).toBe(true)
    createAgentMessage('didi', d, 'harom')
    expect(resolveMachineNoticeRecipient(['didi'])).toEqual({ to: MAIN_AGENT_ID, rerouted: false, why: 'queue-full' })
    markMessageDone(second.id, 'kesz')
    expect(resolveMachineNoticeRecipient(['didi']).rerouted).toBe(true)
  })

  it('quiet (wake: false) rows do not count as a backlog: they wait for the next delivery by design', () => {
    const d = desk()
    for (let i = 0; i < 5; i++) createAgentMessage('system', d, `csendes ${i}`, undefined, undefined, { wake: false })
    expect(resolveMachineNoticeRecipient(['didi']).rerouted).toBe(true)
  })

  it('a setting that cannot be read -> the coordinator, with a warning, and no throw', () => {
    h.setting = () => { throw new Error('settings file unreadable') }
    expect(resolveMachineNoticeRecipient(['didi'])).toEqual({ to: MAIN_AGENT_ID, rerouted: false, why: 'probe-failed' })
    expect(h.warn).toHaveBeenCalledTimes(1)
  })
})

describe('resolveReportRecipient', () => {
  // Card f043d3f5: this runs on EVERY POST /api/messages, so a throw here would refuse every send.
  it('a setting that cannot be read -> the report stays where it was sent, with a warning, and no throw', () => {
    h.setting = () => { throw new Error('settings file unreadable') }
    expect(resolveReportRecipient('didi', 'desk-x')).toEqual({ to: 'desk-x', rerouted: false, why: 'probe-failed' })
    expect(h.warn).toHaveBeenCalledTimes(1)
  })
})
