// A TRANSCRIPT OLDER THAN THE SESSION IS A DEAD READING -- card 6f362eb3.
//
// 5c094718 fixed ONE cause (a symlinked working dir keyed to a directory that exists and holds
// yesterday's transcripts; the guard restarted didi and computress for hours on a file that never
// changed). This is the guard for the CLASS: whatever the cause, a transcript last written before
// the agent's current session started cannot describe that session. Real files, real mtimes.
import { describe, it, expect, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  projectsDirFor, readContextTokensFromProjectDir, readTranscriptMtimeFromProjectDir, predatesSession,
} from '../web/active-model.js'

const root = mkdtempSync(join(tmpdir(), 'dead-transcript-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
/** A fresh working dir + config dir with ONE transcript, last written at `mtimeSec`. */
function transcript(mtimeSec: number, tokens = 123_456): { wd: string; cd: string } {
  const wd = join(root, `wd-${++n}`)
  const cd = join(root, `cfg-${n}`)
  mkdirSync(wd, { recursive: true })
  const dir = projectsDirFor(wd, cd)
  mkdirSync(dir, { recursive: true })
  const f = join(dir, 's.jsonl')
  writeFileSync(f, JSON.stringify({ message: { usage: { input_tokens: tokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n')
  utimesSync(f, mtimeSec, mtimeSec)
  return { wd, cd }
}
const nowSec = Math.floor(Date.now() / 1000)

describe('predatesSession', () => {
  it('true only when both are known and the file is older than the session start', () => {
    expect(predatesSession(1000 * 1000, 1001)).toBe(true)
    expect(predatesSession(1001 * 1000, 1001)).toBe(false)   // written at the start second: live
    expect(predatesSession(1002 * 1000, 1001)).toBe(false)
    expect(predatesSession(null, 1001)).toBe(false)           // no transcript: nothing to refuse
    expect(predatesSession(1000 * 1000, undefined)).toBe(false) // start unknown: behave as before
  })
})

describe('readContextTokensFromProjectDir refuses a dead transcript (6f362eb3)', () => {
  it("POSITIVE CONTROL, 5c094718's shape: yesterday's file, a session started an hour ago -> null", () => {
    const { wd, cd } = transcript(nowSec - 24 * 3600)
    expect(readContextTokensFromProjectDir(wd, cd, nowSec - 3600)).toBeNull()
    // ...and the same file without a session start is read exactly as before
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(123_456)
  })

  it('a file written after the session started is read normally', () => {
    const { wd, cd } = transcript(nowSec - 60)
    expect(readContextTokensFromProjectDir(wd, cd, nowSec - 3600)).toBe(123_456)
  })

  it('the cache shares the READ, not the verdict: two session starts, one cache window', () => {
    const { wd, cd } = transcript(nowSec - 600)
    expect(readContextTokensFromProjectDir(wd, cd, nowSec - 60)).toBeNull()        // fills the cache
    expect(readContextTokensFromProjectDir(wd, cd, nowSec - 3600)).toBe(123_456)   // same entry, live
    expect(readContextTokensFromProjectDir(wd, cd, nowSec - 60)).toBeNull()        // and dead again
  })

  it('a restarted --continue session: dead until its first turn touches the file, live after', () => {
    const { wd, cd } = transcript(nowSec - 600, 400_000)   // the previous session's last turn
    const start = nowSec - 120
    expect(readContextTokensFromProjectDir(wd, cd, start)).toBeNull()
    const f = join(projectsDirFor(wd, cd), 's.jsonl')
    writeFileSync(f, readFileSync(f, 'utf8') + JSON.stringify({ message: { usage: { input_tokens: 5_000 } } }) + '\n')
    utimesSync(f, nowSec, nowSec)
    // past the 3 s cache
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(readContextTokensFromProjectDir(wd, cd, start)).toBe(5_000)
      resolve()
    }, 3100))
  })
})

describe('readTranscriptMtimeFromProjectDir refuses a dead transcript (6f362eb3)', () => {
  it('older than the session -> null; newer -> the mtime; no start -> the mtime', () => {
    const { wd, cd } = transcript(nowSec - 24 * 3600)
    expect(readTranscriptMtimeFromProjectDir(wd, cd, nowSec - 3600)).toBeNull()
    expect(readTranscriptMtimeFromProjectDir(wd, cd, nowSec - 48 * 3600)).toBe((nowSec - 24 * 3600) * 1000)
    expect(readTranscriptMtimeFromProjectDir(wd, cd)).toBe((nowSec - 24 * 3600) * 1000)
  })
})

// --- the wiring: every transcript probe in both guards is given the session start --------------
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CALL = /(readContextTokensFromProjectDir|readTranscriptMtimeFromProjectDir)\(((?:[^()]|\([^()]*\))*)\)/g
const topLevelArgs = (s: string) => {
  let depth = 0, n = 1
  for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth--; else if (ch === ',' && depth === 0) n++ }
  return n
}

describe('both guards pass the session start to every transcript probe', () => {
  for (const file of ['context-guard-runner.ts', 'context-restart-gate-runner.ts']) {
    it(file, () => {
      const src = readFileSync(join(REPO, 'src', 'web', file), 'utf8')
      // ONE NAMED EXEMPTION: noteDeadReading reads the RAW mtime on purpose -- to tell a dead reading
      // from "no transcript at all" it has to see the file the guard refuses. It only logs.
      const exemptFrom = src.indexOf('function noteDeadReading(')
      const exemptTo = exemptFrom < 0 ? -1 : src.indexOf('\n}\n', exemptFrom)
      const calls = [...src.matchAll(CALL)]
        .filter((m) => !src.slice(0, m.index).endsWith('import { '))
        .filter((m) => !(exemptFrom >= 0 && (m.index ?? 0) > exemptFrom && (m.index ?? 0) < exemptTo))
      // NON-EMPTY CONTROL: a pattern that matched nothing would pass every file
      expect(calls.length, 'no probe found -- the pattern is wrong').toBeGreaterThan(0)
      for (const m of calls) expect(topLevelArgs(m[2]), `${m[0]}`).toBe(3)
    })
  }

  it('the context-guard sweep reads the session start ONCE and hands it to all three probes', () => {
    const src = readFileSync(join(REPO, 'src', 'web', 'context-guard-runner.ts'), 'utf8')
    expect(src).toMatch(/const since = running && needPct \? sessionStartSec\(name\) : undefined/)
    expect(src).toMatch(/measurePct\(name, cfg\.limitTokens, since\)/)
    expect(src).toMatch(/measureContextTokens\(name, since\)/)
    expect(src).toMatch(/measureIdleMs\(name, nowMs, since\)/)
  })

  // Not "a call with since EXISTS" but "NO call without it": after the 88c366f2 merge the pct probe
  // also feeds the saturation-banner credibility check, and a dead reading there (yesterday's low
  // pct) would overrule a real banner. Null keeps the banner trusted (saturationBannerCredible).
  it('EVERY probe call carries the session start, and it is read before the banner credibility probe', () => {
    const src = readFileSync(join(REPO, 'src', 'web', 'context-guard-runner.ts'), 'utf8')
    // balanced-paren argument text, so `sessionStartSec(name)` inside a call is read whole
    const calls = (name: string) => [...src.matchAll(new RegExp(`\\b${name}\\(`, 'g'))].map((m) => {
      let i = (m.index ?? 0) + m[0].length
      let depth = 1
      const from = i
      while (depth > 0 && i < src.length) { depth += src[i] === '(' ? 1 : src[i] === ')' ? -1 : 0; i++ }
      return src.slice(from, i - 1)
    }).filter((args) => !/:\s*(string|number)/.test(args))   // skip the definitions
    const pct = calls('measurePct')
    expect(pct.length).toBeGreaterThanOrEqual(2)
    for (const args of pct) expect(args).toMatch(/,\s*(since|sessionStartSec\(name\))$/)
    for (const args of calls('measureContextTokens')) expect(args).toMatch(/,\s*since$/)
    for (const args of calls('measureIdleMs')) expect(args).toMatch(/,\s*since$/)
    const sinceAt = src.indexOf('const since = running && needPct')
    const probeAt = src.indexOf('const measuredPct =')
    expect(sinceAt).toBeGreaterThan(-1)
    expect(probeAt).toBeGreaterThan(sinceAt)
  })
})
