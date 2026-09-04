// AZ OR ALLAPOTA ELJE TUL A RESTARTOT -- kartya 60060415, marveen dontese (komment 5448).
//
// A MERT INDOK (jarvis, komment 5442): a 2026-08-27-i watcher-folyamatok kozul ketto
// 8p12mp es 2p28mp ideig elt -- MINDKETTO a 12 perces `sustainedMs` ALATT. Vagyis egy
// telepitesi sorozat alatt az or nem "neha felejt", hanem SZERKEZETILEG kepteleN tuzelni,
// es semmi nem mondja meg. Aznap harom restart volt tizenegy perc alatt.
//
// marveen indoklasa, hogy vitathato legyen: "Az or allapota AZ AGENSEKROL szol, nem a
// watcher folyamatrol. Hogy egy agens mennyi ideje tetlen, az nem szunik meg attol, hogy
// MI telepitunk." A memoriaban tarolas nem terv volt, hanem a megvalositas mellekhatasa.
import { describe, it, expect, beforeEach } from 'vitest'
import { initDatabase, saveIdleGuardState, loadIdleGuardState, listIdleGuardEvents, getDb } from '../db.js'

const MAX_AGE = 6 * 60_000   // ket tick, ahogy a watcher hasznalja

beforeEach(() => { initDatabase(':memory:') })

describe('idle_guard_state -- iras es visszaolvasas', () => {
  it('visszaadja, amit beirtunk', () => {
    const now = 1_000_000_000
    saveIdleGuardState('x', { idleSinceMs: now - 60_000, lastAlertAt: now - 120_000, lastWakeAt: null }, now)
    expect(loadIdleGuardState('x', MAX_AGE, now)).toEqual({
      idleSinceMs: now - 60_000, lastAlertAt: now - 120_000, lastWakeAt: null, updatedAt: now,
      // A jelzo egy FRISS sorra hamis: nem dobtunk el semmit.
      staleIdleDropped: false,
    })
  })

  it('ismeretlen agensre `null`, nem ures allapot', () => {
    // A ketto NEM ugyanaz: az ures allapot azt allitana, hogy MERTUK es semmi nem volt.
    expect(loadIdleGuardState('nincs-ilyen', MAX_AGE, 1)).toBeNull()
  })

  it('a masodik iras FELULIRJA az elsot, nem duplikal', () => {
    saveIdleGuardState('x', { idleSinceMs: 1, lastAlertAt: null, lastWakeAt: null }, 100)
    saveIdleGuardState('x', { idleSinceMs: 2, lastAlertAt: null, lastWakeAt: null }, 200)
    expect(loadIdleGuardState('x', MAX_AGE, 200)?.idleSinceMs).toBe(2)
  })
})

describe('a KOR-HATAR aszimmetrikus, es ez a lenyege (jarvis kikoteSe, 5442)', () => {
  // Egy tegnapi `idleSinceMs` visszatoltve AZONNALI tuzelest okozna -- vagyis ugyanaz a
  // kar, mint amit a kartya javit, csak a masik iranybol. A ket elnyomo mezo viszont
  // legfeljebb KESLELTET, tehat oket kor-hatar nelkul is vissza lehet tolteni.
  const now = 1_000_000_000
  const stale = now - 60 * 60_000     // egy oraja irt sor

  it('ELAVULT sor: az `idleSinceMs` ELDOBVA (kulonben azonnal tuzelne)', () => {
    saveIdleGuardState('x', { idleSinceMs: stale, lastAlertAt: stale, lastWakeAt: stale }, stale)
    expect(loadIdleGuardState('x', MAX_AGE, now)?.idleSinceMs).toBeNull()
  })

  it('ELAVULT sor: az elnyomo mezok MEGMARADNAK', () => {
    saveIdleGuardState('x', { idleSinceMs: stale, lastAlertAt: stale, lastWakeAt: stale }, stale)
    const r = loadIdleGuardState('x', MAX_AGE, now)
    expect(r?.lastAlertAt).toBe(stale)
    expect(r?.lastWakeAt).toBe(stale)
  })

  it('FRISS sor: az `idleSinceMs` MEGMARAD -- ez az, amiert az egesz javitas van', () => {
    // Egy restart masodpercekig tart, tehat a sor friss, es a 12 perces ablak FOLYTATODIK.
    const fresh = now - 30_000
    saveIdleGuardState('x', { idleSinceMs: fresh - 600_000, lastAlertAt: null, lastWakeAt: null }, fresh)
    expect(loadIdleGuardState('x', MAX_AGE, now)?.idleSinceMs).toBe(fresh - 600_000)
  })

  it('a HATAR ket oldala: egy hajszallal a koron belul megmarad, kivul eldobodik', () => {
    // Enelkul a fenti ket teszt egy mindig-eldobo es egy mindig-megtarto valtozattal is
    // zold lenne (kulon-kulon).
    saveIdleGuardState('a', { idleSinceMs: 5, lastAlertAt: null, lastWakeAt: null }, now - MAX_AGE + 1_000)
    saveIdleGuardState('b', { idleSinceMs: 5, lastAlertAt: null, lastWakeAt: null }, now - MAX_AGE - 1_000)
    expect(loadIdleGuardState('a', MAX_AGE, now)?.idleSinceMs).toBe(5)
    expect(loadIdleGuardState('b', MAX_AGE, now)?.idleSinceMs).toBeNull()
  })
})

