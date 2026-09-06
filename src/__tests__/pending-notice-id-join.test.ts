/**
 * A MEGTAGADAS-KESZLET TULELI A RESTARTOT, UJ ALLAPOT NELKUL (kartya 72cc2172, marveen dontese).
 *
 * A MERT INDOK: a keszlet a watcher memoriajaban elt, tehat egy restart torolte, es minden meg
 * mindig kuszob folotti uzenet ujra jelentodott. 2026-09-05: HAROM deploy, HAROM duplikatum,
 * restartonkent egy. A tartos rekord viszont MAR LETEZETT -- az ertesites maga is sor az
 * `agent_messages`-ben --, csak semmi nem mondta meg benne, MELYIK uzenetrol szolt: 779 "sorban"
 * szoveget tartalmazo rendszer-sorbol NULLA hordozott uzenet-ID-t (marveen merte).
 *
 * Ezert kerul az ID a szovegbe: a dedup ID-JOIN lesz, nem (kuldo, cimzett, origin-perc)
 * heurisztika egy perc kerekitesen.
 *
 * ES AMIERT A JELOLO AZ OSSZES ID-T SOROLJA, NEM AZ OLVASHATO OTOT: a szoveg `rows.slice(0, 5)`
 * -tel vag, tehat egy latszo sorokbol epitett jelolo a 6. uzenettol NEMAN nem fedne. Ma elmeleti
 * (51 ertesitesbol 49 egyet fed, egy kettot, egy harmat; max 3 az 5-os vagas ellen) -- de itt
 * olcso, kesobb regeszet.
 */
import { describe, it, expect } from 'vitest'
import {
  coveredIdsMarker, parseCoveredIds, coveredIdsStillPending,
  buildPendingStillWaitingNotice,
} from '../idle-agent.js'

const NOW = 1_800_000_000_000
const row = (id: number, agedMin = 70) =>
  ({ id, to_agent: 'didi', created_at: Math.floor((NOW - agedMin * 60_000) / 1000) })

describe('a jelolo: mit rogzit az ertesites', () => {
  it('oda-vissza megy', () => {
    expect(parseCoveredIds(coveredIdsMarker([7, 3, 11]))).toEqual([3, 7, 11])
  })

  it('a jelolo AZ OSSZES fedett ID-t viszi, nem csak a kiirt otot', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => row(i))
    const text = buildPendingStillWaitingNotice('friday', rows, NOW, new Map())
    // a lathato lista vag...
    // FORMATUM-FUGGETLEN szamlalas (kartya 2c420c7a): a regi `includes('-> didi')` a
    // cimzett-nyil SZOMSZEDOSSAGARA epult, es az uzenet-ID beszurasatol NULLARA esett --
    // vagyis a `toBe(5)` nem a vagast merte volna, hanem a formatumot. A tetel-sor
    // PREFIXE az, ami a vagas kerdesere valaszol.
    expect(text.split('\n').filter((l) => l.startsWith('  -> ')).length).toBe(5)
    // ...a jelolo NEM
    expect(parseCoveredIds(text)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('egy JELOLO NELKULI regi ertesites SEMMIT nem fed -- a hiba iranya egy tobblet-uzenet', () => {
    // Ez a fail-OPEN irany, es szandekos: egy olvashatatlan regi ertesites legrosszabb esetben
    // egy duplikatumot okoz. Fail-closed eseten egy VALODI jelzest nemitana el.
    expect(parseCoveredIds('[uzenet-or] regi szoveg, jelolo nelkul')).toEqual([])
    expect(parseCoveredIds('<!-- covered-ids:  -->')).toEqual([])
  })
})

describe('coveredIdsStillPending: a restart utani visszaallitas', () => {
  const notice = (ids: number[]) => coveredIdsMarker(ids)

  it('visszaallitja azt, amirol MAR szoltunk, ha meg mindig fuggoben van', () => {
    expect([...coveredIdsStillPending([notice([11923])], new Set([11923, 99]))]).toEqual([11923])
  })

  it('NEM allitja vissza azt, ami azota kezbesult -- ez hatarolja a keszletet', () => {
    expect([...coveredIdsStillPending([notice([11923])], new Set([99]))]).toEqual([])
  })

  it('KONTROLL: a mero tud NEM-ures halmazt is adni tobb ertesitesbol', () => {
    const got = coveredIdsStillPending([notice([1, 2]), notice([3])], new Set([1, 2, 3]))
    expect([...got].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('a jelolo nelkuli sorok nem szennyezik', () => {
    expect([...coveredIdsStillPending(['semmi jelolo itt', notice([5])], new Set([5, 6]))]).toEqual([5])
  })
})
