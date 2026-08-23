import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { embedText, backfillEmbeddings, initDatabase, getDb } from '../db.js'

// IN-MEMORY, and not merely for speed: `initDatabase()` with no argument
// creates store/claudeclaw.db under the checkout, which is one of the markers
// the live-install gate looks for -- so a single run would leave the worktree
// unable to run the suite again, with an error message about production
// safety. Measured the hard way at 23:21 on 2026-08-22.

// THE BUG (card a6685b0f, measured 2026-08-21 02:25 and again 08-22).
//
// For two nights in a row the dream-engine reported "200 memories vectorized"
// -- the SAME 200 -- while the total climbed from 242 to 361. The vectorizer
// had stopped on 08-19 and nothing said so, because every layer collapsed
// failure into the shape of success:
//
//   generateEmbedding  caught everything and returned `null`
//   backfillEmbeddings counted only successes and returned that number
//   POST /backfill     answered {"ok":true,"count":0} with HTTP 200
//
// `count: 0` therefore meant BOTH "every memory already has a vector" and
// "all 161 attempts failed, Ollama is not running", and no caller could tell
// them apart. The dashboard button showed a cheerful "0 memories vectorized".
//
// The fleet already knew: the dream-engine skill carries a note saying the
// count is ambiguous and not to judge the state from it. A documented
// workaround is not a fix -- the knowledge was there and the bug stayed.
//
// AND THE REASON THESE TESTS DRIVE A FAKE SERVER RATHER THAN THE REAL ONE:
// Ollama is running again on this machine (since 08-21 08:54) and coverage is
// back to 546/546. The symptom is gone; the defect is not. A test that
// depended on Ollama being down would now pass for the wrong reason -- and on
// the day someone stops the service it would flip, having measured nothing in
// between.

const servers: Server[] = []

beforeAll(() => {
  process.env.NODE_ENV = 'test'
  initDatabase(':memory:')
})

