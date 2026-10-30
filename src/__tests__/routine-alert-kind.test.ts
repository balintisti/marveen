import { describe, it, expect, vi, beforeEach } from 'vitest'

// Card baabe0ba (F7), upstream 68cb6715: a routine alert's key is the case on
// the alert delivery log line, so notifyChannel gets { kind: <key> } with it.
const { mockNotify } = vi.hoisted(() => ({ mockNotify: vi.fn(async (_text: string, _meta?: unknown) => {}) }))
vi.mock('../notify.js', () => ({ notifyChannel: mockNotify }))
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { sendRoutineAlert } from '../web/routine-alert.js'

beforeEach(() => mockNotify.mockClear())

describe('sendRoutineAlert passes its key as the alert case', () => {
  it('the first report goes out with { kind: key } and nothing else in the meta', () => {
    expect(sendRoutineAlert('menu-escape:agent-x', 'text', { now: 1_000 })).toBe(true)
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify.mock.calls[0][0]).toContain('text')
    expect(mockNotify.mock.calls[0][1]).toEqual({ kind: 'menu-escape:agent-x' })
  })
  it('a report inside the cooldown sends nothing (positive control for the count above)', () => {
    sendRoutineAlert('menu-escape:agent-y', 'text', { now: 1_000 })
    mockNotify.mockClear()
    expect(sendRoutineAlert('menu-escape:agent-y', 'text', { now: 2_000 })).toBe(false)
    expect(mockNotify).not.toHaveBeenCalled()
  })
})
