// THE CPU OF THE PANE'S BACKGROUND SHELLS (card cb25d896).
//
// The pane footer only COUNTS background work (`1 shell`, `2 shells, 1 monitor`), so a written
// handoff's restart waited for an idle local server exactly as long as for a test gate: zara's idle
// `python3 -m http.server` held her restart 45-55 minutes three times on 2026-11-18. Here each footer
// shell is mapped to its process and its subtree CPU is sampled once per guard sweep; the pure guard
// gets the verdict (BackgroundShellCpu) and does not wait for a shell idle over SHELL_CPU_WINDOW_MS.
//
// WHICH PROCESSES ARE THE FOOTER'S SHELLS. Claude Code runs every Bash call, background or not, and
// every Monitor as `/bin/zsh -c source <config>/shell-snapshots/snapshot-zsh-....sh ... && eval <cmd>
// < /dev/null && pwd -P >| <tmp>-cwd`, a child of the claude process, which is the tmux pane's pid
// (measured 2026-11-20 on dexter, ford, friday and marveen-channels: ford's `1 shell, 1 monitor` = two
// such children, friday's `1 shell` = one, marveen's `2 shells` = two; the MCP servers, the channel
// plugin and `caffeinate` are children too, without the snapshot mark). A sub-agent's FOREGROUND Bash
// call has the same shape (dexter's pane: 2 footer shells, 4 marked children while workers ran), so
// with a sub-agent row there is no verdict. The verdict needs the marked processes to match the footer
// count exactly; any other answer is "not measured", and the guard then holds as before.
//
// WHY OWN CPU PLUS REAPED CHILDREN. Two samples are a sweep or two apart, and a gate made of short
// processes (a vitest loop, a script of greps) does its work in children that start and die between
// them. `ps` TIME is the process's own CPU only, and on macOS `ps -S` does not fold reaped children
// in (measured 2026-11-20, Darwin 27: a zsh whose 3-second child had exited read 0:00.01 with and
// without -S; the first 15-minute run read a looping vitest as 0.4 s per 10 minutes, i.e. idle). The
// kernel does keep it: proc_pid_rusage ri_child_user/system_time on macOS (the same zsh: 0.744 s),
// cutime/cstime in /proc/<pid>/stat on Linux. Each process counts own + reaped-children CPU. A child
// that dies with CPU from before the window adds that to its parent too: an overcount, and an
// overcount only ever holds. Per-process deltas, not a subtree sum: a big child that exits between
// two samples would make a sum fall. One loss is known: a process that exec()s drops its children's
// time (XNU resets it), so a script whose LAST line execs loses its earlier children (see RISKS).
//
// A HEAVY-RUN GATE IS NOT IN THE SHELL'S SUBTREE. scripts/fg-exec.py starts the command as a launchd
// job of its own, so the shell that launched it shows only heavy-run.py waiting. Such a gate holds
// the restart as a heavy-run job (measureBackgroundWork, untouched here), not by this CPU.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { makeLazyBinResolver } from '../platform.js'
import { SHELL_CPU_IDLE_FLOOR_SEC, SHELL_CPU_MIN_SPAN_MS, SHELL_CPU_WINDOW_MS, type BackgroundShellCpu } from '../context-guard.js'

export interface ProcRow { ppid: number; cpuSec: number; command: string }
export type ProcTable = Map<number, ProcRow>

/** The mark of a Claude Code shell (Bash call or Monitor) on its command line. */
export const BACKGROUND_SHELL_MARK = '/shell-snapshots/snapshot-'
/** How long samples are kept: the window plus the drift of a few sweeps. */
const HISTORY_KEEP_MS = 3 * SHELL_CPU_WINDOW_MS

/** CPU seconds (own + reaped children) per pid; a pid that is gone is absent. null = not measurable. */
export type CpuReader = (pids: number[]) => Map<number, number> | null

const python3Bin = makeLazyBinResolver('python3')
// proc_pid_rusage(pid, RUSAGE_INFO_V2): 18 uint64 after the uuid; times in mach absolute units.
const DARWIN_RUSAGE_PY = [
  'import ctypes,sys',
  "lib=ctypes.CDLL('/usr/lib/libproc.dylib')",
  "class RU(ctypes.Structure): _fields_=[('uuid',ctypes.c_uint8*16)]+[(n,ctypes.c_uint64) for n in ('u','s','a','b','c','d','e','f','g','h','cu','cs','i','j','k','l','m','n')]",
  "class TB(ctypes.Structure): _fields_=[('numer',ctypes.c_uint32),('denom',ctypes.c_uint32)]",
  "tb=TB(); ctypes.CDLL('/usr/lib/libSystem.dylib').mach_timebase_info(ctypes.byref(tb)); f=tb.numer/tb.denom/1e9",
  'for a in sys.argv[1:]:',
  '  r=RU()',
  "  if lib.proc_pid_rusage(int(a),2,ctypes.byref(r))==0: print(a, (r.u+r.s+r.cu+r.cs)*f)",
].join('\n')

