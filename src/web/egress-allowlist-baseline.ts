// EGRESSSELFEDIT824: a hash baseline for store/egress-allowlist.json, and a report of every
// change to it, whoever made it and by whatever route.
//
// WHY: the allowlist is the gate egress-gate.mjs applies to every agent, and it is a plain
// file in the agents' own tree. On 2026-08-24 a nested sub-agent added a domain to it and
// removed it again. Afterwards nobody could prove the file was back to its old bytes: store/
// is gitignored, and no copy or hash existed. self-pace-gate.mjs now refuses the casual write
// routes for sub-agents, but a hook reads a command STRING -- a script that builds the path at
// runtime, or a glob that never spells the name, is invisible to it. This module is the layer
// that does not depend on the route: it compares the file's bytes with the last recorded ones.
//
// What it does on every check (dashboard boot + every change the file watcher sees):
//   - sha256 of the current bytes (or "missing");
//   - if that differs from the last history entry: a full copy into
//     store/egress-allowlist.history/<UTC-stamp>-<sha12>.json, a line in history.log, and a
//     report (the domain-level diff) to the main agent;
//   - the very first check only writes the baseline, it has nothing to compare against.
// The boot check is what catches a write made while the dashboard was down.
//
// HONEST LIMIT: every agent runs as the same OS user, so the history directory is as writable
// as the file itself. This makes a change VISIBLE and the previous bytes RECOVERABLE; it does
// not make the file unwritable. That needs an OS-level owner or flag, an owner decision.
// The watcher's own record of the last sha lives OUTSIDE store/ (baselineMemoryFile), so a
// history wiped while the dashboard is down is still reported at boot; deleting that record too
// brings back the old first-run behaviour, and that is the remaining limit.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, realpathSync, watchFile, unwatchFile, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { MAIN_AGENT_ID } from '../config.js'
import { createAgentMessage } from '../db.js'
import { logger } from '../logger.js'

export const HISTORY_DIRNAME = 'egress-allowlist.history'
const MISSING = 'missing'

export interface BaselineResult {
  /** sha256 of the current bytes, or 'missing' */
  sha: string
  /** the previous recorded sha, null on the very first check */
  previous: string | null
  /** true when a new history entry was written */
  recorded: boolean
  /** the report sent (null when nothing changed or on the first baseline) */
  report: string | null
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// History entries are named <stamp>-<sha12>.json (or .missing), so a lexical sort is a time sort.
function lastEntry(historyDir: string): { name: string; sha: string } | null {
  if (!existsSync(historyDir)) return null
  const names = readdirSync(historyDir).filter((n) => /^\d{8}T\d{6}\d{3}Z-/.test(n)).sort()
  const name = names[names.length - 1]
  if (!name) return null
  if (name.endsWith('.missing')) return { name, sha: MISSING }
  return { name, sha: sha256(readFileSync(join(historyDir, name))) }
}

type Lists = Record<string, string[] | string>
function parseLists(text: string | null): Lists | null {
  if (text === null) return {}
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const out: Lists = {}
    for (const [k, v] of Object.entries(j)) {
      if (Array.isArray(v)) out[k] = v.map((x) => String(x))
      else if (typeof v === 'string') out[k] = v
    }
    return out
  } catch {
    return null
  }
}

/** Human-readable, domain-level difference between two versions of the file. */
export function describeAllowlistChange(before: string | null, after: string | null): string {
  if (after === null) return 'the file was DELETED'
  const a = parseLists(before)
  const b = parseLists(after)
  if (b === null) return 'the new content is NOT valid JSON (egress-gate falls back to the built-in list)'
  if (a === null) return 'the previous content was not valid JSON; new keys: ' + Object.keys(b).join(', ')
  const lines: string[] = []
  for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    const x = a[key]; const y = b[key]
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = new Set(Array.isArray(x) ? x : []); const ys = new Set(Array.isArray(y) ? y : [])
      const added = [...ys].filter((d) => !xs.has(d)); const removed = [...xs].filter((d) => !ys.has(d))
      if (added.length) lines.push(`${key} +${added.join(', +')}`)
      if (removed.length) lines.push(`${key} -${removed.join(', -')}`)
    } else if (x !== y) {
      lines.push(`${key}: ${x ?? '(none)'} -> ${y ?? '(none)'}`)
    }
  }
  return lines.length ? lines.join('; ') : 'bytes changed, lists unchanged (formatting only)'
}

