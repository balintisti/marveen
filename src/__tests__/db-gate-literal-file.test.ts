/**
 * A DB-KAPU FAJLBOL ERKEZO SQL-JE (kartya fc7d05f9; friday 2e08a7e1-es javitasanak
 * portja, ami 22 napig nem olvadt be).
 *
 * A RES: a kapu a PARANCS SZOVEGET nezi. Ha az SQL egy FAJLBOL erkezik, a szoveg nem
 * tartalmazza az utasitast -- `psql -f x.sql`, `psql < x.sql`, `cat x.sql | psql`,
 * `\i x.sql` es `prisma db execute --file` mind atment (didi merte az elo kapun, 10/10),
 * mikozben ugyanaz az utasitas `-c`-vel blokkolt.
 *
 * AMIT EZ NEM ZAR BE: a VALTOZOS utat (`psql -f "$f"`) es a szkriptet, ami maga futtat
 * SQL-t. Ez az ESZKOZ HATARA, nem elmulasztott javitas: a hook parancs-sztringet lat,
 * nem folyamatot. Ezt SEHOL nem szabad ugy leirni, hogy "a -f lyuk bezarva".
 *
 * NULLA SZONDAZAS: ez a fajl SZOVEGET ad a dontesi fuggvenynek es fixture-fajlokat
 * olvas. Egyetlen adatbazishoz sem nyul.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

let dir = ''
beforeAll(() => {
  // A HOME alatt, nem /tmp-ben: a /tmp gyoker mas hookok alatt hamis pirosat ad.
  dir = mkdtempSync(join(homedir(), '.dbgate-literal-'))
  writeFileSync(join(dir, 'destructive.sql'), 'SELECT 1;\nDROP TABLE "FormField" CASCADE;\n')
  writeFileSync(join(dir, 'safe.sql'), 'SELECT count(*) FROM "Task";\n')
  // Ket soros, LEGALIS DELETE: soronkenti prefixszel `psql DELETE FROM "Task"` lenne
  // belole, WHERE nelkul -- hamis tiltas a leggyakoribb biztonsagos alakra.
  writeFileSync(join(dir, 'multiline-safe.sql'), 'DELETE FROM "Task"\nWHERE id = 1;\n')
  // friday valtozata a 400. sornal megallt, NAPLO NELKUL: a 401. sori utasitas atment.
  writeFileSync(join(dir, 'deep.sql'), 'SELECT 1;\n'.repeat(420) + 'DROP TABLE x;\n')
  writeFileSync(join(dir, 'nested.sql'), '\\i destructive.sql\n')
  writeFileSync(join(dir, 'compose.yml'), 'services:\n  db:\n    command: DROP TABLE x\n')
  writeFileSync(join(dir, 'notes.md'), '# Jegyzet\nA DROP TABLE veszelyes, ezert nem hasznaljuk.\n')
  writeFileSync(join(dir, 'locked.sql'), 'SELECT 1;\n')
  chmodSync(join(dir, 'locked.sql'), 0o000)
  // \ir egy MASIK konyvtarban allo fajlbol: a psql az INCLUDOLO fajlhoz kepest old fel.
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'inner.sql'), 'DROP TABLE y;\n')
  writeFileSync(join(dir, 'sub', 'outer.sql'), '\\ir inner.sql\n')
  execFileSync('mkfifo', [join(dir, 'pipe.sql')])
})
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

/** A kapu DONTESE (verdict) egy parancs-SZOVEGRE. Nem hajt vegre semmit. */
function decide(command: string, cwd: string | null = dir): { kind: string; hits: string[]; missing: string[] } {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
cmd, cwd = json.loads(sys.stdin.read())
missing = []
kind, hits = g.verdict(cmd, None, cwd, missing)
print(json.dumps({"kind": kind, "hits": hits, "missing": missing}))
`
  // A timeout a FIFO-eset miatt: egy beakado verdict() itt DOB, nem lefagyasztja a futast.
  const out = execFileSync('python3', ['-c', driver], { input: JSON.stringify([command, cwd]), encoding: 'utf8', timeout: 5000 })
  return JSON.parse(out.trim())
}
const blocks = (c: string, cwd: string | null = dir) => decide(c, cwd).kind === 'deny'

describe('db-destructive-gate: fajlbol erkezo SQL', () => {
  it.each([
    ['psql -f', 'psql "$URL" -f destructive.sql'],
    ['psql --file=', 'psql "$URL" --file=destructive.sql'],
    ['psql < fajl', 'psql "$URL" < destructive.sql'],
    ['cat fajl | psql', 'cat destructive.sql | psql "$URL"'],
    ['psql -c \\i', "psql \"$URL\" -c '\\i destructive.sql'"],
    ['psql -c \\ir', "psql \"$URL\" -c '\\ir destructive.sql'"],
    ['prisma db execute --file', 'npx prisma db execute --file destructive.sql'],
    ['\\i egy psql-heredocban', "psql \"$URL\" <<'SQL'\n\\i destructive.sql\nSQL"],
  ])('%s destruktiv tartalommal BLOKKOLVA (ez volt a res)', (_n, cmd) => {
    expect(blocks(cmd)).toBe(true)
  })

  it('ABSZOLUT uttal is BLOKKOLVA, cwd nelkul is', () => {
    expect(blocks(`psql "$URL" -f ${dir}/destructive.sql`, null)).toBe(true)
  })

  it('a TELJES fajlt olvassa: a 421. sori utasitas is BLOKKOLVA (friday 400 soros neman vagott)', () => {
    expect(blocks('psql "$URL" -f deep.sql')).toBe(true)
  })

  it('egy fajl \\i-je egy masik fajlra: a masodik szint is BLOKKOLVA', () => {
    expect(blocks('psql "$URL" -f nested.sql')).toBe(true)
  })

  // FAIL-CLOSED, amit NEM lehetett megvizsgalni -- egy kivetellel.
  it('letezo, de OLVASHATATLAN fajl -> TILTAS, es az ok benne van', () => {
    const d = decide('psql "$URL" -f locked.sql')
    expect(d.kind).toBe('deny')
    expect(d.hits.join(' ')).toMatch(/could not be checked: locked\.sql/)
  })

  it('relativ ut cwd NELKUL -> TILTAS (nem tippel, hol all a hivo)', () => {
    const d = decide('psql "$URL" -f destructive.sql', null)
    expect(d.kind).toBe('deny')
    expect(d.hits.join(' ')).toMatch(/no cwd/)
  })

  it('NEM LETEZO fajl -> ATMEGY, de a hivonak visszaadja naplozasra', () => {
    // A kliens maga bukik el egy hianyzo fajlon: a tiltas semmit nem vedene.
    const d = decide('psql "$URL" -f nincs-ilyen.sql')
    expect(d.kind).toBe('none')
    expect(d.missing).toEqual(['nincs-ilyen.sql (does not exist)'])
  })

  it('cat TOBB fajl | psql: a masodik fajl is BLOKKOLVA', () => {
    expect(blocks('cat safe.sql destructive.sql | psql "$URL"')).toBe(true)
  })

  it('\\ir egy masik konyvtarban allo fajlbol az INCLUDOLO fajlhoz kepest old fel -> BLOKKOLVA', () => {
    // Kulonben a cwd-hez kepest "nem letezonek" latszik, es atmegy: megkerules.
    expect(blocks('psql "$URL" -f sub/outer.sql')).toBe(true)
  })

  it('egy FIFO nem akasztja meg a kaput: nem nyitja meg, atengedi es naplozza', () => {
    const d = decide('psql "$URL" -f pipe.sql')
    expect(d.kind).toBe('none')
    expect(d.missing.join(' ')).toMatch(/not a regular file/)
  })

  it('konyvtar -> ATMEGY + naplo, nem tiltas', () => {
    expect(decide('psql "$URL" -f sub').kind).toBe('none')
  })

  it('IDEZETT emlites (kartya-cim, commit-uzenet) NEM nyit meg fajlt -- a valodi forgalom egyetlen uj tiltasa ez volt', () => {
    // didi 61 valodi parancsot jatszott vissza: a `psql -f /` egy IDEZETT kartya-cimben
    // allt, a kapu megnyitotta a `/`-t, es tiltott. A kliensnek PARANCS-POZICIOBAN kell allnia.
    expect(blocks(`bash scripts/kanban-uj.sh marveen marveen "DB-kapu: a psql -f / nem latszik"`)).toBe(false)
    // A `psql` SZOKOZ utan alljon az idezeten belul: egy `"psql` alakot a kliens-minta
    // amugy sem lat, tehat az a teszt a parancs-pozicio nelkul is zold maradt (mert
    // mutacioval, N1). Ez az alak viszont a nyers szegmensen TILTANA.
    expect(blocks(`git commit -m "now psql -f destructive.sql is covered"`)).toBe(false)
  })

  // A NEGATIV ESETEK A JELENTES SULYA: egy tul-blokkolo kaput megkerulnek.
  it('UGYANAZ A FAJL egy NEM-DB kliensnek ATMEGY -- a hatokor-kontroll', () => {
    expect(blocks('grep -f destructive.sql app.log')).toBe(false)
    expect(blocks('cat destructive.sql | grep DROP')).toBe(false)
  })

  it('docker compose -f ATMEGY, akkor is, ha a yaml tartalmaz DROP TABLE-t', () => {
    expect(blocks('docker compose -f compose.yml up')).toBe(false)
  })

  it('psql -f ATMEGY, ha a fajl nem destruktiv', () => {
    expect(blocks('psql "$URL" -f safe.sql')).toBe(false)
  })

  it('ket soros DELETE ... WHERE ATMEGY: utasitasonkent olvas, nem soronkent', () => {
    expect(blocks('psql "$URL" -f multiline-safe.sql')).toBe(false)
  })

  it('a VALTOZOS alak ATMEGY -- ez a KIMONDOTT hatar, nem hiba', () => {
    expect(blocks('psql "$URL" -f "$WRAPPED"')).toBe(false)
  })

  it('a readonly-measure.sh hivasa ATMEGY: a hook a szkript belsejet nem latja', () => {
    expect(blocks('bash scripts/readonly-measure.sh --sql destructive.sql --env x')).toBe(false)
  })

  it('proza .md fajl psql -f-fel BLOKKOL -- DONTESSEL rogzitve (marveen, 2026-09-04)', () => {
    // Egy `psql -f notes.md` amugy sem futna ertelmesen; a hamis pozitiv HANGOS es egy
    // soros overrideval feloldhato, a hamis negativ egy eldobott adatbazis.
    expect(blocks('psql "$URL" -f notes.md')).toBe(true)
  })

  it('REGRESSZIO: -c, vegrehajto heredoc BLOKKOL; proza-heredoc ATMEGY', () => {
    expect(blocks(`psql "$URL" -c 'DROP TABLE "X";'`)).toBe(true)
    expect(blocks(`psql "$URL" <<'SQL'\nDROP TABLE "X";\nSQL`)).toBe(true)
    expect(blocks(`cat > notes.md <<'EOF'\nDROP TABLE is dangerous\nEOF`)).toBe(false)
  })
})
