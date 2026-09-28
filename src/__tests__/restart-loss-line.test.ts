import { describe, it, expect } from 'vitest'
import { buildRestartLossLine, RESTART_LOSS_WINDOW_MS, RESTART_DELIVERED_LIST_MAX } from '../context-guard.js'
import { buildWakeMessage } from '../idle-agent.js'

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

  // Kartya 18c382df. A restart a `delivered` allapotot viszi el: a szoveg mar BE VOLT injektalva a
  // panelbe, ami megszunt. Merve 2026-09-24, 411 restart-ertesitesen: 178 mondta, hogy "NINCS mit
  // ujrakuldeni", es ebbol 75-ben (42%) volt delivered sor az ablakban.
  describe('delivered: amit a restart TENYLEG elvisz', () => {
    const dRow = (id: number, from: string, deliveredMs: number, createdMs = deliveredMs, head = 'kerdes') =>
      ({ id, status: 'delivered', created_at: sec(createdMs), delivered_at: sec(deliveredMs), from_agent: from, head })
    // the REAL wake-up text, not a copy: a reworded builder must fail here, not start alarming
    const wakeHead = buildWakeMessage('friday', 12, 3, [], RESTART).slice(0, 40)

    it('egy ablakon beluli, KULDO altal irt delivered sor MEGAKADALYOZZA a "NINCS mit ujrakuldeni"-t', () => {
      const line = buildRestartLossLine([dRow(716972, 'didi', RESTART - 10 * 60_000)], RESTART)
      expect(line).not.toContain('NINCS mit ujrakuldeni')
      expect(line).toContain('delivered AZ ABLAKBAN: 1')
      expect(line).toContain('716972<-didi 10 perce')
      expect(line).toContain('a KULDO dontese')
    })

    it('az ablakot a KEZBESITES ideje adja, nem a letrehozase', () => {
      // 40 perce sorba allt, 5 perce injektalodott -> BENNE van
      const late = buildRestartLossLine(
        [dRow(700001, 'marveen', RESTART - 5 * 60_000, RESTART - 40 * 60_000)], RESTART)
      expect(late).toContain('700001')
      // KONTROLL: 40 perce kezbesult (41 perce jott letre) -> KIVUL van
      const early = buildRestartLossLine(
        [dRow(700002, 'marveen', RESTART - 40 * 60_000, RESTART - 41 * 60_000)], RESTART)
      expect(early).not.toContain('700002')
      expect(early).toContain('NINCS mit ujrakuldeni')
    })

    it('a hatar mindket oldala: pontosan az ablak szelen kezbesitett sor meg szamit', () => {
      expect(buildRestartLossLine([dRow(700042, 'jarvis', RESTART - RESTART_LOSS_WINDOW_MS)], RESTART))
        .toContain('700042')
      expect(buildRestartLossLine([dRow(700042, 'jarvis', RESTART - RESTART_LOSS_WINDOW_MS - 1000)], RESTART))
        .not.toContain('700042')
    })

    it('a restart UTAN kezbesitett sor az UJ sessione, nem veszteseg', () => {
      const line = buildRestartLossLine([dRow(700050, 'dexter', RESTART + 60_000)], RESTART)
      expect(line).not.toContain('700050')
      expect(line).toContain('NINCS mit ujrakuldeni')
    })

    it('a tetlen-or ONMAGANAK szolo ebresztoje targytalan: szamolva, nem listazva, egyedul nem riaszt', () => {
      const line = buildRestartLossLine([dRow(700060, 'system', RESTART - 3 * 60_000, undefined, wakeHead)], RESTART)
      expect(line).toContain('NINCS mit ujrakuldeni')
      expect(line).toContain('delivered az ablakban: 1')
      expect(line).toContain('tetlen-or ebreszto')
      expect(line).not.toContain('700060')
    })

    // A JAVITAS ELSO ALAKJA MINDEN `system` sort kihagyott "ujratermelodik" cimkevel. HAMIS volt:
    // nyolc kodut kuld `system`-kent, es az approval, a sentry/uptime el es a handoff-failure
    // EGYSZER megy ki. Egy restartban elveszett sentry-erkezes soha nem jon vissza.
    it('az EGYSZERI rendszer-uzenet (sentry, APPROVAL_REQUEST) IGENIS riaszt, a cimkejevel', () => {
      const line = buildRestartLossLine([
        dRow(700061, 'system', RESTART - 3 * 60_000, undefined, '[sentry] 1 NEW unresolved issue(s):'),
        dRow(700062, 'system', RESTART - 4 * 60_000, undefined, '[APPROVAL_REQUEST] friday ker: ...'),
      ], RESTART)
      expect(line).not.toContain('NINCS mit ujrakuldeni')
      expect(line).toContain('700061<-system[sentry]')
      expect(line).toContain('700062<-system[APPROVAL_REQUEST]')
    })

    it('KONTROLL: a MARVEENNEK szolo tetlen-or lista (mas agensrol) NEM targytalan -- 4 oraig nem ismetlodik', () => {
      const line = buildRestartLossLine(
        [dRow(700063, 'system', RESTART - 3 * 60_000, undefined, '[tetlen-or] A(z) "jarvis" 12 perce ures p')], RESTART)
      expect(line).toContain('700063<-system[tetlen-or]')
      expect(line).not.toContain('NINCS mit ujrakuldeni')
    })

    it('targytalan ebreszto MELLETT a kuldoi sor riaszt, es a ket szam kulon all', () => {
      const line = buildRestartLossLine(
        [dRow(700070, 'system', RESTART - 3 * 60_000, undefined, wakeHead), dRow(700071, 'mandark', RESTART - 4 * 60_000)], RESTART)
      expect(line).toContain('delivered AZ ABLAKBAN: 1')
      expect(line).toContain('700071<-mandark')
      expect(line).not.toContain('700070')
      expect(line).toContain('plusz 1 targytalan tetlen-or ebreszto')
    })

    it('delivered_at NELKULI delivered sort nem szamol (az injektalas ideje ismeretlen)', () => {
      const line = buildRestartLossLine(
        [{ id: 700080, status: 'delivered', created_at: sec(RESTART - 60_000), delivered_at: null, from_agent: 'didi' }],
        RESTART)
      expect(line).not.toContain('700080')
    })

    it('a `done` sor feldolgozott (completed_at), nem kerul bele', () => {
      const line = buildRestartLossLine(
        [{ id: 700090, status: 'done', created_at: sec(RESTART - 60_000), delivered_at: sec(RESTART - 60_000), from_agent: 'didi' }],
        RESTART)
      expect(line).not.toContain('700090')
      expect(line).toContain('NINCS mit ujrakuldeni')
    })

    it('sok sornal a LEGFRISSEBB kezbesiteseket listazza, a tobbit megszamolja', () => {
      const n = RESTART_DELIVERED_LIST_MAX + 3
      // szandekosan forditott created_at-sorrend: a lista a KEZBESITES szerint rendez
      const rows = Array.from({ length: n }, (_, i) =>
        dRow(710000 + i, 'dexter', RESTART - (i + 1) * 60_000, RESTART - (29 - i) * 60_000))
      const line = buildRestartLossLine(rows, RESTART)
      expect(line).toContain(`delivered AZ ABLAKBAN: ${n}`)
      expect(line).toContain('+3 korabbi')
      // a legfrissebb (1 perce) benne, a harom legregebbi nem
      expect(line).toContain('710000<-dexter 1 perce')
      for (let i = n - 3; i < n; i++) expect(line).not.toContain(`${710000 + i}<-`)
    })

    it('a failed es a delivered EGYUTT: mindketto kulon tetelkent all', () => {
      const line = buildRestartLossLine(
        [row(720001, 'failed', RESTART - 60_000), dRow(720002, 'computress', RESTART - 2 * 60_000)], RESTART)
      expect(line).toContain('failed AZ ABLAKBAN: 1')
      expect(line).toContain('delivered AZ ABLAKBAN: 1')
      expect(line).toContain('720002<-computress')
    })
  })
})
