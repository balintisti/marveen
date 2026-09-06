/**
 * EGY BEAGYAZOTT UJRAMERO PARANCS MELLETT OTT KELL ALLNIA, MIT NEM SZUR (kartya ef696f05).
 *
 * A MECHANIZMUS. Egy ertesites, ami egysorost ad az olvasonak, PROXYT ad az or dontese helyett --
 * es a proxy soha nem azonos a dontessel, mert az or tobb bemenetbol dolgozik, mint amennyi egy
 * sorba belefer. Ha az elteres nincs kimondva, a sor a SZOMSZED kerdesre valaszol, az or
 * tekintelyevel a hata mogott. A `6958fca0` ezt EGY ertesitesen mar javitotta; a kartya azert
 * letezik, mert ugyanaz az alak azota ketszer ujraszuletett.
 *
 * A PIN NEM KOZOS SZARMAZTATAST KOVETEL, es ez marveen kikotese: egy kozos derivacio elpusztitana
 * a SZANDEKOS elteréseket (a pull-lista lane-szurojet, a review-sor mas predikatumat). Amit
 * megkovetel: az elteres LEGYEN KIMONDVA, es egy kozos konstanssal, hogy ezt gep is lassa --
 * ne egy proza-egyezes, ami az elso atfogalmazasnal elszakad.
 *
 * AZ 1. ESET POPULACIO-TELJES, SZANDEKOSAN. Nem a negy ismert epitot sorolja fel (egy OTODIK
 * ertesites ugy szuletne meg, hogy a pin nem tud rola -- ez a lap sajat "elavult populacio"
 * alakja), hanem a FORRASBAN keresi meg MINDEN `python3 -c` elofordulast, es mindegyiktol
 * megkoveteli a deklaraciot ugyanabban a fuggvenyben.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ASYMMETRY_NOTE, buildWakeMessage, buildNoWorkNotice, buildPullNotice,
} from '../idle-agent.js'

const SRC = readFileSync(new URL('../idle-agent.ts', import.meta.url), 'utf-8')

/** A forras fuggveny-torzsekre vagva, a top-level `function` hataran. */
function functionBodies(src: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = []
  const rx = /\n(?:export )?(?:async )?function ([A-Za-z0-9_]+)/g
  const marks: { name: string; at: number }[] = []
  let m: RegExpExecArray | null
  while ((m = rx.exec(src)) !== null) marks.push({ name: m[1], at: m.index })
  for (let i = 0; i < marks.length; i++) {
    out.push({ name: marks[i].name, body: src.slice(marks[i].at, marks[i + 1]?.at ?? src.length) })
  }
  return out
}

describe('beagyazott parancs = kimondott aszimmetria', () => {
  it('1. POPULACIO-TELJES: a forras MINDEN `python3 -c`-je mellett ott a deklaracio', () => {
    const bodies = functionBodies(SRC)
    // KONTROLL eloszor: a vago egyaltalan lat-e fuggvenyt, es megtalalja-e a parancsokat.
    expect(bodies.length).toBeGreaterThan(20)
    const withCmd = bodies.filter(b => b.body.includes('python3 -c'))
    expect(withCmd.length).toBeGreaterThanOrEqual(4)   // a negy ismert ertesites, vagy tobb
    const missing = withCmd.filter(b => !b.body.includes('ASYMMETRY_NOTE')).map(b => b.name)
    expect(missing).toEqual([])
  })

  it('2. KONTROLL: a mero TUD hianyt jelenteni', () => {
    // SZINTETIKUS forrason, NEM a valodin: kulonben a kontroll a valodi fahoz kotodne, es
    // barmely valodi hiany EZT is pirosra vinne -- akkor pedig nem kontroll, hanem az 1. eset
    // masodpeldanya. (Elso alakja pontosan igy volt rossz, es egy mutacio mutatta meg.)
    const fake = [
      'export function jo() {',
      '  return ["python3 -c foo", `${ASYMMETRY_NOTE} valamit`].join()',
      '}',
      'export function rossz() {',
      '  return "python3 -c bar"',
      '}',
    ].join('\n')
    const withCmd = functionBodies('\n' + fake).filter(b => b.body.includes('python3 -c'))
    expect(withCmd.map(b => b.name)).toEqual(['jo', 'rossz'])          // a vago mindkettot latja
    const missing = withCmd.filter(b => !b.body.includes('ASYMMETRY_NOTE')).map(b => b.name)
    expect(missing).toEqual(['rossz'])                                  // es szetvalasztja oket
  })

  it('3. VISELKEDES: mindharom epito KIIRJA a deklaraciot a parancs melle', () => {
    const items = [{ id: 'aaaaaaaa', title: 't', priority: 'normal', status: 'planned' }]
    const outs = [
      buildWakeMessage('didi', 30, 1, items as never, 0, 'assigned_open_cards'),
      buildNoWorkNotice('didi', 30, 0),
      buildPullNotice('didi', 30, items as never, 0, []),
    ]
    for (const o of outs) {
      expect(o).toContain('python3 -c')
      expect(o).toContain(ASYMMETRY_NOTE)
    }
  })

  it('4. az uzenet-or parancsa `pending`-et kerdez, NEM `pending`+`failed`-et', () => {
    // A jelentes valodi forrasa `WHERE status = 'pending'` (idle-agent-watcher.ts:137). A
    // `failed` sorok ELLENTETES teendot irnak elo (ujrakuldes), es sosem urulnek le maguktol.
    const guard = functionBodies(SRC).find(b => b.body.includes('from agent_messages where from_agent'))
    expect(guard).toBeDefined()
    expect(guard!.body).toContain("status='pending'")
    expect(guard!.body).not.toContain("status in ('pending','failed')")
  })

  it('5. a wake deklaracioja KOVETI a kind-ot -- ez volt a mert defektus', () => {
    // Merve 2026-09-06: a beagyazott PARANCS bajt-azonos volt a ket kind kozott, mikozben a
    // fuggveny ismeri a kind-ot (`isReviewQueue`). A parancs marad kozos (egy review-sort egy
    // egysoros nem tud reprodukalni -- ahhoz kommentek kellenek), de a DEKLARACIO elvalik.
    const items = [{ id: 'aaaaaaaa', title: 't', priority: 'normal', status: 'testing' }]
    const assigned = buildWakeMessage('didi', 30, 1, items as never, 0, 'assigned_open_cards')
    const review = buildWakeMessage('didi', 30, 1, items as never, 0, 'testing_without_my_comment')
    expect(assigned).not.toBe(review)
    expect(review).toContain('MASIK halmaz')
    expect(assigned).not.toContain('MASIK halmaz')
    // ...es MINDKETTO deklaral.
    for (const o of [assigned, review]) expect(o).toContain(ASYMMETRY_NOTE)
  })
})
