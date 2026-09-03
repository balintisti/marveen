import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const SRC = readFileSync(join(ROOT, 'src', 'web', 'idle-agent-watcher.ts'), 'utf-8')

/**
 * The guard raises four kinds of alert and only ONE of them is a fleet event the
 * owner can act on. The other three report on the guard ITSELF: a pane it could
 * not read, a missing work-check, a wake it could not enqueue.
 *
 * Measured 2026-09-03: four alerts reached the owner's phone, THREE of them
 * 'pane-unreadable' -- and all three panes read fine when checked seconds later.
 * The one true row arrived buried among the guard's own instrument failures.
 *
 * These assertions pin the MEANING, not the wording: the owner path must carry a
 * FILTERED set, the coordinator path must exist, and the bare form -- every kind
 * to the owner -- must not come back under a later tidy-up.
 */
describe('idle guard: alerts are split by audience, not broadcast', () => {
  // Window: from the tick() declaration to its own column-0 closing brace.
  // Anchored on the function, not on any string this test is looking for.
  const start = SRC.indexOf('export function tick(): void {')
  const fnBody = SRC.slice(start, SRC.indexOf('\n}', start))

  it('tick() exists and separates owner-facing from coordinator-facing alerts', () => {
    expect(start).toBeGreaterThanOrEqual(0)
    expect(fnBody).toMatch(/ownerFacing\s*=\s*alerts\.filter/)
    expect(fnBody).toMatch(/coordinatorFacing\s*=\s*alerts\.filter/)
  })

  it("only 'still-idle' reaches the owner", () => {
    // The owner filter must name the one actionable kind. If a future edit adds a
    // second kind here it should be a deliberate change to this line, not a silent
    // widening of what lands on a phone.
    expect(fnBody).toMatch(/ownerFacing\s*=\s*alerts\.filter\(\(a\) => a\.kind === 'still-idle'\)/)
  })

  it('sendAlert receives the FILTERED set, never the whole sweep', () => {
    // This is the mutation that matters: reverting to sendAlert(buildFleetAlert(alerts))
    // restores the exact defect -- three instrument failures per true row.
    expect(fnBody).toMatch(/sendAlert\(buildFleetAlert\(ownerFacing\)\)/)
    expect(fnBody).not.toMatch(/sendAlert\(buildFleetAlert\(alerts\)\)/)
  })

  it('the coordinator is told about the guard\'s own failures', () => {
    expect(fnBody).toMatch(/createAgentMessage\('system',\s*MAIN_AGENT_ID,\s*buildFleetAlert\(coordinatorFacing\)\)/)
  })

  it('a coordinator alert that cannot be enqueued falls back rather than vanishing', () => {
    // Dropping it would be the same silent-loss shape this routing change removes.
    const coordIdx = fnBody.indexOf('coordinatorFacing.length > 0')
    const tail = fnBody.slice(coordIdx)
    expect(tail).toMatch(/catch/)
    expect(tail).toMatch(/sendAlert\(buildFleetAlert\(coordinatorFacing\)\)/)
  })

  it('all four kinds still exist -- nothing was silenced, only routed', () => {
    expect(SRC).toMatch(/still-idle/)
    // The other three are raised in this file and consumed by buildFleetAlert.
    expect(SRC).toMatch(/pane-unreadable|no-work-check|wake-enqueue-failed/)
  })
})
