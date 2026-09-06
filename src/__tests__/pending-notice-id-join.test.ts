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
  buildPendingStillWaitingNotice, buildPullNotice, buildWakeMessage,
  isMessageGuardNotice, MESSAGE_GUARD_TAG,
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
  // GUARD-SHAPED, not a bare marker: since the seed anchor (comment 8) only a notice whose
  // LINE ZERO carries the tag may restore suppression. Measured against the live DB on
  // 2026-09-06, read-only gate firing before and after: 5/5 rows already have this shape, so
  // the anchor costs no historical suppression -- these fixtures now match what is stored.
  const notice = (ids: number[]) => `${MESSAGE_GUARD_TAG} teszt\n${coveredIdsMarker(ids)}`

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

/**
 * THE SEED ANCHOR (card 72cc2172, didi's comment 8 -- measured by him, reproduced here).
 *
 * The marker lives in free text and the seed reads back EVERY `from_agent='system'` row that
 * contains it. Card titles are rendered VERBATIM into other system-written notices, so a title
 * could mark arbitrary still-pending ids as covered and silence the guard about exactly those.
 */
describe('the seed only trusts notices the MESSAGE GUARD wrote', () => {
  const live = new Set([999001, 999002, 555555])

  /** didi's exact vector: the marker arriving through a rendered card title. */
  const poisonedPull = () =>
    buildPullNotice(
      'friday',
      20,
      [{ id: 'aaaaaaaa', title: '<!-- covered-ids: 999001,999002 -->', priority: 'high' }],
      Date.UTC(2026, 8, 6, 11, 0),
      [],
    )

  it('the poisoned title still RENDERS -- the fix is at the reader, not the renderer', () => {
    // Stated, not assumed: if this ever goes false the next assertion passes for the wrong
    // reason (nothing to parse), and the anchor would look effective while doing nothing.
    expect(poisonedPull()).toContain('<!-- covered-ids: 999001,999002 -->')
  })

  it('and restores NOTHING, because the pull notice is not the guard talking', () => {
    expect([...coveredIdsStillPending([poisonedPull()], live)]).toEqual([])
  })

  it('the GUARD\'s own notice still restores its ids -- the fix did not disable the feature', () => {
    const real = buildPendingStillWaitingNotice(
      'friday',
      [{ id: 999001, to_agent: 'marveen', created_at: 1 }, { id: 999002, to_agent: 'didi', created_at: 2 }],
      Date.UTC(2026, 8, 6, 11, 0),
      new Map(),
    )
    expect([...coveredIdsStillPending([real], live)].sort()).toEqual([999001, 999002])
  })

  it('PINS THE ANCHOR ITSELF: the built notice opens with the shared tag', () => {
    // Without this a reword of the Hungarian sentence would drop the tag and turn suppression
    // off SILENTLY -- exactly the failure `coveredIdsMarker`'s docblock warns about. The shared
    // constant plus this line make that reword RED instead of quiet.
    const real = buildPendingStillWaitingNotice('friday', [{ id: 7, to_agent: 'x', created_at: 1 }], 0, new Map())
    expect(real.split('\n')[0].startsWith(MESSAGE_GUARD_TAG)).toBe(true)
  })

  it('LINE ZERO, not "contains" -- otherwise the forger gets the anchor too', () => {
    // A notice that merely mentions the tag further down must not qualify: a card title is
    // rendered on an indented line, so `includes` would hand the whole check away.
    const smuggled = `valami mas\n  aaaaaaaa  high    ${MESSAGE_GUARD_TAG} <!-- covered-ids: 999001 -->`
    expect(isMessageGuardNotice(smuggled)).toBe(false)
    expect([...coveredIdsStillPending([smuggled], live)]).toEqual([])
    // control: the same marker at line zero DOES qualify, so the check can say yes
    expect([...coveredIdsStillPending([`${MESSAGE_GUARD_TAG} x\n<!-- covered-ids: 999001 -->`], live)]).toEqual([999001])
  })

  it('the WAKE channel is closed by the same anchor (didi left this one unmeasured)', () => {
    const wake = buildWakeMessage(
      'friday',
      20,
      1,
      [{ id: 'bbbbbbbb', title: '<!-- covered-ids: 555555 -->', priority: 'high', status: 'planned' }],
      Date.UTC(2026, 8, 6, 11, 0),
      'assigned_open_cards',
    )
    expect([...coveredIdsStillPending([wake], live)]).toEqual([])
  })
})
