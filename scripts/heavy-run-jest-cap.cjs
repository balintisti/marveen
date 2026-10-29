// heavy-run-jest-cap.cjs -- caps jest's worker count for runs under scripts/heavy-run.py (card e96722e2).
//
// WHY (measured 2026-10-29 08:20, marveen): jest 29 has no env var for maxWorkers; without --maxWorkers
// it starts cores-1 = 11 workers on the Mac Mini, so two heavy unit runs were ~22 workers on 12 cores.
// Vitest reads VITEST_MAX_WORKERS (heavy-run sets it); jest does not. Agents start jest in many shapes
// (npx jest, npm test, npm --prefix ... test, bash -c "cd ... && jest"), so a wrapper that rewrites its
// own argv would miss most of them. This file goes into NODE_OPTIONS as --require, runs at the start of
// EVERY node process in the run's tree, and acts only in jest's own entry process: there it adds
// --maxWorkers=<HEAVY_RUN_MAX_WORKERS> to process.argv before jest parses it.
//
// It adds nothing when the command already decides: --maxWorkers / -w, --runInBand / -i (e2e), --watch /
// --watchAll (jest halves the cores there itself). HEAVY_RUN_MAX_WORKERS=0 switches it off.
// Limit, stated: a script that REPLACES NODE_OPTIONS (Delta-CRM frontend "test" does, for vitest) drops
// this file; a jest started that way is not capped.
'use strict';

const fs = require('fs');

const ENTRIES = ['/jest/bin/jest.js', '/jest-cli/bin/jest.js'];
const DECIDED = /^(--maxWorkers|--max-workers|-w|--runInBand|--run-in-band|-i|--watch|--watchAll|--watch-all)(=|$)|^-w\d/;

(function cap() {
  const n = parseInt(process.env.HEAVY_RUN_MAX_WORKERS || '4', 10);
  const script = process.argv[1];
  if (!(n > 0) || !script) return;
  let real;
  try {
    real = fs.realpathSync(script);
  } catch {
    return;
  }
  if (!ENTRIES.some((e) => real.endsWith(e))) return;
  const args = process.argv.slice(2);
  const end = args.indexOf('--');
  if ((end < 0 ? args : args.slice(0, end)).some((a) => DECIDED.test(a))) return;
  process.argv.splice(2, 0, `--maxWorkers=${n}`);
  process.stderr.write(`heavy-run: jest --maxWorkers=${n} added (HEAVY_RUN_MAX_WORKERS, card e96722e2)\n`);
})();
