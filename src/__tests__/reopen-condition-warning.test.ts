// Archiving takes the card's last comment out of sight, and on this board that
// last comment is very often a CONDITIONAL sentence ("reopen if X", "remeasure
// when Y"). Card ade4260a: the rule that produces those sentences is followed,
// and nothing measures the condition afterwards.
//
// jarvis measured the denominator (1271 comments / 411 live cards) and, more
// convincingly, four instances from ONE day whose authors were marveen (2),
// dexter (1) and friday (1) -- the coordinator and the two most disciplined
// writers on the board. That is what moved this from a habit question to a
// mechanism question.
//
// The acceptance criteria below are jarvis's, verbatim in structure (spec
// comment 5805 section 3), and the NEGATIVE one carries the weight: without it
// an always-firing version would look like it works, and an always-firing
// warning is exactly the scenery this card exists to prevent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
import { initDatabase, createKanbanCard, addKanbanComment, getKanbanCard } from '../db.js'
import { tryHandleKanban } from '../web/routes/kanban.js'
import {
  scanUnansweredCondition, isDuplicateArchive, conditionWarningText, foldAccents,
} from '../web/reopen-condition-warning.js'
import {
  readReopenWarnings, summarizeReopenWarnings, appendReopenWarning, reopenWarningLogPath,
} from '../web/reopen-condition-log.js'

let logDir: string
let logFile: string

beforeEach(() => {
  initDatabase(':memory:')
  logDir = mkdtempSync(join(tmpdir(), 'reopen-warn-'))
  logFile = join(logDir, 'warnings.jsonl')
  process.env.MARVEEN_REOPEN_WARNING_LOG = logFile
})

afterEach(() => {
  delete process.env.MARVEEN_REOPEN_WARNING_LOG
  rmSync(logDir, { recursive: true, force: true })
})

async function archive(id: string, body?: unknown): Promise<{ status: number; payload: any }> {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Object.assign(Readable.from(chunks), {
    method: 'POST', headers: {},
  }) as unknown as http.IncomingMessage
  let status = 200
  let chunk = ''
  const res = {
    writeHead(code: number) { status = code; return res },
    setHeader() { return res },
    end(data?: string) { if (data) chunk = data },
  } as unknown as http.ServerResponse
  const path = `/api/kanban/${id}/archive`
  const handled = await tryHandleKanban({
    req, res, path, method: 'POST', url: new URL(`http://x${path}`),
  } as never)
  expect(handled).toBe(true)
  return { status, payload: chunk ? JSON.parse(chunk) : null }
}

function card(id: string, comments: string[]): void {
  createKanbanCard({ id, title: `kartya ${id}`, project: 'marveen' })
  for (const c of comments) addKanbanComment(id, 'friday', c)
}

const FELTETEL = 'UJRANYITASI FELTETEL: ha a formatAsHtmlTable masodik fogyasztot kap, ujra kell merni.'

describe('archive-time warning -- jarvis acceptance criteria (spec 5805, section 3)', () => {
  it('POSITIVE: a card carrying a condition sentence gets a warning, and is STILL archived', async () => {
    card('c-pos', ['elso komment', FELTETEL])
    const { status, payload } = await archive('c-pos')
    expect(status).toBe(200)
    expect(payload.ok).toBe(true)
    expect(payload.warning).toBeTruthy()
    // Warning, not block: the archive must have happened.
    expect(getKanbanCard('c-pos')?.archived_at).toBeTruthy()
  })

  it('NEGATIVE: a card with no condition sentence gets NO warning', async () => {
    card('c-neg', ['csak egy sima jelentes', 'kesz, mehet a lezaras'])
    const { payload } = await archive('c-neg')
    expect(payload).toEqual({ ok: true })
    expect(payload.warning).toBeUndefined()
  })

  it('EXCEPTION: a duplicate merge stays quiet even WITH a condition sentence', async () => {
    card('c-dup', [FELTETEL])
    const { payload } = await archive('c-dup', { reason: 'duplicate', actor: 'friday' })
    expect(payload.warning).toBeUndefined()
  })

  it('LOG: exactly one line for the positive case, and NONE for the other two', async () => {
    card('c-1', [FELTETEL])
    card('c-2', ['sima komment'])
    card('c-3', [FELTETEL])
    await archive('c-1', { actor: 'friday' })
    await archive('c-2', { actor: 'friday' })
    await archive('c-3', { reason: 'duplicate', actor: 'friday' })
    const { entries, malformed } = readReopenWarnings(logFile)
    expect(malformed).toBe(0)
    expect(entries.map(e => e.card)).toEqual(['c-1'])
    expect(entries[0].actor).toBe('friday')
    expect(entries[0].matches).toBe(1)
  })

  it('the log file is not even created when nothing fires', async () => {
    card('c-quiet', ['sima komment'])
    await archive('c-quiet')
    expect(existsSync(logFile)).toBe(false)
  })
})

