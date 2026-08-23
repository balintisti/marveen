import { describe, it, expect } from 'vitest'
import {
  dailyCardFlow, cardFlowConvergence, CONVERGENCE_DEFAULT,
  type CardRow, type CardFlowEvent,
} from '../card-flow-report.js'

// Kartya 54ee459b. A kerdes nem az, mennyi munka van, hanem hogy a felderites
// KONVERGAL-e. Ket fuggetlen kerdes egyike (a masik a GEPI kapacitas, 8136d993);
// egyik sem helyettesiti a masikat.
//
// MINDEN IDOPONT 12:00Z, ES EZ MERT DEFEKTUS-JAVITAS EGY MASIK MODULBOL: a
// kapacitas-tesztjeimben 22:00Z-t irtam, ami Europe/Budapestben MAR A KOVETKEZO
// NAP -- harom "kulon nap" ketto lett, es harom teszt bukott rajta, mikozben a
// kod vegig helyes volt. A nap-hatar a tesztadatban ugyanolyan allitas, mint
// barmi mas.
const TZ = 'Europe/Budapest'
const at = (d: string, h = '12:00') => new Date(`${d}T${h}:00Z`).getTime()
const MOST = at('2026-08-23', '15:00')

const card = (id: string, createdDay: string, archivedDay?: string): CardRow =>
  ({ id, createdAtMs: at(createdDay), archivedAtMs: archivedDay ? at(archivedDay) : null })
const ev = (cardId: string, day: string, toStatus = 'done'): CardFlowEvent =>
  ({ cardId, toStatus, atMs: at(day) })

describe('dailyCardFlow -- a populacio kimondva', () => {
  it('a MAI nap kimarad, mert a napi aram a nap vegeig NO', () => {
    // Mert eset ezen a kartyan: a baseline "uj 60"-at mondott reggel, es
    // ugyanaz a nap 17:29-re 125-nel allt. A szam nem volt rossz, csak REGGELI.
    const flow = dailyCardFlow(
      [card('a', '2026-08-22'), card('b', '2026-08-23'), card('c', '2026-08-23')],
      [], MOST, TZ,
    )
    expect(flow.map((f) => f.day)).toEqual(['2026-08-22'])
    expect(flow[0].created).toBe(1)
  })

  it('a lezarast a `done` esemeny adja', () => {
    const flow = dailyCardFlow([card('a', '2026-08-20')], [ev('a', '2026-08-21')], MOST, TZ)
    expect(flow.find((f) => f.day === '2026-08-21')!.closed).toBe(1)
  })

  it('a `done` NELKUL archivalt kartya IS lezaras -- kulonben alulmernenk', () => {
    // MERVE 2026-08-23: a 38 archivalt kartyabol 32-nek SOHA nem volt `done`
    // esemenye. Csak a done-esemenyt szamolni napi ~10 lezarast hagyna ki, es
    // epp a KONVERGENCIA iranyaba tevedne -- vagyis a megnyugtato iranyba.
    const flow = dailyCardFlow([card('a', '2026-08-20', '2026-08-21')], [], MOST, TZ)
    expect(flow.find((f) => f.day === '2026-08-21')!.closed).toBe(1)
  })

  it('egy kartya NEM szamit ketszer, ha done volt ES utana archivaltak', () => {
    const flow = dailyCardFlow(
      [card('a', '2026-08-20', '2026-08-22')], [ev('a', '2026-08-21')], MOST, TZ,
    )
    expect(flow.find((f) => f.day === '2026-08-21')!.closed).toBe(1)
    expect(flow.find((f) => f.day === '2026-08-22')?.closed ?? 0).toBe(0)
  })

  it('a NEM done statuszvaltas nem lezaras', () => {
    const flow = dailyCardFlow([card('a', '2026-08-20')], [ev('a', '2026-08-21', 'testing')], MOST, TZ)
    expect(flow.find((f) => f.day === '2026-08-21')?.closed ?? 0).toBe(0)
  })
})

describe('cardFlowConvergence -- a kuszob KONKRET szam', () => {
  it('harom egymast koveto TELJES nap, kodban rogzitve', () => {
    expect(CONVERGENCE_DEFAULT.days).toBe(3)
  })

  const nap = (day: string, created: number, closed: number) => ({ day, created, closed })

  it('harom napon closed >= created -> KONVERGAL', () => {
    const v = cardFlowConvergence([nap('2026-08-20', 10, 12), nap('2026-08-21', 8, 8), nap('2026-08-22', 5, 9)])
    expect(v.converging).toBe(true)
  })

  it('az EGYENSULY (closed == created) nem divergencia', () => {
    // Egy pontosan egyensulyban levo nap nem novel hatralekot. A `>` kikotes
    // ezt divergencianak jelolne, es a jelzes soha nem szolalna meg.
    const v = cardFlowConvergence([nap('2026-08-20', 7, 7), nap('2026-08-21', 7, 7), nap('2026-08-22', 7, 7)])
    expect(v.converging).toBe(true)
  })

  it('egyetlen rosszabb nap megbuktatja, es MEGNEVEZI', () => {
    const v = cardFlowConvergence([nap('2026-08-20', 10, 12), nap('2026-08-21', 20, 5), nap('2026-08-22', 5, 9)])
    expect(v.converging).toBe(false)
    expect(v.reason).toContain('2026-08-21')
    expect(v.reason).toContain('+20/-5')
  })

  it('KEVES nap -> nem konvergal, es megmondja, hogy AZERT', () => {
    // A hallgatas itt is rossz valasz: ket napbol nem lehet haromra allitani.
    const v = cardFlowConvergence([nap('2026-08-22', 5, 9)])
    expect(v.converging).toBe(false)
    expect(v.reason).toContain('nem eldontheto')
  })

  it('a MAI valos adat iranya: erosen divergal', () => {
    // A 2026-08-20/21/22 mert ertekei. Ez a teszt nem a tablat meri, hanem azt,
    // hogy a fuggveny a valodi nagysagrendekre a helyes valaszt adja.
    const v = cardFlowConvergence([nap('2026-08-20', 123, 43), nap('2026-08-21', 177, 66), nap('2026-08-22', 179, 77)])
    expect(v.converging).toBe(false)
  })
})
