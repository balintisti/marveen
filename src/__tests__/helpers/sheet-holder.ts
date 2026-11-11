// A second PROCESS that takes a rule sheet's lock the way the sheet editors do
// (scripts/claude-md-edit.py: flock on the page's own descriptor, read, write in place), for the
// tests of web/sheet-lock.ts. It has to be a process: the write step under test blocks this one.
import { spawn } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'

const HOLDER = `
import fcntl, os, sys, time
page, ready, mode, hold, go = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), sys.argv[5]
fd = os.open(page, os.O_RDWR)
fcntl.flock(fd, fcntl.LOCK_EX)
s = os.read(fd, 1 << 22)
open(ready, 'w').write('locked')
until = time.monotonic() + 10
while go and not os.path.exists(go) and time.monotonic() < until:
    time.sleep(0.01)
time.sleep(hold)
if mode == 'edit':
    os.lseek(fd, 0, 0); os.ftruncate(fd, 0); os.write(fd, s + b'EDITOR LINE\\n')
elif mode == 'rename':
    tmp = page + '.holder.tmp'
    open(tmp, 'wb').write(s + b'RENAMED LINE\\n')
    os.rename(tmp, page)
fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
`

export type HolderMode =
  /** Reads under the lock, waits, writes its text plus 'EDITOR LINE' in place: a sheet editor. */
  | 'edit'
  /** Holds the lock, and before letting go puts a NEW file (its text plus 'RENAMED LINE') at the path. */
  | 'rename'
  /** Holds the lock and writes nothing. */
  | 'hold'

export interface SheetHolder {
  /** Resolves with the exit code when the other process has left. */
  done: Promise<number | null>
  /** With `waitForGo`: the holder's `holdMs` starts counting only once this is called. */
  go: () => void
}

/**
 * Resolves once the other process HOLDS the lock and has read the page. It then waits `holdMs`,
 * does what its mode says, and lets go.
 *
 * `waitForGo`: the wait starts at `go()`, not at the lock. A test that must be sure its own read
 * happened BEFORE the holder's write calls `go()` after that read; the `holdMs` after it is the
 * time the write step under test gets to reach the lock, so that it meets a held one.
 */
export async function holdSheet(page: string, mode: HolderMode, holdMs: number, opts: { waitForGo?: boolean } = {}): Promise<SheetHolder> {
  const ready = `${page}.holder-ready`
  const goFile = `${page}.holder-go`
  rmSync(ready, { force: true })
  rmSync(goFile, { force: true })
  const child = spawn('python3', ['-c', HOLDER, page, ready, mode, String(holdMs / 1000), opts.waitForGo ? goFile : ''], { stdio: 'ignore' })
  const done = new Promise<number | null>((resolve) => child.on('close', (code) => {
    rmSync(goFile, { force: true })
    resolve(code)
  }))
  const until = Date.now() + 10_000
  while (!existsSync(ready)) {
    if (Date.now() > until) throw new Error('the lock holder did not start')
    await new Promise((r) => setTimeout(r, 10))
  }
  rmSync(ready, { force: true })
  return { done, go: () => writeFileSync(goFile, 'go') }
}
