/**
 * EL-VEZERELT riasztas az adatforrasok romlasara es helyreallasara.
 *
 * WHY (cards 0114968c + 2b1e373a, decided 2026-08-22 22:57). Three data
 * sources can fail quietly, and each failure looks exactly like calm:
 *   calendar -- a 403 rendered as "Nincs kozelgo esemeny."
 *   email    -- a broken IMAP fetch rendered as "Nincs uj level."
 *   quota    -- when the meter falls back to `estimate`, pace alerting stops
 *               ENTIRELY (`_iter_pace_windows` never yields from an estimate),
 *               so the ALERTING SYSTEM's own outage looks like "nothing to
 *               report", and command-task-health still says lastStatus: ok.
 *
 * The heartbeat prompt now names the first two (calendarError / emailError),
 * but the prompt is only BUILT when `shouldNotify` lets the round through --
 * and a broken source is not itself a reason to notify. So a source could fail
 * at 14:00 and reach nobody until the morning briefing tried to use it.
 *
 * THREE SHAPES WERE ON THE TABLE, AND TWO WERE REJECTED FOR MEASURED REASONS:
 *   level-triggered (say it while broken) -- an hourly message all night, which
 *     is how alerts get switched off;
 *   only in the morning briefing -- that IS the original bug: the briefing is
 *     the thing that breaks, so the signal would sit in its own broken channel.
 *   EDGE-triggered -- once on failure, once on recovery. This one.
 *
 * AND THE RECIPIENT IS THE COORDINATOR, NOT THE OWNER (Marveen's amendment,
 * and it is the part that makes the whole thing work): if the calendar breaks
 * at 14:00 the owner has nothing to do about it -- what he needs is a WORKING
 * briefing at 07:30. The coordinator has seventeen hours to get it fixed. An
 * alert should go to whoever can be reached AND can act.
 *
 * If it is still broken at 07:30, the briefing itself says so, with the reason
 * -- that path already exists. So the owner learns about it exactly when it
 * matters to him, and never as a 2 a.m. buzz.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: report state every round. Three days on
 * `estimate` is ONE message, not seventy. And it does not touch the meter's
 * exit code (it always exits 0, so command-task.ts still sees success) -- that
 * is a separate item with a different risk profile, kept separate on purpose.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './config.js'
import { logger } from './logger.js'

export type SourceName = 'calendar' | 'email' | 'quota'

/** ok:true carries no error; ok:false must carry one, or the alarm says nothing useful. */
export interface SourceState {
  ok: boolean
  error: string | null
}

interface StoredEntry {
  ok: boolean
  since: number
  error: string | null
}

const STATE_PATH = join(STORE_DIR, 'data-source-alarm.json')

export function readAlarmState(path = STATE_PATH): Record<string, StoredEntry> {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, StoredEntry>) : {}
  } catch {
    // A corrupt state file must not silence the alarm. Treating it as empty
    // means the next failure is reported again -- noisy in the worst case,
    // never silent, and the direction of that error is the one we can afford.
    return {}
  }
}

function writeAlarmState(state: Record<string, StoredEntry>, path = STATE_PATH): void {
  try {
    // Write-then-rename: a half-written state file would be unparseable, and
    // the catch above would then re-announce every source on every tick.
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, path)
  } catch (err) {
    logger.warn({ err }, 'data-source-alarm: state write failed')
  }
}

/** The message a transition produces, or null when nothing changed. */
export function transitionMessage(
  source: SourceName,
  prev: StoredEntry | undefined,
  next: SourceState,
  nowSec: number,
): string | null {
  // FIRST SIGHTING OF A HEALTHY SOURCE IS NOT AN EVENT. Otherwise every fresh
  // install, and every state-file loss, would announce three "recovered"
  // messages for sources that were never broken.
  if (!prev) return next.ok ? null : failureText(source, next.error)
  if (prev.ok === next.ok) return null
  if (!next.ok) return failureText(source, next.error)
  const hours = Math.max(0, Math.round((nowSec - prev.since) / 3600))
  return `[adatforras] ${source}: HELYREALLT (kb. ${hours} ora utan). Nem kell tenni semmit -- ` +
    `ez a parja a romlaskor kuldott uzenetnek.`
}

function failureText(source: SourceName, error: string | null): string {
  const why = error ? ` Ok: ${error}` : ''
  return `[adatforras] ${source}: ELROMLOTT.${why}\n` +
    `Ez EGYSZER szol, nem korönkent -- a helyreallas is egy uzenet lesz.\n` +
    `Ha 07:30-ig nem javul, a napindito maga fogja megmondani Istinek, mi es miert hianyzik.`
}

/**
 * Compare the current reading of each source against the stored one and return
 * the messages the transitions produce. Pure except for the state file, so the
 * decision itself is testable without a database or a clock.
 */
export function detectTransitions(
  current: Partial<Record<SourceName, SourceState>>,
  nowSec: number,
  path = STATE_PATH,
): Array<{ source: SourceName; message: string }> {
  const stored = readAlarmState(path)
  const out: Array<{ source: SourceName; message: string }> = []
  let changed = false

  for (const [name, state] of Object.entries(current) as Array<[SourceName, SourceState]>) {
    const prev = stored[name]
    const msg = transitionMessage(name, prev, state, nowSec)
    if (msg) out.push({ source: name, message: msg })
    if (!prev || prev.ok !== state.ok) {
      stored[name] = { ok: state.ok, since: nowSec, error: state.error }
      changed = true
    } else if (prev.error !== state.error) {
      // Same state, different reason: remember the newer reason WITHOUT
      // announcing it. The rule is one message per transition, not per wording.
      stored[name] = { ...prev, error: state.error }
      changed = true
    }
  }
  if (changed) writeAlarmState(stored, path)
  return out
}

/** The quota meter's own health, read from the snapshot it writes. */
export function readQuotaSourceState(latestPath = join(STORE_DIR, 'usage-latest.json')): SourceState | null {
  try {
    if (!existsSync(latestPath)) return null
    const d = JSON.parse(readFileSync(latestPath, 'utf8')) as { claude?: { ok?: boolean; source?: string; auth_error?: string | null } }
    const c = d.claude
    if (!c) return null
    // `authoritative_cached` still yields pace windows, so alerting survives --
    // it is degraded, not out. `estimate` is the one that silences alerting
    // completely, and that is what this alarm is for.
    const ok = c.ok === true && (c.source === 'authoritative' || c.source === 'authoritative_cached')
    return { ok, error: ok ? null : `source=${c.source ?? '?'}${c.auth_error ? `, ${c.auth_error}` : ''}` }
  } catch {
    return null
  }
}
