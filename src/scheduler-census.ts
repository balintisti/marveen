// Scheduler-entry census (card fe838f28): lists what is actually scheduled on this machine and
// reports, once each, the entries our installers did not create.
//
// Why it exists: the self-pace gate (scripts/self-pace-gate.mjs) reads COMMAND TEXT, and a text
// gate cannot see a scheduler call that does not carry the scheduler's name in command position
// (a script file, a python argv call, a variable-assembled name all pass it -- card 2465cac4).
// This module looks at the OUTCOME instead: the stores a scheduler entry lands in.
//
// Read-only by construction: it lists (crontab -l, atq, readdir, readFile) and never writes a
// scheduler. It reports; removal is a decision for whoever reads the report.
//
// A store it cannot read is NOT REACHED with the reason, never an empty store: an empty list here
// would read as "nothing scheduled" exactly when nobody looked.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** One scheduler entry as listed. `key` is unique across stores and stable across rounds. */
export interface CensusEntry {
  store: string
  key: string
  /** What the report names: a file name, a task name, a crontab line, an atq line. */
  label: string
  /** When the store says it appeared (file birth time), ISO; null where the store has no such
   *  time (crontab, at, a JSON item). The report then gives the first round that saw it. */
  createdAt: string | null
}

export type StoreReading =
  | { store: string; reached: true; entries: CensusEntry[] }
  | { store: string; reached: false; reason: string }

export interface ExecResult {
  status: number | null
  stdout: string
  stderr: string
  /** Set when the command could not be started at all (ENOENT, timeout). */
  error?: string
}
export type CensusExec = (cmd: string, args: readonly string[]) => ExecResult

/** What the repo installs, as far as this census can tell. `ok: false` means the set could not be
 *  derived; the caller must then NOT compare against it (an empty known set would report every
 *  installed unit as foreign). */
export type KnownGood =
  | { ok: true; launchAgentLabels: Set<string>; scheduledTaskNames: Set<string> }
  | { ok: false; reason: string }

export const STORE_CRONTAB = 'crontab'
export const STORE_AT = 'at-queue'
export const STORE_LAUNCH_AGENTS = 'launch-agents'
export const STORE_SCHEDULED_TASKS = 'claude-scheduled-tasks'
/** Claude Code's durable cron store (`<project>/.claude/scheduled_tasks.json`): one store per path. */
export const STORE_CRON_FILE_PREFIX = 'claude-cron-file:'

function keyOf(store: string, id: string): string {
  return `${store}\t${id}`
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0]?.trim() ?? ''
}

function errCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' ? code : String((err as Error | null)?.message ?? err)
}

function birthIso(path: string): string | null {
  try {
    const st = statSync(path)
    const ms = st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs
    return new Date(ms).toISOString()
  } catch {
    return null
  }
}

// A crontab line that schedules nothing: blank, comment, or an environment assignment (MAILTO=...).
const CRON_ENV_RX = /^[A-Za-z_][A-Za-z0-9_]*\s*=/

export function readCrontab(exec: CensusExec): StoreReading {
  const store = STORE_CRONTAB
  const r = exec('crontab', ['-l'])
  if (r.error) return { store, reached: false, reason: `crontab -l could not run: ${r.error}` }
  if (r.status === 0) {
    const entries = r.stdout.split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#') && !CRON_ENV_RX.test(l))
      .map((l): CensusEntry => ({ store, key: keyOf(store, l), label: l, createdAt: null }))
    return { store, reached: true, entries }
  }
  // The one non-zero exit that is a measured empty: the user has no crontab at all.
  if (/no crontab for /i.test(r.stderr)) return { store, reached: true, entries: [] }
  return { store, reached: false, reason: `crontab -l exit ${r.status}: ${firstLine(r.stderr) || '(no stderr)'}` }
}

export function readAtQueue(exec: CensusExec): StoreReading {
  const store = STORE_AT
  const r = exec('atq', [])
  if (r.error) return { store, reached: false, reason: `atq could not run: ${r.error}` }
  if (r.status !== 0) {
    return { store, reached: false, reason: `atq exit ${r.status}: ${firstLine(r.stderr) || '(no stderr)'}` }
  }
  const entries = r.stdout.split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    // atq: "<job id>\t<date> <queue> <user>". The job id names the job; the whole line is the label.
    .map((l): CensusEntry => ({ store, key: keyOf(store, l.split(/\s+/)[0] ?? l), label: l, createdAt: null }))
  return { store, reached: true, entries }
}

