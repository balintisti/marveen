import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY THIS CONTRACT IS TESTED AND NOT JUST DOCUMENTED (2026-08-22). The morning
// briefing is an LLM procedure. On 2026-08-22 three documents told it three
// different ways to reach the calendar -- an OAuth token file, an MCP tool, and
// the service account -- and it picked the one that does not exist. It then
// wrote "naptar: nincs bekotve eszkoz" into Isti's morning message, while the
// service-account path was answering HTTP 200 with `accessRole: writer` on that
// same calendar. The briefing reported a WORKING source as unreachable, and the
// rule that produced that line ("spell out an unreachable source") had fired
// correctly.
//
// The fix is one command whose every outcome is a value in its output. These
// tests pin the part that matters most: the failures that happen BEFORE any of
// our code runs -- no node, no build -- still come back as JSON, on stdout,
// with exit 0. A caller that got a bare stderr blob and a non-zero exit would
// print an empty calendar section, which is the exact silence this replaces.

const REPO = join(__dirname, '..', '..')
const WRAPPER = join(REPO, 'scripts', 'calendar-agenda.sh')

function runWrapper(root: string, args: string[] = []): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('bash', [join(root, 'scripts', 'calendar-agenda.sh'), ...args], {
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

/** A throwaway install root holding only the wrapper -- no dist, no build. */
function rootWithWrapperOnly(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `agenda-${label}-`))
  mkdirSync(join(root, 'scripts'), { recursive: true })
  copyFileSync(WRAPPER, join(root, 'scripts', 'calendar-agenda.sh'))
  return root
}

/**
 * A throwaway root with a FAKE compiled CLI that answers from a script, so a
 * test can decide what the calendar call returns and count how many times the
 * wrapper asked. `dist/agenda-cli.js` wins the wrapper's resolution, so this
 * is the path the running system uses.
 */
function rootWithFakeCli(label: string, body: string): string {
  const root = rootWithWrapperOnly(label)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'dist', 'agenda-cli.js'), body)
  return root
}

/** Counts invocations in a file next to the fake, so the test can assert them. */
const COUNTING_FAKE = (firstOut: string, laterOut: string) => `
const fs = require('node:fs')
const c = __dirname + '/calls'
const n = (fs.existsSync(c) ? Number(fs.readFileSync(c, 'utf-8')) : 0) + 1
fs.writeFileSync(c, String(n))
process.stdout.write(n === 1 ? ${JSON.stringify(firstOut)} : ${JSON.stringify(laterOut)})
`

function callCount(root: string): number {
  return Number(readFileSync(join(root, 'dist', 'calls'), 'utf-8'))
}

// WHY THIS EXISTS (card f4c59571, measured 2026-08-24). The CLI reports an API
// failure as {"ok":false,...} with exit 0, and the wrapper passed it straight
// through. A SINGLE slow round trip therefore became a sentence in Isti's
// morning briefing saying the calendar could not be reached. Measured: 7 runs,
// one died on a 5000ms deadline, the other six answered in 2.16-4.16s.
//
// The briefing runs ONCE, cold, in the morning. The call that matters most is
// the one with no second chance.
describe('scripts/calendar-agenda.sh -- a transient failure gets a second chance', () => {
  it('retries a TRANSPORT error once, and reports the successful second answer', () => {
    const root = rootWithFakeCli(
      'transient',
      COUNTING_FAKE('{"ok":false,"error":"Google API request timed out after 5000ms"}',
                    '{"ok":true,"count":0,"events":[]}'),
    )
    const { stdout, status } = runWrapper(root)
    expect(status).toBe(0)
    expect(JSON.parse(stdout).ok).toBe(true)
    expect(callCount(root)).toBe(2)
  })

  it('does NOT retry a deterministic error -- one call, and the reason survives', () => {
    // A 403 cannot become a 200 by asking again: a retry here would only double
    // the wait before a real message. Retrying everything would turn a repair
    // into a way of hiding outages.
    const root = rootWithFakeCli(
      'permission',
      COUNTING_FAKE('{"ok":false,"error":"HTTP 403: insufficient permission"}',
                    '{"ok":true,"count":0,"events":[]}'),
    )
    const { stdout } = runWrapper(root)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('403')
    expect(callCount(root)).toBe(1)
  })

  it('gives up after ONE retry and returns the error -- not a loop, not a silent success', () => {
    const root = rootWithFakeCli(
      'persistent',
      COUNTING_FAKE('{"ok":false,"error":"Google API request timed out after 5000ms"}',
                    '{"ok":false,"error":"Google API request timed out after 5000ms"}'),
    )
    const { stdout, status } = runWrapper(root)
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('timed out')
    expect(callCount(root)).toBe(2)
  })

  it('a SUCCESSFUL first call is not repeated', () => {
    const root = rootWithFakeCli(
      'happy',
      COUNTING_FAKE('{"ok":true,"count":0,"events":[]}', '{"ok":true,"count":99,"events":[]}'),
    )
    const { stdout } = runWrapper(root)
    expect(JSON.parse(stdout).ok).toBe(true)
    expect(callCount(root)).toBe(1)
  })
})

