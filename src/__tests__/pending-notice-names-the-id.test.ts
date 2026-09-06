/**
 * A SORBAN-ALLO UZENET SORA MEGNEVEZI AZ UZENET ID-JAT (kartya 2c420c7a).
 *
 * A MECHANIZMUS. A sor eddig a CIMZETTET, egy KEREKITETT PERCET es a panel-allapotot adta. Ket
 * kulonbozo uzenet ugyanannak a cimzettnek, ugyanabban a percben, azonos panel-allapottal
 * BAJT-AZONOS sort termel -- tehat a jelentesbol nem allapithato meg, HANY uzenetrol es MELYIKROL
 * szol. A mert ar: egy hianyzo id ket agens koret vitte el egy napon (dexter a merest, friday az
 * ellenorzest), mert a ket ertesites KET KULONBOZO uzenetrol szolt es egynek olvasodott.
 *
 * A FIXTURE OTT VAN, AHOL A HELYES ES A HELYTELEN ALAK SZETVALIK, es ez teherhordo: KET sor,
 * AZONOS cimzett, AZONOS perc. Barmely mas fixture-on (kulonbozo cimzett vagy kulonbozo kor) a
 * ket implementacio MAR MA IS kulonbozo sort ad, tehat a teszt zold lenne az id NELKUL is -- es
 * nem allitana semmit. Ezt a 2. eset kontrollkent ki is mondja.
 *
 * A TIPUS MAR HORDOZTA az `id`-t (a `72cc2172` vitte bele a covered-id jelolohoz); csak a
 * sor-formazo parameter-tipusa volt nala szukebb. Egyetlen hivasi hely sem valtozott.
 */
import { describe, it, expect } from 'vitest'
import { buildPendingStillWaitingNotice } from '../idle-agent.js'

const NOW = 1_800_000_000_000
/** Ugyanaz a cimzett, ugyanaz a KOR -> a ket sor csak az ID-ben terhet el. */
const row = (id: number, to = 'didi', agedMin = 70) =>
  ({ id, to_agent: to, created_at: Math.floor((NOW - agedMin * 60_000) / 1000) })

const panes = new Map([['didi', 'busy' as const], ['dexter', 'busy' as const]])
const notice = (rows: ReturnType<typeof row>[]) =>
  buildPendingStillWaitingNotice('friday', rows, NOW, panes)

/** A `  -> ` prefixu sorok: a per-uzenet sorok, a jelolo es a proza nelkul. */
const itemLines = (s: string) => s.split('\n').filter(l => l.startsWith('  -> '))

describe('a sorban-allo uzenet sora megnevezi az id-t', () => {
  it('1. A LELET: ket uzenet AZONOS cimzettnek AZONOS percben KULON sort ad', () => {
    const lines = itemLines(notice([row(41), row(42)]))
    expect(lines).toHaveLength(2)
    expect(lines[0]).not.toBe(lines[1])      // az id NELKUL ez a ketto bajt-azonos volna
    expect(lines[0]).toContain('#41')
    expect(lines[1]).toContain('#42')
  })

  it('2. KONTROLL: a fixture nelkul a teszt semmit nem allitana', () => {
    // KULONBOZO cimzett -> a ket sor MAR AZ ID NELKUL IS elter, tehat egy ilyen fixture-re
    // epitett allitas az id-tlen valtozaton is zold lenne. Ezert all az 1. eset AZONOS
    // cimzetten es AZONOS koron.
    const lines = itemLines(notice([row(41, 'didi'), row(42, 'dexter')]))
    const stripped = lines.map(l => l.replace(/#\d+ /, ''))
    expect(stripped[0]).not.toBe(stripped[1])   // az ID-t ELTAVOLITVA IS kulonboznek
  })

  it('3. az id a CIMZETT ELOTT all, hogy a sor elejen lathato legyen', () => {
    const [l] = itemLines(notice([row(41)]))
    expect(l.indexOf('#41')).toBeLessThan(l.indexOf('didi'))
  })

  it('4. KONTROLL: a tobbi mezo megmaradt -- nem cseretem le a sort', () => {
    const [l] = itemLines(notice([row(41)]))
    expect(l).toContain('didi')
    expect(l).toContain('70 perce all sorban')
    expect(l).toContain('BUSY')
  })
})
