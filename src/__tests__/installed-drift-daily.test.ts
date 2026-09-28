// THE DAILY RUN OF THE DRIFT METER (card 4a5a4aae): who hears which exit code.
// rc 1 (NEM MERHETO) and any other failure reach the coordinator; rc 0 and rc 3 (drift, a triage
// question) stay in the log. The real script runs; the check and the sender are fakes on its seams.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()
const SCRIPT = join(__dirname, '..', '..', 'scripts', 'installed-drift-daily.sh')

function daily(rc: number, opts: { firstLine?: string; msgFails?: boolean } = {}) {
  const d = mkTmp('drift-daily-')
  const check = join(d, 'check.sh')
  writeFileSync(check, `#!/bin/bash\necho ${JSON.stringify(opts.firstLine ?? `installed-drift: NEM MERHETO -- teszt ok`)}\necho masodik sor\nexit ${rc}\n`)
  const sent = join(d, 'sent.txt')
  const msg = join(d, 'msg.sh')
  writeFileSync(msg, opts.msgFails
    ? `#!/bin/bash\ncat > /dev/null\necho "FAIL HTTP 500"\nexit 1\n`
    : `#!/bin/bash\ncat > ${JSON.stringify(sent)}\necho "OK id=77 queue=0"\n`)
  const log = join(d, 'drift.log')
  const r = spawnSync('bash', [SCRIPT], {
    encoding: 'utf-8',
    env: { ...process.env, INSTALLED_DRIFT_CMD: `bash ${check}`, INSTALLED_DRIFT_MSG: `bash ${msg}`, INSTALLED_DRIFT_LOG: log },
  })
  return {
    status: r.status,
    sent: existsSync(sent) ? readFileSync(sent, 'utf-8') : null,
    log: existsSync(log) ? readFileSync(log, 'utf-8') : '',
  }
}

describe('installed-drift-daily.sh', () => {
  it('rc 1 (NEM MERHETO): the coordinator gets it, with the meter\'s own first line', () => {
    const r = daily(1)
    expect(r.sent).toMatch(/NEM MERHETO \(rc=1\)/)
    expect(r.sent).toContain('installed-drift: NEM MERHETO -- teszt ok')
    expect(r.log).toMatch(/rc=1/)
    expect(r.log).toMatch(/jelezve: OK id=77/)
    expect(r.status).toBe(1)
  })

  it('rc 3 (drift): the log only -- no letter', () => {
    const r = daily(3, { firstLine: 'installed-drift: 2 elteres 20 osszevetesbol.' })
    expect(r.sent).toBeNull()
    expect(r.log).toMatch(/rc=3/)
    expect(r.log).toContain('2 elteres')
    expect(r.status).toBe(0)
  })

  it('CONTROL rc 0: the log only', () => {
    const r = daily(0, { firstLine: 'installed-drift: nincs elteres (23 osszevetes).' })
    expect(r.sent).toBeNull()
    expect(r.log).toMatch(/rc=0/)
    expect(r.status).toBe(0)
  })

  it('any other failure (a crash, no node) is blindness too, and is sent', () => {
    const r = daily(2, { firstLine: 'Error: Cannot find module tsx' })
    expect(r.sent).toMatch(/rc=2/)
    expect(r.sent).toContain('Cannot find module tsx')
  })

  it('a failed LETTER is not silent: exit 2, and the log says the alarm itself failed', () => {
    const r = daily(1, { msgFails: true })
    expect(r.status).toBe(2)
    expect(r.log).toMatch(/A JELZES IS ELBUKOTT: FAIL HTTP 500/)
  })
})

describe('com.marveen.installed-drift.plist.template', () => {
  const tpl = readFileSync(join(__dirname, '..', '..', 'scripts', 'com.marveen.installed-drift.plist.template'), 'utf-8')
  it('runs the daily script, once a day, not at load', () => {
    expect(tpl).toContain('<string>__MARVEEN_ROOT__/scripts/installed-drift-daily.sh</string>')
    expect(tpl).toMatch(/<key>StartCalendarInterval<\/key>\s*<dict>\s*<key>Hour<\/key>/)
    expect(tpl).toMatch(/<key>RunAtLoad<\/key>\s*<false\/>/)
  })
})

// THE QUOTA CEILINGS LIVE IN THE TEMPLATE (card 4a5a4aae, marveen's triage): the installed unit
// carries SOFT 95 / HARD 97 while the script defaults to 93 / 95, so a template without them makes
// every reinstall quietly lower both ceilings.
describe('com.marveen.quota-ceiling-guard.plist.template', () => {
  const tpl = readFileSync(join(__dirname, '..', '..', 'scripts', 'com.marveen.quota-ceiling-guard.plist.template'), 'utf-8')
  const val = (k: string) => Number(tpl.match(new RegExp(`<key>${k}</key><string>(\\d+)</string>`))?.[1])
  it('carries both ceilings, soft below hard', () => {
    expect(val('QUOTA_CEILING_SOFT')).toBe(95)
    expect(val('QUOTA_CEILING_HARD')).toBe(97)
  })
})
