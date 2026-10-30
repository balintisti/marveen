import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideMainIdentity, MAIN_IDENTITY_DEDUPE_MS } from '../web/channel-monitor.js'

// Card c91a1989 (marveen 10004488). Measured in store/dashboard.log, 2026-10-26: at 05:19:12 the
// main session was hard-restarted, the context guard typed directive 10001227 into it at
// 05:19:26.8-28.7, and the header arrived as "GET /api/mes/rename Marveen" + newline + "sages/...".
// The /rename came from scripts/channels.sh, a separate process whose send-keys bypass the
// dashboard's in-process send lane. So channels.sh no longer types it, and the dashboard names the
// main session in-lane after ANY restart it sees (a new pane pid), not only its own respawns.
const ROOT = join(__dirname, '..', '..')
const NOW = 1_800_000_000_000

describe('decideMainIdentity', () => {
  it('the first reading after the dashboard starts is a baseline, not a restart', () => {
    expect(decideMainIdentity(undefined, 4242, 0, NOW)).toEqual({ schedule: false, nextPid: 4242 })
  })

  it('the same pane pid is the same session: no /rename', () => {
    expect(decideMainIdentity(4242, 4242, 0, NOW)).toEqual({ schedule: false, nextPid: 4242 })
  })

  it('a new pane pid is a restart: schedule the /rename', () => {
    expect(decideMainIdentity(4242, 5151, 0, NOW)).toEqual({ schedule: true, nextPid: 5151 })
  })

  it('an absent or unreadable session keeps the last pid, so its comeback still counts as a restart', () => {
    const gone = decideMainIdentity(4242, null, 0, NOW)
    expect(gone).toEqual({ schedule: false, nextPid: 4242 })
    expect(decideMainIdentity(gone.nextPid, 5151, 0, NOW).schedule).toBe(true)
  })

  it('no baseline yet and no session: still no baseline', () => {
    expect(decideMainIdentity(undefined, null, 0, NOW)).toEqual({ schedule: false, nextPid: undefined })
  })

  it('a respawn path that just scheduled the /rename is not doubled', () => {
    expect(decideMainIdentity(4242, 5151, NOW - MAIN_IDENTITY_DEDUPE_MS + 1, NOW).schedule).toBe(false)
    expect(decideMainIdentity(4242, 5151, NOW - MAIN_IDENTITY_DEDUPE_MS, NOW).schedule).toBe(true)
  })
})

describe('who types the main session /rename', () => {
  const channels = readFileSync(join(ROOT, 'scripts', 'channels.sh'), 'utf-8')
  const monitor = readFileSync(join(ROOT, 'src', 'web', 'channel-monitor.ts'), 'utf-8')

  it('channels.sh sends no /rename keystrokes (it is outside the send lane)', () => {
    const code = channels.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n')
    expect(code).not.toMatch(/send-keys[^\n]*\/rename/)
  })

  it('every main-session identity goes through the deduped helper', () => {
    const direct = monitor.match(/scheduleIdentitySetup\(MAIN_CHANNELS_SESSION/g) ?? []
    expect(direct).toHaveLength(1)
    const helper = monitor.slice(monitor.indexOf('function scheduleMainIdentity(): void {'))
    expect(helper.slice(0, helper.indexOf('\n}\n'))).toContain('scheduleIdentitySetup(MAIN_CHANNELS_SESSION, BOT_NAME)')
  })

  it('the monitor tick runs the any-restart check', () => {
    const tick = monitor.slice(monitor.indexOf('  async function check() {'))
    expect(tick).toContain('checkMainIdentityAfterRestart()')
  })
})
