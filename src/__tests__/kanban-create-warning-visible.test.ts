// The backend has warned about an empty `project` since card b7b0f400: the
// creation response carries a `warning`, and kanban-project-warning.ts states
// its own reason for putting it THERE -- "callers already read this response".
//
// That is true of agents. It was never true of the dashboard. Measured
// 2026-08-27 (card 4201ce4d): all THREE card-creating calls in web/app.js read
// only `res.ok` and threw the body away, showing a fixed "created" toast. So
// the warning reached API callers and never once reached the person clicking
// the button -- and the dashboard is the biggest single source of cards with
// no project.
//
// Same shape as the archive warning one card earlier (ade4260a), and the same
// lesson: the server side was correct, the test was green, the spec was met,
// and the signal died BETWEEN the server and the screen.
//
// These are source-anchored assertions on purpose, and anchored to the CALL
// SITE rather than the file: `warning` appears ~20 times in app.js, so a
// file-wide assertion would pass against a wholly unwired handler.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

/** The text between two anchors, so an assertion cannot be satisfied by a
 *  neighbouring block. A slice that comes back suspiciously short fails loudly;
 *  one that is too long would pass silently on someone else's code. */
function slice(from: string, to: string): string {
  const a = APP.indexOf(from)
  expect(a, `nincs ilyen horgony: ${from}`).toBeGreaterThan(-1)
  const b = APP.indexOf(to, a + from.length)
  expect(b, `nincs zaro horgony: ${to}`).toBeGreaterThan(a)
  const s = APP.slice(a, b)
  expect(s.length).toBeGreaterThan(60)
  return s
}

describe('the dashboard SHOWS the project warning -- all three creating paths', () => {
  it('the main card dialog passes the parsed body on', () => {
    const s = slice("await fetch('/api/kanban', {", "closeModal(cardModalOverlay)")
    expect(s).toMatch(/toastWithWarning\(await res\.json\(\)/)
    expect(s).toMatch(/kanban\.toast\.card_created/)
  })

  it('the subtask form does too -- an unattributed parent multiplies', () => {
    const s = slice("kanban.toast.subtask_error", "loadKanban()")
    expect(s).toMatch(/toastWithWarning\(await r\.json\(\)/)
  })

  it('the auto-breakdown does too -- one breakdown, N new gaps', () => {
    const s = slice('breakdown/accept', 'loadKanban()')
    expect(s).toMatch(/toastWithWarning\(data,/)
  })

  it('the helper exists ONCE and decides the policy in one place', () => {
    expect(APP.match(/function toastWithWarning\(/g)?.length).toBe(1)
    const helper = slice('function toastWithWarning(', '\n}')
    expect(helper).toMatch(/body\.warning/)
    expect(helper).toMatch(/showToast\(body\.warning, 12000\)/)
    expect(helper).toMatch(/else showToast\(fallbackMsg\)/)
  })

  it('NEGATIVE CONTROL: the card UPDATE path is untouched (it cannot warn)', () => {
    // PUT /api/kanban/:id returns no warning, so wiring one there would be
    // cargo-culting. If this ever starts failing, the slices above stopped
    // isolating their call sites.
    const s = slice("method: 'PUT',", "kanban.toast.card_updated")
    expect(s).not.toMatch(/toastWithWarning/)
  })
})

// The other half: the backend really does send it on those paths. Without this
// the assertions above would only prove that app.js talks to itself.
describe('the backend side the dashboard now reads', () => {
  async function createCard(body: unknown) {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: 'POST', headers: {},
    }) as unknown as http.IncomingMessage
    let chunk = ''
    const res = {
      writeHead() { return res }, setHeader() { return res },
      end(d?: string) { if (d) chunk = d },
    } as unknown as http.ServerResponse
    await tryHandleKanban({
      req, res, path: '/api/kanban', method: 'POST', url: new URL('http://x/api/kanban'),
    } as never)
    return JSON.parse(chunk)
  }

  it('warns without a project and stays quiet with one', async () => {
    initDatabase(':memory:')
    expect((await createCard({ title: 'projekt nelkul' })).warning).toBeTruthy()
    expect((await createCard({ title: 'projekttel', project: 'marveen' })).warning).toBeUndefined()
  })
})
