// y1-report-only/decide.mjs: the decision. Runs the vendored upstream gate UNCHANGED and adds, around it:
//
//  1. SUPPLEMENTS to its target list (nothing is taken away):
//     - every `agents/*/...` pattern again under each agent directory's REAL path. Here agents/<name> is a symlink
//       (to /Users/Shared/marveen-<name>), the gate compares real paths, and so its patterns see no OTHER agent's
//       files (the caller's own are listed separately by the gate). Measured, card 5b639edb comment 58754.
//     - `agents/*/agent-config.json` for sub-agent callers: model, tools and role of an agent, not listed upstream.
//     - the log directory of this hook, so a write to the evidence is itself a row.
//     A deny is re-decided WITHOUT the supplements (base_deny), so the table can tell upstream's rows from ours.
//  2. EXEMPTIONS (exemptions.mjs): the known false classes, logged as `exempted` with their name, never dropped.
//  3. A git deny is not this hook's, but the gate names only its FIRST deny. The verdict is therefore the gate's on
//     the command with its git commands taken out (`git_out`, and `decided`: the input the verdict is about):
//     allowed = `git-hunk-excluded`; denied for something else = that deny, with the exemptions tried on it; no git
//     command the hook could take out, or still a git deny = a would-deny for `git` (the rest was read by nobody).
//
// No side effect at import: core.mjs calls judge() on the main thread, under the watchdog's deadline.
import { readdirSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { gateDecision, installTargets, isSubAgentCaller } from './upstream/scripts/hooks/db-write-gate.mjs'
import { mcpFileTargets } from './upstream/scripts/hooks/mcp-file-targets.mjs'
import { normalizePathSegments, pathKey } from './upstream/scripts/self-pace-gate.mjs'
import { exemptionFor, gitOut } from './exemptions.mjs'

const AGENT_PATTERN_PREFIX = 'agents/*/'
// noBareGlob as upstream gives the worker's own CLAUDE.md: agent-config.json has no leading dot, so the quoted `*` of a
// `select count(*)` run from the agent's own home would reach it (db-write-gate.mjs, WORKER_HOME_TARGETS).
export const OWN_SUBAGENT_TARGETS = [{ rel: 'agents/*/agent-config.json', pattern: true, own: true, noBareGlob: true }]
export const OWN_COMMON_TARGETS = [{ rel: 'store/y1-report-only', dir: true, own: true }]

// The opts the upstream hook entry builds (db-write-gate.mjs, its last block), plus `root`: upstream takes the install
// root from its own file's place, which here is the vendor directory.
export function gateOpts(job) {
  return {
    root: job.root,
    cwd: job.cwd ?? undefined,
    subAgent: isSubAgentCaller(job.projectDir || undefined, job.root, job.configDir || null),
    projectDir: job.projectDir || null,
    configDir: job.configDir || join(homedir(), '.claude'),
  }
}

// Agent directories whose real path is not their lexical one.
export function relocatedAgents(root) {
  const base = resolve(root, 'agents')
  let names = []
  try { names = readdirSync(base) } catch { return [] }
  const out = []
  for (const name of names.sort()) {
    const lexical = join(base, name)
    let real
    try { real = realpathSync(lexical) } catch { continue }
    if (real !== join(realpathSync(base), name)) out.push({ name, real })
  }
  return out
}

function entry(t, abs, extra = {}) {
  const key = pathKey(abs)
  return { ...t, ...extra, abs, key, segs: [normalizePathSegments(abs), normalizePathSegments(key[0])] }
}

function reanchored(t, agents) {
  const rest = t.rel.slice(AGENT_PATTERN_PREFIX.length)
  return agents.map((a) => entry(t, join(a.real, rest), { supplement: a.name }))
}

// The gate's cached lists this call is decided on: the common one always (a sub-agent's deny is re-read against it to
// name the reason), the caller's own when it is a sub-agent.
function caches(opts) {
  const out = [{ sub: false, cache: installTargets(opts.root, false, null, null) }]
  if (opts.subAgent === true) out.push({ sub: true, cache: installTargets(opts.root, true, opts.projectDir ?? null, opts.configDir ?? null) })
  return out
}

const SUPPLEMENTED = new WeakMap()

export function applySupplements(opts) {
  const agents = relocatedAgents(opts.root)
  let added = 0
  for (const { sub, cache } of caches(opts)) {
    if (!SUPPLEMENTED.has(cache)) {
      const extra = []
      for (const t of cache.list) if (t.pattern && t.rel?.startsWith(AGENT_PATTERN_PREFIX)) extra.push(...reanchored(t, agents))
      for (const own of [...OWN_COMMON_TARGETS, ...(sub ? OWN_SUBAGENT_TARGETS : [])]) {
        const e = entry(own, resolve(opts.root, own.rel))
        extra.push(e)
        if (own.pattern) extra.push(...reanchored(e, agents))
      }
      SUPPLEMENTED.set(cache, { base: cache.list.length, extra })
      cache.list.push(...extra)
    }
    added += SUPPLEMENTED.get(cache).extra.length
  }
  return added
}

// Still there after the decision? The gate rebuilds a list when its cache key moves; a rebuilt list has none of ours.
export function supplementsIntact(opts) {
  return caches(opts).every(({ cache }) => {
    const s = SUPPLEMENTED.get(cache)
    return !!s && cache.list.length === s.base + s.extra.length
  })
}

export function withoutSupplements(opts, fn) {
  const held = caches(opts).map(({ cache }) => ({ cache, s: SUPPLEMENTED.get(cache) })).filter((h) => h.s)
  for (const h of held) h.cache.list.length = h.s.base
  try {
    return fn()
  } finally {
    for (const h of held) h.cache.list.push(...h.s.extra)
  }
}

// The class an entry is counted under in the table: its path as the lists name it.
export function targetClass(t) {
  const name = t.rel ?? `~/${t.home}`
  return t.own ? `own:${name}` : t.caller ? `caller:${name}` : name
}

// Runs fn with each of the gate's lists replaced by `make(list)`, then puts them back.
function withLists(opts, make, fn) {
  const held = caches(opts).map(({ cache }) => ({ cache, all: [...cache.list] }))
  for (const h of held) { h.cache.list.length = 0; h.cache.list.push(...make(h.all)) }
  try {
    return fn()
  } finally {
    for (const h of held) { h.cache.list.length = 0; h.cache.list.push(...h.all) }
  }
}

// Runs fn with the gate's lists cut to the entries `keep` accepts.
export function withTargets(opts, keep, fn) {
  return withLists(opts, (all) => all.filter(keep), fn)
}

// Does the deny depend on WHICH names are protected? Decided by the gate itself, on two other lists:
//   'no-target'  it denies with an empty list: the database, a `claude mcp add`, a word the gate cannot read
//   'any-name'   it denies with every entry swapped for a made-up name in the same directory (dot name for dot name):
//                some word of the command reaches whatever lies there (a glob-only word, an unresolved one). The
//                command may name a protected file as well: these rows are read one by one.
//   'named'      neither: the deny comes from the protected names themselves
const DECOY = 'y1-decoy-7f3a'
export function specificity(job, opts) {
  const denies = () => gateDecision(job.toolName, job.toolInput, opts).deny === true
  if (withLists(opts, () => [], denies)) return 'no-target'
  const decoys = (all) => {
    const seen = new Set()
    const out = []
    for (const t of all) {
      const name = (basename(t.abs).startsWith('.') ? '.' : '') + DECOY
      const abs = join(dirname(t.abs), name)
      const id = `${abs}|${!!t.pattern}|${!!t.noBareGlob}`
      if (seen.has(id)) continue
      seen.add(id)
      // the gate also reads an entry's `rel` as text, so the made-up name goes there too
      const { dir: _dir, home: _home, ...rest } = t
      out.push(entry(rest, abs, { rel: join(dirname(t.rel ?? t.home), name), decoy: true }))
    }
    return out
  }
  return withLists(opts, decoys, denies) ? 'any-name' : 'named'
}

// Which target classes make this call a deny? Decided by the gate itself: the call is re-decided on parts of the
// list. [] = it is a deny with NO target on the list (the database, a `claude mcp add`, the gate failing closed on
// a word it cannot read); a class alone on the list that still denies is a hit; a deny no single class gives is
// reported as one `combined:` entry. `budgetMs` bounds the live cost: null = not finished (report.mjs does it later).
export function attribute(job, opts, budgetMs = Infinity) {
  const t0 = performance.now()
  const denies = (classes) => {
    if (performance.now() - t0 > budgetMs) throw new RangeError('budget')
    return withTargets(opts, (t) => classes.has(targetClass(t)), () => gateDecision(job.toolName, job.toolInput, opts).deny === true)
  }
  const find = (classes) => {
    if (!denies(new Set(classes))) return []
    if (classes.length === 1) return classes
    const mid = classes.length >> 1
    const hits = [...find(classes.slice(0, mid)), ...find(classes.slice(mid))]
    return hits.length ? hits : [`combined:${classes.join('+')}`]
  }
  try {
    if (denies(new Set())) return []
    const all = [...new Set(caches(opts).flatMap(({ cache }) => cache.list.map(targetClass)))].sort()
    return find(all)
  } catch (err) {
    if (err instanceof RangeError) return null
    throw err
  }
}

// attribute() for a job judge() has decided: same opts, the supplements on. A budget that is already spent is null.
// The job is the one the verdict is ABOUT: with `decided` of judge() as its input where judge() gave one.
export function classesFor(job, budgetMs = Infinity) {
  if (!(budgetMs > 0)) return null
  const opts = gateOpts(job)
  applySupplements(opts)
  return attribute(job, opts, budgetMs)
}

// `gate` is the upstream decision; only the tests hand in another one (a gate that fails, a gate that rebuilds its list).
export function judge(job, gate = gateDecision) {
  const t0 = performance.now()
  const opts = gateOpts(job)
  const sub = opts.subAgent === true
  const out = (v) => ({ ...v, sub, ms: Math.round((performance.now() - t0) * 10) / 10 })
  const { toolName, toolInput } = job
  // upstream's own fast path: an MCP call that names no local path is allowed without the path engine
  const mcp = mcpFileTargets(toolName, toolInput)
  if (mcp && mcp.targets.length === 0 && !mcp.missingPath && !mcp.truncated && !mcp.dbNamed && !mcp.bare.length) return out({ kind: 'allow' })
  const supplements = applySupplements(opts)
  const d = gate(toolName, toolInput, opts)
  if (!supplementsIntact(opts)) return out({ kind: 'error', error: 'the supplement entries are not on the list the gate cached' })
  if (!d.deny) return out({ kind: 'allow' })
  const commonFor = (input) => {
    const base = withoutSupplements(opts, () => gate(toolName, input, opts))
    return { base_deny: base.deny === true, base_reason: base.error ? 'gate-error' : base.reason, supplements }
  }
  // an exception inside the gate is a deny upstream (fail closed), so it is one here
  const failed = (v, input) => out({ kind: 'would-deny', reason: 'gate-error', error: String(v.error).slice(0, 2000), ...commonFor(input) })
  if (d.error) return failed(d, toolInput)
  if (d.reason !== 'git') {
    const exemption = exemptionFor(job, opts, d, (input, o = opts) => gate(toolName, input, o))
    return out({ kind: exemption ? 'exempted' : 'would-deny', reason: d.reason, exemption: exemption ?? undefined, ...commonFor(toolInput) })
  }
  const rest = toolName === 'Bash' && typeof toolInput?.command === 'string' ? gitOut(toolInput.command) : null
  const decided = rest === null ? null : { ...toolInput, command: rest }
  const r = decided && gate(toolName, decided, opts)
  if (r && !supplementsIntact(opts)) return out({ kind: 'error', error: 'the supplement entries are not on the list the gate cached' })
  if (!r || (r.deny && !r.error && r.reason === 'git')) return out({ kind: 'would-deny', reason: 'git', ...commonFor(toolInput) })
  if (!r.deny) return out({ kind: 'exempted', reason: 'git', exemption: 'git-hunk-excluded', ...commonFor(toolInput) })
  if (r.error) return { ...failed(r, decided), git_out: true, decided }
  const exemption = exemptionFor({ ...job, toolInput: decided }, opts, r, (input, o = opts) => gate(toolName, input, o))
  return out({ kind: exemption ? 'exempted' : 'would-deny', reason: r.reason, exemption: exemption ? `git-hunk-excluded+${exemption}` : undefined, ...commonFor(decided), git_out: true, decided })
}
