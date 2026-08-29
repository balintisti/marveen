import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A SZALLITOTT SKILLEK NEM HIVATKOZHATNAK EGY MASIK GEPRE.
//
// A telepito a `seed-skills/`-t SIMA `cp`-vel masolja -- NINCS mogotte `sed`
// helyettesites. Merve 2026-08-23: nulla `sed` sor a seed-skills hurokban,
// `install-macos.sh`-ban ES `install-linux.sh`-ban egyarant. Ez a
// `seed-scheduled-tasks`-tol ELTER, ahol van csere -- es epp ez a kulonbseg az,
// ami konnyen atsiklik: ugyanaz a `seed-` elotag, ket kulonbozo szerzodes.
//
// Ebbol ket kovetkezmeny, es mindketto sajat allitast kap:
//   - egy ABSZOLUT ut (`/Users/...`, `/home/...`) egy masik gepen NEM LETEZIK, es
//     egy parancs, ami nem letezo utra mutat, rosszabb, mint ha nem lenne ott;
//   - egy KAPCSOS-ZAROJELES helyorzo NYERSEN szallitana, mert nincs, ami kicserelje.
//
// A meglevo kilenc seed-skill MA IS megfelel ennek (merve: nulla talalat) -- ez a
// teszt nem uj kovetelmenyt vezet be, hanem a MEGLEVO konvenciot teszi
// ellenorizhetove, mielott az elso megsertes eszrevetlenul beszivarog.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SEED = join(ROOT, 'seed-skills')

function osszesFajl(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...osszesFajl(p))
    else out.push(p)
  }
  return out
}

const fajlok = osszesFajl(SEED)

describe('seed-skills -- a szallitott peldany nem kotodhet egy gephez', () => {
  it('POZITIV KONTROLL: van egyaltalan mit ellenorizni', () => {
    // Egy ur konyvtar felett minden allitas igaz. Ez a sor mondja meg, hogy a
    // lenti nullak MERESBOL jonnek, nem uressegbol.
    expect(fajlok.length).toBeGreaterThan(5)
    expect(fajlok.some((f) => f.includes('reggeli-napindito'))).toBe(true)
  })

  it('EGYETLEN seed-skill sem tartalmaz home-konyvtarra mutato abszolut utat', () => {
    const rossz: string[] = []
    for (const f of fajlok) {
      const txt = readFileSync(f, 'utf-8')
      for (const [i, sor] of txt.split('\n').entries()) {
        if (/\/(Users|home)\/[A-Za-z0-9_.-]+/.test(sor)) rossz.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
      }
    }
    expect(rossz).toEqual([])
  })

  it('EGYETLEN seed-skill sem tartalmaz ki nem cserelt helyorzot', () => {
    // A `seed-scheduled-tasks` mintaja ide NEM ervenyes: ott van `sed`, itt nincs.
    const rossz: string[] = []
    for (const f of fajlok) {
      const txt = readFileSync(f, 'utf-8')
      for (const [i, sor] of txt.split('\n').entries()) {
        if (/\{\{[A-Z_]+\}\}/.test(sor)) rossz.push(`${f.slice(ROOT.length + 1)}:${i + 1}`)
      }
    }
    expect(rossz).toEqual([])
  })

  it('a napindito seed-je a CLAW_DIR-bol oldja fel a gyokeret', () => {
    // Nem eleg, hogy nincs abszolut ut: a parancsoknak MUKODNIUK is kell.
    // A `fleet-helper` seed-skill ugyanezt a konvenciot hasznalja.
    const txt = readFileSync(join(SEED, 'reggeli-napindito', 'SKILL.md'), 'utf-8')
    expect(txt).toContain('$CLAW_DIR/scripts/')
  })
})