function fakeOllama(handler: (url: string) => { status: number; body: string }): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const { status, body } = handler(req.url ?? '')
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(body)
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`)
    })
  })
}

/** A port nothing listens on. Reserved by binding, then released. */
async function deadUrl(): Promise<string> {
  const url = await fakeOllama(() => ({ status: 200, body: '{}' }))
  const server = servers.pop()!
  await new Promise<void>((r) => server.close(() => r()))
  return url
}

afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()))
})

describe('embedText -- the reason travels with the failure', () => {
  it('reports a refused connection, and names the URL it tried', async () => {
    const res = await embedText('barmi', await deadUrl())
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toMatch(/127\.0\.0\.1/)
  })

  it('reports a 404 -- the path that used to log NOTHING AT ALL', async () => {
    // A model that was never pulled answers 404 with a JSON body that has no
    // `embedding` field. The old code did not throw, so it never reached the
    // debug log either: it just returned null. "Ollama is down" at least left
    // a trace; "you never pulled nomic-embed-text" left none.
    const url = await fakeOllama(() => ({ status: 404, body: '{"error":"model \'nomic-embed-text\' not found"}' }))
    const res = await embedText('barmi', url)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toContain('HTTP 404')
    expect(res.error).toContain('nomic-embed-text')
  })

  it('rejects a 200 that carries no vector, instead of treating it as empty', async () => {
    const url = await fakeOllama(() => ({ status: 200, body: '{"done":true}' }))
    const res = await embedText('barmi', url)
    expect(res.ok).toBe(false)
    if (res.ok) throw new Error('unreachable')
    expect(res.error).toMatch(/nem adott vektort/)
  })

  it('rejects an EMPTY vector too -- a zero-length array is not an embedding', async () => {
    const url = await fakeOllama(() => ({ status: 200, body: '{"embedding":[]}' }))
    const res = await embedText('barmi', url)
    expect(res.ok).toBe(false)
  })

  it('returns the vector on the happy path', async () => {
    const url = await fakeOllama(() => ({ status: 200, body: '{"embedding":[0.1,0.2,0.3]}' }))
    const res = await embedText('barmi', url)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('unreachable')
    expect(res.embedding).toEqual([0.1, 0.2, 0.3])
  })
})

describe('backfillEmbeddings -- "nothing to do" and "nothing worked" are different', () => {
  const AGENT = 'embed-backfill-test-agent'

  function insertUnvectorized(n: number): void {
    const db = getDb()
    const now = Math.floor(Date.now() / 1000)
    const stmt = db.prepare(
      `INSERT INTO memories (chat_id, topic_key, content, sector, salience,
       created_at, accessed_at, agent_id, category, auto_generated, keywords)
       VALUES (?, NULL, ?, 'semantic', 1.0, ?, ?, ?, 'cold', 0, NULL)`,
    )
    for (let i = 0; i < n; i++) stmt.run('test-chat', `backfill row ${i} ${Math.random()}`, now, now, AGENT)
  }

  /** Give every existing row a vector, so `pending` counts only what we add. */
  function clearAll(): void {
    getDb().prepare('UPDATE memories SET embedding = ?').run(JSON.stringify([0.1]))
  }

  it('an empty queue is ok:true with zero counts -- the ONE case that may be quiet', () => {
    clearAll()
    return backfillEmbeddings('http://127.0.0.1:1').then((r) => {
      expect(r.pending).toBe(0)
      expect(r.ok).toBe(true)
      expect(r.embedded).toBe(0)
      expect(r.failed).toBe(0)
      expect(r.error).toBeNull()
    })
  })

  it('a queue that fails completely is ok:FALSE with the same zero embedded count', async () => {
    // This is the whole card in one assertion: `embedded: 0` above and
    // `embedded: 0` here, and the caller can now tell them apart.
    clearAll()
    insertUnvectorized(5)
    const r = await backfillEmbeddings(await deadUrl())
    expect(r.ok).toBe(false)
    expect(r.pending).toBe(5)
    expect(r.embedded).toBe(0)
    expect(r.failed).toBeGreaterThan(0)
    expect(r.error).not.toBeNull()
    expect(r.remaining).toBe(5)
  })

  it('gives up after 3 consecutive failures instead of timing out 161 times', async () => {
    // With Ollama down and 161 rows waiting, the old loop ran every request to
    // its timeout with a 100 ms sleep between -- minutes of work to learn
    // nothing. Three in a row is a dead backend, not a bad record.
    clearAll()
    insertUnvectorized(10)
    const r = await backfillEmbeddings(await deadUrl())
    expect(r.aborted).toBe(true)
    expect(r.failed).toBe(3)
    expect(r.pending).toBe(10)
  })

  it('embeds everything when the backend answers, and says so', async () => {
    clearAll()
    insertUnvectorized(4)
    const url = await fakeOllama(() => ({ status: 200, body: '{"embedding":[0.5,0.5]}' }))
    const r = await backfillEmbeddings(url)
    expect(r.ok).toBe(true)
    expect(r.pending).toBe(4)
    expect(r.embedded).toBe(4)
    expect(r.failed).toBe(0)
    expect(r.remaining).toBe(0)
    expect(r.aborted).toBe(false)
  })

  it('a PARTIAL run is not ok, and keeps the FIRST reason -- not the last', async () => {
    // The nastiest shape: some rows got vectors, so `embedded > 0` looks like
    // success, while others silently did not.
    //
    // KET KULONBOZO HIBA KELL, ES EZ DIDI LELETE (2026-08-23). Korabban a
    // fixture EGYETLEN hibat gyartott, tehat az ELSO es az UTOLSO ok UGYANAZ a
    // string volt -- a `keeps the first reason` allitas a teszt NEVEBEN allt, es
    // sehol az allitasokban. Didi megmerte: az `if (error === null)` sort
    // last-wins-re forditva mind a 17 teszt ZOLD maradt.
    //
    // MIERT SZAMIT EPP ITT: a db.ts kommentje kimondja, miert az elso ok kell --
    // a kesobbiek rendszerint ugyanannak a timeoutnak az ismetlesei, az elso van
    // legkozelebb az okhoz. A kartya sajat forgatokonyveben ez a kulonbseg:
    // ha az Ollama FUTAS KOZBEN all le, az elso hiba a valodi ok (connection
    // refused), a tobbi mar a kovetkezmenye.
    clearAll()
    insertUnvectorized(5)
    let call = 0
    const url = await fakeOllama(() => {
      call++
      if (call === 2) return { status: 500, body: '{"error":"overloaded"}' }
      if (call === 4) return { status: 404, body: '{"error":"model not found"}' }
      return { status: 200, body: '{"embedding":[0.5,0.5]}' }
    })
    const r = await backfillEmbeddings(url)
    expect(r.ok).toBe(false)
    expect(r.embedded).toBe(3)
    expect(r.failed).toBe(2)
    expect(r.remaining).toBe(2)
    // A ket hiba NEM egymast koveti (2. es 4.), tehat a 3-as megszakitas nem
    // lep be -- ezert all az `aborted: false`.
    expect(r.aborted).toBe(false)
    // MINDKET IRANY, kulonben a fixture megint nem tud merni:
    expect(r.error).toContain('500')
    expect(r.error).not.toContain('404')
  })

  it('a SIKERES sor nullazza a hibaszamlalot -- "harom EGYMAST KOVETO", nem "harom osszesen"', async () => {
    // DIDI LELETE 2 (2026-08-23): a `consecutiveFailures = 0` visszaallitas
    // fedetlen volt. Kivéve a sort, mind a 17 teszt zold maradt -- pedig ez az
    // EGYETLEN sor, ami a "harom egymast koveto"-t megkulonbozteti a "harom
    // osszesen"-tol.
    //
    // MIKOR OKOZ KART: szorvanyos hibaknal (egy tul hosszu tartalom, egy
    // idozites) a backfill a 3. OSSZESITETT hiba utan feladna, mikozben a
    // backend el. A valasz ilyenkor `ok:false`, tehat nem nema -- de a
    // `remaining` indokolatlanul magas marad, es a kovetkezo hivas ugyanott
    // all meg. Csendes helyben jaras.
    clearAll()
    insertUnvectorized(6)
    let call = 0
    const url = await fakeOllama(() => {
      call++
      // Minden MASODIK hivas bukik: harom hiba OSSZESEN, de sosem harom egymas
      // utan -- a koztuk levo siker mindig nullaz.
      return call % 2 === 0
        ? { status: 500, body: '{"error":"overloaded"}' }
        : { status: 200, body: '{"embedding":[0.5,0.5]}' }
    })
    const r = await backfillEmbeddings(url)
    expect(r.aborted).toBe(false)
    expect(r.embedded).toBe(3)
    expect(r.failed).toBe(3)
  })
})
