import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY THIS TOOL EXISTS (2026-08-23, from Jarvis's distinction).
//
// Two branches touching the same file with NO git conflict is not one
// situation but two, and they carry very different risk:
//   disjoint hunks -- different regions; the structure already answers it
//   OVERLAPPING hunks -- the same region, merged silently; the combined
//                        behaviour is simply unknown
// From the outside both read as "shared file, no conflict". Telling them apart
// by eye means reading two diffs and comparing line ranges by hand -- the kind
// of check that gets skipped at one in the morning, which is exactly when
// these merges get proposed.
//
// Measured on four real pairings that evening, and the tool reproduces all
// four: src/db.ts and web/app.js disjoint; src/heartbeat.ts and
// scripts/agent-msg.sh overlapping (both of which DID need a behaviour
// measurement, and both of which got one).
//
// These tests build their own throwaway repository rather than pinning the
// real branches: a test that depends on today's branch layout goes red the day
// someone merges, and a red test that means "the world moved" teaches people
// to ignore it.

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'merge-overlap.py')

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' })
}

/** A repo with a base commit and two branches, each rewriting the given lines. */
function repoWith(aLines: number[], bLines: number[], aFile = 'f.txt', bFile = 'f.txt'): string {
  const dir = mkdtempSync(join(tmpdir(), 'mergeoverlap-'))
  git(dir, 'init', '-q', '-b', 'base')
  git(dir, 'config', 'user.email', 't@t.t')
  git(dir, 'config', 'user.name', 'T')
  const base = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
  writeFileSync(join(dir, 'f.txt'), base.join('\n') + '\n')
  writeFileSync(join(dir, 'g.txt'), base.join('\n') + '\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-qm', 'base')

  for (const [branch, lines, file] of [['a', aLines, aFile], ['b', bLines, bFile]] as const) {
    git(dir, 'checkout', '-q', '-b', branch, 'base')
    const content = [...base]
    for (const n of lines) content[n - 1] = `${content[n - 1]} edited by ${branch}`
    writeFileSync(join(dir, file), content.join('\n') + '\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-qm', branch)
  }
  return dir
}

function probe(dir: string, extra: string[] = []) {
  const r = spawnSync('python3', [SCRIPT, 'a', 'b', '--base', 'base', ...extra], {
    cwd: dir, encoding: 'utf-8', timeout: 60_000,
  })
  return { status: r.status ?? -1, out: r.stdout ?? '' }
}

