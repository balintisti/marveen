import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectTransitions, readQuotaSourceState, transitionMessage } from '../data-source-alarm.js'

// Cards 0114968c + 2b1e373a. Three data sources can fail quietly, and every one
// of them fails INTO the shape of calm: a 403 calendar renders as "no upcoming
// events", a broken IMAP fetch as "no new mail", and a quota meter that falls
// back to `estimate` stops pace-alerting ENTIRELY -- so the alerting system's
// own outage looks like "nothing to report".
//
// The decision (Marveen, 2026-08-22 22:57) was EDGE-triggered, to the
// COORDINATOR: once on failure, once on recovery, and never to the owner --
// he needs a working briefing at 07:30, not a 2 a.m. buzz about something he
// cannot act on. What these tests pin is the "once" part, because that is the
// half that decays: a level-triggered version starts as a useful alert and ends
// as a rule everyone mutes.

function tmpState(): string {
  return join(mkdtempSync(join(tmpdir(), 'dsalarm-')), 'state.json')
}

const NOW = 1_700_000_000

describe('detectTransitions -- once on the edge, not once per round', () => {
  it('says NOTHING the first time it sees a healthy source', () => {
    // Otherwise every fresh install -- and every lost state file -- would
    // announce "recovered" for things that were never broken.
    const p = tmpState()
    expect(detectTransitions({ calendar: { ok: true, error: null } }, NOW, p)).toHaveLength(0)
  })

  it('reports a source that is broken the first time it is seen', () => {
    const p = tmpState()
    const out = detectTransitions({ email: { ok: false, error: 'ConnectionRefused' } }, NOW, p)
    expect(out).toHaveLength(1)
    expect(out[0].message).toContain('email')
    expect(out[0].message).toContain('ELROMLOTT')
    expect(out[0].message).toContain('ConnectionRefused')
  })

  it('does NOT repeat while the source stays broken -- three days is ONE message', () => {
    // The whole point of edge-triggering. A level-triggered alarm would send
    // seventy of these over a long weekend, and the seventy-first would arrive
    // to a muted channel.
    const p = tmpState()
    expect(detectTransitions({ quota: { ok: false, error: 'source=estimate' } }, NOW, p)).toHaveLength(1)
    expect(detectTransitions({ quota: { ok: false, error: 'source=estimate' } }, NOW + 3600, p)).toHaveLength(0)
    expect(detectTransitions({ quota: { ok: false, error: 'source=estimate' } }, NOW + 3 * 86400, p)).toHaveLength(0)
  })

  it('reports the recovery exactly once, and says how long it was down', () => {
    const p = tmpState()
    detectTransitions({ calendar: { ok: false, error: 'HTTP 403' } }, NOW, p)
    const back = detectTransitions({ calendar: { ok: true, error: null } }, NOW + 5 * 3600, p)
    expect(back).toHaveLength(1)
    expect(back[0].message).toContain('HELYREALLT')
    expect(back[0].message).toContain('5 ora')
    expect(detectTransitions({ calendar: { ok: true, error: null } }, NOW + 6 * 3600, p)).toHaveLength(0)
  })

  it('a CHANGED REASON on an unchanged state is not a new event', () => {
    // One message per transition, not per wording. A backend that rotates its
    // error text must not turn into a message stream.
    const p = tmpState()
    detectTransitions({ email: { ok: false, error: 'timeout' } }, NOW, p)
    const again = detectTransitions({ email: { ok: false, error: 'ECONNRESET' } }, NOW + 600, p)
    expect(again).toHaveLength(0)
    // ...but the newer reason is remembered, so a later report is not stale.
    expect(readFileSync(p, 'utf8')).toContain('ECONNRESET')
  })

  it('handles several sources independently in one round', () => {
    const p = tmpState()
    const out = detectTransitions({
      calendar: { ok: false, error: 'HTTP 403' },
      email: { ok: true, error: null },
      quota: { ok: false, error: 'source=estimate' },
    }, NOW, p)
    expect(out.map((t) => t.source).sort()).toEqual(['calendar', 'quota'])
  })

  it('treats a CORRUPT state file as empty -- noisy at worst, never silent', () => {
    // The direction of this error matters more than the error: re-announcing a
    // failure costs one message; swallowing it costs the whole alarm.
    const p = tmpState()
    writeFileSync(p, '{ not json')
    expect(detectTransitions({ email: { ok: false, error: 'boom' } }, NOW, p)).toHaveLength(1)
  })

  it('writes its state atomically and leaves no .tmp behind', () => {
    const p = tmpState()
    detectTransitions({ email: { ok: false, error: 'boom' } }, NOW, p)
    expect(existsSync(p)).toBe(true)
    expect(existsSync(`${p}.tmp`)).toBe(false)
  })
})

