// Card 17a19228: the guard's per-agent states on disk. What goes in comes out; what is not a state
// this build can act on never reaches decideGuard.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { INITIAL_GUARD_STATE, type GuardState } from '../context-guard.js'
import {
  GUARD_STATE_FILE_VERSION,
  guardStatesBody,
  readGuardStateFile,
  validGuardState,
  writeGuardStateFile,
} from '../web/context-guard-state-file.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const root = tmpDirs()('guardstatefile-')
const T0 = 1_793_520_000_000

const asked: GuardState = {
  phase: 'await-handoff',
  handoffMtimeAtRequest: T0 - 3_600_000,
  deadlineMs: T0 + 20 * 60_000,
  cooldownUntilMs: 0,
  saturatedStreak: 0,
  staleRefreshCount: 1,
  handoffStaleMinutes: null,
  requestedAtMs: T0,
  startThresholdPct: 0.82,
  backgroundDeferSinceMs: T0 + 60_000,
  backgroundPressureSinceMs: null,
  releaseAttempts: 2,
}
const flushing: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-handoff', deadlineMs: T0 + 1, noPressure: true, requestedAtMs: T0 }
const restarted: GuardState = { ...INITIAL_GUARD_STATE, phase: 'await-ready', deadlineMs: T0 + 15 * 60_000, handoffStaleMinutes: 'unknown' }
const cooling: GuardState = { ...INITIAL_GUARD_STATE, phase: 'cooldown', cooldownUntilMs: T0 + 30 * 60_000, handoffStaleMinutes: 12 }

describe('write, then read', () => {
  it('every phase and every optional field comes back as it went in', () => {
    const path = join(root, 'a', 'store', 'state.json')
    const states = new Map<string, GuardState>([['didi', asked], ['boni', flushing], ['ford', restarted], ['zara', cooling], ['atlas', INITIAL_GUARD_STATE]])
    writeGuardStateFile(path, states, T0 + 5)
    const read = readGuardStateFile(path)
    if (typeof read === 'string') throw new Error(`expected a read, got ${read}`)
    expect(read.savedAtMs).toBe(T0 + 5)
    expect(read.dropped).toEqual([])
    expect(Object.fromEntries(read.states)).toEqual(Object.fromEntries(states))
  })

  it('the directory is created; no temp file is left next to the state', () => {
    const path = join(root, 'b', 'deep', 'store', 'state.json')
    writeGuardStateFile(path, new Map([['didi', asked]]), T0)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf-8')).version).toBe(GUARD_STATE_FILE_VERSION)
  })

  it('equal maps give equal text whatever order they were filled in', () => {
    const a = new Map<string, GuardState>([['didi', asked], ['boni', cooling]])
    const b = new Map<string, GuardState>([['boni', cooling], ['didi', asked]])
    expect(guardStatesBody(a)).toBe(guardStatesBody(b))
    expect(guardStatesBody(a)).not.toBe(guardStatesBody(new Map([['didi', asked]])))
  })
})

describe('a file that is not this build\'s', () => {
  it('absent: the ordinary first start', () => {
    expect(readGuardStateFile(join(root, 'nothing-here.json'))).toBe('absent')
  })

  it('corrupt: not JSON, not an object, another version, no savedAtMs, states not a map', () => {
    const path = join(root, 'corrupt.json')
    const good = { version: GUARD_STATE_FILE_VERSION, savedAtMs: T0, states: {} }
    const cases: string[] = [
      '{"version":1,"savedAtMs":17935',
      '',
      'null',
      '[]',
      JSON.stringify({ ...good, version: GUARD_STATE_FILE_VERSION + 1 }),
      JSON.stringify({ ...good, savedAtMs: 'now' }),
      JSON.stringify({ ...good, states: [] }),
      JSON.stringify({ ...good, states: null }),
      JSON.stringify({ version: GUARD_STATE_FILE_VERSION, savedAtMs: T0 }),
    ]
    for (const text of cases) {
      writeFileSync(path, text)
      expect(readGuardStateFile(path), text).toBe('corrupt')
    }
    writeFileSync(path, JSON.stringify(good))
    expect(readGuardStateFile(path)).not.toBe('corrupt')
  })

  it('one unusable entry is dropped BY NAME; the others are kept', () => {
    const path = join(root, 'mixed.json')
    writeFileSync(path, JSON.stringify({
      version: GUARD_STATE_FILE_VERSION,
      savedAtMs: T0,
      states: { didi: asked, boni: { ...asked, phase: 'await-something' }, ford: 'cooldown', zara: cooling },
    }))
    const read = readGuardStateFile(path)
    if (typeof read === 'string') throw new Error(`expected a read, got ${read}`)
    expect([...read.states.keys()].sort()).toEqual(['didi', 'zara'])
    expect(read.dropped.sort()).toEqual(['boni', 'ford'])
  })
})

describe('validGuardState', () => {
  it('a field of the wrong type makes the whole state unusable', () => {
    const bad: Array<Record<string, unknown>> = [
      { phase: 'restarting' },
      { phase: undefined },
      { handoffMtimeAtRequest: '2026-11-11' },
      { handoffMtimeAtRequest: undefined },
      { deadlineMs: null },
      { deadlineMs: Number.NaN },
      { cooldownUntilMs: '0' },
      { saturatedStreak: null },
      { staleRefreshCount: undefined },
      { handoffStaleMinutes: 'stale' },
      { handoffStaleMinutes: undefined },
      { backgroundDeferSinceMs: 'soon' },
      { backgroundPressureSinceMs: true },
      { requestedAtMs: null },
      { startThresholdPct: '0.82' },
      { releaseAttempts: null },
      { noPressure: 1 },
    ]
    for (const change of bad) {
      expect(validGuardState({ ...asked, ...change }), JSON.stringify(change)).toBeNull()
    }
    expect(validGuardState(asked)).toEqual(asked)
    for (const notAState of [null, undefined, 'idle', 7, []]) expect(validGuardState(notAState)).toBeNull()
  })

  it('a field this build does not know is not carried over', () => {
    const got = validGuardState({ ...cooling, somethingNewer: { deep: true } })
    expect(got).toEqual(cooling)
    expect(Object.keys(got ?? {})).not.toContain('somethingNewer')
  })

  it('an absent optional field stays absent: it does not come back as undefined or null', () => {
    const got = validGuardState(JSON.parse(JSON.stringify(INITIAL_GUARD_STATE)))
    expect(got).toEqual(INITIAL_GUARD_STATE)
    expect(Object.keys(got ?? {}).sort()).toEqual(Object.keys(INITIAL_GUARD_STATE).sort())
  })
})