/** Every file in ~/Library/LaunchAgents except Finder's .DS_Store. A non-.plist file (an editor or
 *  hand backup) is listed too: the census reports what is in the store, not what it guesses
 *  launchd will load. */
export function readLaunchAgents(dir: string): StoreReading {
  const store = STORE_LAUNCH_AGENTS
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (err) {
    // No LaunchAgents directory = nothing installed there: a measured empty.
    if (errCode(err) === 'ENOENT') return { store, reached: true, entries: [] }
    return { store, reached: false, reason: `${dir}: ${errCode(err)}` }
  }
  const entries = names
    .filter((n) => n !== '.DS_Store')
    .sort()
    .map((n): CensusEntry => ({ store, key: keyOf(store, n), label: n, createdAt: birthIso(join(dir, n)) }))
  return { store, reached: true, entries }
}

/** ~/.claude/scheduled-tasks: one task per directory (`<name>/SKILL.md` + `task-config.json`, see
 *  src/web/scheduled-tasks-io.ts). Plain files there (`.removed-defaults`) are not tasks. */
export function readScheduledTasks(dir: string): StoreReading {
  const store = STORE_SCHEDULED_TASKS
  let dirents
  try {
    dirents = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { store, reached: true, entries: [] }
    return { store, reached: false, reason: `${dir}: ${errCode(err)}` }
  }
  const entries = dirents
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort()
    .map((n): CensusEntry => ({ store, key: keyOf(store, n), label: n, createdAt: birthIso(join(dir, n)) }))
  return { store, reached: true, entries }
}

function cronItemLabel(item: unknown): string {
  if (item !== null && typeof item === 'object') {
    const o = item as Record<string, unknown>
    const cron = typeof o.cron === 'string' ? o.cron : '?'
    const prompt = typeof o.prompt === 'string' ? o.prompt.replace(/\s+/g, ' ').slice(0, 80) : ''
    const id = typeof o.id === 'string' ? `${o.id} ` : ''
    return `${id}${cron} ${prompt}`.trim()
  }
  return JSON.stringify(item).slice(0, 100)
}

/** Claude Code's durable cron file. Its JSON shape is not documented (asked 2026-11-12: only the
 *  CronCreate inputs cron/prompt/recurring/durable are), so a top-level array and an object with a
 *  `tasks` array are read, and ANY other shape is NOT REACHED: a file that exists and holds
 *  something this code does not understand is not an empty store. */
export function readCronFile(path: string): StoreReading {
  const store = `${STORE_CRON_FILE_PREFIX}${path}`
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    if (errCode(err) === 'ENOENT') return { store, reached: true, entries: [] }
    return { store, reached: false, reason: errCode(err) }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { store, reached: false, reason: `not JSON (${firstLine(String((err as Error).message))})` }
  }
  let items: unknown[]
  if (Array.isArray(parsed)) items = parsed
  else if (parsed !== null && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).tasks)) {
    items = (parsed as { tasks: unknown[] }).tasks
  } else {
    const shape = parsed !== null && typeof parsed === 'object'
      ? `object with keys [${Object.keys(parsed).slice(0, 8).join(', ')}]`
      : typeof parsed
    return { store, reached: false, reason: `unknown shape (${shape})` }
  }
  const createdAt = birthIso(path)
  const entries = items.map((item): CensusEntry => {
    const o = item as Record<string, unknown> | null
    const id = o !== null && typeof o === 'object' && typeof o.id === 'string'
      ? o.id
      : createHash('sha1').update(JSON.stringify(item)).digest('hex').slice(0, 12)
    return { store, key: keyOf(store, id), label: cronItemLabel(item), createdAt }
  })
  return { store, reached: true, entries }
}

// ---- known-good: what the repo installs ----------------------------------------------------------

const TEMPLATE_RX = /^(com\..+)\.plist\.template$/
// `LABEL="com.marveen.x"` in an install script (scripts/installed-drift-check.ts reads the same).
const LABEL_ASSIGN_RX = /^\s*LABEL="(com\.[^"]+)"\s*$/gm
// `com.${SERVICE_ID}.x` / `com.${serviceId}.x` / `com.$SERVICE_ID.x` anywhere in an installer.
const SERVICE_LABEL_RX = /com\.\$\{?(?:SERVICE_ID|serviceId)\}?\.([a-z0-9][a-z0-9-]*)/g

