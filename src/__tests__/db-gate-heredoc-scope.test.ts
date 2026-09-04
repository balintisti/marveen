/**
 * A DB-KAPU HEREDOC-HATOKORE (kartya 63ab0d14).
 *
 * A LELET, ahogy dexter megfigyelte 2026-09-04-en -- RENDES MUNKA kozben, NEM szondazassal
 * (ez fontos: egy destruktiv kapunal a PROBA MAGA a kockazat, ezert sem o, sem en nem
 * futtattunk valtozatokat egy adatbazis ellen; ez a fajl SZOVEGET ad a dontesi fuggvenynek,
 * es semmit nem hajt vegre):
 *
 *     psql ... -c 'DROP TABLE IF EXISTS "FormField" CASCADE;'   -> BLOKKOLVA
 *     ugyanaz heredocban, ugyanarra az adatbazisra, percekkel kesobb -> LEFUTOTT
 *
 * A MECHANIZMUS ket, kulon-kulon HELYES resz talalkozasa:
 *   - `strip_heredoc_bodies` SZANDEKOSAN megtartja a body-t, ha az opener vegrehajtja
 *     (`psql <<'SQL'`), hogy ellenorizheto legyen;
 *   - a szegmentalas `\n`-en is vag, a SQL-osztaly viszont KET dolgot kiван UGYANABBAN a
 *     szegmensben (klienst ES utasitast).
 * Egyutt: a body SOHA nem kerulhet egy szegmensbe a psql-lel, ami vegrehajtja.
 *
 * Ez cafolja a fajl sajat, korabbi kommentjet is ("an extra boundary can only cause an extra
 * check, never a missed one") -- ami a TOOL-osztalyra igaz es a SQL-osztalyra nem.
 *
 * A 4. ESET A LEGFONTOSABB: a proza-heredoc tovabbra is ATMEGY. Az volt a v1 elso valodi
 * hamis pozitivja, es a javitasnak nem szabad visszahoznia.
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
  const out = execFileSync('python3', ['-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

describe('db-destructive-gate: a heredoc-body a kliensevel egy szegmensben marad', () => {
  it('a dexter-fele HEREDOC alak BLOKKOLVA (ez volt a lelet)', () => {
    expect(blocks("psql -h localhost -d crm_e2e_dexter <<'SQL'\nDROP TABLE IF EXISTS \"FormField\" CASCADE;\nSQL")).toBe(true)
  })

  it('a `-c` alak tovabbra is BLOKKOLVA (regresszio)', () => {
    expect(blocks("psql -h localhost -d crm_e2e_dexter -q -c 'DROP TABLE IF EXISTS \"FormField\" CASCADE;'")).toBe(true)
  })

  it('akkor is, ha a destruktiv utasitas NEM az elso -- a body sajat `;`-je ujraosztana', () => {
    expect(blocks("psql -d x <<'SQL'\nSELECT 1;\nDROP TABLE y;\nSQL")).toBe(true)
  })

  it('KONTROLL: PROZA egy markdown-heredocban ATMEGY -- ez volt a v1 hamis pozitivja', () => {
    expect(blocks("cat > notes.md <<'EOF'\nA kapu a DROP TABLE-t fogja.\nEOF")).toBe(false)
  })

  it('KONTROLL: artalmatlan psql-heredoc ATMEGY', () => {
    expect(blocks("psql -d x <<'SQL'\nSELECT count(*) FROM \"Task\";\nSQL")).toBe(false)
  })

  it('TRUNCATE is a heredocban', () => {
    expect(blocks("psql -d x <<'SQL'\nTRUNCATE \"Task\";\nSQL")).toBe(true)
  })

  it('bash-heredoc, benne egy psql -c', () => {
    expect(blocks("bash <<'EOF'\npsql -d x -c 'DROP TABLE y;'\nEOF")).toBe(true)
  })
})
