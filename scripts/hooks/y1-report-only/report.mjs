#!/usr/bin/env node
// y1-report-only/report.mjs: the table of the report-only hook's log, by TARGET CLASS.
//
//   node scripts/hooks/y1-report-only/report.mjs [--days 7] [--dir <log dir>] [--budget-ms 20000] [--json]
//
// Reads store/y1-report-only/{calls,findings}.jsonl and writes to stdout; it changes nothing. What it adds to the
// log is decided by the gate again, here, offline (the findings hold the full input):
//   - every would-deny / exempted row is REPLAYED and must come out as it was logged. One that does not is counted
//     as `unreproducible` and never under a class: the lists, the code or the environment moved since.
//   - a would-deny row is `no target`, `any name` or `named` (decide.mjs, specificity); only a named row is counted
//     under its target classes, and under EVERY class it has, so the class rows do not add up to the row total.
//   - classes the live hook did not finish (classes: null) are found now, within --budget-ms per row.
// An agent directory without a single row is printed as such: there the hook did not run, which is a finding.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { FILE_TOOLS, logDir } from './core.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SLOW_MS = 300

function rowsOf(path, since) {
  if (!existsSync(path)) return { rows: [], bad: 0 }
  const rows = []
  let bad = 0
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const row = JSON.parse(line)
      if (Date.parse(row.ts) >= since) rows.push(row)
    } catch {
      bad++ // a row cut by a kill in mid-write
    }
  }
  return { rows, bad }
}

const size = (path) => { try { return statSync(path).size } catch { return 0 } }
const at = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : null)

// The job the hook judged, rebuilt from a findings row. null = the row does not hold it whole.
export function jobOf(row, root) {
  if (row.input_truncated || !row.input || !row.tool) return null
  let toolInput
  if (row.tool === 'Bash') toolInput = { command: row.input.command }
  else if (FILE_TOOLS.includes(row.tool)) toolInput = { ...row.input }
  else { try { toolInput = JSON.parse(row.input.json) } catch { return null } }
  return { root, toolName: row.tool, toolInput, cwd: row.cwd ?? null, projectDir: row.project_dir || null, configDir: row.config_dir || null }
}

