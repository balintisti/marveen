import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
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
  /**
   * The OTHER way code can be missing: present here and on no remote at all.
   * Deliberately a separate field rather than another `status` value -- both
   * can be true at once, and folding them into one enum would force a choice
   * between two facts that need two different actions.
   */
  localOnly?: LocalOnlyState
  /**
   * WHICH COMMIT the running build was made from -- a different question from
   * the mtime comparison above, and the one the deploy runbook actually asks.
   * Separate field for the same reason localOnly is: both can be true at once
   * (a build can be current AND its marker unbelievable, which is exactly what
   * happened on 2026-08-28).
   */
  builtCommit?: BuiltCommitState
}

/** What the `.built-commit` marker claims, and whether it may be believed.
 *
 *  THE MARKER IS A HAND-WRITTEN FILE. The deploy runbook says
 *  `npm run build && git rev-parse HEAD > dist/.built-commit`, and on
 *  2026-08-28 the second half was skipped: the build ran at 23:18 and the
 *  marker went on saying `31f06313`, two days old. Two agents read it, both
 *  concluded the work was not deployed, and agreed with each other -- the
 *  artefact they trusted was the one lying.
 *
 *  A MISSING marker is conspicuous. A STALE one is indistinguishable from a
 *  true "you are two days behind", which is why this returns NO COMMIT rather
 *  than a warning beside one: tonight the failure was a confident, dated,
 *  plausible wrong answer, and a caveat next to a concrete-looking hash reads
 *  as noise. Refusing to answer is the only form that cannot be skimmed past.
 */
export type BuiltCommitStatus = 'known' | 'contradicted' | 'unknown'

export interface BuiltCommitState {
  /** The commit the build was made from -- null unless it can be believed. */
  commit: string | null
  status: BuiltCommitStatus
  /** When the marker was written, ms. Null when unknown. */
  markerAt: number | null
  detail: string
}

/** How far the marker may lag the newest built file before it is disbelieved.
 *
 *  The build writes the marker AFTER tsc, so in the healthy case the marker is
 *  the NEWER of the two and this margin is never reached. It exists for clock
 *  skew and for a slow last write, not as a tolerance for staleness: the case
 *  this guard is for was 34 hours out, four orders of magnitude past it.
 *  CHOSEN, not measured -- there is no measurement of write skew here, and
 *  saying so is cheaper than implying one. */
export const MARKER_LAG_TOLERANCE_MS = 5 * 60 * 1000

