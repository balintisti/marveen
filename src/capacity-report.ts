/**
 * A HAROM KAPACITAS-SZAM, ES EGY VERDIKT ARROL, HOGY VAN-E TARTOS SZABAD KERET.
 *
 * Kartya 54ee459b. Isti ezen donti el, mikor johet uj projekt -- a kerdes tehat
 * nem az, hogy "elfogy-e", hanem hogy MARAD-E KI belole tartosan. A ki nem
 * hasznalt heti keret a het vegen ELVESZIK (kartya a3d743f3: a limit-tudatos
 * kiosztas csak fekezni tud, porgetni nem).
 *
 * MIERT PARANCS ES NEM SZABALY. A napindito ma harom kulonbozo helyrol tudna
 * ezt osszerakni, es a repo sajat leckeje szerint (naptar-szekcio, 2026-08-22)
 * egy szabaly, ami azon all, hogy az olvaso a jo forrast valassza, nem szabaly.
 * Ezert egy fuggveny, egy CLI es egy parancs.
 */

/** A meres populacioja -- kimondva, mert egy verdikt nevezo nelkul nem allitas. */
export interface SpareCapacityPopulation {
  /** Hany EGYMAST KOVETO teljes nap kell a "tartos" kimondasahoz. */
  days: number
  /** pace_ratio <= ez -> alulhasznalat. A usage-collect.py `pace_under_ratio`-ja. */
  paceUnderRatio: number
}

/**
 * A kikotes szerint (marveen, 2026-08-23) a "tartosan" KONKRET SZAM a kodban,
 * nem egy szo. Harom egymast koveto TELJES nap.
 *
 * MIERT TELJES NAPOK, ES MIERT NEM SZAMIT BELE A MAI: a mai nap reszleges. Egy
 * het eleji vasarnap delelott minden ablak alulhasznaltnak latszik, mert alig
 * telt el belole ido -- pontosan az az ora, amikor a legkevesebbet tudunk.
 * A pace_ratio ezt reszben kezeli (elosztunk az eltelt hanyaddal), de a KORAI
 * ablak zajos: a usage-collect maga is kihagyja a `pace_min_elapsed_fraction`
 * alatti reszt. A teljes napokra szukites ugyanezt teszi durvabban es
 * ellenorizhetobben.
 */
export const SPARE_CAPACITY_DEFAULT: SpareCapacityPopulation = { days: 3, paceUnderRatio: 0.5 }

export interface WindowSample {
  usedPercent: number
  resetsAtMs: number
}

/** Egy pillanatfelvetel a harom ablakkal. `null` a hianyzo ablak. */
export interface CapacitySnapshot {
  atMs: number
  fiveHour: WindowSample | null
  sevenDay: WindowSample | null
  sevenDayOpus: WindowSample | null
}

const WEEK_MS = 7 * 24 * 3600 * 1000

/**
 * Mennyire "elore szalad" a fogyasztas az ablakban: 1.0 = pont aranyos.
 * `null`, ha nem szamolhato (az ablakbol meg alig telt el ido, vagy nincs adat).
 *
 * A NULL ITT IS SAJAT ERTEK, nem 0 es nem 1: egy nem szamolhato pace ne
 * latszodjon se alulhasznalatnak, se tulhasznalatnak. (Ma ketszer javitottunk
 * ilyet mashol: a "nem merheto" megnyugtato ertekke valtozott.)
 */
export function paceRatio(w: WindowSample | null, nowMs: number, windowMs = WEEK_MS): number | null {
  if (!w) return null
  const remaining = w.resetsAtMs - nowMs
  const elapsed = windowMs - remaining
  if (!(elapsed > 0) || !(windowMs > 0)) return null
  const elapsedFraction = elapsed / windowMs
  // A usage-collect `pace_min_elapsed_fraction`-je: a korai ablak zajos.
  if (elapsedFraction < 0.15) return null
  return w.usedPercent / 100 / elapsedFraction
}

export interface SpareCapacityVerdict {
  /** Igaz, ha MINDEN vizsgalt nap alulhasznalat volt. */
  sustained: boolean
  /** A vizsgalt napok, a legregebbitol. `null` pace = nem eldontheto nap. */
  days: Array<{ day: string; paceRatio: number | null; under: boolean }>
  /** Miert ez a verdikt -- hogy a szam soha ne alljon a magyarazata nelkul. */
  reason: string
}

/**
 * Volt-e TARTOS szabad keret a heti ablakban.
 *
 * A POPULACIO, KIMONDVA:
 *  - naponkent EGY mintat nezunk: az adott nap UTOLSO felvetelet (a nap vegallapota);
 *  - a MAI nap NEM szamit bele (reszleges);
 *  - `days` darab egymast koveto teljes nap kell, es MINDEGYIKNEK alulhasznaltnak
 *    kell lennie -- egyetlen nem-eldontheto (null pace) nap is megbuktatja,
 *    mert a "nem tudom" nem alulhasznalat.
 */
export function sustainedSpareCapacity(
  history: CapacitySnapshot[],
  nowMs: number,
  pop: SpareCapacityPopulation = SPARE_CAPACITY_DEFAULT,
  tz = 'Europe/Budapest',
): SpareCapacityVerdict {
  const dayKey = (ms: number) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(ms))
  const ma = dayKey(nowMs)

  // naponkent az UTOLSO minta
  const utolso = new Map<string, CapacitySnapshot>()
  for (const s of [...history].sort((a, b) => a.atMs - b.atMs)) {
    const d = dayKey(s.atMs)
    if (d !== ma) utolso.set(d, s)
  }
  const napok = [...utolso.keys()].sort().slice(-pop.days)

  if (napok.length < pop.days) {
    return {
      sustained: false,
      days: napok.map((d) => ({ day: d, paceRatio: paceRatio(utolso.get(d)!.sevenDay, utolso.get(d)!.atMs), under: false })),
      reason: `nincs eleg teljes nap az elozmenyben (${napok.length} < ${pop.days}) -- a tartossag nem eldontheto`,
    }
  }

  const days = napok.map((d) => {
    const s = utolso.get(d)!
    const pr = paceRatio(s.sevenDay, s.atMs)
    return { day: d, paceRatio: pr, under: pr !== null && pr <= pop.paceUnderRatio }
  })
  const sustained = days.every((x) => x.under)
  const nemDontheto = days.filter((x) => x.paceRatio === null).map((x) => x.day)
  return {
    sustained,
    days,
    reason: sustained
      ? `mind a ${pop.days} teljes nap alulhasznalat volt (pace <= ${pop.paceUnderRatio})`
      : nemDontheto.length
        ? `nem minden nap volt eldontheto (${nemDontheto.join(', ')}) -- a "nem tudom" nem alulhasznalat`
        : `nem mind a ${pop.days} nap volt alulhasznalat`,
  }
}
