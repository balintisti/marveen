import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideIdleAlert, type IdleAgentInput, type IdleAgentState, type IdleAgentThresholds } from '../idle-agent.js'

// CARD 03cdad67 (marveen, measured 2026-11-17 on jarvis). The guard said "39, then 69 minutes idle,
// I woke it and it did not move" while the pane showed turns finished at 20:59 and 21:32. The pane
// is sampled every three minutes, and a spell ends only when a sample sees it busy: a short turn
// that answers the wake between two samples was invisible, so stage 2 fired about an agent that had
// moved. The fix bounds the spell by the last model response read from the transcript.

const TH: IdleAgentThresholds = {
  sustainedMs: 10 * 60_000,
  realertMs: 30 * 60_000,
  wakeGraceMs: 15 * 60_000,
  wakeCooldownMs: 30 * 60_000,
}
const base: IdleAgentInput = { agent: 'jarvis', running: true, paneIdle: true, pendingMessages: 0, ownWorkCount: 12 }
const at = (t: number) => t * 60_000
// The spell opened at minute 0 and the wake went out at minute 10, inside it.
const woken: IdleAgentState = { idleSinceMs: at(0), lastAlertAt: null, lastWakeAt: at(10) }

describe('the idle spell starts no earlier than the last turn', () => {
  it('CONTROL: an agent that did not answer the wake still reaches stage 2', () => {
    // Its last response (minute 5) is older than the wake (minute 10): it really did not move. The
    // turn still bounds the spell, so the minutes reported are counted from it.
    const r = decideIdleAlert({ ...base, lastModelResponseMs: at(5) }, woken, TH, at(26))
    expect(r.decision).toMatchObject({ alert: true, reason: 'idle-with-work', idleForMs: at(26) - at(5) })
  })

  it('not measured (remote agent, no transcript) keeps the sampled spell, as before', () => {
    for (const lastModelResponseMs of [undefined, null]) {
      const r = decideIdleAlert({ ...base, lastModelResponseMs }, woken, TH, at(26))
      expect(r.decision).toMatchObject({ alert: true, reason: 'idle-with-work', idleForMs: at(26) })
    }
  })

  it('a turn after the wake that no sample saw is NOT "the wake did not take"', () => {
    const r = decideIdleAlert({ ...base, lastModelResponseMs: at(12) }, woken, TH, at(26))
    expect(r.decision.alert).toBe(false)
    expect(r.decision.reason).not.toBe('idle-with-work')
    // The spell restarts at the turn, so the wake is now older than the spell: stage 1 again.
    expect(r.next.idleSinceMs).toBe(at(12))
    expect(r.next.lastAlertAt).toBeNull()
  })

  it('the replay of the jarvis evening: wake, a turn between samples, no alarm', () => {
    // Spell sampled from 20:35, the wake at 20:45, the turn ended 20:59, the alarm tick 21:14 (minute 39).
    const evening: IdleAgentState = { idleSinceMs: at(0), lastAlertAt: null, lastWakeAt: at(10) }
    const r = decideIdleAlert({ ...base, lastModelResponseMs: at(24) }, evening, TH, at(39))
    expect(r.decision).toEqual({ alert: false, reason: 'wake-cooling-down' })
  })

  it('after the restart the next wake and the next alarm count from the turn, not from the old spell', () => {
    // The turn at minute 12 restarted the spell; the agent then stands with the same list.
    const s1 = decideIdleAlert({ ...base, lastModelResponseMs: at(12) }, woken, TH, at(26)).next
    // Past the cooldown, a CHANGED list earns a new wake...
    const wake = decideIdleAlert({ ...base, lastModelResponseMs: at(12), ownWorkIds: ['x'] }, s1, TH, at(41))
    expect(wake.decision).toMatchObject({ alert: true, reason: 'wake-agent', idleForMs: at(41) - at(12) })
    // ...and if THAT wake is not answered, stage 2 fires, its minutes counted from the turn.
    const alarm = decideIdleAlert({ ...base, lastModelResponseMs: at(12), ownWorkIds: ['x'] }, wake.next, TH, at(57))
    expect(alarm.decision).toMatchObject({ alert: true, reason: 'idle-with-work', idleForMs: at(57) - at(12) })
  })

  it('a response stamped in the future is ignored, not trusted', () => {
    const r = decideIdleAlert({ ...base, lastModelResponseMs: at(90) }, woken, TH, at(26))
    expect(r.decision).toMatchObject({ alert: true, reason: 'idle-with-work' })
    expect(r.next.idleSinceMs).toBe(at(0))
  })

  it('a turn older than the sampled start does not move the spell back', () => {
    const r = decideIdleAlert({ ...base, lastModelResponseMs: at(-30) }, woken, TH, at(26))
    expect(r.next.idleSinceMs).toBe(at(0))
  })
})

// A SOURCE ASSERTION (see idle-watcher-wiring.test.ts for its limit): the decision above is only
// reachable if the tick reads the transcript and hands the value over.
describe('the tick feeds the last turn to the decision', () => {
  const SRC = readFileSync(join(__dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf-8')
  it('reads it on an idle pane with an open spell, and passes it on', () => {
    expect(SRC).toMatch(/const lastModelResponseMs = running && paneRead\.idle && state\.idleSinceMs != null\s*\?\s*lastModelResponseAt\(agent\)/)
    expect(SRC).toMatch(/decideIdleAlert\(\s*\{[\s\S]*?\n\s*lastModelResponseMs,\n[\s\S]*?\},\s*state,/)
  })
  it('lastModelResponseAt reads the same transcript the API-error progress reads', () => {
    expect(SRC).toMatch(/export function lastModelResponseAt\(agent: string\)[\s\S]{0,200}readAgentRemoteHost\(agent\)[\s\S]{0,80}return null[\s\S]{0,40}readLastModelResponseMs\(agent === MAIN_AGENT_ID \? PROJECT_ROOT : agentDir\(agent\), configDirFor\(agent\)\)/)
  })
})
