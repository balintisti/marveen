// Card 9419cf92 (trillian 31632, finding 2): POST /api/agents answers missingGates when a
// new agent was created without some of its safety gates, and nobody read the field: the
// wizard took personalityPending out of the response and nothing else. These tests hold
// that the field reaches the operator: the response is captured, the step-3 banner paints
// it, and a reset clears it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')
const HTML = readFileSync(join(ROOT, 'web', 'index.html'), 'utf-8')

/** The source of one top-level function of app.js, up to its closing brace at column 0. */
function fnSource(name: string): string {
  const start = APP.indexOf(`function ${name}(`)
  expect(start).toBeGreaterThan(-1)
  const end = APP.indexOf('\n}\n', start)
  expect(end).toBeGreaterThan(start)
  return APP.slice(start, end + 2)
}

type El = { hidden: boolean; textContent: string }

/** Runs the real renderWizardGatesBanner against stub elements and a stub t(). */
function paint(gates: string[] | null) {
  const els: Record<string, El> = {
    wizardGatesBanner: { hidden: true, textContent: '' },
    wizardGatesTitle: { hidden: false, textContent: '' },
    wizardGatesBody: { hidden: false, textContent: '' },
  }
  const document = { getElementById: (id: string) => els[id] ?? null }
  const t = (key: string, vars?: Record<string, string>) => `${key}|${vars ? JSON.stringify(vars) : ''}`
  new Function('document', 't', 'wizardMissingGates', `${fnSource('renderWizardGatesBanner')}\nrenderWizardGatesBanner()`)(
    document, t, gates,
  )
  return els
}

describe('the step-3 missing-gates banner (card 9419cf92)', () => {
  it('no missing gates -> the banner stays hidden (CONTROL)', () => {
    expect(paint(null).wizardGatesBanner.hidden).toBe(true)
  })

  it('missing gates -> the banner is shown and names every one of them', () => {
    const els = paint(['egress-gate', 'quarantine-reader'])
    expect(els.wizardGatesBanner.hidden).toBe(false)
    expect(els.wizardGatesTitle.textContent).toContain('agents.wizard.gates_title')
    expect(els.wizardGatesBody.textContent).toContain('agents.wizard.gates_body')
    expect(els.wizardGatesBody.textContent).toContain('egress-gate, quarantine-reader')
  })

  it('a later run with no gates missing hides a banner an earlier run showed', () => {
    const els = paint(['egress-gate'])
    expect(els.wizardGatesBanner.hidden).toBe(false)
    const document = { getElementById: (id: string) => els[id as keyof typeof els] ?? null }
    new Function('document', 't', 'wizardMissingGates', `${fnSource('renderWizardGatesBanner')}\nrenderWizardGatesBanner()`)(
      document, () => '', null,
    )
    expect(els.wizardGatesBanner.hidden).toBe(true)
  })
})

describe('the wizard wires the field from the response to the banner', () => {
  it('captures result.missingGates from the create response', () => {
    expect(APP).toMatch(/wizardMissingGates = Array\.isArray\(result\.missingGates\) && result\.missingGates\.length > 0/)
  })

  it('paints the banner when step 3 opens', () => {
    const open = APP.indexOf('wizardStep = 3')
    expect(open).toBeGreaterThan(-1)
    const step3 = APP.slice(open, APP.indexOf('}, 600)', open))
    expect(step3).toContain('renderWizardGatesBanner()')
  })

  it('a reset clears both the state and the banner', () => {
    const reset = fnSource('resetWizard')
    expect(reset).toContain('wizardMissingGates = null')
    expect(reset.indexOf('renderWizardGatesBanner()')).toBeGreaterThan(reset.indexOf('wizardMissingGates = null'))
  })

  it('the banner elements exist in the page', () => {
    for (const id of ['wizardGatesBanner', 'wizardGatesTitle', 'wizardGatesBody']) {
      expect(HTML).toContain(`id="${id}"`)
    }
  })

  it('both languages name the gates through the {gates} placeholder', () => {
    for (const lang of ['hu', 'en']) {
      const src = readFileSync(join(ROOT, 'web', 'lang', `${lang}.js`), 'utf-8')
      expect(src).toContain("'agents.wizard.gates_title'")
      expect(src).toMatch(/'agents\.wizard\.gates_body':\s*'[^']*\{gates\}/)
    }
  })
})
