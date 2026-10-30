/**
 * Card baabe0ba (port of upstream 5b404c44d, the dashboard half). The PUT guard only protects the
 * dashboard if the dashboard SENDS the version it read:
 *   - the edit form rebuilds its body from the fields, so it sends `expected_version` (taken when
 *     the form was filled), and on a stale 409 it stays open and says so;
 *   - the two inline edits (assignee, parent) send `{ ...card }`, which carries `card.version` --
 *     but only if the card objects the board holds HAVE a version, so the list and the by-id read
 *     must carry it.
 * The form handler is the REAL one, sliced out of web/app.js and run on a fake DOM (the house
 * pattern of kanban-due-modal.test.ts). The two inline edits sit deep inside showCardDetail and are
 * pinned by source shape only; that is weaker, and said so here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import type http from 'node:http'
import { initDatabase, createKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, '..', '..', 'web', 'app.js'), 'utf8')

function sliceSaveHandler(): string {
  const head = "document.getElementById('saveCardBtn').addEventListener('click', async () => {"
  const at = src.indexOf(head)
  if (at < 0) throw new Error('save handler missing from web/app.js')
  let depth = 0
  for (let j = src.indexOf('{', at + head.length - 1); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 2) // include the closing ")"
  }
  throw new Error('unbalanced braces in the save handler')
}

interface Sent { url: string; init: { method: string; body: string } }

/** Run the real save handler: the form is "editing card X, filled at version `baseVersion`". */
async function saveEdit(baseVersion: number | null, respond: (sent: Sent) => { status: number; body: unknown }) {
  const sent: Sent[] = []
  const toasts: Array<{ msg: string; ms?: number }> = []
  const calls = { closeModal: 0, loadKanban: 0 }
  let handler: (() => Promise<void>) | undefined
  const values: Record<string, string> = {
    cardTitle: 'T', cardDesc: 'typed description', cardAssignee: 'dex', cardPriority: 'normal',
    cardProject: '', cardDue: '', cardEditId: 'CARD0001', cardEditStatus: 'planned',
  }
  const el = (id: string) => ({
    value: values[id], dataset: {}, focus() {},
    addEventListener(_: string, fn: () => Promise<void>) { if (id === 'saveCardBtn') handler = fn },
  })
  const document = { getElementById: el }
  const fetch = async (url: string, init: { method: string; body: string }) => {
    const s = { url, init }
    sent.push(s)
    const r = respond(s)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
  }
  new Function(
    'document', 'fetch', 'showToast', 't', 'closeModal', 'cardModalOverlay', 'loadKanban',
    'toastWithWarning', 'mvErrText', 'dueDatePatch', 'BASE',
    `let cardEditBaseVersion = BASE\n${sliceSaveHandler()}`,
  )(
    document, fetch,
    (msg: string, ms?: number) => toasts.push({ msg, ms }),
    (k: string) => k, () => { calls.closeModal++ }, {}, () => { calls.loadKanban++ },
    () => {}, (e: unknown) => String(e), () => ({}), baseVersion,
  )
  // addEventListener registered the handler on the fake element of the closure above
  await handler!()
  return { sent, toasts, calls }
}

describe('the edit form sends the version it was filled from', () => {
  it('a card with a version: the PUT carries expected_version', async () => {
    const r = await saveEdit(7, () => ({ status: 200, body: { ok: true, version: 8 } }))
    expect(r.sent).toHaveLength(1)
    expect(r.sent[0].init.method).toBe('PUT')
    expect(JSON.parse(r.sent[0].init.body).expected_version).toBe(7)
    expect(r.calls.closeModal).toBe(1)
  })

  it('version 0 is a version (not "no version")', async () => {
    const r = await saveEdit(0, () => ({ status: 200, body: { ok: true } }))
    expect(JSON.parse(r.sent[0].init.body).expected_version).toBe(0)
  })

  it('no version known (server without versions): the PUT goes unchecked, as before', async () => {
    const r = await saveEdit(null, () => ({ status: 200, body: { ok: true } }))
    expect(JSON.parse(r.sent[0].init.body)).not.toHaveProperty('expected_version')
  })

  it('on a stale 409 the modal STAYS OPEN and says so (the typed text is the only copy)', async () => {
    const r = await saveEdit(3, () => ({ status: 409, body: { conflict: 'stale_version', current_version: 4 } }))
    expect(r.calls.closeModal).toBe(0)
    expect(r.calls.loadKanban).toBe(0)
    expect(r.toasts.map((x) => x.msg)).toEqual(['kanban.toast.stale_version_form'])
  })

  it('any other failure is still the generic save error', async () => {
    const r = await saveEdit(3, () => ({ status: 500, body: { error: 'boom' } }))
    expect(r.toasts[0].msg).toBe('kanban.toast.save_error_msg')
  })
})

