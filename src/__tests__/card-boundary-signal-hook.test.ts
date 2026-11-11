// Card 00262e3f: the hook that SHOWS the stop signal (scripts/hooks/card-boundary-signal.py).
//
// The REAL script is spawned, with a scratch signal directory. What it has to hold:
//   - silent and cheap for everybody who has no signal (that is every Bash call of the fleet);
//   - the text of the agent's OWN fresh signal is shown ONCE, exit 2, with the mark written;
//   - its own failures never block and never show anything (fail-open, one line in the error log).
// The seam with the dashboard is tested with the real writer and reader of
// src/web/card-boundary-signal.ts: what writeSignal leaves is what the hook shows, and the mark the
// hook leaves is what readShownMs reads.
//
// NOT PROVEN HERE: that Claude Code hands an exit 2 of a PostToolUse hook to the model. That rests on
// the measurement made for memory-frontmatter-bash-gate.py (2.1.284), not repeated for this card.

import { describe, it, expect, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { SHOW_WINDOW_MS, readShownMs, writeSignal, writeAnswered, type CardBoundarySignal } from '../web/card-boundary-signal.js'

const mkTmp = tmpDirs()
const REPO = process.cwd()
const SCRIPT = join(REPO, 'scripts', 'hooks', 'card-boundary-signal.py')
const TEXT = '[SYSTEM-DIREKTIVA msg_id:77 -- envelope]\n[KARTYAHATAR] A(z) c0ffee11 kártyát most tetted át ...'

let root = ''
let dir = ''
let errlog = ''

/** The payload of a Bash call made by `agent`: the identity comes from the transcript path. */
const payloadOf = (agent: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'curl ...' },
  transcript_path: join(REPO, 'agents', agent, '.claude-config', 'projects', 'p', 's.jsonl'),
  ...extra,
})

function runHook(stdin: string, signalDir = dir): { rc: number | null; out: string; err: string } {
  const env = { ...process.env, CARD_BOUNDARY_SIGNAL_DIR: signalDir, HOOK_ERRLOG_PATH: errlog }
  delete (env as Record<string, string | undefined>).MARVEEN_AGENT_ID
  const r = spawnSync('python3', [SCRIPT], { input: stdin, env, encoding: 'utf-8', timeout: 20_000 })
  return { rc: r.status, out: r.stdout, err: r.stderr }
}

const signal = (overrides: Partial<CardBoundarySignal> = {}): CardBoundarySignal => ({
  agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', movedAtMs: Date.now() - 500, issuedAtMs: Date.now(), msgId: 77, text: TEXT,
  ...overrides,
})
const SILENT = { rc: 0, out: '', err: '' }

beforeEach(() => {
  root = mkTmp('cardhook-')
  dir = join(root, 'signals')
  errlog = join(root, 'hook-errors.log')
})

describe('nobody has a signal: silent, and nothing is read', () => {
  it('no signal directory at all (the state of an install where the trial never ran)', () => {
    // Not JSON on stdin: had the hook parsed it, the failure would be in the error log.
    expect(runHook('this is not json')).toEqual(SILENT)
    expect(existsSync(errlog)).toBe(false)
    expect(existsSync(dir)).toBe(false)
  })

  it('an empty directory', () => {
    mkdirSync(dir)
    expect(runHook('this is not json')).toEqual(SILENT)
    expect(existsSync(errlog)).toBe(false)
  })

  it('an answered record is not a signal', () => {
    writeAnswered({ agent: 'computress', cardId: 'c0ffee11', toStatus: 'testing', half: 'active', how: 'restart', atMs: Date.now(), turnEndMs: Date.now(), turnEndSource: 'answer-time' }, dir)
    expect(runHook('this is not json')).toEqual(SILENT)
    expect(existsSync(errlog)).toBe(false)
    expect(readdirSync(dir)).toEqual(['computress.answered.json'])
  })
})

describe('the agent\'s own fresh signal is shown once', () => {
  it('what the dashboard wrote is what the model is shown: exit 2, the text on stderr, the mark beside the signal', () => {
    writeSignal(signal(), dir)
    const before = Date.now()
    const r = runHook(payloadOf('computress'))
    expect(r).toEqual({ rc: 2, out: '', err: TEXT + '\n' })
    const shown = readShownMs('computress', dir)
    expect(shown).not.toBeNull()
    expect(shown!).toBeGreaterThanOrEqual(before - 1000)
    expect(shown!).toBeLessThanOrEqual(Date.now() + 1000)
    // No temp file is left: the directory is listed on every Bash call.
    expect(readdirSync(dir).sort()).toEqual(['computress.json', 'computress.shown'])
    expect(existsSync(errlog)).toBe(false)
  })

  it('ONCE: the next call of the same agent is silent, and the mark keeps its first time', () => {
    writeSignal(signal(), dir)
    expect(runHook(payloadOf('computress')).rc).toBe(2)
    const first = readFileSync(join(dir, 'computress.shown'), 'utf-8')
    expect(runHook(payloadOf('computress'))).toEqual(SILENT)
    expect(readFileSync(join(dir, 'computress.shown'), 'utf-8')).toBe(first)
  })

  it('a NEW signal after a shown one is shown again (the writer removes the old mark)', () => {
    writeSignal(signal(), dir)
    expect(runHook(payloadOf('computress')).rc).toBe(2)
    writeSignal(signal({ cardId: 'next', text: 'the second text' }), dir)
    expect(runHook(payloadOf('computress'))).toEqual({ rc: 2, out: '', err: 'the second text\n' })
  })

  it('a payload without an event name is still the Bash call (older CLI payloads)', () => {
    writeSignal(signal(), dir)
    const p = JSON.parse(payloadOf('computress')) as Record<string, unknown>
    delete p.hook_event_name
    expect(runHook(JSON.stringify(p)).rc).toBe(2)
  })
})

