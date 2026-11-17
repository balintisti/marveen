/**
 * A DB-KAPU INDITO-ELOTAGJA LINEARIS (kartya d288b124, didi 57361).
 *
 * A `_DB_CLIENT_PATH` minta egy indito-lancot olvas a kliens utvonala elott (`sudo -u
 * postgres timeout -s KILL 5 /opt/.../psql`). Az elso valtozatban egy szo KETFELEKEPPEN
 * volt olvashato: a `-u env` parban az `env` lehetett a kapcsolo erteke VAGY a kovetkezo
 * indito, a `-k 5` parban az `5` ertek VAGY idotartam. Egy NEM illeszkedo parancson a
 * regex mind a 2^n olvasatot vegigprobalta:
 * didi merese szerint 22 par (169 bajt) utan a kapu 10 mp-en belul nem dontott, a hook
 * idokorlatja lejart, es a harness atengedte a mogotte allo force pusht.
 *
 * MIERT FRISS FOLYAMAT ESETENKENT: didi merte, hogy ugyanabban a folyamatban a masodik
 * futas ~8x gyorsabb, tehat egy kozos folyamat elfedne a regressziot. MIERT IDOKORLAT
 * A HIVASON: egy visszatero exponencialis minta itt nem lassu tesztet, hanem orakig fuggo
 * tesztet adna; a `timeout` + `killSignal` miatt BUKIK, nem fugg.
 *
 * EZ A FAJL SEMMIT NEM HAJT VEGRE: a kapu DONTESI fuggvenyenek szoveget ad at, a
 * verdiktet olvassa vissza (mint a `db-gate-force-push` spec).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

/** Verdikt es a dontes ideje (mp), FRISS python folyamatban, 5 mp-es plafonnal. */
function decide(command: string): { blocked: boolean; seconds: number } {
  const driver = `
import importlib.util, json, sys, time
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
cmd = json.loads(sys.stdin.read())
t = time.perf_counter()
hits = g.find_hits(cmd)
print(json.dumps({"blocked": bool(hits), "seconds": time.perf_counter() - t}))
`
  const out = execFileSync('python3', ['-c', driver], {
    input: JSON.stringify(command), encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL',
  })
  return JSON.parse(out.trim())
}

/** A hook 10 mp-es korlatjahoz kepest nagy tartalek, de egy 2^22-es visszalepest elkap. */
const FAST = 0.5

describe('db-destructive-gate: az indito-elotag egyertelmu olvasata (d288b124)', () => {
  it('didi esete: 22 `-u env` par + force push -> tiltva, gyorsan', () => {
    const r = decide('env ' + '-u env '.repeat(22) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('200 `-u env` par sem lassit', () => {
    const r = decide('env ' + '-u env '.repeat(200) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('didi masodik esete: 23 / 200 `sudo -Z` par + force push', () => {
    for (const n of [23, 200]) {
      const r = decide('sudo ' + '-Z sudo '.repeat(n) + 'echo / ; git push --force')
      expect(r.blocked).toBe(true)
      expect(r.seconds).toBeLessThan(FAST)
    }
  })

  it('idotartam-lanc: `-k 5` ertek vagy idotartam', () => {
    const r = decide('timeout ' + '-k 5 '.repeat(60) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('dupla szokoz a parok kozott (merve: a szokozfutas maga nem forrasa a visszalepesnek)', () => {
    const r = decide('env ' + '-u  env  '.repeat(60) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('ertekadas-lanc dupla szokozzel', () => {
    const r = decide('A=1  '.repeat(200) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('subshell-lanc dupla szokozzel: `(  (  (` ...', () => {
    const r = decide('(  '.repeat(60) + 'echo / ; git push --force')
    expect(r.blocked).toBe(true)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('artalmatlan hosszu lanc: atmegy, es gyorsan dont', () => {
    const r = decide('env ' + '-u env '.repeat(200) + '/bin/echo ok')
    expect(r.blocked).toBe(false)
    expect(r.seconds).toBeLessThan(FAST)
  })

  it('a regi lefedettseg marad: utvonalas kliens indito-lanc mogott tiltva', () => {
    for (const cmd of [
      'sudo -u postgres /opt/homebrew/opt/postgresql@16/bin/psql -c "DROP DATABASE x"',
      'timeout -s KILL 5 /x/psql -c "DROP TABLE t"',
      'env  -u  env  /x/psql -c "DROP TABLE t"',
      'sudo -u env /x/psql -c "DROP TABLE t"',
      'timeout -k 5 5 /x/psql -c "DROP TABLE t"',
      'env ' + '-u env '.repeat(30) + '/x/psql -c "DROP TABLE t"',
      'echo $(  /x/psql -c "DROP TABLE t")',
    ]) {
      expect(decide(cmd).blocked, cmd).toBe(true)
    }
  })

  // didi 58687 T1: a lookahead (`(?!(?:indito|idotartam)(?:\s|$))`) a kapcsolo-erteket
  // csak akkor veti el, ha az EGESZ szo indito-nev vagy idotartam. A szohatar nelkul az
  // indito-nevvel vagy szammal KEZDODO ertek (envoy, sudoers, timeouts, 5x) sem lehetne
  // ertek, a lanc megszakadna, es a mogotte allo utas kliens csendben atmenne.
  it('az indito-nevvel vagy szammal kezdodo kapcsolo-ertek mogott is tiltva (a lookahead szohatara)', () => {
    for (const cmd of [
      'env -u envoy /opt/pg/bin/psql -c "DROP TABLE t"',
      'sudo -u sudoers /usr/bin/psql -c "DROP TABLE t"',
      'timeout -s timeouts 5 /opt/x/mysql -e "DROP TABLE t"',
      'sudo -u 5x /usr/bin/psql -c "DROP TABLE t"',
    ]) {
      expect(decide(cmd).blocked, cmd).toBe(true)
    }
  })

  it('utvonalas kliens NEM parancs-pozicioban tovabbra sem talalat (git grep -- .../prisma)', () => {
    expect(decide('git grep "x" -- backend/api/prisma').blocked).toBe(false)
  })
})
