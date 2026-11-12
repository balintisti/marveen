// GET /api/kanban/summary?hours= -- the window validation. The route had no test:
// the ceiling (168) and the floor (> 0) could be deleted with the suite staying green.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import { initDatabase } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => { initDatabase(':memory:') })

async function get(query: string): Promise<{ status: number; payload: any }> {
  const req = Object.assign(Readable.from([]), { method: 'GET', headers: {} }) as unknown as http.IncomingMessage
  let status = 0
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string | Buffer) { if (data) chunk = data.toString() },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path: '/api/kanban/summary', method: 'GET', url: new URL(`http://x/api/kanban/summary${query}`),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

describe('GET /api/kanban/summary hours validation', () => {
  it.each(['?hours=0', '?hours=-1', '?hours=168.01', '?hours=169', '?hours=1000000', '?hours=abc', '?hours=Infinity', '?hours=NaN'])(
    '%s is refused with 400 and the range in the message',
    async (q) => {
      const r = await get(q)
      expect(r.status).toBe(400)
      expect(r.payload.error).toContain('(0, 168]')
      expect(r.payload.agents).toBeUndefined()
    },
  )

  it.each(['', '?hours=24', '?hours=168', '?hours=0.5'])('%s is accepted and answers the summary shape', async (q) => {
    const r = await get(q)
    expect(r.status).toBe(200)
    expect(Array.isArray(r.payload.agents)).toBe(true)
    expect(r.payload.owner_waiting).toEqual({ count: 0, cards: [] })
  })

  it('the window follows hours: since moves with it', async () => {
    const day = (await get('?hours=24')).payload.since
    const week = (await get('?hours=168')).payload.since
    expect(day - week).toBeGreaterThanOrEqual(144 * 3600 - 2)
    expect(day - week).toBeLessThanOrEqual(144 * 3600 + 2)
  })
})
