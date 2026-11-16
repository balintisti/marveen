import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { atomicWriteFileSync } from './atomic-write.js'
import type { CardBoundary, GuardPhase, GuardState, HandoffStaleness } from '../context-guard.js'

// THE GUARD'S SEQUENCES ON DISK (card 17a19228).
//
// The guard's per-agent state lived only in the dashboard's memory, on the reasoning that a
// dashboard restart re-arming everyone at 'idle' costs "a repeated handoff request" at worst. It
// costs more: an agent that was asked to STOP, obeyed, and waits for the restart the request
// promised is in await-handoff; a dashboard restart forgot that, the context was below the
// threshold by then or the guard cooled down, and nothing ever restarted or released the agent
// (measured 2026-11-10: didi idle for 53 minutes behind an obeyed request).
//
// So the map is mirrored into one JSON file on every change and read back when the runner starts.
// A file, not a table: the runner's tests replace db.js with hand-written factories, and a state
// that has to survive exactly one thing -- this process ending -- needs nothing a file cannot do.
//
// WHAT IS NOT IN IT: the runner's other in-memory records (the daily slot's last-served stamp,
// the last guard restart for the boot-wedge rescue, the rescue-failure streak). They restart
// empty, as before.

export const GUARD_STATE_FILE_VERSION = 1

const PHASES: readonly GuardPhase[] = ['idle', 'await-handoff', 'await-ready', 'cooldown']

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optNum = (v: unknown): boolean => v === undefined || num(v)
const optNumOrNull = (v: unknown): boolean => v === undefined || v === null || num(v)

/** The card boundary of a card-aligned restart (card 00262e3f), or null when it is not one. */
function validCardBoundary(raw: unknown): CardBoundary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r['cardId'] !== 'string' || r['cardId'] === '' || typeof r['toStatus'] !== 'string' || !num(r['movedAtMs'])) return null
  return { cardId: r['cardId'], toStatus: r['toStatus'], movedAtMs: r['movedAtMs'] }
}

/**
 * One state as read from the file, or null when it is not a state this build can act on. Only the
 * known fields are carried over: a field a later build adds is dropped by an older one, never
 * handed to decideGuard unchecked.
 */
export function validGuardState(raw: unknown): GuardState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!PHASES.includes(r['phase'] as GuardPhase)) return null
  if (!(r['handoffMtimeAtRequest'] === null || num(r['handoffMtimeAtRequest']))) return null
  if (!num(r['deadlineMs']) || !num(r['cooldownUntilMs'])) return null
  if (!num(r['saturatedStreak']) || !num(r['staleRefreshCount'])) return null
  const stale = r['handoffStaleMinutes']
  if (!(stale === null || stale === 'unknown' || num(stale))) return null
  if (!optNumOrNull(r['backgroundDeferSinceMs']) || !optNumOrNull(r['backgroundPressureSinceMs'])) return null
  if (!optNum(r['requestedAtMs']) || !optNum(r['startThresholdPct']) || !optNum(r['releaseAttempts'])) return null
  if (!optNum(r['apiErrorResends']) || !optNum(r['apiErrorHeldResumes']) || !optNum(r['apiErrorHeldResumedAtMs'])) return null
  if (!(r['noPressure'] === undefined || typeof r['noPressure'] === 'boolean')) return null
  // A boundary that does not read back is not dropped on its own: without it the fresh session
  // would be sent to a HANDOFF.md nobody wrote. The whole state is refused, and the caller says so.
  const cardRestart = r['cardRestart'] === undefined ? undefined : validCardBoundary(r['cardRestart'])
  if (cardRestart === null) return null
  const state: GuardState = {
    phase: r['phase'] as GuardPhase,
    handoffMtimeAtRequest: r['handoffMtimeAtRequest'] as number | null,
    deadlineMs: r['deadlineMs'] as number,
    cooldownUntilMs: r['cooldownUntilMs'] as number,
    saturatedStreak: r['saturatedStreak'] as number,
    staleRefreshCount: r['staleRefreshCount'] as number,
    handoffStaleMinutes: stale as HandoffStaleness,
  }
  if (r['backgroundDeferSinceMs'] !== undefined) state.backgroundDeferSinceMs = r['backgroundDeferSinceMs'] as number | null
  if (r['backgroundPressureSinceMs'] !== undefined) state.backgroundPressureSinceMs = r['backgroundPressureSinceMs'] as number | null
  if (r['noPressure'] !== undefined) state.noPressure = r['noPressure'] as boolean
  if (r['requestedAtMs'] !== undefined) state.requestedAtMs = r['requestedAtMs'] as number
  if (r['startThresholdPct'] !== undefined) state.startThresholdPct = r['startThresholdPct'] as number
  if (r['releaseAttempts'] !== undefined) state.releaseAttempts = r['releaseAttempts'] as number
  if (r['apiErrorResends'] !== undefined) state.apiErrorResends = r['apiErrorResends'] as number
  if (r['apiErrorHeldResumes'] !== undefined) state.apiErrorHeldResumes = r['apiErrorHeldResumes'] as number
  if (r['apiErrorHeldResumedAtMs'] !== undefined) state.apiErrorHeldResumedAtMs = r['apiErrorHeldResumedAtMs'] as number
  if (cardRestart !== undefined) state.cardRestart = cardRestart
  return state
}

export interface GuardStateFileRead {
  /** When the file was last written. */
  savedAtMs: number
  states: Map<string, GuardState>
  /** Agents whose entry was not a usable state: they start idle, and the caller says so. */
  dropped: string[]
}

/**
 * `'absent'`: no file, the ordinary first start. `'corrupt'`: a file that is not this build's
 * (not JSON, another version, no states): nothing in it is used.
 */
export function readGuardStateFile(path: string): GuardStateFileRead | 'absent' | 'corrupt' {
  if (!existsSync(path)) return 'absent'
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return 'corrupt'
  }
  if (!parsed || typeof parsed !== 'object') return 'corrupt'
  const p = parsed as Record<string, unknown>
  const rawStates = p['states']
  if (p['version'] !== GUARD_STATE_FILE_VERSION || !num(p['savedAtMs']) || !rawStates || typeof rawStates !== 'object' || Array.isArray(rawStates)) {
    return 'corrupt'
  }
  const states = new Map<string, GuardState>()
  const dropped: string[] = []
  for (const [name, raw] of Object.entries(rawStates as Record<string, unknown>)) {
    const state = validGuardState(raw)
    if (state) states.set(name, state)
    else dropped.push(name)
  }
  return { savedAtMs: p['savedAtMs'] as number, states, dropped }
}

/** The states as they go into the file, in a fixed order: equal maps give equal text. */
export function guardStatesBody(states: ReadonlyMap<string, GuardState>): string {
  return JSON.stringify(Object.fromEntries([...states].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))))
}

/** Throws when the file cannot be written; the caller decides what a failed write is worth. */
export function writeGuardStateFile(path: string, states: ReadonlyMap<string, GuardState>, nowMs: number): void {
  mkdirSync(dirname(path), { recursive: true })
  atomicWriteFileSync(path, `{"version":${GUARD_STATE_FILE_VERSION},"savedAtMs":${nowMs},"states":${guardStatesBody(states)}}\n`)
}