describe('the "unanswered" half -- what makes this a correspondence and not a keyword hit', () => {
  it('stays quiet when someone replied AFTER the condition sentence', async () => {
    card('c-answered', [FELTETEL, 'megneztem, a feltetel nem all fenn'])
    const { payload } = await archive('c-answered')
    expect(payload.warning).toBeUndefined()
  })

  it('fires again when the LAST comment is a new condition sentence', async () => {
    card('c-again', [FELTETEL, 'megbeszeltuk', FELTETEL])
    const { payload } = await archive('c-again')
    expect(payload.warning).toBeTruthy()
    // Both condition comments are counted, the pointer is the LAST one.
    expect(payload.warning).toMatch(/^2 feltetel-mondat/)
  })

  // A PAIRED sequence: answered / unanswered / answered / unanswered on four
  // separate cards. A version that merely detects the KEYWORD passes the first
  // two tests above; it dies here, because two of these four must stay silent.
  it('PAIRED: follows the answered-ness card by card, not the keyword', async () => {
    const cases: Array<[string, string[], boolean]> = [
      ['p-1', [FELTETEL], true],
      ['p-2', [FELTETEL, 'valasz jott ra'], false],
      ['p-3', ['sima', FELTETEL], true],
      ['p-4', ['sima', 'megint sima'], false],
    ]
    for (const [id, comments] of cases) card(id, comments)
    const got: boolean[] = []
    for (const [id] of cases) got.push(Boolean((await archive(id)).payload.warning))
    expect(got).toEqual(cases.map(c => c[2]))
    // And the log agrees with the responses -- one line per firing, no more.
    expect(readReopenWarnings(logFile).entries.map(e => e.card)).toEqual(['p-1', 'p-3'])
  })

  it('a card with no comments at all is silent (nothing to lose from sight)', async () => {
    createKanbanCard({ id: 'c-empty', title: 'ures', project: 'marveen' })
    expect((await archive('c-empty')).payload.warning).toBeUndefined()
  })
})

describe('the predicate itself', () => {
  it('matches accented Hungarian, because that is how it is actually written', () => {
    const accented = [{ id: 1, card_id: 'x', author: 'a', content: 'Újranyitási feltétel: ha mozdul a tábla.', created_at: 1 }]
    expect(scanUnansweredCondition(accented)).not.toBeNull()
    expect(foldAccents('ÚJRAMÉRENDŐ')).toBe('ujramerendo')
  })

  it('matches all three measured shapes, and nothing else', () => {
    const mk = (content: string) => [{ id: 1, card_id: 'x', author: 'a', content, created_at: 1 }]
    for (const s of ['ujranyitasi feltetel', 'ez ujramerendo', 'mi tenne ervenytelenne']) {
      expect(scanUnansweredCondition(mk(s)), s).not.toBeNull()
    }
    for (const s of ['kesz, lezarva', 'feltetel nelkul', 'ujra megnezem holnap']) {
      expect(scanUnansweredCondition(mk(s)), s).toBeNull()
    }
  })

  it('the CALLER wins over the comment text when the two disagree', () => {
    const comments = [{ id: 1, card_id: 'x', author: 'a', content: 'ez itt duplikatum volt', created_at: 1 }]
    // Caller says it is NOT a duplicate -> the text fallback must not override.
    expect(isDuplicateArchive('lezaras', comments)).toBe(false)
    // Caller said nothing -> the fallback is allowed to speak.
    expect(isDuplicateArchive(undefined, comments)).toBe(true)
    expect(isDuplicateArchive('duplicate', [])).toBe(true)
  })

  it('the message NAMES the count and the comment to look at', () => {
    const text = conditionWarningText({ matches: 3, lastConditionCommentId: 5763, lastCommentId: 5763 })
    expect(text).toMatch(/3 feltetel-mondat/)
    expect(text).toMatch(/5763/)
  })
})

