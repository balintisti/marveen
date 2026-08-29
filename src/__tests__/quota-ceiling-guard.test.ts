/**
 * THE CEILING ONLY HOLDS IF THE GUARD CAN READ THE NUMBER.
 *
 * Isti lifted the fleet standstill for one agent on 2026-08-26 with a hard
 * condition -- "95-6% fole ne menjunk" -- and scripts/quota-ceiling-guard.sh is
 * what enforces it from launchd, with no Claude session involved.
 *
 * WHY THIS TEST RUNS THE REAL SCRIPT INSTEAD OF UNIT-TESTING A FUNCTION.
 * The first version of the guard compared thresholds with `printf '%.0f'`. That
 * works in zsh and FAILS on the macOS system bash 3.2 ("87.0: invalid number"),
 * which is the shell launchd actually uses. Every real reading is fractional,
 * so the comparison fell through with an empty value and the guard reported
 * "under threshold" -- and would have reported it at 95.0% just the same. A
 * hand-run looked perfect because the hand-run was zsh. Only executing the
 * script under /bin/bash, with a fractional percentage, can catch that class of
 * bug; a TypeScript unit test of the same logic never could.
 *
 * So: real script, real /bin/bash, real snapshot file, fractional numbers. The
 * only things stubbed are the two outbound edges (notify.sh, agent-msg.sh) and
 * `tmux`, each replaced by a recorder -- because the assertion is WHAT it would
 * send, and a stub makes that exact instead of approximately right.
 *
 * Note the tests drive the guard through its NORMAL path, not --dry-run.
 * --dry-run is a different branch; testing it would prove the branch, not the
 * behaviour.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REAL_SCRIPT = join(HERE, '..', '..', 'scripts', 'quota-ceiling-guard.sh')

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface SnapOpts {
  percent?: number | string | null
  source?: string
  ageMinutes?: number
  resetsAt?: number
}

interface Run {
  stdout: string
  code: number
  /** Everything the stubbed notify.sh was asked to send to the owner. */
  owner: string
  /** Everything the stubbed agent-msg.sh was asked to send to an agent. */
  agent: string
  base: string
}

/** Stage the real guard in a throwaway install with recording stubs. */
function makeInstall(runningAgents: string[] = ['dexter'], deployed?: string[]): string {
  const base = mkdtempSync(join(tmpdir(), 'quota-ceiling-'))
  made.push(base)
  mkdirSync(join(base, 'scripts'))
  mkdirSync(join(base, 'store'))
  // The guard derives its roster from agents/*/ (card 8cbb7ce6), so a throwaway
  // install needs those directories or it guards nobody. DEPLOYED is not the
  // same set as RUNNING: an agent can exist and have no session, which is what
  // the last test in this file measures.
  // `??` binds tighter than `?:`, so the compact form here parsed as
  // `(deployed ?? runningAgents.length) ? ... : ...` and was right only by
  // accident. Written out, because a reader should not have to check.
  const deployedRoster = deployed ?? (runningAgents.length ? runningAgents : ['dexter'])
  for (const a of deployedRoster) {
    mkdirSync(join(base, 'agents', a), { recursive: true })
  }
  copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'quota-ceiling-guard.sh'))

  // Recorders, not no-ops: the assertion is what the guard TRIED to send.
  writeFileSync(
    join(base, 'scripts', 'notify.sh'),
    `#!/usr/bin/env bash\nprintf '%s\\n---\\n' "$1" >> "${join(base, 'store', 'owner.log')}"\n`,
  )
  chmodSync(join(base, 'scripts', 'notify.sh'), 0o755)
  // agent-msg.sh takes the body on STDIN when the 3rd arg is "-", which is how
  // the guard calls it (heredoc-safe, per CLAUDE.md).
  writeFileSync(
    join(base, 'scripts', 'agent-msg.sh'),
    `#!/usr/bin/env bash\nprintf 'TO=%s\\n' "$2" >> "${join(base, 'store', 'agent.log')}"\ncat >> "${join(base, 'store', 'agent.log')}"\nprintf '\\n---\\n' >> "${join(base, 'store', 'agent.log')}"\n`,
  )
  chmodSync(join(base, 'scripts', 'agent-msg.sh'), 0o755)

  // `tmux has-session -t agent-X` decides who is stoppable.
  const binDir = join(base, 'bin')
  mkdirSync(binDir)
  const known = runningAgents.map((a) => `agent-${a}`).join(' ')
  writeFileSync(
    join(binDir, 'tmux'),
    `#!/usr/bin/env bash\n# only 'has-session -t <name>' is used by the guard\nfor s in ${known || "''"}; do [ "$3" = "$s" ] && exit 0; done\nexit 1\n`,
  )
  chmodSync(join(binDir, 'tmux'), 0o755)
  return base
}

