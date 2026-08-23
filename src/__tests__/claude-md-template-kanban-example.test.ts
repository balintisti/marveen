import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Cards e369adab / b7b0f400. The forward-fix made an empty `project` warn at the
// API; this guards the OTHER half of the same finding, which is where the empty
// fields actually came from.
//
// MEASURED 2026-08-23 on the live board: 794 cards created in seven days, 445 of
// them with an empty `project` (56%) -- and the largest single source was the
// DOCUMENTED EXAMPLE. Every agent doc derived from this template showed a create
// call without the field, so leaving it out was not carelessness: it was what
// the documentation demonstrated. A warning alone would then fire on almost
// every creation, and a warning that always fires is noise within a week.
//
// This file is the only TRACKED copy of that example. The per-agent CLAUDE.md
// files under agents/ are untracked live state; the template is what ships.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TPL = readFileSync(join(ROOT, 'templates', 'CLAUDE.md.template'), 'utf-8')

/** The fenced block that follows a heading, so prose changes cannot move the boundary. */
function pelda(utan: string): string {
  const i = TPL.indexOf(utan)
  expect(i, `nincs ilyen szakasz a sablonban: ${utan}`).toBeGreaterThan(-1)
  const start = TPL.indexOf('```bash', i)
  return TPL.slice(start, TPL.indexOf('```', start + 7))
}

describe('CLAUDE.md.template -- a kanban-pelda nem tanithat NEMA hianyt', () => {
  it('a kartya-letrehozas pelda kuld `project`-et', () => {
    // E nelkul kesobb nem lehet megmondani, MELYIK repora vonatkozik a kartya,
    // es a hianyt semmi nem teszi lathatova a letrehozas pillanataban.
    expect(pelda('Új kártya:')).toContain('"project"')
  })

  it('a mozgatas pelda kuld `actor`-t', () => {
    // A nelkul a sajat kartyad felvetele megkulonboztethetetlen egy kiosztastol,
    // es a dispatcher visszadobja feladatkent azt, amit epp elkezdtel.
    expect(pelda('Kártya mozgatása:')).toContain('"actor"')
  })

  it('a statusz-lista tartalmazza a `testing`-et', () => {
    // A sablon negy statuszt sorolt fel ot helyett. Egy hianyzo statusz nem
    // hibauzenetkent jelentkezik: az agens egyszeruen nem hasznalja.
    const sor = TPL.split('\n').find(l => l.startsWith('Státuszok:'))
    expect(sor).toBeTruthy()
    for (const st of ['planned', 'in_progress', 'testing', 'waiting', 'done']) {
      expect(sor, `hianyzik: ${st}`).toContain(st)
    }
  })

  it('a sablon MEGINDOKOLJA a ket mezot, nem csak beteszi', () => {
    // Egy pelda, ami kimondatlanul hordoz egy kovetelmenyt, az elso atirasnal
    // elveszik -- aki rovidit rajta, nem tudja, mit vesz ki.
    expect(TPL).toMatch(/`project`.*NEM elhagyható|`project`\*\*:/s)
    expect(TPL).toContain('dispatcher')
  })
})
