import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createMainIdentityTracker,
  decideMainIdentity,
  MAIN_IDENTITY_DEDUPE_MS,
  MAIN_IDENTITY_FIRST_READING_SLACK_MS,
} from '../web/channel-monitor.js'

// Card c91a1989 (marveen 10004488). Measured in store/dashboard.log, 2026-10-26: at 05:19:12 the
// main session was hard-restarted, the context guard typed directive 10001227 into it at
// 05:19:26.8-28.7, and the header arrived as "GET /api/mes/rename Marveen" + newline + "sages/...".
// The /rename came from scripts/channels.sh, a separate process whose send-keys bypass the
// dashboard's in-process send lane. So channels.sh no longer types it, and the dashboard names the
// main session in-lane after ANY restart it sees (a new pane pid, or on its first reading a pane
// that started with it), not only its own respawns.
const ROOT = join(__dirname, '..', '..')
const NOW = 1_800_000_000_000

// An old pane (started long before the dashboard) and a young one (started with it).
const OLD = { paneAgeMs: 3_600_000, dashboardUptimeMs: 30_000 }
const YOUNG = { paneAgeMs: 45_000, dashboardUptimeMs: 30_000 }

describe('decideMainIdentity', () => {
  it('the first reading of a pane older than the dashboard is a baseline: it kept its name', () => {
    expect(decideMainIdentity(undefined, 4242, 0, NOW, OLD)).toEqual({ schedule: false, reason: null, nextPid: 4242 })
  })

  // didi 49996 F1: after a reboot both launchd jobs start together, the dashboard's first reading
  // already sees the new main session, and channels.sh no longer names it.
  it('the first reading of a pane that started with the dashboard names it', () => {
    expect(decideMainIdentity(undefined, 4242, 0, NOW, YOUNG)).toEqual({ schedule: true, reason: 'started-with-dashboard', nextPid: 4242 })
  })

  it('the first-reading slack is a closed bound', () => {
    const at = { paneAgeMs: 30_000 + MAIN_IDENTITY_FIRST_READING_SLACK_MS, dashboardUptimeMs: 30_000 }
    expect(decideMainIdentity(undefined, 4242, 0, NOW, at).schedule).toBe(true)
    expect(decideMainIdentity(undefined, 4242, 0, NOW, { ...at, paneAgeMs: at.paneAgeMs + 1 }).schedule).toBe(false)
  })

  it('an unreadable pane age on the first reading names it (a redundant /rename is cosmetic)', () => {
    expect(decideMainIdentity(undefined, 4242, 0, NOW, { paneAgeMs: null, dashboardUptimeMs: 30_000 }).schedule).toBe(true)
  })

  it('the same pane pid is the same session: no /rename', () => {
    expect(decideMainIdentity(4242, 4242, 0, NOW, YOUNG)).toEqual({ schedule: false, reason: null, nextPid: 4242 })
  })

  it('a new pane pid is a restart, whatever its age: schedule the /rename', () => {
    expect(decideMainIdentity(4242, 5151, 0, NOW, OLD)).toEqual({ schedule: true, reason: 'restart', nextPid: 5151 })
  })

  it('an absent or unreadable session keeps the last pid, so its comeback still counts as a restart', () => {
    const gone = decideMainIdentity(4242, null, 0, NOW, OLD)
    expect(gone).toEqual({ schedule: false, reason: null, nextPid: 4242 })
    expect(decideMainIdentity(gone.nextPid, 5151, 0, NOW, OLD).schedule).toBe(true)
  })

  it('no baseline yet and no session: still no baseline', () => {
    expect(decideMainIdentity(undefined, null, 0, NOW, YOUNG)).toEqual({ schedule: false, reason: null, nextPid: undefined })
  })

  it('a respawn path that just scheduled the /rename is not doubled', () => {
    expect(decideMainIdentity(4242, 5151, NOW - MAIN_IDENTITY_DEDUPE_MS + 1, NOW, OLD).schedule).toBe(false)
    expect(decideMainIdentity(4242, 5151, NOW - MAIN_IDENTITY_DEDUPE_MS, NOW, OLD).schedule).toBe(true)
    expect(decideMainIdentity(undefined, 4242, NOW - 1, NOW, YOUNG).schedule).toBe(false)
  })
})

describe('createMainIdentityTracker', () => {
  function rig(paneAgeMs: number | null) {
    let pid: number | null = 4242
    let now = NOW
    const scheduled: number[] = []
    const ageReads: number[] = []
    const t = createMainIdentityTracker({
      readPid: () => pid,
      readPaneAgeMs: (p) => { ageReads.push(p); return paneAgeMs },
      dashboardUptimeMs: () => 30_000,
      schedule: () => scheduled.push(now),
      now: () => now,
    })
    return { t, scheduled, ageReads, setPid: (p: number | null) => { pid = p }, advance: (ms: number) => { now += ms } }
  }

  it('a reboot: the first tick names the young pane once, later ticks do not', () => {
    const r = rig(45_000)
    expect(r.t.check().reason).toBe('started-with-dashboard')
    r.advance(30_000)
    expect(r.t.check().reason).toBeNull()
    expect(r.scheduled).toEqual([NOW])
  })

  it('a dashboard-only restart: the old pane is a baseline, its next restart is named', () => {
    const r = rig(3_600_000)
    expect(r.t.check().reason).toBeNull()
    expect(r.scheduled).toEqual([])
    r.setPid(5151)
    r.advance(MAIN_IDENTITY_DEDUPE_MS)
    expect(r.t.check()).toEqual({ reason: 'restart', pidBefore: 4242, pidAfter: 5151 })
    expect(r.scheduled).toHaveLength(1)
  })

  it('the pane age is read only on the first reading', () => {
    const r = rig(3_600_000)
    r.t.check()
    r.setPid(5151)
    r.t.check()
    expect(r.ageReads).toEqual([4242])
  })

  // didi 49996 F2: a respawn path schedules, then the tick sees the new pid -- one /rename, not two.
  it("a respawn path's own schedule() suppresses the tick's second /rename", () => {
    const r = rig(3_600_000)
    r.t.check()
    r.t.schedule()
    r.setPid(5151)
    r.advance(30_000)
    expect(r.t.check().reason).toBeNull()
    expect(r.scheduled).toEqual([NOW])
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
    const tracker = monitor.slice(monitor.indexOf('const mainIdentity = createMainIdentityTracker({'))
    expect(tracker.slice(0, tracker.indexOf('\n})\n'))).toContain('scheduleIdentitySetup(MAIN_CHANNELS_SESSION, BOT_NAME)')
    const helper = monitor.slice(monitor.indexOf('function scheduleMainIdentity(): void {'))
    expect(helper.slice(0, helper.indexOf('\n}\n'))).toContain('mainIdentity.schedule()')
  })

  it('the monitor tick runs the any-restart check', () => {
    const tick = monitor.slice(monitor.indexOf('  async function check() {'))
    expect(tick).toContain('checkMainIdentityAfterRestart()')
  })
})
