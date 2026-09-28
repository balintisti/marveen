import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card b610c593 (c)): a bare mkdtempSync here leaked every run.
const mkTmp = tmpDirs()

// Kartya bae4df49. A frissitesi ut hibaja definicio szerint KESON derul ki --
// akkor, amikor mar frissiteni kellene. 2026-08-23-an megmerve: ez a telepites
// MAR nem tudott frissulni, es senki nem tudott rola.
//
// A proba eldobhato git-topologian fut, halozat nelkul: ez ugyanaz a harness,
// ami az ahead-kapunal is bevalt. Egy egyszeri kezi futtatas azt bizonyitja,
// hogy AKKOR mukodott; egy teszt azt, hogy MOSTANTOL is fog.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

type Allapot = 'kesz' | 'ag-nincs-a-tavolin' | 'nincs-tavoli-ref' | 'elore-van' | 'levalasztott' | 'idegen-upstream'

// THE UPDATE REMOTE IS `fork`, AS IN update.sh (UPDATE_REMOTE default) AND THE APPLY PREFLIGHT
// (card 788c0571). The install also carries the FOREIGN upstream as `origin`; measuring against it
// is exactly the false pass this card is about. So the fixture's own remote is named `fork`, and
// the 'idegen-upstream' state adds the foreign `origin` next to it.
function fixture(allapot: Allapot): string {
  const dir = mkTmp('updready-')
  const fork = join(dir, 'fork.git')
  const work = join(dir, 'work')
  const sh = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf-8' })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  mkdirSync(fork); mkdirSync(work)
  sh(fork, 'init', '--bare', '-b', 'main')
  sh(dir, 'clone', '-o', 'fork', fork, work)
  sh(work, 'config', 'user.email', 't@t'); sh(work, 'config', 'user.name', 't')
  writeFileSync(join(work, 'README.md'), 'x\n')
  sh(work, 'add', '.'); sh(work, 'commit', '-m', 'init'); sh(work, 'push', 'fork', 'main')

  if (allapot === 'ag-nincs-a-tavolin') sh(work, 'checkout', '-b', 'csak-helyi')
  if (allapot === 'nincs-tavoli-ref') sh(work, 'update-ref', '-d', 'refs/remotes/fork/main')
  if (allapot === 'elore-van') {
    writeFileSync(join(work, 'uj.txt'), 'y\n')
    sh(work, 'add', '.'); sh(work, 'commit', '-m', 'helyi commit')
  }
  if (allapot === 'levalasztott') sh(work, 'checkout', '--detach', 'HEAD')
  if (allapot === 'idegen-upstream') {
    // The foreign upstream: the local commit IS on origin/main and the branch tracks it, so
    // `@{u}..HEAD` reads 0 -- while against OUR fork the checkout is 1 ahead.
    const origin = join(dir, 'origin.git')
    mkdirSync(origin)
    sh(origin, 'init', '--bare', '-b', 'main')
    sh(work, 'remote', 'add', 'origin', origin)
    writeFileSync(join(work, 'uj.txt'), 'y\n')
    sh(work, 'add', '.'); sh(work, 'commit', '-m', 'helyi commit')
    sh(work, 'push', 'origin', 'main')
    sh(work, 'branch', '-u', 'origin/main')
  }

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

  it('a tavoli ref HIANYZIK -> az ahead NEM merheto, es ez SAJAT ok, nem nulla', () => {
    // A mai lecke: az update.sh:332 `|| echo 0`-ja egy MERESI BUKAST alakitott
    // megnyugtato ertekke. Itt a `null` es a sajat indok all a helyen. (A merteket a
    // `fork/<ag>` adja, nem az `@{u}`; ezert a nem-merheto eset a hianyzo tavoli ref.)
    const { json } = probe(fixture('nincs-tavoli-ref'))
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

  it('788c0571: az IDEGEN upstreamhez merve 0, a MI forkunkhoz 1 -> NEM ready, a fork ellen mer', () => {
    // A veszelyes irany: `@{u}..HEAD` = 0 az idegen repohoz, tehat a regi alak READY-t mondott,
    // mikozben a frissites (update.sh, UPDATE_REMOTE=fork) egy elore levo checkoutot talalna.
    const { json } = probe(fixture('idegen-upstream'))
    expect(json.remote).toBe('fork')
    expect(json.ahead).toBe(1)
    expect(json.ready).toBe(false)
  })

  it('a tavoli NEM ELERHETO -> NEM ready, es ezt mondja, nem azt, hogy nincs ag (didi 788c0571)', () => {
    const work = fixture('kesz')
    // the remote URL points nowhere: ls-remote fails with 128, not the "no such ref" 2
    spawnSync('git', ['remote', 'set-url', 'fork', join(work, '..', 'nincs-ilyen.git')], { cwd: work })
    const { json } = probe(work)
    expect(json.ready).toBe(false)
    expect(json.reasons.join(' ')).toMatch(/NEM ELERHETO/)
    expect(json.reasons.join(' ')).not.toMatch(/nem letezik/)
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
    for (const a of ['kesz', 'ag-nincs-a-tavolin', 'nincs-tavoli-ref'] as Allapot[]) {
      expect(probe(fixture(a)).status, a).toBe(0)
    }
  })
})
