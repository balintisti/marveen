import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  markRestartStarted, clearRestart, isRestartInFlight, resetRestartInFlight,
  RESTART_INFLIGHT_MAX_MS,
} from '../web/restart-inflight.js'

// Card f65bc6ef. A saturation restart came back with `--continue` -- the guard asked for
// `{ fresh: true }`, and a DIFFERENT starter won the race: restartAgentProcess stops
// first, and in that window the channel-monitor reconciler started the agent with no
// options at all. Measured live on computress, 2026-08-29 03:07, three consecutive log
// lines 0.6 seconds apart.

beforeEach(() => resetRestartInFlight())

describe('the in-flight registry', () => {
  it('reports an agent as in flight between mark and clear', () => {
    expect(isRestartInFlight('computress')).toBe(false)
    markRestartStarted('computress')
    expect(isRestartInFlight('computress')).toBe(true)
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(false)
  })

  // NEGATIVE CONTROL: marking one agent must not answer for another, or the reconciler
  // would stop rescuing the whole fleet the moment anyone restarts.
  it('answers per agent, not globally', () => {
    markRestartStarted('computress')
    expect(isRestartInFlight('dexter')).toBe(false)
  })

  // THE FAILURE DIRECTION. A leaked mark -- a crash between mark and clear -- must not
  // make the reconciler refuse forever; that would turn a half-second race into an
  // outage. The literal is deliberate: computing it from the constant would move with it
  // and pin nothing (that mutation survived on another card tonight).
  it('expires a leaked mark instead of latching', () => {
    const t0 = 1_800_000_000_000
    markRestartStarted('computress', t0)
    expect(isRestartInFlight('computress', t0 + 119_000)).toBe(true)
    expect(isRestartInFlight('computress', t0 + 121_000)).toBe(false)
    expect(RESTART_INFLIGHT_MAX_MS).toBe(2 * 60_000)
  })

  it('forgets the expired entry rather than re-answering it every tick', () => {
    const t0 = 1_800_000_000_000
    markRestartStarted('computress', t0)
    expect(isRestartInFlight('computress', t0 + 121_000)).toBe(false)
    // Back inside the window in wall-clock terms, but the entry is gone: an expiry that
    // left the row would flip back to true and read as a second restart.
    expect(isRestartInFlight('computress', t0 + 1_000)).toBe(false)
  })
})

// STRUCTURAL, and it says so. The two call sites are what the fix consists of, and
// neither is reachable from a test: restartAgentProcess drives tmux, and the reconciler
// is not exported. Nothing in the suite would notice either one being removed -- measured
// on a different card tonight, where a reverted call site passed all 4637 tests.
describe('both ends are wired (structural)', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '..', 'web', p), 'utf8')

  it('restartAgentProcess marks and clears around the stop/start window', () => {
    const body = src('agent-process.ts')
    const fn = body.slice(body.indexOf('export async function restartAgentProcess'))
      .slice(0, 1200)
    expect(fn).toContain('markRestartStarted(name)')
    expect(fn).toContain('finally')
    expect(fn).toContain('clearRestart(name)')
  })

  it('the reconciler consults it before starting a desired agent', () => {
    const body = src('channel-monitor.ts')
    const loop = body.slice(body.indexOf('Desired agent not running') - 1500,
                            body.indexOf('Desired agent not running'))
    expect(loop).toContain('isRestartInFlight(name)')
  })
})
