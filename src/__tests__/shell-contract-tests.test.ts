/**
 * A `scripts/__tests__/*.test.sh` SZERZODES-TESZTEK BEKOTESE (kartya aee395cc).
 *
 * A LELET: 14 hej-teszt allt a faban, es SEMMI nem futtatta oket. Az `npm test` = `vitest run`,
 * es a vitest alap `include`-ja se a `.sh`-t, se a `.py`-t nem illeszti; a CI ugyanezt hivja.
 * Egy teszt, amit semmi nem futtat, nem gyengebb vedelem: NULLA vedelem, kozben a fa ugy nez ki,
 * mintha lenne. (A `.py` par ugyanezt kapta a 27975b85-on, kulon futtatoval.)
 *
 * MIERT VITEST ES NEM UTEMEZETT FELADAT: igy `npm test`-tel ES a CI-ben is fut, a repon BELUL --
 * nem egy `~/.claude` alatti konfigon mulik, amit egy uj gep nem hoz magaval.
 *
 * A FELDERITES `git ls-files`-BOL MEGY, NEM NEVLISTABOL. Egy nev-kulcsos felsorolas szerkezetileg
 * vak arra, aminek MAS a neve -- ezt a lap kulon rogziti --, es egy jovobeli 15. fajl nemán
 * kimaradna belole. Igy magatol bekerul.
 *
 * A BEKOTES ELOTT MIND A 14 LEFUTOTT (szaraz futas, kartya-komment 2): 13 zold, 1 piros, es a
 * piros egy ELAVULT allitas volt, amit KULON commit javitott (3fbbe67) -- szandekosan nem ebben.
 * Egy bekotо commit, amitol piros lesz a keszlet egy nala KORABBI okbol, a bekotot terheli, es a
 * kovetkezo ember azt bisecteli.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const shellTests = execFileSync('git', ['ls-files', 'scripts/__tests__/*.test.sh'], {
  cwd: REPO,
  encoding: 'utf8',
})
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)

describe('scripts/__tests__/*.test.sh -- a hej-szerzodes tesztek TENYLEG futnak', () => {
  // ELOFELTETEL. Egy darabszam-kuszob ("> 0") ONMAGABAN gyenge: azt mondja meg, hogy a mero
  // TALALT valamit, azt nem, hogy a keresett HELYEN kereste. Merve ma este egy masik oron: egy
  // `files.length > 50` kontroll ATMEGY kikapcsolt rekurzioval is. Ezert egy KONKRET, ismert
  // fajlt is allitunk -- ha a glob vagy a cwd elromlik, ez pirosra megy, nem a 14 eset.
  it('ELOFELTETEL: a felderites talal fajlokat, es a KONKRET ismert fajlt is', () => {
    expect(shellTests.length).toBeGreaterThan(5)
    expect(shellTests).toContain('scripts/__tests__/seed-skills.test.sh')
  })

  it.each(shellTests)('%s exit 0', (rel) => {
    try {
      execFileSync('bash', [rel], { cwd: REPO, encoding: 'utf8', timeout: 90_000, stdio: 'pipe' })
    } catch (err) {
      // A KIMENET a hibauzenetbe kerul. Egy csupasz "exit 1" arra kenyszeritene a kovetkezo
      // olvasot, hogy kezzel futtassa ujra -- es a hej-tesztek sajat PASS/FAIL sorai epp
      // megmondjak, MELYIK allitas bukott.
      const e = err as { stdout?: string; stderr?: string; status?: number }
      const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
      throw new Error(`${rel} exit ${e.status ?? '?'}\n${out.split('\n').slice(-25).join('\n')}`)
    }
  })
})
