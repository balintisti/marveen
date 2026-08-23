import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

// A KET AGGREGALT MERES (kartya 0e3959e4).
//
// A LELET: a kuldes elotti kuszob a sor MELYSEGET meri (darabszam), a
// cimzettnel viszont SZOVEG gyulik, es a terheles feladok kozott OSSZEADODIK.
// Merve (marveen, majd jarvis fuggetlenul ujra): 40 131 karakter ert be NEGY
// feladotol, a sor egyszer sem ment 3 FOLE, es az agens kozben ujraindult
// kontextus miatt. Mind a negy feladó betartotta a szabalyt.
//
// A ket hiany KULONBOZO, es egy csak-dimenzio javitas a masodikat nem oldja meg:
//   (1) DIMENZIO   -- a mérőszám darabszam, a korlat szovegmennyiseg
//   (2) AGGREGACIO -- a mérőszám feladonkent lathato, a terheles cimzettnel gyulik
//
// EZEK MERESEK, NEM KORLATOK. Hogy melyik szam blokkoljon es mennyinel, az a
// koordinacios reteg politikai dontese -- nem ezé a fuggvenyé.

let dir: string
let db: InstanceType<typeof Database>

const NOW = Math.floor(Date.now() / 1000)

function insert(from: string, to: string, content: string, agoMin: number, status = 'pending') {
  db.prepare(
    'INSERT INTO agent_messages (from_agent, to_agent, content, status, created_at) VALUES (?,?,?,?,?)',
  ).run(from, to, content, status, NOW - agoMin * 60)
}

/** A vizsgalt ket lekerdezes, ugyanazzal a SQL-lel, amit a db.ts hasznal. */
function pending(to: string) {
  return db.prepare(
    "SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(content)),0) AS chars FROM agent_messages WHERE status='pending' AND to_agent = ?",
  ).get(to) as { n: number; chars: number }
}
function recent(to: string, windowMin: number) {
  return db.prepare(
    'SELECT COALESCE(SUM(LENGTH(content)),0) AS chars, COUNT(DISTINCT from_agent) AS senders FROM agent_messages WHERE to_agent = ? AND created_at >= ?',
  ).get(to, NOW - windowMin * 60) as { chars: number; senders: number }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'queue-agg-'))
  db = new Database(join(dir, 't.db'))
  db.exec('CREATE TABLE agent_messages (id INTEGER PRIMARY KEY, from_agent TEXT, to_agent TEXT, content TEXT, status TEXT, created_at INTEGER, delivered_at INTEGER)')
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('(1) DIMENZIO -- a szoveg mennyisege, nem a sorok szama', () => {
  it('ket rovid es egy hosszu uzenet UGYANAZT a darabszamot adja, mas karakterszamot', () => {
    insert('a', 'jarvis', 'x'.repeat(20), 5)
    insert('b', 'jarvis', 'y'.repeat(20), 4)
    insert('c', 'didi', 'z'.repeat(20_000), 5)
    // A darabszam szerint didi terheltebb LENNE... nem: egyforma darab, 1000x szoveg.
    expect(pending('jarvis').n).toBe(2)
    expect(pending('didi').n).toBe(1)
    expect(pending('didi').chars).toBeGreaterThan(pending('jarvis').chars * 100)
  })

  it('a karakterszam a VARAKOZO sorokra vonatkozik, nem mindenre', () => {
    insert('a', 'jarvis', 'x'.repeat(100), 5, 'delivered')
    insert('a', 'jarvis', 'y'.repeat(10), 5, 'pending')
    expect(pending('jarvis').chars).toBe(10)
  })
})

describe('(2) AGGREGACIO -- a feladok kozott osszeadodik', () => {
  it('NEGY feladó kis kuldesei egyutt nagy szamot adnak (a mert eset alakja)', () => {
    // Egyik feladó sem lat semmi aggasztot a sajat kuldeseben.
    insert('friday', 'jarvis', 'a'.repeat(18_439), 120)
    insert('marveen', 'jarvis', 'b'.repeat(12_688), 90)
    insert('didi', 'jarvis', 'c'.repeat(8_001), 60)
    insert('system', 'jarvis', 'd'.repeat(1_003), 30)
    const r = recent('jarvis', 180)
    expect(r.chars).toBe(40_131)      // a kartyan allo mert osszeg
    expect(r.senders).toBe(4)
  })

  it('a feladok SZAMA is latszik -- ezt egy feladó sajat nezete SOSEM mutatja', () => {
    insert('friday', 'jarvis', 'a'.repeat(10), 10)
    insert('didi', 'jarvis', 'b'.repeat(10), 10)
    expect(recent('jarvis', 180).senders).toBe(2)
  })

  it('a KEZBESITETT uzenetek is szamitanak -- a gyors cimzettnel epp ez a lenyeg', () => {
    // Egy gyors agens uriti a sort, tehat a `pending` nulla marad EPP AKKOR,
    // amikor a terheles a legnagyobb. Amit megkapott, az a kontextusaban van.
    insert('friday', 'jarvis', 'a'.repeat(5_000), 30, 'delivered')
    expect(pending('jarvis').chars).toBe(0)
    expect(recent('jarvis', 180).chars).toBe(5_000)
  })
})

describe('az ABLAK, ami nelkul a szam nem allitas', () => {
  it('az ablakon KIVULI forgalom nem szamit bele', () => {
    insert('friday', 'jarvis', 'a'.repeat(9_999), 400)   // 6,6 oraja
    insert('friday', 'jarvis', 'b'.repeat(10), 5)
    expect(recent('jarvis', 180).chars).toBe(10)
  })

  it('egy SZUKEBB ablak epp a mert esetet vagna ketté', () => {
    // A mert incidens 23:10 -> 02:11 kozott futott, kb. harom ora. Egy 60 perces
    // ablak negy KIS szamot mutatna egy nagy helyett -- vagyis pont azt a
    // vaksagot hozna vissza, amit javitunk.
    insert('friday', 'jarvis', 'a'.repeat(20_000), 150)
    insert('didi', 'jarvis', 'b'.repeat(20_131), 20)
    expect(recent('jarvis', 180).chars).toBe(40_131)
    expect(recent('jarvis', 60).chars).toBe(20_131)
  })
})
