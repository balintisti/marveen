import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkUpdatePreflight, type GitRunner } from '../update-preflight.js'

// Kartya bae4df49. Az ahead-kapu azt hivatott megfogni, hogy egy DIVERGALT
// checkoutot ne probaljunk `--ff-only`-val frissiteni. A regi alak:
//     AHEAD=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)
// Ha a szamlalas BUKOTT -- mert az agnak nincs upstreamje --, abbol NULLA lett,
// es a kapu ATENGEDETT. Megmerve ezen a gepen: 130 helyi commit, a kapu szerint 0.
//
// A hiba iranya allando: a "nem tudom megmerni" MINDIG a megnyugtato ertekke
// valt. Es nem okozott kart, mert egy MASIK ellenorzes (az ag nincs az originon)
// elobb elutasitott -- ket hiba fedte egymast, tehat a masik javitasa FELFEDTE
// volna ezt. Ezert kellett ezt eloszor javitani.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('checkUpdatePreflight -- a "nem merheto" nem nulla', () => {
  const git = (ahead: number | null): GitRunner => ({
    currentBranch: () => 'main',
    porcelainStatus: () => '',
    aheadCount: () => ahead,
  })

  it('NEM MERHETO (null) -> elutasit, sajat okkal', () => {
    const r = checkUpdatePreflight(git(null))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe('ahead-unmeasurable')
    // A uzenet mondja meg a KIJARATOT is, ne csak a hibat.
    expect(r.ok === false && r.message).toContain('--set-upstream-to')
  })

  it('NULLA (mert) -> atengedi, mert ez valodi meres', () => {
    // A ket eset megkulonboztetese az EGESZ javitas: 0 es null korabban
    // ugyanaz volt.
    expect(checkUpdatePreflight(git(0)).ok).toBe(true)
  })

  it('POZITIV (mert) -> elutasit, a regi okkal', () => {
    const r = checkUpdatePreflight(git(7))
    expect(r.ok === false && r.reason).toBe('local-commits')
    expect(r.ok === false && r.reason === 'local-commits' && r.ahead).toBe(7)
  })
})

/**
 * A SZKRIPT MAGA, HALOZAT NELKUL -- eldobhato git-topologian.
 *
 * Ez az az alak, amit a frissitesi ut felmereseben javasoltam: egy csupasz
 * "origin" repo es egy klon egy temp konyvtarban, es a VALODI `update.sh`
 * futtatasa. A tiszta fuggveny fenti tesztje a DONTEST meri; ez azt meri, hogy
 * a dontes tenyleg a szkriptben van. A ketto nem helyettesiti egymast: a regi
 * hiba EPP a szkript egyik soraban ult, nem a logikaban.
 *
 * A kapu ELOTT csak git-olvasas es egy auto-stash fut, tehat egy eldobhato
 * repoban semmi elesre nem hat.
 */
function fixture(withUpstream: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'updgate-'))
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
  sh(work, 'add', '.'); sh(work, 'commit', '-m', 'init')
  sh(work, 'push', 'origin', 'main')
  if (!withUpstream) {
    // Az ag LETEZIK az originon (tehat a korabbi ellenorzes atengedi), de a
    // helyi ag NEM KOVETI -- pontosan a mert eles allapot.
    sh(work, 'branch', '--unset-upstream')
  }
  mkdirSync(join(work, 'store'), { recursive: true })
  copyFileSync(join(ROOT, 'update.sh'), join(work, 'update.sh'))
  // Az update.sh forrasolja ezt (19. sor); nelkule mar a nyelvi blokknal elhal,
  // es a teszt "elutasitott"-nak latna egy teljesen mas hibat.
  copyFileSync(join(ROOT, 'install-lang.sh'), join(work, 'install-lang.sh'))
  return work
}

function runUpdate(work: string, env: Record<string, string> = {}): { status: number; out: string } {
  const r = spawnSync('bash', [join(work, 'update.sh')], {
    cwd: work, encoding: 'utf-8', timeout: 60_000,
    // A fixture tavolija `origin` (a `git clone` adja a nevet), az eles alapertelmezes
    // viszont `fork`. Enelkul a szkript MAR a "letezik-e az agon a tavolin" kapunal
    // elutasit, es a lenti allitasok egy MASIK hibat mernenek -- zolden.
    env: { ...process.env, MARVEEN_LANG: 'hu', UPDATE_REMOTE: 'origin', ...env },
  })
  return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('update.sh -- az ahead-kapu HANGOS, ha nem tud merni', () => {
  // EZ A TESZT MEGFORDULT, ES A MEGFORDULASA MAGA AZ EREDMENY (friday, 2026-08-28).
  //
  // Eredetileg azt allitotta, hogy upstream NELKUL a szkript ELUTASIT, es megnevezi az okot
  // ("nincs beallitott upstreamje"). Ez a `@{u}`-ra epulo alakra volt igaz. A kesobbi javitas
  // (`fix/bae4df49-update-remote`, 2bcb766 + 95b9268) a kapot ATTETTE arra a tavolira, amibol
  // a pull tenylegesen tortenik: `git fetch $UPDATE_REMOTE`, majd `FETCH_HEAD..HEAD`.
  // Vagyis az upstream HIANYA tobbe nem akadaly -- a kapu nem tole fugg.
  //
  // Ezt a KET agat kulon-kulon merve mindketto zold volt; egyutt merve derult ki, hogy az
  // egyik teszt a masik ag altal MEGSZUNTETETT viselkedest rogzitette. Ezert kell a
  // cel-allapotot EGY commiton merni (`koteg-celallapot-merese`).
  it('upstream NELKUL is TOVABBMEGY: a kapu a frissito tavolihoz mer, nem az `@{u}`-hoz', () => {
    const { out } = runUpdate(fixture(false))
    expect(out).not.toMatch(/nem merheto/)
    expect(out).not.toMatch(/nincs beallitott upstreamje/)
    // POZITIV KONTROLL: a szkript tenyleg eljutott a letoltesig, nem valami masba halt bele.
    expect(out).toMatch(/Letoltes \(origin\/main\)/)
  })

  it('a kapu MEGMARADT: ha az ag nincs meg a frissito tavolin, elutasit es MEGNEVEZI a tavolit', () => {
    // A szomszedos ellenorzes (`update.sh` :260) -- ez az, ami a divergalt/ismeretlen
    // allapotot ma megfogja. Az `UPDATE_REMOTE` alapertelmezese `fork`, es a fixture-ben
    // ilyen tavoli nincs.
    const { status, out } = runUpdate(fixture(true), { UPDATE_REMOTE: 'fork' })
    expect(status).not.toBe(0)
    expect(out).toMatch(/nem létezik a 'fork' távolin|does not exist on 'fork'/)
  })

  it('upstreammel is ugyanaz -- a ket eset kozott mar NINCS kulonbseg, es ez a javitas lenyege', () => {
    const { out } = runUpdate(fixture(true))
    expect(out).not.toMatch(/nem merheto/)
    expect(out).toMatch(/Letoltes \(origin\/main\)/)
  })
})
