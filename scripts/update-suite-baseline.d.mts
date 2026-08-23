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

export function decide(
  rc: number,
  counts: SuiteCounts | null,
): { write: boolean; reason: string | null }

export function renderBlock(counts: SuiteCounts, stamp: string): string

export function replaceBlock(source: string, block: string): string
