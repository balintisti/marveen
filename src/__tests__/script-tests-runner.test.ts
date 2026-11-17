// Every scripts/__tests__ suite runs in CI, discovered, not enumerated.
//
// Measured 2026-09-05: scripts/__tests__ held 29 executable suites and only 4
// were reachable from the vitest run -- the other 25 had never been executed by
// anything but a human typing their path. Among the dead ones were the gate's
// own fail-closed exit-code contract (outgoing-copy-gate-failclosed), the shell
// portability suite written the night before, and the hook double-run audit.
// Two of the 25 were in fact FAILING: seed-skills asserted a template sentence
// that 827491c rewrote away, and stop-start-system-unit asserted the systemd
// branch on a machine that has no systemd. Nobody could know, because nothing
// ran them.
//
// Enumerating them here would rot the same way, so the list is discovered from
// disk: a new scripts/__tests__/*.test.sh is in CI the moment it is written.
// The four suites with their own dedicated wrapper run twice; that is the cheap
// direction of the trade, because deleting a wrapper must not silently retire a
// suite.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { missingLocalFiles } from './helpers/local-only-files.js'

const ROOT = join(__dirname, '..', '..')
const DIR = join(ROOT, 'scripts', '__tests__')

// `*-test.py` is the older naming; both spellings are real suites in this tree.
const SUITES = readdirSync(DIR)
  .filter((f) => /\.test\.(sh|py)$/.test(f) || /-test\.py$/.test(f))
  .sort()

// Suites that exercise scripts which exist only on the owner's disk (listed in
// .git/info/exclude, not tracked in this repo; card 0816284f). In a clean checkout they
// failed with ENOENT / "can't open file". They are SKIPPED with the missing paths named in
// the test title, so the skip shows in the run output. Where the files exist (the main
// checkout) they run as before. A new dependency not listed here shows up as a red suite
// in a clean tree, which is the direction a stale list should fail in.
const BACKUP_FILES = [
  'scripts/delta-crm-backup.sh',
  'scripts/lib/pg-argv-safe.sh',
]
const OFFSITE_FILES = [
  'scripts/backup-offsite.py',
  'scripts/lib/backup_key_words.py',
  'scripts/lib/backup-key.sh',
]
const LOCAL_ONLY_DEPS: Record<string, readonly string[]> = {
  'backup-offsite.test.py': OFFSITE_FILES,
  'delta-crm-backup-retry.test.sh': BACKUP_FILES,
  'pg-argv-safe.test.sh': BACKUP_FILES,
  'delta-crm-offsite-encryption.test.sh': [
    ...BACKUP_FILES,
    ...OFFSITE_FILES,
    'scripts/lib/backup-retention.sh',
    'scripts/lib/bip39-english.txt',
    'scripts/delta-crm-backup-key.sh',
    'scripts/delta-crm-restore-offsite.sh',
  ],
}

const CASES = SUITES.map((name) => {
  const missing = missingLocalFiles(ROOT, LOCAL_ONLY_DEPS[name] ?? [])
  const title = missing.length
    ? `${name} passes [SKIPPED: local-only file(s) not tracked in this tree: ${missing.join(', ')}]`
    : `${name} passes`
  return { name, title, skip: missing.length > 0 }
})

describe('scripts/__tests__ suites', () => {
  it('finds the suites on disk (a rename must not silently empty this run)', () => {
    expect(SUITES.length).toBeGreaterThan(20)
  })

  // A real `it.skip` (not an early return): the run summary counts it as skipped.
  for (const { name, title, skip } of CASES) {
    ;(skip ? it.skip : it)(title, () => {
      const runner = name.endsWith('.py') ? 'python3' : 'bash'
      const res = spawnSync(runner, [join(DIR, name)], {
        encoding: 'utf-8',
        timeout: 300_000,
        cwd: ROOT,
      })
      if (res.status !== 0) {
        console.error(`--- ${name} stdout ---\n${res.stdout ?? ''}`)
        console.error(`--- ${name} stderr ---\n${res.stderr ?? ''}`)
      }
      expect(res.status).toBe(0)
    }, 310_000)
  }
})
