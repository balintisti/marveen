// Which remote does the installation update itself FROM?
//
// In this repository `origin` is the FOREIGN upstream (Szotasz/marveen) and
// `fork` is ours. update.sh hardcoded `origin` in both the branch check and the
// pull, so a successful run would have installed a third party's code into the
// live installation.
//
// Measured 2026-08-27 (card bae4df49): three gates stood in front of that, and
// the one the card called a BUG was the only one actually closed by intent --
// the checkout sits on a branch that does not exist on origin, so the check
// refused. The obvious "fix" (move the checkout to a branch origin does have)
// would have opened that gate and armed the pull. The fix belongs on the
// REMOTE, not on the branch name, and these tests pin that.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '..', '..', 'update.sh'), 'utf8')

/** update.sh with `#` comments removed, LINE NUMBERS PRESERVED. The prose in
 *  this file names `origin` on purpose (it explains why the default is not
 *  origin), so a check that reads comments would flag its own explanation --
 *  the trap the migration checklists in CLAUDE.md were rewritten for. */
const codeOnly = SRC.split('\n').map((l) => l.replace(/#.*$/, ''))

/** CALL SITES, not every line that mentions a git command. The first version of
 *  this filter matched any line containing `git pull`, which swept in an error
 *  MESSAGE ("git pull --ff-only sikertelen ...") and failed -- the predicate was
 *  wider than the word in its name. A call site executes; a message quotes. The
 *  discriminator is whether the match sits inside a double-quoted string. */
function isCallSite(line: string): boolean {
  const m = /git\s+(pull|ls-remote|fetch)\b/.exec(line)
  if (!m) return false
  const quotesBefore = (line.slice(0, m.index).match(/"/g) ?? []).length
  return quotesBefore % 2 === 0
}

const gitRemoteLines = codeOnly.filter(isCallSite)

describe('update.sh: the remote it pulls from', () => {
  it('finds the call sites at all (control for the stripping AND the filter)', () => {
    // Without this, a stripping bug or a rename makes every assertion below
    // pass over an empty list -- green because it looked at nothing.
    expect(gitRemoteLines.length).toBeGreaterThanOrEqual(2)
  })

  it('defaults to a remote that is NOT the foreign upstream', () => {
    const m = SRC.match(/^UPDATE_REMOTE="\$\{UPDATE_REMOTE:-([a-z0-9_-]+)\}"/m)
    expect(m, 'UPDATE_REMOTE must be defined with a default').not.toBeNull()
    expect(m![1]).not.toBe('origin')
    expect(m![1]).toBe('fork')
  })

  it('names no literal remote on any git pull/ls-remote/fetch line', () => {
    // The property, not the presence: it is not enough that UPDATE_REMOTE
    // exists somewhere -- no call site may still carry a hardcoded name.
    const hardcoded = gitRemoteLines.filter((l) => /\b(origin|fork|upstream|old-origin)\b/.test(l))
    expect(hardcoded).toEqual([])
  })

  it('every such line goes through the variable', () => {
    const missing = gitRemoteLines.filter((l) => !/\$\{?UPDATE_REMOTE\}?/.test(l))
    expect(missing).toEqual([])
  })

  it('measures "am I ahead" against the SAME remote it will pull from', () => {
    // Found by jarvis 2026-08-27, after the remote switch and NOT covered by the
    // questions I asked him. The ahead-check used `@{u}` -- the branch's own
    // upstream -- which happened to equal the pull remote only while both were
    // `origin`. Measured on the live checkout afterwards: `@{u}` does not
    // resolve at all (the branch has no upstream), 5 of 6 local branches point
    // theirs at the FOREIGN origin, and the checkout was 15 commits ahead of
    // fork/<branch> while the guard reported 0.
    expect(codeOnly.join('\n')).not.toMatch(/@\{u\}/)
    const aheadLine = codeOnly.find((l) => /AHEAD=/.test(l) && /rev-list/.test(l))
    expect(aheadLine, 'the ahead-check must still exist').toBeDefined()
    expect(aheadLine!).toMatch(/FETCH_HEAD/)
  })

  it('does not turn an unmeasurable ahead-count into zero', () => {
    // `|| echo 0` was the whole defect: a count we could not compute became the
    // one value that lets the pull proceed. A guard that cannot measure must
    // stop, not pick the reassuring answer.
    const aheadLine = codeOnly.find((l) => /AHEAD=/.test(l) && /rev-list/.test(l))!
    expect(aheadLine).not.toMatch(/\|\|\s*echo\s*0/)
  })

  it('does not re-introduce the silent zero at the COMPARISON either', () => {
    // jarvis, in the intersection check: the `|| echo 0` came out of the
    // computation, but `${AHEAD:-0}` stayed two lines below it -- the same
    // "cannot measure -> assume the reassuring value", in the comparison. It
    // was unreachable, and that is exactly why it would have survived: a later
    // edit to the computation brings the silent zero back without touching the
    // line that carries it.
    const cmp = codeOnly.find((l) => /\bAHEAD\b/.test(l) && /-gt/.test(l))
    expect(cmp, 'the ahead comparison must still exist').toBeDefined()
    expect(cmp!).not.toMatch(/\$\{AHEAD:-/)
  })

  it('fetches the update remote before asking whether we are ahead of it', () => {
    // "Am I ahead of the remote" is unanswerable without knowing where the
    // remote is; FETCH_HEAD is only meaningful after a fetch.
    const fetchIdx = codeOnly.findIndex((l) => isCallSite(l) && /git\s+fetch/.test(l))
    const aheadIdx = codeOnly.findIndex((l) => /AHEAD=/.test(l) && /rev-list/.test(l))
    expect(fetchIdx).toBeGreaterThan(-1)
    expect(aheadIdx).toBeGreaterThan(fetchIdx)
  })

  it('is overridable, so a different install can point elsewhere without a patch', () => {
    expect(SRC).toContain('UPDATE_REMOTE="${UPDATE_REMOTE:-')
  })
})