describe('the log answers the reopening condition it was built for', () => {
  it('counts acted vs silent from the board, with no back-filling', () => {
    const entries = [
      { ts: 1, card: 'a', matches: 1, condition_comment_id: 10, actor: 'friday', last_comment_id_at_fire: 10 },
      { ts: 2, card: 'b', matches: 1, condition_comment_id: 20, actor: 'marveen', last_comment_id_at_fire: 20 },
      { ts: 3, card: 'c', matches: 2, condition_comment_id: 30, actor: 'didi', last_comment_id_at_fire: 30 },
    ]
    // `a` got a newer comment, `b` did not, `c` has no comments at all any more.
    const latest = (card: string) => ({ a: 11, b: 20, c: null } as Record<string, number | null>)[card] ?? null
    expect(summarizeReopenWarnings(entries, latest)).toEqual({ fired: 3, acted: 1, silent: 2 })
  })

  it('COUNTS damaged lines instead of dropping them silently', () => {
    writeFileSync(logFile, '{"card":"a","last_comment_id_at_fire":1}\nnem json\n{"card":"b"}\n', 'utf8')
    const { entries, malformed } = readReopenWarnings(logFile)
    expect(entries.map(e => e.card)).toEqual(['a'])
    expect(malformed).toBe(2)
  })

  it('appends, never rewrites', () => {
    const e = { ts: 1, card: 'a', matches: 1, condition_comment_id: 1, actor: 'x', last_comment_id_at_fire: 1 }
    appendReopenWarning(e, logFile)
    appendReopenWarning({ ...e, card: 'b' }, logFile)
    expect(readReopenWarnings(logFile).entries.map(x => x.card)).toEqual(['a', 'b'])
  })

  it('the path honours the env override, so a test never writes the live store', () => {
    expect(reopenWarningLogPath()).toBe(logFile)
    delete process.env.MARVEEN_REOPEN_WARNING_LOG
    expect(reopenWarningLogPath()).toMatch(/store\/reopen-condition-warnings\.jsonl$/)
  })
})

describe('the documented call shape keeps working', () => {
  it('an EMPTY body still archives, and logs the actor as unknown', async () => {
    card('c-nobody', [FELTETEL])
    const { payload } = await archive('c-nobody')          // no body at all
    expect(payload.warning).toBeTruthy()
    expect(readReopenWarnings(logFile).entries[0].actor).toBe('ismeretlen')
  })

  it('a missing card is still a 404, not a warning', async () => {
    const { status, payload } = await archive('nincs-ilyen')
    expect(status).toBe(404)
    expect(payload.warning).toBeUndefined()
  })
})

// === The last stretch of wire: from the response body to the screen ===
//
// The warning is worth exactly as much as the distance it travels. It reaches
// an API caller in the response body -- but the owner and the coordinator
// archive from the DASHBOARD, and that handler used to throw the response away
// and show a fixed "archived" toast. Same silent shape one layer up.
//
// This is a source-anchored test, and it is anchored ON PURPOSE: `warning`
// occurs ~20 times in app.js, so a plain "the file mentions warning" assertion
// would pass against a completely unwired handler. The slice below is the
// archive handler alone, and the negative control (the delete handler right
// after it, which must NOT carry the branch) is what keeps it a correspondence
// test rather than a presence test.
describe('the dashboard shows it -- anchored to the archive handler', () => {
  const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

  function handlerSlice(buttonId: string): string {
    const start = APP.indexOf(`document.getElementById('${buttonId}').onclick`)
    expect(start, `nincs ilyen kezelo: ${buttonId}`).toBeGreaterThan(-1)
    // Up to the NEXT handler registration, so the slice cannot swallow its
    // neighbour. Searched from after this handler's own registration line --
    // measured the hard way: `start + 40` lands one character before this
    // handler's own `.onclick`, and the slice collapses to 41 characters that
    // match nothing. A slice that is too SHORT fails loudly; one that is too
    // long fails silently, by passing on the neighbour's code.
    const next = APP.indexOf(".onclick = async () =>", start + 120)
    const slice = APP.slice(start, next === -1 ? start + 2000 : next)
    expect(slice.length, `gyanusan rovid szelet: ${buttonId}`).toBeGreaterThan(200)
    return slice
  }

  it('the archive handler READS the response and branches on `warning`', () => {
    const slice = handlerSlice('cardArchiveBtn')
    expect(slice).toMatch(/\/archive/)
    expect(slice).toMatch(/await res\.json\(\)/)
    expect(slice).toMatch(/body\.warning/)
    expect(slice).toMatch(/showToast\(body\.warning/)
  })

  it('it names the actor, so the log can say WHO archived', () => {
    expect(handlerSlice('cardArchiveBtn')).toMatch(/actor: kanbanMoveActor\(\)/)
  })

  it('NEGATIVE CONTROL: the neighbouring delete handler carries none of it', () => {
    // If this ever starts passing, the slice above stopped isolating the
    // handler, and the two assertions before it stopped meaning anything.
    const slice = handlerSlice('cardDeleteBtn')
    expect(slice).not.toMatch(/body\.warning/)
  })
})
