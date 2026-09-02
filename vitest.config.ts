import { defineConfig, configDefaults } from 'vitest/config'

// The Playwright smoke suite (tests/smoke/**) is driven by `npm run smoke`
// (playwright.config.ts), not by `vitest run`. Playwright's test() API throws
// when collected under vitest, which fails the unit gate. Keep all vitest
// defaults; only carve out the e2e directory.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/smoke/**'],
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
    setupFiles: [
      './src/__tests__/setup/assert-not-live-install.ts',
      './src/__tests__/setup/assert-supported-node.ts',
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