describe('the inline edits send the whole card, and take the returned version', () => {
  // Source-shape pins: the closures sit inside showCardDetail and cannot be sliced out cheaply.
  it('assignee: sends { ...card } (version included), handles the stale 409, adopts the new version', () => {
    expect(src).toContain("body: JSON.stringify({ ...card, assignee: newVal, actor: 'dashboard' })")
    expect(src).toMatch(/if \(r\.status === 409\)[\s\S]{0,300}e\.conflict === 'stale_version'[\s\S]{0,300}kanban\.toast\.stale_version/)
    expect(src).toMatch(/Number\.isInteger\(saved\.version\)\) card\.version = saved\.version[\s\S]{0,40}card\.assignee = newVal/)
  })

  it('parent: sends { ...card } (version included), handles the stale 409, adopts the new version', () => {
    expect(src).toContain("body: JSON.stringify({ ...card, parent_id: newParentId, actor: 'dashboard' })")
    expect(src).toMatch(/Number\.isInteger\(saved\.version\)\) card\.version = saved\.version\s*\n\s*card\.parent_id = newParentId/)
    expect(src).toMatch(/r\.status === 409 && \(await r\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)\.conflict === 'stale_version'/)
  })

  it('the form is filled with the version at FILL time', () => {
    expect(src).toMatch(/cardEditBaseVersion = Number\.isInteger\(card\.version\) \? card\.version : null\s*\n\s*document\.getElementById\('cardEditStatus'\)\.value = card\.status/)
  })
})

