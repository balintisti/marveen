import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { atomicWriteFileSync } from './atomic-write.js'
import { logger } from '../logger.js'

// A rule sheet (CLAUDE.md) rewritten under the lock the sheet editors take.
//
// scripts/claude-md-edit.py and claude-md-extract.py lock the page's OWN descriptor (flock), read,
// and write in place. A temp-file-and-rename write does not meet that lock from either side: it
// can put text read BEFORE an editor's write over that write, and it can swap the file away from
// an editor that holds the lock, whose write then lands in a file no path names. So the read,
// the transform and the write here are one compare-and-swap, and the write step runs in
// scripts/sheet-locked-write.py (Node has no flock): under the page's lock, only if the page still
// holds the bytes the transform was given, in place. When the page moved in between, it is read
// and transformed again.
//
// WHO CATCHES THE THROW: a settings write names the sheet in its answer (front-desk-sheets.ts);
// the start paths go through ensureSheetSectionAtStart (below), because a dashboard
// boot or an agent's start must not fail on a page somebody is editing.
//
// WHAT THIS DOES NOT COVER: the other generated sections in agent-scaffold.ts still write with a
// rename (they run at dashboard boot and at an agent's start, not on a settings write), and so
// does the dashboard's sheet editor.

// Resolved from this file, not from PROJECT_ROOT: the helper is code, it lives where the code is.
const HELPER = fileURLToPath(new URL('../../scripts/sheet-locked-write.py', import.meta.url))

/** How often the page may change between our read and our write before we give up. */
const MAX_ATTEMPTS = 5
// The write step is a spawnSync: while it waits for the lock, the dashboard's event loop waits
// with it. An editor holds the lock across one read and one write of one file, so a wait this
// long already means a holder that is stuck, and a longer one would only stall every request
// behind it (review 58529, finding 2). Not measured: how long the editors really hold it.
const DEFAULT_LOCK_WAIT_MS = 2_000

const EXIT_CHANGED = 3
const EXIT_LOCK_BUSY = 4

export type SheetRewrite = 'unchanged' | 'written' | 'unreadable'

export interface SheetLockOptions {
  /** How long the write step waits for the page's lock. */
  lockWaitMs?: number
  /** The interpreter that runs the helper. */
  python?: string
}

let warnedNoPython = false

/**
 * Read `path`, hand the text to `transform`, write the result back under the page's lock.
 * `transform` may run more than once (once per read) and must not have effects of its own.
 *
 * - `'unchanged'`: the transform gave back what it got; nothing was written and no lock taken.
 * - `'unreadable'`: the page could not be read; nothing was written.
 * - throws when the page stays locked, keeps changing, or cannot be written: the page then holds
 *   whatever the last writer left, never a half of ours.
 *
 * No `python3` on this machine: the write falls back to the rename, and says so once. The editors
 * that take this lock are Python scripts, so where there is no interpreter there is no holder.
 */
export function rewriteSheetUnderLock(
  path: string,
  transform: (existing: string) => string,
  opts: SheetLockOptions = {},
): SheetRewrite {
  const lockWaitMs = opts.lockWaitMs ?? DEFAULT_LOCK_WAIT_MS
  const python = opts.python ?? 'python3'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let raw: Buffer
    try {
      raw = readFileSync(path)
    } catch {
      return 'unreadable'
    }
    const existing = raw.toString('utf-8')
    const updated = transform(existing)
    if (updated === existing) return 'unchanged'
    if (updated === '') throw new Error(`sheet ${path}: the rewrite came out empty, not written`)

    const run = spawnSync(
      python,
      [HELPER, path, createHash('sha256').update(raw).digest('hex'), String(lockWaitMs / 1000)],
      { input: Buffer.from(updated, 'utf-8'), timeout: lockWaitMs + 10_000 },
    )
    if (run.error) {
      if ((run.error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`sheet ${path}: the locked write did not run (${run.error.message}), not written`)
      }
      if (!warnedNoPython) {
        warnedNoPython = true
        logger.warn({ python }, 'sheet lock: no python interpreter -- rule sheets are written WITHOUT the editors\' lock')
      }
      atomicWriteFileSync(path, updated)
      return 'written'
    }
    if (run.status === 0) return 'written'
    if (run.status === EXIT_CHANGED) continue
    const said = run.stderr.toString('utf-8').trim().split('\n').pop() ?? ''
    if (run.status === EXIT_LOCK_BUSY) {
      throw new Error(`sheet ${path}: somebody held its lock for ${lockWaitMs} ms, not written`)
    }
    throw new Error(`sheet ${path}: the locked write failed (exit ${run.status ?? run.signal}): ${said}`)
  }
  throw new Error(`sheet ${path}: it changed ${MAX_ATTEMPTS} times between our read and our write, not written`)
}

// The start paths' call of a section that is written under the sheet editors' lock (dashboard
// boot in web.ts, an agent's start in agent-process.ts). Such a write can refuse: the lock stayed
// busy, the page kept changing, the write step failed (above). A start must not fail
// on that: the sheet keeps the section it has, the refusal is logged with the sheet and the
// section, and the next start writes it. Review 58529, finding 2: before this the throw went up
// through startWebServer and startAgentProcess.
export function ensureSheetSectionAtStart(agent: string, section: string, ensure: () => void): void {
  try {
    ensure()
  } catch (err) {
    logger.warn({ err, agent, section }, 'rule sheet: this section could not be written at start -- the sheet keeps the old one until the next start')
  }
}