export async function buildReport({ root = resolve(HERE, '..', '..', '..'), dir = logDir(root), now = Date.now(), days = 7, budgetMs = 20000 } = {}) {
  const since = now - days * 86400000
  const calls = rowsOf(join(dir, 'calls.jsonl'), since)
  const findings = rowsOf(join(dir, 'findings.jsonl'), since)
  const { judge, gateOpts, applySupplements, specificity, attribute } = await import('./decide.mjs')

  // ---- per agent: liveness and cost
  let names = []
  try { names = readdirSync(join(root, 'agents')).filter((n) => !n.startsWith('.')).sort() } catch { /* no agents directory */ }
  const agents = {}
  const agent = (name) => (agents[name] ??= { calls: 0, kinds: {}, ms: [], msTotal: [], last: null })
  for (const name of ['main', ...names]) agent(name)
  let slow = 0
  let slowNoDog = 0
  for (const r of calls.rows) {
    const a = agent(r.agent ?? 'unknown')
    a.calls++
    a.kinds[r.kind] = (a.kinds[r.kind] || 0) + 1
    if (typeof r.ms === 'number') a.ms.push(r.ms)
    if (typeof r.ms_total === 'number') a.msTotal.push(r.ms_total)
    if (!a.last || r.ts > a.last) a.last = r.ts
    if (r.ms_total > SLOW_MS) { slow++; if (r.dog !== true) slowNoDog++ }
  }
  const perAgent = Object.entries(agents).map(([name, a]) => {
    const ms = a.ms.sort((x, y) => x - y)
    const total = a.msTotal.sort((x, y) => x - y)
    return { agent: name, calls: a.calls, kinds: a.kinds, ms_median: at(ms, 0.5), ms_total_median: at(total, 0.5), ms_total_p95: at(total, 0.95), ms_total_max: total.at(-1) ?? null, last: a.last }
  })

  // ---- findings: replay, then class
  const classes = {}
  const bump = (key, r) => {
    const c = (classes[key] ??= { rows: 0, upstream: 0, supplement_only: 0, main: 0, sub: 0, agents: {} })
    c.rows++
    if (r.base_deny === false) c.supplement_only++
    else c.upstream++
    if (r.sub === true) c.sub++
    else c.main++
    c.agents[r.agent] = (c.agents[r.agent] || 0) + 1
  }
  const exempted = {}
  const other = {}
  const unreproducible = []
  let replayed = 0
  let wouldDeny = 0
  for (const r of findings.rows) {
    if (r.kind !== 'would-deny' && r.kind !== 'exempted') {
      const key = r.kind === 'timeout' ? `timeout in ${r.phase}` : r.kind
      const o = (other[key] ??= { rows: 0, agents: {} })
      o.rows++
      o.agents[r.agent] = (o.agents[r.agent] || 0) + 1
      continue
    }
    if (r.kind === 'would-deny') wouldDeny++
    const job = jobOf(r, root)
    let v = null
    try { if (job) v = judge(job) } catch { /* counted as unreproducible */ }
    replayed++
    if (!v || v.kind !== r.kind || v.reason !== r.reason || (v.exemption ?? null) !== (r.exemption ?? null) || v.base_deny !== r.base_deny) {
      unreproducible.push({ ts: r.ts, agent: r.agent, logged: `${r.kind}:${r.reason}${r.exemption ? `(${r.exemption})` : ''}`, now: v ? `${v.kind}${v.reason ? `:${v.reason}` : ''}${v.exemption ? `(${v.exemption})` : ''}` : job ? 'threw' : 'input not whole' })
      if (r.kind === 'would-deny') bump(`(unreproducible) ${r.reason}`, r)
      continue
    }
    if (r.kind === 'exempted') {
      const e = (exempted[r.exemption] ??= { rows: 0, agents: {} })
      e.rows++
      e.agents[r.agent] = (e.agents[r.agent] || 0) + 1
      continue
    }
    const opts = gateOpts(job)
    applySupplements(opts)
    const spec = specificity(job, opts)
    if (spec !== 'named') { bump(`(${spec.replace('-', ' ')}) ${r.reason}`, r); continue }
    const list = Array.isArray(r.classes) ? r.classes : attribute(job, opts, budgetMs)
    if (!list) bump('(classes not found within the budget)', r)
    else if (!list.length) bump(`(no target) ${r.reason}`, r)
    else for (const c of list) bump(c, r)
  }

  return {
    generated: new Date(now).toISOString(),
    since: new Date(since).toISOString(),
    days,
    dir,
    upstream: JSON.parse(readFileSync(join(HERE, 'upstream', 'MANIFEST.json'), 'utf8')).commit,
    agents: perAgent,
    silent_agents: perAgent.filter((a) => a.calls === 0).map((a) => a.agent),
    would_deny_rows: wouldDeny,
    classes: Object.entries(classes).map(([name, c]) => ({ class: name, ...c })).sort((x, y) => y.rows - x.rows || (x.class < y.class ? -1 : 1)),
    exempted: Object.entries(exempted).map(([rule, e]) => ({ rule, ...e })).sort((x, y) => y.rows - x.rows),
    other: Object.entries(other).map(([kind, o]) => ({ kind, ...o })),
    replay: { rows: replayed, unreproducible },
    watchdog: { slow_calls: slow, not_up: slowNoDog },
    dropped: { calls: size(join(dir, 'calls.jsonl.FULL')), findings: size(join(dir, 'findings.jsonl.FULL')) },
    unreadable_lines: { calls: calls.bad, findings: findings.bad },
    last_resort_lines: existsSync(join(dir, 'ERRORS.txt')) ? readFileSync(join(dir, 'ERRORS.txt'), 'utf8').split('\n').filter(Boolean).length : 0,
  }
}

const who = (agents) => Object.entries(agents).sort((x, y) => y[1] - x[1]).map(([n, c]) => `${n} ${c}`).join(', ')

