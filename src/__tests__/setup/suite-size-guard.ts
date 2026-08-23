import type { Reporter } from 'vitest/reporters'
import type { File, Task } from 'vitest'

/**
 * ALAPVONAL-OR A LEFUTOTT TESZTEK SZAMARA (kartya 30e04d76).
 *
 * A LELET, AMIERT LETEZIK (2026-08-23). Egy koron ket teszt-fajl BE SEM
 * TOLTODOTT (kor-import), tehat 97 teszt nem futott le. A vitest osszegzo sora
 * erre ezt irta:
 *
 *     Tests  3778 passed (3778)
 *
 * Nulla bukas -- ES A NEVEZO IS 3778. Aki a `Tests` sort nezi, teljes zoldet
 * lat. A hianyt csak a `Test Files` sor es a kilepesi kod arulja el.
 *
 * Ez nem hamis pozitiv es nem hamis negativ: ez egy meres, ami ELVESZTETTE A
 * NEVEZOJET, es nem szol rola. A "3778-bol 3778" pontosan olyan meggyozo, mint
 * a "3875-bol 3875", es senki nem tudja fejbol, melyik a helyes.
 *
 * KET FUGGETLEN ELLENORZES VAN ITT, MERT KET KULONBOZO ALAK LETEZIK, ES
 * EGYIK SEM FEDI A MASIKAT:
 *
 *   (A) PONTOS: egy fajl, ami NULLA tesztet adott. Ez a collect-idoben elszallt
 *       fajl ujjlenyomata. MERVE 2026-08-23: egy szandekosan hibas fajl a
 *       riporterhez `tasks: []` es `result.state === 'fail'` alakban jut el,
 *       tehat a fajl BENNE MARAD a listaban, csak nem ad tesztet. Ezert NEM
 *       eleg a fajlok szamat nezni: a mai eseten a 285-os fajlszam sem esett.
 *       Ez az ellenorzes MERETTOL FUGGETLEN -- egy negyven tesztes fajl kiesese
 *       ugyanugy megfogja, mint egy szazasé.
 *
 *   (B) ALAPVONAL: a lefutott tesztek szama nem eshet egy also korlat ala. Ez a
 *       MASIK alakot fogja meg: a torolt, atnevezett vagy az `include` mintabol
 *       kiesett fajlt, ami egyaltalan NEM jelenik meg a listaban -- tehat nincs
 *       nulla-tesztes ujjlenyomata, es a futas rc=0-val, teljesen zolden er
 *       veget. Ez a CSENDES eset, es csak ez az ellenorzes latja.
 *
 * MIERT ALSO KORLAT ES NEM PONTOS EGYEZES. Egy pontos szam minden UJ teszttol
 * elbukna, es az a legrosszabb fajta or: a helyes valtozast bunteti, tehat
 * megtanitja az olvasot, hogy a jelzese zaj. Nonie szabad; a szam CSOKKENESE a
 * jelentendo esemeny. Ugyanaz a szetvalasztas, mint a skill-meret-ornel.
 *
 * A TURESHATAR ES A HATARA, KIMONDVA. A 2% (de legalabb 5 teszt) elnyeli a
 * normalis apalyt. A mai megfigyelt kieses 97 teszt volt -- a (B) ag megfogta
 * volna. EGY KISEBB KIESEST A (B) NEM FOG MEG, es pontosan ezert van (A).
 *
 * ES EGY PLAFON IS, MERT A SZAZALEK NOTT VOLNA A KESZLETTEL (didi lelete,
 * 2026-08-23). Plafon nelkul a tureshatar egyutt no azzal, amit ellenoriz: ma
 * 78 teszt, egy ~4850-es keszletnel viszont mar 97 -- vagyis EPP AZ AZ ESET
 * menne at, amelyik ezt a kartyat szulte. Egy or, ami annal engedekenyebb,
 * minel nagyobb a vedendo felulet, rossz iranyba skalazodik.
 *
 * ES A MASIK AG NEM FEDI LE EZT A RESET: egy TOROLT fajl meg sem jelenik a
 * lista'ban, tehat az (A) agnak nincs mit latnia. Didi megmerte: 287 -> 286 ->
 * 285 -> 284 fajl, es egyszer sem szolalt meg semmi. A "tureshatar alatti
 * torles" pontosan a ket ag KOZOTT esik -- ezert kell a plafon.
 *
 * A PLAFON 10, ES A SZAM MOSTANTOL MERESEN ALL (didi, 2026-08-23). Elobb 50
 * volt, kimondottan INTERIM-kent, a merest megnevezve, ami eldontene. Didi
 * elvegezte: 200 commit atnezve, teszt-fajlt TOROLO commit NULLA, netto
 * csokkenes NULLA. Vagyis nem "keves" a legitim lefele mozgas ebben a repoban,
 * hanem NINCS.
 *
 * Ez atforditja, hogy MIT nyel el a tolerancia. Nem zajt -- olyan nincs --,
 * hanem azt, hogy valaki elfelejtette frissiteni az alapvonalat. Az fegyelem
 * kerdese, es a fegyelem nem megoldas: ezert megy a szam 50-rol 10-re, es ezert
 * van ra kulon kartya (c0f10926), hogy az alapvonal frissitese EGY PARANCS
 * legyen. Ha az megvan, ez a szam 0-ra mehet.
 *
 * A PLAFON MA 0, ES EZ A HARMADIK, VEGSO ALLAPOT. A ket korabbi szam (50, majd
 * 10) mindketto ITELET volt, es mindketto MEGNEVEZTE a merest, ami eldontene --
 * eloszor "van-e legitim lefele mozgas", aztan "valtozik-e a szamolt osszeg
 * skip/todo-tol". Didi mindkettot elvegezte, es MINDKETTO NEM lett:
 *
 *   200 commit atnezve  ->  teszt-fajlt TOROLO commit 0, netto csokkenes 0
 *   11 tortenelmi pont (08-01 -> 08-23) -> a gyujtott szam SZIGORUAN MONOTON no,
 *   11/11. Ket fuggetlen modszer, kulonbozo vak foltokkal, ugyanaz az eredmeny.
 *
 *   ES A SKIP/TODO KERDES, sajat proba-riporterrel a VALODI riporter-fabol
 *   kiiratva (nem a countTests forrasat olvasva -- az csak a SZANDEKOT mondja meg),
 *   ugyanazon az 5 tesztes fajlon, negy valtozatban:
 *       it.skip | it.todo | describe.skip | skipIf/runIf   ->  MINDEGYIK 5-ot ad
 *   A task `type === 'test'`-kent bent marad, csak a `mode` valtozik, es a
 *   `countTests` a `mode`-ot nem nezi. Ujramerve itt: 5 taskbol skip 3, todo 1,
 *   tenylegesen futott 1.
 *
 * Vagyis a tureshatarnak NINCS MIT FEDNIE. Ami maradt volna, az nem ingadozas,
 * hanem az, hogy valaki elfelejtette frissiteni az alapvonalat -- es arra
 * `npm run test:baseline` van (kartya c0f10926), nem tolerancia.
 *
 * AKI EZT A SZAMOT MEGINT MEG AKARJA EMELNI: nevezze meg a MERHETO okot, ahogy
 * a ket elozo szam is tette, es merje meg. Egy szam, ami mogott nincs meres,
 * csak annyit ved, hogy ne kelljen a parancsot lefuttatni.
 */

