/**
 * A `scripts/__tests__/` ALATTI TESZTEKET SEMMI NEM FUTTATTA (kartya 4df370d9).
 *
 * Az `npm test` = `vitest run`, es a vitest alapertelmezett `include`-ja `.ts`/`.js`
 * fajlokra illeszkedik -- `.sh`-ra es `.py`-ra SOHA. Merve 2026-09-10, kontrollal:
 *
 *     npx vitest list scripts/__tests__/install-no-force-push-hook.test.sh  ->  SEMMI
 *     npx vitest list src/__tests__/decision-index.test.ts                  ->  tobb sor
 *
 * A kovetkezmeny nem elmeleti. A `seed-skills.test.sh` egy assertje **18 napja piros
 * volt minden fan** (a `213f8ad`, 2026-08-23 szandekosan kivette azt a mondatot, amit
 * az assert keresett), es senki nem latta. Ez pontosan az az alak, amit ez a repo
 * szabalykonyve rogzit: a kepesseg KESZ, es semmi nem hivja.
 *
 * MIERT EZ AZ ALAK, ES NEM FAJLONKENT EGY `.test.ts` BURKOLO. Volt mar ilyen
 * (`disk-guard-alert-delivery.test.ts`), es helyes volt a maga korében -- de az
 * PER-FELADAT javitas egy OSZTALY-szintu resre: minden UJ shell-teszt ujra
 * burkolatlanul erkezik, es minden meglevo burkolo ZOLD marad. Ezert ez a fajl
 * FELDERIT, nem felsorol. Egy uj `scripts/__tests__/valami.test.sh` a kovetkezo
 * `npm test`-ben mar fut, anelkul hogy barki emlekezne ra.
 *
 * ES A NEMA NULLA ELLEN KULON ALLITAS VAN. Ha a felderites elromlik (rossz konyvtar,
 * rossz minta), a fajl NULLA esetet futtatna es ZOLD lenne -- ugyanaz a "nema siker",
 * ami ellen az egesz kartya szol. Ezert allitjuk, hogy (a) talaltunk fajlt, es hogy
 * (b) MINDEN `.test.*` fajlnak van kezeloje: egy uj kiterjesztes (`.test.mjs`) HANGOSAN
 * bukik, nem csendben marad ki.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { discoverScriptTests } from './helpers/discover-script-tests.js'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const TESTS_DIR = join(REPO_ROOT, 'scripts', '__tests__')

const PER_TEST_TIMEOUT_MS = 200_000
const CONCURRENCY = 6

// Recursive, like the python runner (card 20258ef3): a test in a subdirectory must not drop out.
const allTestFiles = discoverScriptTests(TESTS_DIR)
const runnable = allTestFiles.filter((f) => /\.test\.(sh|py)$/.test(f))
const unhandled = allTestFiles.filter((f) => !/\.test\.(sh|py)$/.test(f))

// Card 33ff4ab1: upstream's script-tests-runner.test.ts already runs every TOP-LEVEL suite (flat
// readdirSync), so this file ran all 149 of them a second time in every full suite. Measured
// 2026-10-18: under that doubled load the offsite-encryption test (78 s alone) went past the cap
// here in 2 of 4 full runs, read as "rc=1" with a cut-off tail. This collector now runs only what
// the upstream one cannot see (a subdirectory); the guards below still read the whole set. If the
// upstream runner is gone, nothing is skipped; if its discovery changed, the guard test fails.
const UPSTREAM_RUNNER = join(HERE, 'script-tests-runner.test.ts')
const UPSTREAM_DISCOVERY = ['readdirSync(DIR)', '/\\.test\\.(sh|py)$/.test(f) || /-test\\.py$/.test(f)']
const upstreamSrc = existsSync(UPSTREAM_RUNNER) ? readFileSync(UPSTREAM_RUNNER, 'utf8') : null

function coveredUpstream(file: string): boolean {
  return !file.includes('/') && (/\.test\.(sh|py)$/.test(file) || /-test\.py$/.test(file))
}
function selectHere(files: string[], upstreamPresent: boolean): string[] {
  return upstreamPresent ? files.filter((f) => !coveredUpstream(f)) : files
}
const runHere = selectHere(runnable, upstreamSrc !== null)

type Result = { rc: number | null; out: string; killed: boolean; signal: string | null }
const results = new Map<string, Result>()

// A timeout kill must say so: it used to read as "rc=1" with the tail cut off mid-run.
function failureHead(file: string, r: Result): string {
  if (r.killed) return `${file} TIMEOUT: ${PER_TEST_TIMEOUT_MS / 1000} s utan megolve (${r.signal ?? 'jel nelkul'})`
  return `${file} rc=${r.rc}`
}

function runOne(file: string): Promise<Result> {
  const cmd = file.endsWith('.sh') ? 'bash' : 'python3'
  return new Promise((resolve) => {
    execFile(
      cmd,
      [join(TESTS_DIR, file)],
      { cwd: REPO_ROOT, timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`
        const e = err as (NodeJS.ErrnoException & { code?: number; killed?: boolean; signal?: string }) | null
        resolve({ rc: e ? (e.code ?? 1) : 0, out, killed: !!e?.killed, signal: e?.signal ?? null })
      },
    )
  })
}

beforeAll(async () => {
  const queue = [...runHere]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const file = queue.shift()
      if (!file) return
      results.set(file, await runOne(file))
    }
  })
  await Promise.all(workers)
  // The budget is the WHOLE queue's worst case, not one test's: every worker runs at most
  // ceil(n / CONCURRENCY) scripts, each capped by PER_TEST_TIMEOUT_MS. It used to be one
  // per-test cap + 60 s for the entire queue; measured 2026-10-01, the queue needed 227 s of
  // that 260 s on a quiet run, and 4 more ported upstream script tests tipped a full-suite run
  // over it -- the file then failed as a whole, with 150 tests skipped and no script named.
}, Math.ceil(runHere.length / CONCURRENCY) * PER_TEST_TIMEOUT_MS + 60_000)

describe('scripts/__tests__ -- a shell- es python-tesztek', () => {
  it('talalt futtathato teszt-fajlt (nema nulla ellen)', () => {
    expect(runnable.length).toBeGreaterThan(0)
  })

  it('MINDEN .test.* fajlnak van kezeloje -- egy uj kiterjesztes nem eshet ki nemán', () => {
    expect(unhandled).toEqual([])
  })

  // Card 74d0d0cf: three files said "NOT WIRED TO CI ... its passing is not a gate" for two weeks
  // AFTER this collector started running them. A header that says "nobody runs me" is the one that
  // licenses leaving a test red -- so a collected file may not say it.
  const NOT_COLLECTED_CLAIM = /NOT WIRED TO CI|does not collect Python/i
  it('egyetlen begyujtott fajl sem allitja magarol, hogy nem futtatja senki', () => {
    // KONTROLL: a minta tuzel a regi fejlec szovegere
    expect(NOT_COLLECTED_CLAIM.test('NOT WIRED TO CI: `npm test` is vitest and does not collect Python')).toBe(true)
    const liars = runnable.filter((f) => NOT_COLLECTED_CLAIM.test(readFileSync(join(TESTS_DIR, f), 'utf8')))
    expect(liars).toEqual([])
  })

  it('csak azt futtatja, amit az upstream gyujto nem: felso szint ott, alkonyvtar itt (33ff4ab1)', () => {
    expect(selectHere(['a.test.sh', 'b.test.py', 'c-test.py', 'd/e.test.sh'], true)).toEqual(['d/e.test.sh'])
    // a way out: without the upstream runner nothing is skipped
    expect(selectHere(['a.test.sh', 'd/e.test.sh'], false)).toEqual(['a.test.sh', 'd/e.test.sh'])
  })

  it('az upstream gyujto felderitese az, amire a szures epit (ha valtozott, igazitsd a coveredUpstream-et)', () => {
    if (upstreamSrc === null) return
    for (const snippet of UPSTREAM_DISCOVERY) expect(upstreamSrc, snippet).toContain(snippet)
  })

  it('az idotullepes TIMEOUT-kent jelenik meg, nem rc=1-kent', () => {
    expect(failureHead('x.test.sh', { rc: null, out: '', killed: true, signal: 'SIGTERM' })).toMatch(/TIMEOUT: \d+ s utan megolve \(SIGTERM\)/)
    expect(failureHead('x.test.sh', { rc: 1, out: '', killed: false, signal: null })).toBe('x.test.sh rc=1')
  })

  for (const file of runHere) {
    it(`${file} atmegy`, () => {
      const r = results.get(file)
      expect(r, `${file}: nem futott le`).toBeDefined()
      if (r!.rc !== 0) {
        const tail = r!.out.trim().split('\n').slice(-25).join('\n')
        throw new Error(`${failureHead(file, r!)}\n--- utolso 25 sor ---\n${tail}`)
      }
      expect(r!.rc).toBe(0)
    })
  }
})