describe('scripts/calendar-agenda.sh -- caller contract', () => {
  it('emits JSON and exits 0 when nothing has ever been built', () => {
    const { stdout, status } = runWrapper(rootWithWrapperOnly('nodist'))
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('agenda-cli.js')
  })

  it('says "run the build" when the SOURCE is there but the dist is not', () => {
    // The quiet one: the feature exists in the repo and the running system has
    // never seen it. A stale build does not error, it silently serves the old
    // world -- so the message has to name the missing step, not the symptom.
    const root = rootWithWrapperOnly('stale')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'agenda-cli.ts'), '// placeholder\n')
    const { stdout, status } = runWrapper(root)
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('npm run build')
  })

  it('never writes anything to stdout that is not JSON', () => {
    // The whole contract in one line: the caller parses stdout. A diagnostic
    // printed alongside the JSON breaks the parse, and a broken parse is
    // indistinguishable from an empty calendar at the other end.
    const { stdout } = runWrapper(rootWithWrapperOnly('jsononly'))
    expect(() => JSON.parse(stdout)).not.toThrow()
    expect(stdout.trim().split('\n')).toHaveLength(1)
  })

  it('reports the failure even when the caller passed arguments', () => {
    const { stdout } = runWrapper(rootWithWrapperOnly('withargs'), ['--hours', '48'])
    expect(JSON.parse(stdout).ok).toBe(false)
  })
})

describe('the real wrapper, end to end, on a path that never reaches Google', () => {
  it('rejects a nonsense --hours as JSON, exit 0, and says which copy answered', () => {
    // Runs the ACTUAL scripts/calendar-agenda.sh in the ACTUAL repo, so the
    // node/tsx selection is exercised for real. --hours validation happens
    // before the first API call, which is what keeps this test offline.
    let stdout = ''
    let status = 0
    try {
      stdout = execFileSync('bash', [WRAPPER, '--hours', 'holnap'], {
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      const err = e as { stdout?: string; status?: number }
      stdout = err.stdout ?? ''
      status = err.status ?? -1
    }
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.ok).toBe(false)
    expect(String(parsed.error)).toContain('--hours')
    expect(String(parsed.via)).not.toHaveLength(0)
  })
})

describe('src/agenda-cli.ts -- the shape it promises', () => {
  // Source-pinned deliberately, and worth saying why: every behavioural path
  // through this file ends in a Google API call, and a test that reaches the
  // network is a test that fails for reasons that have nothing to do with the
  // code. What is pinned here is exactly what cannot be re-derived from a live
  // run: that there is NO path to an empty agenda that is not also `ok:true`.
  const src = readFileSync(join(REPO, 'src', 'agenda-cli.ts'), 'utf-8')

  it('always exits 0, so the reason cannot be lost to an exit status', () => {
    expect(src).toMatch(/process\.exit\(0\)/)
    expect(src).not.toMatch(/process\.exit\([1-9]/)
  })

  it('silences the logger BEFORE importing anything that constructs it', () => {
    // pino writes to stdout. One INFO line ("Google service-account access
    // token issued" -- it really does log that) would sit in front of the JSON
    // and break every caller. A static import is hoisted above the assignment,
    // which is why every import in that file is dynamic.
    const silenceAt = src.indexOf("process.env.LOG_LEVEL = 'silent'")
    const firstImportAt = src.search(/await import\(/)
    expect(silenceAt).toBeGreaterThan(-1)
    expect(silenceAt).toBeLessThan(firstImportAt)
    expect(src).not.toMatch(/^import .* from/m)
  })

  it('rejects an unparseable --hours instead of quietly defaulting', () => {
    // NaN hours would produce an empty window, and an empty window renders as
    // a free day. A typo must not become a calm morning.
    expect(src).toMatch(/Number\.isFinite\(hours\)/)
    expect(src).toMatch(/--hours ervenytelen/)
  })

  it('warns when the id is `primary`, the one that reads 200-and-empty forever', () => {
    // On the service-account path `primary` is the MACHINE account's own
    // calendar. It answers 200 with no events, permanently, and it is a
    // plausible thing to configure -- it is even correct on the OAuth path.
    // A calm empty day is exactly the shape this whole change removes.
    expect(src).toMatch(/=== 'primary'/)
    expect(src).toMatch(/HEARTBEAT_CALENDAR_ID-t a megosztott naptar cimere/)
    expect(src).toMatch(/^\s*warning,$/m)
  })

  it('names WHICH copy answered, on the success path and the failure path', () => {
    // Two copies can serve this (compiled dist, or the source through tsx).
    // Marveen lost five days on 2026-08-22 to a fix verified against a
    // different copy than production ran, because the two outputs were
    // identical. `via` has to be on BOTH shapes -- a failure that does not say
    // where it came from sends the reader to the wrong file.
    const okBlock = src.slice(src.indexOf('ok: true'))
    expect(okBlock).toMatch(/via: process\.env\.AGENDA_VIA/)
    const failBlock = src.slice(src.indexOf('function fail'), src.indexOf('function fail') + 300)
    expect(failBlock).toMatch(/via: process\.env\.AGENDA_VIA/)
  })

  it('wraps invite-authored text as untrusted -- anyone can send an invite', () => {
    expect(src).toMatch(/wrapUntrusted\(\s*'gcal-event-summary'/)
    expect(src).toMatch(/wrapUntrusted\(\s*'gcal-event-attendees'/)
  })
})