/** Pure: no filesystem, no clock. */
export function judgeBuiltCommit(input: {
  markerCommit: string | null
  markerAt: number | null
  builtAt: number | null
}): BuiltCommitState {
  const { markerCommit, markerAt, builtAt } = input

  if (!markerCommit) {
    return {
      commit: null,
      status: 'unknown',
      markerAt,
      detail: 'Nincs olvashato build-marker (dist/.built-commit). '
        + 'Ez NEM azt jelenti, hogy a build naprakesz.',
    }
  }
  if (markerAt === null || builtAt === null) {
    return {
      commit: null,
      status: 'unknown',
      markerAt,
      detail: 'A build-marker megvan, de nem osszevetheto a dist/ koraval, '
        + 'tehat nem tudni, ehhez a buildhez tartozik-e. Ez NEM azt jelenti, hogy igen.',
    }
  }
  if (builtAt - markerAt > MARKER_LAG_TOLERANCE_MS) {
    return {
      commit: null,
      status: 'contradicted',
      markerAt,
      detail: 'A build-marker REGEBBI, mint a legfrissebb lefordított fajl, tehat nem '
        + 'ehhez a buildhez tartozik. A commitot NEM adom vissza: egy elavult hash '
        + 'megkulonboztethetetlen egy valodi lemaradastol. Kell: npm run build (ez maga '
        + 'irja a markert), vagy dist/.built-commit torlese.',
    }
  }
  return {
    commit: markerCommit,
    status: 'known',
    markerAt,
    detail: `A futo build ebbol a commitbol keszult: ${markerCommit}.`,
  }
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
 * THE SECOND QUESTION, AND IT IS NOT THE SAME ONE -- card b807c756.
 *
 * `judgeBuildFreshness` above compares the RUNNING PROCESS with the LOCAL
 * SOURCE. That is one way for code to be missing, and on 2026-08-20 it was
 * true. So was another one, and the first check cannot see it:
 *
 *   the running copy is old        -> rebuild, and the feature is alive.
 *   the feature exists ONLY HERE   -> a rebuild changes nothing anywhere else.
 *                                     A fresh install, an `update.sh` pull, or
 *                                     any other machine would not have it AT
 *                                     ALL.
 *
 * The measured case: the back-pressure signal lived in two commits that no
 * remote branch contained. Compared against the local source, the build check
 * would have answered `current` -- and been RIGHT. The question was simply a
 * different one, and the same symptom ("it does not work") had two causes with
 * two unrelated remedies.
 *
 * `HEAD --not --remotes` rather than `@{u}..`: a branch that was never pushed
 * has no upstream at all, and that is precisely the case being looked for, so
 * a check that needs one would fail on exactly the branches it must catch.
 *
 * IT CAN ONLY OVERSTATE, NEVER UNDERSTATE, and the difference is worth saying
 * out loud. Remote-tracking refs are as fresh as the last fetch, so a commit
 * pushed from elsewhere may still count as local here. The number is therefore
 * an upper bound: "at most this many are only here". It cannot miss one that
 * really is unpushed, which is the direction that would matter.
 */
export interface LocalOnlyState {
  /** Commits on this branch that no remote-tracking ref contains. Null = could not tell. */
  commits: number | null
  branch: string | null
  /** When the remote refs were last refreshed, ms. Null when unknown. */
  fetchedAt: number | null
  /** One line for a human, or null when there is nothing worth saying. */
  detail: string | null
}

/** How stale the remote refs may be before the count needs a caveat. */
const FETCH_CAVEAT_MS = 24 * 60 * 60 * 1000

export function judgeLocalOnly(input: {
  commits: number | null
  branch: string | null
  fetchedAt: number | null
  now: number
}): LocalOnlyState {
  const { commits, branch, fetchedAt, now } = input
  const base = { commits, branch, fetchedAt }

  if (commits === null) {
    // NOT silence, and NOT a comfortable default. The neighbouring git helpers
    // in this codebase fall back to "main" on failure; here a guess would say
    // "everything is pushed", which is the claim we do not have.
    return {
      ...base,
      detail: 'Nem tudni, hogy a helyi commitok fent vannak-e barmelyik tavoli agon. '
        + 'Ez NEM azt jelenti, hogy fent vannak.',
    }
  }

  if (commits === 0) return { ...base, detail: null }

  const where = branch ? ` a(z) ${branch} agon` : ''
  const stale = fetchedAt === null || now - fetchedAt > FETCH_CAVEAT_MS
    ? ' (a tavoli referenciak regen frissultek, tehat ez a szam felfele torzithat -- lefele nem)'
    : ''
  return {
    ...base,
    detail: `${commits} commit${where} EGYETLEN tavoli agon sincs fent${stale}. `
      + 'Ujraepites ezen NEM segit: egy uj telepites vagy egy update.sh utani allapot '
      + 'ezt a kodot egyaltalan nem tartalmazna.',
  }
}

/** Ask git. Every failure answers "could not tell", never "all clear". */
export function readLocalOnly(now: number = Date.now()): LocalOnlyState {
  const git = (args: string[]): string | null => {
    try {
      return execFileSync('/usr/bin/git', args, {
        cwd: PROJECT_ROOT, timeout: 5000, encoding: 'utf-8',
      }).trim()
    } catch {
      return null
    }
  }

  const branchRaw = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : null
  const countRaw = git(['rev-list', '--count', 'HEAD', '--not', '--remotes'])
  const parsed = countRaw === null ? NaN : Number.parseInt(countRaw, 10)

  let fetchedAt: number | null = null
  try {
    fetchedAt = statSync(join(PROJECT_ROOT, '.git', 'FETCH_HEAD')).mtimeMs
  } catch { /* never fetched, or not a work tree */ }

  return judgeLocalOnly({
    commits: Number.isFinite(parsed) ? parsed : null,
    branch,
    fetchedAt,
    now,
  })
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
  cached = {
    at: now,
    value: {
      ...value,
      localOnly: readLocalOnly(now),
      builtCommit: judgeBuiltCommit({ ...readBuiltCommitMarker(), builtAt }),
    },
  }
  return cached.value
}

/** The marker file and when it was written. Both null when it is not there or
 *  cannot be read -- which the judge reports as `unknown`, never as fresh. */
function readBuiltCommitMarker(): { markerCommit: string | null; markerAt: number | null } {
  const path = join(PROJECT_ROOT, 'dist', '.built-commit')
  try {
    const commit = readFileSync(path, 'utf8').trim()
    // An empty or malformed file is NOT a commit. Returning it would put a
    // blank where a hash belongs and let a reader fill the blank themselves.
    if (!/^[0-9a-f]{7,40}$/.test(commit)) return { markerCommit: null, markerAt: null }
    return { markerCommit: commit, markerAt: statSync(path).mtimeMs }
  } catch {
    return { markerCommit: null, markerAt: null }
  }
}

/** Test seam: the cache must not carry one case's answer into the next. */
export function resetBuildFreshnessCache(): void {
  cached = null
}