describe('az ELDOBAS NYOMOT HAGY (jarvis lelete a kartya sajat tanulsagabol)', () => {
  // "Ha egy tarolt sort ELAVULTKENT dobunk el, az nem hagy nyomot. A hivo nem tudja
  // megkulonboztetni a 'sorban eleve null allt' esettol, es a naplo sem mondja."
  // Ez ugyanaz az alak, amit ez a kartya javit -- egy szinttel lejjebb: egy nemleges
  // dontes kimenet nelkul.
  const now = 1_000_000_000
  const stale = now - 60 * 60_000

  it('elavult sor VALODI idleSinceMs-szel -> a jelzo IGAZ', () => {
    saveIdleGuardState('x', { idleSinceMs: stale, lastAlertAt: null, lastWakeAt: null }, stale)
    const r = loadIdleGuardState('x', MAX_AGE, now)
    expect(r?.idleSinceMs).toBeNull()
    expect(r?.staleIdleDropped).toBe(true)
  })

  it('elavult sor, de eleve NULL idleSinceMs -> a jelzo HAMIS (nem dobtunk el semmit)', () => {
    // Enelkul a jelzo azt is "eldobasnak" nevezne, amikor nem volt mit eldobni --
    // es egy naplosor, ami minden elavult sorra tuzel, par kor utan zaj.
    saveIdleGuardState('y', { idleSinceMs: null, lastAlertAt: stale, lastWakeAt: null }, stale)
    expect(loadIdleGuardState('y', MAX_AGE, now)?.staleIdleDropped).toBe(false)
  })

  it('FRISS sor -> a jelzo HAMIS, es az ertek megmarad', () => {
    const fresh = now - 30_000
    saveIdleGuardState('z', { idleSinceMs: fresh - 600_000, lastAlertAt: null, lastWakeAt: null }, fresh)
    const r = loadIdleGuardState('z', MAX_AGE, now)
    expect(r?.staleIdleDropped).toBe(false)
    expect(r?.idleSinceMs).toBe(fresh - 600_000)
  })
})

