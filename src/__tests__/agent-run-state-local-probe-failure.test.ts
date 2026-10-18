import { describe, expect, it, afterAll } from 'vitest'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// Card 0bce45f9. For a LOCAL agent every failed `tmux list-sessions` probe used
// to read as 'stopped', whatever the failure was. "tmux answered: no server"
// (exit 1) and "we could not ask" (the 3 s budget ran out, ENOENT, a signal)
// were the same word, and that word made the message route tell the sender in
// writing that the message would not be delivered.
//
// BEHAVIOUR test through the real agentRunState: a fake `tmux` on PATH acts out
// the case the current test wrote to a file. The bin resolver caches the PATH
// lookup, not the behaviour, so one stub serves every case.
const stubDir = mkTmp('tmux-probe-fail-')
const modeFile = join(stubDir, 'mode.txt')
writeFileSync(join(stubDir, 'tmux'), [
  '#!/bin/sh',
  `mode=$(cat ${modeFile})`,
  'case "$mode" in',
  '  noserver) echo "no server running on /tmp/tmux-501/default" >&2; exit 1 ;;',
  '  killed) kill -9 $$ ;;',
  '  list) echo agent-dexter ;;',
  'esac',
].join('\n') + '\n', { mode: 0o755 })
process.env.PATH = `${stubDir}:${process.env.PATH ?? ''}`

const { agentRunState, isAgentRunning } = await import('../web/agent-process.js')

function tmuxDoes(mode: 'noserver' | 'killed' | 'list'): void {
  writeFileSync(modeFile, mode)
}

afterAll(() => rmSync(stubDir, { recursive: true, force: true }))

describe('agentRunState: a local probe that never finished is not "stopped" (card 0bce45f9)', () => {
  it('POSITIVE CONTROL: the stub is the tmux being asked (a listed session reads running)', () => {
    tmuxDoes('list')
    expect(agentRunState('dexter')).toBe('running')
  })

  it('tmux answered "no server" (exit 1): stopped', () => {
    tmuxDoes('noserver')
    expect(agentRunState('dexter')).toBe('stopped')
  })

  it('the probe died without an exit status (signal, same class as ETIMEDOUT/ENOENT): unreachable', () => {
    tmuxDoes('killed')
    expect(agentRunState('dexter')).toBe('unreachable')
  })

  it('isAgentRunning stays false for an unreachable local agent (its ~40 callers see no change)', () => {
    tmuxDoes('killed')
    expect(isAgentRunning('dexter')).toBe(false)
  })
})
