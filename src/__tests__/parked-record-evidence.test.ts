import { describe, it, expect } from 'vitest'
import { parkedRecordVerdict } from '../web/parked-record-evidence.js'

const NOW = 1_700_000_000_000
const FRESH = 5 * 60 * 1000

describe('parkedRecordVerdict: the origin proof that never reads the pane (card c29aaf14)', () => {
  it('names the ONE missing fact, not a boolean -- no record at all', () => {
    expect(parkedRecordVerdict({ recordAt: null, now: NOW, lastAgentSendAt: null, freshnessMs: FRESH }))
      .toBe('no-record')
  })

  it('a record older than the freshness window is not evidence', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - FRESH - 1, now: NOW, lastAgentSendAt: null, freshnessMs: FRESH }))
      .toBe('record-stale')
  })

  it('and the boundary is INSIDE: exactly at the window still counts', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - FRESH, now: NOW, lastAgentSendAt: null, freshnessMs: FRESH }))
      .toBe('act-on-record')
  })

  it('if the agent spoke AFTER we typed, our prompt is not what is sitting there', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - 1000, now: NOW, lastAgentSendAt: NOW - 500, freshnessMs: FRESH }))
      .toBe('agent-spoke-since')
  })

  it('a send in the SAME millisecond counts as spoken -- ties go to inaction', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - 1000, now: NOW, lastAgentSendAt: NOW - 1000, freshnessMs: FRESH }))
      .toBe('agent-spoke-since')
  })

  it('a send BEFORE the record does not disqualify it', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - 1000, now: NOW, lastAgentSendAt: NOW - 1001, freshnessMs: FRESH }))
      .toBe('act-on-record')
  })

  it('the fresh, unanswered record is the only path that acts', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - 1000, now: NOW, lastAgentSendAt: null, freshnessMs: FRESH }))
      .toBe('act-on-record')
  })

  // ORDER MATTERS AND IS PART OF THE CLAIM: a stale record with a later send must
  // report the STALENESS, because that is the fact a reader can act on (widen the
  // window or leave it alone). Reporting 'agent-spoke-since' would send them
  // looking at the wrong table.
  it('staleness is reported before the send, when both are true', () => {
    expect(parkedRecordVerdict({ recordAt: NOW - FRESH - 1, now: NOW, lastAgentSendAt: NOW, freshnessMs: FRESH }))
      .toBe('record-stale')
  })
})
