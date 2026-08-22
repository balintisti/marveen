import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY A HEALTH CHECK FOR SOMETHING THAT WORKS (2026-08-22). The Google access
// -- calendar, Drive, mail -- was set up on 2026-08-20 and verified once, by
// hand. Only the calendar is wired into anything the system runs.
// `listDriveFiles`, `readDriveFileText` and `createDriveDoc` have ZERO callers
// in src/, so the Drive leg can rot for weeks and the first person to find out
// is whoever finally needs a file.
//
// And "it works" is not a durable claim about a credential. The same morning
// the calendar was reported broken while working, the mail script was silently
// dropping every message older than local midnight. Neither was noticed by
// anything: both looked like a quiet day.
//
// So the deliverable is not "access set up", it is "access re-measurable, per
// leg, by name". These tests pin the contract that makes it usable from
// doctor.sh -- and the honesty clause: the check states what it does NOT cover.

const REPO = join(__dirname, '..', '..')
const WRAPPER = join(REPO, 'scripts', 'google-health.sh')

function runWrapper(root: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('bash', [join(root, 'scripts', 'google-health.sh')], {
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { stdout, status: 0 }
  } catch (e) {
    const err = e as { stdout?: string; status?: number }
    return { stdout: err.stdout ?? '', status: err.status ?? -1 }
  }
}

function rootWithWrapperOnly(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ghealth-${label}-`))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(WRAPPER, join(root, 'scripts', 'google-health.sh'))
  return root
}

describe('scripts/google-health.sh -- caller contract', () => {
  it('emits JSON and exits 0 when nothing has ever been built', () => {
    const { stdout, status } = runWrapper(rootWithWrapperOnly('nodist'))
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('google-health-cli.js')
  })

  it('says "run the build" when the source is there and the dist is not', () => {
    const root = rootWithWrapperOnly('stale')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'google-health-cli.ts'), '// placeholder\n')
    const { stdout } = runWrapper(root)
    expect(String(JSON.parse(stdout).error)).toContain('npm run build')
  })

  it('never writes anything to stdout that is not JSON', () => {
    const { stdout } = runWrapper(rootWithWrapperOnly('jsononly'))
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stdout.trim().split('\n')).toHaveLength(1)
  })
})

describe('src/google-health-cli.ts -- what it promises and what it admits', () => {
  // Source-pinned: every behavioural path reaches Google, and a test that
  // needs the network fails for reasons that have nothing to do with the code.
  //
  // COMMENTS STRIPPED BEFORE MATCHING. Third time this bit tonight, so it is
  // not bad luck: a file that documents WHY a token is forbidden contains that
  // token, and a source-text check cannot tell an instruction from its own
  // explanation. The `createDriveDoc` assertion below went red against the
  // sentence saying this file must never write. The obvious "fix" is to delete
  // the explanation, which is the one part worth keeping.
  const src = readFileSync(join(REPO, 'src', 'google-health-cli.ts'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n')

  it('is green only when ALL THREE legs are green', () => {
    // A summary that goes green on two out of three is worse than no summary:
    // it is read as "Google is fine".
    expect(src).toMatch(/legs\.calendar\.ok && legs\.drive\.ok && legs\.mail\.ok/)
  })

  it('treats an EMPTY Drive listing as a problem, not as health', () => {
    // A service account sees only what was shared with it. Zero files is the
    // exact shape of "the sharing was never done", and it answers 200.
    expect(src).toMatch(/files\.length === 0/)
    expect(src).toMatch(/NULLA fajl lathato/)
  })

  it('does not treat an empty calendar as a problem -- zero events is a Tuesday', () => {
    // The mirror image of the Drive rule, and the asymmetry is deliberate: an
    // empty Drive means "nothing was ever shared with this identity", an empty
    // calendar means "no meetings". Asserted on the CODE, not on the comment
    // that explains it -- the calendar leg must have no zero-count failure
    // branch at all.
    const calendarLeg = src.slice(src.indexOf('async function checkCalendar'), src.indexOf('async function checkDrive'))
    expect(calendarLeg).toMatch(/return \{ ok: true/)
    expect(calendarLeg).not.toMatch(/events\.length === 0/)
  })

  it('states what it does NOT cover', () => {
    // It never writes, so the drive.file scope is untested. A check that
    // quietly covers less than it appears to is the failure it exists to catch.
    expect(src).toMatch(/not_covered/)
    expect(src).toMatch(/szandekosan csak olvas/)
  })

  it('always exits 0 and silences the logger before the first import', () => {
    expect(src).toMatch(/process\.exit\(0\)/)
    expect(src).not.toMatch(/process\.exit\([1-9]/)
    const silenceAt = src.indexOf("process.env.LOG_LEVEL = 'silent'")
    expect(silenceAt).toBeGreaterThan(-1)
    expect(silenceAt).toBeLessThan(src.search(/await import\(/))
    expect(src).not.toMatch(/^import .* from/m)
  })

  it('never writes -- no probe document, no test event', () => {
    expect(src).not.toMatch(/createDriveDoc/)
  })
})

describe('doctor.sh -- the Google section', () => {
  // Whole-line comments stripped before matching: the section carries a long
  // explanation that names the very things being asserted, and a check that
  // alarms on its own documentation teaches everyone to ignore it.
  const SRC = readFileSync(join(REPO, 'scripts', 'doctor.sh'), 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

  it('runs the health script instead of re-implementing the probes', () => {
    expect(SRC).toMatch(/google-health\.sh/)
  })

  it('reports a failed leg as a doctor failure, so the exit status carries it', () => {
    // `fail` is what sets FAIL=1, which is what `exit "$FAIL"` returns. A
    // section that only prints would leave `doctor.sh; echo $?` saying 0 with
    // three dead legs on screen.
    expect(SRC).toMatch(/FAIL\)\s*fail "\$text"/)
  })

  it('parses with python3, never jq', () => {
    // jq is not installed on a plain box; python3 is a hard requirement of the
    // installer. A jq pipeline would make the section silently empty exactly
    // where the doctor is needed most.
    expect(SRC).not.toMatch(/\bjq\b/)
    expect(SRC).toMatch(/python3 -c/)
  })

  it('names the failure when the health script produces nothing at all', () => {
    expect(SRC).toMatch(/no output/)
  })
})