/**
 * Derived from the repo, not kept by hand (the card's rule: a hand list rots):
 *   - LaunchAgent labels: every `scripts/com.*.plist.template` (rendered by install-launchd-unit.sh,
 *     the label is the file name), every `LABEL="com..."` line and every `com.${SERVICE_ID}.x`
 *     label in the repo's shell installers and scripts/*.ts (SERVICE_ID substituted), plus
 *     `extraLabels` (labels the config module computes: the app service and its legacy name).
 *   - Scheduled task names: the repo's two seed directories, `scheduled-tasks/` (seeded by
 *     ensureDefaultScheduledTasks) and `seed-scheduled-tasks/` (install-macos.sh, update.sh).
 * crontab and at have no entry here: no installer in the repo writes either.
 */
export function deriveKnownGood(repoRoot: string, serviceId: string, extraLabels: readonly string[] = []): KnownGood {
  const scriptsDir = join(repoRoot, 'scripts')
  let scriptNames: string[]
  try {
    scriptNames = readdirSync(scriptsDir)
  } catch (err) {
    return { ok: false, reason: `${scriptsDir}: ${errCode(err)}` }
  }
  const labels = new Set<string>()
  for (const n of scriptNames) {
    const m = TEMPLATE_RX.exec(n)
    if (m) labels.add(m[1])
  }
  if (labels.size === 0) return { ok: false, reason: `${scriptsDir}: no com.*.plist.template found` }

  let rootNames: string[] = []
  try { rootNames = readdirSync(repoRoot) } catch { /* scripts/ was readable; root shells are extra */ }
  const sources = [
    ...scriptNames.filter((n) => n.endsWith('.sh') || n.endsWith('.ts')).map((n) => join(scriptsDir, n)),
    ...rootNames.filter((n) => n.endsWith('.sh')).map((n) => join(repoRoot, n)),
  ]
  for (const file of sources) {
    let text: string
    try { text = readFileSync(file, 'utf-8') } catch { continue }
    for (const m of text.matchAll(LABEL_ASSIGN_RX)) {
      const label = m[1].replace(/\$\{?SERVICE_ID\}?/g, serviceId)
      if (!label.includes('$')) labels.add(label)
    }
    for (const m of text.matchAll(SERVICE_LABEL_RX)) labels.add(`com.${serviceId}.${m[1]}`)
  }
  for (const l of extraLabels) labels.add(l)

  const tasks = new Set<string>()
  let seedDirsRead = 0
  for (const seed of ['scheduled-tasks', 'seed-scheduled-tasks']) {
    try {
      for (const d of readdirSync(join(repoRoot, seed), { withFileTypes: true })) {
        if (d.isDirectory()) tasks.add(d.name)
      }
      seedDirsRead++
    } catch { /* counted below */ }
  }
  if (seedDirsRead === 0) return { ok: false, reason: `${repoRoot}: neither scheduled-tasks/ nor seed-scheduled-tasks/ readable` }
  return { ok: true, launchAgentLabels: labels, scheduledTaskNames: tasks }
}

/** True when the repo would have put this entry there. crontab, at and the cron files: never. */
export function isInstalledByUs(entry: CensusEntry, known: Extract<KnownGood, { ok: true }>): boolean {
  if (entry.store === STORE_LAUNCH_AGENTS) {
    if (!entry.label.endsWith('.plist')) return false
    return known.launchAgentLabels.has(entry.label.slice(0, -'.plist'.length))
  }
  if (entry.store === STORE_SCHEDULED_TASKS) return known.scheduledTaskNames.has(entry.label)
  return false
}

// ---- the round: diff against what was already reported --------------------------------------------

/** Persisted between rounds. `seen`: key -> first round (ISO) that reported it. `unreached`:
 *  store -> the reason last reported. */
export interface CensusState {
  v: 1
  seen: Record<string, string>
  unreached: Record<string, string>
}

export interface CensusRound {
  /** True on the first round of an install (no state yet): the report is the baseline of what
   *  was already there, sent once. */
  baseline: boolean
  newEntries: Array<CensusEntry & { firstSeen: string }>
  /** Stores newly NOT REACHED, or NOT REACHED for a different reason than last reported. */
  unreached: Array<{ store: string; reason: string }>
  /** Stores that were NOT REACHED last report and are read again now. */
  recovered: string[]
  next: CensusState
}

function storeOfKey(key: string): string {
  const i = key.indexOf('\t')
  return i === -1 ? key : key.slice(0, i)
}

