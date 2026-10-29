// KILLSWITCH1022, the message router end to end at the timer (card 1befbdb3).
//
// fleet-freeze.test.ts pins the router's setInterval line by TEXT; this runs the real
// startMessageRouter on a fake clock and watches the one thing that proves a tick ran:
// the pending-queue read. Frozen, the queue is never read (nothing is delivered, the rows
// wait); unfrozen, the next tick reads it again.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const ROOT = mkTmp('fleet-freeze-router-')
mkdirSync(join(ROOT, 'store'), { recursive: true })

vi.mock('../config.js', async (orig) => ({ ...(await orig<typeof import('../config.js')>()), PROJECT_ROOT: ROOT }))
const pendingSpy = vi.hoisted(() => vi.fn((): unknown[] => []))
vi.mock('../db.js', async (orig) => ({ ...(await orig<typeof import('../db.js')>()), getPendingMessages: pendingSpy }))

const { initDatabase } = await import('../db.js')
const { startMessageRouter } = await import('../web/message-router.js')
const { FLEET_FREEZE_PATH } = await import('../web/fleet-freeze.js')

beforeAll(() => { initDatabase(':memory:') })
afterAll(() => { rmSync(FLEET_FREEZE_PATH, { force: true }) })

describe('startMessageRouter on a fake clock', () => {
  it('reads and delivers while not frozen, does nothing while frozen, and resumes after the lift', async () => {
    vi.useFakeTimers()
    rmSync(FLEET_FREEZE_PATH, { force: true })
    const timer = startMessageRouter()
    try {
      await vi.advanceTimersByTimeAsync(5000)
      const live = pendingSpy.mock.calls.length
      expect(live).toBeGreaterThanOrEqual(1) // positive control: the tick does read the queue

      writeFileSync(FLEET_FREEZE_PATH, '{}')
      await vi.advanceTimersByTimeAsync(20000)
      expect(pendingSpy.mock.calls.length).toBe(live) // frozen: four ticks, zero queue reads

      rmSync(FLEET_FREEZE_PATH)
      await vi.advanceTimersByTimeAsync(5000)
      expect(pendingSpy.mock.calls.length).toBeGreaterThan(live) // lifted: delivery resumes, no restart
    } finally {
      clearInterval(timer)
      vi.useRealTimers()
    }
  })
})
