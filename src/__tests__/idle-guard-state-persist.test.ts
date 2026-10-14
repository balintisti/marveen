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
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { initDatabase, saveIdleGuardState, loadIdleGuardState, getDb } from '../db.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

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

// --- card e6045a1b: the suppressors beyond the first three columns survive a restart ---------
describe('az elnyomo mezok is tulelik a restartot (e6045a1b)', () => {
  const now = 1_000_000_000
  const ALL = {
    lastNoWorkNoticeAt: now - 5 * 60_000,
    lastWakeWorkIds: ['aaaaaaaa', 'bbbbbbbb'],
    lastNoWorkNoticeIds: ['cccccccc'],
    lastSubagentNoticeAt: now - 7 * 60_000,
    lastPaneUnreadableAt: now - 9 * 60_000,
    noWorkLiveSpellSince: now - 60 * 60_000,
  }
  const base = { idleSinceMs: now - 60_000, lastAlertAt: null, lastWakeAt: now - 20 * 60_000 }

  it('mind a hat visszajon', () => {
    saveIdleGuardState('x', { ...base, ...ALL }, now)
    expect(loadIdleGuardState('x', MAX_AGE, now)).toMatchObject(ALL)
  })

  it('ELAVULT sorbol is visszajonnek: csak kesleltetnek, mint a lastAlertAt', () => {
    const stale = now - 60 * 60_000
    saveIdleGuardState('x', { ...base, ...ALL }, stale)
    const r = loadIdleGuardState('x', MAX_AGE, now)
    expect(r?.idleSinceMs).toBeNull()
    expect(r).toMatchObject(ALL)
  })

  it('a subagentsSinceMs NEM perzisztal: gyorsitana, nem kesleltetne', () => {
    saveIdleGuardState('x', { ...base, subagentsSinceMs: now - 3 * 3600_000 } as never, now)
    expect(loadIdleGuardState('x', MAX_AGE, now)).not.toHaveProperty('subagentsSinceMs')
  })

  it('az oszlop elotti (NULL) sor a regi viselkedest adja, nem talalgat', () => {
    saveIdleGuardState('x', base, now)
    getDb().prepare('UPDATE idle_guard_state SET suppressors_json = NULL').run()
    const r = loadIdleGuardState('x', MAX_AGE, now)
    expect(r).not.toHaveProperty('lastWakeWorkIds')
    expect(r?.lastWakeAt).toBe(base.lastWakeAt)
  })

  it('hibas JSON es rossz tipusu mezo ELDOBVA, a jok megmaradnak', () => {
    saveIdleGuardState('x', base, now)
    getDb().prepare('UPDATE idle_guard_state SET suppressors_json = ?').run('{nem json')
    expect(loadIdleGuardState('x', MAX_AGE, now)?.lastWakeAt).toBe(base.lastWakeAt)
    getDb().prepare('UPDATE idle_guard_state SET suppressors_json = ?')
      .run(JSON.stringify({ lastWakeWorkIds: [1, 2], lastNoWorkNoticeAt: 'tegnap', lastNoWorkNoticeIds: ['ok'] }))
    const r = loadIdleGuardState('x', MAX_AGE, now)
    expect(r).not.toHaveProperty('lastWakeWorkIds')
    expect(r).not.toHaveProperty('lastNoWorkNoticeAt')
    expect(r?.lastNoWorkNoticeIds).toEqual(['ok'])
  })
})

describe('egy REGI tabla (oszlop nelkul) az indulaskor megkapja az oszlopot (e6045a1b)', () => {
  const mk = tmpDirs()
  it('a meglevo sor megmarad, es az uj mezok irhatok', () => {
    const file = join(mk('idle-guard-schema-'), 'old.db')
    const old = new Database(file)
    old.exec('CREATE TABLE idle_guard_state (agent TEXT PRIMARY KEY, idle_since_ms INTEGER, last_alert_at INTEGER, last_wake_at INTEGER, updated_at INTEGER NOT NULL)')
    old.prepare('INSERT INTO idle_guard_state VALUES (?, ?, ?, ?, ?)').run('x', null, 111, 222, 1000)
    old.close()
    initDatabase(file)
    expect(loadIdleGuardState('x', MAX_AGE, 1000)).toMatchObject({ lastAlertAt: 111, lastWakeAt: 222 })
    saveIdleGuardState('x', { idleSinceMs: null, lastAlertAt: 111, lastWakeAt: 222, lastWakeWorkIds: ['z'] }, 2000)
    expect(loadIdleGuardState('x', MAX_AGE, 2000)?.lastWakeWorkIds).toEqual(['z'])
    initDatabase(':memory:')
  })
})