export function render(rep) {
  const out = []
  out.push(`Y1 report-only: what the upstream gate (${rep.upstream.slice(0, 9)}) WOULD have denied`)
  out.push(`window ${rep.since} .. ${rep.generated} (${rep.days} days), log ${rep.dir}`)
  out.push('')
  out.push('1. Calls per agent (every agent directory; ms = the decision, total = from process start to the row)')
  out.push('   agent         calls   allow  would-deny exempted  error timeout   ms med  total med     p95     max  last row')
  for (const a of rep.agents) {
    const k = (n) => String(a.kinds[n] || 0)
    out.push(a.calls === 0
      ? `   ${a.agent.padEnd(12)} NO ROWS: the hook did not run here in the window (a finding, not a zero)`
      : `   ${a.agent.padEnd(12)}${String(a.calls).padStart(7)}${k('allow').padStart(8)}${k('would-deny').padStart(12)}${k('exempted').padStart(9)}${k('error').padStart(7)}${k('timeout').padStart(8)}${String(a.ms_median).padStart(9)}${String(a.ms_total_median).padStart(11)}${String(a.ms_total_p95).padStart(8)}${String(a.ms_total_max).padStart(8)}  ${a.last}`)
  }
  out.push('')
  out.push(`2. Would-deny by target class (${rep.would_deny_rows} rows; a named row counts under EVERY class it has)`)
  out.push('   rows  upstream  ours-only   main    sub  class  [agents]')
  for (const c of rep.classes) {
    out.push(`  ${String(c.rows).padStart(5)}${String(c.upstream).padStart(10)}${String(c.supplement_only).padStart(11)}${String(c.main).padStart(7)}${String(c.sub).padStart(7)}  ${c.class}  [${who(c.agents)}]`)
  }
  if (!rep.classes.length) out.push('   none')
  out.push('   (no target) = denied with an empty list; (any name) = a word that reaches whatever lies next to a')
  out.push('   protected name, read these one by one; upstream = the unchanged gate denies it too; ours-only = only')
  out.push('   with the entries this hook adds')
  out.push('')
  out.push('3. Exempted, by rule (logged with the full input, never dropped)')
  for (const e of rep.exempted) out.push(`  ${String(e.rows).padStart(5)}  ${e.rule}  [${who(e.agents)}]`)
  if (!rep.exempted.length) out.push('   none')
  out.push('')
  out.push('4. What went wrong')
  for (const o of rep.other) out.push(`  ${String(o.rows).padStart(5)}  ${o.kind}  [${who(o.agents)}]`)
  out.push(`   rows dropped at the size cap: calls ${rep.dropped.calls}, findings ${rep.dropped.findings}`)
  out.push(`   lines that are not JSON (a kill in mid-write): calls ${rep.unreadable_lines.calls}, findings ${rep.unreadable_lines.findings}`)
  out.push(`   lines in ERRORS.txt (the log code itself failed): ${rep.last_resort_lines}`)
  out.push(`   watchdog not up on calls slower than ${SLOW_MS} ms: ${rep.watchdog.not_up} of ${rep.watchdog.slow_calls}`)
  out.push(`   replay: ${rep.replay.rows} rows judged again, ${rep.replay.unreproducible.length} came out differently`)
  for (const u of rep.replay.unreproducible.slice(0, 20)) out.push(`     ${u.ts} ${u.agent}: logged ${u.logged}, now ${u.now}`)
  if (rep.replay.unreproducible.length > 20) out.push(`     ... and ${rep.replay.unreproducible.length - 20} more (--json has all)`)
  return out.join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const arg = (name) => { const k = process.argv.indexOf(name); return k === -1 ? undefined : process.argv[k + 1] }
  const rep = await buildReport({
    dir: arg('--dir') ? resolve(arg('--dir')) : undefined,
    days: arg('--days') ? Number(arg('--days')) : undefined,
    budgetMs: arg('--budget-ms') ? Number(arg('--budget-ms')) : undefined,
  })
  process.stdout.write(process.argv.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : render(rep))
}