function darwinCpu(pids: number[]): Map<number, number> | null {
  try {
    const out = execFileSync(python3Bin(), ['-I', '-c', DARWIN_RUSAGE_PY, ...pids.map(String)], { timeout: 5000, encoding: 'utf-8' })
    return parseCpuLines(out)
  } catch {
    return null
  }
}

let clockTicks: number | null = null
function linuxCpu(pids: number[]): Map<number, number> | null {
  try {
    clockTicks ??= parseInt(execFileSync('getconf', ['CLK_TCK'], { timeout: 3000, encoding: 'utf-8' }).trim(), 10)
    if (!(clockTicks > 0)) return null
    const cpu = new Map<number, number>()
    for (const pid of pids) {
      let stat: string
      try { stat = readFileSync(`/proc/${pid}/stat`, 'utf8') } catch { continue }
      // Fields after the parenthesised name: state is 3, utime 14, stime 15, cutime 16, cstime 17.
      const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      const ticks = Number(f[11]) + Number(f[12]) + Number(f[13]) + Number(f[14])
      if (!Number.isFinite(ticks)) return null
      cpu.set(pid, ticks / clockTicks)
    }
    return cpu
  } catch {
    return null
  }
}

/** `<pid> <seconds>` lines; any unreadable line makes the whole reading not measured. */
export function parseCpuLines(out: string): Map<number, number> | null {
  const cpu = new Map<number, number>()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const m = /^\s*(\d+)\s+(\d+(?:\.\d+)?(?:e-?\d+)?)\s*$/.exec(line)
    if (!m) return null
    cpu.set(parseInt(m[1], 10), Number(m[2]))
  }
  return cpu
}

export const readCpuSeconds: CpuReader = (pids) =>
  pids.length === 0 ? new Map() : process.platform === 'darwin' ? darwinCpu(pids) : process.platform === 'linux' ? linuxCpu(pids) : null

/**
 * The pane root's process subtree with each process's CPU (own + reaped children). One `ps` for the
 * tree, one CPU read for its members. null when either fails: the caller holds, never reads that as
 * idle. A member gone between the two reads is left out: its CPU is in its parent's children now.
 */
export function readProcessTable(
  rootPid: number,
  runPs: () => string = () => execFileSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,command='], { timeout: 5000, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }),
  readCpu: CpuReader = readCpuSeconds,
): ProcTable | null {
  let out: string
  try { out = runPs() } catch { return null }
  const all = new Map<number, { ppid: number; command: string }>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s?(.*)$/.exec(line)
    if (m) all.set(parseInt(m[1], 10), { ppid: parseInt(m[2], 10), command: m[3] })
  }
  if (!all.has(rootPid)) return all.size > 0 ? new Map() : null
  const kids = new Map<number, number[]>()
  for (const [pid, r] of all) {
    const list = kids.get(r.ppid)
    if (list) list.push(pid)
    else kids.set(r.ppid, [pid])
  }
  const members: number[] = []
  const stack = [...(kids.get(rootPid) ?? [])]
  while (stack.length > 0) {
    const pid = stack.pop() as number
    if (members.includes(pid)) continue
    members.push(pid)
    stack.push(...(kids.get(pid) ?? []))
  }
  const cpu = readCpu(members)
  if (cpu === null) return null
  const root = all.get(rootPid) as { ppid: number; command: string }
  const table: ProcTable = new Map([[rootPid, { ppid: root.ppid, cpuSec: 0, command: root.command }]])
  for (const pid of members) {
    const sec = cpu.get(pid)
    if (sec !== undefined) table.set(pid, { ...(all.get(pid) as { ppid: number; command: string }), cpuSec: sec })
  }
  return table
}

/** What the shell runs: the `eval` payload of the wrapper, unquoted, `\012` (ps's newline) as a newline.
 *  A command line of another shape is returned whole: it still names the process. */
export function backgroundShellCommand(raw: string): string {
  const at = raw.lastIndexOf(' && eval ')
  if (at < 0) return raw
  let s = raw.slice(at + ' && eval '.length)
  const end = s.lastIndexOf(' < /dev/null && pwd -P >| ')
  if (end >= 0) s = s.slice(0, end)
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1).split(`'"'"'`).join("'").split(`'\\''`).join("'")
  return s.replace(/\\012/g, '\n')
}

