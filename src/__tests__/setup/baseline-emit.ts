import type { Reporter } from 'vitest/reporters'
import type { File, Task } from 'vitest'
import { writeFileSync } from 'node:fs'
import { countTests } from './suite-size-guard.js'

/**
 * Riporter, ami a lefutott fajl- es teszt-szamot egy fajlba irja.
 *
 * Csak az alapvonal-frissito (`npm run test:baseline`) hasznalja, es CSAK akkor
 * kapcsol be, ha a `SUITE_BASELINE_EMIT` env meg van adva -- egy normal futason
 * nincs jelen, tehat nem tud melleкhatast okozni.
 *
 * A SZAMOLAS UGYANAZ A `countTests`, amit az or hasznal. Ha ket kulon szamolo
 * lenne, az alapvonal es az ellenorzes csendben elteronek indulhatna -- es epp
 * az a fajta elcsuszas, ami ellen az egesz kartya szol.
 */
export default class BaselineEmit implements Reporter {
  onFinished(files?: File[]): void {
    const out = process.env['SUITE_BASELINE_EMIT']
    if (!out || !files) return
    writeFileSync(out, JSON.stringify({
      files: files.length,
      tests: countTests(files as unknown as Task[]),
    }))
  }
}
