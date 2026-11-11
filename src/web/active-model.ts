import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { encodeClaudeProjectDir } from '../claude-project-dir.js'

// Claude Code writes one .jsonl session log per session under
// ~/.claude/projects/<encoded-working-dir>/. Every assistant turn carries the
// model id that answered it. We use that to surface the *live* running model
// (vs. the configured value in agent-config.json), so the dashboard can show
// what the running process is actually using, including across restarts.
//
// When an agent is launched with --continue, Claude Code appends to the same
// session jsonl across restarts, so the latest "model" field may reflect a
// pre-restart turn rather than the freshly-spawned process. Callers that know
// when the current session started should pass sinceUnixSec; we then ignore
// any line whose own timestamp predates that, leaving the caller to fall back
// to the configured model until the new session writes its first turn.
const cache = new Map<string, { value: string | null; expiresAt: number }>()
const TTL_MS = 3000

// Resolve the session-log directory Claude Code writes for a working dir.
// Logs live under <config-root>/projects/<encoded-working-dir>/, where the
// config root is ~/.claude by default but an alternate one when the agent was
// launched with CLAUDE_CONFIG_DIR. Pass that absolute config root as configDir
// so we read the right project dir for agents on a non-default config.
/**
 * Claude Code keys the project dir off the process's RESOLVED cwd, so a
 * symlinked working dir must be resolved before it is encoded. Measured
 * 2026-09-19 (card 5c094718): every detached fleet agent lives behind
 * `agents/<name>` -> `/Users/Shared/marveen-<name>`. Encoding the UNRESOLVED
 * path yields `-Users-isti-marveen-agents-<name>`, a directory that EXISTS and
 * holds YESTERDAY's transcripts -- so the reading never changed, the guard saw
 * the same over-threshold number every sweep, and didi/computress were
 * restarted for hours on a dead file. A missing directory would have been
 * loud; a stale one is silent.
 *
 * Falls back to the raw path when realpath fails (path does not exist yet):
 * an unresolvable working dir must not throw here, it must key exactly as
 * before.
 */
function resolveWorkingDir(workingDir: string): string {
  try { return realpathSync(workingDir) } catch { return workingDir }
}

export function projectsDirFor(workingDir: string, configDir?: string, homeDirOverride?: string): string {
  const base = configDir ?? join(homeDirOverride ?? homedir(), '.claude')
  // The encoding is Claude Code's, measured -- see src/claude-project-dir.ts (upstream).
  // The realpath step is ours (card 50eee909): a symlinked agent dir must encode to the
  // path Claude Code itself resolved, or its token-usage rows are lost again.
  const encoded = encodeClaudeProjectDir(resolveWorkingDir(workingDir))
  return join(base, 'projects', encoded)
}

