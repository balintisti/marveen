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
import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const TESTS_DIR = join(REPO_ROOT, 'scripts', '__tests__')

const PER_TEST_TIMEOUT_MS = 200_000
const CONCURRENCY = 6

const allTestFiles = readdirSync(TESTS_DIR).filter((f) => f.includes('.test.')).sort()
const runnable = allTestFiles.filter((f) => /\.test\.(sh|py)$/.test(f))
const unhandled = allTestFiles.filter((f) => !/\.test\.(sh|py)$/.test(f))

type Result = { rc: number | null; out: string }
const results = new Map<string, Result>()

function runOne(file: string): Promise<Result> {
  const cmd = file.endsWith('.sh') ? 'bash' : 'python3'
  return new Promise((resolve) => {
    execFile(
      cmd,
      [join(TESTS_DIR, file)],
      { cwd: REPO_ROOT, timeout: PER_TEST_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const out = `${stdout}${stderr}`
        resolve({ rc: err ? ((err as NodeJS.ErrnoException & { code?: number }).code ?? 1) : 0, out })
      },
    )
  })
}

beforeAll(async () => {
  const queue = [...runnable]
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const file = queue.shift()
      if (!file) return
      results.set(file, await runOne(file))
    }
  })
  await Promise.all(workers)
}, PER_TEST_TIMEOUT_MS + 60_000)

describe('scripts/__tests__ -- a shell- es python-tesztek', () => {
  it('talalt futtathato teszt-fajlt (nema nulla ellen)', () => {
    expect(runnable.length).toBeGreaterThan(0)
  })

  it('MINDEN .test.* fajlnak van kezeloje -- egy uj kiterjesztes nem eshet ki nemán', () => {
    expect(unhandled).toEqual([])
  })

  for (const file of runnable) {
    it(`${file} atmegy`, () => {
      const r = results.get(file)
      expect(r, `${file}: nem futott le`).toBeDefined()
      if (r!.rc !== 0) {
        const tail = r!.out.trim().split('\n').slice(-25).join('\n')
        throw new Error(`${file} rc=${r!.rc}\n--- utolso 25 sor ---\n${tail}`)
      }
      expect(r!.rc).toBe(0)
    })
  }
})
