// Card 17a19228: the context reader walks the transcript BACKWARDS to the last line with a usage.
// After a compaction the CLI writes a compact_boundary line and then a summary, neither with a
// usage, so until the first reply the walk went past the boundary and reported the size from
// BEFORE the compaction (measured 2026-11-11 on eleven compactions: 161k-167k read where the
// boundary itself says 12k-19k). A sweep in that window asked a freshly compacted session to stop.
//
// The lines below are in the shape the CLI writes (copied field for field from a transcript of
// 2026-11-11, contents cut).
import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectsDirFor, readContextTokensFromProjectDir, readLastCompactionMs } from '../web/active-model.js'
import { tmpDirs } from './helpers/tmp-dirs.js'

const root = tmpDirs()('compactboundary-')

const usage = (tokens: number, at: string) => JSON.stringify({
  type: 'assistant',
  timestamp: at,
  message: { role: 'assistant', usage: { input_tokens: 3, cache_read_input_tokens: tokens - 3, cache_creation_input_tokens: 0 } },
})
const boundary = (post: unknown, at: unknown) => JSON.stringify({
  parentUuid: null,
  type: 'system',
  subtype: 'compact_boundary',
  content: 'Conversation compacted',
  isMeta: false,
  timestamp: at,
  level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 167_812, postTokens: post, durationMs: 88_412 },
})
const summary = (at: string) => JSON.stringify({
  type: 'user',
  timestamp: at,
  isCompactSummary: true,
  message: { role: 'user', content: 'This session is being continued from a previous conversation...' },
})

let n = 0
function transcript(lines: string[]): { wd: string; cd: string } {
  const wd = join(root, `wd-${++n}`)
  const cd = join(root, `cfg-${n}`)
  const dir = projectsDirFor(wd, cd)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 's.jsonl'), lines.join('\n') + '\n')
  return { wd, cd }
}

describe('the context size right after a compaction', () => {
  it('boundary and summary written, no reply yet: the size is the boundary\'s postTokens', () => {
    const { wd, cd } = transcript([
      usage(166_900, '2026-11-11T04:04:10.000Z'),
      boundary(12_051, '2026-11-11T04:05:50.142Z'),
      summary('2026-11-11T04:05:50.142Z'),
    ])
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(12_051)
  })

  it('control: the same transcript without the boundary reads the last usage', () => {
    const { wd, cd } = transcript([usage(166_900, '2026-11-11T04:04:10.000Z'), summary('2026-11-11T04:05:50.142Z')])
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(166_900)
  })

  it('the first reply after the compaction is the size from then on', () => {
    const { wd, cd } = transcript([
      usage(166_900, '2026-11-11T04:04:10.000Z'),
      boundary(12_051, '2026-11-11T04:05:50.142Z'),
      summary('2026-11-11T04:05:50.142Z'),
      usage(54_238, '2026-11-11T04:06:20.000Z'),
    ])
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(54_238)
  })

  it('a boundary without a usable postTokens: the size is UNKNOWN, never the one from before it', () => {
    for (const post of [undefined, null, 0, -5, 'many']) {
      const { wd, cd } = transcript([usage(166_900, '2026-11-11T04:04:10.000Z'), boundary(post, '2026-11-11T04:05:50.142Z')])
      expect(readContextTokensFromProjectDir(wd, cd)).toBeNull()
    }
  })

  it('the words "compact_boundary" inside a message are not a boundary', () => {
    const talk = JSON.stringify({ type: 'user', message: { role: 'user', content: 'grep "compact_boundary" and {"type":"system","subtype":"compact_boundary"}' } })
    const { wd, cd } = transcript([usage(140_000, '2026-11-11T04:04:10.000Z'), talk])
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(140_000)
    expect(readLastCompactionMs(wd, cd)).toBeNull()
  })

  it('only the measured shape is a boundary: the subtype on a line that is not a system line is not one', () => {
    const other = JSON.stringify({ type: 'user', subtype: 'compact_boundary', timestamp: '2026-11-11T04:05:50.142Z', compactMetadata: { postTokens: 12_051 } })
    const { wd, cd } = transcript([usage(140_000, '2026-11-11T04:04:10.000Z'), other])
    expect(readContextTokensFromProjectDir(wd, cd)).toBe(140_000)
    expect(readLastCompactionMs(wd, cd)).toBeNull()
  })

  it('a system line of ANOTHER subtype is not a boundary: the turn_duration line that ends a turn does not end the scan', () => {
    // Measured 2026-11-11 on six transcripts: the system lines are turn_duration 25, stop_hook_summary
    // 17, compact_boundary 12, local_command 4. The first two are written AFTER the last usage of a
    // turn, so a reader that took every system line for a boundary would read "unknown" at every idle.
    const turnEnd = JSON.stringify({ type: 'system', subtype: 'turn_duration', durationMs: 2_459_163, messageCount: 539, timestamp: '2026-11-11T04:50:50.191Z', isMeta: false })
    const a = transcript([usage(140_000, '2026-11-11T04:04:10.000Z'), turnEnd])
    expect(readContextTokensFromProjectDir(a.wd, a.cd)).toBe(140_000)
    expect(readLastCompactionMs(a.wd, a.cd)).toBeNull()
    // Constructed, not measured: the words as a whole VALUE take the line past the cheap text test
    // of the time reader, so on this one the parsed subtype is what decides in both readers.
    const named = JSON.stringify({ type: 'system', subtype: 'informational', about: 'compact_boundary', timestamp: '2026-11-11T04:05:50.142Z', compactMetadata: { postTokens: 12_051 } })
    const b = transcript([usage(140_000, '2026-11-11T04:04:10.000Z'), named])
    expect(readContextTokensFromProjectDir(b.wd, b.cd)).toBe(140_000)
    expect(readLastCompactionMs(b.wd, b.cd)).toBeNull()
  })
})

describe('readLastCompactionMs', () => {
  it('the time of the LAST boundary in the newest transcript', () => {
    const { wd, cd } = transcript([
      boundary(15_000, '2026-11-11T02:24:55.000Z'),
      usage(60_000, '2026-11-11T02:26:00.000Z'),
      boundary(12_051, '2026-11-11T04:05:50.142Z'),
      summary('2026-11-11T04:05:50.142Z'),
      usage(54_238, '2026-11-11T04:06:20.000Z'),
    ])
    expect(readLastCompactionMs(wd, cd)).toBe(Date.parse('2026-11-11T04:05:50.142Z'))
  })

  it('null: no compaction in the transcript, no transcript, no directory', () => {
    const a = transcript([usage(60_000, '2026-11-11T02:26:00.000Z')])
    expect(readLastCompactionMs(a.wd, a.cd)).toBeNull()
    const wd = join(root, 'empty-wd')
    const cd = join(root, 'empty-cfg')
    expect(readLastCompactionMs(wd, cd)).toBeNull()
    mkdirSync(projectsDirFor(wd, cd), { recursive: true })
    expect(readLastCompactionMs(wd, cd)).toBeNull()
  })

  it('a boundary whose timestamp cannot be read is not a time', () => {
    for (const at of [undefined, 12345, 'yesterday']) {
      const { wd, cd } = transcript([boundary(12_051, at)])
      expect(readLastCompactionMs(wd, cd)).toBeNull()
    }
  })

  it('a torn last line does not hide the boundary before it', () => {
    const { wd, cd } = transcript([boundary(12_051, '2026-11-11T04:05:50.142Z'), '{"type":"system","subtype":"compact_boundary","timest'])
    expect(readLastCompactionMs(wd, cd)).toBe(Date.parse('2026-11-11T04:05:50.142Z'))
  })
})
