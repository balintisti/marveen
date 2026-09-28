import { defineConfig, configDefaults } from 'vitest/config'

// The Playwright suites are driven by their own configs, not by `vitest run`:
// tests/smoke/** by `npm run smoke` (playwright.config.ts, a running dashboard)
// and tests/browser/** by `npm run browser-verify`
// (playwright.browser.config.ts, the static front end). Playwright's test() API
// throws when collected under vitest, which fails the unit gate. Keep all
// vitest defaults; only carve out the e2e directories.
export default defineConfig({
  test: {
    // vendor/**: vendored third-party trees carry their OWN test files with
    // their own dependencies (the gmail fork's tests import nodemailer etc.,
    // which the root npm ci never installs) -- collecting them makes CI red
    // with zero failing tests, just three unloadable files (Marveen, #1224).
    // Running a vendor's suite is a separate workflow with the vendor's own
    // install, never this one.
    // dist/**: `npm run build` compiles every src/__tests__/*.test.ts into
    // dist/__tests__/*.test.js, and vitest collects those copies too -- measured
    // 2026-09-16: 888 files / 10723 tests instead of 444 / 5633, with 67 files
    // RED and not one real failure in them. The upgrade procedure is exactly
    // build-then-test, so this lands precisely where a red suite is least
    // affordable: either someone stops on a regression that does not exist, or
    // -- worse -- learns that "this many reds is normal", and a real failure
    // stops standing out among them.
    //
    // It is not covered by "keep all vitest defaults" above: as of vitest 4,
    // configDefaults.exclude is ONLY ['**/node_modules/**', '**/.git/**']
    // (measured, not assumed). Whatever the defaults used to carry, they do not
    // carry this, and the comment's premise quietly stopped holding.
    exclude: [...configDefaults.exclude, 'dist/**', 'tests/smoke/**', 'tests/browser/**', 'vendor/**'],
    // vitest 4 enforces the 5s default testTimeout on tests that vitest 2 let
    // run long. Three subprocess-spawning tests (send-honesty-final,
    // send-honesty-round2) legitimately take 15-30s: they shell out to
    // watchdog-replay.py and wait for it. Measured 2026-09-04 on the v2->v4
    // bump: without this line those three red out as timeouts, with it the
    // suite is green. This is a timeout budget, not a behavioural change.
    testTimeout: 60000,
    // POOL DECLARED, NOT INHERITED (card 36f975ed). Measured 2026-09-02 on vitest
    // 2.1.9: `isMainThread=true` inside a test, i.e. child PROCESS, i.e. `forks` --
    // already the effective behaviour, so this changes nothing today. It is written
    // down because the isolation several specs rely on comes from this default
    // rather than from anything we chose.
    //
    // WHAT DEPENDS ON IT. Under `threads` the workers share the parent's process
    // state, so a spec that sets a fake HOME (or any process-wide value) can leak
    // it -- card da9aacec measured exactly that, and the exposure was zero only
    // because the specs concerned happen to do their HOME-sensitive work in a child
    // process. That is a property of today's specs, not a property of the suite.
    //
    // The risk this closes is not a bug: it is a silent vitest upgrade changing the
    // default and moving the tests into shared-state workers, with the symptom
    // being tests that read the operator's real ~/.claude instead of a fixture.
    // An implicit default cannot be reviewed; a declared one can.
    pool: 'forks',
    // Hard gates, run in every worker before any test module is imported:
    //  - assert-not-live-install: refuse to run inside a live install (see that
    //    setup file's header for the 2026-07-27 incident it prevents).
    //  - assert-supported-node: refuse to run on a Node whose ABI the installed
    //    native modules were not built for, which otherwise reds out 40 files
    //    with errors that look like bugs in those files (2026-08-17).
    //  - default-ssh-dir-seam: point MARVEEN_SSH_DIR at a scratch directory so no
    //    test can write the operator's REAL ~/.ssh/authorized_keys. Not covered by
    //    the live-install gate above: that one inspects the CHECKOUT, and ~/.ssh is
    //    HOME-scoped -- a clean worktree run leaked 62 real keys (ENROLL813,
    //    2026-09-15). A seam, not a gate: it sets state, so it lives in its own file.
    setupFiles: [
      // Elso, mert a tobbi setup es minden teszt-modul MAR a rogzitett zonaban fusson
      // (kartya 39151cd4: a keszlet eddig a gep zonajat OROKOLTE, es pontosan egyben volt zold).
      './src/__tests__/setup/pin-timezone.ts',
      './src/__tests__/setup/assert-not-live-install.ts',
      './src/__tests__/setup/assert-supported-node.ts',
      './src/__tests__/setup/default-ssh-dir-seam.ts',
    ],
    // ALAPVONAL-OR a keszlet MERETERE (kartya 30e04d76). A `default` riporter
    // mellett fut, tehat a megszokott kimenet valtozatlan -- csak akkor szolal
    // meg, ha a lefutott fajlok/tesztek szama egy alapvonal ala esik.
    // Riporterkent es NEM kulso wrapper-szkriptkent, mert az agensek `npx vitest
    // run`-t irnak, nem az npm scriptet: egy wrapper pont a valodi uton nem
    // futna. Reszhalmaz-futasnal hallgat, lasd `isFilteredRun`.
    reporters: ['default', './src/__tests__/setup/suite-size-guard.ts'],
  },
})
