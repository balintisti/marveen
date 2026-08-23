import { describe, it, expect } from 'vitest'
import {
  paceRatio, sustainedSpareCapacity, SPARE_CAPACITY_DEFAULT,
  type CapacitySnapshot, type WindowSample,
} from '../capacity-report.js'

// Kartya 54ee459b. A verdikt arrol szol, van-e TARTOS szabad keret -- Isti ezen
// donti el, mikor johet uj projekt. A ki nem hasznalt heti keret a het vegen
// elveszik, tehat itt a "marad-e ki" a kerdes, nem az, hogy "elfogy-e".
//
// A KIKOTES (marveen): a "tartosan" legyen KONKRET szam a kodban, es a
// POPULACIO legyen kimondva. Mindketto allitva van itt, nem csak a kodban leirva.

const WEEK = 7 * 24 * 3600 * 1000

// A MINTAK 18:00Z-N ALLNAK, ES EZ MERT DEFEKTUS-JAVITAS. Elsore 22:00Z-t irtam,
// ami Europe/Budapestben MAR A KOVETKEZO NAP 00:00 -- a harom "kulon nap" igy
// ketto lett, es az egyik atcsuszott a MAI napra, amit a fuggveny helyesen
// kihagy. Harom teszt bukott rajta, es a kod vegig helyes volt.
// Ma masodszor: delutan a cron-tesztjeim allitottak UTC-ben, mikozben a cron
// helyi idoben ertelmezodik. A nap-hatar a tesztadatban ugyanolyan allitas,
// mint barmi mas -- ki kell mondani, nem ranezesre eldonteni.
const nap = (s: string) => new Date(s).getTime()

/** Egy ablak, ami az adott idopontban `used`%-on all es `remainingMs` mulva nullazodik. */
const w = (used: number, atMs: number, remainingMs: number): WindowSample =>
  ({ usedPercent: used, resetsAtMs: atMs + remainingMs })

const snap = (atIso: string, usedPercent: number, elapsedFrac: number): CapacitySnapshot => {
  const atMs = nap(atIso)
  return {
    atMs,
    fiveHour: null,
    sevenDay: w(usedPercent, atMs, WEEK * (1 - elapsedFrac)),
    sevenDayOpus: null,
  }
}

describe('paceRatio -- a "nem szamolhato" sajat ertek', () => {
  it('aranyos fogyasztasra 1.0 korul all', () => {
    const at = nap('2026-08-23T12:00:00Z')
    expect(paceRatio(w(50, at, WEEK * 0.5), at)!).toBeCloseTo(1.0, 5)
  })

  it('a fele tempo 0.5', () => {
    const at = nap('2026-08-23T12:00:00Z')
    expect(paceRatio(w(25, at, WEEK * 0.5), at)!).toBeCloseTo(0.5, 5)
  })

  it('KORAI ablakban `null`, nem 0 -- a nulla alulhasznalatnak latszana', () => {
    // Ez a lenyeg: egy het eleji orában minden ablak "alulhasznalt", mert alig
    // telt el belole ido. A usage-collect ugyanezt teszi (pace_min_elapsed_fraction).
    const at = nap('2026-08-23T12:00:00Z')
    expect(paceRatio(w(1, at, WEEK * 0.95), at)).toBeNull()
  })

  it('hianyzo ablakra `null`, nem 0', () => {
    expect(paceRatio(null, nap('2026-08-23T12:00:00Z'))).toBeNull()
  })
})

describe('sustainedSpareCapacity -- a populacio kimondva', () => {
  // Harom TELJES nap, mindegyik nap VEGEN egy mintaval. A mai nap kimarad.
  const most = nap('2026-08-23T15:00:00Z')

  it('a kuszob KONKRET szam: harom egymast koveto nap', () => {
    expect(SPARE_CAPACITY_DEFAULT.days).toBe(3)
    expect(SPARE_CAPACITY_DEFAULT.paceUnderRatio).toBe(0.5)
  })

  it('harom alulhasznalt nap -> TARTOS', () => {
    const h = [
      snap('2026-08-20T18:00:00Z', 10, 0.5),   // pace 0.2
      snap('2026-08-21T18:00:00Z', 12, 0.6),   // pace 0.2
      snap('2026-08-22T18:00:00Z', 15, 0.7),   // pace 0.21
    ]
    const v = sustainedSpareCapacity(h, most)
    expect(v.sustained).toBe(true)
    expect(v.days).toHaveLength(3)
  })

  it('egyetlen NEM alulhasznalt nap megbuktatja', () => {
    const h = [
      snap('2026-08-20T18:00:00Z', 10, 0.5),
      snap('2026-08-21T18:00:00Z', 45, 0.6),   // pace 0.75 -- nem alulhasznalat
      snap('2026-08-22T18:00:00Z', 15, 0.7),
    ]
    expect(sustainedSpareCapacity(h, most).sustained).toBe(false)
  })

  it('egy NEM ELDONTHETO nap is megbuktatja -- a "nem tudom" nem alulhasznalat', () => {
    // Ez a mai visszatero lecke: egy meretlen ertek ne valjon a megnyugtato
    // valasszá. Itt a megnyugtato valasz a `sustained: true` lenne.
    const h = [
      snap('2026-08-20T18:00:00Z', 10, 0.5),
      snap('2026-08-21T18:00:00Z', 1, 0.05),   // korai ablak -> pace null
      snap('2026-08-22T18:00:00Z', 15, 0.7),
    ]
    const v = sustainedSpareCapacity(h, most)
    expect(v.sustained).toBe(false)
    expect(v.reason).toContain('nem tudom')
  })

  it('A MAI nap NEM szamit bele, mert reszleges', () => {
    // Harom teljes nap alulhasznalat + egy mai, ami barmit mutathat.
    const h = [
      snap('2026-08-20T18:00:00Z', 10, 0.5),
      snap('2026-08-21T18:00:00Z', 12, 0.6),
      snap('2026-08-22T18:00:00Z', 15, 0.7),
      snap('2026-08-23T09:00:00Z', 90, 0.72),  // MA, tulhasznalat
    ]
    const v = sustainedSpareCapacity(h, most)
    expect(v.sustained).toBe(true)
    expect(v.days.map(d => d.day)).not.toContain('2026-08-23')
  })

  it('naponta az UTOLSO mintat nezi, nem az elsot', () => {
    // A nap vegallapota szamit; egy reggeli alacsony ertek nem teszi a napot
    // alulhasznaltta, ha estere felfut.
    const h = [
      snap('2026-08-20T18:00:00Z', 10, 0.5),
      snap('2026-08-21T08:00:00Z', 5, 0.55),   // reggel: alulhasznalat
      snap('2026-08-21T18:00:00Z', 50, 0.6),   // este: pace 0.83 -- NEM az
      snap('2026-08-22T18:00:00Z', 15, 0.7),
    ]
    expect(sustainedSpareCapacity(h, most).sustained).toBe(false)
  })

  it('KEVES elozmeny -> nem "tartos", es megmondja, hogy azert', () => {
    // A hallgatas itt is a rossz valasz lenne: ket nap adatbol nem lehet harom
    // napra allitani semmit.
    const v = sustainedSpareCapacity([snap('2026-08-22T18:00:00Z', 10, 0.5)], most)
    expect(v.sustained).toBe(false)
    expect(v.reason).toContain('nincs eleg teljes nap')
  })
})
