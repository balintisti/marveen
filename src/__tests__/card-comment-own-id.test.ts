/**
 * card-comment.sh: the read-back compares OUR comment, found by the id the POST returned,
 * not the last one in the list (card 1398a554).
 *
 * MEASURED (mandark, on the live board): 95 cases in one day where two different authors
 * wrote to the same card within 120 s, the tightest 1 s apart. With `cs[-1]` a comment that
 * lands between our POST and our GET is compared with our body, and the guard cries
 * GYANUS on a correct send. A guard that fires at random is noise within a week.
 *
 * A fake dashboard on 127.0.0.1 (MARVEEN_API_BASE / MARVEEN_TOKEN_FILE, the agent-msg.sh
 * overrides) plays each case; the script never reaches the real board.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'card-comment.sh')

type Comment = { id: number; author: string; content: string }
type Mode = 'race' | 'stored-altered' | 'id-missing'

let server: Server | undefined
afterEach(() => { server?.close(); server = undefined })

function fakeDashboard(mode: Mode): Promise<string> {
  const comments: Comment[] = [{ id: 1, author: 'didi', content: 'older comment' }]
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST') {
        const { author, content } = JSON.parse(raw)
        const id = comments.length + 100
        comments.push({ id, author, content: mode === 'stored-altered' ? content.slice(0, 10) : content })
        // Another agent writes to the same card before our read-back.
        comments.push({ id: id + 1, author: 'dexter', content: 'someone else, a second later' })
        if (mode === 'id-missing') comments.splice(comments.findIndex((c) => c.id === id), 1)
        res.end(JSON.stringify({ id, card_id: 'x', author, content }))
        return
      }
      res.end(JSON.stringify(comments))
    })
  })
  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address()
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`)
    })
  })
}

async function send(mode: Mode): Promise<{ status: number | null; out: string }> {
  const base = await fakeDashboard(mode)
  const dir = mkTmp('card-comment-id-')
  const tok = join(dir, 'token')
  const body = join(dir, 'body.txt')
  writeFileSync(tok, 'fake-token\n')
  writeFileSync(body, 'our comment, long enough that a prefix would not tell it apart\n')
  const child = spawn('bash', [SCRIPT, 'friday', 'abcd1234', body], {
    env: { ...process.env, MARVEEN_API_BASE: base, MARVEEN_TOKEN_FILE: tok },
  })
  let out = ''
  child.stdout.on('data', (c) => { out += c })
  child.stderr.on('data', (c) => { out += c })
  const status = await new Promise<number | null>((resolve) => child.on('close', resolve))
  return { status, out }
}

describe('card-comment.sh -- the read-back finds our own comment by id', () => {
  it('another agent commenting right after us is NOT a mismatch (the old cs[-1] said GYANUS)', async () => {
    const r = await send('race')
    expect(r.out).toMatch(/^OK kartya=abcd1234 .*id=101/m)
    expect(r.status).toBe(0)
  })

  it('CONTROL: our own stored comment differing from what we sent is still caught', async () => {
    const r = await send('stored-altered')
    expect(r.out).toMatch(/GYANUS/)
    expect(r.status).toBe(1)
  })

  it('our id absent from the read-back list is reported, not compared with a neighbour', async () => {
    const r = await send('id-missing')
    expect(r.out).toMatch(/GYANUS kartya=abcd1234: a 101 id-ju kommentunk NINCS/)
    expect(r.status).toBe(1)
  })
})
