/**
 * A napindito EGY parancsa a kapacitasrol (kartya 54ee459b).
 *
 * Szerzodes, ugyanaz mint a `calendar-agenda.sh`-nal: MINDIG JSON, MINDIG 0-val
 * lep ki, es vagy `{"ok":true,...}`, vagy `{"ok":false,"error":"..."}`. Egy hivo
 * nem veszitheti el az OKOT azzal, hogy a kilepesi kodot nezi.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { STORE_DIR } from './config.js'
import { sustainedSpareCapacity, paceRatio, SPARE_CAPACITY_DEFAULT, type CapacitySnapshot } from './capacity-report.js'

function emit(o: unknown): never { process.stdout.write(JSON.stringify(o) + '\n'); process.exit(0) }

function win(raw: unknown): { usedPercent: number; resetsAtMs: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { used_percent?: unknown; resets_at?: unknown }
  const u = Number(r.used_percent), t = Number(r.resets_at)
  if (!Number.isFinite(u) || !Number.isFinite(t)) return null
  return { usedPercent: u, resetsAtMs: t > 1e11 ? t : t * 1000 }
}

function snapOf(row: { generated_at?: unknown; claude?: unknown }): CapacitySnapshot | null {
  const at = Date.parse(String(row.generated_at ?? ''))
  if (!Number.isFinite(at)) return null
  const c = row.claude as { windows?: Record<string, unknown> } | undefined
  const w = c?.windows ?? {}
  return { atMs: at, fiveHour: win(w['five_hour']), sevenDay: win(w['seven_day']), sevenDayOpus: win(w['seven_day_opus']) }
}

try {
  const latestRaw = JSON.parse(readFileSync(join(STORE_DIR, 'usage-latest.json'), 'utf-8'))
  const latest = snapOf(latestRaw)
  if (!latest) emit({ ok: false, error: 'a usage-latest.json nem ertelmezheto (hianyzo generated_at vagy claude.windows)' })
  const src = (latestRaw as { claude?: { source?: string } }).claude?.source
  // A "becsult" forras NEM ugyanaz, mint a mert: kiirjuk, nem hallgatjuk el.
  const history: CapacitySnapshot[] = []
  try {
    for (const line of readFileSync(join(STORE_DIR, 'usage-history.jsonl'), 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try { const s = snapOf(JSON.parse(line)); if (s) history.push(s) } catch { /* egy tort sor nem dontheti el az egeszet */ }
    }
  } catch { /* elozmeny nelkul a verdikt "nem eldontheto" lesz, es meg is mondja */ }

  const now = latest!.atMs
  const verdict = sustainedSpareCapacity(history, now)
  emit({
    ok: true,
    via: process.env.CAPACITY_VIA ?? 'ismeretlen',
    measured_at: new Date(now).toISOString(),
    source: src ?? 'ismeretlen',
    windows: {
      five_hour: latest!.fiveHour?.usedPercent ?? null,
      seven_day: latest!.sevenDay?.usedPercent ?? null,
      seven_day_opus: latest!.sevenDayOpus?.usedPercent ?? null,
    },
    seven_day_pace: paceRatio(latest!.sevenDay, now),
    spare_capacity: verdict,
    population: SPARE_CAPACITY_DEFAULT,
    history_rows: history.length,
  })
} catch (err) {
  emit({ ok: false, error: (err as Error).message })
}
