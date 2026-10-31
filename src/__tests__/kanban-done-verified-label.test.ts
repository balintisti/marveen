// AZ IGAZOLT CIMKE A DONE-IGAZOLASSAL EGYUTT JON -- kartya c6c8f00e (Isti, Telegram 8635).
//
// A done-kapu a KESZ-IGAZOLAS kommentet megkoveteli, a cimket (amire az archivalo sopres
// var) nem: az kezi lepes volt, es elmaradt (marveen cenzusa 2026-10-30: 10-07 ota 44 done
// kartya cimke nelkul, 34-en volt igazolas). Most a statusz-iras maga teszi fel, ha a kartya
// igazolassal er done-ba, es leveszi, ha kikerul onnan. Mindket ajto (move, PUT), a kapu
// megkerulese (db-szintu mozgatas igazolas nelkul), a hianyzo cimke es az ismetles.
import { describe, it, expect, beforeEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import {
  initDatabase, createKanbanCard, addKanbanComment, moveKanbanCard, createLabel, getLabelsForCard,
  updateKanbanCard, getKanbanCard, addLabelToCard,
} from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'

beforeEach(() => {
  initDatabase(':memory:')
})

async function call(method: 'POST' | 'PUT', path: string, body?: unknown) {
  const payloadIn = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Object.assign(Readable.from(payloadIn), { method, headers: {} }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const handled = await tryHandleKanban({
    req, res, path, method, url: new URL('http://x' + path),
  } as never)
  expect(handled, `a route nem kezelte: ${method} ${path}`).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

const PROOF = 'KESZ-IGAZOLAS: ELES | a futo build tartalmazza'
const labelNames = (id: string) => getLabelsForCard(id).map((l) => l.name)

function cardInTesting(id: string, proof: boolean) {
  createKanbanCard({ id, title: 'Kartya', status: 'planned' })
  moveKanbanCard(id, 'testing', 0, 'friday')
  if (proof) addKanbanComment(id, 'friday', PROOF)
}

describe('az IGAZOLT cimke a done-igazolassal egyutt jon', () => {
  beforeEach(() => {
    createLabel({ id: '0554c87b', name: 'IGAZOLT', color: '#16a34a' })
  })

  it('move done-ba igazolassal: a kartya megkapja a cimket', async () => {
    cardInTesting('m', true)
    expect(labelNames('m')).toEqual([])
    const r = await call('POST', '/api/kanban/m/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(labelNames('m')).toEqual(['IGAZOLT'])
  })

  it('PUT status=done igazolassal: ugyanigy', async () => {
    cardInTesting('p', true)
    const r = await call('PUT', '/api/kanban/p', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(labelNames('p')).toEqual(['IGAZOLT'])
  })

  it('kontroll: igazolas nelkul a move 409, es cimke sincs', async () => {
    cardInTesting('n', false)
    const r = await call('POST', '/api/kanban/n/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(409)
    expect(getKanbanCard('n')!.status).toBe('testing')
    expect(labelNames('n')).toEqual([])
  })

  it('a kaput megkerulo db-szintu done-iras igazolas nelkul NEM kap cimket', () => {
    cardInTesting('b', false)
    expect(moveKanbanCard('b', 'done', 0, 'scheduler')).toBe('moved')
    expect(labelNames('b')).toEqual([])
    updateKanbanCard('b', { status: 'testing' }, 'friday')
    updateKanbanCard('b', { status: 'done' }, 'friday')
    expect(labelNames('b')).toEqual([])
  })

  it('done -> testing (move) leveszi, done -> waiting (PUT) is', async () => {
    cardInTesting('r', true)
    await call('POST', '/api/kanban/r/move', { status: 'done', actor: 'friday' })
    expect(labelNames('r')).toEqual(['IGAZOLT'])
    expect((await call('POST', '/api/kanban/r/move', { status: 'testing', actor: 'friday' })).status).toBe(200)
    expect(labelNames('r')).toEqual([])
    await call('POST', '/api/kanban/r/move', { status: 'done', actor: 'friday' })
    expect(labelNames('r')).toEqual(['IGAZOLT'])
    expect((await call('PUT', '/api/kanban/r', { status: 'waiting', actor: 'friday' })).status).toBe(200)
    expect(labelNames('r')).toEqual([])
  })

  it('a kartya mas cimkeit nem bantja, es a done-on beluli mozgatas nem nyul a cimkehez', async () => {
    createLabel({ id: 'masik', name: 'FRONTEND', color: '#000000' })
    cardInTesting('o', true)
    addLabelToCard('o', 'masik')
    await call('POST', '/api/kanban/o/move', { status: 'done', actor: 'friday' })
    expect(labelNames('o')).toEqual(['FRONTEND', 'IGAZOLT'])
    expect(moveKanbanCard('o', 'done', 5, 'friday')).toBe('moved')
    expect(labelNames('o')).toEqual(['FRONTEND', 'IGAZOLT'])
    await call('POST', '/api/kanban/o/move', { status: 'testing', actor: 'friday' })
    expect(labelNames('o')).toEqual(['FRONTEND'])
  })
})

describe('ha az IGAZOLT cimke nem letezik', () => {
  it('a done-mozgatas sikerul, cimke nem keletkezik, es a cimkek tablaja ures marad', async () => {
    cardInTesting('x', true)
    const r = await call('POST', '/api/kanban/x/move', { status: 'done', actor: 'friday' })
    expect(r.status).toBe(200)
    expect(getKanbanCard('x')!.status).toBe('done')
    expect(labelNames('x')).toEqual([])
  })
})
