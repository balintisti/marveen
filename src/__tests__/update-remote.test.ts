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

  it('is overridable, so a different install can point elsewhere without a patch', () => {
    expect(SRC).toContain('UPDATE_REMOTE="${UPDATE_REMOTE:-')
  })
})
