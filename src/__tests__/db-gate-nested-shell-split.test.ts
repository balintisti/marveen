/**
 * A DB-KAPU POZICIO-OSZTALYAI SZANDEKOSAN IDEZOJEL-VAKON SZELETELNEK (kartya ffa3b565).
 *
 * A LELET (dexter, 2026-09-06): a `_SEG` az idezojelen BELULI `&&`/`;`-nel is vag, igy egy
 * idezett argumentum darabja parancs-poziciora esik, es hamis DENY lesz belole
 * (`git commit -m "... && prisma migrate reset ..."`). A kezenfekvo javitas az, hogy a TOOL,
 * CLOUD es GIT osztaly is a `_split_outside_quotes`-t kapja, ahogy az SQL osztaly.
 *
 * EZ A FAJL AZERT VAN, HOGY AZ A JAVITAS NE MENJEN BE CSENDBEN. Mérve a futo kapun
 * (friday, 2026-10-17): az idezojel-tudatos szeleteles a hamis DENY-t PASS-ra valtja, de
 * UGYANIGY PASS-ra valtja a `bash -c "...; prisma migrate reset"` es a `sh -c '... && ...'`
 * alakot is -- vagyis egy VALODI destruktiv parancsot enged at, mert a beagyazott shell
 * egesze egy idezett sztring, es a blankolas kiuriti. A hamis DENY hangos, visszafordithato,
 * es van kijarata (`MARVEEN_DB_GATE=allow`); a hamis atengedes visszafordithatatlan. Ezert a
 * vak szeleteles marad, es az ara a hamis DENY, amit az utolso teszt rogzit.
 *
 * Aki megis idezojel-tudatosra valt, annak a beagyazott shell (`bash|sh|zsh -c`, `eval`)
 * sztringjet KULON kell vizsgalnia; amig ez nincs meg, a lenti ket DENY-teszt bukik.
 * A fajl semmit nem hajt vegre: a kapu dontesi fuggvenyenek ad szoveget.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

/** A kapu DONTESI fuggvenye egy parancs-SZOVEGRE. Nem hajt vegre semmit. */
function blocks(command: string): boolean {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps(bool(g.find_hits(json.loads(sys.stdin.read())))))
`
  const out = execFileSync('python3', ['-I', '-B', '-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

describe('db-destructive-gate: beagyazott shell a vak szeleteles miatt is BLOKKOLVA (ffa3b565)', () => {
  it('bash -c "...; prisma migrate reset" BLOKKOLVA', () => {
    expect(blocks('bash -c "echo hi; prisma migrate reset --force"')).toBe(true)
  })

  it("sh -c '... && prisma migrate reset' BLOKKOLVA", () => {
    expect(blocks("sh -c 'cd /x && prisma migrate reset'")).toBe(true)
  })

  it('KONTROLL: a csupasz destruktiv parancs BLOKKOLVA', () => {
    expect(blocks('prisma migrate reset --force')).toBe(true)
  })

  it('KONTROLL: artalmatlan lanc ATMEGY', () => {
    expect(blocks('echo hello && ls')).toBe(false)
  })

  it('AZ AR, rogzitve: idezett commit-uzenet && utan TOOL-szavakkal hamis DENY', () => {
    expect(blocks('git commit -m "docs: run tests && prisma migrate reset is forbidden"')).toBe(true)
  })
})
