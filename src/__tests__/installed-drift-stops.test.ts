// THE METER'S STOP REASONS, DRIVEN THROUGH THE REAL SCRIPT (card 4a5a4aae).
//
// installed-drift-check.ts refuses to give a verdict in five situations, and three of them were in
// no test: no plist template, a throwaway path surviving normalization, no main worktree. They live
// in the script's control flow, not in the pure helpers installed-drift.test.ts pins, so each case
// here builds a tree and points the script at it (INSTALLED_DRIFT_SOURCE_ROOT, a documented seam).
// The fake installers below write only inside the throwaway repo the script gives them; none of the
// real installers runs.
import { describe, it, expect } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { delegationTarget } from '../installed-drift.js'

const mkTmp = tmpDirs()
const REPO = join(__dirname, '..', '..')
const SAFE = ['install-git-guard-hook.sh', 'install-prod-tree-guard-hook.sh', 'install-secret-gate-hook.sh',
  'install-no-force-push-hook.sh', 'install-backup-gate-hook.sh']

function run(sourceRoot: string, args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, [join(REPO, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(REPO, 'scripts', 'installed-drift-check.ts'), ...args], {
    encoding: 'utf-8', timeout: 120_000,
    env: { ...process.env, INSTALLED_DRIFT_SOURCE_ROOT: sourceRoot, LAUNCH_AGENTS_DIR: mkTmp('drift-la-') },
  })
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

/** A git repo whose scripts/ holds the five SAFE installers; `bodies` overrides some of them. */
function installTree(bodies: Record<string, string>, installedHooks: Record<string, string> = {}): string {
  const root = mkTmp('drift-src-')
  execFileSync('git', ['init', '-q', root])
  mkdirSync(join(root, 'scripts', 'hooks'), { recursive: true })
  for (const name of SAFE) writeFileSync(join(root, 'scripts', name), bodies[name] ?? '#!/bin/bash\nexit 0\n')
  for (const [rel, body] of Object.entries(installedHooks)) writeFileSync(join(root, '.git', 'hooks', rel), body)
  return root
}
const ROOT_LINE = 'ROOT="$(cd "$(dirname "$0")/.." && pwd)"\n'

describe('installed-drift-check -- the stop reasons (each must say NEM MERHETO, rc 1)', () => {
  it('no main worktree: SOURCE_ROOT is not in any git repo', () => {
    const r = run(mkTmp('drift-nogit-'), ['--plists'])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/NEM MERHETO -- a fo worktree nem talalhato/)
  })

  it('no plist template at all: the plist lane would be blind', () => {
    const root = mkTmp('drift-notpl-')
    execFileSync('git', ['init', '-q', root])
    mkdirSync(join(root, 'scripts'))
    const r = run(root, ['--plists'])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/NEM MERHETO -- nincs egyetlen plist-sablon sem/)
  })

  it('a throwaway path surviving normalization STOPS the lane, and names the line', () => {
    // The generated hook embeds the throwaway PARENT, which the repo-path substitution cannot reach.
    const root = installTree(
      { 'install-prod-tree-guard-hook.sh': `#!/bin/bash\n${ROOT_LINE}printf 'X=%s\\n' "$(dirname "$ROOT")/elsewhere" > "$ROOT/.git/hooks/leaky"\n` },
      { leaky: 'X=whatever\n' },
    )
    const r = run(root, ['--hooks'])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/NEM MERHETO -- leaky: a throwaway path survived normalization: X=/)
  })

  it('CONTROL: the same tree with a hook the installed copy matches is measured, rc 0', () => {
    const root = installTree(
      { 'install-prod-tree-guard-hook.sh': `#!/bin/bash\n${ROOT_LINE}printf 'X=static\\n' > "$ROOT/.git/hooks/plain"\n` },
      { plain: 'X=static\n' },
    )
    const r = run(root, ['--hooks'])
    expect(r.out).not.toMatch(/NEM MERHETO/)
    expect(r.status).toBe(0)
  })
})

describe('installed-drift-check -- an installer that hands over is its target\'s run', () => {
  // The live case: git-guard execs no-force-push when present; run ALONE it wrote a 23-line fallback
  // and the live 66-line guard came back as "VEGYES" drift (db782525, 2026-09-28).
  const guardBody = `#!/bin/bash\n${ROOT_LINE}if [ -f "$ROOT/scripts/install-no-force-push-hook.sh" ]; then\n  exec bash "$ROOT/scripts/install-no-force-push-hook.sh" "$@"\nfi\nprintf 'SHORT-FALLBACK\\n' > "$ROOT/.git/hooks/guard"\n`
  const fullBody = `#!/bin/bash\n${ROOT_LINE}printf 'FULL-BODY\\n' > "$ROOT/.git/hooks/guard"\n`

  it('the live guard (full body) is not reported against the fallback, and the hand-over is noted', () => {
    const root = installTree(
      { 'install-git-guard-hook.sh': guardBody, 'install-no-force-push-hook.sh': fullBody },
      { guard: 'FULL-BODY\n' },
    )
    const r = run(root, ['--hooks'])
    expect(r.out).toMatch(/install-git-guard-hook\.sh\s+a\(z\) install-no-force-push-hook\.sh-re delegal/)
    expect(r.out).toMatch(/guard\s+AZONOS\s+\[install-no-force-push-hook\.sh\]/)
    expect(r.status).toBe(0)
  })

  it('delegationTarget reads the exec line, and nothing else', () => {
    expect(delegationTarget(guardBody)).toBe('install-no-force-push-hook.sh')
    expect(delegationTarget(fullBody)).toBeNull()
    // a mention in a comment is not a hand-over
    expect(delegationTarget('# see install-no-force-push-hook.sh\nexit 0\n')).toBeNull()
  })
})
