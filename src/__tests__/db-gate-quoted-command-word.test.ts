/**
 * A DB-KAPU IDEZETT PARANCSSZO- ES HELYETTESITES-RESE (kartya e81a72b7; mert 2026-10-31 a
 * 0f220f3f munka kozben, didi 50316 a helyettesitest).
 *
 *     "dropdb" x            -> ATMENT: a pozicio-osztaly kitakarja az idezett szoveget, pedig
 *                              a shellnek ez ugyanaz a szo, mint idezojel nelkul
 *     x=$(dropdb x)         -> ATMENT: a vezeto ertekadas-szabaly az egesz elso szot eldobja
 *     echo "$(dropdb x)"    -> ATMENT: dupla idezojelen belul a shell a $(...)-t lefuttatja
 *
 * A JAVITAS: (1) a szokoz NELKULI idezett szakasz egy szo, az idezojel lekerul rola; a szokozos
 * marad kitakarva (proza); (2) minden $(...) es visszapipas helyettesites torzse parancs,
 * egyszeres idezojelen kivul, a find_hits ujra olvassa, a beagyazott shell melysegeig;
 * (3) heredoc-torzsben ugy, ahogy a shell: IDEZETLEN hatarolonal a torzs kifejtodik, akarki
 * kapja; IDEZETTNEL szo szerint megy at, tehat csak akkor parancs, ha egy shell a stdin-jet
 * futtatja (az elso valtozat egy `python3 - <<'PY'` sztring es egy markdown `<<'VEGE'`
 * komment visszapipajait futtatta: 3 hamis tiltas a 306204 parancsos visszajatszasban).
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

describe('db-destructive-gate: idezett parancsszo (e81a72b7)', () => {
  it.each([
    ['dupla idezojel', '"dropdb" x'],
    ['egyszeres idezojel', "'dropdb' x"],
    ['idezett teljes ut', '"/opt/homebrew/bin/dropdb" x'],
    ['reszben idezett szo', 'd"ropdb" x'],
    ['inditoval', 'timeout 60 "dropdb" x'],
    ['tobbszavas eszkoz idezett szavakkal', "'prisma' migrate reset"],
    ['minden szava idezett', '"prisma" "migrate" "reset"'],
    ['felho-CLI idezett nevvel', '"gcloud" run services delete svc'],
    // A DB-kliens is: az SQL-osztaly a nyers szegmensben kereste, ahol `"psql` nem szohatar.
    ['idezett DB-kliens -c', '"psql" -c "DROP TABLE x"'],
    ['egyszeresen idezett DB-kliens', "'psql' -c 'DROP TABLE x'"],
    ['reszben idezett DB-kliens', 'p"sql" -c "DROP TABLE x"'],
    ['idezett utas DB-kliens', '"/opt/homebrew/bin/psql" -c "DROP TABLE x"'],
    ['idezett sqlite3', '"sqlite3" a.db "DROP TABLE x"'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['szokozos idezett proza', 'git commit -m "never run dropdb by hand"'],
    ['grep-minta szokozzel', 'grep -n "use dropdb carefully" notes.md'],
    ['tobb idezett argumentum', 'echo "a" "b c"'],
    // A lezaratlan idezojel utani resz a shellnek is idezet (szintaxis-hiba, nem fut le).
    ['lezaratlan idezojel utan', "echo 'never run dropdb by hand"],
    ['ertekadas utan artalmatlan eszkoz', 'FOO=1 prisma generate'],
    ['idezett DB-kliens artalmatlan lekerdezessel', '"psql" -c "select 1"'],
    ['SQL-szo prozaban, a kliens csak emlitve', 'git commit -m "psql: never DROP TABLE by hand"'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

describe('db-destructive-gate: a parancs-helyettesites torzse parancs (e81a72b7)', () => {
  it.each([
    ['ertekadasban $(...)', 'x=$(dropdb x)'],
    ['ertekadasban visszapipa', 'x=`dropdb x`'],
    ['ertekadas-lanc utan', 'FOO=1 x=$(dropdb x) ls'],
    ['dupla idezojelen belul $(...)', 'echo "$(dropdb x)"'],
    ['dupla idezojelen belul visszapipa', 'echo "`dropdb x`"'],
    ['commit-uzenetben futo $(...)', 'git commit -m "v $(dropdb x)"'],
    ['egymasba agyazott helyettesites', 'echo "a $(echo b $(dropdb x))"'],
    ['helyettesitesben beagyazott shell', `echo "$(bash -c 'dropdb x')"`],
    ['aposztrof dupla idezojelen belul nem nyit egyszeres idezetet', `echo "it's $(dropdb x)"`],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['egyszeres idezojelen belul: adat', "echo 'x=$(dropdb x)'"],
    ['escapelt \\$(: adat', 'echo "\\$(dropdb x)"'],
    ['aritmetika $((..))', 'echo $((1+2))'],
    // Dupla idezojelben: ott a pozicio-osztaly kitakarja, csak a $(( kizarasa dont (mutans S5).
    ['aritmetika eszkoz-nevu valtozoval', 'echo "$(( dropdb + 1 ))"'],
    ['artalmatlan helyettesites', 'x=$(git rev-parse HEAD)'],
    ['artalmatlan helyettesites dupla idezojelben', 'echo "built at $(date)"'],
    ['adat-heredoc (egy szkript megirasa)', "cat > x.sh <<'EOF'\nx=$(dropdb y)\nEOF"],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

describe('db-destructive-gate: helyettesites heredoc-torzsben (e81a72b7)', () => {
  it.each([
    ['idezetlen adat-heredoc: a shell kifejti', 'cat <<EOF\n$(dropdb x)\nEOF'],
    ['idezetlen heredocban az aposztrof sima karakter', "cat <<EOF\ndon't $(dropdb x)\nEOF"],
    ['idezetlen heredocban visszapipa', 'cat > n.md <<EOF\nnote `dropdb x`\nEOF'],
    ['idezetlen python-heredoc: a shell meg a python elott kifejti', "python3 - <<PY\nprint('$(dropdb x)')\nPY"],
    // A shell-torzsben dupla idezojelbe tett helyettesites: a pozicio-osztaly ezt kitakarja,
    // csak ez a szabaly latja (az `x=$(...)` alakot mas ut is tiltja, mutans H3 azon tulelt).
    ['idezett heredoc, amit egy shell futtat', "bash <<'EOF'\necho \"$(dropdb y)\"\nEOF"],
    ['idezett heredoc, bash -s', "bash -s <<'EOF'\necho \"$(dropdb y)\"\nEOF"],
    ['idezett heredoc, bash -s pozicios argumentummal', "bash -s x <<'EOF'\necho \"$(dropdb y)\"\nEOF"],
    ['idezett heredoc, csovon at shellbe', "cat <<'EOF' | bash\necho \"$(dropdb y)\"\nEOF"],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['idezett python-heredoc sztringje', "python3 - <<'PY'\ns = \"`dropdb x`\"\nPY"],
    ['idezett heredoc egy szkriptnek adatkent', "bash x.sh - <<'VEGE'\nnote `prisma migrate deploy` here\nVEGE"],
    ['idezett heredoc egy szkriptnek, idezett helyettesitessel', "bash x.sh - <<'VEGE'\necho \"$(dropdb y)\"\nVEGE"],
    ['visszaperjeles hatarolo (<<\\EOF) is idezett', 'cat > n.md <<\\EOF\nnote $(dropdb x)\nEOF'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

describe('db-destructive-gate: idezett DB-kliens heredockal vagy tapadt <<<-vel (e81a72b7, didi 50542 F-B1)', () => {
  it.each([
    ['dupla idezojeles kliens, idezett heredoc', `"psql" <<'EOF'\nDROP TABLE x;\nEOF`],
    ['egyszeres idezojeles kliens, idezetlen heredoc', "'psql' <<EOF\nDROP TABLE x;\nEOF"],
    ['idezett kliens, tapadt <<<', '"psql"<<<"DROP TABLE x"'],
    ['idezett utas kliens, heredoc', `"/opt/homebrew/bin/psql" <<'EOF'\nDROP TABLE x;\nEOF`],
    ['idezett @-os utas kliens, tapadt <<<', '"/opt/homebrew/opt/postgresql@16/bin/psql"<<<"DROP TABLE x"'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['idezett kliens artalmatlan heredockal', `"psql" <<'EOF'\nselect 1;\nEOF`],
    ['idezett szo, tapadt atiranyitas', 'echo "x">f'],
    ['adat-heredoc SQL-szoveggel', `cat <<'EOF'\nDROP TABLE x;\nEOF`],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

describe('db-destructive-gate: tapadt kimeneti atiranyitas, ures es reszleges idezojel (e81a72b7, didi 50590)', () => {
  it.each([
    // B5: a _QUOTED_WORD_EDGE `>`-je nelkul ez atment.
    ['idezett kliens, tapadt >', '"psql">/tmp/o -c "DROP TABLE x"'],
    ['egyszeresen idezett kliens, tapadt >', "'psql'>/dev/null -c 'DROP TABLE x'"],
    // F-B3: a shellnek mind psql.
    ['ures idezojel elol', '""psql -c "DROP TABLE x"'],
    ['ures idezojel hatul', 'psql"" -c "DROP TABLE x"'],
    ['ures idezojel kozepen', 'p""sql -c "DROP TABLE x"'],
    ['reszben idezett kliens heredockal', `p"sql" <<'EOF'\nDROP TABLE x;\nEOF`],
    // B1a-c: a heredoc-nyito idezojele a (-ben es $(-ben (ott a parancs-pozicios szoveg nem illeszt).
    ['idezett kliens heredockal alhejban', `("psql" <<'EOF'\nDROP TABLE x;\nEOF\n)`],
    ['idezett kliens heredockal $(-ben', `x=$("psql" <<'EOF'\nDROP TABLE x;\nEOF\n)`],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['tapadt >, artalmatlan lekerdezes', '"psql">/tmp/o -c "select 1"'],
    ['ures argumentum', 'echo "" x'],
    ['ures commit-uzenet', 'git commit -m "" --allow-empty'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})
