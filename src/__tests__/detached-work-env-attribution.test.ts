// Card a6a56d3a: detached gates run OUTSIDE their agent's pane path, so the cwd attribution of
// ad730515 named nobody; and heavy-run runs every command as a launchd job (scripts/fg-exec.py),
// which the launchd exclusion dropped whole. Fixtures are the 2026-10-30 11:05 measurement on the
// live machine: a computress vitest shard in fg job com.marveen.fg.65463.*, 470 %CPU, cwd
// /Users/isti/computress-ce9b. The environments are cut to the variables that matter.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const cmd = vi.hoisted(() => ({ out: new Map<string, string>(), exit1: new Set<string>(), calls: [] as string[][] }))
vi.mock('node:child_process', () => ({
  execFileSync: (c: string, args: string[]) => {
    cmd.calls.push([c, ...args])
    const key = c === 'ps' && args.includes('-wwE') ? 'ps-env' : c
    const out = cmd.out.get(key)
    if (out === undefined) throw new Error(`no fixture for ${key}`)
    // exit status 1 with output, as ps -p and lsof -p answer when one pid is gone by now
    if (cmd.exit1.has(key)) throw Object.assign(new Error('exit 1'), { status: 1, stdout: out })
    return out
  },
}))

import {
  parsePs, busyDetachedGroups, attributeDetached, parseLaunchctlPids, agentFromConfigDir, parsePsEnvAgents,
  probeDetachedWork,
} from '../web/detached-work.js'

const FG = '/opt/homebrew/bin/python3 /Users/isti/marveen/scripts/fg-exec.py --inner 65463 /Users/isti/.heavy-run/fg/com.marveen.fg.65463.1793354646686958000'
const PS = [
  '    1     0     1   0,0 16-04:57:15 /sbin/launchd',
  '46912     1 46912   1,9    18:00:44 /opt/homebrew/opt/node@22/bin/node /Users/isti/marveen/dist/index.js',
  `65466     1 65466   1,3       01:00 ${FG}`,
  '65467 65466 65466   0,0       01:00 npm exec vitest run --shard=1/6 --maxWorkers=4',
  '65482 65467 65466  20,0       01:00 node /Users/isti/computress-ce9b/sajat-crm/frontend/node_modules/.bin/vitest',
  '68652 65482 65466 112,0       00:50 /opt/homebrew/bin/node --experimental-import-meta-resolve worker',
  '68656 65482 65466 113,0       00:50 /opt/homebrew/bin/node --experimental-import-meta-resolve worker',
].join('\n')
const LAUNCHCTL = 'PID\tStatus\tLabel\n46912\t0\tcom.marveen.dashboard\n65466\t0\tcom.marveen.fg.65463.1793354646686958000\n-\t0\tcom.x\n'
const ENV = (dir: string) => ` HEAVY_RUN_HELD=computress:65462 PWD=/Users/isti/computress-ce9b/sajat-crm/frontend CLAUDE_CONFIG_DIR=${dir}`
const COMPUTRESS = '/Users/isti/marveen/agents/computress/.claude-config'
const PS_ENV = [
  // the job's root, started by launchd: a clean environment, no agent in it
  `65466 ${FG} XPC_SERVICE_NAME=com.marveen.fg.65463.1793354646686958000 HOME=/Users/isti`,
  `65467 npm exec vitest run --shard=1/6${ENV(COMPUTRESS)}`,
  `65482 node vitest${ENV(COMPUTRESS)}`,
  `68652 node worker${ENV(COMPUTRESS)}`,
].join('\n')
const LSOF = 'p65466\nfcwd\nn/\np65482\nfcwd\nn/Users/isti/computress-ce9b/sajat-crm/frontend\n'
const PANES = new Map([
  ['computress', '/Users/Shared/marveen-computress'], ['marveen', '/Users/isti/marveen'],
  ['jarvis', '/Users/Shared/marveen-jarvis'],
])

