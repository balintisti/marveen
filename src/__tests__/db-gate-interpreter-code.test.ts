/**
 * A DB-KAPU A VEGREHAJTOTT INTERPRETER-KODBAN (kartya 94d86b92).
 *
 * A LELET, marveen merese 2026-10-31-en a futo fan (a8cac9e26, store/gate-probes/):
 *
 *     python3 - <<'PY' ... subprocess.run(['dropdb', '--if-exists', n]) ... PY  -> ATMENT
 *     ugyanaz a parancs sima Bash-sorkent                                      -> TILTVA
 *
 * A MECHANIZMUS: a strip_heredoc_bodies a python-body-t MEGTARTJA, de SHELLKENT ellenorzi,
 * a shell-szabalyok pedig kitakarjak az idezett szoveget. Kodban a parancsnev EPPEN egy
 * idezett sztring, es a `['psql', ...]` listaban idezojel all a kliens elott, nem szokoz.
 * A masodik alak (a kartya kommentje): a nevet ket darabbol fuztek ossze.
 *
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
  const out = execFileSync('python3', ['-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

const py = (body: string) => `cd /Users/isti/marveen; python3 - <<'PY'\nimport subprocess\n${body}\nPY`

describe('db-destructive-gate: a vegrehajtott interpreter-kodban az idezett nev is szamit', () => {
  it('marveen probaja: dropdb listaelemkent egy python-heredocban TILTVA (ez volt a lelet)', () => {
    expect(verdict(py("for n in ['crm_e2e_x_probe']:\n    subprocess.run(['dropdb','--if-exists',n],capture_output=True,text=True)"))).toBe('deny')
  })

  it('a kontroll, sima Bash-sorkent, tovabbra is TILTVA', () => {
    expect(verdict('dropdb --if-exists crm_e2e_x_probe')).toBe('deny')
  })

  it('ket darabbol osszefuzott nev (+) TILTVA -- a kartya masodik alakja', () => {
    expect(verdict(py("subprocess.run(['drop' + 'db', 'crm_e2e_didi_rrbac'])"))).toBe('deny')
  })

  it('egymas melle irt literalok (implicit osszefuzes) TILTVA', () => {
    expect(verdict(py("subprocess.run(['drop' 'db', 'x'])"))).toBe('deny')
  })

  it('python3 -c argumentumaban is TILTVA', () => {
    expect(verdict(`python3 -c "import subprocess; subprocess.run(['dropdb', 'x'])"`)).toBe('deny')
  })

  it('node -e argumentumaban is TILTVA', () => {
    expect(verdict(`node -e "require('child_process').execSync('dropdb x')"`)).toBe('deny')
  })

  it('psql listaelemkent, az utasitas egy valtozoban sorokkal feljebb: TILTVA (a body egeszen latszik)', () => {
    expect(verdict(py("sql = 'DROP DATABASE x'\nsubprocess.run(['psql', '-h', 'localhost', '-c', sql])"))).toBe('deny')
  })

  it('driver (psycopg2) WHERE nelkuli DELETE-je egy execute("...")-ben TILTVA', () => {
    expect(verdict(py("import psycopg2\ncur = psycopg2.connect('').cursor()\ncur.execute(\"DELETE FROM users\")"))).toBe('deny')
  })

  it('a felho-osztaly is: gcloud ... delete listaelemekkel TILTVA', () => {
    expect(verdict(py("subprocess.run(['gcloud', 'run', 'services', 'delete', 'svc'])"))).toBe('deny')
  })

  it('a felulbiralas tovabbra is kijarat, es naplozott: MARVEEN_DB_GATE=allow -> override', () => {
    expect(verdict(`MARVEEN_DB_GATE=allow python3 - <<'PY'\nimport subprocess\nsubprocess.run(['dropdb', 'x'])\nPY`)).toBe('override')
  })

  it('KONTROLL: ugyanez a szoveg egy markdown-heredocban ATMEGY (cat nem hajt vegre)', () => {
    expect(verdict("cat > notes.md <<'EOF'\nsubprocess.run(['dropdb', '--if-exists', n])\nEOF")).toBe('none')
  })

  it('KONTROLL: artalmatlan psql-hivas egy python-heredocban ATMEGY', () => {
    expect(verdict(py("subprocess.run(['psql', '-d', 'x', '-c', 'SELECT count(*) FROM \"Task\"'])"))).toBe('none')
  })

  it('KONTROLL: driver DELETE WHERE-rel ATMEGY', () => {
    expect(verdict(py("import psycopg2\ncur = psycopg2.connect('').cursor()\ncur.execute(\"DELETE FROM users WHERE id = %s\", (1,))"))).toBe('none')
  })

  it('KONTROLL: idezett tablanevu DELETE WHERE-rel psql-listaelemben ATMEGY (a visszajatszas mandark-alakja)', () => {
    expect(verdict(py(`q=subprocess.run(['psql','-h','localhost','-d','crm_e2e_test','-Atc','delete from "DuplicatePair" where id=%d'%5],capture_output=True)`))).toBe('none')
  })

  it('KONTROLL: egy fajlt SZERKESZTO python-heredoc, vegrehajto nelkul, ATMEGY (a visszajatszas 24 hamis tiltasanak alakja)', () => {
    expect(verdict("python3 - <<'PY'\np='t.test.ts'; s=open(p).read()\ns=s.replace('a', \"[`dropdb -h localhost crm_e2e_ford_x`],\")\nopen(p,'w').write(s)\nPY")).toBe('none')
  })

  it('KONTROLL: egy TS-tesztet IRO python-heredoc @prisma/client importtal es DELETE-tel ATMEGY (a driver a python sajat importja kell legyen)', () => {
    expect(verdict("python3 - <<'PY'\nbody = '''\nimport { PrismaClient } from '@prisma/client'\nawait prisma.$executeRawUnsafe('DELETE FROM \"Project\"')\n'''\nopen('x.ts','w').write(body)\nPY")).toBe('none')
  })

  it('KONTROLL: a kliens nelkuli python-kod, ami csak SZOVEGKENT emliti az utasitast, ATMEGY', () => {
    expect(verdict(py("print('a kapu a DROP TABLE-t fogja')"))).toBe('none')
  })

  it('KONTROLL: az e2e kiveteli alak (sima dropdb egy e2e-adatbazisra) valtozatlanul e2e', () => {
    expect(verdict('dropdb -h localhost --if-exists crm_e2e_didi_x1')).toBe('e2e')
  })
})

/**
 * didi 50294 (r2): ugyanaz a vegrehajtott kod, MAS alakban erkezve. K1: indito az
 * interpreter elott (timeout, nice, env, sudo, uv run, npx tsx); K2: a kod stdin-en jon
 * heredoc nelkul (here-string, echo | python3) vagy backslash-idezett heredocban;
 * K3: asyncio.create_subprocess_exec; K4: a driver egy `import a, b` lista masodik eleme.
 * N7: egy SZKRIPTNEK adott heredoc ADAT, nem kod.
 */
