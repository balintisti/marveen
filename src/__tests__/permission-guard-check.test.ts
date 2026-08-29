import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Van-e fek a koordinatoron -- es tuleli-e a kovetkezo indulast? (kartya caaf32a4)
//
// KET MERT ESEMENY SZULTE, es a masodik a fontosabb:
//  1. A koordinatornak NULLA deny-tetele volt, mikozben hat alagensnek 13-24.
//  2. Amikor a lista bekerult, a RENDSZER torolte 41 perccel kesobb: a fo-agens
//     indulasi provisioningja a MEGOSZTOTT settings.json-t masolja az izolaltra, es a
//     sajat kulcsok csak akkor elik tul, ha a megosztott nem ismeri oket. A megosztott
//     fajlban VAN `permissions`, tehat az egesz blokk felulirodik -- a `deny` alkulccsal
//     egyutt. A veszteseg ALKULCS-szintu, a merge felszines.
//
// EZERT MER EZ HARMAT, NEM EGYET. Egy or, ami csak a mai darabszamot nezi, ugyanugy
// elnemul, ahogy a lista eltunt -- csak eggyel kesobb. A "tuleli-e" sor az, ami 22:58-kor
// megmondta volna, hogy az irasom hiabavalo.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'permission-guard-check.sh')

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'permguard-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, obj: unknown): string => {
  const p = join(dir, name)
  writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2))
  return p
}
const run = (iso: string, shared: string): string[] =>
  execFileSync('bash', [SCRIPT, iso, shared], { encoding: 'utf-8' }).trim().split('\n').filter(Boolean)
const of = (lines: string[], key: string): string[] =>
  lines.filter((l) => l.startsWith(`${key}|`)).map((l) => l.slice(key.length + 1))

describe('permission-guard -- van-e fek MA', () => {
  it('van lista -> OK, a darabszammal', () => {
    const iso = write('iso.json', { permissions: { deny: ['Bash(sudo:*)', 'Bash(rm -rf /:*)'] } })
    const sh = write('shared.json', { model: 'x' })
    expect(of(run(iso, sh), 'OK')[0]).toMatch(/deny-listaja 2 tetel/)
  })

  it('NULLA tetel + defaultMode auto -> FAIL, es megnevezi, hogy KERDES SINCS', () => {
    // Ez a sulyos alak: az `auto` mod es a prompt-kihagyas mellett a deny az EGYETLEN
    // fek. Kulon uzenet jar neki, mert a teendo is mas.
    const iso = write('iso.json', {
      permissions: { allow: [], defaultMode: 'auto' },
      skipDangerousModePermissionPrompt: true,
    })
    const sh = write('shared.json', {})
    const f = of(run(iso, sh), 'FAIL')[0]
    expect(f).toMatch(/NULLA deny-tetele van, ES nincs kerdes sem/)
    expect(f).toMatch(/nincs fek/)
  })

  it('NULLA tetel, DE kerdes van -> szinten FAIL, MAS uzenettel', () => {
    // A ket eset kulonbsege nem kozmetikai: itt egy ember meg megallithatja a
    // muveletet. Ha ugyanazt az uzenetet kapnak, a sulyosabbik elvesz a zajban.
    const iso = write('iso.json', { permissions: { allow: [], defaultMode: 'ask' } })
    const sh = write('shared.json', {})
    const f = of(run(iso, sh), 'FAIL')[0]
    expect(f).toMatch(/NULLA deny-tetele van/)
    expect(f).not.toMatch(/nincs fek/)
  })
})

describe('permission-guard -- TULELI-E a kovetkezo indulast', () => {
  it('a megosztott konfig IS definial permissions-t -> a lista NEM eli tul', () => {
    // A mert eset, pontosan: 22 tetel az izolaltban, a megosztottban `permissions`
    // deny nelkul -> a provisioning az EGESZ blokkot masolja, es a 22 elveszik.
    const iso = write('iso.json', { permissions: { deny: Array.from({ length: 22 }, (_, i) => `Bash(x${i}:*)`) } })
    const sh = write('shared.json', { permissions: { allow: ['Bash(npm:*)'], defaultMode: 'auto' } })
    const f = of(run(iso, sh), 'FAIL').join(' ')
    expect(f).toMatch(/NEM ELI TUL A KOVETKEZO INDULAST/)
    expect(f).toMatch(/22 tetel elveszik/)
  })

  it('a megosztott konfig NEM definial permissions-t -> tulel', () => {
    const iso = write('iso.json', { permissions: { deny: ['Bash(sudo:*)'] } })
    const sh = write('shared.json', { model: 'x', hooks: {} })
    const lines = run(iso, sh)
    expect(of(lines, 'INFO').join(' ')).toMatch(/tulel/)
    expect(of(lines, 'FAIL')).toEqual([])
  })

  it('URES lista + a megosztott definial permissions-t -> ELORE szol, hogy hiaba irnank oda', () => {
    // Ez a sor az, ami 22:58-kor megmondta volna, hogy az irasom hiabavalo. Egy or,
    // ami csak a darabszamot meri, ezt sosem mondja meg.
    const iso = write('iso.json', { permissions: { allow: [], defaultMode: 'ask' } })
    const sh = write('shared.json', { permissions: { allow: [] } })
    expect(of(run(iso, sh), 'INFO').join(' ')).toMatch(/a kovetkezo indulaskor ELVESZNE/)
  })
})

describe('permission-guard -- a NEM MERT nem lehet OK', () => {
  it('hianyzo izolalt konfig -> SKIP, es SEMMILYEN OK', () => {
    const lines = run(join(dir, 'nincs.json'), write('shared.json', {}))
    expect(of(lines, 'SKIP')[0]).toMatch(/NEM MERVE, nem 'rendben'/)
    expect(of(lines, 'OK')).toEqual([])
  })

  it('ERTELMEZHETETLEN izolalt konfig -> FAIL "ISMERETLEN", nem OK es nem SKIP', () => {
    // A harmadik allapot, amit a legkonnyebb elnyelni: a fajl OTT VAN, csak nem
    // olvashato. Se "rendben", se "nincs" -- a fek allapota ismeretlen.
    const iso = write('iso.json', '{ ez nem json')
    const lines = run(iso, write('shared.json', {}))
    expect(of(lines, 'FAIL')[0]).toMatch(/nem ertelmezheto JSON.*ISMERETLEN/)
    expect(of(lines, 'OK')).toEqual([])
    expect(of(lines, 'SKIP')).toEqual([])
  })

  it('a kilepesi kod MINDIG 0, es a szkript szintaktikailag ep', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow()
    const iso = write('iso.json', { permissions: { allow: [], defaultMode: 'auto' } })
    expect(() => execFileSync('bash', [SCRIPT, iso, write('shared.json', {})])).not.toThrow()
  })
})