function childrenOf(table: ProcTable): Map<number, number[]> {
  const kids = new Map<number, number[]>()
  for (const [pid, row] of table) {
    const list = kids.get(row.ppid)
    if (list) list.push(pid)
    else kids.set(row.ppid, [pid])
  }
  return kids
}

/** The topmost marked processes under the pane root (a shell nested in another shell is part of it). */
export function findBackgroundShells(rootPid: number, table: ProcTable): number[] {
  const kids = childrenOf(table)
  const found: number[] = []
  const stack = [...(kids.get(rootPid) ?? [])]
  while (stack.length > 0) {
    const pid = stack.pop() as number
    if (table.get(pid)?.command.includes(BACKGROUND_SHELL_MARK)) found.push(pid)
    else stack.push(...(kids.get(pid) ?? []))
  }
  return found.sort((a, b) => a - b)
}

function subtreeCpu(rootPid: number, table: ProcTable): Map<number, number> {
  const kids = childrenOf(table)
  const cpu = new Map<number, number>()
  const stack = [rootPid]
  while (stack.length > 0) {
    const pid = stack.pop() as number
    const row = table.get(pid)
    if (!row || cpu.has(pid)) continue
    cpu.set(pid, row.cpuSec)
    stack.push(...(kids.get(pid) ?? []))
  }
  return cpu
}

interface Sample { atMs: number; cpuByPid: Map<number, number> }

/** CPU seconds the subtree used since the baseline: per process, a process new since then counts
 *  whole, and one whose counter went backwards (pid reuse) counts whole too. */
function cpuSince(base: Map<number, number>, now: Map<number, number>): number {
  let used = 0
  for (const [pid, sec] of now) {
    const then = base.get(pid)
    used += then !== undefined && then <= sec ? sec - then : sec
  }
  return used
}

export interface FooterCounts { subagents: number; shells: number; monitors: number }

/**
 * Samples kept across sweeps, per agent and per shell (pid + command, so a reused pid starts over).
 * judge() records a sample of every marked shell it can see, also when it gives no verdict, so a
 * shell already has its baseline when the sub-agents finish or the pane goes idle.
 */
export class ShellCpuTracker {
  private readonly history = new Map<string, Map<string, Sample[]>>()

  forget(agent: string): void {
    this.history.delete(agent)
  }

  judge(agent: string, nowMs: number, footer: FooterCounts, rootPid: number | null, table: ProcTable | null): BackgroundShellCpu {
    const expected = footer.shells + footer.monitors
    if (table === null) return { ok: false, why: 'ps failed' }
    if (rootPid === null || !table.has(rootPid)) return { ok: false, why: 'pane process not found' }
    const shells = findBackgroundShells(rootPid, table)
    const seen = new Map<string, Sample[]>()
    const old = this.history.get(agent) ?? new Map<string, Sample[]>()
    const verdicts: { command: string; idle: boolean | null }[] = []
    for (const pid of shells) {
      const raw = (table.get(pid) as ProcRow).command
      const key = `${pid}\u0000${raw}`
      const samples = (old.get(key) ?? []).filter((s) => nowMs - s.atMs <= HISTORY_KEEP_MS && s.atMs < nowMs)
      const cpuByPid = subtreeCpu(pid, table)
      let base: Sample | undefined
      for (const s of samples) if (nowMs - s.atMs >= SHELL_CPU_MIN_SPAN_MS) base = s
      let idle: boolean | null = null
      if (base) {
        const perWindow = cpuSince(base.cpuByPid, cpuByPid) * SHELL_CPU_WINDOW_MS / (nowMs - base.atMs)
        idle = perWindow < SHELL_CPU_IDLE_FLOOR_SEC
      }
      samples.push({ atMs: nowMs, cpuByPid })
      seen.set(key, samples)
      verdicts.push({ command: backgroundShellCommand(raw), idle })
    }
    this.history.set(agent, seen)
    if (footer.subagents > 0) return { ok: false, why: `${footer.subagents} sub-agent(s) running, their shells look the same in ps` }
    if (shells.length !== expected) return { ok: false, why: `the footer counts ${expected} shell(s)/monitor(s), the process table has ${shells.length}` }
    const pending = verdicts.filter((v) => v.idle === null).length
    if (pending > 0) return { ok: false, why: `no CPU verdict yet for ${pending} shell(s): the first sample is younger than ${Math.round(SHELL_CPU_MIN_SPAN_MS / 60_000)}m` }
    return { ok: true, idle: verdicts.filter((v) => v.idle === true).map((v) => v.command) }
  }
}
