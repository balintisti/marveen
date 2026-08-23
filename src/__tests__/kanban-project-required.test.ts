// Card creation used to accept an empty `project` in complete silence: the
// response was `{ok:true,id:"..."}` and nothing anywhere said a field had been
// left behind. Card b7b0f400; it is the SOURCE of card e369adab.
//
// Why a source and not history: measured on the live board 2026-08-23 13:2x
// CEST, 810 open cards --
//     created in the last 1 day .... 168, empty project 81 (48%)
//     created in the last 7 days ... 794, empty project 445 (56%)
// e369adab could not backfill its way out of that, because the backfill and the
// leak run at the same time. Marveen's call was to fix the source first and
// leave the 228 undecidable cards empty, on the grounds that an empty field is
// visible and a wrongly filled one is not.
//
// The measurement that decided the SHAPE of the fix: the documented example is
// the leak. `CLAUDE.md` in the install root carries 7 POST /api/kanban examples
// and NOT ONE sends `project`. So the omission is what the docs teach, and a
// fix that depends on callers remembering better would be, in Isti's words, not
// a solution at all.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { initDatabase, getKanbanCard, createKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import { kanbanProjectWarning } from '../web/kanban-project-warning.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function createCard(body: unknown): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 0
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path: '/api/kanban', method: 'POST', url: new URL('http://x/api/kanban'),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('kanbanProjectWarning -- the predicate', () => {
  it('fires on every shape of "not filled in"', () => {
    for (const v of [undefined, null, '', '   ', '\n', 0, false, {}]) {
      expect(kanbanProjectWarning(v), `bemenet: ${JSON.stringify(v)}`).toBeTruthy()
    }
  })

  it('stays quiet on a real value', () => {
    expect(kanbanProjectWarning('marveen')).toBeUndefined()
    expect(kanbanProjectWarning('delta-crm')).toBeUndefined()
    // Whitespace around a real value is still a real value -- the warning must
    // not punish formatting.
    expect(kanbanProjectWarning('  marveen  ')).toBeUndefined()
  })

  it('the message NAMES the way out, it does not just report a fault', () => {
    // A guard that only says "wrong" leaves the caller where it found them.
    const msg = kanbanProjectWarning(undefined) as string
    expect(msg).toMatch(/project/)
    expect(msg).toMatch(/marveen|delta-crm/)
  })
})

describe('POST /api/kanban -- the empty project stops being silent', () => {
  it('warns IN THE RESPONSE when project is missing', async () => {
    const { status, payload } = await createCard({ title: 'projekt nelkul', status: 'planned' })
    expect(status).toBe(200)
    expect(payload.warning).toBeTruthy()
  })

  it('says NOTHING when project is given -- the warning must not become noise', async () => {
    const { payload } = await createCard({ title: 'van projekt', status: 'planned', project: 'marveen' })
    expect(payload.id).toBeTruthy()
    expect(payload.warning).toBeUndefined()
  })

  // ===== THE CHOICES, LOCKED DOWN =====
  // Marveen's condition on this card: record the DECISION, not only the
  // mechanism. A default that nothing asserts disappears at the next rewrite,
  // and so does a deliberate refusal to add one.

  it('CHOICE: it still CREATES the card -- this is a warning, not a 400', async () => {
    // A hard rejection would break every caller that follows the currently
    // documented example, which is most of them (7 of 7 in the root CLAUDE.md).
    // Breaking the fleet to enforce a field is a worse outcome than the gap.
    const { status, payload } = await createCard({ title: 'megis letrejon', status: 'planned' })
    expect(status).toBe(200)
    expect(getKanbanCard(payload.id)).toBeTruthy()
  })

  it('CHOICE: it does NOT invent a project -- the field stays EMPTY', async () => {
    // Deriving the repo from the assignee would be exactly the failure this
    // warning exists to prevent. An empty field is visible; a wrong one is not,
    // and it would also make the 228 undecidable cards look decided.
    const { payload } = await createCard({ title: 'nem talalunk ki semmit', status: 'planned', assignee: 'dexter' })
    expect(getKanbanCard(payload.id)?.project ?? null).toBeNull()
  })
})

describe('auto-breakdown -- one unattributed parent must not become N unattributed children', () => {
  it('warns when the parent has no project, because the children inherit the gap', () => {
    // The inheritance itself is correct (routes/kanban.ts: `parent.project`).
    // What was silent is inheriting NOTHING: one breakdown multiplies a single
    // missing field into as many gaps as there are subtasks.
    createKanbanCard({ id: 'p0000000', title: 'szulo projekt nelkul', status: 'planned' })
    expect(kanbanProjectWarning(getKanbanCard('p0000000')?.project)).toBeTruthy()
  })

  it('stays quiet when the parent HAS a project', () => {
    createKanbanCard({ id: 'p1111111', title: 'szulo projekttel', status: 'planned', project: 'marveen' })
    expect(kanbanProjectWarning(getKanbanCard('p1111111')?.project)).toBeUndefined()
  })
})
