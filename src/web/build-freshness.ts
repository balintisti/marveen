import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT } from '../config.js'

/**
 * IS THE CODE WE ARE READING THE CODE THAT IS RUNNING -- card b807c756.
 *
 * On 2026-08-20 three of us looked at the same source file and all three
 * believed it was running. It was not: the dashboard runs from `dist/`, that
 * build was four days old, and a fix written that morning had never executed
 * once. Nothing said so. There was no build timestamp, no version endpoint,
 * nothing anywhere that compared the two.
 *
 * The defect was never the missed build -- builds get missed. The defect is
 * that THE SOURCE WAS TAKEN AS EVIDENCE, and it is self-reinforcing: every
 * later fix stays invisible the same way until somebody happens to notice.
 *
 * TWO WAYS TO BE STALE, AND BOTH MUST BE NAMED, because covering only the
 * first leaves exactly half the trap open -- the half that springs on the
 * person who did remember to build:
 *
 *   stale-source   the source is newer than the build. Not compiled, so not
 *                  running. `npm run build` and then restart.
 *   stale-process  the build is newer than the running process. Compiled and
 *                  NOT restarted: the process loaded `dist/` once, at start,
 *                  and still holds the old code in memory. Restart only.
 *
 * ONE LINE, NOT ONE PER FILE. A stale build means hundreds of newer files, and
 * a hundred warnings is a wall people learn to scroll past. The newest source
 * file is named as an EXAMPLE, so the reader can tell at a glance whether the
 * difference is a real change or a stray `touch`.
 *
 * AND IT NEVER GOES QUIET WHEN IT CANNOT TELL. If `dist/` is missing or
 * unreadable the answer is `unknown` WITH a reason -- never `current`. That is
 * the whole lesson of the evening in one branch: a missing value that looks
 * exactly like a healthy one is worse than no check at all, because it also
 * ends the question.
 */

export type BuildFreshnessStatus = 'current' | 'stale-source' | 'stale-process' | 'unknown'

export interface BuildFreshness {
  status: BuildFreshnessStatus
  /** Newest mtime under `dist/`, ms. Null when it could not be read. */
  builtAt: number | null
  /** Newest mtime under `src/`, ms. Null when it could not be read. */
  sourceAt: number | null
  /** When the running process started, ms. */
  startedAt: number
  /** The newest source file, as ONE example of what is not compiled. */
  newestSourceFile: string | null
  /**
   * How many source files are newer than the build. The example alone was not
   * enough: the newest file here is often a test, and a reader who sees only
   * that concludes "just a test changed, ignore it". The count is what
   * separates a stray `touch` from four days of drift, and it is still one
   * line. Null when there is nothing to count against.
   */
  newerSourceCount: number | null
  /**
   * One sentence for a human, composed here so the wording lives in one place
   * rather than being reinvented by every reader of the status field.
   */
  detail: string
}

export interface BuildFreshnessInput {
  builtAt: number | null
  sourceAt: number | null
  newestSourceFile: string | null
  newerSourceCount?: number | null
  startedAt: number
}

/** Pure: no filesystem, no clock. Everything it judges is an argument. */
export function judgeBuildFreshness(input: BuildFreshnessInput): BuildFreshness {
  const { builtAt, sourceAt, newestSourceFile, startedAt } = input
  const newerSourceCount = input.newerSourceCount ?? null
  const base = { builtAt, sourceAt, startedAt, newestSourceFile, newerSourceCount }

  if (builtAt === null) {
    return {
      ...base,
      status: 'unknown',
      detail: 'Nem tudni, mikor keszult a futo build (a dist/ nem olvashato). '
        + 'Ez NEM azt jelenti, hogy naprakesz.',
    }
  }
  if (sourceAt === null) {
    return {
      ...base,
      status: 'unknown',
      detail: 'Nem tudni, mikor valtozott utoljara a forras (a src/ nem olvashato). '
        + 'Ez NEM azt jelenti, hogy naprakesz.',
    }
  }

  if (sourceAt > builtAt) {
    // One clause, assembled so it reads as a sentence in all three shapes --
    // count and example, example only, or neither.
    let middle = ''
    if (newerSourceCount !== null && newestSourceFile) {
      middle = ` ${newerSourceCount} fajl ujabb, a legfrissebb: ${newestSourceFile}.`
    } else if (newerSourceCount !== null) {
      middle = ` ${newerSourceCount} fajl ujabb.`
    } else if (newestSourceFile) {
      middle = ` A legfrissebb valtozas: ${newestSourceFile}.`
    }
    return {
      ...base,
      status: 'stale-source',
      detail: `A forras UJABB, mint a futo build.${middle}`
        + ' Amit a kodban olvasol, az NEM fut. Kell: npm run build, majd ujrainditas.',
    }
  }

  if (builtAt > startedAt) {
    return {
      ...base,
      status: 'stale-process',
      detail: 'A build UJABB, mint a futo folyamat: leforditottuk, de nem indult ujra, '
        + 'tehat a regi kod fut a memoriaban. Kell: ujrainditas.',
    }
  }

  return { ...base, status: 'current', detail: 'A futo folyamat a jelenlegi forrasbol keszult.' }
}

/**
 * The newest mtime under a directory, the file that carries it, and every
 * mtime seen -- so "how many are newer than X" costs no second walk.
 */
export function newestMtime(
  dir: string,
  keep: (name: string) => boolean = () => true,
): { at: number; file: string; all: number[] } | null {
  let best: { at: number; file: string } | null = null
  const all: number[] = []
  const walk = (abs: string, rel: string): void => {
    let entries: string[]
    try { entries = readdirSync(abs) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const childAbs = join(abs, name)
      const childRel = rel ? `${rel}/${name}` : name
      let st: ReturnType<typeof statSync>
      try { st = statSync(childAbs) } catch { continue }
      if (st.isDirectory()) { walk(childAbs, childRel); continue }
      if (!keep(name)) continue
      all.push(st.mtimeMs)
      if (!best || st.mtimeMs > best.at) best = { at: st.mtimeMs, file: childRel }
    }
  }
  walk(dir, '')
  // Re-annotated because `best` is only ever assigned inside the closure, and
  // the compiler narrows it to `null` here without the hint.
  const found = best as { at: number; file: string } | null
  return found ? { at: found.at, file: found.file, all } : null
}

// The scan walks a few hundred files, and the overview page polls. Recomputing
// per request would be pure waste; a minute of staleness in a staleness check
// costs nothing, because the thing it measures changes on the scale of builds.
const CACHE_TTL_MS = 60_000
let cached: { at: number; value: BuildFreshness } | null = null

export function getBuildFreshness(now: number = Date.now()): BuildFreshness {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value

  // `.ts` only: a stray `.map` or a copied asset under src/ is not something
  // anybody needs to recompile for.
  const src = newestMtime(join(PROJECT_ROOT, 'src'), n => n.endsWith('.ts'))
  const dist = newestMtime(join(PROJECT_ROOT, 'dist'), n => n.endsWith('.js'))

  const builtAt = dist?.at ?? null
  const value = judgeBuildFreshness({
    builtAt,
    sourceAt: src?.at ?? null,
    newestSourceFile: src ? `src/${src.file}` : null,
    newerSourceCount: src && builtAt !== null
      ? src.all.filter(t => t > builtAt).length
      : null,
    startedAt: now - Math.round(process.uptime() * 1000),
  })
  cached = { at: now, value }
  return value
}

/** Test seam: the cache must not carry one case's answer into the next. */
export function resetBuildFreshnessCache(): void {
  cached = null
}
