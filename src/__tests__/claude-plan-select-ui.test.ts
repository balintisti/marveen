// Card 4fdc6e63 (didi, 2026-10-14): the server refuses a token-mode plan for a
// sub-agent, but the dashboard still offered it and the toast dropped the reason.
// Evaluates the real, shipped planSelectOptions() and planSaveErrorText() from
// web/app.js (not a copy).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP = readFileSync(join(__dirname, '../../web/app.js'), 'utf-8')

function extractFn(name: string): string {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = re.exec(APP)
  if (!m) throw new Error(`${name} missing from web/app.js`)
  let depth = 0
  for (let j = APP.indexOf('{', m.index); j < APP.length; j++) {
    if (APP[j] === '{') depth++
    else if (APP[j] === '}' && --depth === 0) return APP.slice(m.index, j + 1)
  }
  throw new Error(`${name}: unbalanced braces`)
}

const tStub = (key: string) => `<${key}>`
const escapeHtml = (s: string) => s
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const options = new Function('t', 'escapeHtml', `${extractFn('planSelectOptions')}; return planSelectOptions`)(tStub, escapeHtml) as (
  plans: unknown[], selected: string,
) => string[]
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const errorText = new Function('t', `${extractFn('planSaveErrorText')}; return planSaveErrorText`)(tStub) as (
  res: { json: () => Promise<unknown> },
) => Promise<string>

const PLANS = [
  { id: 'elso', label: 'Első', configDir: '/cfg/elso' },
  { id: 'masodik', label: 'Második', tokenSecretId: 'tok' },
]
const optionFor = (opts: string[], id: string) => opts.find((o) => o.includes(`value="${id}"`))

describe('planSelectOptions: a token-mode plan is not offered to a sub-agent', () => {
  it('the token-mode plan is disabled and says why; the configDir plan is not', () => {
    const opts = options(PLANS, '')
    expect(optionFor(opts, 'masodik')).toMatch(/ disabled>Második<agents\.settings\.plan_main_only_suffix>/)
    expect(optionFor(opts, 'elso')).toBe('<option value="elso">Első</option>')
  })

  it('an ALREADY-assigned token-mode plan stays selectable, so it can be seen and cleared', () => {
    expect(optionFor(options(PLANS, 'masodik'), 'masodik')).not.toContain('disabled')
  })

  it('the empty "default" option and the not-in-registry fallback are kept', () => {
    const opts = options(PLANS, 'regi')
    expect(opts[0]).toBe('<option value=""><agents.settings.plan_default></option>')
    expect(optionFor(opts, 'regi')).toContain('<agents.settings.plan_not_found_suffix>')
  })
})

describe('planSaveErrorText: the toast carries the server reason', () => {
  it('a 400 body with an error shows that error', async () => {
    const text = await errorText({ json: async () => ({ error: 'token-módú Claude plan, csak a fő agensre hat' }) })
    expect(text).toBe('<agents.toast.plan_error>: token-módú Claude plan, csak a fő agensre hat')
  })

  it('no readable body falls back to the bare message, not a crash', async () => {
    expect(await errorText({ json: async () => { throw new Error('not json') } })).toBe('<agents.toast.plan_error>')
    expect(await errorText({ json: async () => null })).toBe('<agents.toast.plan_error>')
  })
})

describe('wiring: the shipped UI paths use these functions', () => {
  it('the save button toasts the server reason on a refusal', () => {
    const start = APP.indexOf("getElementById('savePlanBtn').addEventListener")
    expect(start).toBeGreaterThan(-1)
    const handler = APP.slice(start, APP.indexOf('\n})\n', start))
    expect(handler).toMatch(/if \(!res\.ok\) \{ showToast\(await planSaveErrorText\(res\)\); return \}/)
  })

  it('the plan dropdown is filled from planSelectOptions', () => {
    expect(extractFn('populatePlanSelect')).toContain('selectEl.innerHTML = planSelectOptions(plans, selected).join(')
  })
})

describe('i18n: the new keys exist in both languages', () => {
  it.each(['en', 'hu'])('%s', (lang) => {
    const src = readFileSync(join(__dirname, `../../web/lang/${lang}.js`), 'utf-8')
    for (const key of ['agents.settings.plan_main_only_suffix', 'agents.settings.plan_main_only_desc']) {
      expect(src).toContain(`'${key}':`)
    }
  })
})
