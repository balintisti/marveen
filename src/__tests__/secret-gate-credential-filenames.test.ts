import { describe, it, expect } from 'vitest'
import { scanFile, CREDENTIAL_FILE_PATTERNS, CREDENTIAL_FILE_EXCEPTIONS } from '../security/secret-gate.js'

// The gate bit hard on CONTENT shapes and was blind on the NAME axis (card
// 5cf210d6): a `.env` or a `service-account.json` with nothing the scanner
// recognises inside went straight through. The two detectors are different
// axes, not a stronger and a weaker version of one -- which is why this file
// tests the interaction between them and not just the new patterns.
//
// PRE-FLIGHT BEFORE THE RULE EXISTED: of 1140 tracked files exactly ONE matches
// (`.env.example`) and the exception removes it, so zero tracked files start
// blocking. That check is the point, not ceremony: a previous change to this
// gate cost the fleet 25 minutes of `git commit` across 35 worktrees (6414366f),
// and the pre-commit hook imports this file through tsx -- it goes live at
// merge, with no build in between.

const blocked = (path: string, content = 'nothing interesting here\n') =>
  scanFile({ path, content }).filter((f) => f.severity === 'blocked')
const names = (path: string, content?: string) =>
  blocked(path, content).map((f) => f.reason)

describe('credential filenames block', () => {
  for (const p of ['.env', '.env.local', 'config/.env', 'deploy/.env.production',
                   'service-account.json', 'secrets/service-account.json',
                   'tokens.json', 'key.pem', 'certs/server.pem',
                   'id_rsa', '.ssh/id_rsa.old', '.netrc', '.npmrc',
                   'docker/config.json', '.bash_history', '.psql_history']) {
    it(`blocks ${p}`, () => {
      expect(names(p).some((r) => r.startsWith('credential filename:'))).toBe(true)
    })
  }
})

describe('the anchors hold: a similar NAME is not a credential', () => {
  // Without these the rule would look correct and quietly block ordinary work,
  // which is the failure mode that produced the 25-minute outage.
  for (const p of ['src/environment.ts', 'docs/dotenv.md', 'src/tokens.ts',
                   'lib/mypem.txt', 'src/id_rsandom.ts', 'web/npmrc-notes.md',
                   'src/config.json', 'docker-compose.yml']) {
    it(`leaves ${p} alone`, () => {
      expect(names(p)).toEqual([])
    })
  }
})

describe('the NOT-list exempts the NAME rule ONLY', () => {
  it('.env.example does not block on its name', () => {
    expect(names('.env.example')).toEqual([])
  })
  it('.env.sample and .env.template likewise', () => {
    expect(names('.env.sample')).toEqual([])
    expect(names('config/.env.template')).toEqual([])
  })

  it('THE LOAD-BEARING ONE: a real secret inside .env.example STILL blocks', () => {
    // This is why the exception is not an ALLOWLISTED_PATHS entry: that list
    // exempts a file from EVERYTHING. "We know this NAME is fine" and "stop
    // looking at this file" are different statements, and only the first is true.
    // A kulcs-alak DARABOKBOL all ossze, tehat a literal SEHOL nem szerepel a
    // fajlban. Igy nem kell ALLOWLISTED_PATHS bejegyzes -- az ugyanis a fajlt
    // MINDEN vizsgalat alol kivenne, es egy kesobbi, VALODI hiba is elbujna
    // benne. A kapu sajat javaslata az allowlist; ez szukebb es tobbet ell.
    const fakeKey = ['sk', 'live', '51H8xQwErTyUiOpAsDfGhJkLz'].join('_')
    const found = names('.env.example', `STRIPE_KEY=${fakeKey}\n`)
    expect(found.length).toBeGreaterThan(0)
    expect(found.some((r) => r.startsWith('credential filename:'))).toBe(false)
    expect(found.some((r) => r.startsWith('secret shape:'))).toBe(true)
  })

  it('and the exception does NOT weaken the directory rule', () => {
    // An evidence directory is still an evidence directory, whatever the file
    // inside it is called.
    expect(names('evidence/.env.example').length).toBeGreaterThan(0)
  })
})

describe('controls on the lists themselves', () => {
  it('every pattern carries a reason a reader can act on', () => {
    for (const { pattern, reason } of [...CREDENTIAL_FILE_PATTERNS, ...CREDENTIAL_FILE_EXCEPTIONS]) {
      expect(pattern).toBeInstanceOf(RegExp)
      expect(reason.length).toBeGreaterThan(8)
    }
  })
  it('CONTROL: the meter can say no -- a plain source file yields nothing', () => {
    expect(blocked('src/web/agent-process.ts')).toEqual([])
  })
  it('CONTROL: and yes -- the shortest credential name still trips', () => {
    expect(blocked('.env').length).toBe(1)
  })
})
