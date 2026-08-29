import { CronExpressionParser } from 'cron-parser'
import type { CommandHealth } from './command-task.js'

/**
 * Egy health-mezo, ami nem hordozza a KORAT, nem allapotot mond, hanem EMLEKET.
 *
 * A LELET (kartya bae4df49). A `command-task-health.json` ezt tarolja:
 *     "auto-update": { "fails": 0, "lastStatus": "ok", "lastRun": 1787104804 }
 * Az `"ok"` az UTOLSO FUTAS eredmenye. Csak akkor irodik ujra, amikor a feladat
 * FUT -- vagyis pontosan az a hiba, amit el kellene kapnia (a feladat nem fut),
 * az, ami miatt a mezo valtozatlan marad. Egy soha tobbe nem futo feladat
 * OROKRE `"ok"` marad.
 *
 * ES A BIZONYITEK, HOGY EZ NEM ELMELET: 2026-08-23-an a koordinator EPP EZT
 * olvasta felre, forditva. Azt jelentette, hogy az `auto-update` "2026-08-19 ota
 * nem futott", tehat az `"ok"` negy napos emlek. Ujramerve: a feladat cronja
 * `0 4 * * 3` (heti szerda), 2026-08-19 SZERDA volt, a meres napja vasarnap -- a feladat
 * PONTOSAN akkor futott, amikor kellett, es az `"ok"` ERVENYES.
 * A mezo tehat mindket iranyba felrevezet: nem lehet megmondani rola, hogy
 * "menetrend szerint futott" vagy "hetek ota all". Ez a fuggveny ezt a
 * kulonbseget adja vissza.
 *
 * MIERT NEM FIX KUSZOB. Egy "regebb mint N nap" szabaly egy tiz-percenkenti
 * feladatot orakig egeszsegesnek latna, a heti szerdait pedig penteken mar
 * betegnek. A kerdes nem az, hogy MENNYI IDO telt el, hanem hogy KIMARADT-E EGY
 * MENETREND SZERINTI FUTAS. Ezert a feladat SAJAT cronjabol szarmaztatunk.
 *
 * MIERT OLVASASKOR, ES NEM IRASKOR. Az elavulas az ido fuggvenye, nem egy
 * esemenye -- iraskor nincs mit rogziteni rola. Egy mezo, amit csak a futas
 * frissit, definicio szerint nem tud a futas HIANYAROL beszelni.
 */
export type HealthVerdict = 'ok' | 'fail' | 'stale' | 'never-run' | 'unknown'

export interface HealthAssessment {
  verdict: HealthVerdict
  /** Az utolso futas ota eltelt ido, ms. `null`, ha soha nem futott. */
  ageMs: number | null
  /** Az a menetrend szerinti idopont, amit a feladat KIHAGYOTT. Csak `stale`-nel. */
  missedAt: number | null
  /** Emberi mondat, hogy a szam soha ne alljon a magyarazata nelkul. */
  reason: string
}

/**
 * Tures, mert a menetrend hatara nem eles: a futtato tickje es a catch-up ablak
 * miatt egy feladat percekkel a cron-idopont utan indul el. Enelkul minden
 * feladat `stale` lenne a sajat tuzelesi masodpercében, majd megint `ok` --
 * egy jelzes, ami percenkent villog, egy heten belul zaj.
 */
const TURES_MS = 15 * 60 * 1000

export function assessCommandHealth(
  health: CommandHealth | undefined,
  schedule: string,
  now: number,
  tz?: string,
): HealthAssessment {
  if (!health || !health.lastRun) {
    return { verdict: 'never-run', ageMs: null, missedAt: null,
             reason: 'meg soha nem futott -- nincs mihez kepest allapotot mondani' }
  }
  const lastRunMs = health.lastRun < 1e11 ? health.lastRun * 1000 : health.lastRun
  const ageMs = now - lastRunMs

  // A legutobbi menetrend szerinti idopont MOST elott. Ha a feladat ennel
  // regebben futott (a turesen tul), akkor KIHAGYOTT egy futast.
  let hatarido: number | null = null
  try {
    const it = CronExpressionParser.parse(schedule, { currentDate: new Date(now), ...(tz ? { tz } : {}) })
    let prev = it.prev().getTime()
    // A TURES A FRISS IDOPONTRA VONATKOZIK, NEM A REGI FUTASRA -- ez mert
    // defektus-javitas, a sajat tesztem fogta meg. Az elso alak azt engedte meg,
    // hogy a `lastRun` a menetrendi idopont ELOTT legyen; csakhogy a kerdes nem
    // az, hogy a futas mennyivel elozte meg a hataridot, hanem hogy a hatarido
    // ota eltelt-e mar annyi ido, amennyi alatt a futtatonak el kellett indulnia.
    // Napi 04:00-as feladat 04:02-kor MEG NEM kesett el -- a regi alak viszont
    // mar `stale`-t adott ra, vagyis minden feladat elavult volna a sajat
    // tuzelese utani ket percben.
    if (now - prev <= TURES_MS) prev = it.prev().getTime()
    hatarido = prev
  } catch {
    // Egy ertelmezhetetlen cron NEM jelenthet "ok"-t: nem tudjuk megmondani.
    return { verdict: 'unknown', ageMs, missedAt: null,
             reason: `az utemezes nem ertelmezheto (${schedule}) -- az elavulas nem eldontheto` }
  }

  if (hatarido !== null && lastRunMs < hatarido) {
    return {
      verdict: 'stale', ageMs, missedAt: hatarido,
      reason: `kihagyott egy menetrend szerinti futast (${new Date(hatarido).toISOString()}); `
            + `a tarolt "${health.lastStatus}" ennel REGEBBI eredmeny`,
    }
  }
  if (health.lastStatus === 'fail') {
    return { verdict: 'fail', ageMs, missedAt: null,
             reason: `az utolso futas bukott (${health.fails} egymas utani)` }
  }
  if (health.lastStatus === 'unknown') {
    return { verdict: 'unknown', ageMs, missedAt: null, reason: 'az utolso futas eredmenye ismeretlen' }
  }
  return { verdict: 'ok', ageMs, missedAt: null,
           reason: 'a legutobbi menetrend szerinti futas megtortent, es sikerult' }
}
