import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A PUT-TAL ALLITHATO MEZOK LISTAJA SZARMAZZON A TIPUSBOL (didi megfigyelese, 2026-08-24).
//
// A `KANBAN_UPDATABLE` kezzel irt lista. Ma helyes -- didi vegigmerte, es a kihagyott ot mezo
// mindegyike jogosan marad ki. A gond a HOLNAP: ha valaki felvesz egy uj, PUT-tal allithato
// mezot a `KanbanCard`-ba es elfelejti felvenni ebbe a listaba, a frissites CSENDBEN ELVESZIK.
// Merve (didi, sajat szondaval):
//     PUT {"dispatched_at": 1234567890}  ->  200 {"ok":true,"changed":false}, az ertek valtozatlan
// Vagyis az API SIKERT jelent egy frissitesre, ami nem tortent meg.
//
// ES EZ EPP ENNEK A KARTYANAK (af9f6cd4) A FO MONDATANAK A TUKORKEPE. Jarvis megfogalmazasa:
// "egy or, ami KITALAL egy nem letezo tetelt, rosszabb, mint egy, ami ELMULASZT egyet -- az
// elsore nincs jelzes." Itt a masik irany all elo: a valasz azt allitja, hogy rendben van,
// mikozben semmi nem tortent. Ugyanaz a hiany, ellentetes elojellel.
//
// A JAVITAS NEM EGY UJABB KEZI LISTA, HANEM A SZARMAZTATAS -- ez ma este a NEGYEDIK helyen
// ugyanaz az alak (IdleAgentInput mezoi, a seed szabalyai, a doctor.sh szekcioi, es most ez).
const DB_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'db.ts'),
  'utf-8',
)

/**
 * A `KanbanCard` mezonevei -- KOMMENT NELKUL.
 *
 * A csupaszitas nem kozmetika: ebben az interfeszben tobb tiz sornyi JSDoc all (a `due_date`
 * egyseg-konvencioja egymaga tizenegy sor), es azokban a szovegekben mezonevek is szerepelnek.
 * Egy komment-erzekeny parser azokat is mezonek olvasna, es a lista NEMAN nonne.
 */
function cardFields(): string[] {
  const i = DB_SRC.indexOf('export interface KanbanCard {')
  if (i < 0) throw new Error('nincs KanbanCard interfesz a db.ts-ben -- ez a teszt nem allithat semmit')
  const body = DB_SRC.slice(i, DB_SRC.indexOf('\n}', i))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1] as string)
}

function updatableList(): string[] {
  const m = /const KANBAN_UPDATABLE = \[([\s\S]*?)\] as const/.exec(DB_SRC)
  if (!m) throw new Error('nincs KANBAN_UPDATABLE a db.ts-ben')
  return [...(m[1] as string).matchAll(/'([a-z_]+)'/g)].map((x) => x[1] as string)
}

/**
 * Amit SZANDEKOSAN nem lehet PUT-tal allitani -- mindegyik sajat indokkal, mert egy kivetel-lista
 * indok nelkul ugyanaz a kezi lista, csak masik neven.
 */
const NEM_ALLITHATO: Record<string, string> = {
  id: 'a sor azonositoja -- atirasa masik kartyat jelentene',
  seq: 'a rowid-bol szarmazik, nem tarolt szerkesztheto ertek',
  created_at: 'a letrehozas ideje; egy PUT nem valtoztathatja meg a multat',
  updated_at: 'EPP EZ A KARTYA TARGYA: a szerver allitja, es csak VALODI valtozasra',
  dispatched_at: 'sajat dedikalt fuggvenye van (db.ts, markKanbanCardDispatched), es a once-only ort az adja',
}

describe('KANBAN_UPDATABLE -- a lista a TIPUSBOL szarmazik, nem kezzel keszul', () => {
  it('a ket kivonat nem ures (kontroll a nema atmenes ellen)', () => {
    // Egy parser, ami ures listat ad, MINDEN alabbi allitast "teljesit" -- pontosan az a nema
    // siker, ami ellen ez az or epul.
    expect(cardFields().length).toBeGreaterThanOrEqual(10)
    expect(updatableList().length).toBeGreaterThanOrEqual(8)
    expect(cardFields()).toEqual(expect.arrayContaining(['title', 'status', 'dispatched_at']))
  })

  it('MINDEN mezo vagy allithato, vagy INDOKKAL kimarad -- harmadik eset nincs', () => {
    const hianyzik = cardFields().filter((f) => !updatableList().includes(f) && !(f in NEM_ALLITHATO))
    expect(
      hianyzik,
      `uj mezo a KanbanCard-ban, ami sem a KANBAN_UPDATABLE-ben, sem a kivetelek kozt nincs: ` +
        `${hianyzik.join(', ')} -- egy PUT ra CSENDBEN elveszne (200, changed:false)`,
    ).toEqual([])
  })

  it('a listan NINCS olyan mezo, ami nem is letezik a tipuson', () => {
    // A masik irany: egy atnevezett vagy torolt mezo a listaban maradva sosem illeszkedne,
    // es a lista hazudna arrol, mit lehet allitani.
    const szellem = updatableList().filter((k) => !cardFields().includes(k))
    expect(szellem).toEqual([])
  })

  it('AMI A LISTAN VAN, AZT AZ UPDATE IS IRJA -- a lista maga nem eleg', () => {
    // A masodik fele, es ugyanaz a nema-veszteseg alak: egy mezo lehet a listan (tehat
    // "valtozottnak" szamit, es megemeli az updated_at-et), mikozben az UPDATE oszlopai
    // kozott nincs ott -- vagyis a valasz `updated`-et mond, es az ertek nem valtozik.
    const sql = /UPDATE kanban_cards SET ([\s\S]*?)WHERE id=\?/.exec(DB_SRC)
    expect(sql, 'nincs UPDATE kanban_cards a db.ts-ben').not.toBeNull()
    const oszlopok = [...(sql![1] as string).matchAll(/(\w+)=\?/g)].map((m) => m[1] as string)
    for (const k of updatableList()) {
      expect(oszlopok, `a(z) "${k}" a KANBAN_UPDATABLE-ben van, de az UPDATE nem irja`).toContain(k)
    }
  })
})