/**
 * The once-per-entry rule. An unknown entry is reported in the first round that sees it and never
 * again while it stays. An entry that disappears is dropped from `seen`, so if it comes back it is
 * a new appearance and is reported again. A store that is NOT REACHED keeps its earlier `seen`
 * keys: losing sight of a store is not the entries disappearing, and reading it again must not
 * re-report everything in it.
 * When `known` is not ok, launch-agents and scheduled-tasks cannot be judged this round: they are
 * reported NOT REACHED with the derivation's reason, never compared against an empty set.
 */
export function diffCensus(readings: readonly StoreReading[], known: KnownGood, prev: CensusState | null, nowIso: string): CensusRound {
  const prevSeen = prev?.seen ?? {}
  const prevUnreached = prev?.unreached ?? {}
  const effective: StoreReading[] = readings.map((r) => {
    if (r.reached && !known.ok && (r.store === STORE_LAUNCH_AGENTS || r.store === STORE_SCHEDULED_TASKS)) {
      return { store: r.store, reached: false, reason: `known-good set not derivable: ${known.reason}` }
    }
    return r
  })

  const nextSeen: Record<string, string> = {}
  const nextUnreached: Record<string, string> = {}
  const newEntries: CensusRound['newEntries'] = []
  const unreached: CensusRound['unreached'] = []
  const recovered: string[] = []

  for (const r of effective) {
    if (!r.reached) {
      nextUnreached[r.store] = r.reason
      if (prevUnreached[r.store] !== r.reason) unreached.push({ store: r.store, reason: r.reason })
      for (const [k, at] of Object.entries(prevSeen)) if (storeOfKey(k) === r.store) nextSeen[k] = at
      continue
    }
    if (r.store in prevUnreached) recovered.push(r.store)
    for (const e of r.entries) {
      if (known.ok && isInstalledByUs(e, known)) continue
      const firstSeen = prevSeen[e.key]
      if (firstSeen !== undefined) {
        nextSeen[e.key] = firstSeen
        continue
      }
      nextSeen[e.key] = nowIso
      newEntries.push({ ...e, firstSeen: nowIso })
    }
  }
  return {
    baseline: prev === null,
    newEntries,
    unreached,
    recovered,
    next: { v: 1, seen: nextSeen, unreached: nextUnreached },
  }
}

export function parseCensusState(raw: string): CensusState | null {
  try {
    const o = JSON.parse(raw) as Partial<CensusState>
    if (o && o.v === 1 && o.seen && typeof o.seen === 'object' && o.unreached && typeof o.unreached === 'object') {
      return { v: 1, seen: { ...o.seen }, unreached: { ...o.unreached } }
    }
  } catch { /* fall through */ }
  return null
}

/** The report text, or null when the round has nothing to say. English: it goes to an agent. */
export function buildCensusReport(round: CensusRound, statePath: string): string | null {
  if (round.newEntries.length === 0 && round.unreached.length === 0 && round.recovered.length === 0) return null
  const lines: string[] = []
  const n = round.newEntries.length
  lines.push(round.baseline
    ? `[SCHEDULER-CENSUS] First census on this install: ${n} scheduler entr${n === 1 ? 'y' : 'ies'} present that our installers did not create (listed once; later rounds report only new ones).`
    : `[SCHEDULER-CENSUS] ${n} new scheduler entr${n === 1 ? 'y' : 'ies'} our installers did not create.`)
  lines.push('Read-only report: nothing was removed or disabled. Removing an entry is a decision.')
  const byStore = new Map<string, CensusRound['newEntries']>()
  for (const e of round.newEntries) {
    const list = byStore.get(e.store) ?? []
    list.push(e)
    byStore.set(e.store, list)
  }
  for (const [store, list] of byStore) {
    lines.push(`${store} (${list.length}):`)
    for (const e of list) {
      const when = e.createdAt ? `created ${e.createdAt}, first seen ${e.firstSeen}` : `first seen ${e.firstSeen}`
      lines.push(`- ${e.label} (${when})`)
    }
  }
  if (round.unreached.length > 0) {
    lines.push('NOT REACHED (could not be read; this is not an empty store):')
    for (const u of round.unreached) lines.push(`- ${u.store}: ${u.reason}`)
  }
  if (round.recovered.length > 0) lines.push(`Readable again: ${round.recovered.join(', ')}`)
  lines.push(`State: ${statePath}`)
  return lines.join('\n')
}
