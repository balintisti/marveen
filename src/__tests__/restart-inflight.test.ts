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

  // OVERLAPPING RESTARTS. The guard and an API call can restart the same agent at once;
  // an unconditional clear would let the FIRST finally open the window while the SECOND is
  // still stopped -- the same defect, reached from inside the fix.
  it('stays in flight until the LAST overlapping restart clears', () => {
    markRestartStarted('computress')
    markRestartStarted('computress')
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(true)
    clearRestart('computress')
    expect(isRestartInFlight('computress')).toBe(false)
  })

  // NEGATIVE CONTROL for the refcount: a clear with nothing in flight must not underflow
  // into a state that swallows the next real mark.
  it('a stray clear does not poison the next restart', () => {
    clearRestart('computress')
    markRestartStarted('computress')
    expect(isRestartInFlight('computress')).toBe(true)
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
    const start = body.indexOf('export async function restartAgentProcess')
    expect(start, 'restartAgentProcess not found').toBeGreaterThan(-1)
    // To the next top-level declaration, not a fixed number of characters: the first
    // version sliced 1200 chars and went red when a COMMENT was added above the clear.
    // A test that fails on a comment is noise, and noise is how a guard gets deleted.
    const end = body.indexOf('\nexport ', start + 10)
    const fn = body.slice(start, end === -1 ? undefined : end)
    expect(fn).toContain('markRestartStarted(name)')
    expect(fn).toContain('finally')
    expect(fn).toContain('clearRestart(name)')
    // The await is load-bearing: without it the finally clears the mark before the start
    // finishes, and most of the window reopens while the fix still reads as present.
    expect(fn).toContain('return await startAgentProcess(name, opts)')
    // ORDER, not just presence -- didi mutated this and the test stayed green (comment 12).
    // The mark has to come BEFORE the stop; moved below it, the 446 ms window reopens and
    // every assertion above still passes. `toContain` cannot see position, and position is
    // the entire point of this call. The likely future edit is a tidy-up moving it
    // somewhere "more logical", which is precisely the mutation that survived.
    const markAt = fn.indexOf('markRestartStarted(name)')
    const stopAt = fn.indexOf('stopAgentProcess(name)')
    expect(stopAt, 'stopAgentProcess not found in restartAgentProcess').toBeGreaterThan(-1)
    expect(markAt, 'the mark must be set BEFORE the stop opens the window').toBeLessThan(stopAt)
  })

  it('the reconciler consults it AND skips -- the log line alone is a false success', () => {
    const body = src('channel-monitor.ts')
    const loop = body.slice(body.indexOf('Desired agent not running') - 1500,
                            body.indexOf('Desired agent not running'))
    const callAt = loop.indexOf('isRestartInFlight(name)')
    expect(callAt, 'the reconciler must ask').toBeGreaterThan(-1)
    // AND IT MUST ACT ON THE ANSWER. didi mutated away the `continue`, leaving the check
    // and the log line in place, and this test stayed green (comment 12). That is the worse
    // of the two survivors: the log line is the ONLY thing separating "the race happened
    // and the mark caught it" from "the race did not happen", and after that mutation it
    // PRINTS while the reconciler starts the agent anyway -- the discriminator the closing
    // condition rests on would assert the fix is working at the moment the defect runs.
    // THE BLOCK, not "somewhere after". My first attempt asserted a `continue` anywhere
    // after the check, and didi's mutation STILL survived: the loop has later guards
    // (the 90s grace, the memory gate) whose own `continue` satisfied that. The question
    // is whether THIS branch skips, so the answer has to come from THIS branch.
    const blockStart = loop.indexOf('{', callAt)
    let depth = 0
    let blockEnd = -1
    for (let i = blockStart; i < loop.length; i++) {
      if (loop[i] === '{') depth++
      else if (loop[i] === '}') { depth--; if (depth === 0) { blockEnd = i; break } }
    }
    expect(blockEnd, 'could not read the in-flight branch').toBeGreaterThan(blockStart)
    const branch = loop.slice(blockStart, blockEnd)
    expect(branch, 'the skip should say so in the log').toContain('mid-restart')
    expect(branch, 'the reconciler must SKIP, not merely log').toContain('continue')
  })
})
