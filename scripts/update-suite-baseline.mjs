#!/usr/bin/env node
/**
 * update-suite-baseline.mjs -- az alapvonal frissitese EGY PARANCCSAL (c0f10926).
 *
 * MIERT LETEZIK. A suite-meret or alapvonala eddig kezzel allt a forrasban, es a
 * tolerancia-szam nem legitim ingadozast nyelt el, hanem azt, hogy valaki
 * ELFELEJTETTE frissiteni. Didi merese: 200 commiton at NULLA teszt-fajlt torlo
 * commit es NULLA netto csokkenes -- vagyis legitim lefele mozgas nincs, csak
 * fegyelem-hiany. Isti szabalya szerint pedig ami azon all, hogy a felhasznalo
 * megjegyez valamit, az nem megoldas.
 *
 * A LEGVESZELYESEBB RESZ, ES EZERT AZ ELSO SZABALY: HA A SUITE NEM ZOLD, NEM
 * IRUNK ALAPVONALAT. Egy frissito, ami egy CSONKA futasbol ir szamot, csendben
 * ERVENYESNEK ROGZITI pontosan azt a vesztest, amit az or fogni hivatott -- az
 * rosszabb lenne a mai kezi allapotnal. Ezert a rc != 0 eset nem figyelmeztetes,
 * hanem megallas, nem-nulla kilepessel.
 *
 * Hasznalat:  npm run test:baseline
 * Szarazon:   npm run test:baseline -- --dry-run
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(ROOT, 'src', '__tests__', 'setup', 'suite-size-guard.ts')
const BEGIN = '// === SUITE-BASELINE:BEGIN ==='
const END = '// === SUITE-BASELINE:END ==='

/**
 * A DONTES, kulonvalasztva a futtatastol, hogy tesztelheto legyen.
 * Visszaad: { write, reason } -- `write:false` eseten a `reason` a megallas oka.
 */
export function decide(rc, counts) {
  if (rc !== 0) {
    return {
      write: false,
      reason:
        `A suite NEM zold (kilepesi kod ${rc}). NEM irok alapvonalat.\n` +
        '  Egy csonka futasbol irt alapvonal CSENDBEN ervenyesnek rogzitene azt a\n' +
        '  vesztest, amit az or fogni hivatott -- rosszabb, mint a kezi allapot.\n' +
        '  Eloszor javitsd a suite-ot, aztan futtasd ujra.',
    }
  }
  if (!counts || !Number.isInteger(counts.files) || !Number.isInteger(counts.tests)) {
    return { write: false, reason: 'A futas nem adott ertelmezheto darabszamot -- nem irok alapvonalat.' }
  }
  if (counts.files <= 0 || counts.tests <= 0) {
    // Nulla teszt "sikeres" futasnak latszhat (pl. egy elgepelt include minta),
    // es epp az a nema siker, ami ellen az or keszult.
    return { write: false, reason: `Nulla fajl vagy teszt (${counts.files}/${counts.tests}) -- ez nem alapvonal, ez uzemzavar.` }
  }
  return { write: true, reason: null }
}

/** A generalt blokk szovege. A szam ES a mondat EGYUTT keletkezik, hogy ne tudjanak szetcsuszni. */
export function renderBlock(counts, stamp) {
  return [
    BEGIN,
    '// EZT A BLOKKOT A `npm run test:baseline` GENERALJA. Ne ird at kezzel.',
    '//',
    '// MIERT GENERALT, ES MIERT EGY BLOKKBAN A SZAM ES A LEIRASA (kartya c0f10926):',
    '// amig kezi volt, a doc-komment szama es a konstans KULON tudott elavulni. Ma',
    '// meg is tortent egy szomszedos helyen: ket hatar-teszt beirt 78-cal dolgozott,',
    '// es a plafon bevezetesevel csendben elavult volna -- epp azok hazudtak volna',
    '// elsonek, amik a hatart orzik. Ha a szam es a mondat egy generalt blokkban all,',
    '// nem tudnak szetcsuszni.',
    `/** Merve ${stamp} -- \`npx vitest run\` -> ${counts.files} fajl / ${counts.tests} teszt. */`,
    `export const SUITE_BASELINE_FILES = ${counts.files}`,
    `export const SUITE_BASELINE_TESTS = ${counts.tests}`,
    END,
  ].join('\n')
}

export function replaceBlock(source, block) {
  const a = source.indexOf(BEGIN)
  const b = source.indexOf(END)
  if (a === -1 || b === -1 || b < a) {
    throw new Error(`A SUITE-BASELINE marker nem talalhato a ${TARGET} fajlban`)
  }
  return source.slice(0, a) + block + source.slice(b + END.length)
}

function main() {
  const dry = process.argv.includes('--dry-run')
  const dir = mkdtempSync(join(tmpdir(), 'suite-baseline-'))
  const emit = join(dir, 'counts.json')
  // A `SUITE_SIZE_GUARD=off` szandekos: az OR nem szolhat bele a sajat
  // alapvonalanak a felmeresebe. Egy regi, tul magas alapvonal kulonben
  // megakadalyozna, hogy valaha frissiteni lehessen -- az or befagyasztana
  // magat, es pontosan ez az a csapda-alak, amit mashol mar kimondtunk.
  const cmd = process.env['SUITE_BASELINE_CMD']
  const run = cmd
    ? spawnSync('bash', ['-lc', cmd], { cwd: ROOT, encoding: 'utf-8', stdio: 'inherit',
        env: { ...process.env, SUITE_BASELINE_EMIT: emit, SUITE_SIZE_GUARD: 'off' } })
    : spawnSync('npx', ['vitest', 'run', '--reporter=default',
        '--reporter=./src/__tests__/setup/baseline-emit.ts'],
        { cwd: ROOT, encoding: 'utf-8', stdio: 'inherit',
          env: { ...process.env, SUITE_BASELINE_EMIT: emit, SUITE_SIZE_GUARD: 'off' } })

  let counts = null
  try {
    if (existsSync(emit)) counts = JSON.parse(readFileSync(emit, 'utf-8'))
  } catch { counts = null }

  const rc = run.status === null ? 1 : run.status
  const verdict = decide(rc, counts)
  if (!verdict.write) {
    console.error(`\nALAPVONAL NEM FRISSULT.\n  ${verdict.reason}\n`)
    rmSync(dir, { recursive: true, force: true })
    process.exit(1)
  }

  const stamp = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', hour12: false })
  const src = readFileSync(TARGET, 'utf-8')
  const next = replaceBlock(src, renderBlock(counts, `${stamp} CEST`))
  if (dry) {
    console.log(`\n[--dry-run] uj alapvonal: ${counts.files} fajl / ${counts.tests} teszt (nem irtam)\n`)
  } else if (next === src) {
    console.log(`\nAz alapvonal valtozatlan: ${counts.files} fajl / ${counts.tests} teszt\n`)
  } else {
    writeFileSync(TARGET, next)
    console.log(`\nAlapvonal frissitve: ${counts.files} fajl / ${counts.tests} teszt\n`)
  }
  rmSync(dir, { recursive: true, force: true })
}

if (process.argv[1] && process.argv[1].endsWith('update-suite-baseline.mjs')) main()
