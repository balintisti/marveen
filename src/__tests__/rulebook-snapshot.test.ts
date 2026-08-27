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
    mkdirSync(join(skills, `s${i}`), { recursive: true })
    writeFileSync(join(skills, `s${i}`, 'SKILL.md'), `skill ${i}\n`)
  }
  // Records every alert instead of sending one. Without this the test would
  // fire a real Telegram message on every run.
  writeFileSync(notify, '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$ALERT_FILE"\n', { mode: 0o755 })

  const run = (extraEnv: Record<string, string> = {}) =>
    spawnSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: {
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
      },
    })

  const commits = () => {
    const r = spawnSync('git', ['-C', repo, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' })
    return r.status === 0 ? Number(r.stdout.trim()) : 0
  }
  const storedSkills = () => {
    const d = join(repo, 'store', 'skills')
    return existsSync(d) ? readdirSync(d).length : 0
  }
  const alerts = () => (existsSync(alertFile) ? readFileSync(alertFile, 'utf8').trim().split('\n').filter(Boolean) : [])

  return { root, skills, repo, run, commits, storedSkills, alerts }
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
    expect(a[0]).toMatch(/6[0-9]%/)             // the measured share, not a vague word
  })

  it('the alert names the numbers, so the reader can judge without re-running', () => {
    const w = world(60)
    w.run()
    for (let i = 0; i < 40; i++) rmSync(join(w.skills, `s${i}`), { recursive: true })
    w.run()
    const a = w.alerts()[0]
    expect(a).toContain('63')   // how many were in the previous snapshot
    expect(a).toContain('40')   // how many are gone
    expect(a).toContain('33')   // the threshold it was judged against
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
