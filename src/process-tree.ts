import { execFileSync } from 'node:child_process'

// Walk the parent chain (ppid, its ppid, ...) so the takeover never kills its
// own launcher (npx / tsx / npm run). Bounded and best-effort: a ps failure
// ends the walk with what was collected, which only narrows the exclusion.
export function listAncestorPids(firstParent: number): Set<number> {
  const out = new Set<number>()
  let pid = firstParent
  for (let hops = 0; hops < 64 && Number.isFinite(pid) && pid > 1 && !out.has(pid); hops++) {
    out.add(pid)
    try {
      pid = parseInt(execFileSync('/bin/ps', ['-p', String(pid), '-o', 'ppid='], { timeout: 2000, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), 10)
    } catch {
      break
    }
  }
  return out
}