describe('the card objects the board holds carry a version', () => {
  beforeEach(() => { initDatabase(':memory:') })

  async function get(path: string): Promise<any> {
    const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
    let sent = ''
    const res = {
      writeHead: vi.fn(), setHeader: vi.fn(),
      end: vi.fn((c?: unknown) => { if (c != null) sent += String(c) }),
    } as unknown as http.ServerResponse
    const url = new URL(`http://localhost${path}`)
    expect(await tryHandleKanban({ req, res, path: url.pathname, method: 'GET', url } as never)).toBe(true)
    return JSON.parse(sent)
  }

  it('GET /api/kanban (the list) and GET /api/kanban/<id> both return version', async () => {
    createKanbanCard({ id: 'UI000001', title: 'Card' })
    const list = await get('/api/kanban')
    const cards = Array.isArray(list) ? list : list.cards
    expect(cards.find((c: any) => c.id === 'UI000001').version).toBe(0)
    expect((await get('/api/kanban/UI000001')).version).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Card 03d531bf (baabe0ba F5), browser-QA findings A, B, C on the running instance.
// ---------------------------------------------------------------------------------------------

/** Slice a brace-balanced block out of web/app.js, from the first character of `head`. */
function sliceBlock(head: string, trail = ''): string {
  const at = src.indexOf(head)
  if (at < 0) throw new Error(`missing from web/app.js: ${head}`)
  let depth = 0
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1) + trail
  }
  throw new Error(`unbalanced braces after: ${head}`)
}

describe('the detail modal status change (mandark A + B)', () => {
  // The real `save` closure of the status select, sliced out and run on fakes.
  const saveSrc = sliceBlock('const save = async () => {\n      const newVal = sel.value\n      if (newVal === current) {')

  async function changeStatus(respond: (sent: { url: string; init: { method: string; body: string } }) => { status: number; body: unknown }) {
    const sent: Array<{ url: string; init: { method: string; body: string } }> = []
    const toasts: Array<{ msg: string; ms?: number }> = []
    const card: { id: string; status: string; version?: number } = { id: 'CARD0001', status: 'planned', version: 4 }
    const restored: string[] = []
    let reloads = 0
    const fetch = async (url: string, init: { method: string; body: string }) => {
      const s = { url, init }
      sent.push(s)
      const r = respond(s)
      return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
    }
    const showToast = (msg: string, ms?: number) => toasts.push({ msg, ms })
    // The real refusalToast, so the 409 path is the shipped one.
    const refusalToast = new Function('showToast', 't', `${sliceBlock('async function refusalToast(r, fallbackMsg) {')}\nreturn refusalToast`)(showToast, (k: string) => k)
    const save = new Function(
      'fetch', 'card', 'sel', 'current', 'restore', 'kanbanMoveActor', 'refusalToast', 't', 'showToast', 'loadKanban',
      `return (${saveSrc.replace(/^const save = /, '')})`,
    )(
      fetch, card, { value: 'in_progress' }, 'planned', (x: string) => restored.push(x), () => 'isti', refusalToast,
      (k: string) => k, showToast, () => { reloads++ },
    )
    await save()
    return { sent, toasts, card, restored, reloads }
  }

  it('A: the new version from the /move answer lands on the open card, so the next PUT is not a false 409', async () => {
    const r = await changeStatus(() => ({ status: 200, body: { ok: true, changed: true, version: 5 } }))
    expect(r.card).toMatchObject({ status: 'in_progress', version: 5 })
    expect(r.reloads).toBe(1)
  })

  it('A: an answer without a version (older server) leaves the card version alone', async () => {
    const r = await changeStatus(() => ({ status: 200, body: { ok: true, changed: true } }))
    expect(r.card).toMatchObject({ status: 'in_progress', version: 4 })
  })

  it('B: the move names the status the modal shows as expected_status', async () => {
    const r = await changeStatus(() => ({ status: 200, body: { ok: true, changed: true, version: 5 } }))
    expect(JSON.parse(r.sent[0].init.body)).toMatchObject({ status: 'in_progress', expected_status: 'planned' })
  })

  it('B: a stale 409 shows the stale toast, restores the old label and reloads the board', async () => {
    const r = await changeStatus(() => ({ status: 409, body: { error: 'status_conflict', current_status: 'done', expected_status: 'planned' } }))
    expect(r.toasts.map((x) => x.msg)).toEqual(['kanban.toast.stale_version'])
    expect(r.restored).toEqual(['planned'])
    expect(r.reloads).toBe(1)
    // the card keeps its old status AND version: a following whole-card PUT must be refused too
    expect(r.card).toMatchObject({ status: 'planned', version: 4 })
  })

  it('B control: any other refusal keeps its own message and does not reload', async () => {
    const r = await changeStatus(() => ({ status: 422, body: { error: 'close gate says no' } }))
    expect(r.toasts.map((x) => x.msg)).toEqual(['close gate says no'])
    expect(r.reloads).toBe(0)
  })
})

describe('refusalToast and the board move paths (mandark B)', () => {
  it('refusalToast: status_conflict -> stale toast + true; other errors -> their text + false', async () => {
    const toasts: string[] = []
    const refusalToast = new Function('showToast', 't', `${sliceBlock('async function refusalToast(r, fallbackMsg) {')}\nreturn refusalToast`)(
      (m: string) => toasts.push(m), (k: string) => k)
    const resp = (status: number, body: unknown) => ({ status, json: async () => body })
    expect(await refusalToast(resp(409, { error: 'status_conflict' }), 'fallback')).toBe(true)
    expect(await refusalToast(resp(409, { error: 'something else' }), 'fallback')).toBe(false)
    expect(await refusalToast(resp(500, null), 'fallback')).toBe(false)
    expect(toasts).toEqual(['kanban.toast.stale_version', 'something else', 'fallback'])
  })

  it('kanbanShownStatus reads the status the loaded board shows for the card', () => {
    const fn = new Function('kanbanCards', `${sliceBlock('function kanbanShownStatus(cardId) {')}\nreturn kanbanShownStatus`)(
      [{ id: 'a', status: 'testing' }])
    expect(fn('a')).toBe('testing')
    expect(fn('gone')).toBeUndefined()
  })

  it('EVERY /move call in the dashboard sends expected_status (population derived from the source)', () => {
    const calls = [...src.matchAll(/\/api\/kanban\/\$\{encodeURIComponent\([A-Za-z.]+\)\}\/move`/g)]
    expect(calls.length).toBeGreaterThanOrEqual(3) // drag-drop, touch drop, modal status select
    for (const m of calls) {
      const body = src.slice(m.index!, m.index! + 400).match(/body: JSON\.stringify\(\{[^}]*\}\)/)
      expect(body, `no body near /move at ${m.index}`).not.toBeNull()
      expect(body![0], body![0]).toContain('expected_status')
    }
  })

  it('both board paths reload the board after a stale 409 (the touch path used to return early)', () => {
    expect(src).toMatch(/if \(!r\.ok\) await refusalToast\(r, t\('kanban\.toast\.move_error'\)\)\n\s*loadKanban\(\)/)
    expect(src).toMatch(/if \(!r\.ok\) \{ if \(await refusalToast\(r, t\('kanban\.toast\.move_error'\)\)\) loadKanban\(\); return \}/)
  })
})

describe('the toast helper keeps ONE hide timer (mandark C)', () => {
  function makeToast() {
    const classes = new Set<string>()
    const toast = {
      textContent: '',
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    }
    const showToast = new Function('toast', 'window', `let toastHideTimer = null\n${sliceBlock('function showToast(msg, duration = 3000) {')}\nreturn showToast`)(toast, {})
    return { showToast, visible: () => classes.has('visible'), toast }
  }

  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('a long toast shown right after a short one is NOT cut short by the short one\'s timer', () => {
    const { showToast, visible, toast } = makeToast()
    showToast('card updated', 3000)
    vi.advanceTimersByTime(1000)
    showToast('stale, reopen the card', 6000)
    vi.advanceTimersByTime(2500) // the first toast's timer would fire at 3000 total = 2000 into the second
    expect(visible()).toBe(true)
    expect(toast.textContent).toBe('stale, reopen the card')
    vi.advanceTimersByTime(3600)
    expect(visible()).toBe(false)
  })

  it('a single toast still hides after its own duration', () => {
    const { showToast, visible } = makeToast()
    showToast('x', 3000)
    vi.advanceTimersByTime(2999)
    expect(visible()).toBe(true)
    vi.advanceTimersByTime(2)
    expect(visible()).toBe(false)
  })
})
