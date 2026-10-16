// Card a85a9acd (a): measureRestartLoss feeds the restart notice both its loss line and the
// wake decision, from ONE read of the rows.
import { describe, it, expect, vi } from 'vitest'
import { measureRestartLoss } from '../web/context-guard-runner.js'
import { restartNoticeWakes } from '../context-guard.js'

const T = 1_800_000_000_000
const sec = T / 1000

describe('measureRestartLoss', () => {
  it('an empty window: the line says there is nothing to resend, and nothing needs action', () => {
    const r = measureRestartLoss('x', () => [], T)
    expect(r.lossLine).toContain('NINCS mit ujrakuldeni')
    expect(r.lossNeedsAction).toBe(false)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(false)
  })

  it('a failed row in the window: the line asks to resend, and the notice wakes', () => {
    const r = measureRestartLoss('x', () => [{ id: 9, status: 'failed', created_at: sec - 120, from_agent: 'didi', head: 'k', delivered_at: null }], T)
    expect(r.lossLine).toContain('EZEKET kuldd ujra')
    expect(r.lossNeedsAction).toBe(true)
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(true)
  })

  it('a delivered sender row in the window: wakes', () => {
    const r = measureRestartLoss('x', () => [{ id: 4, status: 'delivered', created_at: sec - 500, delivered_at: sec - 120, from_agent: 'didi', head: 'kerdes' }], T)
    expect(r.lossNeedsAction).toBe(true)
  })

  it('an unreadable window is NOT a quiet one: the line says so and the notice wakes', () => {
    const r = measureRestartLoss('x', () => { throw new Error('db locked') }, T)
    expect(r.lossLine).toContain('NEM TUDTAM MEGMERNI')
    expect(r.lossNeedsAction).toBeNull()
    expect(restartNoticeWakes(r.lossNeedsAction, null)).toBe(true)
  })

  it('the line and the decision read the SAME rows: one read per call', () => {
    const read = vi.fn(() => [])
    measureRestartLoss('x', read, T)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('x')
  })
})
