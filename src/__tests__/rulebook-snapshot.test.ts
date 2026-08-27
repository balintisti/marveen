// The deletion guard on the rulebook snapshot (card 52edd21e).
//
// The snapshot script exists because the files every agent loads at session
// start are in no repository at all: 78 files, 1.64 MB, no git, no Time
// Machine. Measured 2026-08-27.
//
// The guard exists because of the shape the whole day was about: a mechanism
// that runs, reports success, and commits a catastrophe. Without it, an `rm`
// on a source root is followed by a snapshot run that faithfully records the
// deletion -- the chain then shows the loss as the correct current state, and
// the last good copy is one `git checkout` away from nobody knowing it is
// needed. So a run that sees more than MAX_MISSING_PCT of the previous
// snapshot gone from SOURCE refuses: no commit, no copy, an alert, and the
// repository left exactly as it was.

import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'rulebook-snapshot.sh')

/** A throwaway world: fake source roots, a fake repo, a notifier that records. */
function world(skillCount: number) {
  const root = mkdtempSync(join(tmpdir(), 'rulebook-'))
  const marveen = join(root, 'marveen')
  const skills = join(root, 'skills')
  const repo = join(root, 'repo')
  const alertFile = join(root, 'alerts.txt')
  const notify = join(root, 'notify.sh')

  mkdirSync(join(marveen, 'agents', 'friday'), { recursive: true })
  writeFileSync(join(marveen, 'CLAUDE.md'), 'marveen rulebook\n')
  writeFileSync(join(marveen, 'agents', 'friday', 'CLAUDE.md'), 'friday persona\n')
  writeFileSync(join(root, 'delta.md'), 'delta rulebook\n')
  for (let i = 0; i < skillCount; i++) {
    mkdirSync(join(skills, `s${i}`, 'references'), { recursive: true })
    // BOTH files, and the pair is deliberate: `SKILL.md` and
    // `references/buktatok.md` collate in OPPOSITE orders under C (by byte,
    // uppercase first) and under a UTF-8 locale (case-blind). A fixture of
    // lowercase-only names sorts identically either way, so the locale test
    // below would pass while exercising nothing -- measured: with such a
    // fixture, deleting `LC_ALL=C` from the script left every test green.
    writeFileSync(join(skills, `s${i}`, 'SKILL.md'), `skill ${i}\n`)
    writeFileSync(join(skills, `s${i}`, 'references', 'buktatok.md'), `notes ${i}\n`)
  }
  // Records every alert instead of sending one. Without this the test would
  // fire a real Telegram message on every run.
  writeFileSync(notify, '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$ALERT_FILE"\n', { mode: 0o755 })

  const env = (extraEnv: Record<string, string> = {}) => ({
        ...process.env,
        RULEBOOK_REPO: repo,
        RULEBOOK_MARVEEN_ROOT: marveen,
        RULEBOOK_DELTA_CLAUDE: join(root, 'delta.md'),
        RULEBOOK_SKILLS_ROOT: skills,
        RULEBOOK_NOTIFY: notify,
        ALERT_FILE: alertFile,
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    ...extraEnv,
  })

  const run = (extraEnv: Record<string, string> = {}) =>
    spawnSync('bash', [SCRIPT], { encoding: 'utf8', env: env(extraEnv) })

  const commits = () => {
    const r = spawnSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' })
    return r.status === 0 ? Number(r.stdout.trim()) : 0
  }
  const storedSkills = () => {
    const d = join(repo, 'store', 'skills')
    return existsSync(d) ? readdirSync(d).length : 0
  }
  const alerts = () => (existsSync(alertFile) ? readFileSync(alertFile, 'utf8').trim().split('\n').filter(Boolean) : [])

  return { root, skills, repo, run, env, commits, storedSkills, alerts }
}

