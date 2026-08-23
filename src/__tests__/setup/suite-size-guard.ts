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
 * normalis apalyt. A mai megfigyelt kieses 97 teszt volt, a kuszob 78 -- tehat
 * a (B) ag megfogta volna, de csak 19 teszt tartalekkal. EGY KISEBB KIESEST A
 * (B) NEM FOGNA MEG, es pontosan ezert van (A): az a merettol fuggetlen. A ket
 * ag egyutt ad fedezetet, kulon-kulon egyik sem.
 */

/** Merve 2026-08-23, a fix/0114968c agon: `npx vitest run` -> 287 fajl / 3899 teszt.
 *  (Az or sajat teszt-fajljaval egyutt -- az is a keszlet resze.) */
export const SUITE_BASELINE_FILES = 287
export const SUITE_BASELINE_TESTS = 3899

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

/** 2%, de legalabb 5 -- az also korlat, ami alatt riasztunk. */
export function floorFor(baseline: number): number {
  return baseline - Math.max(5, Math.ceil(baseline * 0.02))
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

export function countTests(tasks: readonly Task[]): number {
  let n = 0
  for (const t of tasks) {
    if (t.type === 'test') n++
    else if ('tasks' in t && Array.isArray(t.tasks)) n += countTests(t.tasks as Task[])
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
): { ok: boolean; message: string | null } {
  const fileFloor = floorFor(baselineFiles)
  const testFloor = floorFor(baselineTests)
  if (files >= fileFloor && tests >= testFloor) return { ok: true, message: null }
  return {
    ok: false,
    message:
      '\nSUITE-MERET OR: A KESZLET OSSZEZSUGORODOTT.\n' +
      `  lefutott:  ${files} fajl / ${tests} teszt\n` +
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
    const res = evaluateSuiteSize(
      files.length,
      countTests(files as unknown as Task[]),
      num('SUITE_BASELINE_FILES', SUITE_BASELINE_FILES),
      num('SUITE_BASELINE_TESTS', SUITE_BASELINE_TESTS),
    )
    if (!res.ok) {
      process.stderr.write(res.message ?? '')
      process.exitCode = 1
    }
  }
}