// === SUITE-BASELINE:BEGIN ===
// EZT A BLOKKOT A `npm run test:baseline` GENERALJA. Ne ird at kezzel.
//
// MIERT GENERALT, ES MIERT EGY BLOKKBAN A SZAM ES A LEIRASA (kartya c0f10926):
// amig kezi volt, a doc-komment szama es a konstans KULON tudott elavulni. Ma
// meg is tortent egy szomszedos helyen: ket hatar-teszt beirt 78-cal dolgozott,
// es a plafon bevezetesevel csendben elavult volna -- epp azok hazudtak volna
// elsonek, amik a hatart orzik. Ha a szam es a mondat egy generalt blokkban all,
// nem tudnak szetcsuszni.
/** Merve 2026. 08. 23. 10:27:55 CEST -- `npx vitest list --json` -> 289 fajl / 3929 teszt. */
export const SUITE_BASELINE_FILES = 289
export const SUITE_BASELINE_TESTS = 3929
// === SUITE-BASELINE:END ===

/**
 * Az alapvonal env-bol felulirhato -- NEM kenyelembol, hanem mert kulonben az
 * or maga nem lenne tesztelheto ismert allapotokon.
 */
function num(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * A tureshatar felso korlatja. 0 = nincs tures: a keszlet NEM zsugorodhat.
 * A `Math.max(5, ...)` also ag igy hatastalan marad -- szandekosan ott hagyva,
 * hogy egy jovobeli nem-nulla plafon eseten ujra ertelmet nyerjen.
 */
export const TOLERANCE_CAP = 0

export function floorFor(baseline: number): number {
  return baseline - Math.min(TOLERANCE_CAP, Math.max(5, Math.ceil(baseline * 0.02)))
}

/**
 * IGAZ, HA A FUTAS RESZHALMAZ VOLT -- ilyenkor a (B) ALAPVONAL-ag HALLGAT.
 *
 * EZ A LEGFONTOSABB RESZE, ES NELKULE AZ OR KAROS LENNE. Egy celzott futas
 * (`npx vitest run src/__tests__/valami.test.ts`) TERMESZETESEN kevesebb tesztet
 * futtat, es az a HELYES hasznalat. Egy or, ami ezt bukasnak jelenti, pontosan
 * azt a hibat koveti el, amit a repo mashol mar kimondott: a helyes megoldast
 * jeloli hibanak, es ezzel megtanitja, hogy ki kell kapcsolni.
 *
 * Az (A) NULLA-TESZTES ag viszont reszhalmazon IS fut: egy collect-hiba akkor is
 * collect-hiba, ha egyetlen fajtot kertel, es nem fugg az alapvonaltol.
 */
export function isFilteredRun(argv: readonly string[]): boolean {
  const runAt = argv.indexOf('run')
  if (runAt === -1) return false
  const after = argv.slice(runAt + 1)
  for (let i = 0; i < after.length; i++) {
    const a = after[i]!
    if (a.startsWith('-')) {
      // `--flag=value` onmagaban all; `--flag value` elviszi a kovetkezo szot,
      // kulonben az ertek szuronek latszana.
      if (!a.includes('=') && after[i + 1] !== undefined && !after[i + 1]!.startsWith('-')) i++
      continue
    }
    return true
  }
  return false
}

/**
 * A GYUJTOTT tesztek szama -- NEM az, ahany lefutott.
 *
 * DIDI LELETE (2026-08-23), es cimke-hiba, nem kuszob-hiba: az or uzenete
 * korabban azt allitotta, hogy ennyi teszt "lefutott". A `mode`-ot viszont sem ez
 * a fuggveny, sem a (B) ag nem nezi -- egy `describe.skip` egy TELJES fajlon
 * valtozatlanul hagyja a szamot, a `zeroTestFiles` ures marad, tehat MINDKET ag
 * hallgat. Vagyis egy fajl, aminek egyetlen tesztje sem futott, atment, mikozben
 * az uzenet azt mondta rola, hogy lefutott.
 *
 * A JAVITAS A NEV, NEM EGY UJ KUSZOB. Egy "skipelt <= X" hatar kezi
 * kivetel-listat kivanna, es egy kezi kivetel-lista TARTALMAT semmi nem meri --
 * ugyanaz a csapda, mint amit ez az or maga javit.
 */
export function countTests(tasks: readonly Task[]): number {
  let n = 0
  for (const t of tasks) {
    if (t.type === 'test') n++
    else if ('tasks' in t && Array.isArray(t.tasks)) n += countTests(t.tasks as Task[])
  }
  return n
}

/**
 * Azok a tesztek, amik TENYLEGESEN lefutottak (van eredmeny-allapotuk).
 * A `skip` es a `todo` `result` nelkul marad -- megmerve a valodi riporter-faban.
 */
export function countRanTests(tasks: readonly Task[]): number {
  let n = 0
  for (const t of tasks) {
    if (t.type === 'test') {
      const st = (t as { result?: { state?: string } }).result?.state
      if (st === 'pass' || st === 'fail') n++
    } else if ('tasks' in t && Array.isArray(t.tasks)) {
      n += countRanTests(t.tasks as Task[])
    }
  }
  return n
}

/** (A) Azok a fajlok, amik EGYETLEN tesztet sem adtak. */
export function zeroTestFiles(files: readonly { name: string; tasks?: Task[] }[]): string[] {
  return files.filter((f) => countTests(f.tasks ?? []) === 0).map((f) => f.name)
}

/** (B) A ket szam es a dontes, kulonvalasztva a riportertol, hogy tesztelheto legyen. */
export function evaluateSuiteSize(
  files: number,
  tests: number,
  baselineFiles = SUITE_BASELINE_FILES,
  baselineTests = SUITE_BASELINE_TESTS,
  ran?: number,
): { ok: boolean; message: string | null } {
  const fileFloor = floorFor(baselineFiles)
  const testFloor = floorFor(baselineTests)
  if (files >= fileFloor && tests >= testFloor) return { ok: true, message: null }
  return {
    ok: false,
    message:
      '\nSUITE-MERET OR: A KESZLET OSSZEZSUGORODOTT.\n' +
      `  gyujtott:  ${files} fajl / ${tests} teszt\n` +
      (ran !== undefined && ran !== tests
        ? `  ebbol FUTOTT: ${ran} -- ${tests - ran} teszt kihagyva (skip/todo)\n`
        : '') +
      `  alapvonal: ${baselineFiles} fajl / ${baselineTests} teszt (also korlat ${fileFloor} / ${testFloor})\n` +
      '\n' +
      '  A ZOLD OSSZEGZO SOR EZT NEM MONDJA MEG. Egy be nem toltodott vagy eltunt\n' +
      '  fajl utan a "Tests N passed (N)" ugyanugy nez ki, csak kisebb N-nel --\n' +
      '  a nevezo onmagat igazolja. Ezert all itt ez az or.\n' +
      '\n' +
      '  MIT NEZZ MEG ELOSZOR: a "Test Files" sort. Ha ott "failed" all, egy fajl\n' +
      '  COLLECT-idoben szallt el (tipikusan kor-import), es a tesztjei el sem indultak.\n' +
      '\n' +
      '  HA A CSOKKENES SZANDEKOS (tesztet toroltel), az alapvonalat frissitsd a\n' +
      '  src/__tests__/setup/suite-size-guard.ts-ben, UGYANABBAN a commitban.\n',
  }
}

export function zeroTestMessage(names: readonly string[]): string {
  return (
    '\nSUITE-MERET OR: VAN FAJL, AMI EGYETLEN TESZTET SEM ADOTT.\n' +
    names.map((n) => `  - ${n}\n`).join('') +
    '\n' +
    '  Egy collect-idoben elszallo fajl PONTOSAN igy nez ki: benne marad a\n' +
    '  fajl-listaban, de nulla tesztet ad -- tehat a "Test Files" szam SEM esik,\n' +
    '  es a "Tests" sor egyszeruen kisebb lesz, zolden.\n' +
    '\n' +
    '  Ha a fajl szandekosan ures (meg nincs benne teszt), tegyel bele egyet,\n' +
    '  vagy toröld -- egy teszt-fajl teszt nelkul csak a szamot hizlalja.\n'
  )
}

/**
 * A vitest a riportert OSZTALYKENT varja (`new CustomReporter()`), nem
 * objektumkent -- egy objektum-literal `CustomReporter is not a constructor`
 * INDITASI hibat ad, es a keszlet el sem indul. (Merve, 2026-08-23.)
 */
export default class SuiteSizeGuard implements Reporter {
  onFinished(files?: File[]): void {
    if (!files) return
    if (process.env['SUITE_SIZE_GUARD'] === 'off') return

    // (A) merettol fuggetlen, reszhalmazon is fut
    const zeros = zeroTestFiles(files as unknown as { name: string; tasks?: Task[] }[])
    if (zeros.length > 0) {
      process.stderr.write(zeroTestMessage(zeros))
      process.exitCode = 1
    }

    // (B) alapvonal -- csak teljes futason ertelmes
    if (isFilteredRun(process.argv)) return
    const collected = countTests(files as unknown as Task[])
    const ran = countRanTests(files as unknown as Task[])
    // CIMKE, NEM KUSZOB: ha egy EGESZ fajl kihagyott, azt kimondjuk -- de nem
    // buktatjuk el tole a futast. Egy hatar kezi kivetel-listat kivanna.
    const allSkipped = (files as unknown as { name: string; tasks?: Task[] }[])
      .filter(f => countTests(f.tasks ?? []) > 0 && countRanTests(f.tasks ?? []) === 0)
      .map(f => f.name)
    if (allSkipped.length > 0) {
      process.stderr.write(
        `\nSUITE-MERET OR (megjegyzes, NEM hiba): ${allSkipped.length} fajl minden tesztje kihagyva.\n` +
        allSkipped.map(n => `  - ${n}\n`).join('') +
        '  A darabszam ezeket GYUJTOTTKENT szamolja, tehat az alapvonal nem esik toluk.\n')
    }
    const res = evaluateSuiteSize(
      files.length,
      collected,
      num('SUITE_BASELINE_FILES', SUITE_BASELINE_FILES),
      num('SUITE_BASELINE_TESTS', SUITE_BASELINE_TESTS),
      ran,
    )
    if (!res.ok) {
      process.stderr.write(res.message ?? '')
      process.exitCode = 1
    }
  }
}