function writeSnapshot(base: string, o: SnapOpts): string {
  const ageMin = o.ageMinutes ?? 1
  const generated = new Date(Date.now() - ageMin * 60_000).toISOString()
  const snap = {
    generated_at: generated,
    generated_at_local: generated,
    claude: {
      provider: 'claude',
      source: o.source ?? 'authoritative',
      ok: true,
      windows: {
        seven_day: {
          used_percent: o.percent === undefined ? 87.0 : o.percent,
          resets_at: o.resetsAt ?? 1787810400.05,
        },
      },
    },
  }
  const p = join(base, 'store', 'snap.json')
  writeFileSync(p, JSON.stringify(snap))
  return p
}

function runGuard(base: string, snapshotPath: string): Run {
  const ownerLog = join(base, 'store', 'owner.log')
  const agentLog = join(base, 'store', 'agent.log')
  let stdout = ''
  let code = 0
  try {
    stdout = execFileSync('/bin/bash', [join(base, 'scripts', 'quota-ceiling-guard.sh')], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${join(base, 'bin')}:${process.env.PATH ?? ''}`,
        QUOTA_CEILING_SNAPSHOT: snapshotPath,
        QUOTA_CEILING_STATE: join(base, 'store', 'state.json'),
      },
    })
  } catch (e) {
    const err = e as { stdout?: string; status?: number }
    stdout = err.stdout ?? ''
    code = err.status ?? 1
  }
  return {
    stdout,
    code,
    owner: existsSync(ownerLog) ? readFileSync(ownerLog, 'utf8') : '',
    agent: existsSync(agentLog) ? readFileSync(agentLog, 'utf8') : '',
    base,
  }
}

function go(o: SnapOpts, runningAgents: string[] = ['dexter'], deployed?: string[]): Run {
  const base = makeInstall(runningAgents, deployed)
  return runGuard(base, writeSnapshot(base, o))
}

/** Same, but with the roster forced through the environment override. */
function goWithEnvRoster(o: SnapOpts, roster: string, runningAgents: string[]): Run {
  const base = makeInstall(runningAgents, runningAgents)
  const snap = writeSnapshot(base, o)
  const prev = process.env.QUOTA_CEILING_AGENTS
  process.env.QUOTA_CEILING_AGENTS = roster
  try {
    return runGuard(base, snap)
  } finally {
    if (prev === undefined) delete process.env.QUOTA_CEILING_AGENTS
    else process.env.QUOTA_CEILING_AGENTS = prev
  }
}

describe('quota-ceiling-guard: the threshold comparison', () => {
  it('stays silent well under the ceiling', () => {
    const r = go({ percent: 87.0 })
    expect(r.agent).toBe('')
    expect(r.owner).toBe('')
  })

  it('warns the agent and the owner at the soft threshold', () => {
    const r = go({ percent: 93.0 })
    expect(r.agent).toContain('TO=dexter')
    expect(r.agent).toContain('KERET-OR / LAGY')
    expect(r.owner).toContain('kozeledunk a plafonhoz')
  })

  it('escalates at the owner-stated ceiling', () => {
    const r = go({ percent: 95.0 })
    expect(r.agent).toContain('KERET-OR / HARD')
    expect(r.agent).toContain('ALLJ MEG MOST')
    expect(r.owner).toContain('ELERTUK A PLAFONT')
  })

  /**
   * THE REGRESSION THAT MOTIVATED THIS FILE.
   *
   * Real snapshots always carry a fractional percentage. Under bash 3.2 the
   * original `printf '%.0f'` rejected exactly these values, so the guard fell
   * silent at the ONE moment it exists for. An integer-only test passes against
   * the broken version -- this one does not.
   */
  it.each([93.0, 94.9, 95.0, 96.4, 99.9])('fires on the fractional reading %s', (pct) => {
    const r = go({ percent: pct })
    expect(r.stdout).not.toMatch(/invalid number/i)
    expect(r.agent, `expected a stop message at ${pct}%`).not.toBe('')
  })

  it('never lets a reading print a shell number error', () => {
    const r = go({ percent: 87.4 })
    expect(r.stdout).not.toMatch(/invalid number/i)
  })
})

describe('quota-ceiling-guard: what it does when it cannot see', () => {
  /**
   * A ceiling guard that goes quiet on a broken input is worse than no guard:
   * silence reads as "we are under the ceiling". These three paths must all
   * SPEAK -- and must not pretend to have measured anything.
   */
  it('reports blindness on a stale snapshot instead of implying safety', () => {
    const r = go({ percent: 87.0, ageMinutes: 180 })
    expect(r.owner).toContain('NEM LATOK')
    expect(r.agent).toBe('')
  })

  it('reports blindness when the source is not authoritative', () => {
    const r = go({ percent: 87.0, source: 'estimate' })
    expect(r.owner).toContain('NEM LATOK')
    expect(r.owner).toContain('estimate')
  })

  it('reports blindness when the percentage is missing', () => {
    const r = go({ percent: null })
    expect(r.owner).toContain('NEM LATOK')
    expect(r.agent).toBe('')
  })

  it('does not send a stop message on any blind path', () => {
    for (const o of [{ ageMinutes: 180 }, { source: 'estimate' }, { percent: null }]) {
      const r = go({ percent: 87.0, ...o })
      expect(r.agent, `blind path ${JSON.stringify(o)} must not stop anyone`).toBe('')
    }
  })
})

describe('quota-ceiling-guard: it alerts once per window, and re-arms on rollover', () => {
  it('does not repeat the same level while the window is unchanged', () => {
    const base = makeInstall()
    const snap = writeSnapshot(base, { percent: 93.0 })
    runGuard(base, snap)
    const second = runGuard(base, snap)
    // The second run appends nothing new: one warning per window, per level.
    const stops = second.agent.split('TO=dexter').length - 1
    expect(stops).toBe(1)
  })

  it('escalates soft -> hard within the same window', () => {
    const base = makeInstall()
    runGuard(base, writeSnapshot(base, { percent: 93.0 }))
    const r = runGuard(base, writeSnapshot(base, { percent: 95.0 }))
    expect(r.agent).toContain('KERET-OR / LAGY')
    expect(r.agent).toContain('KERET-OR / HARD')
  })

  /**
   * The window id is the reset timestamp, so a quota rollover re-arms the guard
   * with no manual state reset. Without this, a stale "already alerted" flag
   * would silence the guard for the whole NEXT week.
   */
  it('fires again in a new quota window', () => {
    const base = makeInstall()
    runGuard(base, writeSnapshot(base, { percent: 93.0, resetsAt: 1787810400.05 }))
    const r = runGuard(base, writeSnapshot(base, { percent: 93.0, resetsAt: 1788415200.05 }))
    const stops = r.agent.split('TO=dexter').length - 1
    expect(stops).toBe(2)
  })
})

describe('quota-ceiling-guard: it only stops agents that are actually running', () => {
  it('sends nothing to an agent with no session, but still tells the owner', () => {
    const r = go({ percent: 95.0 }, [])
    expect(r.agent).toBe('')
    expect(r.owner).toContain('ELERTUK A PLAFONT')
    expect(r.owner).toContain('nincs futo agens')
  })
})

// THE ROSTER ITSELF (card 8cbb7ce6). The guard's logic was never wrong; the list
// was. `dexter` was hardcoded as the default when exactly one agent worked, and
// by 2026-08-28 six did -- so a ceiling would have stopped one of six, and the
// run would have looked entirely healthy.
//
// A hardcoded six reproduces that at the seventh agent, so the default is
// derived from agents/*/. These tests pin the derivation, the override that must
// still win, and the case where the derivation yields nothing -- which is the
// one that would otherwise be indistinguishable from a quiet, healthy run.
describe('quota-ceiling-guard: who it guards is DERIVED, not hardcoded', () => {
  it('messages every deployed agent, not just the one the default used to name', () => {
    const r = go({ percent: 95.0 }, ['dexter', 'didi', 'friday'])
    for (const a of ['dexter', 'didi', 'friday']) {
      expect(r.agent, a).toContain(`TO=${a}`)
    }
  })

  it('and it is the DIRECTORIES that decide, not the sessions', () => {
    // Deployed three, only one has a session: the roster still covers three, and
    // the session check is what narrows it. Two different questions, and the
    // defect came from conflating them once already.
    const r = go({ percent: 95.0 }, ['didi'], ['dexter', 'didi', 'friday'])
    expect(r.stdout + r.owner).toContain('didi')
    expect(r.agent).toContain('TO=didi')
    expect(r.agent).not.toContain('TO=dexter')
  })

  it('the environment override still wins -- it is the escape hatch', () => {
    const r = goWithEnvRoster({ percent: 95.0 }, 'didi', ['dexter', 'didi'])
    expect(r.agent).toContain('TO=didi')
    expect(r.agent).not.toContain('TO=dexter')
  })

  it('SAYS SO when the roster is empty, instead of looking like a quiet run', () => {
    // No agents/ directories and no override. Without this line the output is
    // byte-identical to a healthy fleet under the threshold: nobody messaged,
    // nothing wrong. A guard protecting nobody must not be silent about it.
    const base = mkdtempSync(join(tmpdir(), 'quota-ceiling-empty-'))
    made.push(base)
    mkdirSync(join(base, 'scripts'))
    mkdirSync(join(base, 'store'))
    copyFileSync(REAL_SCRIPT, join(base, 'scripts', 'quota-ceiling-guard.sh'))
    const r = runGuard(base, writeSnapshot(base, { percent: 95.0 }))
    const log = readFileSync(join(base, 'store', 'quota-ceiling-guard.log'), 'utf8')
    expect(log).toContain('REFUSING')
    expect(log).toContain('protecting nobody')
    expect(r.agent).toBe('')
  })
})
