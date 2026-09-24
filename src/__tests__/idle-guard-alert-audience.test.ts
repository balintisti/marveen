import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { routeFleetAlerts, deliverFleetAlerts, type FleetAlert } from '../idle-agent.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const SRC = readFileSync(join(ROOT, 'src', 'web', 'idle-agent-watcher.ts'), 'utf-8')

/**
 * The guard raises four kinds of alert. Three report on the guard ITSELF (a pane it could not
 * read, a missing work-check, a wake it could not enqueue) and have gone to the coordinator since
 * 2026-09-03, when THREE of four owner alerts turned out to be 'pane-unreadable' on panes that
 * read fine seconds later.
 *
 * The fourth, 'still-idle', went to the owner until card 1b997345: 45 messages on 2026-09-24,
 * and its remedy (a card, a workcheck) is the coordinator's. Now everything goes to the
 * coordinator, and the owner is the fallback -- tick() itself is driven end to end in
 * idle-guard-still-idle-routing.test.ts; these pin the rule and the delivery on their own.
 */
const C = 'marveen'
const still = (agent: string): FleetAlert => ({ kind: 'still-idle', agent, minutes: 40, workCount: 2 })
const blind: FleetAlert = { kind: 'pane-unreadable', agent: 'y', paneReason: 'capture-failed' }
const noCheck: FleetAlert = { kind: 'no-work-check', agent: 'z' }

describe('routeFleetAlerts: the coordinator by default, the owner only when he cannot act', () => {
  it('coordinator running and not himself stuck: every kind to him, nothing to the owner', () => {
    const r = routeFleetAlerts([still('x'), blind, noCheck], C, true)
    expect(r.owner).toEqual([])
    expect(r.coordinator).toEqual([still('x'), blind, noCheck])
  })

  it('the coordinator is among the still-idle: the still-idle rows go to the owner', () => {
    const r = routeFleetAlerts([still('x'), still(C), blind], C, true)
    expect(r.owner).toEqual([still('x'), still(C)])
    expect(r.coordinator).toEqual([blind])
  })

  it('the coordinator is not running: the still-idle rows go to the owner', () => {
    const r = routeFleetAlerts([still('x'), noCheck], C, false)
    expect(r.owner).toEqual([still('x')])
    expect(r.coordinator).toEqual([noCheck])
  })

  it("the guard's reports on itself NEVER reach the owner by rule (the 2026-09-03 defect)", () => {
    for (const running of [true, false]) {
      for (const set of [[blind, noCheck], [blind, still(C)], [noCheck, still('x')]]) {
        const r = routeFleetAlerts(set, C, running)
        expect(r.owner.filter((a) => a.kind !== 'still-idle'), `running=${running}`).toEqual([])
      }
    }
  })

  it('nothing is dropped: owner + coordinator is always the whole sweep', () => {
    const all = [still('x'), still(C), blind, noCheck]
    for (const running of [true, false]) {
      for (let n = 0; n <= all.length; n++) {
        const set = all.slice(0, n)
        const r = routeFleetAlerts(set, C, running)
        expect([...r.owner, ...r.coordinator].sort((a, b) => a.agent.localeCompare(b.agent)))
          .toEqual([...set].sort((a, b) => a.agent.localeCompare(b.agent)))
      }
    }
  })
})

describe('deliverFleetAlerts: one message per audience, and an enqueue failure falls back', () => {
  const io = () => ({ toCoordinator: vi.fn(), toOwner: vi.fn(), onCoordinatorFailed: vi.fn() })

  it('empty sweep: nothing is sent', () => {
    const o = io()
    expect(deliverFleetAlerts([], C, true, o)).toEqual({ owner: [], coordinator: [] })
    expect(o.toCoordinator).not.toHaveBeenCalled()
    expect(o.toOwner).not.toHaveBeenCalled()
  })

  it('ONE coordinator message for the whole sweep', () => {
    const o = io()
    const d = deliverFleetAlerts([still('x'), still('w'), blind], C, true, o)
    expect(o.toCoordinator).toHaveBeenCalledTimes(1)
    expect(o.toOwner).not.toHaveBeenCalled()
    expect(d.coordinator).toHaveLength(3)
  })

  it('the coordinator enqueue throws: the WHOLE coordinator batch goes to the owner, and it is reported', () => {
    const o = io()
    o.toCoordinator.mockImplementation(() => { throw new Error('queue down') })
    const d = deliverFleetAlerts([still('x'), blind], C, true, o)
    expect(o.onCoordinatorFailed).toHaveBeenCalledTimes(1)
    expect(o.toOwner).toHaveBeenCalledTimes(1)
    expect(d).toEqual({ owner: [still('x'), blind], coordinator: [] })
  })

  it('owner rows by rule and by fallback arrive in ONE owner message', () => {
    const o = io()
    o.toCoordinator.mockImplementation(() => { throw new Error('queue down') })
    const d = deliverFleetAlerts([still(C), blind], C, true, o)
    expect(o.toOwner).toHaveBeenCalledTimes(1)
    expect(d.owner).toEqual([still(C), blind])
  })
})

describe('tick() uses the delivery, not a route of its own', () => {
  const start = SRC.indexOf('export function tick(): void {')
  const fnBody = SRC.slice(start, SRC.indexOf('\n}', start))

  it('no direct sendAlert(buildFleetAlert(...)) is left in tick()', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(fnBody).toMatch(/deliverFleetAlerts\(alerts, MAIN_AGENT_ID,/)
    expect(fnBody).not.toMatch(/sendAlert\(buildFleetAlert\(/)
  })
})