describe('a watcher tenyleg hasznalja -- bekotes, nem csak a fuggveny letezese', () => {
  it('a tick betolti es visszairja az allapotot', async () => {
    // Horgonyzott forras-allitas: a ket hivas a `for (const agent` cikluson BELUL all,
    // kulonben egy agensre mukodne es a tobbire nem.
    const { readFileSync } = await import('node:fs')
    const { join, dirname } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const src = readFileSync(join(root, 'src', 'web', 'idle-agent-watcher.ts'), 'utf-8')
    const loop = src.slice(src.indexOf('for (const agent of agents)'), src.indexOf('// One message for the whole sweep'))
    expect(loop).toMatch(/loadIdleGuardState\(agent, MAX_IDLE_AGE_MS, now\)/)
    expect(loop).toMatch(/saveIdleGuardState\(agent, next, now\)/)
    // es az eldobas NYOMOT hagy (jarvis lelete)
    expect(loop).toMatch(/stored\?\.staleIdleDropped/)
    expect(loop).toMatch(/discarded as stale/)
    // NEGATIV KONTROLL: a kor-hatart NEM a hivo talalja ki menet kozben.
    expect(loop).not.toMatch(/loadIdleGuardState\(agent, 0/)
  })
})

/**
 * AZ ESEMENY-NAPLO AZ ALLAPOT MELLE -- kartya 308a34f1, marveen engedelyevel.
 *
 * A fenti tabla ALLAPOT: agensenkent EGY sor, minden riasztas felulirja az elozot. Merve
 * 2026-09-04: **1108 kikuldott ertesites all 6 soron.** Tehat nem csak a KIMENET hianyzik
 * (helyes volt-e a jelzes), hanem az ELOZMENY is -- az allapot nem orzi meg a sajat tortenetet.
 *
 * A DEDUP-ESET A LENYEG. Az or tickenkent ujra latja UGYANAZT a `lastAlertAt`-ot; ha minden tick
 * sort irna, percenkent keletkezne egy, es a naplo epp azt a kulonbseget mosna el, amiert
 * letezik. Egy "ir-e sort" teszt ezt nem fogja meg -- ahhoz a MASODIK, valtozatlan mentes kell.
 */
describe('idle_guard_events -- az or sajat tortenete', () => {
  const T = 1_700_000_000_000

  it('egy RIASZTAS sort ir, a bemenettel egyutt', () => {
    saveIdleGuardState('a', { idleSinceMs: T - 900_000, lastAlertAt: T, lastWakeAt: null }, T)
    const ev = listIdleGuardEvents('a')
    expect(ev).toHaveLength(1)
    expect(ev[0].event).toBe('alert')
    expect(ev[0].created_at).toBe(T)
    // a BEMENET, amire az or dontott -- enelkul a naplo azt mondja meg, hogy riasztott,
    // de nem azt, hogy MIRE
    expect(ev[0].idle_since_ms).toBe(T - 900_000)
  })

  it('UGYANAZ a riasztas egy kesobbi ticken NEM ir ujabb sort', () => {
    saveIdleGuardState('a', { idleSinceMs: T - 900_000, lastAlertAt: T, lastWakeAt: null }, T)
    saveIdleGuardState('a', { idleSinceMs: T - 960_000, lastAlertAt: T, lastWakeAt: null }, T + 60_000)
    expect(listIdleGuardEvents('a')).toHaveLength(1)
  })

  it('egy UJ riasztas ugyanarra az agensre MASODIK sort ir', () => {
    saveIdleGuardState('a', { idleSinceMs: T - 900_000, lastAlertAt: T, lastWakeAt: null }, T)
    saveIdleGuardState('a', { idleSinceMs: null, lastAlertAt: T + 3_600_000, lastWakeAt: null }, T + 3_600_000)
    expect(listIdleGuardEvents('a').map(e => e.event)).toEqual(['alert', 'alert'])
  })

  it('az EBRESZTES kulon esemeny-tipus', () => {
    saveIdleGuardState('a', { idleSinceMs: null, lastAlertAt: null, lastWakeAt: T }, T)
    const ev = listIdleGuardEvents('a')
    expect(ev).toHaveLength(1)
    expect(ev[0].event).toBe('wake')
  })

  it('KONTROLL: az allapot-tabla VALTOZATLAN -- melle irtunk, nem helyette', () => {
    saveIdleGuardState('a', { idleSinceMs: T - 900_000, lastAlertAt: T, lastWakeAt: null }, T)
    saveIdleGuardState('a', { idleSinceMs: null, lastAlertAt: T + 3_600_000, lastWakeAt: null }, T + 3_600_000)
    const rows = getDb().prepare('SELECT COUNT(*) as n FROM idle_guard_state WHERE agent = ?').get('a') as { n: number }
    expect(rows.n).toBe(1)                              // tovabbra is EGY sor per agens
    expect(listIdleGuardEvents('a')).toHaveLength(2)    // es a tortenet MELLETTE all
  })

  it('agensenkent kulon tortenet', () => {
    saveIdleGuardState('a', { idleSinceMs: null, lastAlertAt: T, lastWakeAt: null }, T)
    saveIdleGuardState('b', { idleSinceMs: null, lastAlertAt: T, lastWakeAt: null }, T)
    expect(listIdleGuardEvents('a')).toHaveLength(1)
    expect(listIdleGuardEvents('b')).toHaveLength(1)
  })
})
