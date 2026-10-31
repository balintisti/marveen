/**
 * A DB-KAPU VALTOZOBAN TARTOTT KLIENSE (kartya 485228fd; didi 50541, a populacio merve
 * 2026-10-31: 306204 valodi parancsbol 3, mind a kozos e2e adatbazison, mind ATMENT).
 *
 *     P=/opt/homebrew/opt/postgresql@15/bin/psql; $P -c "DROP DATABASE x"
 *         -> ATMENT: a szovegben a parancsszo `$P`, a kliens neve csak az ertekadasban all
 *
 * A JAVITAS: ahol a parancs egy valtozot, amit UGYANABBAN a parancsban egy DB-kliens erteket
 * kapott, `$NEV` / `${NEV}` alakban hasznal, oda az ertek kerul, ahogy a shell kifejti.
 * Kornyezetbol vagy fajlbol jovo erteket a kapu nem lat (az nincs a parancs szovegeben).
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

describe('db-destructive-gate: valtozoban tartott DB-kliens (485228fd)', () => {
  it.each([
    // A mert valodi alak, szo szerint (a kozos e2e adatbazis).
    ['a mert valodi parancs', 'P=/opt/homebrew/opt/postgresql@15/bin/psql; $P -h localhost -p 54392 -U postgres -q -c "DROP DATABASE crm_e2e_test"'],
    ['csupasz kliens-nev', 'P=psql; $P -c "DROP TABLE x"'],
    ['kapcsos alak, idezett ertek', 'PSQL="/opt/homebrew/bin/psql" && ${PSQL} -c "TRUNCATE x"'],
    ['egyszeresen idezett ertek', "P='/opt/homebrew/bin/psql'; $P -c 'DROP TABLE x'"],
    ['export utan', 'export P=/usr/local/bin/psql; $P -c "DROP SCHEMA s"'],
    ['inditoval', 'P=/usr/bin/psql; timeout 60 $P -c "DROP TABLE x"'],
    ['helyettesitesben', 'P=psql; x=$($P -c "DROP TABLE x")'],
    ['$-os konyvtar az ertekben', 'P=$HOME/bin/psql; $P -c "DROP TABLE x"'],
    // Minden kliens-nev a listaban (didi 50591: C6/C7/C8 kiesese tulelt, csak a psql volt rogzitve).
    ['sqlite3', 'P=sqlite3; $P a.db "DROP TABLE x"'],
    ['mysql', 'M=/usr/local/bin/mysql; $M -e "DROP TABLE x"'],
    ['prisma', 'P=prisma; $P migrate reset'],
    // F-C1 (didi 50616): a dropdb is valtozoban; a komment azt allitotta, hogy az ertekadas mar tilt.
    ['dropdb uttal', 'P=/opt/homebrew/bin/dropdb; $P crm_x'],
    ['dropdb csupaszon', 'P=dropdb; $P crm_x'],
    ['dropdb idezett ${}-vel', 'P=dropdb; "${P}" crm_x'],
    // Az e2e-kivetel a ki NEM fejtett parancsot olvassa: a valtozos alak nem kivetel.
    ['dropdb valtozoban e2e nevre', 'P=dropdb; $P -h localhost crm_e2e_dexter_x'],
  ])('%s: TILTVA', (_name, cmd) => {
    expect(verdict(cmd)).toBe('deny')
  })

  // A lista MINDEN neve, uttal: egy kieso nev nem olvasott kliens (C6-C8 csak a minta).
  it.each(['psql', 'sqlite3', 'mysql', 'mariadb', 'mongo', 'mongosh', 'cockroach', 'pg_restore', 'pgcli',
    'prisma', 'supabase', 'dbmate', 'flyway', 'liquibase', 'dropdb'])('valtozoban %s: TILTVA', (client) => {
    expect(verdict(`C=/opt/x/bin/${client}; $C -c "DROP TABLE x"`)).toBe('deny')
  })

  it.each([
    ['artalmatlan lekerdezes', 'P=/opt/homebrew/bin/psql; $P -c "select 1"'],
    ['a valtozo csak kiirva', 'P=/opt/homebrew/bin/psql; echo $P'],
    ['konyvtar, nem kliens', 'PG=/opt/homebrew/opt/postgresql@15/bin; ls $PG'],
    ['kliens-nevu naplofajl', 'P=/tmp/psql.log; cat $P'],
    // A `$P` utan betu all: az egy MASIK valtozo (`$PATH`), nem a kliens.
    ['hosszabb nevu masik valtozo', 'P=psql; echo $PATH -c "DROP TABLE x"'],
  ])('KONTROLL: %s ATMEGY', (_name, cmd) => {
    expect(verdict(cmd)).toBe('none')
  })
})

/** A kapu expand_client_vars()-a egy parancs-SZOVEGRE. */
function expanded(command: string): string {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps(g.expand_client_vars(json.loads(sys.stdin.read()))))
`
  const out = execFileSync('python3', ['-I', '-B', '-c', driver], { input: JSON.stringify(command), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

// A verdikten at ez a ket hatar nem latszik (a tulkifejtes betut hagy a nev utan, abbol
// kliens nem lesz; mutans V2 es V5 igy tulelt), a kifejtett SZOVEG viszont mas lenne.
describe('db-destructive-gate: expand_client_vars hatarai (485228fd)', () => {
  it.each([
    ['csak a sajat nevet fejti ki, a hosszabbat nem', 'P=psql; $P x; echo $PATH', 'P=psql; psql x; echo $PATH'],
    ['kliens-nevu fajl nem kliens', 'P=/tmp/psql.log; cat $P', 'P=/tmp/psql.log; cat $P'],
    ['kapcsos alak', 'P=/usr/bin/psql; ${P} x', 'P=/usr/bin/psql; /usr/bin/psql x'],
  ])('%s', (_name, cmd, want) => {
    expect(expanded(cmd)).toBe(want)
  })
})
