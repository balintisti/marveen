/**
 * Is the Google access still alive? All three legs, read-only, as JSON.
 *
 * WHY THIS EXISTS (2026-08-22). The calendar, Drive and mail access were set
 * up on 2026-08-20 and verified once, by hand. Nothing in the running system
 * has exercised Drive since -- `listDriveFiles`, `readDriveFileText` and
 * `createDriveDoc` have ZERO callers in src/ -- so that leg can rot for weeks
 * and the first person to notice would be whoever finally needs a file. The
 * calendar leg had a version of the same problem: it was reachable all along
 * on 2026-08-22 while the morning briefing told Isti it was not.
 *
 * A capability nobody exercises is a capability nobody is measuring. This is
 * the exerciser: `scripts/doctor.sh` runs it, and it answers per leg, by name.
 *
 * READ-ONLY BY CONSTRUCTION. It lists, it never writes -- no probe document,
 * no test event. The write scope (`drive.file`) is therefore NOT covered here,
 * and that is stated in the output rather than left to be assumed: a health
 * check that quietly tests less than it appears to is the same failure as the
 * one it was built to catch.
 *
 * Usage:  node dist/google-health-cli.js
 * Output: {"ok":true|false,"legs":{"calendar":{...},"drive":{...},"mail":{...}}}
 *         `ok` is true only when ALL THREE legs are ok. Always exit 0.
 */
process.env.LOG_LEVEL = 'silent'

const { fetchCalendarEvents, listDriveFiles, hasServiceAccount } = await import('./google-api.js')
const { HEARTBEAT_CALENDAR_ID, PROJECT_ROOT } = await import('./config.js')
const { execFileSync } = await import('node:child_process')
const { join } = await import('node:path')

interface Leg {
  ok: boolean
  detail: string
}

function short(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.replace(/\s+/g, ' ').trim().slice(0, 160)
}

async function checkCalendar(): Promise<Leg> {
  const now = new Date()
  const res = await fetchCalendarEvents(HEARTBEAT_CALENDAR_ID, now, new Date(now.getTime() + 864e5))
  if (!res.ok) return { ok: false, detail: res.error }
  // The COUNT is not the health signal: zero events is a normal Tuesday. That
  // the call answered at all is the signal, so say what was read, not how much.
  return { ok: true, detail: `${HEARTBEAT_CALENDAR_ID}: olvashato (${res.events.length} esemeny 24 oran belul)` }
}

async function checkDrive(): Promise<Leg> {
  try {
    const files = await listDriveFiles(undefined, 5)
    // An empty Drive listing is genuinely ambiguous on a service account -- it
    // sees only what was SHARED with it -- so zero is reported as a warning
    // state, not as health. `ok:false` would be wrong (the API answered);
    // silence would be worse.
    if (files.length === 0) {
      return { ok: false, detail: 'a hivas sikerult, de NULLA fajl lathato -- a szolgaltatasfiokkal valoszinuleg nincs megosztva semmi' }
    }
    return { ok: true, detail: `${files.length} fajl lathato (elso: ${files[0]?.name ?? '?'})` }
  } catch (err) {
    return { ok: false, detail: short(err) }
  }
}

function checkMail(): Leg {
  try {
    const out = execFileSync(
      'python3',
      [join(PROJECT_ROOT, 'scripts', 'gmail-recent.py'), '--minutes', '60', '--limit', '1'],
      { encoding: 'utf-8', timeout: 60_000, stdio: ['ignore', 'pipe', 'ignore'] },
    )
    const parsed = JSON.parse(out) as { ok: boolean; error?: string; messages?: unknown[] }
    if (!parsed.ok) return { ok: false, detail: parsed.error ?? 'ismeretlen hiba' }
    return { ok: true, detail: `IMAP valaszol (${parsed.messages?.length ?? 0} level az utolso oraban)` }
  } catch (err) {
    return { ok: false, detail: short(err) }
  }
}

const legs = {
  calendar: await checkCalendar(),
  drive: await checkDrive(),
  mail: checkMail(),
}

process.stdout.write(
  JSON.stringify({
    ok: legs.calendar.ok && legs.drive.ok && legs.mail.ok,
    via: process.env.GOOGLE_HEALTH_VIA ?? 'direct',
    auth: hasServiceAccount() ? 'service-account' : 'oauth-token',
    not_covered: 'iras (drive.file scope) -- ez az ellenorzes szandekosan csak olvas',
    legs,
  }) + '\n',
)
process.exit(0)