describe('db-destructive-gate: a vegrehajtott kod minden indito- es stdin-alakban (didi 50294)', () => {
  const run = "import subprocess; subprocess.run(['dropdb','x'])"

  it.each([
    ['timeout 60', `timeout 60 python3 -c "${run}"`],
    ['nice', `nice python3 -c "${run}"`],
    ['env', `env FOO=1 python3 -c "${run}"`],
    ['sudo -u', `sudo -u postgres python3 -c "${run}"`],
    ['uv run', `uv run python -c "${run}"`],
    ['npx tsx', `npx tsx -e "require('child_process').execSync('dropdb x')"`],
  ])('K1: %s elotaggal a -c/-e kod TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it('K2: here-string (<<<) TILTVA', () => {
    expect(verdict(`python3 <<< "${run}"`)).toBe('deny')
  })

  it('K2: echo | python3 TILTVA', () => {
    expect(verdict(`echo "${run}" | python3`)).toBe('deny')
  })

  it('K2: backslash-idezett heredoc (<<\\PY) TILTVA', () => {
    expect(verdict("python3 - <<\\PY\nimport subprocess\nsubprocess.run(['dropdb','x'])\nPY")).toBe('deny')
  })

  it('K3: asyncio.create_subprocess_exec folyamat-indito, TILTVA', () => {
    expect(verdict("python3 - <<'PY'\nimport asyncio\nasyncio.run(asyncio.create_subprocess_exec('dropdb','x'))\nPY")).toBe('deny')
  })

  it('K4: a driver az import-lista masodik eleme, a WHERE nelkuli DELETE TILTVA', () => {
    expect(verdict("python3 - <<'PY'\nimport os, sqlite3\nsqlite3.connect('/tmp/a.db').execute('DELETE FROM t')\nPY")).toBe('deny')
  })

  it('N7: egy szkriptnek adott heredoc ADAT, a kod-osztaly nem olvassa (ATMEGY)', () => {
    expect(verdict("python3 /tmp/x.py <<'EOF'\nimport subprocess\nsubprocess.run(['dropdb','x'])\nEOF")).toBe('none')
  })

  it('N7 kontroll: ugyanaz a heredoc a `-` stdin-programkent TILTVA', () => {
    expect(verdict("python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['dropdb','x'])\nEOF")).toBe('deny')
  })

  it('KONTROLL: echo | python3 egy szkripttel: az echo ADAT, ATMEGY', () => {
    expect(verdict(`echo "${run}" | python3 /tmp/x.py`)).toBe('none')
  })

  // K5 (didi, r2): egy opcio ERTEKE nem a szkript. r2-ben `-W ignore` `ignore`-ja szkriptnek
  // latszott, es a heredoc-kod atment (r1 meg tiltotta).
  const pyBody = "\nimport subprocess\nsubprocess.run(['dropdb','x'])\nPY"
  it.each([
    ['python3 -W ignore -', `python3 -W ignore - <<'PY'${pyBody}`],
    ['python3 -W ignore (- nelkul)', `python3 -W ignore <<'PY'${pyBody}`],
    ['python3 -X utf8', `python3 -X utf8 <<'PY'${pyBody}`],
    ['python3 -uW ignore (osszevont)', `python3 -uW ignore <<'PY'${pyBody}`],
    ['node -r x', "node -r ./x.js <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
    ['node --require x', "node --require ./x.js <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
    ['ismeretlen hosszu opcio + szo: eldonthetetlen, kod', "node --frobnicate x.js <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
    ['ruby -r json', "ruby -r json <<'RB'\nsystem('dropdb', 'x')\nRB"],
    ['perl -I lib', "perl -I lib <<'PL'\nsystem('dropdb', 'x');\nPL"],
    ['- a szkript utan is', `python3 x.py - <<'PY'${pyBody}`],
  ])('K5: %s heredoc-kodja TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  it.each([
    ['python3 -m modul (a modul olvassa a stdint)', `python3 -m json.tool <<'PY'${pyBody}`],
    ['python3 -W ignore x.py (az ertek utan a szkript)', `python3 -W ignore x.py <<'PY'${pyBody}`],
    ['node --require=x x.js (osszetapasztott ertek)', "node --require=./x.js x.js <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
    ['python3 -- x.py', `python3 -- x.py <<'PY'${pyBody}`],
    ['node --require x x.js (az ertekes hosszu opcio utan a szkript)', "node --require ./x.js x.js <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
    ['python3 -Wignore x.py (osszetapasztott ertek)', `python3 -Wignore x.py <<'PY'${pyBody}`],
    ['python3 -mjson.tool (osszetapasztott modul)', `python3 -mjson.tool <<'PY'${pyBody}`],
    ['node --eval (a kod az argumentum)', "node --eval '1' <<'JS'\nrequire('child_process').execSync('dropdb x')\nJS"],
  ])('K5 KONTROLL: %s: a heredoc ADAT, ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })

  it('L1: osszetapasztott here-string (<<<"...") TILTVA', () => {
    expect(verdict(`python3 <<<"${run}"`)).toBe('deny')
  })

  it('L2: tokenizalhatatlan nyito (parositatlan idezojel a << elott) a biztos oldal: kod, TILTVA', () => {
    // A torzs aposztrofja (it's) zarja a nyito idezojelet: igy CSAK a nyito-ag latja a kodot.
    expect(verdict(`python3 - 'a <<PY\n# it's\nimport subprocess\nsubprocess.run(["dropdb","x"])\nPY`)).toBe('deny')
  })

  it('KONTROLL: timeout elotti artalmatlan -c kod ATMEGY', () => {
    expect(verdict(`timeout 60 python3 -c "import subprocess; subprocess.run(['git','status'])"`)).toBe('none')
  })
})
