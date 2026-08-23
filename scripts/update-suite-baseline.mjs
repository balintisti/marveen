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
 * A LEGVESZELYESEBB RESZ, ES EZERT AZ ELSO SZABALY: HA A GYUJTES NEM TELJES, NEM
 * IRUNK ALAPVONALAT. Egy frissito, ami egy CSONKA gyujtesbol ir szamot, csendben
 * ERVENYESNEK ROGZITI pontosan azt a vesztest, amit az or fogni hivatott. Ezert a
 * nem-nulla kilepes nem figyelmeztetes, hanem MEGALLAS.
 *
 * A KIKOTES SZOVEGE 2026-08-23-AN PONTOSODOTT, ES SZIGORODOTT (marveen dontese).
 * Eredetileg ez allt: "ha a suite RC-je nem nulla (BUKAS vagy betoltesi hiba)".
 * Ez KET dolgot mosott ossze:
 *     BUKAS          -> a GYUJTOTT szamot NEM valtoztatja meg. Egy buko teszt
 *                       ugyanugy EGY teszt; a keszlet MERETE valtozatlan.
 *     BETOLTESI HIBA -> EZ valtoztatja meg, es EZ tartozik ide.
 * A regi szoveg tehat egy piros suite miatt is megtagadta a frissitest -- amire a
 * valasz az lett volna, hogy valaki KEZZEL irja at a szamot. Vagyis eppen azt a
 * kezi utat tartotta eletben, amit ez a kartya megszuntet. Az uj szoveg
 * SZIGORUBB, nem lazabb.
 *
 * EZERT A `vitest list` AZ ALAPERTELMEZES, ES NEM AZ IDO MIATT (13 vs 33 mp,
 * mellekes). A dontő az, hogy a `list` A KERDESRE valaszol -- HANY TESZT VAN --,
 * a `run` pedig egy MASIKRA is: ATMENNEK-E. A masodik valasz itt nem kell.
 * Egy eszkoz, ami tobbet mer a szuksegesnel, nem alaposabb: csak TOBB OKBOL TUD
 * ELBUKNI. Es a `list` epp a szamito hibara HANGOS: egy collect-hiban elhasal,
 * mig a teljes futasban az ilyen fajl `tasks: []`-szel BENN MARAD.
 *
 * UJRANYITASI FELTETEL, AMIT NEM MERTUNK MEG: ha talalunk olyan esetet, ahol a
 * GYUJTES teljes, de a FUTAS kevesebb tesztet lat (pl. egy worker osszeomlik
 * futas kozben), akkor a `list` a MAGASABB szamot adna. Ez a BIZTONSAGOS irany --
 * a kovetkezo valodi futas elbukna az oron, tehat zajt okoz, nem csendet --, de
 * NEM mertuk meg. Ha ilyen eset elojon, ez a valasztas ujragondolando.
 *
 * Hasznalat:  npm run test:baseline
 *             npm run test:baseline -- --full      # a teljes keszlet is lefut
 *             npm run test:baseline -- --dry-run
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
        `A GYUJTES NEM TELJES (kilepesi kod ${rc}). NEM irok alapvonalat.\n` +
        '  Egy csonka gyujtesbol irt alapvonal CSENDBEN ervenyesnek rogzitene azt a\n' +
        '  vesztest, amit az or fogni hivatott.\n' +
        '  FIGYELEM: ez NEM azt jelenti, hogy egy teszt BUKIK -- egy buko teszt\n' +
        '  ugyanugy egy GYUJTOTT teszt, es nem akadalya az alapvonalnak. Ez azt\n' +
        '  jelenti, hogy egy fajl BE SEM TOLTODOTT. Eloszor azt javitsd.',
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
export function renderBlock(counts, stamp, how = 'npx vitest run') {
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
    `/** Merve ${stamp} -- \`${how}\` -> ${counts.files} fajl / ${counts.tests} teszt. */`,
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
  // ALAPERTELMEZES A GYUJTES. A `--full` a regi, futtatasos ut -- akkor kell, ha
  // valaki egy lepesben akarja latni azt is, hogy a keszlet zold.
  const fast = !process.argv.includes('--full')
  const cmd = process.env['SUITE_BASELINE_CMD']
  const env = { ...process.env, SUITE_BASELINE_EMIT: emit, SUITE_SIZE_GUARD: 'off' }
  const opts = { cwd: ROOT, encoding: 'utf-8', env }

  let run, counts = null
  if (cmd) {
    run = spawnSync('bash', ['-lc', cmd], { ...opts, stdio: 'inherit' })
  } else if (fast) {
    // `vitest list --json` a GYUJTOTT teszteket sorolja fel (az `it.each` tablakat
    // kibontva), futtatas nelkul. A kimenetet nem a riporter adja, hanem mi
    // szamoljuk -- ezert itt nincs `stdio: inherit`.
    run = spawnSync('npx', ['vitest', 'list', '--json'], opts)
    if (run.status === 0) {
      try {
        const rows = JSON.parse(run.stdout || '[]')
        counts = { files: new Set(rows.map(r => r.file)).size, tests: rows.length }
      } catch { counts = null }
    }
  } else {
    run = spawnSync('npx', ['vitest', 'run', '--reporter=default',
      '--reporter=./src/__tests__/setup/baseline-emit.ts'], { ...opts, stdio: 'inherit' })
  }

  if (counts === null) {
    try {
      if (existsSync(emit)) counts = JSON.parse(readFileSync(emit, 'utf-8'))
    } catch { counts = null }
  }

  const rc = run.status === null ? 1 : run.status
  const verdict = decide(rc, counts)
  if (!verdict.write) {
    // DIDI FIGYELMEZTETESE, ES ITT SZAMIT A LEGTOBBET: node 26 alatt a `vitest
    // list` a nativ modulon ERR_DLOPEN_FAILED-del elhasal. Az a KORNYEZET hibaja,
    // nem a keszlete -- de a kimenete ugy nez ki, mintha a suite lenne rossz.
    const dlopen = /ERR_DLOPEN_FAILED|was compiled against a different Node/.test(
      `${run.stderr ?? ''}${run.stdout ?? ''}`)
    if (dlopen) {
      console.error('\nEZ A KORNYEZET HIBAJA, NEM A KESZLETE: a natív modul mas Node-verziora epult.')
      console.error('  Probald node 22-vel:  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"\n')
    }
    console.error(`\nALAPVONAL NEM FRISSULT.\n  ${verdict.reason}\n`)
    rmSync(dir, { recursive: true, force: true })
    process.exit(1)
  }

  const stamp = new Date().toLocaleString('hu-HU', { timeZone: 'Europe/Budapest', hour12: false })
  const src = readFileSync(TARGET, 'utf-8')
  // A MERES MODJA IS A BLOKKBA KERUL. Enelkul a `--fast` utan a komment azt
  // allitana, hogy `vitest run` merte -- vagyis a szam es a MONDATA csuszna szet,
  // pontosan az a hiba, ami ellen ez a generalt blokk keszult.
  const how = cmd ? 'SUITE_BASELINE_CMD' : fast ? 'npx vitest list --json' : 'npx vitest run'
  const next = replaceBlock(src, renderBlock(counts, `${stamp} CEST`, how))
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
