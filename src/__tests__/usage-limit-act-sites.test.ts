// THE TWO ACT-DECISIONS SEE THE REACHED USAGE LIMIT (card d3f92923) -- the WIRING, one test per site.
//
// The decision halves are pinned where they live (idle-agent.test.ts, context-guard.test.ts) with
// the flag handed in by hand. What neither of them can see is the line between: that the watcher's
// readPane and the context-guard runner actually COMPUTE the flag from the pane they already
// captured. Two protected ends and an unprotected wire is the shape b5bff340 was (see
// idle-agent-watcher-stalecounter.test.ts), so the wire gets its own test here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './helpers/strip-comments.js'

const capturePane = vi.fn()
const detectPaneState = vi.fn()
const reached = vi.fn()

vi.mock('../web/agent-process.js', () => ({
  capturePane: (...a: unknown[]) => capturePane(...a),
  isAgentRunning: () => true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: () => 'agent-x' }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'], agentDir: () => '/tmp/x', readAgentRemoteHost: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: (...a: unknown[]) => detectPaneState(...a),
  busyEvidence: () => 'none',
  detectsUsageLimitReached: (...a: unknown[]) => reached(...a),
}))

const { readPane } = await import('../web/idle-agent-watcher.js')

describe('idle-agent-watcher readPane -> usageLimited', () => {
  beforeEach(() => {
    capturePane.mockReset(); detectPaneState.mockReset(); reached.mockReset()
    capturePane.mockReturnValue('THE-CAPTURED-PANE')
    detectPaneState.mockReturnValue('idle')
  })

  it('follows the predicate, both ways -- and reads the SAME capture as the idle verdict', () => {
    reached.mockReturnValue(true)
    expect(readPane('x')).toMatchObject({ idle: true, usageLimited: true })
    expect(reached).toHaveBeenCalledWith('THE-CAPTURED-PANE')
    reached.mockReturnValue(false)
    expect(readPane('x')).toMatchObject({ idle: true, usageLimited: false })
  })

  it('the decision call hands it on as paneUsageLimited (source pin, comments stripped)', () => {
    const src = stripComments(readFileSync(join(__dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf-8'))
    expect(src).toContain('paneUsageLimited: running ? paneRead.usageLimited === true : false')
  })
})

describe('context-guard-runner -> paneUsageLimited', () => {
  it('computed from the same capture as paneIdle, with the HARD predicate (source pin)', () => {
    const src = stripComments(readFileSync(join(__dirname, '..', 'web', 'context-guard-runner.ts'), 'utf-8'))
    expect(src).toContain('paneUsageLimited: pane !== null && detectsUsageLimitReached(pane)')
    // not the wide one: the weekly WARNING must not defer a flush for days
    expect(src).not.toMatch(/paneUsageLimited:[^\n]*detectsUsageLimit\(/)
  })
})
