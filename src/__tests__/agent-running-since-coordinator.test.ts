// getAgentRunningSince asked tmux about `agent-<name>` for EVERYONE, and the coordinator runs in
// `<id>-channels` -- so it returned null for him, and a session-start guard built on it (card
// 6f362eb3) would have been blind exactly for the coordinator. It now uses the one resolver.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const exec = vi.fn()
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: (...a: unknown[]) => exec(...a),
}))

const { getAgentRunningSince } = await import('../web/agent-process.js')
const { MAIN_AGENT_ID } = await import('../config.js')

const target = () => {
  const args = exec.mock.calls.at(-1)?.[1] as string[]
  return args[args.indexOf('-t') + 1]
}

describe('getAgentRunningSince asks tmux about the session the agent really runs in', () => {
  beforeEach(() => { exec.mockReset(); exec.mockReturnValue('1790000000\n') })

  it('the coordinator: <id>-channels, and the value comes back', () => {
    expect(getAgentRunningSince(MAIN_AGENT_ID)).toBe(1790000000)
    expect(target()).toBe(`${MAIN_AGENT_ID}-channels`)
  })

  it('a sub-agent: agent-<name>, unchanged', () => {
    expect(getAgentRunningSince('nobody-6f362eb3')).toBe(1790000000)
    expect(target()).toBe('agent-nobody-6f362eb3')
  })

  it('tmux failing -> null, not a throw', () => {
    exec.mockImplementation(() => { throw new Error("can't find session") })
    expect(getAgentRunningSince(MAIN_AGENT_ID)).toBeNull()
  })
})
