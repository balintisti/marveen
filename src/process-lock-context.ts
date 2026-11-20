// I/O surface for process-lock.ts, shared by the startup takeover (index.ts)
// and the web server's EADDRINUSE reclaim (web.ts) so both make the SAME
// install-affinity decision (card 77a48069: the reclaim had its own kill loop
// with no install check, didi 72633). Kept out of process-lock.ts so that
// module stays pure and testable with a mock ctx.
import { readlinkSync, realpathSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { PROJECT_ROOT } from './config.js'
import { listListeningPids, runLsof } from './lsof.js'
import { listAncestorPids } from './process-tree.js'
import { logger } from './logger.js'
import { belongsToInstall, type ProcessLockContext } from './process-lock.js'

// Own-install affinity guard for the takeover kill. The binary pattern alone
// matches ANY Marveen dashboard argv of the same UID -- including a SECOND
// install's live process (federation makes multi-install machines a supported
// reality, and dev/test copies always existed). Only processes that belong to
// THIS install may be taken over: an absolute argv must contain PROJECT_ROOT,
// a relative argv ("node dist/index.js" via npm start) must have its cwd
// inside PROJECT_ROOT. A process we cannot attribute is left alone -- failing
// to reclaim our own port surfaces as EADDRINUSE (handled downstream), while
// killing a stranger's dashboard would be silent data-plane damage.
function processCwd(pid: number): string | null {
  try {
    // Linux: cheap and exact.
    return readlinkSync(`/proc/${pid}/cwd`)
  } catch { /* not Linux or no access; try lsof (macOS) */ }
  // Resolved-path lsof (LSOFPATH805): a bare `lsof` was command-not-found under
  // the launchd PATH and silently returned null on the live box.
  const raw = runLsof(['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], 2000)
  if (raw == null) return null
  const line = raw.split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : null
}

// The names this install is known by: PROJECT_ROOT as configured and its
// realpath (a symlinked path and lsof's resolved cwd must both match).
function installRoots(): string[] {
  const roots = [PROJECT_ROOT]
  try {
    const real = realpathSync(PROJECT_ROOT)
    if (real !== PROJECT_ROOT) roots.push(real)
  } catch { /* unresolvable: the configured name alone */ }
  return roots
}

function argvBelongsToThisInstall(argv: string, pid: number, roots: readonly string[]): boolean {
  return belongsToInstall(argv, () => processCwd(pid), roots)
}

// Full argv of one PID (`ps -p <pid> -o args=`), or null if gone.
function processArgv(pid: number): string | null {
  try {
    return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'args='], { timeout: 2000, encoding: 'utf-8' }).trim() || null
  } catch {
    return null
  }
}

// Build the I/O surface used by process-lock.ts. Kept here so the pure
// module stays testable with a mock ctx and never imports node:child_process
// or node:fs directly.
export function buildProcessLockContext(): ProcessLockContext {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  // realpath so this compares equal against /proc/<pid>/cwd, which the
  // kernel always reports fully symlink-resolved -- an un-resolved
  // PROJECT_ROOT (e.g. reached via a symlinked path) would otherwise never
  // match even for our own genuine predecessor.
  let selfProjectRoot: string | null
  try {
    selfProjectRoot = realpathSync(PROJECT_ROOT)
  } catch {
    selfProjectRoot = null
  }
  const roots = installRoots()
  return {
    currentPid: process.pid,
    uid,
    selfProjectRoot,
    ancestorPids: listAncestorPids(process.ppid),
    installRoots: roots,
    getProcessArgv: processArgv,
    getProcessCwd(pid: number): string | null {
      // Resolve the PID's cwd on BOTH platforms via the shared processCwd
      // helper: /proc on Linux, `lsof -a -p <pid> -d cwd` on macOS. A previous
      // version was /proc-only, which returned null for every pid on macOS (no
      // /proc) and silently disabled the byBinary single-instance reclaim on
      // the production platform. realpath the result so it compares equal to
      // selfProjectRoot (also realpath'd) -- two different-looking paths to the
      // same directory (symlink / bind mount) must still match. If the path is
      // gone by the time we realpath, fall back to the raw value.
      const cwd = processCwd(pid)
      if (cwd == null) return null
      try {
        return realpathSync(cwd)
      } catch {
        return cwd
      }
    },
    listPortHolders(port: number): number[] {
      // Resolved-path lsof (LSOFPATH805): under the launchd PATH the old bare
      // `lsof -ti` was command-not-found and silently returned [], so this
      // port-holder probe -- which the single-instance reclaim depends on --
      // found no one on the live box. runLsof resolves an absolute lsof and
      // warns loudly if none exists rather than returning a silent empty.
      // LISTEN only (lsof.ts listListeningPids): a client of the port is not a
      // predecessor (card 77a48069).
      return listListeningPids(port)
    },
    listOwnProcessesMatching(pattern: RegExp): number[] {
      // `ps -A -o pid=,uid=,args=` emits `<pid> <uid> <full argv>` per row.
      // Filter to own-UID rows whose argv matches `pattern`. Known edge
      // case: an argv that contains a literal newline will be split across
      // physical lines; such rows are dropped. Not a practical concern for
      // node/tsx invocations, but worth noting.
      try {
        const raw = execFileSync('/bin/ps', ['-Ao', 'pid=,uid=,args='], { timeout: 3000, encoding: 'utf-8' })
        const out: number[] = []
        for (const line of raw.split('\n')) {
          const trimmed = line.trimStart()
          if (!trimmed) continue
          const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/)
          if (!m) continue
          const pid = parseInt(m[1], 10)
          const rowUid = parseInt(m[2], 10)
          const argv = m[3]
          if (!Number.isFinite(pid) || pid <= 0) continue
          if (pid === process.pid) continue
          if (uid != null && rowUid !== uid) continue
          if (!pattern.test(argv)) continue
          if (!argvBelongsToThisInstall(argv, pid, roots)) continue
          out.push(pid)
        }
        return out
      } catch {
        return []
      }
    },
    getProcessCommand(pid: number): string | null {
      try {
        return execFileSync('/bin/ps', ['-p', String(pid), '-o', 'comm='], { timeout: 2000, encoding: 'utf-8' }).trim() || null
      } catch {
        return null
      }
    },
    getProcessUid(pid: number): number | null {
      try {
        const out = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'uid='], { timeout: 2000, encoding: 'utf-8' }).trim()
        const parsed = parseInt(out, 10)
        return Number.isFinite(parsed) ? parsed : null
      } catch {
        return null
      }
    },
    signal(pid: number, sig): 'sent' | 'gone' {
      try {
        process.kill(pid, sig as NodeJS.Signals | 0)
        return 'sent'
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ESRCH') return 'gone'
        // EPERM and others: the process exists but we can't probe. Rethrow
        // so callers treat it as "still alive".
        throw err
      }
    },
    sleep(ms: number): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, ms))
    },
    log: {
      info: (obj, msg) => logger.info(obj, msg),
      warn: (obj, msg) => logger.warn(obj, msg),
      error: (obj, msg) => logger.error(obj, msg),
    },
  }
}
