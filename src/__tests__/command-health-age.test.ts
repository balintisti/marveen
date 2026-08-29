import { describe, it, expect } from 'vitest'
import { assessCommandHealth } from '../web/command-health-age.js'
import type { CommandHealth } from '../web/command-task.js'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// MINDEN ESET EXPLICIT IDOZONAT AD, es ez mert defektus-javitas. Az elso
// valtozat UTC-ben irta az elvarasokat, es KET teszt bukott rajta: a cron
// HELYI idoben ertelmezodik (a repo szabalya: Europe/Budapest), tehat a
// `0 4 * * 3` valojaban 02:00 UTC-kor tuzel. A ket ora elteres eleg volt ahhoz,
// hogy egy hatar-eset atbillenjen. Egy teszt, ami a futtato gep idozonajatol
// fugg, mas gepen mast allit -- ezert all itt kiirva, nem alapertelmezesbol.
const TZ = 'Europe/Budapest'

// Kartya bae4df49. A tarolt `lastStatus` az UTOLSO FUTAS eredmenye, es csak
// futaskor irodik ujra -- tehat pontosan az a hiba, amit el kellene kapnia (a
// feladat nem fut), az, amitol a mezo valtozatlan marad.
//
// A KET KONTROLL A VALODI ELES BEJEGYZESEKBOL JON, es a masodik azert, mert azt
// 2026-08-23-an a koordinator FELREOLVASTA: az `auto-update`-et "2026-08-19 ota
// nem futott"-kent jelentette. Ujramerve a cronja `0 4 * * 3`, 08-19 SZERDA
// volt, a meres napja vasarnap -- vagyis menetrend szerint futott. Ha ez a
// fuggveny `stale`-t adna ra, ugyanazt a hibat automatizalnank, csak gyorsabban.

const ms = (s: string) => new Date(s).getTime()

const health = (over: Partial<CommandHealth> = {}): CommandHealth => ({
  fails: 0, alerted: false, lastStatus: 'ok', lastRun: 0, ...over,
})