describe('rulebook snapshot: the ordinary path', () => {
  it('takes a first snapshot and commits every file in scope', () => {
    const w = world(60)
    const r = w.run()
    expect(r.status).toBe(0)
    expect(w.commits()).toBe(1)
    expect(w.storedSkills()).toBe(60)
  })

  it('writes no empty commit when nothing changed', () => {
    // Measured: `git commit` with nothing staged exits non-zero and creates
    // nothing, so the cycle is self-limiting -- no "did anything change?" check.
    const w = world(20)
    w.run()
    const r = w.run()
    expect(r.status).toBe(0)
    expect(w.commits()).toBe(1)
  })

  it('commits a SMALL deletion, because that is a real edit and must be recorded', () => {
    // The guard must not freeze ordinary work: below the threshold the
    // deletion is history, not an incident.
    const w = world(60)
    w.run()
    for (let i = 0; i < 5; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })
    const r = w.run()
    expect(r.status).toBe(0)
    expect(w.commits()).toBe(2)
    expect(w.storedSkills()).toBe(55)
  })
})

describe('rulebook snapshot: the manifest order must not depend on WHO ran it', () => {
  // Measured in production 2026-08-27, hours after this file first went green:
  // every run committed, with no content change. Five MANIFEST.tsv lines moved
  // back and forth -- order, not content. A bare `sort` is locale-dependent:
  //
  //     LANG=hu_HU.UTF-8 -> references/buktatok.md, then SKILL.md  (case-blind)
  //     LC_ALL=C         -> SKILL.md, then references/buktatok.md  (by byte)
  //
  // launchd runs under C/POSIX, an interactive shell under the user's locale,
  // so the manifest order depended on who started the round -- and every switch
  // wrote an empty commit. The cost is not the noise: it is that "nothing
  // happened" stopped being a signal. 48 commits a day, with the one real
  // change lost among them -- exactly the value the no-empty-commit test above
  // exists to protect.
  //
  // The test above could not catch it, and is not wrong: ONE run has ONE
  // locale. It measured its own run, not the installation. This one runs the
  // same script twice under two different collations.

  const collationsDiffer = (() => {
    const r = (loc: string) => spawnSync('sort', [], {
      input: 'SKILL.md\nreferences/buktatok.md\n', encoding: 'utf8',
      env: { ...process.env, LC_ALL: loc },
    }).stdout
    return r('C') !== r('en_US.UTF-8')
  })()

  it('this environment can actually distinguish two collations (control)', () => {
    // Without this the test below passes on a machine with no UTF-8 locales
    // while exercising nothing -- a green that measures its own absence.
    expect(collationsDiffer,
      'no locale on this machine sorts differently from C, so the case below cannot run here',
    ).toBe(true)
  })

  it('writes NO second commit when the same content is snapshotted under another locale', () => {
    const w = world(30)
    const first = w.run({ LC_ALL: 'C' })
    expect(first.status).toBe(0)
    expect(w.commits()).toBe(1)

    const second = w.run({ LC_ALL: 'en_US.UTF-8' })
    expect(second.status).toBe(0)
    expect(w.commits()).toBe(1)   // the defect showed up here as 2
  })

  it('keeps each FIND-ORDERED group in byte order whatever the caller locale is', () => {
    // The property that makes the above true, pinned directly -- but only where
    // it exists. The manifest as a whole is NOT sorted: collect() emits fixed
    // groups (marveen, delta-crm, agents, skills) in a deliberate order, and
    // only the two find-driven groups are piped through sort. Asserting a
    // globally sorted manifest failed here on the first run, and the test was
    // the thing that was wrong -- its name claimed more than the script does.
    const w = world(10)
    w.run({ LC_ALL: 'en_US.UTF-8' })
    const dests = readFileSync(join(w.repo, 'MANIFEST.tsv'), 'utf8')
      .trim().split('\n').map((l) => l.split('\t')[0])
    const skills = dests.filter((d) => d.startsWith('skills/'))
    expect(skills.length).toBe(20)                 // the group is non-empty, so the check bites
    expect(skills).toEqual([...skills].sort())     // JS string compare IS code-unit order
  })
})

