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

// didi 50405, J1: a DB-kliens neve csak puszta szokent volt kliens; a flotta
// `/opt/homebrew/bin/psql -h localhost`-ot hiv, es az a SQL-osztalyon atment.
describe('db-destructive-gate: teljes uttal hivott DB-kliens (0f220f3f, J1)', () => {
  it.each([
    ['abszolut ut -c', '/opt/homebrew/bin/psql -h localhost -c "DROP TABLE x"'],
    ['abszolut ut <<<', '/opt/homebrew/bin/psql <<<"DROP TABLE x"'],
    ['abszolut ut, tapado <<<', '/opt/homebrew/bin/psql<<<"DROP TABLE x"'],
    ['relativ ./ ut', './bin/psql -c "DROP TABLE x"'],
    ['valtozo konyvtar', '$PG/psql -c "DROP TABLE x"'],
    ['~/ ut, sqlite3', '~/pg/bin/sqlite3 a.db "DROP TABLE x"'],
    ['kornyezeti valtozo utan', 'PGPASSWORD="a b" /opt/homebrew/bin/psql -c "DROP TABLE x"'],
    ['indito utan', 'timeout 60 /opt/homebrew/bin/psql -c "DROP TABLE x"'],
    ['helyettesitesben', 'x=$(/opt/homebrew/bin/psql -c "DROP TABLE x")'],
    ['&& utan', 'cd /tmp && /opt/homebrew/bin/psql -c "DROP TABLE x"'],
    ['alhejban', '(/opt/homebrew/bin/psql -c "DROP TABLE x")'],
    ['kapcsos blokkban', '{ /opt/homebrew/bin/psql -c "DROP TABLE x"; }'],
    ['backtickben a szegmens elejen', '`/opt/homebrew/bin/psql -c "DROP TABLE x"`'],
    // A csupasz nev ezekben mar tiltva volt: az utas alak ugyanott kliens.
    ['$( a szegmens kozepen', 'echo $(/opt/homebrew/bin/psql -c "DROP TABLE x")'],
    ['$( idezojelben', 'echo "$(/opt/homebrew/bin/psql -c "DROP TABLE x")"'],
    ['$( utan kornyezeti valtozo', 'echo $(PGPASSWORD=a /opt/homebrew/bin/psql -c "DROP TABLE x")'],
    ['folyamat-helyettesites <(', 'diff <(/opt/homebrew/bin/psql -c "DROP TABLE x") f'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  // Az utas alak CSAK parancs-pozicioban kliens: a Delta-CRM-ben van `prisma` konyvtar,
  // es a flotta-visszajatszas egyetlen hamis tiltasa egy ilyen utvonal-argumentum volt.
  it.each([
    ['artalmatlan lekerdezes teljes uttal', '/opt/homebrew/bin/psql -h localhost -c "select 1"'],
    ['egy psql.md dokumentum', 'cat /usr/bin/psql.md'],
    ['egy psqlx nevu fajl', 'ls /opt/homebrew/bin/psqlx'],
    ['prisma konyvtar argumentumkent (a visszajatszas esete)', 'git grep -n -E "data-color|<mark" "${R}" -- backend/api/src backend/api/prisma'],
    ['SQL-szo keresese a prisma konyvtarban', 'grep -rn "DROP TABLE" backend/api/prisma'],
    ['prisma konyvtar argumentum $( belul', 'x=$(grep -rln "DROP TABLE" backend/api/prisma)'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

// didi 50405, J2: a `2>&1` `&`-je elvalasztonak szamitott, igy a kliens/shell es a
// parancsa ket szegmensbe esett; a parancs vegi `2>&1` mindig tiltva volt.
describe('db-destructive-gate: az atiranyitas & jele nem elvalaszto (0f220f3f, J2)', () => {
  it.each([
    ['psql 2>&1 -c', 'psql 2>&1 -c "DROP TABLE x"'],
    ['psql 1>&2 -c', 'psql 1>&2 -c "DROP TABLE x"'],
    ['psql <&0 -c', 'psql <&0 -c "DROP TABLE x"'],
    ['psql &>/dev/null -c', 'psql &>/dev/null -c "DROP TABLE x"'],
    ['bash 2>&1 -c', 'bash 2>&1 -c "dropdb x"'],
    ['bash 2>&1 <<<', 'bash 2>&1 <<<"dropdb x"'],
    ['bash &>/dev/null -c', 'bash &>/dev/null -c "dropdb x"'],
    ['bash &> /dev/null -c (kulon szo)', 'bash &> /dev/null -c "dropdb x"'],
    ['bash 2>&1 -c ... | tail', 'bash 2>&1 -c "dropdb x" | tail -3'],
    ['git 2>&1 push --force', 'git 2>&1 push --force origin main'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['hatterbe kuldes, utana mas parancs', 'sleep 1 & echo done'],
    ['hatterbe kuldott kiiras, utana artalmatlan psql', 'echo "DROP TABLE x" & /opt/homebrew/bin/psql -c "select 1"'],
    ['szkript 2>&1-gyel', 'bash scripts/x.sh 2>&1'],
    ['build kimenet csovezetekben', 'make 2>&1 | tail -3'],
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

  it.each([
    ['--rcfile ERTEK a -c elott', 'bash --rcfile /tmp/r -c "dropdb x"'],
    ['--init-file ERTEK a -c elott', 'bash --init-file /tmp/r -c "dropdb x"'],
  ])('a bash erteket varo hosszu opcioja nem a szkript (didi 50316, F2): %s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })
})

// didi 50344, G2: ugyanaz a gyoker, mint F1, de a shell vagy interpreter nevehez TAPADO
// atiranyitassal; a szokozos alak eddig is tiltott volt.
describe('db-destructive-gate: atiranyitashoz tapado shell- es interpreter-nev (0f220f3f, G2)', () => {
  it.each([
    ['bash<<<"..."', 'bash<<<"dropdb x"'],
    ['bash</dev/null -c', 'bash</dev/null -c "dropdb x"'],
    ["python3<<<'...'", `python3<<<'import os; os.system("dropdb x")'`],
    ["python3<<'PY' heredoc", `python3<<'PY'\nimport os; os.system("dropdb x")\nPY`],
    ["python3<<'PY' nem tokenizalhato nyitosorral", `python3<<'PY' # don't\nimport os; os.system("dropdb x")\nPY`],
    ["bash<<'EOF' heredoc", "bash<<'EOF'\ndropdb x\nEOF"],
    ['teljes uttal: /bin/bash <<EOF', "/bin/bash <<'EOF'\ndropdb x\nEOF"],
    ['zarojelben: (bash <<EOF)', "(bash <<'EOF'\ndropdb x\nEOF\n)"],
    // didi H1: a DB-kliens neve is tapadhat, es egy atiranyitas a masikhoz is.
    ['psql<<<"..."', 'psql<<<"DROP TABLE x"'],
    ['bash 2>/dev/null<<<"..."', 'bash 2>/dev/null<<<"dropdb x"'],
    ["python3 2>/dev/null<<<'...'", `python3 2>/dev/null<<<'import os; os.system("dropdb x")'`],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['artalmatlan bash<<<', 'bash<<<"git status"'],
    ['szamozott atiranyitas egy szkript utan', 'bash scripts/x.sh 2>/dev/null'],
    ["adat-heredoc tapadva: cat<<'EOF'", "cat<<'EOF'\ndropdb x\nEOF"],
    // Az eval NEM olvassa a stdint: `eval<<<".."` semmit nem futtat (merve: bash 5, a kiirt
    // jel nem jelent meg). A szokozos alak tiltasa regi tulvedes, nem ennek a szabalynak a merteke.
    ['eval<<<"..." (az eval nem olvas stdint)', 'eval<<<"dropdb x"'],
    ['szkript bemenet-atiranyitassal', 'bash x.sh<in.txt'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

// didi 50316, F1: a shell-szo csak kulon szokent volt felismerve; a zarojelhez, `$(`-hez
// vagy visszapipahoz TAPADO alak atment, a szokozos `( bash -c` nem.
describe('db-destructive-gate: subshellhez es helyettesiteshez tapado shell-szo (0f220f3f, F1)', () => {
  it.each([
    ['(bash -c ...)', '(bash -c "dropdb x")'],
    ['x=$(bash -c ...)', 'x=$(bash -c "dropdb x")'],
    ['visszapipas bash -c', 'x=`bash -c "dropdb x"`'],
    ['(eval ...)', '(eval "dropdb x")'],
    ['cd utan (sh -c ...)', 'cd /tmp && (sh -c "dropdb x")'],
    ['<(bash -c ...) folyamat-helyettesites', 'cat <(bash -c "dropdb x")'],
    ['(echo ... | bash)', '(echo "dropdb x" | bash)'],
    ['$(echo ... | bash): a magaban maradt $ nem az echo helye', '$(echo "dropdb x" | bash)'],
    ['(python3 -c ...) interpreter', `(python3 -c 'import os; os.system("dropdb x")')`],
    ['$(python3 -c ...) interpreter', `y=$(python3 -c 'import os; os.system("dropdb x")')`],
    ['(echo ... | python3)', `(echo 'import os; os.system("dropdb x")' | python3)`],
    ['(python3 - <<PY) heredoc', `(python3 - <<'PY'\nimport os; os.system("dropdb x")\nPY\n)`],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['artalmatlan (bash -c ...)', '(bash -c "git status")'],
    ['artalmatlan x=$(bash -c ...)', 'x=$(bash -c "ls -1 | wc -l")'],
    ['zarojeles szkript-hivas, a -c a szkripte', '(bash scripts/x.sh -c "dropdb x")'],
    ['idezett szovegben a (bash -c ...) csak szoveg', 'git commit -m "never (bash -c dropdb x)"'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })

  // didi 50344, G1: a nem tokenizalhato szegmens (itt a `don't` paratlan aposztrofja) tartalek-
  // mintaja is ismerje a zarojelhez tapado interpretert (mutans B6 tulelt), es az atiranyitashoz
  // tapadot is (G2 ugyanott; mutans G1b tulelt).
  it.each([
    ['(python3 -c ...)', `(python3 -c "import os; os.system('dropdb x')" # don't)`],
    ["python3<<<'...'", `python3<<<'import os; os.system("dropdb x")' # don't`],
  ])('nem tokenizalhato szegmensben: %s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  // Idezojelen BELUL nem szabad szetszedni: az ottani szoveg kod, amit a kapu ujra olvas, es a
  // `require ( "pg" )` mar nem a driver importja (mutans F1i: mindharom atment).
  it.each([
    ['node -e driver-importtal', `node -e 'const { Client } = require("pg"); new Client().query("DROP TABLE x")'`],
    ['ugyanez bash -c-ben', `bash -c "node -e 'const { Client } = require(\\"pg\\"); new Client().query(\\"DROP TABLE x\\")'"`],
    ['ugyanez $(...)-ben', `x=$(node -e 'const { Client } = require("pg"); new Client().query("DROP TABLE x")')`],
  ])('az idezett kod valtozatlan marad: %s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })
})
