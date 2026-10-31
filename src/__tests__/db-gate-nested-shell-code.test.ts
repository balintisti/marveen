/**
 * A DB-KAPU KET REGI RESE (kartya 0f220f3f, didi merese 2026-10-31, a8cac9e26 es 608dd71d4).
 *
 *     dropdb x                    -> TILTVA (kontroll)
 *     /opt/homebrew/bin/dropdb x  -> ATMENT: a minta lookbehind-ja kizarja a `/`-t
 *     bash -c "dropdb x"          -> ATMENT: a beagyazott parancs EGY idezett sztring, a
 *                                    pozicio-osztalyok kitakarjak
 *
 * A JAVITAS: (1) minden szo, aminek az UTOLSO ut-resze pontosan `dropdb` (a puszta nev
 * mar eddig is barmely szokent tiltott); (2) a sztring, amit egy shell futtatni kap (`-c`,
 * `-lc`, `eval`, here-string, `echo ... | bash`), ujra a find_hits-en megy at, szovegkent,
 * 3 szintig; a shell elso operandusa (a szkript) utan jovo szavak a szkript adatai.
 * Ez a fajl SZOVEGET ad a dontesi fuggvenynek, es semmit nem hajt vegre.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

/** A kapu verdict()-je egy parancs-SZOVEGRE ("none" | "e2e" | "override" | "deny"). */
function verdict(command: string): string {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps(g.verdict(json.loads(sys.stdin.read()), env={})[0]))
`
  const out = execFileSync('python3', ['-I', '-B', '-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

describe('db-destructive-gate: teljes uttal hivott torlo eszkoz (0f220f3f)', () => {
  it.each([
    ['abszolut ut', '/opt/homebrew/bin/dropdb x'],
    ['relativ ./ ut', './bin/dropdb x'],
    ['~/ ut', '~/pg/bin/dropdb x'],
    ['inditoval', 'timeout 60 /usr/local/bin/dropdb x'],
    ['relativ ut ./ nelkul (a shell ezt is utkent futtatja)', 'bin/dropdb x'],
    ['valtozo konyvtar (a visszajatszas valodi alakja: $P/dropdb)', '$PG/dropdb x'],
    ['utvonal-argumentum, mint a puszta nev argumentumkent (cat dropdb is TILTVA)', 'cat docs/dropdb'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['egy dropdb.md dokumentum', 'cat docs/dropdb.md'],
    ['egy dropdb-x nevu fajl', 'ls notes/dropdb-x'],
    ['egy /tmp/dropdb.log', 'tail /tmp/dropdb.log'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

describe('db-destructive-gate: a beagyazott shell sztringje parancs (0f220f3f)', () => {
  it.each([
    ['bash -c', 'bash -c "dropdb x"'],
    ["sh -c '...'", "sh -c 'dropdb x'"],
    ['bash -lc (osszevont kapcsolo)', 'bash -lc "dropdb x"'],
    ['/bin/zsh -ec', "/bin/zsh -ec 'dropdb x'"],
    ['timeout 60 bash -c', 'timeout 60 bash -c "dropdb x"'],
    ['eval', 'eval "dropdb x"'],
    ['here-string', 'bash <<< "dropdb x"'],
    ['echo | bash', 'echo "dropdb x" | bash'],
    ['ket szint melyen', `bash -c "sh -c 'dropdb x'"`],
    ['SQL a beagyazott psql -c-ben', `bash -c "psql -d y -c 'DROP DATABASE x'"`],
    ['interpreter-kod a beagyazott shellben', `bash -c "python3 -c 'import os; os.system(\\"dropdb x\\")'"`],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it('egy e2e-nevu torles bash -c-ben NEM az e2e kiveteli alak: TILTVA', () => {
    expect(verdict('bash -c "dropdb -h localhost --if-exists crm_e2e_didi_x1"')).toBe('deny')
  })

  it('KONTROLL: a sima e2e kiveteli alak valtozatlanul e2e', () => {
    expect(verdict('dropdb -h localhost --if-exists crm_e2e_didi_x1')).toBe('e2e')
  })

  it('KONTROLL: artalmatlan bash -c ATMEGY', () => {
    expect(verdict('bash -c "git status && ls"')).toBe('none')
  })

  it('KONTROLL: commit-uzenet, ami bash -c-t emlit, ATMEGY (az uzenet egy argumentum, nem shell)', () => {
    expect(verdict('git commit -m "wrap it in bash -c, never dropdb"')).toBe('none')
  })

  it('KONTROLL: bash egy szkripttel, a -c a SZKRIPT argumentuma (adat), ATMEGY', () => {
    expect(verdict('bash scripts/x.sh -c "dropdb x"')).toBe('none')
    expect(verdict('bash scripts/x.sh <<< "dropdb x"')).toBe('none')
  })

  it.each([
    ['-o pipefail a -c elott', 'bash -o pipefail -c "dropdb x"'],
    ['+O opcio a -c elott', 'bash +O extglob -c "dropdb x"'],
    ['atiranyitas a -c elott', 'bash 2>/dev/null -c "dropdb x"'],
    ['kulon szavas atiranyitas a -c elott', 'bash > log -c "dropdb x"'],
  ])('a shell sajat opcioja utan a -c meg a shelle: %s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })
})