describe('merge-overlap.py -- which shared files need a behaviour measurement', () => {
  it('calls FAR-APART edits disjoint, and exits 0', () => {
    const r = probe(repoWith([3], [30]))
    expect(r.out).toMatch(/diszjunkt/)
    expect(r.out).not.toMatch(/ATFEDO/)
    expect(r.status).toBe(0)
  })

  it('calls SAME-REGION edits overlapping, and exits 1', () => {
    // The whole point: git merges this without a word, and the exit status is
    // the only thing that will stop someone at 01:30.
    //
    // DISTANCE 4 IS DELIBERATE, AND MEASURED. With git's default 3 lines of
    // context the silent-risk window is exactly 2..6 lines apart: at 1 git
    // conflicts (loud), from 7 the hunks no longer touch. The first version of
    // this test used distance 1 and got a CONFLICT -- it would have passed on
    // a tool that never reported the quiet class at all.
    const r = probe(repoWith([10], [14]))
    expect(r.out).toMatch(/ATFEDO/)
    expect(r.out).toMatch(/VISELKEDES-MERES KELL/)
    expect(r.status).toBe(1)
  })

  it('names the diff.context it used, and the band that follows from it', () => {
    // The verdict carries its own validity condition. Without this a reader
    // cannot tell WHICH band produced the answer, and a measurer of silent
    // failures must not itself be quietly answering a different question.
    const out = probe(repoWith([10], [14])).out
    expect(out).toMatch(/diff\.context: 3 \(alapertelmezes\)/)
    expect(out).toMatch(/csendes sav: 2\.\.6 sor/)
  })

  it('TRACKS diff.context -- the same gap flips class when the setting changes', () => {
    // jarvis derived the rule and predicted it: band = 2 .. (2 x context),
    // because a hunk is the change plus context on BOTH sides. A 7-line gap is
    // disjoint at context=3 and overlapping at context=5.
    //
    // This is the test that matters: printing the number proves nothing on its
    // own, and a tool that PRINTS 5 while still classifying by 3 would look
    // right in every report it ever produced.
    const wide = repoWith([10], [17])
    expect(probe(wide).out).toMatch(/diszjunkt/)

    const wide5 = repoWith([10], [17])
    execFileSync('git', ['config', 'diff.context', '5'], { cwd: wide5 })
    const out5 = probe(wide5).out
    expect(out5).toMatch(/diff\.context: 5/)
    expect(out5).toMatch(/csendes sav: 2\.\.10 sor/)
    expect(out5).toMatch(/ATFEDO/)
  })

  it('puts the boundary where git actually puts it: 1 conflicts, 4 overlaps, 10 is disjoint', () => {
    // Three points, because a single one cannot show that the tool tracks the
    // real boundary rather than some threshold of its own. Measured with the
    // default 3-line context; a repo that changes diff.context moves this band,
    // which is worth knowing before trusting the verdict.
    expect(probe(repoWith([10], [11])).out).toMatch(/KONFLIKTUS/)
    expect(probe(repoWith([10], [14])).out).toMatch(/ATFEDO/)
    expect(probe(repoWith([10], [20])).out).toMatch(/diszjunkt/)
  })

  it('prints the overlapping line ranges, not just a verdict', () => {
    // A verdict with no numbers cannot be checked by the person who receives
    // it, and this tool exists to be handed to someone else.
    const r = probe(repoWith([10], [14]))
    expect(r.out).toMatch(/a:\d+-\d+\s+x\s+b:\d+-\d+/)
  })

  it('says there was NOTHING to measure instead of reporting safety', () => {
    // An empty sweep reading as a pass is the failure mode this whole family of
    // checks keeps hitting. No shared file means the tool had no input -- which
    // is not the same as a safe merge.
    const r = probe(repoWith([3], [30], 'f.txt', 'g.txt'))
    expect(r.out).toMatch(/NINCS kozos fajl/)
    expect(r.out).toMatch(/NEM azt jelenti, hogy a merge biztonsagos/)
    expect(r.status).toBe(0)
  })

  it('separates a real CONFLICT from the silent overlap -- git already shouts about one', () => {
    const r = probe(repoWith([10], [10]))
    expect(r.out).toMatch(/KONFLIKTUS/)
    // A conflict is loud; it must not also be counted as the quiet class,
    // otherwise the exit status stops meaning "there is something git will NOT
    // tell you about".
    expect(r.status).toBe(0)
  })

  it('accepts --base in any position, not only last', () => {
    // The first version read the base as "the third positional argument",
    // which worked only because every call happened to pass it last. One
    // reordered call would have used a branch name as the base and reported
    // nonsense with a straight face.
    const dir = repoWith([10], [14])
    const r = spawnSync('python3', [SCRIPT, '--base', 'base', 'a', 'b'], {
      cwd: dir, encoding: 'utf-8', timeout: 60_000,
    })
    expect(r.stdout).toMatch(/ATFEDO/)
    expect(r.status).toBe(1)
  })

  it('treats a pure INSERTION into a rewritten region as overlapping', () => {
    // A zero-length hunk is reported at the line BEFORE the insert. Treating it
    // as empty would put the riskiest edit of all -- a line added in the middle
    // of someone else's rewrite -- in the "disjoint" column.
    const dir = mkdtempSync(join(tmpdir(), 'mergeoverlap-ins-'))
    git(dir, 'init', '-q', '-b', 'base')
    git(dir, 'config', 'user.email', 't@t.t')
    git(dir, 'config', 'user.name', 'T')
    const base = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`)
    writeFileSync(join(dir, 'f.txt'), base.join('\n') + '\n')
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base')

    git(dir, 'checkout', '-q', '-b', 'a', 'base')
    const rewritten = [...base]
    for (let n = 9; n <= 13; n++) rewritten[n - 1] += ' rewritten by a'
    writeFileSync(join(dir, 'f.txt'), rewritten.join('\n') + '\n')
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'a')

    git(dir, 'checkout', '-q', '-b', 'b', 'base')
    const inserted = [...base]
    inserted.splice(10, 0, 'inserted by b')
    writeFileSync(join(dir, 'f.txt'), inserted.join('\n') + '\n')
    git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'b')

    const r = probe(dir)
    expect(r.out).toMatch(/ATFEDO|KONFLIKTUS/)
  })
})