describe('not this agent, not this event, not fresh: silent, and no mark', () => {
  const noMark = () => expect(readdirSync(dir).filter((f) => f.endsWith('.shown'))).toEqual([])

  it('another agent\'s signal is never shown to this one, and stays unshown for its owner', () => {
    writeSignal(signal({ agent: 'ford' }), dir)
    expect(runHook(payloadOf('computress'))).toEqual(SILENT)
    noMark()
    expect(runHook(payloadOf('ford')).rc).toBe(2)
  })

  it('another event of the same call does not show it', () => {
    writeSignal(signal(), dir)
    for (const event of ['PreToolUse', 'PostToolUseFailure', 'Stop']) {
      expect(runHook(payloadOf('computress', { hook_event_name: event })), event).toEqual(SILENT)
    }
    noMark()
  })

  it('a signal older than the show window is not shown: the facts it rested on are old', () => {
    writeSignal(signal({ issuedAtMs: Date.now() - SHOW_WINDOW_MS - 5_000 }), dir)
    expect(runHook(payloadOf('computress'))).toEqual(SILENT)
    noMark()
    // Control: well inside the window the same signal is shown.
    writeSignal(signal({ issuedAtMs: Date.now() - SHOW_WINDOW_MS + 60_000 }), dir)
    expect(runHook(payloadOf('computress')).rc).toBe(2)
  })

  it('the window is the same number on both sides', () => {
    const m = /^SHOW_WINDOW_S = (\d+)$/m.exec(readFileSync(SCRIPT, 'utf-8'))
    expect(m).not.toBeNull()
    expect(Number(m![1]) * 1000).toBe(SHOW_WINDOW_MS)
  })

  it('a file that is not a whole signal of this agent shows nothing', () => {
    mkdirSync(dir)
    const broken: unknown[] = [
      { ...signal(), agent: 'ford' },      // another agent's content under this agent's name
      { ...signal(), text: '' },
      { ...signal(), text: '   ' },
      { ...signal(), text: 42 },
      { ...signal(), issuedAtMs: String(Date.now()) },
      { ...signal(), issuedAtMs: true },
      { ...signal(), issuedAtMs: undefined },
      [signal()],
    ]
    for (const b of broken) {
      writeFileSync(join(dir, 'computress.json'), JSON.stringify(b))
      expect(runHook(payloadOf('computress')), JSON.stringify(b)).toEqual(SILENT)
    }
    noMark()
  })

  it('a payload that is not an object, or names no usable agent, shows nothing', () => {
    writeSignal(signal(), dir)
    expect(runHook('[]')).toEqual(SILENT)
    expect(runHook('"x"')).toEqual(SILENT)
    noMark()
  })
})

describe('fail-open: the hook\'s own failure never blocks the call and never shows a text', () => {
  it('stdin that is not JSON while a signal is out: exit 0, silent, no mark, one line in the error log', () => {
    writeSignal(signal(), dir)
    expect(runHook('{ broken')).toEqual(SILENT)
    expect(existsSync(join(dir, 'computress.shown'))).toBe(false)
    const log = readFileSync(errlog, 'utf-8')
    expect(log).toContain('card-boundary-signal')
    expect(log).toContain('nothing shown')
    expect(log.trim().split('\n')).toHaveLength(1)
  })

  it('a signal file that is not JSON: the same', () => {
    mkdirSync(dir)
    writeFileSync(join(dir, 'computress.json'), '{"agent":"computress","text":')
    expect(runHook(payloadOf('computress'))).toEqual(SILENT)
    expect(existsSync(join(dir, 'computress.shown'))).toBe(false)
    expect(readFileSync(errlog, 'utf-8')).toContain('card-boundary-signal')
  })

  it('the signal directory is a file: the same (never exit 1, never exit 2)', () => {
    writeFileSync(dir, 'not a directory')
    const r = runHook(payloadOf('computress'))
    expect(r).toEqual(SILENT)
  })

  it('the text is shown only with its mark: a mark that cannot be written means no text', () => {
    writeSignal(signal(), dir)
    // The mark's name is taken by a directory: the rename onto it fails.
    mkdirSync(join(dir, 'computress.shown'))
    writeFileSync(join(dir, 'computress.shown', 'x'), '')
    // An existing mark of any kind already reads as "shown": silent, and nothing was printed.
    expect(runHook(payloadOf('computress'))).toEqual(SILENT)
  })
})
