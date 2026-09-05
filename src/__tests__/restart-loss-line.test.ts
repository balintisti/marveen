import { describe, it, expect } from 'vitest'
import { buildRestartLossLine, RESTART_LOSS_WINDOW_MS } from '../context-guard.js'

// Card 82d9b960. The restart notice used to say "messages may have been lost -- check and
// resend them", and every recipient ran the same three queries to answer it. marveen measured
// six restarts in one evening: ZERO losses, six outsourced measurements.
describe('a restart-ertesites hordozza a sajat mereset', () => {
  const RESTART = Date.UTC(2026, 8, 5, 4, 28, 35)
  const sec = (ms: number) => Math.floor(ms / 1000)
  const row = (id: number, status: string, atMs: number) => ({ id, status, created_at: sec(atMs) })

  it('a KOZOS eset: nincs pending, nincs ablakon beluli failed -> kimondja, hogy nincs mit tenni', () => {
    const line = buildRestartLossLine([], RESTART)
    expect(line).toContain('pending 0')
    expect(line).toContain('failed a restart 30 perces ablakaban: 0')
    expect(line).toContain('NINCS mit ujrakuldeni')
  })

  // EZ A KARTYA KOZPONTI SZABALYA, ES A FORDITOTTJA AKTIVAN ARTALMAS.
  // Merve 2026-09-05: dexternek 12 `failed` sora volt, es az elso olvasat "tizenketto elveszett,
  // kuldd ujra" volt. Kilenc 08-19-i, harom 08-29-i. Az ujrakuldesuk reg megoldott blokkolokat
  // injektalt volna egy FRISS sessionbe -- epp azt a kontextust felelve, amiert a restart tortent.
  it('egy REGI failed sor NEM kerul bele -- az ablakra szur, nem a statuszra', () => {
    // AZONOSITOK SZANDEKOSAN HOSSZUAK ES EGYEDIEK. Az elso alakom 1/2/3-at hasznalt, es a
    // `not.toContain('3')` elbukott a "30 perces ablakaban" szoveg HARMASAN -- egy hianyt allito
    // reszkarakterlanc-horgony, amit egy nem rokon elofordulas elegit ki. Ugyanaz a csalad, mint
    // a `toContain('friday')`, ami az uzenet ELSO sorabol elegult ki (kartya e6685c94).
    const old = [
      row(918001, 'failed', RESTART - 17 * 24 * 3600_000),
      row(918002, 'failed', RESTART - 7 * 24 * 3600_000),
      row(918003, 'failed', RESTART - RESTART_LOSS_WINDOW_MS - 60_000),  // EGY PERCCEL az ablak elott
    ]
    const line = buildRestartLossLine(old, RESTART)
    expect(line).toContain('failed a restart 30 perces ablakaban: 0')
    expect(line).toContain('NINCS mit ujrakuldeni')
    for (const r of old) expect(line).not.toContain(`${r.id}`)
  })

  it('egy ABLAKON BELULI failed sor IGENIS bekerul, az azonositojaval', () => {
    const line = buildRestartLossLine(
      [row(9001, 'failed', RESTART - 5 * 60_000), row(9002, 'failed', RESTART - 40 * 60_000)],
      RESTART,
    )
    expect(line).toContain('failed AZ ABLAKBAN: 1')
    expect(line).toContain('9001')
    expect(line).toContain('EZEKET kuldd ujra')
    // KONTROLL: a 40 perces (ablakon KIVULI) sor ugyanabban a hivasban NEM jelenik meg,
    // tehat a mero nem mond mindenre igent.
    expect(line).not.toContain('9002')
  })

  it('a HATAR bennevan: pontosan az ablak szelen keletkezett sor MEG szamit', () => {
    // A hatar MINDKET oldalat fedni kell, kulonben egy `>` -> `>=` mutacio tulel.
    const onEdge = buildRestartLossLine([row(42, 'failed', RESTART - RESTART_LOSS_WINDOW_MS)], RESTART)
    expect(onEdge).toContain('42')
    const justOutside = buildRestartLossLine([row(42, 'failed', RESTART - RESTART_LOSS_WINDOW_MS - 1000)], RESTART)
    expect(justOutside).not.toContain('42')
  })

  it('a PENDING nem veszteseg -- kimondja, hogy TULELTE es NE kuldjek ujra', () => {
    const line = buildRestartLossLine([row(55, 'pending', RESTART - 2 * 60_000)], RESTART)
    expect(line).toContain('pending: 1')
    expect(line).toMatch(/TULELT/)
    expect(line).toMatch(/NE kuldd ujra/)
    // es NEM allitja rola, hogy ujra kellene kuldeni
    expect(line).not.toContain('EZEKET kuldd ujra')
  })

  it('a ket fajta EGYUTT is helyesen valik szet', () => {
    const line = buildRestartLossLine(
      [row(100, 'failed', RESTART - 60_000), row(200, 'pending', RESTART - 60_000),
       row(300, 'failed', RESTART - 5 * 24 * 3600_000)],
      RESTART,
    )
    expect(line).toContain('failed AZ ABLAKBAN: 1')
    expect(line).toContain('100')
    expect(line).toContain('pending: 1')
    expect(line).not.toContain('300')
  })
})
