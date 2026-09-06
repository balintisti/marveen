import { describe, it, expect, beforeEach, vi } from 'vitest'

/** PHASE 1 of the (b) decision is OBSERVE ONLY, so these tests pin two things
 *  the rate would be worthless without:
 *   - the session -> agent inversion, because a wrong one fails EAGER
 *   - that all four verdicts are REACHABLE, because a bucket stuck at exactly
 *     zero would be read as "this never happens" */

let lastSendSecs: number | null = null

vi.mock('../db.js', () => ({
  getDb: () => ({
    prepare: () => ({ get: () => (lastSendSecs == null ? undefined : { created_at: lastSendSecs }) }),
  }),
}))
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}))

const { lastAgentSendAt, probeParkedRecord, PROBE_FRESHNESS_MS } =
  await import('../web/parked-record-probe.js')
const { recordInjectedPrompt, getInjectedPrompt, _resetInjectedPromptsForTest } =
  await import('../web/injected-prompt-registry.js')

const NOW = 1_700_000_000_000

describe('parked-record probe (phase 1)', () => {
  beforeEach(() => {
    _resetInjectedPromptsForTest()
    lastSendSecs = null
  })

  it('a caller that has no agent id is LOUD, and nothing is guessed from the session', () => {
    expect(probeParkedRecord('agent-nobody', null, PROBE_FRESHNESS_MS, NOW)).toBe('unknown-agent')
  })

  /** THE POINT OF THE REFACTOR: the probe must not be able to recover an agent
   *  from the session string. If a future edit reintroduces an inverse, this
   *  goes green for the wrong reason -- so the session here is one that WOULD
   *  parse ('agent-friday') while the caller passes null. */
  it('does NOT fall back to parsing the session when the caller passes null', () => {
    expect(probeParkedRecord('agent-friday', null, PROBE_FRESHNESS_MS, NOW)).toBe('unknown-agent')
  })

  it('reads created_at as SECONDS and hands the gate MILLISECONDS', () => {
    lastSendSecs = 1_700_000_000
    expect(lastAgentSendAt('friday')).toBe(1_700_000_000_000)
  })

  it('no send on record at all reads as null, not as 0', () => {
    lastSendSecs = null
    expect(lastAgentSendAt('friday')).toBeNull()
  })

  it('no record -> no-record', () => {
    expect(probeParkedRecord('agent-friday', 'friday', PROBE_FRESHNESS_MS, NOW)).toBe('no-record')
  })

  it('fresh record, agent silent -> act-on-record', () => {
    recordInjectedPrompt('agent-friday', 'hello', NOW)
    expect(probeParkedRecord('agent-friday', 'friday', PROBE_FRESHNESS_MS, NOW)).toBe('act-on-record')
  })

  it('fresh record, agent spoke after it -> agent-spoke-since', () => {
    recordInjectedPrompt('agent-friday', 'hello', NOW)
    lastSendSecs = Math.floor(NOW / 1000) + 1
    expect(probeParkedRecord('agent-friday', 'friday', PROBE_FRESHNESS_MS, NOW)).toBe('agent-spoke-since')
  })

  /** THE REACHABILITY PIN, and the reason PROBE_FRESHNESS_MS is not just any
   *  number: getInjectedPrompt applies its OWN 10-minute TTL and deletes the
   *  record. If the probe's window were >= that TTL, an aged record would come
   *  back null and land on 'no-record', so 'record-stale' could never be
   *  observed -- the breakdown would report 0 forever and read as "staleness
   *  does not happen". A record older than the window but younger than the TTL
   *  must still be VISIBLE and must classify as stale. */
  it('record-stale is REACHABLE: aged past the window, still inside the registry TTL', () => {
    const aged = NOW - (PROBE_FRESHNESS_MS + 1000)
    recordInjectedPrompt('agent-friday', 'hello', aged)
    expect(getInjectedPrompt('agent-friday', NOW)).not.toBeNull()
    expect(probeParkedRecord('agent-friday', 'friday', PROBE_FRESHNESS_MS, NOW)).toBe('record-stale')
  })
})
