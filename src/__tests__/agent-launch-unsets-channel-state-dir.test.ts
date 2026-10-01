// CHANSTATEUNSET930 (upstream 8d10968a, ported for card ff285a86): the agent launch
// strips every channel STATE DIR variable, not only the bot tokens, BEFORE a channel
// agent re-exports its own. The tmux server carries the main agent's
// TELEGRAM_STATE_DIR, so without the unset a channel-less agent's processes look,
// to channel-poller-reap's env scan, exactly like the main agent's orphaned pollers.
//
// Source-level contract, in the style of agent-oauth-token-file.test.ts: the set of
// variables must be the reaper's set, and the order (unset, then channelSetup) is
// what lets a channel agent keep its own dir.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(__dirname, '../web/agent-process.ts'), 'utf-8')
const REAP = readFileSync(join(__dirname, '../web/channel-poller-reap.ts'), 'utf-8')

function unsetList(): string[] {
  const m = SRC.match(/const unsetTokens = 'unset ([^']+)'/)
  if (!m) throw new Error('unsetTokens not found in agent-process.ts')
  return m[1].split(/\s+/)
}

function reaperStateVars(): string[] {
  const block = REAP.slice(REAP.indexOf('const STATE_ENV_VAR'), REAP.indexOf('}', REAP.indexOf('const STATE_ENV_VAR')))
  const vars = [...block.matchAll(/'([A-Z_]+_STATE_DIR)'/g)].map((m) => m[1])
  if (vars.length === 0) throw new Error('STATE_ENV_VAR not found in channel-poller-reap.ts')
  return vars
}

describe('agent launch unsets the channel state dirs (CHANSTATEUNSET930)', () => {
  it('every state-dir variable the reaper scans for is unset at launch', () => {
    const unset = unsetList()
    const missing = reaperStateVars().filter((v) => !unset.includes(v))
    expect(missing).toEqual([])
  })

  it('the bot tokens are still unset too', () => {
    expect(unsetList()).toEqual(expect.arrayContaining(['TELEGRAM_BOT_TOKEN', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'DISCORD_BOT_TOKEN']))
  })

  it('the unset runs BEFORE channelSetup, so a channel agent re-exports its own dir', () => {
    const cmd = SRC.slice(SRC.indexOf('const buildLaunchCmd ='))
    const line = cmd.slice(0, cmd.indexOf('\n'))
    const u = line.indexOf('${unsetTokens}')
    const c = line.indexOf('${channelSetup}')
    expect(u).toBeGreaterThan(-1)
    expect(c).toBeGreaterThan(u)
  })
})
