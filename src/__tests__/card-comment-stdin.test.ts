/**
 * A DOKUMENTALT `-` (STDIN) MOD SZERKEZETILEG LEHETETLEN VOLT, ES A VISSZAOLVASAS VAK VOLT RA
 * (kartya `4dffbb2d`).
 *
 * A `card-comment.sh` a python programot MAGAT a stdin-en adta at (`python3 - ... <<'PY'`), tehat
 * mire a `sys.stdin.read()` sorra kerult, a stdin-t mar a heredoc foglalta. A `-` mod torzse
 * URES lett. Merve 2026-09-04, izolalt reprodukcioval, KONTROLLAL:
 *
 *     fajl modban ............................... 22 bajt
 *     `-` modban ................................  0 bajt
 *     ugyanaz a python, heredoc NELKUL, stdin-rol  22 bajt   <- A KONTROLL
 *
 * A harmadik sor az, ami eldonti, hogy nem az olvaso a rossz: a heredoc az ok.
 *
 * AZ ELSO JELLEMZESEM TOBBET ALLITOTT A MERTNEL, ES EZ A JAVITOTT ALAK. Azt irtam, hogy a hiba
 * NEMA: hogy a visszaolvasas vak ra (`_canon('') == _canon('')` -> `OK`), es a kartyan ott marad
 * egy torolhetetlen ures komment. HAMIS. friday elesben merte (HTTP 400 `Szerzo es tartalom
 * kotelezo`), es a szerver forrasa megerositi: `kanban.ts:668` `if (!author || !content) -> 400`.
 * A script a HTTPError agon lep ki, a visszaolvasasig el sem jut, es ures komment NEM keletkezik.
 *
 * A VALODI KAR TEHAT NEM ADATVESZTES, HANEM ROSSZ IRANYBA MUTATO HIBAUZENET: a hivo azt olvassa,
 * hogy rossz szerzot vagy tartalmat adott at, mikozben a helyes hasznalatot koveti es a
 * dokumentalt parancsot gepeli. Egy hiba, ami HANGOS es MASRA mutat, dragabb lehet egy nemanal:
 * a nemat legalabb nem magyarazza meg senki rosszul.
 *
 * EZERT A KAPU ERTEKE NEM AZ, HOGY MEGALLIT -- a szerver ugyis megallitana --, hanem hogy a HTTP
 * hivas ELOTT all es MEGNEVEZI AZ OKOT. A 2. eset ezt a sorrendet rogziti, nem a megtagadast.
 *
 * A MUTACIO, AMI EZT A FAJLT ERTELMESSE TESZI, ES A HATARA KIMONDVA: az 1. eset PONTOSAN akkor
 * megy pirosra, ha a hej-oldali stdin-beolvasast kiveszed ES a kaput bent hagyod -- mert akkor a
 * torzs ures lesz, es a kapu tuzel. Ha MINDKETTOT kiveszed, az 1. eset ZOLD marad egy torott
 * scripten: a regi viselkedes nem refuzallt, csak uresen postazott. Vagyis ez a fajl a KAPUT
 * rogziti, es a beolvasast csak a kapun KERESZTUL -- a 2. eset nelkul semmit nem allitana.
 *
 * MIERT NEM LETEZO KARTYA-ID: a script valodi HTTP POST-ot kuld, es egy LETEZO kartyara ez a
 * teszt kommentet hagyna maga utan, amit nem lehet torolni. Egy nem letezo id-re a vegpont
 * 404-et ad, tehat semmi nem keletkezik -- es a torzs ATMENT a kapun, mielott a HTTP hivas
 * egyaltalan elindult. A megkulonbozteto ezert a HIANYZO „URES" szo, nem a kilepesi kod.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'card-comment.sh')
const NEM_LETEZO_KARTYA = '00000000-teszt-nem-letezo-kartya'

function run(src: string, stdin: string) {
  return spawnSync('bash', [SCRIPT, 'marveen', NEM_LETEZO_KARTYA, src], {
    input: stdin,
    encoding: 'utf-8',
    timeout: 30_000,
  })
}

describe('card-comment.sh -- a `-` (stdin) mod', () => {
  it('1. NEM URES torzset olvas be stdin-rol: a kapu NEM tuzel', () => {
    const r = run('-', 'valodi komment-szoveg a stdin-rol\n')
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    // A megkulonbozteto: a torzs ATJUTOTT a kapun. A HTTP oldal 404-el (nem letezo kartya),
    // vagy kapcsolat-hiba, ha a dashboard eppen nem fut -- egyik sem „URES".
    expect(out).not.toMatch(/URES/)
  })

  it('2. URES stdin eseten FAIL-CLOSED: megtagadja, es el sem indul a HTTP hivas', () => {
    const r = run('-', '')
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    expect(out).toMatch(/NEM KULDTEM.*URES/)
    expect(r.status).toBe(1)
    // KONTROLL: nem a HTTP oldalon bukott el -- a kapu ELOBB all
    expect(out).not.toMatch(/HTTP/)
  })

  it('3. csak szokozbol allo stdin is megtagadva (a hej `-s`-e erre igazat adna)', () => {
    const r = run('-', '   \n\n  \t\n')
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    expect(out).toMatch(/NEM KULDTEM.*URES|NEM KULDTEM.*szokoz/)
    expect(r.status).toBe(1)
  })

  it('4. KONTROLL: a FAJL mod valtozatlanul mukodik -- a javitas nem torte el a mukodo utat', () => {
    const dir = mkdtempSync(join(tmpdir(), 'card-comment-'))
    const f = join(dir, 'body.txt')
    writeFileSync(f, 'valodi komment-szoveg fajlbol\n')
    const r = run(f, '')
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    expect(out).not.toMatch(/URES/)
  })
})