describe('rulebook snapshot: the deletion guard', () => {
  it('REFUSES and ALERTS when 40 of 63 files vanish, and leaves the repo untouched', () => {
    // The case Marveen asked for by name.
    const w = world(60)
    w.run()
    const before = w.commits()
    for (let i = 0; i < 40; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })

    const r = w.run()
    expect(r.status).toBe(3)                    // refused, distinctly
    expect(w.commits()).toBe(before)            // no new commit
    expect(w.storedSkills()).toBe(60)           // the last good copy is STILL there
    const a = w.alerts()
    expect(a.length).toBe(1)
    expect(a[0]).toContain('MEGTAGADVA')
    expect(a[0]).toMatch(/\d\d%/)                // the measured share, not a vague word
  })

  it('the alert names the numbers, so the reader can judge without re-running', () => {
    const w = world(60)
    w.run()
    for (let i = 0; i < 40; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })
    w.run()
    const a = w.alerts()[0]
    // Derived, not hardcoded: a fixture change must not silently turn these
    // into assertions about nothing. 60 skills x 2 files + 3 others = 123;
    // removing 40 skill dirs takes 80 of them.
    const total = 60 * 2 + 3
    const gone = 40 * 2
    expect(a).toContain(String(total))                       // the previous snapshot's size
    expect(a).toContain(String(gone))                        // how many are gone
    expect(a).toContain(String(Math.floor(gone * 100 / total))) // the measured share
    expect(a).toContain('33')                                // the threshold it was judged against
  })

  it('is a NUMBER, not a hardcoded condition -- a lower threshold refuses earlier', () => {
    // Guards the claim in the header: the threshold can be argued with.
    const w = world(60)
    w.run()
    for (let i = 0; i < 5; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })
    const r = w.run({ RULEBOOK_MAX_MISSING_PCT: '1' })
    expect(r.status).toBe(3)
    expect(w.commits()).toBe(1)
  })

  it('refuses on an EMPTY source set -- a wrong root looks exactly like this', () => {
    // Zero files is not "everything was deleted", it is "we are looking in the
    // wrong place". Both must stop the run; this one stops it before the
    // manifest is even consulted, so it works on the very first run too.
    const w = world(0)
    rmSync(join(w.root, 'marveen', 'CLAUDE.md'))
    rmSync(join(w.root, 'marveen', 'agents', 'friday', 'CLAUDE.md'))
    rmSync(join(w.root, 'delta.md'))
    const r = w.run()
    expect(r.status).toBe(2)
    expect(w.commits()).toBe(0)
  })

  it('does not fire on the FIRST run, when there is nothing to compare against', () => {
    // An empty manifest must not read as "everything is missing".
    const w = world(60)
    const r = w.run()
    expect(r.status).toBe(0)
    expect(w.alerts()).toEqual([])
  })
})

