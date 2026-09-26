/**
 * A DB-KAPU E2E-KIVETELE, ES A KET LYUK, AMIT A MEGIRASA KOZBEN TALALTUNK (kartya 251b5785).
 *
 * MIERT: minden e2e-futas letrehoz egy `crm_e2e_<agens>_<utotag>` adatbazist, es egyet sem
 * dobott el senki, mert a kapu tiltja: 2026-09-26-an 233 darab, 5,0 GB (didi merese). A
 * kivetel EGY TELJES PARANCS-ALAK, nem egy lazabb minta -- a kapu docblockja indokolja,
 * miert nem az a kivetel, amit korabban elvetettunk.
 *
 * A PROBA didi specifikaciojat koveti (a kartyan, 04:19): A) amit ENGEDNI kell, B) amit
 * TILTANI kell, koztuk a ket MA ELO csapda (`crm_e2e_didi` utotag nelkul = a baseline, es
 * `crm_e2e_test` = a KOZOS DB).
 *
 * ES A KET ELOZETES LYUK, mert a kivetel irasa kozben merve (find_hits -> [] mindkettore):
 *   1. a `dropdb` egyaltalan nem volt fedve -- barmely adatbazist eldobott, localhoston is
 *   2. egy MASODIK utasitas egy idezett `psql -c "...; ..."` argumentumban atment, mert a
 *      szegmentalo az idezojelen BELULI `;`-n is vagott, es a masodik fel kliens nelkul maradt
 *
 * EZ A FAJL SEMMIT NEM HAJT VEGRE. A kapu dontesi fuggvenyeinek szoveget ad at, es a
 * verdiktet olvassa vissza, ugyanaz a szerzodes, mint a tobbi `db-gate-*` specben.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

// A kulcsszavak osszerakva, hogy ez a forrasfajl maga ne legyen a kapu talalata egy
// `cat`-nel vagy `grep`-nel -- a kapu a nyers szoveget illeszti.
const DD = 'DROP ' + 'DATABASE'

/**
 * A kapu TELJES verdiktje egy parancsra: blokkol-e (van talalat ES nem a kivetel).
 * Az `env` a psql kornyezeti valtozoit adja, ures objektum = semmi nincs beallitva.
 */
function blocks(command: string, env: Record<string, string> = {}): boolean {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
a = json.loads(sys.stdin.read())
hits = g.find_hits(a["c"])
print(json.dumps(bool(hits) and not g.e2e_drop_allowed(a["c"], a["env"])))
`
  const out = execFileSync('python3', ['-c', driver], {
    input: JSON.stringify({ c: command, env }),
    encoding: 'utf8',
  })
  return JSON.parse(out.trim())
}

describe('db-gate e2e-kivetel: A) amit ENGEDNI kell', () => {
  it.each([
    [`psql -h localhost -c "${DD} crm_e2e_didi_b0395153"`],
    [`psql -h 127.0.0.1 -c "${DD} crm_e2e_didi_b0395153"`],
    [`psql -c "${DD} crm_e2e_didi_b0395153"`], // Unix-socket, -h nelkul
    [`psql -h localhost -c "${DD} IF EXISTS crm_e2e_dexter_x"`],
    [`psql -X -q -h localhost -U isti -d postgres -c "${DD} crm_e2e_dexter_x;"`],
    [`dropdb -h localhost crm_e2e_dexter_x`],
    [`dropdb -h localhost --if-exists crm_e2e_mandark_1a2b`],
    [`dropdb crm_e2e_friday_x`],
  ])('%s', (cmd) => {
    expect(blocks(cmd)).toBe(false)
  })

  it('a lokalis PGHOST sem zarja ki', () => {
    expect(blocks(`dropdb crm_e2e_didi_x`, { PGHOST: 'localhost' })).toBe(false)
    expect(blocks(`dropdb crm_e2e_didi_x`, { PGHOST: '/tmp' })).toBe(false)
  })
})

describe('db-gate e2e-kivetel: B) a NEV -- a ket elo csapda es a tobbi', () => {
  it.each([
    ['crm_e2e_didi', 'a baseline, utotag NELKUL'],
    ['crm_e2e_test', 'a KOZOS DB'],
    ['crm_e2e_test_x', 'a laza [a-z]+_ minta ezt engedne'],
    ['crm_e2e_frontend_x', 'nem agens-nev'],
    ['crm_e2e_didi_', 'ures utotag'],
    ['crm_dev', 'mas DB'],
    ['postgres', 'a rendszer-DB'],
    ['crm_prod', 'egy eles-szeru nev'],
    ['CRM_E2E_DIDI_X', 'nagybetu'],
    ['"crm_e2e_didi_x"', 'idezett azonosito'],
  ])('psql: %s (%s)', (name) => {
    expect(blocks(`psql -h localhost -c '${DD} ${name}'`)).toBe(true)
  })

  it.each([['crm_e2e_didi'], ['crm_e2e_test'], ['crm_dev'], ['postgres'], ['CRM_E2E_DIDI_X']])(
    'dropdb: %s',
    (name) => {
      expect(blocks(`dropdb -h localhost ${name}`)).toBe(true)
    },
  )
})

describe('db-gate e2e-kivetel: B) a HOST -- -h, PGHOST, PGHOSTADDR, conninfo', () => {
  it('egy tavoli -h', () => {
    expect(blocks(`psql -h aws-0-eu-central-1.pooler.supabase.com -c "${DD} crm_e2e_didi_x"`)).toBe(true)
    expect(blocks(`dropdb -h db.example.com crm_e2e_didi_x`)).toBe(true)
    expect(blocks(`dropdb --host=db.example.com crm_e2e_didi_x`)).toBe(true)
  })

  it('egy tavoli PGHOST -h nelkul', () => {
    expect(blocks(`dropdb crm_e2e_didi_x`, { PGHOST: 'db.example.com' })).toBe(true)
  })

  it('egy PGHOSTADDR felulirja a -h localhost-ot, tehat az is szamit', () => {
    expect(blocks(`dropdb -h localhost crm_e2e_didi_x`, { PGHOSTADDR: '10.0.0.5' })).toBe(true)
  })

  it('PGSERVICE es egy conninfo-alaku PGDATABASE', () => {
    expect(blocks(`dropdb crm_e2e_didi_x`, { PGSERVICE: 'prod' })).toBe(true)
    expect(blocks(`psql -c "${DD} crm_e2e_didi_x"`, { PGDATABASE: 'postgresql://prod/x' })).toBe(true)
  })

  it('egy conninfo -d, egy env-elotag, egy tobbhostos lista', () => {
    expect(blocks(`psql -d postgresql://prod.example.com/x -c "${DD} crm_e2e_didi_x"`)).toBe(true)
    expect(blocks(`PGHOST=db.example.com dropdb crm_e2e_didi_x`)).toBe(true)
    expect(blocks(`dropdb -h localhost,db.example.com crm_e2e_didi_x`)).toBe(true)
  })
})

