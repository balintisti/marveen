/**
 * Card ad4ee45a. The card edit modal filled the date field with the UTC day and
 * saved UTC midnight, and it ALWAYS re-sent due_date -- so an unchanged save
 * (changing only the priority) moved a Budapest-midnight floor 22 hours earlier
 * and the field showed the previous day. mandark reproduced it 3/3 in a real
 * browser; his Chromium test re-runs after deploy.
 *
 * This file runs the REAL functions out of web/app.js (the house pattern of
 * messages-view-display-name.test.ts), not a copy of them:
 *   dueDatePatch     -- what the save sends
 *   dueDayForField   -- what the field shows, in the zone the SERVER names
 * plus a wiring check that the save handler uses the first and that the old
 * UTC conversion is gone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DUE_DATE_ZONE, normalizeDueDate } from '../web/kanban-due-date.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', '..', 'web', 'app.js'), 'utf8')

/** The whole function, `async` included when the source has it. */
function extractFn(name: string): string {
  const re = new RegExp(`(async\\s+)?function ${name}\\s*\\([^)]*\\)\\s*\\{`)
  const m = re.exec(src)
  if (!m) throw new Error(`${name} missing from web/app.js -- ad4ee45a fix reverted?`)
  let depth = 0
  for (let j = src.indexOf('{', m.index + m[0].length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const dueDatePatch = new Function(`${extractFn('dueDatePatch')}; return dueDatePatch`)() as
  (value: string, initial?: string) => Record<string, unknown>

/** dueDateZone + dueDayForField, with fetch standing in for the rules route. */
function loadFieldHelpers(fetchImpl: () => Promise<unknown>) {
  const body = `let dueDateZonePromise = null
    ${extractFn('dueDateZone')}
    ${extractFn('dueDayForField')}
    return dueDayForField`
  return new Function('fetch', 'console', body)(fetchImpl, { warn: () => {} }) as
    (s: unknown) => Promise<string>
}
const rulesOk = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ zone: DUE_DATE_ZONE }) })

/** 2026-09-26 00:00 Europe/Budapest -- mandark's measured floor. */
const SEP26 = 1790373600

describe('the save: an untouched field sends NOTHING', () => {
  it('unchanged -> no due_date key at all (so the stored floor cannot move)', () => {
    expect(dueDatePatch('2026-09-26', '2026-09-26')).toEqual({})
    expect(dueDatePatch('', '')).toEqual({})
    expect(dueDatePatch('', undefined)).toEqual({})
  })

  it('changed -> the day string, which the server normalises to the same floor', () => {
    const patch = dueDatePatch('2026-09-26', '2026-09-25')
    expect(patch).toEqual({ due_date: '2026-09-26' })
    expect(normalizeDueDate(patch.due_date)).toEqual({ ok: true, value: SEP26 })
  })

  it('cleared -> null, which clears the floor', () => {
    expect(dueDatePatch('', '2026-09-26')).toEqual({ due_date: null })
  })

  it('WIRING: the save handler uses dueDatePatch, and the UTC conversion is gone', () => {
    const save = src.slice(src.indexOf("getElementById('saveCardBtn')"), src.indexOf('// === Card labels'))
    expect(save).toContain('dueDatePatch(dueEl.value, dueEl.dataset.initial)')
    expect(save).not.toMatch(/new Date\(document\.getElementById\('cardDue'\)/)
    expect(save).not.toMatch(/due_date:\s*document\.getElementById\('cardDue'\)/)
  })
})

describe('the field: the day in the zone the SERVER names', () => {
  it('a Budapest-midnight floor shows ITS day, not the UTC day before it', async () => {
    const day = loadFieldHelpers(rulesOk)
    expect(await day(SEP26)).toBe('2026-09-26')
    // the defect, for contrast: this is what the old code put in the field
    expect(new Date(SEP26 * 1000).toISOString().split('T')[0]).toBe('2026-09-25')
  })

  it("dexter's 09:00 floor shows the same day", async () => {
    expect(await loadFieldHelpers(rulesOk)(SEP26 + 9 * 3600)).toBe('2026-09-26')
  })

  it('THE MEASURED CASE, end to end: show -> save unchanged -> nothing sent', async () => {
    const shown = await loadFieldHelpers(rulesOk)(SEP26)
    expect(dueDatePatch(shown, shown)).toEqual({})
  })

  it('a legacy TEXT due_date does not throw (it would stop the modal opening)', async () => {
    const day = loadFieldHelpers(rulesOk)
    expect(await day('2026-09-24')).toBe('2026-09-24')
    expect(await day('holnap')).toBe('')
    expect(await day(null)).toBe('')
  })

  it('the zone comes from the rules route: a different zone gives a different day', async () => {
    const tokyo = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ zone: 'Asia/Tokyo' }) })
    // 2026-09-25 22:00 UTC is already the 26th in Budapest and 07:00 on the 26th in Tokyo;
    // pick an instant where they DIFFER: 2026-09-26 16:00 UTC = 18:00 Budapest, 01:00 (27th) Tokyo
    const t = Date.UTC(2026, 8, 26, 16) / 1000
    expect(await loadFieldHelpers(rulesOk)(t)).toBe('2026-09-26')
    expect(await loadFieldHelpers(tokyo)(t)).toBe('2026-09-27')
  })

  it('an unreachable rules route degrades to a displayed day, and never throws', async () => {
    const down = () => Promise.resolve({ ok: false, status: 503 })
    await expect(loadFieldHelpers(down)(SEP26)).resolves.toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
