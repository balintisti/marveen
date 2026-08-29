import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY THIS IS TESTED AND NOT JUST FIXED (card 477682a0, measured 2026-08-24).
// The three voice wrappers picked their install root by asking "is `_vtools.py`
// next to me?". The installer COPIES `_vtools.py` next to the wrapper, so that
// is true in the repo checkout AND in the install dir: a discriminator that is
// true in both places cannot discriminate. The repo copies therefore resolved to
// `scripts/voice`, which the installer never populates.
//
// The costly half was `canary.sh` -- the weekly self-test built to notice a
// missing voice stack. From the repo path it printed "skip: not installed" and
// exited 0 EVEN WITH THE STACK INSTALLED at the default location. The one guard
// that would have reported the outage was structurally unable to fire, and its
// silence was indistinguishable from a healthy week.
//
// So the assertion that matters is not "the scripts contain a fallback" but
// "a wrapper invoked from the REPO path finds a stack installed ELSEWHERE".

const REPO = join(__dirname, '..', '..')
const VOICE = join(REPO, 'scripts', 'voice')

function run(script: string, args: string[], installDir: string): { out: string; status: number } {
  try {
    const out = execFileSync('bash', [join(VOICE, script), ...args], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, INSTALL_DIR: installDir },
    })
    return { out, status: 0 }
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number }
    return { out: (err.stdout ?? '') + (err.stderr ?? ''), status: err.status ?? -1 }
  }
}

/** An install root that looks exactly like a finished `install-voice.sh` run. */
function fakeInstall(): string {
  const root = mkdtempSync(join(tmpdir(), 'voice-inst-'))
  mkdirSync(join(root, 'venv', 'bin'), { recursive: true })
  mkdirSync(join(root, 'voices'), { recursive: true })
  const py = join(root, 'venv', 'bin', 'python')
  // Echoes its arguments so the test can prove WHICH root was chosen.
  writeFileSync(py, '#!/bin/sh\necho CHOSEN "$1"\n')
  chmodSync(py, 0o755)
  copyFileSync(join(VOICE, '_vtools.py'), join(root, '_vtools.py'))
  return root
}

/** A path where nothing was ever installed. */
function emptyRoot(): string {
  return join(mkdtempSync(join(tmpdir(), 'voice-none-')), 'never-installed')
}

describe('voice wrappers: which install root do they choose', () => {
  it('stt.sh, run from the repo, USES a stack installed at INSTALL_DIR', () => {
    const root = fakeInstall()
    const r = run('stt.sh', ['FILE_ID'], root)
    // This is the regression: before the fix the repo copy looked only next to
    // itself and died with "No such file or directory" on scripts/voice/venv.
    expect(r.status).toBe(0)
    expect(r.out).toContain(`CHOSEN ${join(root, '_vtools.py')}`)
  })

  it('tts.sh, run from the repo, USES a stack installed at INSTALL_DIR', () => {
    const root = fakeInstall()
    const r = run('tts.sh', ['imre', '123', 'szia'], root)
    expect(r.status).toBe(0)
    expect(r.out).toContain(`CHOSEN ${join(root, '_vtools.py')}`)
  })

  it('canary.sh does NOT skip when the stack is installed at INSTALL_DIR', () => {
    const root = fakeInstall()
    const r = run('canary.sh', [], root)
    // The whole point of the weekly canary: it must actually run.
    expect(r.out).not.toContain('skip')
    expect(r.out).toContain(`CHOSEN ${join(root, '_vtools.py')}`)
  })

  it('stt.sh fails LOUDLY, and names both paths and the installer, when nothing is installed', () => {
    const r = run('stt.sh', ['FILE_ID'], emptyRoot())
    expect(r.status).toBe(3)
    expect(r.out).toContain('scripts/voice/venv/bin/python')
    expect(r.out).toContain('never-installed/venv/bin/python')
    expect(r.out).toContain('install-voice.sh')
  })

  it('canary.sh still skips quietly when the stack is installed NOWHERE', () => {
    // Deliberate and unchanged: the voice stack is opt-in, so "not installed"
    // must not read as a weekly regression. The skip is only honest because
    // BOTH candidate roots were looked at first -- which the message states.
    const root = emptyRoot()
    const r = run('canary.sh', [], root)
    expect(r.status).toBe(0)
    expect(r.out).toContain('skip')
    expect(r.out).toContain(root)
  })

  it('an INSTALLED copy still prefers its own directory over INSTALL_DIR', () => {
    const own = fakeInstall()
    const other = fakeInstall()
    copyFileSync(join(VOICE, 'stt.sh'), join(own, 'stt.sh'))
    const out = execFileSync('bash', [join(own, 'stt.sh'), 'FILE_ID'], {
      encoding: 'utf-8',
      timeout: 30_000,
      env: { ...process.env, INSTALL_DIR: other },
    })
    expect(out).toContain(`CHOSEN ${join(own, '_vtools.py')}`)
    expect(out).not.toContain(other)
  })
})