// === The single-writer lock, and the count in the commit message (card c26193d7)
//
// didi measured three commits in two hours whose trees held 34, 24 and 19 files
// while every one of them said "snapshot: 83 fajl". Each was PAIRED with an
// intact commit in the same minute -- a race fingerprint. Two callers can start
// this script (the launchd unit and the skills-write hook, whose second arm
// runs in the background), there was no lock, and the mirror step is `rm -rf
// store` followed by ~1.5 s of copying.
//
// Two independent defects, and they need two independent fixes:
//   the RACE made the tree short   -> the lock
//   the MESSAGE counted the source -> the count now comes from the index
// didi's sentence is why both are here: "a guard that only protects while the
// other mechanism is flawless is not a guard". The count check would have
// caught all three cases on its own, with no lock at all.
describe('rulebook snapshot: the lock and the honest count', () => {
  const lockOf = (w: ReturnType<typeof world>) => `${w.repo}.lock`

  it('the commit message states the COMMITTED count, and it matches the tree', () => {
    const w = world(30)
    expect(w.run().status).toBe(0)
    const subject = spawnSync('git', ['-C', w.repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim()
    const tree = spawnSync('git', ['-C', w.repo, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'store'], { encoding: 'utf8' })
      .stdout.trim().split('\n').filter(Boolean).length
    // 30 skills x 2 files + 2 marveen files + 1 delta file
    expect(tree).toBe(63)
    expect(subject).toBe(`snapshot: ${tree} fajl`)
    expect(subject).not.toMatch(/CSONKA/)
    expect(w.alerts()).toEqual([])       // negative control: a normal run is silent
  })

  it('a SECOND instance exits 0 and leaves the repository untouched', () => {
    const w = world(20)
    w.run()
    const before = w.commits()
    writeFileSync(join(w.skills, 's0', 'SKILL.md'), 'changed\n')   // there IS something to commit
    // A live holder: this test process itself. `kill -0` says it is alive, so
    // the lock must be respected rather than broken.
    mkdirSync(lockOf(w), { recursive: true })
    writeFileSync(join(lockOf(w), 'pid'), `${process.pid}\n`)
    const r = w.run()
    expect(r.status).toBe(0)                       // quiet, not a failure
    expect(r.stderr).toMatch(/another instance holds the lock/)
    expect(w.commits()).toBe(before)               // nothing committed
    rmSync(lockOf(w), { recursive: true, force: true })
  })

  it('a STALE lock is broken -- the hook kills a slow snapshot with -9, which runs no trap', () => {
    const w = world(20)
    w.run()
    writeFileSync(join(w.skills, 's0', 'SKILL.md'), 'changed\n')
    // A pid that cannot be running: spawn a process and let it exit first.
    const dead = spawnSync('bash', ['-c', 'echo $$'], { encoding: 'utf8' }).stdout.trim()
    mkdirSync(lockOf(w), { recursive: true })
    writeFileSync(join(lockOf(w), 'pid'), `${dead}\n`)
    const r = w.run()
    expect(r.stderr).toMatch(/stale lock/)
    expect(r.status).toBe(0)
    expect(w.commits()).toBe(2)                    // it ran and committed
  })

  it('releases the lock on the way out, including on the guard REFUSAL path', () => {
    const w = world(60)
    w.run()
    expect(existsSync(lockOf(w))).toBe(false)      // ordinary path
    for (let i = 0; i < 30; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })
    expect(w.run().status).toBe(3)                 // the deletion guard refuses
    expect(existsSync(lockOf(w))).toBe(false)      // and still lets go
  })

  it('the lock lives OUTSIDE the repository, so `git add -A` cannot commit it', () => {
    const w = world(10)
    w.run()
    const tracked = spawnSync('git', ['-C', w.repo, 'ls-files'], { encoding: 'utf8' }).stdout
    expect(tracked).not.toMatch(/\.lock/)
  })

  // The truncation branch itself. The real cause is the race, which is not
  // deterministic enough for a test -- so the CONSEQUENCE is injected instead:
  // a copy of the script with one line added that removes a file from the store
  // just before `git add -A`, which is exactly what a competing instance's
  // `rm -rf store` does to this one.
  it('a truncated store is named CSONKA in the message, alerts, and exits 4', () => {
    const w = world(20)
    w.run()
    writeFileSync(join(w.skills, 's0', 'SKILL.md'), 'changed\n')
    const mutated = join(w.root, 'mutated-snapshot.sh')
    const src = readFileSync(SCRIPT, 'utf8')
      .replace('git -C "$RULEBOOK_REPO" add -A',
               'rm -f "$RULEBOOK_REPO/store/skills/s1/SKILL.md"\ngit -C "$RULEBOOK_REPO" add -A')
    expect(src).toMatch(/rm -f "\$RULEBOOK_REPO\/store/)   // the injection took
    writeFileSync(mutated, src, { mode: 0o755 })
    const r = spawnSync('bash', [mutated], { encoding: 'utf8', env: w.env() })
    expect(r.status).toBe(4)
    const subject = spawnSync('git', ['-C', w.repo, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim()
    expect(subject).toMatch(/CSONKA/)
    expect(subject).toMatch(/^snapshot: 42 fajl/)          // 43 - 1, the truthful number
    expect(w.alerts().join('\n')).toMatch(/CSONKA PILLANATFELVETEL/)
  })
})
