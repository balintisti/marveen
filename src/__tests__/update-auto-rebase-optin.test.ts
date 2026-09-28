import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// REWRITTEN IN THE 88c366f2 MERGE. Upstream's version of this file (AUTOREBASEOPTIN922) tested
// upstream's update.sh block: it measured against `origin`, extracted text between anchors that do
// not exist in our script, and pinned two behaviours we deliberately do NOT have -- an ahead-only
// checkout that simply continues, and a failed fetch that "falls back to the last known origin ref".
// The merged update.sh is OUR fail-closed block (measure against $UPDATE_REMOTE, default `fork`;
// an unmeasurable count stops; ahead-only is refused on this install) with upstream's opt-in grafted
// in: UPDATE_AUTO_REBASE=1 replays the local commits onto the fetched tip. What upstream's cases
// protected is kept -- the opt-in is OFF by default, a failed fetch never rebases onto a stale ref,
// a clean rebase continues, a conflicting one aborts loudly -- and asserted on the block we ship.

const mkTmp = tmpDirs()
const UPDATE_SH = readFileSync(join(__dirname, '..', '..', 'update.sh'), 'utf-8')

function extractBlock(): string {
  const start = UPDATE_SH.indexOf('RESULT_PHASE="pull"\nif ! retry 3 3 git fetch "$UPDATE_REMOTE" "$CURRENT_BRANCH"; then')
  expect(start, 'the fetch that feeds the ahead/behind counts was not found in update.sh').toBeGreaterThan(-1)
  const end = UPDATE_SH.indexOf('\n# Pull latest', start)
  expect(end, 'block end marker (# Pull latest) not found').toBeGreaterThan(start)
  return UPDATE_SH.slice(start, end)
}

type Opts = {
  autoRebase?: string
  remote?: string
  fetchRc?: number
  ahead?: string // what `rev-list --count FETCH_HEAD..HEAD` prints; 'FAIL' makes it exit 1
  behind?: string
  rebaseRc?: number
}

function run(o: Opts): { code: number; out: string; calls: string[]; notified: boolean } {
  const dir = mkTmp('update-autorebase-')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  mkdirSync(join(dir, 'store'))
  mkdirSync(join(dir, 'scripts'))
  const calls = join(dir, 'git-calls.log')
  const ahead = o.ahead ?? '0'
  const behind = o.behind ?? '0'
  writeFileSync(join(bin, 'git'), `#!/bin/bash
echo "$*" >> "${calls}"
case "$*" in
  "fetch "*) exit ${o.fetchRc ?? 0} ;;
  "rev-list --count FETCH_HEAD..HEAD") [ "${ahead}" = FAIL ] && exit 1; echo ${ahead} ;;
  "rev-list --count HEAD..FETCH_HEAD") [ "${behind}" = FAIL ] && exit 1; echo ${behind} ;;
  "-c core.editor=true rebase FETCH_HEAD") exit ${o.rebaseRc ?? 0} ;;
  *) exit 0 ;;
esac
`, { mode: 0o755 })
  writeFileSync(join(dir, 'scripts', 'notify.sh'), `#!/bin/bash\ntouch "${dir}/notified"\n`, { mode: 0o755 })

  const script = `
set -u
PATH="${bin}:$PATH"
INSTALL_DIR="${dir}"
CURRENT_BRANCH="develop"
UPDATE_REMOTE="\${UPDATE_REMOTE:-fork}"
RED=''; NC=''; ORANGE=''; GREEN=''
RESULT_MSG=""
restore_stash_before_exit() { :; }
retry() { shift 2; "$@"; }
${extractBlock()}
echo "REACHED_END"
`
  const env: Record<string, string> = { ...process.env as Record<string, string> }
  delete env.UPDATE_AUTO_REBASE
  delete env.UPDATE_REMOTE
  if (o.autoRebase) env.UPDATE_AUTO_REBASE = o.autoRebase
  if (o.remote) env.UPDATE_REMOTE = o.remote
  let code = 0
  let out = ''
  try {
    out = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf-8', env })
  } catch (e) {
    const err = e as { status?: number; stdout?: string }
    code = err.status ?? 1
    out = err.stdout ?? ''
  }
  const logged = existsSync(calls) ? readFileSync(calls, 'utf-8').trim().split('\n') : []
  return { code, out, calls: logged, notified: existsSync(join(dir, 'notified')) }
}

const rebased = (r: { calls: string[] }) => r.calls.some((c) => c.includes('rebase FETCH_HEAD'))

describe('update.sh diverged-history handling (merged block: ours + the UPDATE_AUTO_REBASE opt-in)', () => {
  it('control: behind only is the ordinary fast-forward path -- continues, never rebases', () => {
    const r = run({ ahead: '0', behind: '4' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('REACHED_END')
    expect(rebased(r)).toBe(false)
  })

  it('opt-in OFF by default: a diverged checkout is refused with exit 5 and never rebased', () => {
    const r = run({ ahead: '3', behind: '2' })
    expect(r.code).toBe(5)
    expect(r.out).toContain('szetvalt')
    expect(rebased(r)).toBe(false)
  })

  it('opt-in OFF: AHEAD ONLY is refused too on this install (ours; upstream let it continue)', () => {
    const r = run({ ahead: '3', behind: '0' })
    expect(r.code).toBe(5)
    expect(r.out).toContain('nem frissitek')
  })

  it('a failed fetch stops BEFORE any count or rebase -- never onto a stale ref, even with the opt-in', () => {
    const r = run({ autoRebase: '1', fetchRc: 1, ahead: '3', behind: '2' })
    expect(r.code).toBe(5)
    expect(rebased(r)).toBe(false)
    expect(r.calls.some((c) => c.startsWith('rev-list'))).toBe(false)
  })

  it('an unmeasurable count is not zero: it stops', () => {
    expect(run({ ahead: 'FAIL', behind: '0' }).code).toBe(5)
    expect(run({ ahead: '0', behind: 'FAIL' }).code).toBe(5)
  })

  it('opt-in ON and a clean rebase: replays onto the fetched tip and continues', () => {
    const r = run({ autoRebase: '1', ahead: '3', behind: '2' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('REACHED_END')
    expect(r.calls.filter((c) => c.includes('rebase FETCH_HEAD'))).toHaveLength(1)
  })

  it('opt-in ON and a conflicting rebase: aborts, says so, notifies, exit 5', () => {
    const r = run({ autoRebase: '1', ahead: '3', behind: '2', rebaseRc: 1 })
    expect(r.code).toBe(5)
    expect(r.calls).toContain('rebase --abort')
    expect(r.notified).toBe(true)
  })

  it('opt-in ON and ahead only: the local commits are declared intentional -- continues, no rebase', () => {
    const r = run({ autoRebase: '1', ahead: '3', behind: '0' })
    expect(r.code).toBe(0)
    expect(r.out).toContain('REACHED_END')
    expect(rebased(r)).toBe(false)
  })

  it('measures against the UPDATE remote (default fork), never a hard-coded origin', () => {
    expect(run({}).calls[0]).toBe('fetch fork develop')
    expect(run({ remote: 'origin' }).calls[0]).toBe('fetch origin develop')
  })
})