describe('transitionMessage -- what the coordinator actually reads', () => {
  it('names the source and the reason, because "something broke" is not actionable', () => {
    const m = transitionMessage('quota', undefined, { ok: false, error: 'source=estimate' }, NOW)
    expect(m).toContain('quota')
    expect(m).toContain('source=estimate')
  })

  it('says out loud that it will not repeat, so silence is not read as recovery', () => {
    const m = transitionMessage('calendar', undefined, { ok: false, error: 'x' }, NOW) ?? ''
    expect(m).toMatch(/EGYSZER szol/)
  })
})

describe('readQuotaSourceState -- which meter states still carry alerting', () => {
  function withLatest(json: string): string {
    const p = join(mkdtempSync(join(tmpdir(), 'dsq-')), 'usage-latest.json')
    writeFileSync(p, json)
    return p
  }

  it('authoritative is healthy', () => {
    expect(readQuotaSourceState(withLatest('{"claude":{"ok":true,"source":"authoritative"}}'))).toEqual({ ok: true, error: null })
  })

  it('authoritative_cached is ALSO healthy -- it still yields pace windows', () => {
    // Degraded is not out. Alerting survives a cached snapshot; treating it as
    // a failure would send a message for a system that is still doing its job.
    expect(readQuotaSourceState(withLatest('{"claude":{"ok":true,"source":"authoritative_cached"}}'))?.ok).toBe(true)
  })

  it('estimate is NOT healthy -- this is the state where alerting stops entirely', () => {
    const s = readQuotaSourceState(withLatest('{"claude":{"ok":true,"source":"estimate","auth_error":"401"}}'))
    expect(s?.ok).toBe(false)
    expect(s?.error).toContain('estimate')
    expect(s?.error).toContain('401')
  })

  it('returns null when there is no snapshot at all, rather than inventing health', () => {
    expect(readQuotaSourceState(join(tmpdir(), 'nincs-ilyen-usage-latest.json'))).toBeNull()
  })
})

describe('the heartbeat wiring', () => {
  const src = readFileSync(join(__dirname, '..', 'heartbeat.ts'), 'utf-8')

  it('runs the alarm BEFORE the shouldNotify gate', () => {
    // If it ran after, the alarm would go quiet exactly when the broken source
    // is the reason there is nothing else to report -- a failed calendar makes
    // `calendar.length === 0`, which is itself one of the gate's conditions.
    const alarmAt = src.indexOf('detectTransitions(')
    const gateAt = src.indexOf('if (!shouldNotify(data))')
    expect(alarmAt).toBeGreaterThan(-1)
    expect(alarmAt).toBeLessThan(gateAt)
  })

  it('sends to the COORDINATOR, not to the owner channel', () => {
    expect(src).toMatch(/createAgentMessage\('system', MAIN_AGENT_ID/)
    // notifyTelegram is the owner path; the alarm must not use it.
    const block = src.slice(src.indexOf('detectTransitions('), src.indexOf('if (!shouldNotify(data))'))
    expect(block).not.toMatch(/notifyTelegram/)
  })

  it('never lets an alarm failure stop the heartbeat', () => {
    const block = src.slice(src.indexOf('EL-VEZERELT ADATFORRAS'), src.indexOf('if (!shouldNotify(data))'))
    expect(block).toMatch(/catch \(err\)/)
  })
})
