/**
 * Tipus-deklaracio az alapvonal-frissitohoz.
 *
 * A szkript szandekosan sima `.mjs`: a `npm run test:baseline` NYERS node-dal
 * fut, tehat nem fugghet a tsx-tol vagy egy build-lepestol -- egy eszkoz, ami
 * csak forditas utan hasznalhato, epp akkor nem all rendelkezesre, amikor a
 * suite el van romolva. A tesztek viszont TypeScriptbol importaljak, ezert kell
 * ez a fajl; nelkule a `tsc --noEmit` implicit `any`-t jelent.
 */
export interface SuiteCounts {
  files: number
  tests: number
}

/** A megtagadas MERT oka, vagy null, ha nem tudjuk. Lasd a `.mjs` docblockjat:
 *  a kiirt ok is allitas, es ket ismert esetben hamis volt (kartya e065cf1c).
 *
 *  EZ A LISTA A `.mjs` `diagnose()`-aval EGYUTT MOZOG, es 2026-09-04-en NEM mozgott:
 *  ket uj okot (`missing-deps`, `refusal-unknown`) es egy uj exportot (`refusalLines`)
 *  vittem be a `.mjs`-be anelkul, hogy ide hozzanyultam volna -- a torzs igy HAROM
 *  `tsc` hibaval allt. Ket peldany ugyanarrol a szerzodesrol, es csak az egyiket
 *  szerkesztettem. Ha ide uj ok kerul, a `.mjs`-ben is legyen, es forditva. */
export type FailureCause =
  | 'live-install'
  | 'node-abi'
  | 'capture-overflow'
  | 'missing-deps'
  | 'refusal-unknown'
  | null

/** A `spawnSync` eredmenye, amennyi a diagnozishoz kell. Azert ilyen szuk, hogy a
 *  teszt ne a teljes `SpawnSyncReturns`-t kelljen felepitse egy ket mezos esethez. */
export interface SpawnOutcome {
  status?: number | null
  signal?: string | null
  error?: { code?: string } | null
}

/** A `run` a MERT kilepesi allapot: enelkul a kaptura-tulcsordulas (ENOBUFS)
 *  megkulonboztethetetlen egy valodi gyujtesi hibatol, es 2026-08-29-ig annak is
 *  latszott. Opcionalis, hogy a regi hivok valtozatlanul mukodjenek. */
export function diagnose(output?: string, run?: SpawnOutcome | null): FailureCause

export function decide(
  rc: number,
  counts: SuiteCounts | null,
  cause?: FailureCause,
): { write: boolean; reason: string | null }

export function renderBlock(counts: SuiteCounts, stamp: string, how?: string): string

/** A megtagadas SAJAT sorai a vitest kimenetebol, DEDUPLIKALVA (a vitest
 *  workerenkent emeli -- merve hetszer). A wrapper eddig elnyelte a kimenetet,
 *  tehat a diagnozishoz kello egyetlen tenyt is megsemmisitette (kartya a9a6ef5d). */
export function refusalLines(output?: string): string[]

export function replaceBlock(source: string, block: string): string
