import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_AGENT_ID } from '../config.js'

// Card 228c9252. `agentRunState()` asked tmux for `agent-<name>` for EVERY
// agent, and the main agent does not run under that name -- it runs in
// `<id>-channels`, managed by launchd. So the coordinator read as 'stopped'
// always, and the sender preflight built on it told people, in writing, that
// their message would never be delivered and that they should stop sending.
// Measured 2026-08-23 (didi, confirmed by jarvis): every message it declared
// undeliverable was delivered within three minutes.
//
// This is a BEHAVIOUR test, not a source-reading one: it puts a fake `tmux` on
// PATH and calls the real agentRunState. A source assertion ("the call site
// mentions the resolver") would pass on a resolver that returns the wrong name.
//
// The tmux stub prints whatever session list the current test wrote to a file,
// so one resolved binary serves every case (the bin resolver caches the PATH
// lookup, not the output).
const stubDir = mkdtempSync(join(tmpdir(), 'tmux-stub-'))
const sessionsFile = join(stubDir, 'sessions.txt')
writeFileSync(join(stubDir, 'tmux'), `#!/bin/sh\ncat ${sessionsFile}\n`, { mode: 0o755 })
process.env.TMUX_STUB_SESSIONS = sessionsFile
process.env.PATH = `${stubDir}:${process.env.PATH ?? ''}`

const { agentRunState, agentSessionName, sessionNameForAgent } = await import('../web/agent-process.js')

function tmuxLists(...sessions: string[]): void {
  writeFileSync(sessionsFile, sessions.length ? sessions.join('\n') + '\n' : '')
}

beforeAll(() => tmuxLists())
afterAll(() => rmSync(stubDir, { recursive: true, force: true }))

describe('sessionNameForAgent -- one resolver for both session shapes', () => {
  it('resolves the main agent to its channels session', () => {
    expect(sessionNameForAgent(MAIN_AGENT_ID)).toBe(`${MAIN_AGENT_ID}-channels`)
  })

  // NEGATIVE CONTROL for the resolver: it must not answer "channels" for
  // everyone. A resolver that always returned MAIN_CHANNELS_SESSION would pass
  // the test above and break every sub-agent.
  it('leaves sub-agents on the agent-<name> template', () => {
    expect(sessionNameForAgent('dexter')).toBe('agent-dexter')
    expect(sessionNameForAgent('dexter')).toBe(agentSessionName('dexter'))
  })
})

describe('agentRunState sees the main agent (card 228c9252)', () => {
  it('reports running when ONLY the channels session exists', () => {
    // This is exactly the live shape: `marveen-channels` exists, `agent-marveen`
    // never has. Pre-fix this returned 'stopped'.
    tmuxLists('agent-dexter', `${MAIN_AGENT_ID}-channels`)
    expect(agentRunState(MAIN_AGENT_ID)).toBe('running')
  })

  // THE OTHER DIRECTION. Without this, a resolver hardcoded to 'running' for the
  // main agent -- or one that ignores tmux entirely -- would still pass above.
  it('reports stopped when the channels session is gone', () => {
    tmuxLists('agent-dexter', 'agent-didi')
    expect(agentRunState(MAIN_AGENT_ID)).toBe('stopped')
  })

  // And the sub-agent path must keep answering the question it always did:
  // the fix is additive, not a redirect of everyone to the channels session.
  it('still classifies sub-agents by their own session', () => {
    tmuxLists('agent-dexter', `${MAIN_AGENT_ID}-channels`)
    expect(agentRunState('dexter')).toBe('running')
    expect(agentRunState('didi')).toBe('stopped')
  })

  // The name the main agent does NOT use. If some future edit re-derives the
  // main session as `agent-<id>`, this goes red while the test above stays green
  // -- the two together pin the direction, which is what the 2026-08-23 defect
  // needed and did not have.
  it('does not accept the sub-agent template for the main agent', () => {
    tmuxLists(`agent-${MAIN_AGENT_ID}`)
    expect(agentRunState(MAIN_AGENT_ID)).toBe('stopped')
  })
})