describe('assessCommandHealth -- a kor a feladat SAJAT menetrendjebol jon', () => {
  it('NEGATIV KONTROLL (a felreolvasott eset): heti szerdai feladat vasarnap = ok', () => {
    // Ez a valodi eles bejegyzes. Negy nap eltelt, es MEGIS egeszseges.
    const a = assessCommandHealth(
      health({ lastRun: ms('2026-08-19T04:00:00Z') / 1000 }),   // szerda, masodperc-alapu
      '0 4 * * 3',
      ms('2026-08-23T15:44:00Z'), TZ,                            // vasarnap
    )
    expect(a.verdict).toBe('ok')
    expect(a.ageMs! / 86400000).toBeGreaterThan(4)              // tenyleg 4+ napos
  })

  it('NEGATIV KONTROLL: tiz-percenkenti feladat, ket perce futott = ok', () => {
    const most = ms('2026-08-23T15:44:00Z')
    const a = assessCommandHealth(health({ lastRun: most - 2 * 60 * 1000 }), '*/10 * * * *', most, TZ)
    expect(a.verdict).toBe('ok')
  })

  it('POZITIV KONTROLL: heti feladat, ami KIHAGYTA a szerdat = stale', () => {
    // Ugyanaz a feladat, ugyanaz a cron -- csak egy hettel korabbi utolso futas.
    const a = assessCommandHealth(
      health({ lastRun: ms('2026-08-12T04:00:00Z') / 1000 }),
      '0 4 * * 3',
      ms('2026-08-23T15:44:00Z'), TZ,
    )
    expect(a.verdict).toBe('stale')
    // MERT ertek, nem levezetett: a szerdai tuzeles helyi 04:00 = 02:00 UTC.
    expect(a.missedAt).toBe(ms('2026-08-19T02:00:00Z'))
    expect(a.reason).toContain('kihagyott')
  })

  it('POZITIV KONTROLL: tiz-percenkenti feladat, ket oraja nem futott = stale', () => {
    const most = ms('2026-08-23T15:44:00Z')
    const a = assessCommandHealth(health({ lastRun: most - 2 * 3600 * 1000 }), '*/10 * * * *', most, TZ)
    expect(a.verdict).toBe('stale')
  })

  it('a `stale` FELULIRJA a tarolt "ok"-t -- ez az egesz lenyege', () => {
    const a = assessCommandHealth(
      health({ lastStatus: 'ok', fails: 0, lastRun: ms('2026-01-01T04:00:00Z') / 1000 }),
      '0 4 * * 3', ms('2026-08-23T15:44:00Z'), TZ)
    expect(a.verdict).not.toBe('ok')
    expect(a.verdict).toBe('stale')
  })

  it('a friss BUKAS bukas marad, nem nyeli el az elavulas-vizsgalat', () => {
    const most = ms('2026-08-23T15:44:00Z')
    const a = assessCommandHealth(health({ lastStatus: 'fail', fails: 3, lastRun: most - 60_000 }), '*/10 * * * *', most, TZ)
    expect(a.verdict).toBe('fail')
    expect(a.reason).toContain('3')
  })

  it('a soha nem futott feladat NEM "ok", hanem sajat allapot', () => {
    // Egy hianyzo bejegyzes a legcsendesebb eset: nincs mit felreolvasni rajta.
    expect(assessCommandHealth(undefined, '0 4 * * 3', ms('2026-08-23T15:44:00Z'), TZ).verdict).toBe('never-run')
    expect(assessCommandHealth(health({ lastRun: 0 }), '0 4 * * 3', ms('2026-08-23T15:44:00Z'), TZ).verdict).toBe('never-run')
  })

  it('ERTELMEZHETETLEN cron -> `unknown`, SOHA nem "ok"', () => {
    // Ha nem tudjuk kiszamolni, mikor kellett volna futnia, akkor nem tudjuk
    // megmondani, hogy egeszseges-e. A "nem tudom" nem lehet zold.
    const a = assessCommandHealth(health({ lastRun: 1 }), 'ez nem cron', ms('2026-08-23T15:44:00Z'), TZ)
    expect(a.verdict).toBe('unknown')
  })

  it('a masodperc- ES az ezredmasodperc-alapu lastRun-t is kezeli', () => {
    // Az eles fajlban MASODPERC all; a kod `Date.now()`-ot ir. A ketto kozti
    // 1000-es szorzo egy elavulas-vizsgalatot 30 ev elteresre allitana.
    const most = ms('2026-08-23T15:44:00Z')
    const mp = assessCommandHealth(health({ lastRun: Math.floor((most - 60_000) / 1000) }), '*/10 * * * *', most, TZ)
    const ezred = assessCommandHealth(health({ lastRun: most - 60_000 }), '*/10 * * * *', most, TZ)
    expect(mp.verdict).toBe('ok')
    expect(ezred.verdict).toBe('ok')
  })

  it('a tures elnyeli a menetrend hatarat, tehat a jelzes nem villog', () => {
    // Tuzeles utan ket perccel, MIELOTT a futtato tickje elinditotta volna.
    const most = ms('2026-08-23T02:02:00Z')  // helyi 04:02
    const a = assessCommandHealth(health({ lastRun: ms('2026-08-22T02:00:00Z') / 1000 }), '0 4 * * *', most, TZ)
    expect(a.verdict).toBe('ok')
  })
})

describe('a BEKOTES -- es kimondom, hogy ez szoveg-rogzites', () => {
  // A fuggveny onmagaban semmit nem er, ha nincs FOGYASZTOJA: a
  // `command-task-health.json`-nak eddig EGYALTALAN nem volt olvasoja, csak
  // iroja. Ezert kotottem be a `/api/schedules` valaszaba.
  //
  // MIERT NEM VEGPONT-TESZT: az a route az ELES `~/.claude/scheduled-tasks`
  // tartalmat es az eles health-fajlt olvassa, tehat egy ilyen teszt a futtato
  // gep allapotat merne, nem a kodot -- es egy fris telepitesen ures halmazon
  // futna zoldre. Ez a hatar, es inkabb kiirom, mint hogy egy kornyezet-fuggo
  // teszt adjon hamis biztonsagot.
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const route = readFileSync(join(ROOT, 'src', 'web', 'routes', 'schedules.ts'), 'utf-8')

  it('a GET /api/schedules a SZARMAZTATOTT allapotot adja, nem a nyerset', () => {
    expect(route).toContain('assessCommandHealth')
    expect(route).toContain('readCommandHealth')
  })

  it('CSAK a command-tipusu feladatokra teszi ra', () => {
    // Egy agens-feladatnak nincs command-health-je; ha mindenre ratennenk,
    // `never-run` jelenne meg olyan feladatokon, amiknek ez a mezo nem szol.
    expect(route).toMatch(/type === 'command'/)
  })
})

