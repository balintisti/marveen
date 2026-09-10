#!/usr/bin/env npx tsx
/**
 * Vekony CLI a `src/seed-drift.ts` fole -- a logika ott el, ugyanabban az
 * alakban, mint a secret-gate-nel (src/security/ + scripts/). Ket oka van, es a
 * masodik a fontosabb: (1) a `tsconfig` rootDir-je `src/`, tehat egy `src/`-beli
 * teszt nem importalhat `scripts/`-bol; (2) a tesztelheto resz igy NEM a
 * fajlrendszertol fugg.
 */
import { readdirSync } from 'node:fs';
import { check, SEED_DIR } from '../src/seed-drift.js';

function main(): number {
  const { drifts, unseeded, stopped } = check();
  // --json: gepnek. A napindito ebbol epiti a HIR/ALLANDO megkulonboztetest,
  // es egy kimenet-parseolas ott pontosan az az alak lenne, amit ez a fajl
  // mashol elutasit -- a szoveg az EMBERNEK szol, nem szerzodes.
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({
      stopped,
      unseeded,
      drifts: drifts.map((d) => ({
        key: `${d.task}/${d.file}`,
        direction: d.onlyTemplate.length && d.onlyLive.length ? 'both'
          : d.onlyTemplate.length ? 'template-only' : 'live-only',
        onlyTemplate: d.onlyTemplate.length,
        onlyLive: d.onlyLive.length,
      })),
    }));
    return stopped ? 1 : drifts.length ? 3 : 0;
  }
  if (stopped) { console.log(`seed-drift: NEM MERHETO -- ${stopped}`); return 1; }
  if (!drifts.length) {
    console.log(`seed-drift: nincs elteres (${readdirSync(SEED_DIR).length} sablon-feladat${unseeded.length ? `, ${unseeded.length} meg nincs telepitve: ${unseeded.join(', ')}` : ''}).`);
    return 0;
  }
  console.log(`seed-drift: ${drifts.length} fajl ter el a sablonjatol. A tool NEM IR SEMMIT -- a dontes azé, aki a kontextust ismeri.`);
  for (const d of drifts) {
    const dir = d.onlyTemplate.length && d.onlyLive.length ? 'MINDKET IRANYBAN'
      : d.onlyTemplate.length ? 'CSAK A SABLONBAN (a javitas soha nem ert el az elo feladathoz)'
      : 'CSAK AZ ELOBEN (kezi szerkesztes -- egy feluliras ELVINNE)';
    console.log(`\n  ${d.task}/${d.file} -- ${dir}`);
    for (const l of d.onlyTemplate.slice(0, 5)) console.log(`    sablon: ${l.slice(0, 110)}`);
    if (d.onlyTemplate.length > 5) console.log(`    sablon: (+${d.onlyTemplate.length - 5} sor)`);
    for (const l of d.onlyLive.slice(0, 5)) console.log(`    elo   : ${l.slice(0, 110)}`);
    if (d.onlyLive.length > 5) console.log(`    elo   : (+${d.onlyLive.length - 5} sor)`);
  }
  return 3;
}

if (process.argv[1] && process.argv[1].endsWith('seed-drift-check.ts')) process.exit(main());
