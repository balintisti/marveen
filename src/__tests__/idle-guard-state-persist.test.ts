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
import { initDatabase, saveIdleGuardState, loadIdleGuardState } from '../db.js'

const MAX_AGE = 6 * 60_000   // ket tick, ahogy a watcher hasznalja

beforeEach(() => { initDatabase(':memory:') })

describe('idle_guard_state -- iras es visszaolvasas', () => {
  it('visszaadja, amit beirtunk', () => {
    const now = 1_000_000_000
    saveIdleGuardState('x', { idleSinceMs: now - 60_000, lastAlertAt: now - 120_000, lastWakeAt: null }, now)
    expect(loadIdleGuardState('x', MAX_AGE, now)).toEqual({
      idleSinceMs: now - 60_000, lastAlertAt: now - 120_000, lastWakeAt: null, updatedAt: now,
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
    // NEGATIV KONTROLL: a kor-hatart NEM a hivo talalja ki menet kozben.
    expect(loop).not.toMatch(/loadIdleGuardState\(agent, 0/)
  })
})
