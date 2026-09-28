// tmpDirs cleans up in `vitest list` too (card c203db6b).
//
// `vitest list` -- the suite baseline, a name diff -- COLLECTS every test file, so module- and
// describe-level mkTmp() calls run, but it never runs hooks: the afterAll never fires. Measured
// 2026-09-28: 76 directories left in $TMPDIR by one full list run. The list worker is ended with
// SIGTERM, and the helper's per-process net sweeps on it. This drives the REAL path end to end: a
// nested `vitest list` of a file that makes its directories at describe level, then a look at
// $TMPDIR for that file's prefix.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const ROOT = join(__dirname, '..', '..')
const FIXTURE = 'src/__tests__/quarantine-allowlist-render.test.ts'
const PREFIX = 'egress-q-'   // made at describe level in FIXTURE: exists after collection alone

describe('tmpDirs in list mode', () => {
  it('a nested `vitest list` leaves none of the fixture\'s directories behind', () => {
    // Its OWN TMPDIR (didi's review): the fixture file also runs in the OUTER suite, in parallel,
    // and a describe-level directory of that outer copy must not be able to land in what this
    // measures. Everything in `own` was made by the nested list, so no time window is needed.
    const own = mkTmp('listmode-tmp-')
    const env: NodeJS.ProcessEnv = {}
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITEST')) env[k] = v
    env.TMPDIR = own
    const r = spawnSync(process.execPath, [join(ROOT, 'node_modules', 'vitest', 'vitest.mjs'), 'list', FIXTURE],
      { cwd: ROOT, env, encoding: 'utf-8', timeout: 150_000 })
    // CONTROL: the list really collected the fixture -- otherwise "nothing left" proves nothing
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('ownerAllowedDomains')
    expect(readdirSync(own).filter((n) => n.startsWith(PREFIX))).toEqual([])
  }, 180_000)
})