describe('a6a56d3a: a gate outside its agent\'s pane path is still his', () => {
  beforeEach(() => {
    cmd.out = new Map([['launchctl', LAUNCHCTL], ['tmux', '1066\n'], ['ps', PS], ['/usr/sbin/lsof', LSOF], ['ps-env', PS_ENV]])
    cmd.exit1 = new Set()
    cmd.calls = []
  })

  it('the probe attributes the fg-job gate to computress, by the environment of its members', () => {
    const got = probeDetachedWork(PANES)
    expect([...got.keys()]).toEqual(['computress'])
    expect(got.get('computress')?.map((g) => g.pgid)).toEqual([65466])
    // one ps -E call, on the busy group's members only
    const envCalls = cmd.calls.filter((c) => c[0] === 'ps' && c.includes('-wwE'))
    expect(envCalls).toHaveLength(1)
    expect(envCalls[0][envCalls[0].length - 1].split(',').map(Number).sort()).toEqual([65466, 65467, 65482, 68652, 68656])
  })

  it('CONTROL (the card\'s measurement): by cwd alone the same gate is nobody\'s', () => {
    cmd.out.set('ps-env', '')
    expect(probeDetachedWork(PANES).size).toBe(0)
  })

  it('a ps -E that exits 1 (a pid gone by now) still attributes from what it printed', () => {
    cmd.exit1.add('ps-env')
    expect([...probeDetachedWork(PANES).keys()]).toEqual(['computress'])
  })

  it('the fg-exec job is no longer excluded as a launchd job; the dashboard still is', () => {
    const ex = parseLaunchctlPids(LAUNCHCTL)
    expect([...ex]).toEqual([46912])
    const groups = busyDetachedGroups(parsePs(PS), ex)
    expect(groups.map((g) => g.pgid)).toEqual([65466])
  })

  it('the environment wins over the cwd: a job of friday\'s under jarvis\'s path is friday\'s', () => {
    const groups = busyDetachedGroups(parsePs(PS), new Set())
    const g = groups.filter((x) => x.pgid === 65466)
    const cwd = new Map([[65482, '/Users/Shared/marveen-jarvis/x']])
    expect([...attributeDetached(g, cwd, PANES).keys()]).toEqual(['jarvis'])
    expect([...attributeDetached(g, cwd, PANES, new Map([[68652, 'friday']])).keys()]).toEqual(['friday'])
  })
})

describe('a6a56d3a: the environment parsers', () => {
  it('names the agent the way heavy-run.py agent_name() does', () => {
    expect(agentFromConfigDir('/Users/isti/marveen/agents/dexter/.claude-config')).toBe('dexter')
    expect(agentFromConfigDir('/Users/isti/marveen/agents/dexter/.claude-config/')).toBe('dexter')
    expect(agentFromConfigDir('/Users/isti/marveen/.channels-config', 'boss')).toBe('boss')
    expect(agentFromConfigDir('/Users/isti/.marveen-worker/.claude-config')).toBe('marveen-worker')
    expect(agentFromConfigDir('/Users/isti/.claude')).toBeNull()
    expect(agentFromConfigDir('')).toBeNull()
  })

  it('reads the LAST CLAUDE_CONFIG_DIR on a line: the environment comes after the arguments', () => {
    const line = `993 tmux new-session -d -s x export CLAUDE_CONFIG_DIR='/Users/isti/marveen/.channels-config' && claude${ENV(COMPUTRESS)}`
    expect([...parsePsEnvAgents(line)]).toEqual([[993, 'computress']])
    // only the argument names one: it is taken, unquoted (the coordinator's own tmux line)
    expect([...parsePsEnvAgents("993 tmux export CLAUDE_CONFIG_DIR='/Users/isti/marveen/.channels-config' && claude", 'boss')])
      .toEqual([[993, 'boss']])
  })

  it('a line without the variable, or a value that names nobody, maps nothing', () => {
    expect(parsePsEnvAgents(PS_ENV.split('\n')[0]).size).toBe(0)
    expect(parsePsEnvAgents('5 node x CLAUDE_CONFIG_DIR=/Users/isti/.claude HOME=/Users/isti').size).toBe(0)
    expect(parsePsEnvAgents('5 node x MY_CLAUDE_CONFIG_DIR=/Users/isti/marveen/agents/x/.claude-config').size).toBe(0)
  })
})