describe('db-gate e2e-kivetel: B) az ALAK -- csak ez az egy utasitas, egymagaban', () => {
  it('ket utasitas egy -c-ben: az EGESZ bukik, nem csak a masodik', () => {
    expect(blocks(`psql -h localhost -c "${DD} crm_e2e_didi_x; ${DD} crm_dev"`)).toBe(true)
    expect(blocks(`psql -h localhost -c "${DD} crm_e2e_didi_x; ${DD} crm_e2e_didi_y"`)).toBe(true)
  })

  it('shell-operatorral fuzott masodik parancs', () => {
    expect(blocks(`dropdb crm_e2e_didi_x; dropdb crm_dev`)).toBe(true)
    expect(blocks(`dropdb crm_e2e_didi_x && dropdb crm_dev`)).toBe(true)
    expect(blocks(`dropdb crm_e2e_didi_x $(echo crm_dev)`)).toBe(true)
  })

  it('WITH (FORCE) es dropdb --force: egy elo munkamenetet lonenek le', () => {
    expect(blocks(`psql -h localhost -c "${DD} crm_e2e_didi_x WITH (FORCE)"`)).toBe(true)
    expect(blocks(`dropdb -f crm_e2e_didi_x`)).toBe(true)
    expect(blocks(`dropdb --force crm_e2e_didi_x`)).toBe(true)
  })

  it('mas destruktiv utasitas egy crm_e2e DB-n belul: a kivetel CSAK az adatbazis-eldobasra szol', () => {
    expect(blocks(`psql -h localhost -d crm_e2e_didi_x -c "DROP ${'SCHEMA'} public"`)).toBe(true)
    expect(blocks(`psql -h localhost -d crm_e2e_didi_x -c "${'TRUNCATE'} users"`)).toBe(true)
    expect(blocks(`psql -h localhost -d crm_e2e_didi_x -c "DROP ${'TABLE'} users"`)).toBe(true)
  })

  it('pozicionalis psql-argumentum (az adatbazis-nev helye) nem csuszhat be', () => {
    expect(blocks(`psql -h localhost -c "${DD} crm_e2e_didi_x" crm_dev`)).toBe(true)
  })
})

describe('db-gate: a ket elozetes lyuk, amit ez a kartya zar', () => {
  it('a dropdb MOST MAR tuzel barmely mas adatbazisra (eddig find_hits -> [])', () => {
    expect(blocks(`dropdb -h localhost crm_prod`)).toBe(true)
    expect(blocks(`dropdb crm_dev`)).toBe(true)
  })

  it('egy MASODIK utasitas egy idezett -c-ben MOST MAR tuzel (eddig find_hits -> [])', () => {
    expect(blocks(`psql -c "select 1; DROP ${'TABLE'} x"`)).toBe(true)
    expect(blocks(`psql -c 'select 1; ${'TRUNCATE'} x'`)).toBe(true)
  })

  it('KONTROLL: a proza tovabbra sem tuzel -- a lyuk zarasa nem gyart hamis riasztast', () => {
    expect(blocks(`echo "a dropdb parancs torol"; ls`)).toBe(false)
    expect(blocks(`git commit -m "psql: never run DROP ${'TABLE'} by hand"`)).toBe(false)
    expect(blocks(`psql -h localhost -c "select 1; select 2"`)).toBe(false)
  })
})
