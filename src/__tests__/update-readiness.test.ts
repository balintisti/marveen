import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Kartya bae4df49. A frissitesi ut hibaja definicio szerint KESON derul ki --
// akkor, amikor mar frissiteni kellene. 2026-08-23-an megmerve: ez a telepites
// MAR nem tudott frissulni, es senki nem tudott rola.
//
// A proba eldobhato git-topologian fut, halozat nelkul: ez ugyanaz a harness,
// ami az ahead-kapunal is bevalt. Egy egyszeri kezi futtatas azt bizonyitja,
// hogy AKKOR mukodott; egy teszt azt, hogy MOSTANTOL is fog.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

type Allapot = 'kesz' | 'ag-nincs-a-tavolin' | 'nincs-upstream' | 'elore-van' | 'levalasztott'

function fixture(allapot: Allapot): string {
  const dir = mkdtempSync(join(tmpdir(), 'updready-'))
  const origin = join(dir, 'origin.git')
  const work = join(dir, 'work')
  const sh = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf-8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  mkdirSync(origin); mkdirSync(work)
  sh(origin, 'init', '--bare', '-b', 'main')
  sh(dir, 'clone', origin, work)
  sh(work, 'config', 'user.email', 't@t'); sh(work, 'config', 'user.name', 't')
  writeFileSync(join(work, 'README.md'), 'x\n')
  sh(work, 'add', '.'); sh(work, 'commit', '-m', 'init'); sh(work, 'push', 'origin', 'main')

  if (allapot === 'ag-nincs-a-tavolin') sh(work, 'checkout', '-b', 'csak-helyi')
  if (allapot === 'nincs-upstream') sh(work, 'branch', '--unset-upstream')
  if (allapot === 'elore-van') {
    writeFileSync(join(work, 'uj.txt'), 'y\n')
    sh(work, 'add', '.'); sh(work, 'commit', '-m', 'helyi commit')
  }
  if (allapot === 'levalasztott') sh(work, 'checkout', '--detach', 'HEAD')

  mkdirSync(join(work, 'scripts'), { recursive: true })
  copyFileSync(join(ROOT, 'scripts', 'update-readiness.sh'), join(work, 'scripts', 'update-readiness.sh'))
  return work
}

function probe(work: string): { status: number; json: any } {
  const r = spawnSync('bash', [join(work, 'scripts', 'update-readiness.sh')], { encoding: 'utf-8', timeout: 30_000 })
  return { status: r.status ?? -1, json: JSON.parse(r.stdout) }
}

describe('update-readiness.sh -- a frissitesi ut allapota, MIELOTT kellene', () => {
  it('POZITIV KONTROLL: egy egeszseges checkout READY', () => {
    // Enelkul minden lenti "not ready" attol is igaz lenne, hogy a proba
    // mindig nemet mond -- es akkor semmit nem allitana.
    const { status, json } = probe(fixture('kesz'))
    expect(status).toBe(0)
    expect(json.ok).toBe(true)
    expect(json.ready).toBe(true)
    expect(json.reasons).toEqual([])
  })

  it('az ag nincs a tavolin -> NEM ready, es MEGNEVEZI', () => {
    // Ez az az allapot, amiben a valodi telepites MA van.
    const { json } = probe(fixture('ag-nincs-a-tavolin'))
    expect(json.ready).toBe(false)
    expect(json.reasons.join(' ')).toMatch(/nem letezik/)
  })

  it('NINCS upstream -> az ahead NEM merheto, es ez SAJAT ok, nem nulla', () => {
    // A mai lecke: az update.sh:332 `|| echo 0`-ja egy MERESI BUKAST alakitott
    // megnyugtato ertekke. Itt a `null` es a sajat indok all a helyen.
    const { json } = probe(fixture('nincs-upstream'))
    expect(json.ready).toBe(false)
    expect(json.ahead).toBeNull()
    expect(json.reasons.join(' ')).toMatch(/NEM MERHETO/)
  })

  it('helyi commit az upstream felett -> NEM ready, es kiirja a SZAMOT', () => {
    const { json } = probe(fixture('elore-van'))
    expect(json.ready).toBe(false)
    expect(json.ahead).toBe(1)
    expect(json.reasons.join(' ')).toMatch(/elore van/)
  })

  it('levalasztott HEAD -> NEM ready, es nem hasal el', () => {
    const { json } = probe(fixture('levalasztott'))
    expect(json.ok).toBe(true)
    expect(json.ready).toBe(false)
    expect(json.branch).toBeNull()
  })

  it('MINDIG 0-val lep ki -- a kilepesi kod nem hordozza a verdiktet', () => {
    // Ugyanaz a szerzodes, mint a calendar-agenda.sh-nal: egy hivo nem
    // veszitheti el az OKOT azzal, hogy a statuszt nezi.
    for (const a of ['kesz', 'ag-nincs-a-tavolin', 'nincs-upstream'] as Allapot[]) {
      expect(probe(fixture(a)).status, a).toBe(0)
    }
  })
})