// 2026-10-03T07:41:02.123Z -> 20261003T074102123Z (sortable, no characters a path dislikes)
function stamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, '')
}

/**
 * What THIS process last recorded or confirmed. Without it a removed history directory
 * looked like a first run (recorded, never reported), and a newest history entry rewritten
 * together with the file looked like no change at all (didi, 6525aba3 50773, W2/T7). The
 * watcher keeps one for its lifetime and, given a memory file, across restarts too (50862 W2);
 * without one a fresh process starts at null and trusts the history on disk, exactly as before.
 */
export interface BaselineMemory { sha: string | null }

/**
 * Where the dashboard keeps the last recorded sha between restarts: outside store/, so neither
 * a removed history directory nor a removed store/ takes it along, and keyed by the store's real
 * path, so two installs of one OS user do not share a record. The name starts with
 * egress-allowlist.history, which self-pace-gate.mjs refuses to sub-agents like the history itself.
 */
export function baselineMemoryFile(storeDir: string, home: string = homedir()): string {
  let real = storeDir
  try { real = realpathSync(storeDir) } catch { /* not created yet: the path as given */ }
  const key = createHash('sha256').update(real).digest('hex').slice(0, 12)
  return join(home, '.marveen', `${HISTORY_DIRNAME}-${key}.sha`)
}

function readMemoryFile(path: string): string | null {
  try {
    const v = readFileSync(path, 'utf-8').trim()
    return /^(?:[0-9a-f]{64}|missing)$/.test(v) ? v : null
  } catch { return null }
}

/**
 * Did the file change between two polls? ctime moves on every write, rename, chmod and utimes,
 * so a rewrite whose mtime was put back (touch -r) with the same inode and size is still seen
 * (didi 50862 W1b); mtime, inode and size stay for a filesystem that does not keep ctime.
 */
export function statMoved(curr: Pick<Stats, 'ctimeMs' | 'mtimeMs' | 'ino' | 'size'>, prev: Pick<Stats, 'ctimeMs' | 'mtimeMs' | 'ino' | 'size'>): boolean {
  return curr.ctimeMs !== prev.ctimeMs || curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino || curr.size !== prev.size
}

/**
 * Compare the allowlist with its last recorded version; record and report a difference.
 * `notify` receives the report text (production: an agent message to the main agent).
 */
export function checkEgressAllowlistBaseline(
  storeDir: string,
  notify: (report: string) => void,
  now: Date = new Date(),
  memory: BaselineMemory = { sha: null },
): BaselineResult {
  const file = join(storeDir, 'egress-allowlist.json')
  const historyDir = join(storeDir, HISTORY_DIRNAME)
  const bytes = existsSync(file) ? readFileSync(file) : null
  const sha = bytes ? sha256(bytes) : MISSING
  const prev = lastEntry(historyDir)
  const known = memory.sha
  // The history under us no longer holds what this process last saw: removed, or its newest entry rewritten.
  const rewritten = known !== null && (prev === null || prev.sha !== known)
  if (prev && prev.sha === sha && !rewritten) {
    memory.sha = sha
    return { sha, previous: prev.sha, recorded: false, report: null }
  }

  mkdirSync(historyDir, { recursive: true })
  const name = `${stamp(now)}-${sha.slice(0, 12)}${bytes ? '.json' : '.missing'}`
  writeFileSync(join(historyDir, name), bytes ?? '')
  appendFileSync(join(historyDir, 'history.log'), `${now.toISOString()} ${sha} ${bytes ? bytes.length : 0} ${name}\n`)
  memory.sha = sha

  if (rewritten) {
    const what = prev
      ? `its newest entry ${prev.name} now has sha ${prev.sha.slice(0, 12)}`
      : 'the directory or every entry in it was REMOVED'
    const report =
      `[EGRESS-ALLOWLIST] store/${HISTORY_DIRNAME} no longer holds the version this dashboard last recorded (${what}; ` +
      `last recorded sha ${known.slice(0, 12)}, store/egress-allowlist.json now sha ${sha.slice(0, 12)}). ` +
      'The history cannot show what changed: check store/egress-allowlist.json by hand and find out who rewrote the history. ' +
      'Sub-agents may not edit these files (EGRESSSELFEDIT824).'
    try { notify(report) } catch { /* the record above stands even if the report fails */ }
    return { sha, previous: prev ? prev.sha : null, recorded: true, report }
  }

  if (!prev) return { sha, previous: null, recorded: true, report: null }

  const before = prev.sha === MISSING ? null : readFileSync(join(historyDir, prev.name), 'utf-8')
  const report =
    `[EGRESS-ALLOWLIST] store/egress-allowlist.json CHANGED (${describeAllowlistChange(before, bytes ? bytes.toString('utf-8') : null)}). ` +
    `sha ${prev.sha.slice(0, 12)} -> ${sha.slice(0, 12)}. Previous version: store/${HISTORY_DIRNAME}/${prev.name}. ` +
    'If you did not make or approve this change, restore the previous version and find out who wrote it: ' +
    'sub-agents may not edit this file (EGRESSSELFEDIT824).'
  try { notify(report) } catch { /* the record above stands even if the report fails */ }
  return { sha, previous: prev.sha, recorded: true, report }
}

