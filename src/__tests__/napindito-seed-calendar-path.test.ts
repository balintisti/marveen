import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Kartya 48940af0: HAROM dokumentum HAROM kulonbozo naptar-utat irt elo, es az agens a NEM
// LETEZOT valasztotta. Az eset javitva lett a TELEPITETT peldanyokban -- de a REPO seedje
// (`scheduled-tasks/`, amit az `ensureDefaultScheduledTasks()` masol friss telepiteskor)
// 2026-09-03-ig valtozatlan maradt. Merve aznap: a futo peldany 67 sor es hordozza a harom
// agat, a seed 46 sor es EGYIKET SEM.
//
// A KOCKAZAT PONTOS ALAKJA, es szandekosan szukebb, mint amitol elsore tartottam: a seeder
// `if (existsSync(dest)) continue` -- tehat egy ujra-provisioning NEM irja felul a mar javitott
// futo peldanyt. A regresszio FRISS telepitesen (vagy a task-konyvtar torlese utan) all elo.
// Ez az OTODIK ALLAPOT csaladja: a javitas csak a telepitett peldanyban el, es a repo nem viszi.

const SHIPPED = [
  'scheduled-tasks/reggeli-napindito/SKILL.md',
  'seed-skills/reggeli-napindito/SKILL.md',
]

describe('napindito: a SZALLITOTT peldanyok a LETEZO naptar-utat irjak elo (48940af0)', () => {
  for (const rel of SHIPPED) {
    it(`${rel} a valodi szkriptet nevezi meg`, () => {
      const p = join(REPO, rel)
      expect(existsSync(p), `hianyzik: ${rel}`).toBe(true)
      const text = readFileSync(p, 'utf-8')
      expect(text, 'a naptar-lekerdezes EGY parancs, es azt kell megnevezni').toContain(
        'scripts/calendar-agenda.sh',
      )
    })

    // A DEFEKTUS NEM AZ VOLT, HOGY HIANYZOTT A JO UT, HANEM HOGY OTT ALLT MELLETTE EGY ROSSZ.
    //
    // ES A SZUROT A PARANCS-BLOKKOKRA KELL SZUKITENI, NEM A TELJES SZOVEGRE. Elso alakja a
    // nyers szovegben kereste a holt neveket, es PIROSRA MENT a `seed-skills` peldanyon --
    // ahol a `search_emails` egy TILTAS reszekent all ("ne ezzel probald, nincs bekotve"),
    // a hozza tartozo tanulsaggal egyutt. Az SIRKO, nem eloiras: egy jo szerzo leirja, mit
    // vett ki es miert. Egy tartalom-ellenorzes, ami a sirkovet is jeloli, arra tanit, hogy
    // toroljuk a magyarazatot -- pontosan a rosszabb iranyba.
    //
    // Amit az agens FUTTAT, az a ```bash blokk. A holt utat OTT tiltjuk, prozaban nem.
    it(`${rel} PARANCS-BLOKKJA nem hivatkozik nem letezo naptar-utra`, () => {
      const text = readFileSync(join(REPO, rel), 'utf-8')
      const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n')
      for (const dead of ['google-calendar-mcp/tokens.json', 'search_emails']) {
        expect(blocks.includes(dead), `holt eloiras egy FUTTATHATO blokkban: ${dead}`).toBe(false)
      }
      // KONTROLL: a blokk-kinyeres tenyleg talalt valamit -- kulonben az ures sztringben
      // barmi hianya trivialisan igaz, es a teszt semmit nem allitana.
      expect(blocks.length, 'nulla bash-blokk: a kinyeres romlott el, nem a fajl tiszta').toBeGreaterThan(0)
    })
  }

  // A ket szallitott peldany UGYANAZT az utat nevezze meg. Ha szetcsusznak, megint harom
  // dokumentum lesz harom allitassal -- ez a kartya sajat leletje.
  it('a ket szallitott peldany UGYANAZT a szkriptet nevezi', () => {
    const paths = SHIPPED.map((rel) => {
      const m = readFileSync(join(REPO, rel), 'utf-8').match(/scripts\/[a-z-]+\.sh/g) ?? []
      return [...new Set(m)].filter((x) => x.includes('calendar')).sort().join(',')
    })
    expect(paths[0], 'a ket seed mas naptar-utat nevez').toBe(paths[1])
    expect(paths[0].length, 'egyik sem nevez naptar-utat').toBeGreaterThan(0)
  })
})
