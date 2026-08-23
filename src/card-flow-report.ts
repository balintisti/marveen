/**
 * A KARTYA-ARAM HAROM SZAMA, ES EGY VERDIKT A KONVERGENCIAROL.
 *
 * Kartya 54ee459b. Isti ezen donti el, mikor johet uj projekt: nem az a kerdes,
 * mennyi munka van, hanem hogy a felderites KONVERGAL-e -- fogy-e gyorsabban,
 * mint amennyi keletkezik.
 *
 * KET FUGGETLEN KERDES VAN, ES EZ CSAK AZ EGYIK. A masik a GEPI kapacitas
 * (kartya 8136d993, `capacity-report`). Egyik sem helyettesiti a masikat: lehet
 * borven szabad keret ugy, hogy a hatralek no, es forditva.
 */

/** A harom szam -- ES KET FLOW MEG EGY LEVEL, ami nem ugyanaz a fajta. */
export interface CardFlowDay {
  day: string
  /** FLOW: aznap letrehozott kartyak. */
  created: number
  /** FLOW: aznap lezart kartyak (done-esemeny VAGY done nelkuli archivalas). */
  closed: number
}

export interface CardFlowEvent { toStatus: string; atMs: number; cardId: string }
export interface CardRow { id: string; createdAtMs: number; archivedAtMs: number | null }

export interface ConvergencePopulation {
  /** Hany EGYMAST KOVETO TELJES nap kell a konvergencia kimondasahoz. */
  days: number
}

/**
 * A kikotes szerint KONKRET szam, nem szo: harom egymast koveto TELJES nap.
 *
 * MIERT TELJES NAPOK. A napi `created` es `closed` FOLYAM: a mai nap ertéke a
 * nap vegeig NO. Mert eset ugyanezen a kartyan: a baseline "uj 60"-at mondott,
 * es ugyanaz a nap 17:29-re 125-nel allt -- a szam nem volt rossz, csak
 * REGGELI. Egy reszleges mai napot egy teljes tegnapihoz merni ugyanaz a hiba,
 * mint ket kulonbozo populaciot osszehasonlitani.
 */
export const CONVERGENCE_DEFAULT: ConvergencePopulation = { days: 3 }

const dayKeyOf = (tz: string) => (ms: number) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms))

/**
 * Napi aram a TELJES napokra (a mai kimarad).
 *
 * A `closed` POPULACIOJA, KIMONDVA: egy kartya akkor zarult le aznap, ha
 *   (a) `done`-ra mozgatasi esemenye van aznap, VAGY
 *   (b) aznap archivaltak UGY, hogy soha nem volt `done` esemenye.
 * A (b) nem elmeleti: a 38 archivalt kartyabol 32-nek SOHA nem volt `done`
 * esemenye (merve 2026-08-23). Csak a done-esemenyt szamolni napi ~10 lezarast
 * hagyna ki, es epp a konvergencia iranyaba tevedne -- a rosszabb iranyba.
 */
export function dailyCardFlow(
  cards: CardRow[],
  events: CardFlowEvent[],
  nowMs: number,
  tz = 'Europe/Budapest',
): CardFlowDay[] {
  const k = dayKeyOf(tz)
  const ma = k(nowMs)
  const created = new Map<string, number>()
  for (const c of cards) {
    const d = k(c.createdAtMs)
    if (d !== ma) created.set(d, (created.get(d) ?? 0) + 1)
  }
  const doneIds = new Set(events.filter((e) => e.toStatus === 'done').map((e) => e.cardId))
  const closed = new Map<string, number>()
  for (const e of events) {
    if (e.toStatus !== 'done') continue
    const d = k(e.atMs)
    if (d !== ma) closed.set(d, (closed.get(d) ?? 0) + 1)
  }
  for (const c of cards) {
    if (c.archivedAtMs == null || doneIds.has(c.id)) continue
    const d = k(c.archivedAtMs)
    if (d !== ma) closed.set(d, (closed.get(d) ?? 0) + 1)
  }
  const napok = [...new Set([...created.keys(), ...closed.keys()])].sort()
  return napok.map((d) => ({ day: d, created: created.get(d) ?? 0, closed: closed.get(d) ?? 0 }))
}

export interface ConvergenceVerdict {
  converging: boolean
  days: CardFlowDay[]
  reason: string
}

/**
 * Konvergal-e: MINDEN vizsgalt teljes napon legalabb annyi zarult le, mint
 * amennyi keletkezett.
 *
 * A `closed >= created` a kikotes, nem a `>`: egy pontosan egyensulyban levo nap
 * nem novel hatralekot, tehat nem a divergencia jele.
 */
export function cardFlowConvergence(
  flow: CardFlowDay[],
  pop: ConvergencePopulation = CONVERGENCE_DEFAULT,
): ConvergenceVerdict {
  const napok = flow.slice(-pop.days)
  if (napok.length < pop.days) {
    return { converging: false, days: napok,
             reason: `nincs eleg teljes nap (${napok.length} < ${pop.days}) -- a konvergencia nem eldontheto` }
  }
  const converging = napok.every((d) => d.closed >= d.created)
  const rossz = napok.filter((d) => d.closed < d.created)
  return {
    converging, days: napok,
    reason: converging
      ? `mind a ${pop.days} teljes napon legalabb annyi zarult le, mint amennyi keletkezett`
      : `${rossz.length} napon tobb keletkezett, mint amennyi lezarult (${rossz.map((d) => `${d.day}: +${d.created}/-${d.closed}`).join(', ')})`,
  }
}