/**
 * Check once now (catches a change made while the dashboard was down), then on every change
 * the poller sees. fs.watchFile (stat polling) for the same reason as the reader re-render
 * watcher: it survives the file being replaced. `memoryFile` (production: baselineMemoryFile)
 * carries the last recorded sha across restarts; null keeps it in this process only.
 * Returns a stop function.
 */
export function watchEgressAllowlistBaseline(
  storeDir: string,
  notify: (report: string) => void,
  intervalMs = 5000,
  memoryFile: string | null = null,
): () => void {
  const file = join(storeDir, 'egress-allowlist.json')
  const memory: BaselineMemory = { sha: memoryFile ? readMemoryFile(memoryFile) : null }
  const check = () => {
    const r = checkEgressAllowlistBaseline(storeDir, notify, new Date(), memory)
    if (memoryFile && memory.sha !== null && readMemoryFile(memoryFile) !== memory.sha) {
      try {
        mkdirSync(dirname(memoryFile), { recursive: true })
        writeFileSync(memoryFile, memory.sha + '\n')
      } catch (err) { logger.warn({ err, memoryFile }, 'egress-allowlist baseline memory not written') }
    }
    return r
  }
  // The poller sees a stat change, not the edits in between: a domain added and removed again
  // within one interval (the 2026-08-24 case) leaves the same bytes, so the hash check alone
  // records nothing. The file WAS rewritten though (its stat moved), and that is said.
  const onStat = (curr: Stats, prev: Stats) => {
    try {
      const r = check()
      if (!r.recorded && statMoved(curr, prev) && prev.mtimeMs !== 0) {
        notify(
          `[EGRESS-ALLOWLIST] store/egress-allowlist.json was REWRITTEN with its previous bytes (sha ${r.sha.slice(0, 12)}, ` +
          `mtime ${new Date(prev.mtimeMs).toISOString()} -> ${new Date(curr.mtimeMs).toISOString()}). ` +
          `What it held in between (up to ${intervalMs} ms) is not known: a domain may have been added and removed again. ` +
          'If you did not do this, find out who wrote it: sub-agents may not edit this file (EGRESSSELFEDIT824).',
        )
      }
    } catch { /* a failed check must not crash the server */ }
  }
  try { check() } catch { /* a failed check must not crash the server */ }
  watchFile(file, { interval: intervalMs }, onStat)
  return () => unwatchFile(file, onStat)
}

/**
 * The production report: a `system` message in the main agent's queue, written the moment the
 * change is seen. Its value is exactly that it is ALREADY QUEUED: a history directory rewritten
 * later (same OS user) does not take back a message that has been sent.
 */
export function queueAllowlistReport(report: string): void {
  logger.warn({ report }, 'egress-allowlist.json changed')
  createAgentMessage('system', MAIN_AGENT_ID, report)
}
