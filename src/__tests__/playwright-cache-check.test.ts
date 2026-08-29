import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The signal for a stalled Playwright install (card d1cf8ffb).
//
// THE FAILURE IT WATCHES FOR, measured 2026-08-23: `playwright install` finished
// its 165 MiB download in ~3 minutes, then stopped DURING EXTRACTION at 84 files
// / 448 KB -- twice, at the same byte -- and held the shared cache lock for five
// and a half hours. Every agent's e2e run was blocked, and nothing said so. The
// cache is shared, so one stuck install stops the fleet.
//
// AND THE SECOND HALF, which is why a listing is not enough: the half-extracted
// directory EXISTS. It was read as "the install finished" from `ls` -- 1.5 MB and
// two files against a finished 336 MB. A listing says a thing is THERE, not that
// it is READY.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'playwright-cache-check.sh')

let cache: string
beforeEach(() => { cache = mkdtempSync(join(tmpdir(), 'pwcache-')) })
afterEach(() => { rmSync(cache, { recursive: true, force: true }) })

/** Always-0 exit and line output are the contract; the caller parses STATUS|text. */
function run(dir: string = cache): string[] {
  const out = execFileSync('bash', [SCRIPT, dir], { encoding: 'utf-8' })
  return out.trim().split('\n').filter(Boolean)
}
const statuses = (lines: string[], kind: string): string[] =>
  lines.filter((l) => l.startsWith(`${kind}|`)).map((l) => l.slice(kind.length + 1))

/** A finished package: marker plus enough bytes to clear the measured floor. */
function pkg(name: string, opts: { marker?: boolean; kb?: number } = {}): void {
  const dir = join(cache, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'payload.bin'), Buffer.alloc((opts.kb ?? 1600) * 1024))
  if (opts.marker !== false) writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
}

describe('playwright-cache-check -- a kesz es a felbeszakadt csomag kulonbsege', () => {
  it('KESZ csomag -> OK', () => {
    pkg('chromium-1217')
    expect(statuses(run(), 'OK')[0]).toMatch(/^chromium-1217: kesz/)
    expect(statuses(run(), 'FAIL')).toEqual([])
  })

  it('MARKER NELKUL -> FAIL, a konyvtar megnevezve', () => {
    // Ez a felbeszakadt kicsomagolas ujjlenyomata: a konyvtar ott van, a marker nem.
    pkg('chromium-1217', { marker: false })
    expect(statuses(run(), 'FAIL')[0]).toMatch(/chromium-1217.*nincs INSTALLATION_COMPLETE/)
  })

  it('MARKER VAN, de a konyvtar ures-kozeli -> FAIL (a marker hazudna)', () => {
    // A masik irany: a marker keszet allit egy felbeszakadt kicsomagolasra. A mert
    // eset 448 KB volt; a kuszob 1 MB, a legkisebb VALODI csomag 2548 KB.
    pkg('chromium-1217', { kb: 448 })
    expect(statuses(run(), 'FAIL')[0]).toMatch(/marker VAN, de a konyvtar ures-kozeli/)
  })

  it('a 448 KB-os alak es a legkisebb VALODI csomag SZET VAN VALASZTVA', () => {
    // A hatar mindket oldala egy allitas. Csak az egyiket merni annyi, mint a
    // kuszobot talalgatni: egy 3 MB-os kuszob is atmenne az elozo teszten, es
    // kozben az egeszseges ffmpeg-et buktatna -- ez tortent az elso valtozatban.
    pkg('ffmpeg-1011', { kb: 2548 })
    pkg('chromium-1217', { kb: 448 })
    expect(statuses(run(), 'OK')[0]).toMatch(/^ffmpeg-1011: kesz/)
    expect(statuses(run(), 'FAIL')).toHaveLength(1)
  })

  it('a FAJLSZAM nem donthet: a hibas allapotnak TOBB fajlja volt, mint az egeszsegesnek', () => {
    // Merve: a beakadt kicsomagolas 84 fajl / 448 KB, az egeszseges ffmpeg 4 fajl /
    // 2548 KB. Egy fajlszam-alapu kuszob pont forditva dontene.
    const dir = join(cache, 'chromium-1217')
    mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 84; i++) writeFileSync(join(dir, `f${i}`), Buffer.alloc(4096))
    writeFileSync(join(dir, 'INSTALLATION_COMPLETE'), '')
    pkg('ffmpeg-1011', { kb: 2548 })
    expect(statuses(run(), 'FAIL')[0]).toMatch(/^chromium-1217/)
    expect(statuses(run(), 'OK')[0]).toMatch(/^ffmpeg-1011/)
  })
})

describe('playwright-cache-check -- amit NEM szabad talalatnak jelentenie', () => {
  it('a Playwright sajat nyilvantartasa (`b`) NEM talalat', () => {
    // Merve az elo gyorsitotaron: 4 KB, egy fajl, nulla marker -- alakilag AZONOS a
    // felbeszakadt csomaggal. Az elso valtozatom jelentette; a "javitas" egy olyan
    // konyvtar torlese lett volna, amit a Playwright maga tart karban.
    mkdirSync(join(cache, 'b'), { recursive: true })
    writeFileSync(join(cache, 'b', 'browser@abc123'), 'x')
    const lines = run()
    expect(statuses(lines, 'FAIL')).toEqual([])
    expect(statuses(lines, 'INFO').some((t) => t.startsWith('b: nem bongeszo-csomag'))).toBe(true)
  })

  it('FRISS __dirlock -> INFO, nem talalat (egy telepites eppen fut)', () => {
    pkg('chromium-1217')
    writeFileSync(join(cache, '__dirlock'), '')
    expect(statuses(run(), 'FAIL')).toEqual([])
  })

  it('BEAKADT __dirlock (40 perce) -> FAIL, mert a tobbi agenst blokkolja', () => {
    pkg('chromium-1217')
    const lock = join(cache, '__dirlock')
    writeFileSync(lock, '')
    const regen = new Date(Date.now() - 40 * 60_000)
    utimesSync(lock, regen, regen)
    expect(statuses(run(), 'FAIL')[0]).toMatch(/__dirlock 4[0-9] perce all/)
  })
})

describe('playwright-cache-check -- a NEM MERT nem lehet OK', () => {
  it('hianyzo gyorsitotar -> SKIP, es SEMMILYEN OK sor', () => {
    // A lenyeg. Egy gepen, ahol nincs Playwright, a "minden rendben" hamis allitas
    // lenne -- es pont az a hazugsag, amitol a kovetkezo valodi hiba is elsikkad.
    const lines = run(join(cache, 'nincs-ilyen'))
    expect(statuses(lines, 'SKIP')[0]).toMatch(/NEM MERVE, nem 'rendben'/)
    expect(statuses(lines, 'OK')).toEqual([])
  })

  it('URES gyorsitotar (letezik, de nincs benne csomag) -> SKIP, nem OK', () => {
    const lines = run()
    expect(statuses(lines, 'SKIP')[0]).toMatch(/egyetlen bongeszo-konyvtar sincs/)
    expect(statuses(lines, 'OK')).toEqual([])
  })

  it('a kilepesi kod MINDIG 0 -- a hivo a sorokbol dont', () => {
    pkg('chromium-1217', { marker: false })
    expect(() => execFileSync('bash', [SCRIPT, cache], { encoding: 'utf-8' })).not.toThrow()
  })

  it('a szkript szintaktikailag ep (bash -n)', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow()
  })
})
