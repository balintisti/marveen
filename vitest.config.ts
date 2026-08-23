import { defineConfig, configDefaults } from 'vitest/config'

// The Playwright smoke suite (tests/smoke/**) is driven by `npm run smoke`
// (playwright.config.ts), not by `vitest run`. Playwright's test() API throws
// when collected under vitest, which fails the unit gate. Keep all vitest
// defaults; only carve out the e2e directory.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'tests/smoke/**'],
    // Hard gate: refuse to run inside a live install (see the setup file header
    // for the 2026-07-27 incident this prevents). Runs in every worker before
    // any test module is imported.
    setupFiles: ['./src/__tests__/setup/assert-not-live-install.ts'],
    // ALAPVONAL-OR a keszlet MERETERE (kartya 30e04d76). A `default` riporter
    // mellett fut, tehat a megszokott kimenet valtozatlan -- csak akkor szolal
    // meg, ha a lefutott fajlok/tesztek szama egy alapvonal ala esik.
    // Riporterkent es NEM kulso wrapper-szkriptkent, mert az agensek `npx vitest
    // run`-t irnak, nem az npm scriptet: egy wrapper pont a valodi uton nem
    // futna. Reszhalmaz-futasnal hallgat, lasd `isFilteredRun`.
    reporters: ['default', './src/__tests__/setup/suite-size-guard.ts'],
  },
})
