import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripComments } from './helpers/strip-comments.js'
import { detectTransitions, readQuotaSourceState, transitionMessage, QUOTA_SNAPSHOT_MAX_AGE_MIN } from '../data-source-alarm.js'

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

  it('a STALE snapshot is a failure even when it still says authoritative', () => {
    // Marveen's condition on decision (B): the alarm reads a file that a
    // scheduled task refreshes. If the task stops, the file stops changing --
    // and a check that only looked at `source` would happily report the last
    // known GOOD value forever, pushing the silent failure one level up.
    // A stale file saying "authoritative" is a sentence about a world that may
    // be hours old.
    const now = Date.parse('2026-08-23T05:00:00Z')
    const p = withLatest('{"generated_at":"2026-08-23T04:00:00Z","claude":{"ok":true,"source":"authoritative"}}')
    const s = readQuotaSourceState(p, now)
    expect(s?.ok).toBe(false)
    expect(s?.error).toContain('elavult')
    expect(s?.error).toContain('60 perce')
  })

  it('a FRESH snapshot is fine -- the threshold must not alarm on ordinary jitter', () => {
    // One missed 10-minute run is normal; two is a pattern. The threshold sits
    // above two misses so that a slow API call does not produce a message.
    const now = Date.parse('2026-08-23T05:00:00Z')
    const p = withLatest('{"generated_at":"2026-08-23T04:45:00Z","claude":{"ok":true,"source":"authoritative"}}')
    expect(readQuotaSourceState(p, now)?.ok).toBe(true)
    expect(QUOTA_SNAPSHOT_MAX_AGE_MIN).toBeGreaterThan(20)
  })

  it('an unreadable timestamp is a failure, not a silent pass', () => {
    // A snapshot whose time we cannot parse is a snapshot whose age we do not
    // know -- and "we do not know" is the state this alarm exists to report.
    const s = readQuotaSourceState(withLatest('{"generated_at":"tegnap","claude":{"ok":true,"source":"authoritative"}}'), Date.now())
    expect(s?.ok).toBe(false)
    expect(s?.error).toContain('nem ertelmezheto')
  })

  it('a snapshot with NO timestamp field is judged on its source alone', () => {
    // Backward compatibility: an older meter that never wrote generated_at must
    // not be reported as broken just for being old-format.
    expect(readQuotaSourceState(withLatest('{"claude":{"ok":true,"source":"authoritative"}}'), Date.now())?.ok).toBe(true)
  })

  it('returns null when there is no snapshot at all, rather than inventing health', () => {
    expect(readQuotaSourceState(join(tmpdir(), 'nincs-ilyen-usage-latest.json'))).toBeNull()
  })
})

describe('the heartbeat wiring', () => {
  // COMMENT-STRIPPED, AND THAT IS THE POINT (didi's finding, 2026-08-23).
  // These three assertions locate code by text position. A comment is text, so
  // an explanation that merely MENTIONS `detectTransitions(` would anchor the
  // search at the prose instead of the call -- and the guard would then pass on
  // a file where the call had moved behind the gate. The alarm block here is
  // preceded by exactly that kind of explanatory comment.
  //
  // The third assertion had a sharper version of the same defect: its anchor
  // WAS a comment (`EL-VEZERELT ADATFORRAS`), so stripping comments would have
  // left it searching for text that no longer exists. It now anchors on code.
  //
  // WHAT THIS DOES NOT CLAIM. Didi measured that the whole block could be moved
  // behind the gate with all 17 tests green. That result did NOT reproduce --
  // re-run at didi's own commit (5440689) in an isolated copy, the move fails 2
  // of 17, the ordering assertion among them. So this is not a hole being
  // closed; it is a LATENT trap being removed before a future comment walks
  // into it. The concern was right even though the measurement did not hold.
  const src = stripComments(readFileSync(join(__dirname, '..', 'heartbeat.ts'), 'utf-8'))
  const GATE = 'if (!shouldNotify(data))'

  it('runs the alarm BEFORE the shouldNotify gate', () => {
    // If it ran after, the alarm would go quiet exactly when the broken source
    // is the reason there is nothing else to report -- a failed calendar makes
    // `calendar.length === 0`, which is itself one of the gate's conditions.
    const alarmAt = src.indexOf('detectTransitions(')
    const gateAt = src.indexOf(GATE)
    expect(alarmAt).toBeGreaterThan(-1)
    expect(gateAt).toBeGreaterThan(-1)
    expect(alarmAt).toBeLessThan(gateAt)
  })

  it('sends to the COORDINATOR, not to the owner channel', () => {
    expect(src).toMatch(/createAgentMessage\('system', MAIN_AGENT_ID/)
    // notifyTelegram is the owner path; the alarm must not use it.
    const block = src.slice(src.indexOf('detectTransitions('), src.indexOf(GATE))
    expect(block).not.toMatch(/notifyTelegram/)
  })

  it('never lets an alarm failure stop the heartbeat', () => {
    // Anchored on the first line of the alarm block ITSELF, not on the comment
    // above it: a comment anchor cannot survive comment stripping, and an
    // anchor that vanishes turns this into a slice of the wrong region.
    const startAt = src.indexOf('readQuotaSourceState()')
    expect(startAt).toBeGreaterThan(-1)
    const block = src.slice(startAt, src.indexOf(GATE))
    expect(block).toMatch(/catch \(err\)/)
  })

  it('POSITIVE CONTROL: a comment mentioning the call cannot move the anchor', () => {
    // Without this, the hardening above is a claim rather than a property. The
    // raw source is anchored by the comment; the stripped source is not.
    const raw = [
      '// a comment that mentions detectTransitions( before the real one',
      'if (!shouldNotify(data)) { return }',
      'detectTransitions({}, 0)',
    ].join('\n')
    expect(raw.indexOf('detectTransitions(')).toBeLessThan(raw.indexOf(GATE))
    const code = stripComments(raw)
    expect(code.indexOf('detectTransitions(')).toBeGreaterThan(code.indexOf(GATE))
  })
})

// A HUZAL TESZTJE ATKERULT A `command-task-quota-hook.test.ts`-BE, ES EZ NEM
// ATSZERVEZES VOLT (2026-08-23).
//
// Itt korabban harom FORRASSZOVEGET grepelo allitas allt: `readQuotaSourceState()`
// karakterre, plusz a hivas es a korai return sorrendje `indexOf`-fal. Stand-in
// volt, amig a `runCommandTask`-nak egyaltalan nem letezett tesztje -- es
// pontosan ugy bukott meg, ahogy az ilyen teszt szokott: egy HELYES javitas
// torte el.
//
// Amikor a hook ket ora helyett egyre allt at (`readQuotaSourceState(undefined, now)`),
// a viselkedes JOBB lett, a grep viszont pirosra valtott. Egy teszt, ami a
// helyesbitest jelenti hibanak, arra tanit, hogy a teszt a zaj -- es a kovetkezo
// VALODI talalatat is annak fogja nezni valaki. Ugyanaz az alak, amit a repo
// CLAUDE.md-je a migracios checklistnel mar kimond ("egy ellenorzes, ami a
// helyes megoldast jeloli hibanak, rosszabb, mint a semmi").
//
// A helyettesitok VISELKEDEST mernek, a valodi riaszto-modullal es egy
// ideiglenes store-konyvtarral: a hook barmelyik command-taskra tuzel (nem nev
// szerint kotott), a koordinatorhoz kuld, es akkor is fut, amikor a task maga
// "nincs teendo"-t mond -- vagyis a korai return ELOTT.
