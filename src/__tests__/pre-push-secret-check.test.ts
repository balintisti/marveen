// A push elotti titok-ellenorzes DELEGAL, nem ismetli meg a kaput -- kartya dd5e07b4.
//
// A MERT ESET (2026-08-28): a lapon allo KEZI recept (`git ls-tree <ag> | grep <minta>`)
// egy elgepelt agnevre `fatal: Not a valid object name`-et irt a STDERR-re, a ciklus
// szamlaloja nullan maradt, es a verdikt "talalat: nincs" lett. **Egy nem letezo ag
// pontosan ugy nezett ki, mint egy tiszta ag.** A mero jo volt, a kontroll jo volt -- a
// BEMENET nem letezett, es errol a verdikt nem szolt.
//
// A repo sajat kapuja (`scripts/secret-gate.ts`, EVIDGUARD818) mindkettot tudja: fail-closed
// a meghatarozhatatlan halmazra, es kulon mondja a "NOT SCANNED"-et a "tiszta"-tol. Ez a
// szkript ezert NEM ellenoriz maga -- feloldja a refeket, aztan delegal.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'pre-push-secret-check.sh')

function run(...args: string[]) {
  const r = spawnSync('bash', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('a BEMENET feloldasa elozi meg az ellenorzest (dd5e07b4)', () => {
  it('NEM LETEZO ref -> 2, es kimondja, hogy ez NEM "tiszta"', () => {
    const r = run('fix/ez-a-ag-biztosan-nem-letezik-dd5e07b4')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/NEM OLDHATO FEL/)
    // A lenyeg nem a kod, hanem hogy a szoveg megkulonbozteti a ket allapotot.
    expect(r.out).toMatch(/nem vizsgaltunk meg/)
  })

  it('NEM LETEZO bazis -> szinten 2, es megnevezi a bazist', () => {
    const r = run('HEAD', 'origin/ez-a-bazis-sem-letezik')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/BAZIS nem oldhato fel/)
  })

  it('ARGUMENTUM NELKUL -> 2, hasznalati sorral', () => {
    const r = run()
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/hasznalat:/)
  })

  it('a verdikt MEGNEVEZI, MIT vizsgalt (ref + bazis SHA)', () => {
    // Ez a masodik fele a leletnek: a regi recept nem mondta meg, melyik fat nezte.
    // A HEAD-re futtatva a kimenet elso sora tartalmazza mindket SHA-t.
    const r = run('HEAD', 'HEAD')
    expect(r.out).toMatch(/pre-push-secret-check: HEAD = [0-9a-f]{40} \| bazis HEAD = [0-9a-f]{40}/)
  })
})

describe('a szkript a KAPUT hivja, nem sajat mintat (horgonyzott)', () => {
  const SRC = readFileSync(SCRIPT, 'utf-8')

  it('a `secret-gate.ts --range`-re delegal', () => {
    expect(SRC).toMatch(/secret-gate\.ts" --range/)
  })

  it('NINCS sajat minta-grep -- kulonben egy MASODIK, gyengebb igazsag keletkezne', () => {
    // marveen megfogalmazasa a lapon. Ha ide valaha visszakerul egy `grep -E '\\.env|id_rsa'`
    // alaku sajat lista, az pontosan az a masolat, ami miatt ez a kartya letezik.
    expect(SRC).not.toMatch(/grep -[a-zA-Z]*E .*id_rsa/)
    expect(SRC).not.toMatch(/service-account\\\\.json\|/)
  })

  it('a ref-feloldas MEGELOZI a delegalast (sorrend, nem jelenlet)', () => {
    // A KOMMENTEKET ELOSZOR CSUPASZITJUK -- a repo sajat szabalya, es ez a teszt
    // elsore EPP ezen bukott el: a `secret-gate.ts` a FEJLEC-KOMMENTBEN all elobb
    // (748. karakter), a kodban kesobb (2724.), tehat a sorrend-allitas a
    // MAGYARAZATOT merte, nem a kodot.
    const code = SRC.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')
    const resolve = code.indexOf('rev-parse --verify --quiet')
    const gate = code.indexOf('secret-gate.ts')
    expect(resolve).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(resolve)
  })

  it('a ki nem csekkolt ref eseten ideiglenes worktreet nyit, es NEM /tmp-ben', () => {
    // A kapu a TARTALMAT a munkafabol olvassa: enelkul egy masik agra "NOT SCANNED"-et
    // adna. A /tmp azert kizart, mert a hook-path guard elutasitja -- akkor a kapu egy
    // MASIK hibaba futna, es a verdikt megint mast merne, mint amit hiszunk.
    expect(SRC).toMatch(/worktree add --detach/)
    expect(SRC).toMatch(/\$HOME\/\.marveen-secretcheck-/)
    expect(SRC).not.toMatch(/\/tmp\/marveen-secretcheck/)
  })
})
