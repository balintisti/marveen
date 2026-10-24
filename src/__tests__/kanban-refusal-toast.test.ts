/**
 * Card 3c7be3c4 (didi O1): the done gate answers 409 with the reason in
 * `error` (missing KESZ-IGAZOLAS line, open verdicts). The board used to drop
 * it: the desktop drag ignored the response and the card snapped back without
 * a word, the touch drag and the status select showed a generic error.
 *
 * Runs the REAL refusalToast out of web/app.js, then checks that every move
 * fetch and the add-subtask fetch hand a refused answer to it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const src = readFileSync(join(ROOT, 'web', 'app.js'), 'utf8')

function extractFn(name: string): string {
  const m = new RegExp(`(async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src)
  if (!m) throw new Error(`${name} missing from web/app.js -- 3c7be3c4 fix reverted?`)
  let depth = 0
  for (let j = src.indexOf('{', m.index + m[0].length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(m.index, j + 1)
  }
  throw new Error(`unbalanced braces in ${name}`)
}

type Toast = [string, number | undefined]
function load(): { refusalToast: (r: { json: () => Promise<unknown> }, fallback: string) => Promise<void>; toasts: Toast[] } {
  const toasts: Toast[] = []
  const showToast = (msg: string, duration?: number) => { toasts.push([msg, duration]) }
  const refusalToast = new Function('showToast', `${extractFn('refusalToast')}; return refusalToast`)(showToast)
  return { refusalToast, toasts }
}
const answer = (body: unknown) => ({ json: async () => body })

describe('refusalToast says why the board refused (3c7be3c4)', () => {
  it('shows the error the server gave, long enough to read', async () => {
    const { refusalToast, toasts } = load()
    await refusalToast(answer({ error: 'A kartyan nincs KESZ-IGAZOLAS sor.', missing_proof: true }), 'generic')
    expect(toasts).toEqual([['A kartyan nincs KESZ-IGAZOLAS sor.', 12000]])
  })

  it('CONTROL: falls back to the generic text when the body is not JSON', async () => {
    const { refusalToast, toasts } = load()
    await refusalToast({ json: async () => { throw new SyntaxError('not json') } }, 'generic')
    expect(toasts).toEqual([['generic', undefined]])
  })

  it('falls back when the body has no usable error', async () => {
    const { refusalToast, toasts } = load()
    await refusalToast(answer({ error: '' }), 'generic')
    await refusalToast(answer({ error: { nested: true } }), 'generic')
    await refusalToast(answer(null), 'generic')
    expect(toasts.map((t) => t[0])).toEqual(['generic', 'generic', 'generic'])
  })
})

describe('every refusable kanban write in web/app.js reaches refusalToast', () => {
  // From each fetch up to the next statement block: the !r.ok branch must
  // hand the answer to refusalToast, not throw it away.
  function siteAfter(index: number): string {
    return src.slice(index, index + 600)
  }
  const moveSites = [...src.matchAll(/fetch\(`\/api\/kanban\/\$\{encodeURIComponent\([^)]*\)\}\/move`/g)].map((m) => m.index!)
  const subtaskSite = src.indexOf("body: JSON.stringify({ title, parent_id: card.id, status: card.status")

  it('finds the three move sites and the add-subtask site', () => {
    expect(moveSites.length).toBeGreaterThanOrEqual(3)
    expect(subtaskSite).toBeGreaterThan(-1)
  })

  it.each([0, 1, 2])('move site %i checks r.ok and hands it to refusalToast', (i) => {
    const site = siteAfter(moveSites[i])
    expect(site).toMatch(/if \(!r\.ok\)[^\n]*await refusalToast\(r, t\('kanban\.toast\.move_error'\)\)/)
  })

  it('every move site found, not only the first three, is wired', () => {
    for (const idx of moveSites) expect(siteAfter(idx)).toMatch(/if \(!r\.ok\)[^\n]*refusalToast\(r, /)
  })

  it('add-subtask hands a refused create to refusalToast', () => {
    expect(siteAfter(subtaskSite)).toMatch(/if \(!r\.ok\) \{ await refusalToast\(r, t\('kanban\.toast\.subtask_error'\)\); return \}/)
  })
})
