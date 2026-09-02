// The quota-ceiling guard used to message every agent with a live tmux session,
// with no way to tell "still working" from "already stopped". A message is the
// only thing that starts an agent turn, so on 2026-08-30 it fired at 16:32,
// 00:22 and 00:32 to all six agents while the fleet had been parked since 16:20
// -- weekly went 93% -> 95% with nobody working, and the guard was unloaded.
//
// The guard was spending exactly what it exists to protect. These tests pin the
// fix: skip agents whose own workcheck.json says {"kind":"none"}, stay loud about
// the skip, and keep notifying the owner (a Telegram message starts no agent turn).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, copyFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const GUARD = join(ROOT, 'scripts', 'quota-ceiling-guard.sh')

let tree: string
let runs = 0

/** The guard derives INSTALL_DIR from its own location, so it must be run from a
 *  COPY inside the throwaway tree -- invoking it by its path in this worktree would
 *  make it read (and act on) the live fleet. Same trap that rewrote the live git
 *  hooks on 2026-08-29; here it would message real agents. */
function guard(pct: number): string {
  const stub = join(tree, 'bin')
  return execFileSync('bash', [join(tree, 'scripts', 'quota-ceiling-guard.sh'),
                               '--dry-run', '--force-percent', String(pct)], {
    cwd: tree, encoding: 'utf8', stdio: 'pipe',
    // tmux is stubbed to "session exists" for everyone: this test is about the
    // parked filter, not about session discovery, and it must never look at or
    // create real agent-* sessions.
    env: { ...process.env, PATH: `${stub}:${process.env.PATH}`,
           QUOTA_CEILING_STATE: join(tree, 'store', `st-${runs++}.json`) },
  })
}
const messaged = (out: string) =>
  [...out.matchAll(/--- WOULD MESSAGE (\S+) ---/g)].map((m) => m[1]).sort()

function agent(name: string, workcheck: string | null) {
  mkdirSync(join(tree, 'agents', name), { recursive: true })
  if (workcheck !== null) writeFileSync(join(tree, 'agents', name, 'workcheck.json'), workcheck)
}

beforeEach(() => {
  tree = mkdtempSync(join(tmpdir(), 'quota-guard-'))
  mkdirSync(join(tree, 'scripts'), { recursive: true })
  mkdirSync(join(tree, 'store'), { recursive: true })
  mkdirSync(join(tree, 'bin'), { recursive: true })
  copyFileSync(GUARD, join(tree, 'scripts', 'quota-ceiling-guard.sh'))
  writeFileSync(join(tree, 'bin', 'tmux'), '#!/bin/sh\nexit 0\n')
  chmodSync(join(tree, 'bin', 'tmux'), 0o755)
  writeFileSync(join(tree, 'store', 'usage-latest.json'),
    '{"ok":true,"seven_day":{"utilization":94},"resets_at":"2026-09-03T08:00:00Z"}')
})
afterEach(() => { if (tree) rmSync(tree, { recursive: true, force: true }) })

describe('quota-ceiling guard: does not wake agents that already stopped', () => {
  it('skips parked agents and still messages the working one', () => {
    agent('parkedA', '{"kind":"none"}')
    agent('parkedB', '{"kind":"none"}')
    agent('workingC', '{"kind":"assigned_open_cards"}')
    // POSITIVE CONTROL is inside the assertion: workingC must be present. Without
    // it, "parkedA is absent" is also satisfied by a guard that messages nobody.
    expect(messaged(guard(94))).toEqual(['workingC'])
  })

  it('sends NOTHING to agents when the whole fleet is parked -- the 2026-08-30 case', () => {
    agent('a', '{"kind":"none"}')
    agent('b', '{"kind":"none"}')
    expect(messaged(guard(94))).toEqual([])
  })

  it('still notifies the owner when everyone is parked (Telegram starts no agent turn)', () => {
    agent('a', '{"kind":"none"}')
    expect(guard(94)).toContain('WOULD TELEGRAM')
  })

  it('applies to the HARD level too, not only SOFT', () => {
    agent('parked', '{"kind":"none"}')
    agent('working', '{"kind":"assigned_open_cards"}')
    const out = guard(96)
    expect(out).toContain('LEVEL: HARD')
    expect(messaged(out)).toEqual(['working'])
  })

  it('names the skipped agents instead of skipping them silently', () => {
    // The agent is deliberately NOT called "parked": asserting on a bare name is
    // satisfied by the "WOULD MESSAGE <name>" line too, so the assertion passes
    // against the very bug it exists to catch. Caught by mutation on 2026-09-02 --
    // it stayed green with the fix removed. Assert the skip LINE, not the name.
    agent('sleeper', '{"kind":"none"}')
    agent('worker', '{"kind":"assigned_open_cards"}')
    const out = guard(94)
    expect(out).toMatch(/kihagyva[^\n]*sleeper/)
    expect(messaged(out)).toEqual(['worker'])
  })

  it('treats an ABSENT or unparseable workcheck as NOT parked (fails toward acting)', () => {
    agent('nofile', null)
    agent('garbage', 'this is not json')
    agent('otherkind', '{"kind":"assigned_open_cards"}')
    expect(messaged(guard(94))).toEqual(['garbage', 'nofile', 'otherkind'])
  })
})
