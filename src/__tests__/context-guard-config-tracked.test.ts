/**
 * A KONTEXT-OR KONFIGJA KOVETETT -- ES A NAIV .gitignore-JAVITAS ITT NEMAN NEM HAT.
 *
 * `store/context-guard.json` 2026-09-04-ig KOVETETLEN volt (kartya de0989de), es egy
 * `git clean -fd` nyomtalanul elvitte volna. AMIT PONTOSAN elvitt volna, merve: a teljes
 * 1446 bajtos fajl MINDEN agensnel EGYETLEN mezoben ter el a `DEFAULT_CONTEXT_GUARD`-tol,
 * es az az `idleFlushEnabled`. Vagyis a fajl elvesztese az idle-flusht kapcsolja KI mind a
 * het agensnek -- **nemán**, mert a kod-szintu default `false`, es a "nincs bejegyzes"
 * allapot LEGITIM (opt-in). Semmi nem naplozna, hogy a flotta vedelme eltunt.
 *
 * MIERT VISELKEDES-TESZT ES NEM SZOVEG-ILLESZTES (a testverfajl, gitignore-secret-shapes
 * indoklasat kovetve): a `git check-ignore` a git SAJAT dontese. Egy szoveg-illesztes
 * ("van-e benne !store/context-guard.json") ATMENNE a naiv alakon is -- es epp az a
 * csendes elromlas, ami ellen ez a teszt szol:
 *
 *     `store/`  + `!store/context-guard.json`  ->  MEG MINDIG IGNORALVA
 *     `store/*` + `!store/context-guard.json`  ->  kovetheto
 *
 * Egy KONYVTAR-minta megallitja a bejarast, tehat a negalas SOHA nem tuzel. Ugyanaz a
 * csapda, amit a `.gitignore` maga rogzit a `.claude/`-ra (CLAUDEIGN820) -- most a
 * `store/`-on. Aki a ket sort "rendbe teszi" egy `store/`-ra, nem hibat kap: a fajl
 * csendben kikerul a kovetesbol, es a kovetkezo `git clean` ismet elviszi.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** A git sajat valasza, nem a .gitignore szovege. */
function ignored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT })
    return true
  } catch {
    return false
  }
}

describe('store/context-guard.json is version-controlled', () => {
  it('git does NOT ignore it -- this is the assertion the naive fix fails', () => {
    expect(ignored('store/context-guard.json')).toBe(false)
  })

  it('and the rest of store/ stays ignored -- the negation must not widen', () => {
    // POZITIV KONTROLL a mero-re: ha ezek is `false`-t adnanak, a fenti sor nem azt
    // bizonyitana, hogy a negalas hat, hanem azt, hogy a store/ egyaltalan nincs ignoralva.
    for (const p of [
      'store/.dashboard-token',
      'store/claudeclaw.db',
      'store/prod-tree-override.log',
      'store/valami-uj-runtime-allapot.json',
      'store/alkonyvtar/barmi.txt',
    ]) {
      expect(ignored(p), `${p} nem maradt ignoralva`).toBe(true)
    }
  })

  it('the file is actually IN the index, not merely un-ignored', () => {
    // A ket allitas kulon: egy fajl lehet "nem ignoralt" ES kovetetlen egyszerre.
    // Az adatvesztes ellen a MASODIK ved -- `git clean -fd` a kovetetlen fajlt viszi.
    const tracked = execFileSync('git', ['ls-files', 'store/context-guard.json'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim()
    expect(tracked).toBe('store/context-guard.json')
  })

  it('carries what the code default does NOT: idleFlushEnabled for every agent', () => {
    // EZ AZ ALLITAS A LENYEG, nem a kovetes maga. Ha valaki egyszer a kod-szintu
    // defaultot allitja at, ez a fajl feleslegesse valik -- es akkor ez a teszt lesz az,
    // ami megmondja, hogy mar nem hordoz semmit. Ma mind a hetet o hordozza.
    const p = join(ROOT, 'store', 'context-guard.json')
    expect(existsSync(p)).toBe(true)
    const cfg = JSON.parse(readFileSync(p, 'utf8')) as Record<string, Record<string, unknown>>
    const agents = Object.keys(cfg)
    expect(agents.length).toBeGreaterThanOrEqual(7)
    for (const a of agents) {
      expect(cfg[a].idleFlushEnabled, `${a}: idleFlushEnabled`).toBe(true)
    }
  })
})
