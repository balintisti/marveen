import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// Card 0ad477ef. Every hook dispatcher used to loop
//     for h in "$HOOK_DIR"/<hook>.d/*; do [ -x "$h" ] || continue; ...
// so ONE `chmod -x` (or a copy that lost its mode) switched a fail-closed gate
// off with no message: the hook exited 0 and the commit/push went through.
//
// Each installer is run against a throwaway repo, the .d directory is emptied
// of the real guards and refilled with three stand-ins, so what is measured is
// the DISPATCHER and nothing else (the real secret gate would start tsx).

const ROOT = process.cwd()

interface Case {
  /** installer script under scripts/ */
  script: string
  /** the dispatcher file the installer writes, under .git/hooks */
  hook: string
  /** the chain directory that dispatcher walks */
  dir: string
  /** git passes the ref list on stdin to pre-push hooks only */
  stdin: string
  /** a dispatcher body from before the fix, carrying our marker */
  oldMarker: string
}

const OLD = (marker: string, dir: string, payload: boolean) =>
  `#!/usr/bin/env bash\n# ${marker} : old body\nset -euo pipefail\nHOOK_DIR="$(cd "$(dirname "$0")" && pwd)"\n` +
  (payload ? 'payload="$(cat)"\n' : '') +
  `status=0\nfor h in "$HOOK_DIR"/${dir}/*; do\n  [ -x "$h" ] || continue\n  "$h" "$@" || status=1\ndone\nexit $status\n`

const CASES: Case[] = [
  { script: 'install-no-force-push-hook.sh', hook: 'pre-push', dir: 'pre-push.d',
    stdin: 'refs/heads/x 1 refs/heads/x 0\n', oldMarker: OLD('marveen-pre-push-dispatcher', 'pre-push.d', true) },
  { script: 'install-git-guard-hook.sh', hook: 'pre-push', dir: 'pre-push.d',
    stdin: 'refs/heads/x 1 refs/heads/x 0\n', oldMarker: OLD('marveen-pre-push-dispatcher', 'pre-push.d', true) },
  { script: 'install-secret-gate-hook.sh', hook: 'pre-commit', dir: 'pre-commit.d',
    stdin: '', oldMarker: OLD('marveen-pre-commit-dispatcher', 'pre-commit.d', false) },
  { script: 'install-prod-tree-guard-hook.sh', hook: 'pre-commit', dir: 'pre-commit.d',
    stdin: '', oldMarker: OLD('marveen-pre-commit-dispatcher', 'pre-commit.d', false) },
  { script: 'install-prod-tree-guard-hook.sh', hook: 'pre-merge-commit', dir: 'pre-commit.d',
    stdin: '', oldMarker: OLD('marveen-pre-commit-dispatcher', 'pre-commit.d', false) },
  { script: 'install-prod-tree-guard-hook.sh', hook: 'prepare-commit-msg', dir: 'prepare-commit-msg.d',
    stdin: '', oldMarker: OLD('marveen-prepare-commit-msg-dispatcher', 'prepare-commit-msg.d', false) },
]

const stage = mkTmp('dispfc-')
afterAll(() => rmSync(stage, { recursive: true, force: true }))

let n = 0
function makeRepo(script: string): string {
  const repo = join(stage, `r${n++}`)
  mkdirSync(join(repo, 'scripts'), { recursive: true })
  mkdirSync(join(repo, 'store'), { recursive: true })
  execFileSync('git', ['-C', repo, 'init', '-q', '-b', 'develop'])
  writeFileSync(join(repo, 'x.txt'), 'x')
  execFileSync('git', ['-C', repo, 'add', '.'])
  execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init'])
  cpSync(join(ROOT, 'scripts', script), join(repo, 'scripts', script))
  writeFileSync(join(repo, 'store', '.dashboard-token'), 'test-token\n')
  return repo
}

const install = (repo: string, script: string) =>
  spawnSync('/bin/bash', [join(repo, 'scripts', script)], { cwd: repo, encoding: 'utf-8', timeout: 30000 })

/** Replace the chain with three stand-ins: 10 and 30 executable (each leaves a
 *  marker file), 20 present but with the exec bit REMOVED when `breakMiddle`. */
function fillChain(repo: string, dir: string, breakMiddle: boolean): string {
  const chain = join(repo, '.git', 'hooks', dir)
  rmSync(chain, { recursive: true, force: true })
  mkdirSync(chain, { recursive: true })
  const marks = join(repo, 'marks')
  rmSync(marks, { recursive: true, force: true })
  mkdirSync(marks, { recursive: true })
  for (const name of ['10-first', '20-middle', '30-last']) {
    const f = join(chain, name)
    writeFileSync(f, `#!/usr/bin/env bash\ntouch '${join(marks, name)}'\n`)
    chmodSync(f, 0o755)
  }
  if (breakMiddle) chmodSync(join(chain, '20-middle'), 0o644)
  return chain
}

