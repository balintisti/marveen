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
  ASYMMETRY_NOTE, VALID_KINDS, buildWakeMessage, buildNoWorkNotice, buildPullNotice,
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

  it('6. a `waiting_on_me` NEM allitja magat `assigned_open_cards`-nak (kartya faa6003a)', () => {
    // AZ 5. ESET KET KINDOT PINELT, ES A HARMADIK KESOBB ERKEZETT. A cimke 2026-09-06-an
    // (5f36f85c) TELJES volt -- harom kind letezett, a kommentje is "a HAROM kozul csak az
    // EGYIKET"-et mondja. 2026-09-11-en a `waiting_on_me` negyedikkent bekerult (b2516432),
    // es a KETAGU ternary ELSE-age ota azt allitotta rola, hogy a deklaracioja
    // `assigned_open_cards`, ES hogy a beagyazott parancs "ugyanazt a halmazt kerdezi".
    // Merve 2026-09-17 a koordinatoron: a felajanlott top5 (mind `waiting`) kozul NULLA
    // szerepelt a parancs 305-os listajaban -- ket DISZJUNKT halmaz, kozel-azonossagnak
    // nevezve. Ez a lap "egy uj tag or nelkul erkezik" alakja, egy uzenet-cimken.
    const items = [{ id: 'aaaaaaaa', title: 't', priority: 'high', status: 'waiting' }]
    const wom = buildWakeMessage('marveen', 12, 74, items as never, 0, 'waiting_on_me')
    expect(wom).toContain('`waiting_on_me`')            // a SAJAT kindjet nevezi meg
    expect(wom).not.toContain('`assigned_open_cards`')  // es nem a masikat
    expect(wom).toContain('MASIK halmaz')               // az oszinte alak, a review-agrol atveve

    // KONTROLL, MERT ENELKUL A PIN FELE TRIVIALISAN TELJESULNE: az `assigned_open_cards`
    // agensnek TOVABBRA IS a kozel-azonossagot kell mondania. Ha valaki a cimket egyszeruen
    // elnemitana, ez a fele PIROSRA megy.
    const aoc = buildWakeMessage('didi', 12, 74, items as never, 0, 'assigned_open_cards')
    expect(aoc).toContain('`assigned_open_cards`')
    expect(aoc).not.toContain('MASIK halmaz')
  })

  it('7. OSZTALY-SZINTU: MINDEN kind a SAJAT nevet kapja, es csak azt (kartya faa6003a)', () => {
    // MIERT ITERAL, ES MIERT NEM SOROL FEL: a ket eddigi hiba UGYANAZ volt -- egy KEZZEL irt
    // felsorolas, ami a sajat pillanataban TELJES volt, es egy kesobb hozzaadott kind mellett
    // nemán hamissa valt (a cimke 09-06-an, a `buildNoWorkNotice` prozaja ugyanakkor; a negyedik
    // kind 09-11-en erkezett). Egy `VALID_KINDS`-en futo ciklus egy OTODIK kindtol magatol
    // pirosra megy -- ez az, amit egy per-eset pin nem tud.
    //
    // ES MEGFELELTETES, NEM JELENLET: nem az a kerdes, hogy a kind neve OTT VAN-E valahol,
    // hanem hogy a SAJATJAT kapja-e ES a tobbit NEM. Egy "tartalmazza a kindot" assert atmenne
    // egy olyan uzeneten is, ami MINDET felsorolja.
    expect([...VALID_KINDS].sort()).toEqual(
      ['assigned_open_cards', 'none', 'testing_without_my_comment', 'waiting_on_me'],
    )
    const items = [{ id: 'aaaaaaaa', title: 't', priority: 'high', status: 'waiting' }]
    const woken = VALID_KINDS.filter(k => k !== 'none')   // a `none` agens nem kap ebresztest
    expect(woken.length).toBe(3)                          // KONTROLL: a szures nem uritette ki
    for (const k of woken) {
      const msg = buildWakeMessage('didi', 12, 1, items as never, 0, k)
      expect(msg, `a(z) ${k} uzenete nem nevezi meg a sajat kindjat`).toContain('`' + k + '`')
      for (const other of woken) {
        if (other === k) continue
        expect(msg, `a(z) ${k} uzenete a(z) ${other} kindot emliti`).not.toContain('`' + other + '`')
      }
    }
  })

  it('8. a NO-WORK ertesites sem sorol fel kezzel -- ez a MASODIK helyszin (kartya faa6003a)', () => {
    // didi merte 2026-09-17: ugyanaz a defektus `buildNoWorkNotice`-ban, es ott SULYOSABB, mert
    // a fuggveny meg csak MEG SEM KAPTA a kindot -- tehat PARAMETER kellett, nem uj ag. Es a
    // javitas utan MUTACIOVAL merve (M3: a kezi felsorolas visszaallitva) a TELJES keszlet
    // 468 fajl / 5937 teszt / 0 bukas mellett TULELT -- vagyis SEMMI nem pinelte. Ez az a pin.
    //
    // A KIKOTES, amiert ez nem "ne emlitsen mas kindot": ez az ertesites JOGGAL emliti a
    // `{"kind":"none"}`-t, mert azt TANACSOLJA a koordinatornak. A tiltas ezert a felsorolo
    // alakra szol: ha a SUBJECT kindja ISMERT, egy MASIK deklaraciot ne nevezzen meg.
    const known = buildNoWorkNotice('jarvis', 20, 0, 'waiting_on_me')
    expect(known).toContain('`waiting_on_me`')                       // a sajatjat megnevezi
    expect(known).not.toContain('`testing_without_my_comment`')      // idegen deklaraciot nem

    // ES A KIND NELKULI AG: ott nem lehet megnevezni, tehat NEM felsorol, hanem altalanosit.
    const unknown = buildNoWorkNotice('jarvis', 20, 0)
    expect(unknown).toContain('MINDEN MAS')
    expect(unknown).not.toContain('`testing_without_my_comment`')

    // KONTROLL, hogy a mero TUD kulonbseget mondani: a ket kimenet ne legyen azonos, es az
    // `assigned_open_cards` ag TOVABBRA is nevezze meg magat.
    expect(known).not.toBe(unknown)
    expect(buildNoWorkNotice('jarvis', 20, 0, 'assigned_open_cards')).toContain('`assigned_open_cards`')
  })

  it('9. a GENERIKUS ag csak azt mondja, ami MINDEN kindre igaz (didi, faa6003a k6)', () => {
    // didi merte: az elozo alak a `waiting` oszlopot nevezte meg INDOKKENT az alapertelmezett agon.
    // Egy JOVOBELI otodik kindnel, `planned` statuszu felajanlott tetellel, az a mondat HAMIS
    // lenne -- a re-query `status not in ('done','waiting')`, tehat egy `planned` tetel BENNE
    // LENNE. Es a folotte allo kommentem azt allitotta, hogy egy otodik kind "hamisat nem tud
    // allitani": a CIMKERE igaz volt, erre a MONDATRA nem. Ugyanaz az alak, egy reteggel lejjebb.
    //
    // A `as never` SZANDEKOS: a generikus ag ma ELERHETETLEN a VALID_KINDS-bol, tehat csak igy
    // lehet megnezni, mit mondana. Ez a teszt a JOVOT pineli, nem a jelent.
    const items = [{ id: 'aaaaaaaa', title: 't', priority: 'high', status: 'planned' }]
    const future = buildWakeMessage('didi', 12, 1, items as never, 0, 'future_kind' as never)
    expect(future).toContain('`future_kind`')          // megnevezi, amit kapott
    expect(future).toContain('MASIK halmaz')           // es kimondja az elterest
    expect(future).not.toContain('kihagyja a')         // de NEM indokolja `waiting`-gel

    // KONTROLL, hogy a pin diszkriminal: a `waiting_on_me` ag TOVABBRA IS megnevezi az okot,
    // mert ott IGAZ. Ha valaki egyszeruen kivenne az indoklast mindenhonnan, ez pirosra megy.
    const wom = buildWakeMessage('didi', 12, 1, items as never, 0, 'waiting_on_me')
    expect(wom).toContain('kihagyja a')
    expect(wom).toContain('`waiting` oszlopot')
  })
})
