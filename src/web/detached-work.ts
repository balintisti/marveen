// DETACHED BACKGROUND WORK THE PANE CANNOT SHOW (card ad730515).
//
// The guard counts background work from the pane footer (runningBackgroundWork): sub-agent rows,
// shells, monitors. A job started with nohup / disown / `&` from a Bash call outlives that call and
// is reparented to launchd, so it is on no footer and in no pane process tree. Measured 2026-10-14
// on jarvis: a whisper transcription job (wjob4.sh -> xargs -> whisper) ran 21 hours with PPID 1,
// 8 CPU-seconds per 5 seconds, and the guard woke him six times or more.
//
// HOW IT IS ATTRIBUTED, AND WHY NOT BY PANE: the job's TMUX_PANE was %659, jarvis's pane at the
// time of measurement %708 -- he had been restarted, and the job had not. What survives a restart
// is the ENVIRONMENT: a job inherits its agent's CLAUDE_CONFIG_DIR (agents/<name>/.claude-config),
// the same field scripts/heavy-run.py names its runs by. The working directory is the fallback:
// it only names the agent when the job runs under his pane path, and the gates do not (card
// a6a56d3a, measured 2026-10-30 on the live board: 0 groups attributed; computress's 234 %CPU gate
// ran in /Users/isti/computress-6001, dexter's under /Users/isti/dexterwt, both nobody's by cwd).
//
// WHY A CPU FLOOR: an orphan with an agent's cwd is not necessarily work. mandark's adb server was
// an orphan in the mandark tree for 14 days with 12 CPU-minutes in total. Only a group that is
// using CPU now counts.
//
// WHY launchd JOBS AND THE tmux SERVER ARE EXCLUDED: they are orphans too, and the coordinator's
// pane path is the install root, where the dashboard itself runs (1.9 %CPU at measurement).
// EXCEPT THE fg-exec JOBS: scripts/fg-exec.py runs every heavy-run command as a launchd job of its
// own (com.marveen.fg.*), so excluding all launchd jobs hid every gate (a6a56d3a, 2026-10-30: a
// 470 %CPU vitest shard, excluded whole). Its members carry the agent's environment; only the
// job's root, started by launchd, does not.
//
// THE WAY OUT is not here: a detached group counts as background work, so the existing hold and its
// ghost guard (subagentSilentMs, marveen 26460) apply unchanged -- a runaway process cannot hide a
// stuck agent for longer than a silent sub-agent row can.
import { execFileSync } from 'node:child_process'
import { MAIN_AGENT_ID } from '../config.js'

export interface PsRow {
  pid: number
  ppid: number
  pgid: number
  pcpu: number
  etime: string
  command: string
}

export interface DetachedGroup {
  pgid: number
  /** Summed %CPU of the group's members, as ps reports it (a decaying average). */
  pcpu: number
  /** The member hanging off launchd: what started the job. */
  root: PsRow
  members: PsRow[]
}

/** %CPU summed over a group before it counts as work. adb measured 0.0, whisper several hundred. */
export const DETACHED_MIN_PCPU = 5

/** `ps -axo pid=,ppid=,pgid=,pcpu=,etime=,command=`. A decimal comma (Hungarian locale) is accepted. */
export function parsePs(out: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    rows.push({
      pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]),
      pcpu: Number(m[4].replace(',', '.')), etime: m[5], command: m[6],
    })
  }
  return rows
}

/** Process groups with a member reparented to launchd (PPID 1), using at least `minPcpu` in total.
 *  A group that holds any excluded pid (a launchd job, the tmux server) is left out whole. */
export function busyDetachedGroups(rows: PsRow[], excludePids: ReadonlySet<number>, minPcpu = DETACHED_MIN_PCPU): DetachedGroup[] {
  const byGroup = new Map<number, PsRow[]>()
  for (const r of rows) {
    const g = byGroup.get(r.pgid)
    if (g) g.push(r)
    else byGroup.set(r.pgid, [r])
  }
  const out: DetachedGroup[] = []
  for (const [pgid, members] of byGroup) {
    if (pgid <= 1) continue
    const root = members.find((m) => m.ppid === 1)
    if (!root) continue
    if (members.some((m) => excludePids.has(m.pid))) continue
    const pcpu = members.reduce((s, m) => s + m.pcpu, 0)
    if (pcpu >= minPcpu) out.push({ pgid, pcpu, root, members })
  }
  return out
}

const under = (cwd: string, path: string) => cwd === path || cwd.startsWith(path.endsWith('/') ? path : `${path}/`)

/** agent -> its detached groups. A group belongs to the agent its members' environment names (the
 *  first member that names one); failing that, to the agent whose pane path is the LONGEST prefix
 *  of a member's cwd, so a nested path wins over the install root. No match = nobody's. */
