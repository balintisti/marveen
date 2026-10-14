import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// Card 1b0faf28 (didi, 2026-09-25): pre-pr-review.sh sent `git diff` to an external model raw.
// On a private repo's PR the diff carried a DELETED .bash_history, and `--range` said PASS on
// the same range, because it scans HEAD blobs and a deleted file has none. `--outgoing` scans
// the text that is actually sent. These tests pin both the gap and the fix.

const REPO = process.cwd()
const RUNNER = join(REPO, 'scripts', 'secret-gate.ts')
const TSX = join(REPO, 'node_modules', '.bin', 'tsx')
/** Assembled at runtime so this file carries no literal the gate would flag. */
const SECRET_LINE = `const k = '${'AKIA'}${'ABCDEFGHIJKLMNOP'}'`

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf-8' })

function repoWith(files: Record<string, string>): { root: string; base: string } {
  const root = mkTmp('secret-gate-outgoing-')
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'test@example.invalid'])
  git(root, ['config', 'user.name', 'test'])
  writeFileSync(join(root, 'README.md'), '# base\n')
  for (const [p, c] of Object.entries(files)) writeFileSync(join(root, p), c)
  git(root, ['add', '-A']); git(root, ['commit', '-qm', 'base'])
  return { root, base: git(root, ['rev-parse', 'HEAD']).trim() }
}
const commitAll = (root: string) => { git(root, ['add', '-A']); git(root, ['commit', '-qm', 'change']) }

function gate(cwd: string, args: string[]) {
  const r = spawnSync(TSX, [RUNNER, ...args], { cwd, encoding: 'utf-8' })
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

describe('secret-gate --outgoing: the text that leaves the machine (1b0faf28)', () => {
  it('THE GAP: a secret only in a DELETED file passes --range', () => {
    const { root, base } = repoWith({ 'old.ts': `${SECRET_LINE}\n` })
    rmSync(join(root, 'old.ts')); writeFileSync(join(root, 'new.ts'), 'export const x = 1\n'); commitAll(root)
    expect(gate(root, ['--range', `${base}..HEAD`]).status).toBe(0)
  })

  it('the same range is RED in --outgoing, and nothing is written', () => {
    const { root, base } = repoWith({ 'old.ts': `${SECRET_LINE}\n` })
    rmSync(join(root, 'old.ts')); writeFileSync(join(root, 'new.ts'), 'export const x = 1\n'); commitAll(root)
    const out = join(mkTmp('outgoing-out-'), 'outgoing-red.diff')
    const r = gate(root, ['--outgoing', `${base}...HEAD`, out])
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/BLOCKED \(1\):\n\s+old\.ts:1\s+\[content\]/)
    expect(existsSync(out)).toBe(false)
    expect(r.out).not.toContain('ABCDEFGHIJKLMNOP')
  })

  it('a deleted .bash_history is dropped by NAME, its content is not in the outgoing text', () => {
    const { root, base } = repoWith({ '.bash_history': `psql ${SECRET_LINE}\n` })
    rmSync(join(root, '.bash_history')); writeFileSync(join(root, 'app.ts'), 'export const y = 2\n'); commitAll(root)
    const out = join(mkTmp('outgoing-out-'), 'outgoing-hist.diff')
    const r = gate(root, ['--outgoing', `${base}...HEAD`, out])
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/- \.bash_history\s+<- dotfile/)
    const sent = readFileSync(out, 'utf-8')
    expect(sent).toContain('+export const y = 2')
    expect(sent).not.toContain('bash_history')
    expect(sent).not.toContain('AKIA')
  })

  it('POSITIVE CONTROL: a clean change is written whole, both files', () => {
    const { root, base } = repoWith({ 'a.ts': 'export const a = 1\n' })
    writeFileSync(join(root, 'a.ts'), 'export const a = 2\n'); writeFileSync(join(root, 'b.ts'), 'export const b = 3\n'); commitAll(root)
    const out = join(mkTmp('outgoing-out-'), 'outgoing-clean.diff')
    const r = gate(root, ['--outgoing', `${base}...HEAD`, out])
    expect(r.status).toBe(0)
    const sent = readFileSync(out, 'utf-8')
    expect(sent).toContain('-export const a = 1')
    expect(sent).toContain('+export const b = 3')
  })

  it('a path with a space is parsed, not sent unscanned', () => {
    const { root, base } = repoWith({})
    writeFileSync(join(root, 'my file.ts'), `${SECRET_LINE}\n`); commitAll(root)
    const r = gate(root, ['--outgoing', `${base}...HEAD`, join(mkTmp('outgoing-out-'), 'sp.diff')])
    expect(r.status).toBe(1)
    expect(r.out).toContain('my file.ts:1')
  })

  it('without an outfile it refuses (exit 2)', () => {
    const { root, base } = repoWith({})
    expect(gate(root, ['--outgoing', `${base}...HEAD`]).status).toBe(2)
  })
})

describe('pre-pr-review.sh sends only what --outgoing cleared (end to end)', () => {
  // A throwaway install: the real script and gate, the worktree's src and node_modules, a dummy
  // dashboard token, and a WEB_PORT nobody listens on -- so no vault key exists and no reviewer
  // can be called. What is measured is the decision before any send.
  function install(): string {
    const dir = mkTmp('pre-pr-install-')
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'store'))
    copyFileSync(join(REPO, 'scripts', 'pre-pr-review.sh'), join(dir, 'scripts', 'pre-pr-review.sh'))
    copyFileSync(RUNNER, join(dir, 'scripts', 'secret-gate.ts'))
    symlinkSync(join(REPO, 'src'), join(dir, 'src'))
    symlinkSync(join(REPO, 'node_modules'), join(dir, 'node_modules'))
    writeFileSync(join(dir, 'store', '.dashboard-token'), 'dummy\n')
    return dir
  }
  const review = (dir: string, cwd: string, base: string) => {
    const r = spawnSync('bash', [join(dir, 'scripts', 'pre-pr-review.sh'), base], {
      cwd, encoding: 'utf-8', env: { ...process.env, WEB_PORT: '1' },
    })
    return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }

  it('a secret in deleted lines stops the script before any reviewer (exit 3)', () => {
    const dir = install()
    const { root, base } = repoWith({ 'old.ts': `${SECRET_LINE}\n` })
    rmSync(join(root, 'old.ts')); writeFileSync(join(root, 'n.ts'), 'export const n = 1\n'); commitAll(root)
    const r = review(dir, root, base)
    expect(r.status).toBe(3)
    expect(r.out).toContain('REFUSED')
    expect(r.out).not.toMatch(/review skipped/)
  })

  it('POSITIVE CONTROL: a clean diff gets past the gate to the reviewer step', () => {
    const dir = install()
    const { root, base } = repoWith({})
    writeFileSync(join(root, 'n.ts'), 'export const n = 1\n'); commitAll(root)
    const r = review(dir, root, base)
    expect(r.status).toBe(0)
    expect(r.out).toMatch(/GEMINI_API_KEY not set in vault/)
  })
})