const ran = (repo: string) => (existsSync(join(repo, 'marks')) ? readdirSync(join(repo, 'marks')).sort() : [])

function runHook(repo: string, c: Case) {
  return spawnSync('/bin/bash', [join(repo, '.git', 'hooks', c.hook), 'arg1'], {
    cwd: repo, input: c.stdin, encoding: 'utf-8', timeout: 20000,
  })
}

describe.each(CASES)('$script -> $hook dispatcher fails CLOSED on a non-executable entry', (c) => {
  const repo = makeRepo(c.script)
  const first = install(repo, c.script)

  it('setup: the installer ran and wrote the dispatcher', () => {
    expect(first.status, first.stderr).toBe(0)
    expect(existsSync(join(repo, '.git', 'hooks', c.hook))).toBe(true)
  })

  it('(a) POSITIVE CONTROL: every entry executable -> exit 0 and all three ran', () => {
    fillChain(repo, c.dir, false)
    const r = runHook(repo, c)
    expect(r.status, r.stderr).toBe(0)
    expect(ran(repo)).toEqual(['10-first', '20-middle', '30-last'])
  })

  it('(b)+(c) one entry chmod -x -> non-zero, stderr names the file and chmod +x, the OTHER entries still ran', () => {
    const chain = fillChain(repo, c.dir, true)
    const r = runHook(repo, c)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain(join(chain, '20-middle'))
    expect(r.stderr).toContain('is not executable')
    expect(r.stderr).toContain(`chmod +x '${join(chain, '20-middle')}'`)
    expect(r.stderr).toContain(`${c.dir}/`)
    expect(ran(repo)).toEqual(['10-first', '30-last'])
  })

  it('the way out works: chmod +x on that entry -> exit 0 again', () => {
    const chain = fillChain(repo, c.dir, true)
    chmodSync(join(chain, '20-middle'), 0o755)
    const r = runHook(repo, c)
    expect(r.status, r.stderr).toBe(0)
  })

  it('(d) an EMPTY chain directory passes', () => {
    const chain = fillChain(repo, c.dir, false)
    for (const f of readdirSync(chain)) rmSync(join(chain, f))
    const r = runHook(repo, c)
    expect(r.status, r.stderr).toBe(0)
  })

  it('a SUBDIRECTORY in the chain is skipped silently, not refused', () => {
    const chain = fillChain(repo, c.dir, false)
    mkdirSync(join(chain, 'some-dir'))
    const r = runHook(repo, c)
    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).not.toContain('some-dir')
  })

  it('a DANGLING symlink is not skipped silently either', () => {
    const chain = fillChain(repo, c.dir, false)
    execFileSync('ln', ['-s', join(repo, 'does-not-exist'), join(chain, '15-dangling')])
    const r = runHook(repo, c)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('15-dangling')
  })

  it('(e) re-install upgrades an OLD dispatcher that carries our marker', () => {
    const hookFile = join(repo, '.git', 'hooks', c.hook)
    writeFileSync(hookFile, c.oldMarker)
    chmodSync(hookFile, 0o755)
    const r = install(repo, c.script)
    expect(r.status, r.stderr).toBe(0)
    expect(readFileSync(hookFile, 'utf-8')).toContain('is not executable')
  })
})

describe('install-no-force-push-hook.sh: a FOREIGN pre-push is preserved, not rewritten', () => {
  it('the foreign hook becomes a chain entry and the dispatcher is ours (with the new body)', () => {
    const script = 'install-no-force-push-hook.sh'
    const repo = makeRepo(script)
    const hookFile = join(repo, '.git', 'hooks', 'pre-push')
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(hookFile, '#!/bin/sh\necho foreign-body\n')
    chmodSync(hookFile, 0o755)
    const r = install(repo, script)
    expect(r.status, r.stderr).toBe(0)
    const kept = join(repo, '.git', 'hooks', 'pre-push.d', '00-preexisting-local')
    expect(readFileSync(kept, 'utf-8')).toContain('foreign-body')
    const body = readFileSync(hookFile, 'utf-8')
    expect(body).toContain('marveen-pre-push-dispatcher')
    expect(body).toContain('is not executable')
  })

  it('the preserved foreign entry keeps its exec bit, so the new dispatcher does not refuse it', () => {
    const script = 'install-no-force-push-hook.sh'
    const repo = makeRepo(script)
    const hookFile = join(repo, '.git', 'hooks', 'pre-push')
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true })
    writeFileSync(hookFile, '#!/bin/sh\nexit 0\n')
    chmodSync(hookFile, 0o755)
    expect(install(repo, script).status).toBe(0)
    const r = spawnSync('/bin/bash', [hookFile], { cwd: repo, input: 'refs/heads/x 1 refs/heads/x 0\n', encoding: 'utf-8' })
    expect(r.status, r.stderr).toBe(0)
  })
})
