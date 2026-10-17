import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * The heavy-run jobs (scripts/heavy-run.py) an agent has RUNNING or WAITING right now -- the test
 * gates, full suites and builds the context guard must not restart under (card c8852bba).
 *
 * heavy-run writes one JSON file per slot holder (`slot-<i>`, `light-<i>`) and per queued waiter
 * (`tickets/`, `tickets-light/`), each naming the agent (from CLAUDE_CONFIG_DIR, so it is right in
 * any worktree) and the pid of the heavy-run process. A file outlives its run: heavy-run itself
 * tells a live one by its flock, which node cannot take, so here a live PID is the proof. A reused
 * pid can at worst hold one routine restart, and BACKGROUND_DEFER_MAX_MS bounds that.
 *
 * The pane cannot see these: a gate started detached (start_new_session) is no shell of the
 * session, and it is exactly the long work an agent leaves running.
 */
export interface HeavyRunJob {
  label: string
  waiting: boolean
  pid: number
}

const HELD = /^(?:slot|light)-\d+$/
const QUEUES = ['tickets', 'tickets-light']

export function heavyRunDir(): string {
  return process.env.HEAVY_RUN_DIR || join(homedir(), '.heavy-run')
}

function pidAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists and belongs to someone else -- alive.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readJob(path: string): { agent?: unknown; pid?: unknown; label?: unknown } | null {
  try {
    const v = JSON.parse(readFileSync(path, 'utf8') || 'null')
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

function list(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

export function liveHeavyRunJobs(agent: string, dir: string = heavyRunDir()): HeavyRunJob[] {
  const out: HeavyRunJob[] = []
  const take = (path: string, waiting: boolean) => {
    const j = readJob(path)
    if (j && j.agent === agent && pidAlive(j.pid)) {
      out.push({ label: typeof j.label === 'string' ? j.label : '?', waiting, pid: j.pid as number })
    }
  }
  for (const f of list(dir)) if (HELD.test(f)) take(join(dir, f), false)
  for (const q of QUEUES) for (const f of list(join(dir, q))) take(join(dir, q, f), true)
  return out
}

/**
 * Whether `pid` runs inside the process tree rooted at `rootPid` (the agent's tmux pane), walking
 * the parent links of one process-table snapshot (card 3c3d8e43). A restart is `tmux kill-session`:
 * what descends from the pane dies with it, and a gate launched detached (its launcher exited, so
 * the chain ends at pid 1) runs on. Measured 2026-10-16: computress-6079-gate, started from the
 * pane, died (rc null); the detached gates the guard also listed as killed finished minutes later.
 *
 * true = in the pane's tree (a descendant that left its session could still survive: reported as
 * killed, the safe direction); false = the chain ends at pid 1 or 0 outside it; null = not
 * measured (pid gone from the snapshot, or a chain that does not end).
 */
export function descendsFrom(pid: number, rootPid: number, parentOf: ReadonlyMap<number, number>): boolean | null {
  let cur = pid
  for (let hops = 0; hops < 256; hops++) {
    if (cur === rootPid) return true
    const parent = parentOf.get(cur)
    if (parent === undefined) return null
    if (parent <= 1) return false
    cur = parent
  }
  return null
}
