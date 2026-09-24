// Card 9b28c2f7: the [session-stuck] alert answered two questions with one word. It now
// carries the free evidence for both, from agent_messages:
//   progressing?  -> when the agent last SENT a message
//   inbox served? -> how long the oldest queued message has waited
// Measured on the 19 alerts of 2026-09-17..09-24: 15 had sent a message within 10 min, and
// every alert with a queue had its oldest message waiting 17-134 min.
//
// What this pins beyond "the words appear":
//   - with no evidence the text is BYTE-IDENTICAL to before (every existing caller and
//     router-stuck-alert.test.ts keep their contract);
//   - the 10-minute band has both edges pinned (600 s in, 601 s out);
//   - "never sent" is its own answer, not a zero that reads as "just now";
//   - the DB helper returns the real MAX(created_at) and null for an unknown agent;
//   - the notifier actually PASSES the evidence (otherwise all of the above is inert).
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { initDatabase, createAgentMessage, getLastOutboundMessageAt } from '../db.js'
import { formatStuckSessionAlert, formatStuckEvidence, PROGRESS_BAND_SEC } from '../web/message-router.js'

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

const BUSY_PANE = 'some output\n✻ Precipitating… (41m 8s · ↓ 108.9k tokens · esc to interrupt)\n'
const args = (paneState: 'busy' | 'idle' | null, pane: string | null) =>
  ['dexter', 'marveen', 'agent-dexter', 36 * 60_000, 3, paneState, pane] as const

describe('compatibility: no evidence -> the old text, byte for byte', () => {
  for (const [label, ps, pane] of [['busy', 'busy', BUSY_PANE], ['no pane', null, null]] as const) {
    it(`${label}`, () => {
      const seven = formatStuckSessionAlert(...args(ps, pane))
      const withNull = formatStuckSessionAlert(...args(ps, pane), null)
      expect(seven).not.toBeNull()
      expect(withNull).toBe(seven)
    })
  }
})

describe('the two questions, answered separately', () => {
  it('recent send -> progressing, with the number', () => {
    const t = formatStuckEvidence({ lastOutboundAgoSec: 180, oldestPendingAgeSec: null })
    expect(t).toContain('last SENT a message 3 min ago')
    expect(t).toContain('producing output')
    expect(t).not.toContain('Inbox check')
  })
  it('the band edges: 600 s is inside, 601 s is outside', () => {
    expect(PROGRESS_BAND_SEC).toBe(600)
    expect(formatStuckEvidence({ lastOutboundAgoSec: 600, oldestPendingAgeSec: null })).toContain('producing output')
    expect(formatStuckEvidence({ lastOutboundAgoSec: 601, oldestPendingAgeSec: null })).toContain('sent nothing for 10 min')
  })
  it('silence beyond the band says so and sends the reader to the pane', () => {
    const t = formatStuckEvidence({ lastOutboundAgoSec: 25 * 60, oldestPendingAgeSec: null })
    expect(t).toContain('sent nothing for 25 min')
    expect(t).toContain('read the pane')
  })
  it('"never sent" is its own answer, not a zero', () => {
    const t = formatStuckEvidence({ lastOutboundAgoSec: null, oldestPendingAgeSec: null })
    expect(t).toContain('never sent')
    expect(t).not.toContain('producing output')
  })
  it('a queue gets the inbox clause with the oldest age, and the advice is NOT a restart', () => {
    const t = formatStuckEvidence({ lastOutboundAgoSec: 60, oldestPendingAgeSec: 42 * 60 })
    expect(t).toContain('oldest queued message has waited 42 min')
    expect(t).toContain('NOT landed')
    expect(t).toContain('A restart does not deliver them')
  })
  it('the evidence is appended to the real alert, and the main agent still gets none', () => {
    const ev = { lastOutboundAgoSec: 120, oldestPendingAgeSec: 1800 }
    const full = formatStuckSessionAlert(...args('busy', BUSY_PANE), ev)!
    expect(full.startsWith(formatStuckSessionAlert(...args('busy', BUSY_PANE))!)).toBe(true)
    expect(full).toContain('2 min ago')
    expect(full).toContain('30 min')
    expect(formatStuckSessionAlert('marveen', 'marveen', 's', 60_000, 1, 'busy', BUSY_PANE, ev)).toBeNull()
  })
})

describe('getLastOutboundMessageAt', () => {
  it('returns the latest created_at the agent SENT, and null for an agent that never sent', () => {
    const before = Math.floor(Date.now() / 1000)
    createAgentMessage('tstuck-sender', 'tstuck-rcpt', 'x')
    const t = getLastOutboundMessageAt('tstuck-sender')
    expect(t).not.toBeNull()
    expect(t!).toBeGreaterThanOrEqual(before)
    // a message TO an agent is not a message FROM it
    expect(getLastOutboundMessageAt('tstuck-rcpt')).toBeNull()
    expect(getLastOutboundMessageAt('tstuck-nobody')).toBeNull()
  })
})

describe('wiring: the notifier passes the evidence', () => {
  it('notifyOrchestratorOfStuckSession calls the formatter WITH readStuckEvidence(agent)', () => {
    const src = readFileSync(new URL('../web/message-router.ts', import.meta.url), 'utf-8')
    const i = src.indexOf('function notifyOrchestratorOfStuckSession(')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, src.indexOf('\n}\n', i))
    expect(body).toMatch(/formatStuckSessionAlert\([^)]*readStuckEvidence\(agent\)\)/)
  })
})
