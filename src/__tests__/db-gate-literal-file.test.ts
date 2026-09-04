/**
 * A DB-KAPU LITERAL-UTAS FAJL-ARGUMENTUMA (kartya 2e08a7e1).
 *
 * A RES: a kapu a PARANCS SZOVEGET nezi. Ha az SQL egy FAJLBOL erkezik, a szoveg nem
 * tartalmazza az utasitast -- `psql -f x.sql` es `psql < x.sql` atment, miközben ugyanaz
 * a `DROP TABLE` `-c`-vel blokkolt. Preexistalo, a fajl sajat docblockja (:89) nevesitette.
 *
 * A JAVITAS ALAKJA ugyanaz, mint a heredoc-javitase (63ab0d14), MASIK body-forrassal:
 * minden beolvasott sor megkapja a KLIENS nevet prefixkent, tehat a SQL-osztaly a
 * szegmentalas utan is egy szegmensben latja a klienst ES az utasitast.
 *
 * AMIT EZ NEM ZAR BE, ES A MEGFOGALMAZAS SZAMIT: ez a LITERAL-UTAS eset. A `psql -f "$f"`
 * valtozos alak tovabbra sem foghato -- nem elmulasztott javitas, hanem az ESZKOZ HATARA
 * (a hook parancs-sztringet lat, nem folyamatot). A sajat `readonly-measure.sh:122` epp
 * ezt a valtozos alakot hasznalja, es konstrukciobol nem lehet destruktiv
 * (BEGIN TRANSACTION READ ONLY, a kapu tuzelese a meres ELOTT ES UTAN bizonyitva).
 * Ezt SEHOL nem szabad ugy leirni, hogy "a -f lyuk bezarva".
 *
 * NULLA SZONDAZAS: ez a fajl SZOVEGET ad a dontesi fuggvenynek es fixture-fajlokat olvas.
 * Egyetlen adatbazishoz sem nyul -- dexter kikotese all, egy destruktiv kapunal a PROBA
 * MAGA a kockazat.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

let dir = ''
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dbgate-literal-'))
  writeFileSync(join(dir, 'destructive.sql'), 'SELECT 1;\nDROP TABLE "FormField" CASCADE;\n')
  writeFileSync(join(dir, 'safe.sql'), 'SELECT count(*) FROM "Task";\n')
  writeFileSync(join(dir, 'compose.yml'), 'services:\n  db:\n    command: DROP TABLE x\n')
})
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }) })

/** A kapu DONTESI fuggvenye egy parancs-SZOVEGRE. Nem hajt vegre semmit. */
function blocks(command: string): boolean {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
cmd, cwd = json.loads(sys.stdin.read())
print(json.dumps(bool(g.find_hits(cmd, cwd))))
`
  const out = execFileSync('python3', ['-c', driver], {
    input: JSON.stringify([command, dir]), encoding: 'utf8',
  })
  return JSON.parse(out.trim())
}

describe('db-destructive-gate: literal-utas fajl-argumentum', () => {
  it('psql -f <literal ut> destruktiv tartalommal BLOKKOLVA (ez volt a res)', () => {
    expect(blocks(`psql "$URL" -f ${dir}/destructive.sql`)).toBe(true)
  })

  it('psql < <literal ut> ugyanugy BLOKKOLVA (atiranyitas, nem heredoc)', () => {
    expect(blocks(`psql "$URL" < ${dir}/destructive.sql`)).toBe(true)
  })

  // A NEGATIV ESETEK A JELENTES SULYA: egy tul-blokkolo kaput megkerulnek vagy
  // kikapcsolnak, es akkor rosszabb, mint a lyuk.

  it('UGYANAZ A FAJL egy NEM-DB kliensnek ATMEGY -- ez az eros hatokor-kontroll', () => {
    // Szandekosan ugyanaz a destructive.sql: ha ez blokkolna, a hatokor-ellenorzes
    // nem tartana semmit. Mutaciora igazolva: a kliens-szures kivetele ezt PIROSSA teszi.
    expect(blocks(`grep -f ${dir}/destructive.sql app.log`)).toBe(false)
  })

  it('docker compose -f ATMEGY, akkor is, ha a yaml tartalmaz DROP TABLE-t', () => {
    expect(blocks(`docker compose -f ${dir}/compose.yml up`)).toBe(false)
  })

  it('psql -f ATMEGY, ha a fajl nem destruktiv', () => {
    expect(blocks(`psql "$URL" -f ${dir}/safe.sql`)).toBe(false)
  })

  it('a VALTOZOS alak ATMEGY -- ez a KIMONDOTT hatar, nem hiba', () => {
    // `psql -f "$f"`: a hook nem oldja fel a valtozot, es nem is tippel. Ez a
    // `readonly-measure.sh:122` alakja. Ha ez valaha BLOKK lesz, valaki tippelni kezdett.
    expect(blocks('psql "$URL" -f "$WRAPPED"')).toBe(false)
  })

  it('nem letezo fajl ATMEGY (fail-open), ahogy a kapu 1. inverzioja eloirja', () => {
    expect(blocks(`psql "$URL" -f ${dir}/nincs-ilyen.sql`)).toBe(false)
  })

  // REGRESSZIO: a mar meglevo harom viselkedes valtozatlan.
  it('REGRESSZIO: a vegrehajto heredoc tovabbra is BLOKKOLVA', () => {
    expect(blocks(`psql "$URL" <<'SQL'\nDROP TABLE "X";\nSQL`)).toBe(true)
  })

  it('REGRESSZIO: a -c alak tovabbra is BLOKKOLVA', () => {
    expect(blocks(`psql "$URL" -c 'DROP TABLE "X";'`)).toBe(true)
  })

  it('REGRESSZIO: a PROZA-heredoc tovabbra is ATMEGY (a v1 elso hamis pozitivja)', () => {
    expect(blocks(`cat > notes.md <<'EOF'\nDROP TABLE is dangerous\nEOF`)).toBe(false)
  })
})