export function attributeDetached(
  groups: DetachedGroup[],
  cwdByPid: ReadonlyMap<number, string>,
  paneCwdByAgent: ReadonlyMap<string, string>,
  agentByPid: ReadonlyMap<number, string> = new Map(),
): Map<string, DetachedGroup[]> {
  const out = new Map<string, DetachedGroup[]>()
  for (const g of groups) {
    const byEnv = g.members.map((m) => agentByPid.get(m.pid)).find(Boolean)
    if (byEnv) {
      out.set(byEnv, [...(out.get(byEnv) ?? []), g])
      continue
    }
    let best: { agent: string; len: number } | null = null
    for (const m of g.members) {
      const cwd = cwdByPid.get(m.pid)
      if (!cwd) continue
      for (const [agent, path] of paneCwdByAgent) {
        if (path && under(cwd, path) && (!best || path.length > best.len)) best = { agent, len: path.length }
      }
    }
    if (best) out.set(best.agent, [...(out.get(best.agent) ?? []), g])
  }
  return out
}

/** `lsof -Fpn` output -> pid -> cwd. */
export function parseLsofCwd(out: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid: number | null = null
  for (const line of out.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1))
    else if (line.startsWith('n') && pid !== null) map.set(pid, line.slice(1))
  }
  return map
}

/** The launchd label prefix scripts/fg-exec.py gives the job it runs a heavy-run command in. */
export const FG_JOB_LABEL_PREFIX = 'com.marveen.fg.'

/** `launchctl list` -> the pids of running launchd jobs, the fleet's fg-exec jobs left out. */
export function parseLaunchctlPids(out: string): Set<number> {
  const pids = new Set<number>()
  for (const line of out.split('\n')) {
    const [pidField, , label] = line.split('\t')
    const pid = Number(pidField)
    if (Number.isInteger(pid) && pid > 0 && !label?.startsWith(FG_JOB_LABEL_PREFIX)) pids.add(pid)
  }
  return pids
}

/** CLAUDE_CONFIG_DIR -> the agent, by the rule of agent_name() in scripts/heavy-run.py:
 *  agents/<name>/..., the coordinator's .channels-config, ~/.<worker>/.claude-config. */
export function agentFromConfigDir(dir: string, mainAgent: string = MAIN_AGENT_ID): string | null {
  const parts = dir.replace(/\/+$/, '').split('/')
  const i = parts.indexOf('agents')
  if (i >= 0 && i + 1 < parts.length && parts[i + 1]) return parts[i + 1]
  const last = parts[parts.length - 1]
  if (last === '.channels-config') return mainAgent
  const parent = parts[parts.length - 2]
  if (last === '.claude-config' && parent?.startsWith('.') && parent.length > 1) return parent.slice(1)
  return null
}

/** `ps -wwE -o pid=,command=` -> pid -> the agent its CLAUDE_CONFIG_DIR names. macOS prints the
 *  environment AFTER the arguments, so the last occurrence on a line is the environment's (an
 *  argument can spell the variable out: the coordinator's tmux command line does, quoted). */
export function parsePsEnvAgents(out: string, mainAgent: string = MAIN_AGENT_ID): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s(.*)$/)
    if (!m) continue
    const hits = [...m[2].matchAll(/(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/g)]
    if (hits.length === 0) continue
    const agent = agentFromConfigDir(hits[hits.length - 1][1].replace(/^['"]|['"]$/g, ''), mainAgent)
    if (agent) map.set(Number(m[1]), agent)
  }
  return map
}

// maxBuffer: ps -E prints a whole environment per process (3.7 KB measured), past the 1 MB default
// for a few hundred members.
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 })

/** A command that exits 1 when one of the pids is gone by now (lsof, ps -p): what it printed is still good. */
const runTolerant = (cmd: string, args: string[]) => {
  try {
    return run(cmd, args)
  } catch (err) {
    return String((err as { stdout?: unknown }).stdout ?? '')
  }
}

/** One probe for the whole fleet (ps, launchctl, tmux, and lsof + ps -E on the busy orphans only:
 *  0.14 s measured before ps -E). Any failure returns an empty map, which is the behaviour before
 *  card ad730515. */
export function probeDetachedWork(paneCwdByAgent: ReadonlyMap<string, string>): Map<string, DetachedGroup[]> {
  try {
    const exclude = parseLaunchctlPids(run('launchctl', ['list']))
    try {
      const tmuxPid = Number(run('tmux', ['display-message', '-p', '#{pid}']).trim())
      if (tmuxPid > 0) exclude.add(tmuxPid)
    } catch { /* no tmux server: nothing to exclude */ }
    const groups = busyDetachedGroups(parsePs(run('ps', ['-axo', 'pid=,ppid=,pgid=,pcpu=,etime=,command='])), exclude)
    if (groups.length === 0) return new Map()
    const pids = groups.flatMap((g) => g.members.map((m) => m.pid)).join(',')
    const lsof = runTolerant('/usr/sbin/lsof', ['-a', '-d', 'cwd', '-Fpn', '-p', pids])
    const env = runTolerant('ps', ['-wwE', '-o', 'pid=,command=', '-p', pids])
    return attributeDetached(groups, parseLsofCwd(lsof), paneCwdByAgent, parsePsEnvAgents(env))
  } catch {
    return new Map()
  }
}

/** session -> pane_current_path, one tmux call. */
export function readPaneCwds(): Map<string, string> {
  const map = new Map<string, string>()
  try {
    for (const line of run('tmux', ['list-panes', '-a', '-F', '#{session_name}\t#{pane_current_path}']).split('\n')) {
      const [session, path] = line.split('\t')
      if (session && path && !map.has(session)) map.set(session, path)
    }
  } catch { /* no tmux: no paths, no attribution */ }
  return map
}