export function readActiveModelFromProjectDir(workingDir: string, sinceUnixSec?: number, configDir?: string): string | null {
  const now = Date.now()
  const cacheKey = `${workingDir}:${sinceUnixSec ?? ''}:${configDir ?? ''}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > now) return cached.value
  let value: string | null = null
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) {
      cache.set(cacheKey, { value: null, expiresAt: now + TTL_MS })
      return null
    }
    const jsonls = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    if (jsonls.length === 0) {
      cache.set(cacheKey, { value: null, expiresAt: now + TTL_MS })
      return null
    }
    const content = readFileSync(join(dir, jsonls[0].f), 'utf-8')
    const lines = content.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        const entry = JSON.parse(line)
        const msg = entry?.message
        const model = msg?.model
        if (typeof model !== 'string' || model.startsWith('<')) continue
        if (sinceUnixSec !== undefined) {
          const ts = entry?.timestamp
          if (typeof ts !== 'string') continue
          const lineUnix = Math.floor(new Date(ts).getTime() / 1000)
          if (!Number.isFinite(lineUnix) || lineUnix < sinceUnixSec) continue
        }
        value = model
        break
      } catch { /* skip malformed JSON line */ }
    }
  } catch { /* fall through */ }
  cache.set(cacheKey, { value, expiresAt: now + TTL_MS })
  return value
}

// Like readActiveModelFromProjectDir, but also says WHEN that assistant line
// was written. The model a status shows is only as fresh as the last turn: a
// /model sent after it has not been measured yet (ELSOKOR922 Phase 7 A-smoke:
// the hold reverted to sonnet at 14:52, /model at 14:53 still read "opus" from
// the 14:47 turn, with nothing saying the reading was stale).
export function readLastAssistantModel(workingDir: string, configDir?: string): { model: string; atMs: number } | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    const newest = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!newest) return null
    const lines = readFileSync(join(dir, newest.f), 'utf-8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line) continue
      try {
        const entry = JSON.parse(line)
        const model = entry?.message?.model
        if (typeof model !== 'string' || model.startsWith('<')) continue
        const atMs = typeof entry?.timestamp === 'string' ? new Date(entry.timestamp).getTime() : NaN
        if (!Number.isFinite(atMs)) continue
        return { model, atMs }
      } catch { /* skip malformed JSON line */ }
    }
  } catch { /* fall through */ }
  return null
}

const TURN_TAIL_BYTES = 512 * 1024

// Epoch ms of the last TURN line (type user / assistant) in the newest
// transcript; null = no transcript or no such line in the tail. Unlike the
// file mtime, bookkeeping lines do not count: Claude Code writes a
// queue-operation, a "UserPromptSubmit operation blocked by hook" system line
// and last-prompt / title metadata for every prompt a hook blocks, so an owner
// command made the transcript look "active" by its own blocked prompt
// (ELSOKOR922 Phase 7 A-smoke: /model refused "transcript-active (0s)").
// A running turn writes user (tool_result) and assistant lines, so the gap
// between two tool calls -- what the quiet window guards -- still counts.
// A local slash command (/model, /effort, /clear sent into the pane) writes
// `user` lines -- "<command-name>/model</command-name>..." and
// "<local-command-stdout>Set model to ...</local-command-stdout>" -- but no model
// turn runs. Counted as activity they made every write within 20 s of our own
// previous /model read "turn-active" (measured on the test bot, 2026-09-23).
function isLocalCommandLine(e: { type?: unknown; message?: { content?: unknown } }): boolean {
  if (e.type !== 'user') return false
  const c = e.message?.content
  return typeof c === 'string' && /^\s*<(local-command-(stdout|stderr|caveat)|command-name)>/.test(c)
}

/**
 * When the agent last got a SUCCESSFUL model response (card 46e6bfb0): the newest assistant line
 * that is not Claude Code's synthetic API-error line (`isApiErrorMessage: true`, model
 * `<synthetic>`). Measured 2026-11-04 over 300 transcripts: every real assistant line carries a
 * stop_reason (38 927 tool_use, 2 625 end_turn), and the error lines are the synthetic ones. A tool
 * call counts: the model answered, the agent moved.
 * Returns 0 when the whole file was read and holds no response, null when it cannot tell (no
 * directory, no transcript, or none found inside a tail window that did not cover the file).
 */
export function readLastModelResponseMs(workingDir: string, configDir?: string): number | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    const newest = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs, size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!newest) return null
    const fd = openSync(join(dir, newest.f), 'r')
    let text: string
    try {
      const len = Math.min(newest.size, TURN_TAIL_BYTES)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, newest.size - len)
      text = buf.toString('utf-8')
    } finally { closeSync(fd) }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line.startsWith('{')) continue
      try {
        const e = JSON.parse(line)
        if (e?.type !== 'assistant' || e.isApiErrorMessage === true || e.message?.model === '<synthetic>') continue
        const at = typeof e.timestamp === 'string' ? new Date(e.timestamp).getTime() : NaN
        if (Number.isFinite(at)) return at
      } catch { /* a line cut by the tail window, or malformed */ }
    }
    if (newest.size <= TURN_TAIL_BYTES) return 0
  } catch { /* fall through */ }
  return null
}

export function readLastTurnActivityMs(workingDir: string, configDir?: string): number | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    const newest = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs, size: statSync(join(dir, f)).size }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!newest) return null
    const fd = openSync(join(dir, newest.f), 'r')
    let text: string
    try {
      const len = Math.min(newest.size, TURN_TAIL_BYTES)
      const buf = Buffer.alloc(len)
      readSync(fd, buf, 0, len, newest.size - len)
      text = buf.toString('utf-8')
    } finally { closeSync(fd) }
    const lines = text.split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim()
      if (!line.startsWith('{')) continue
      try {
        const e = JSON.parse(line)
        if (e?.type !== 'user' && e?.type !== 'assistant') continue
        if (isLocalCommandLine(e)) continue
        const at = typeof e.timestamp === 'string' ? new Date(e.timestamp).getTime() : NaN
        if (Number.isFinite(at)) return at
      } catch { /* a line cut by the tail window, or malformed */ }
    }
    // The WHOLE file was read and holds no turn: a fresh session (after a
    // deploy or /clear) that has only bookkeeping lines. That is "never had a
    // turn" -- quiet -- not "unknown". Returning null here made the caller
    // fall back to the file's mtime, which every hook-blocked command bumps,
    // so commands typed in a row kept each other "turn-active" (measured on
    // the test bot, 2026-09-23). A file larger than the window stays null.
    if (newest.size <= TURN_TAIL_BYTES) return 0
  } catch { /* fall through */ }
  return null
}

const ctxCache = new Map<string, { value: number | null; mtime: number | null; expiresAt: number }>()

// The line the CLI writes when a compaction is DONE (there is no line for its start). Measured
// shape, 2026-11-11: {type:'system', subtype:'compact_boundary', timestamp, compactMetadata:
// {trigger, preTokens, postTokens, durationMs, ...}}.
function isCompactBoundary(e: unknown): e is { timestamp?: unknown; compactMetadata?: { postTokens?: unknown } } {
  return !!e && typeof e === 'object'
    && (e as { type?: unknown }).type === 'system'
    && (e as { subtype?: unknown }).subtype === 'compact_boundary'
}

/**
 * When the newest transcript's LAST compaction finished (ms), or null: no transcript, no
 * compaction in it, or a boundary line without a readable timestamp. Not cached and it reads the
 * whole file: for a caller that asks about ONE agent in a state where the answer decides
 * something (the guard, while it waits for a handoff it asked for), not for a sweep of the fleet.
 */
export function readLastCompactionMs(workingDir: string, configDir?: string): number | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    const newest = readdirSync(dir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]
    if (!newest) return null
    const lines = readFileSync(join(dir, newest.f), 'utf-8').split('\n')
    for (let i = lines.length - 1; i >= 0; i--) {
      // The words can stand in a tool result or a message too: the cheap test only picks the
      // lines worth parsing, the parsed type decides.
      if (!lines[i].includes('"compact_boundary"')) continue
      try {
        const e = JSON.parse(lines[i])
        if (!isCompactBoundary(e)) continue
        const at = typeof e.timestamp === 'string' ? new Date(e.timestamp).getTime() : NaN
        return Number.isFinite(at) ? at : null
      } catch { /* a malformed line: keep looking */ }
    }
  } catch { /* fall through */ }
  return null
}

/**
 * A DEAD READING (card 6f362eb3): the newest transcript was last written BEFORE the agent's current
 * session started, so nothing in it is this session's. 5c094718 was one CAUSE of that (a symlinked
 * working dir keyed to a directory that exists and holds yesterday's files); this is the guard for
 * the CLASS -- any cause, including a future key change, and the ordinary one: a freshly restarted
 * `--continue` session that has not written its first turn yet, whose file still ends in the
 * previous session's usage. `sinceUnixSec` is the session start in epoch SECONDS, the unit
 * readActiveModelFromProjectDir already takes; absent means "not known", and then nothing changes.
 */
export function predatesSession(mtimeMs: number | null, sinceUnixSec: number | undefined): boolean {
  return sinceUnixSec !== undefined && mtimeMs !== null && mtimeMs < sinceUnixSec * 1000
}

// Current context size of the live session, in tokens. Claude Code records a
// `usage` object on each assistant turn; the context that gets re-read every
// turn is input_tokens + cache_read_input_tokens + cache_creation_input_tokens
// (output_tokens is the new reply, not context). We scan the newest transcript
// from the end for the last turn carrying a usage and sum those three. Returns
// null when there is no transcript / no usage yet (fresh session). This is what
// the dashboard surfaces so the operator can see a session growing heavy and
// decide to restart it.
//
// A COMPACTION ENDS THE SCAN (card 17a19228). The CLI writes a `compact_boundary` line when a
// compaction is done; every usage ABOVE it describes a context that is gone. The scan used to
// walk straight past it, so between the boundary and the first call after it (seconds when the
// compaction ran mid-turn, for as long as the session stays quiet when it ended a turn) the
// reading was the size BEFORE the compaction, and the guard asked a session at a fifth of its
// window to stop. The boundary carries `compactMetadata.postTokens`; that is what is returned.
// It is a FLOOR, not the size: measured 2026-11-11 on 11 auto compactions of one agent,
// postTokens 12k-19k and the first call after each 54k-67k (the system prompt and the tools are
// not in it). Too low for one call at most, and every reader of this number acts on HIGH values.
// No positive postTokens on the line: null (unmeasurable), never the old number.
export function readContextTokensFromProjectDir(workingDir: string, configDir?: string, sinceUnixSec?: number): number | null {
  const now = Date.now()
  const cacheKey = `${workingDir}:${configDir ?? ''}`
  const cached = ctxCache.get(cacheKey)
  // The cache holds the reading AND the file's mtime; the dead-reading check runs after it, so two
  // callers with different session starts can share one read without sharing one verdict.
  if (cached && cached.expiresAt > now) return predatesSession(cached.mtime, sinceUnixSec) ? null : cached.value
  let value: number | null = null
  let mtime: number | null = null
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (existsSync(dir)) {
      const jsonls = readdirSync(dir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      if (jsonls.length > 0) {
        mtime = jsonls[0].mtime
        const content = readFileSync(join(dir, jsonls[0].f), 'utf-8')
        const lines = content.split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim()
          if (!line) continue
          try {
            const e = JSON.parse(line)
            if (isCompactBoundary(e)) {
              const post = Number(e.compactMetadata?.postTokens)
              value = Number.isFinite(post) && post > 0 ? post : null
              break
            }
            const u = e?.message?.usage
            if (u && typeof u === 'object') {
              const inp = Number(u.input_tokens) || 0
              const cr = Number(u.cache_read_input_tokens) || 0
              const cc = Number(u.cache_creation_input_tokens) || 0
              const total = inp + cr + cc
              if (total > 0) { value = total; break }
            }
          } catch { /* skip malformed JSON line */ }
        }
      }
    }
  } catch { /* fall through */ }
  ctxCache.set(cacheKey, { value, mtime, expiresAt: now + TTL_MS })
  return predatesSession(mtime, sinceUnixSec) ? null : value
}

/**
 * Wall-clock mtime (ms) of the newest transcript for a working dir, or null
 * when there is none (fresh session, unreadable dir, agent on a remote host).
 *
 * This is the cheapest "when did this session last do anything" signal, and
 * the honest one: Claude Code appends to the jsonl on every turn, so the
 * file's mtime is written BY the session, outside the dashboard process. A
 * clock kept in dashboard memory dies with the dashboard, and a
 * count-the-sweeps streak measures the sweep interval rather than the agent.
 * Neither survives a restart; this does.
 *
 * What it does NOT measure: whether the agent is working right now. A single
 * long tool call (a 30-minute Bash, a subagent) appends nothing while it runs,
 * so the transcript goes quiet while real work is in flight. Callers must pair
 * this with a live-work signal -- the guard uses paneIdle -- and never treat a
 * stale mtime on its own as "finished".
 *
 * The mtime is already computed inside readContextTokensFromProjectDir to pick
 * the newest file; this exposes it rather than recomputing the selection
 * differently, so the two always describe the SAME transcript.
 */
export function readTranscriptMtimeFromProjectDir(workingDir: string, configDir?: string, sinceUnixSec?: number): number | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    let newest: number | null = null
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const m = statSync(join(dir, f)).mtimeMs
      if (newest === null || m > newest) newest = m
    }
    return predatesSession(newest, sinceUnixSec) ? null : newest
  } catch { return null }
}

/**
 * Has the session started at `sinceUnixSec` written a transcript for `workingDir`?
 * true / false when that is known, null when it cannot be told.
 *
 * readTranscriptMtimeFromProjectDir folds "no transcript" and "could not read"
 * into one null, which is right for a reader that only wants a time. A caller
 * that ACTS on "no transcript" (the boot-wedge rescue restarts the pane on it)
 * must not act on a read error: here a missing project dir is false (nothing was
 * ever written), but a failed readdir or stat is null (card b1f0011b, didi 56593).
 */
export function transcriptWrittenSince(workingDir: string, configDir: string | undefined, sinceUnixSec: number): boolean | null {
  let dir: string
  try { dir = projectsDirFor(workingDir, configDir) } catch { return null }
  if (!existsSync(dir)) return false
  try {
    let newest: number | null = null
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const m = statSync(join(dir, f)).mtimeMs
      if (newest === null || m > newest) newest = m
    }
    return newest !== null && !predatesSession(newest, sinceUnixSec)
  } catch { return null }
}

/**
 * Newest transcript mtime for `workingDir` across SEVERAL candidate config
 * roots, or null when no candidate has one.
 *
 * Same "probe every root, newest wins" rule the inbound probe uses, and for the
 * same reason: whether a session writes under the shared ~/.claude or under an
 * isolated CLAUDE_CONFIG_DIR is decided by gates (settings, fleet token, dir
 * existence) that a watchdog must not try to re-derive. A root that is not in
 * use simply yields an older timestamp or none.
 *
 * An `undefined` entry means the shared ~/.claude default, so a caller that
 * already has a single known root can pass `[root]` and get the old behaviour.
 */
export function readTranscriptMtimeAcrossConfigDirs(
  workingDir: string,
  configDirs: ReadonlyArray<string | undefined>,
): number | null {
  let newest: number | null = null
  for (const configDir of configDirs) {
    const m = readTranscriptMtimeFromProjectDir(workingDir, configDir)
    if (m != null && (newest === null || m > newest)) newest = m
  }
  return newest
}

/**
 * Epoch ms of the newest REAL conversation event in `workingDir`'s transcript,
 * or null when no timestamped line can be found.
 *
 * WHY THIS EXISTS AND WHY mtime IS NOT IT (GATEMTIME922, measured 2026-09-22):
 * Claude Code appends more than conversation to the .jsonl. Bookkeeping records
 * (atis-latch, mode, last-prompt, custom-title, agent-name,
 * file-history-snapshot, artifact-autoreact-ledger) are written while a session
 * sits completely idle, and they carry NO `timestamp` field. The file therefore
 * keeps growing when nobody is working: measured on Willy's transcript, the
 * last real turn was 11:35:56 while mtime read 12:24:19 and was still climbing
 * (10404001 -> 10404348 bytes under observation).
 *
 * The consequence is not "the gate waits a bit longer". The restart gate blocks
 * while msSinceTranscriptWrite < transcriptQuietMs, so a signal that never goes
 * quiet is a gate that NEVER opens: Willy's was blocked 240 minutes with no
 * stuck work at all. The mtime measurement was never wrong about the FILE; it
 * answered a different question than the one the gate asks.
 *
 * Reads a bounded tail rather than the whole file: transcripts here run to tens
 * of megabytes and this is called on every gate tick. The first (likely
 * partial) line of the tail is dropped. Lines are JSON-parsed and only a
 * TOP-LEVEL `timestamp` counts, so an ISO date quoted inside message text
 * cannot masquerade as activity.
 */
/** Above this a transcript is read by tail only; see the widening passes below. */
const MAX_FULL_READ_BYTES = 64 * 1024 * 1024

export function readLastConversationTsFromProjectDir(
  workingDir: string,
  configDir?: string,
  tailBytes = 512 * 1024,
): number | null {
  try {
    const dir = projectsDirFor(workingDir, configDir)
    if (!existsSync(dir)) return null
    let newestFile: string | null = null
    let newestMtime = -1
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue
      const m = statSync(join(dir, f)).mtimeMs
      if (m > newestMtime) { newestMtime = m; newestFile = join(dir, f) }
    }
    if (newestFile === null) return null

    const size = statSync(newestFile).size
    // Widening passes: a long tool-result burst can push every timestamped line
    // out of a small tail, and a tail that happens to contain no turn is NOT
    // evidence that the session has none. The last pass reads the whole file,
    // but only below MAX_FULL_READ_BYTES -- past that the caller's logged mtime
    // fallback is cheaper than stalling a watchdog tick on a huge read.
    const passes = [tailBytes, tailBytes * 8, tailBytes * 64]
    if (size <= MAX_FULL_READ_BYTES) passes.push(size)
    for (const want of passes) {
      const start = Math.max(0, size - want)
      const fd = openSync(newestFile, 'r')
      let buf: Buffer
      try {
        const len = size - start
        buf = Buffer.alloc(len)
        readSync(fd, buf, 0, len, start)
      } finally { closeSync(fd) }

      const lines = buf.toString('utf-8').split('\n')
      if (start > 0) lines.shift()   // partial first line
      let newest: number | null = null
      for (const line of lines) {
        if (!line.startsWith('{')) continue
        let o: Record<string, unknown>
        try { o = JSON.parse(line) as Record<string, unknown> } catch { continue }
        const ts = o.timestamp
        if (typeof ts !== 'string') continue
        const ms = Date.parse(ts)
        if (Number.isFinite(ms) && (newest === null || ms > newest)) newest = ms
      }
      if (newest !== null) return newest
      if (start === 0) break   // already read the whole file
    }
    return null
  } catch { return null }
}
