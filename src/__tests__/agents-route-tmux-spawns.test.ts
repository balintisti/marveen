// Counts the REAL tmux invocations of the agents read paths (agent-process is not mocked).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { PROJECT_ROOT } from '../config.js'
import { MAIN_CHANNELS_SESSION } from '../web/main-agent.js'
import type { RouteContext } from '../web/routes/types.js'

const SEP = '─'.repeat(80)
const IDLE_PLAIN = ['', SEP, '❯ ', SEP, '  ⏵⏵ bypass permissions on · ↓ to manage'].join('\n')

const SESSIONS = [MAIN_CHANNELS_SESSION, 'agent-alpha', 'agent-beta', 'agent-gamma']
const calls: string[][] = []

function fake(file: string, args: string[]): string {
  calls.push([file, ...args])
  if (args.includes('list-sessions')) return SESSIONS.join('\n') + '\n'
  if (args.includes('capture-pane')) return IDLE_PLAIN
  return ''
}

const mkTmp = tmpDirs()
const SANDBOX = mkTmp('tmuxspawns-')
for (const n of ['alpha', 'beta', 'gamma']) mkdirSync(join(SANDBOX, 'agents', n), { recursive: true })

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFileSync: (file: string, args: string[]) => fake(file, args) }
})

vi.mock('../web/agent-config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../web/agent-config.js')>()
  return {
    ...actual,
    listAgentNames: () => ['alpha', 'beta', 'gamma'],
    readAgentRemoteHost: () => null,
    readAgentRunAsUser: () => null,
    agentDir: (name: string) => join(SANDBOX, 'agents', name),
  }
})

// The status route reads its kanban, message and tool rows from the database; no
// rows is enough here, only the tmux calls are counted.
vi.mock('../db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db.js')>()
  return {
    ...actual,
    getAgentCurrentCards: () => ({}),
    getAgentMessageActivity: () => ({}),
    getAgentToolActivity: () => ({}),
  }
})

const { tryHandleAgents, listAgentSummaries, resetAgentsActivityCacheForTests } = await import('../web/routes/agents.js')

async function get(path: string): Promise<unknown> {
  let raw = ''
  const res = {
    writeHead() { return res },
    end(chunk?: string | Buffer) { if (chunk) raw = String(chunk) },
  }
  const url = new URL(`http://localhost:3420${path}`)
  const ctx = { req: { headers: {} } as RouteContext['req'], res, path: url.pathname, method: 'GET', url } as unknown as RouteContext
  const handled = await tryHandleAgents(ctx, join(PROJECT_ROOT, 'web'))
  expect(handled).toBe(true)
  return JSON.parse(raw)
}

const count = (sub: string) => calls.filter(c => c.includes(sub)).length

beforeEach(() => {
  calls.length = 0
  resetAgentsActivityCacheForTests()
})

describe('tmux spawns of the agents read paths', () => {
  it('S1 activity: one list-sessions, four capture-panes', async () => {
    const body = (await get('/api/agents/activity')) as { running: boolean }[]
    expect(count('list-sessions')).toBe(1)
    expect(count('capture-pane')).toBe(4)
    expect(body.filter(e => e.running === true)).toHaveLength(4)
  })

  it('S2 status: one list-sessions', async () => {
    await get('/api/agents/status')
    expect(count('list-sessions')).toBe(1)
  })

  it('S3 listAgentSummaries lists exactly once', () => {
    const rows = listAgentSummaries()
    expect(count('list-sessions')).toBe(1)
    expect(rows.map(r => r.name)).toEqual(expect.arrayContaining(['alpha', 'beta', 'gamma']))
  })

  it('S4 a second activity request is served from the cache', async () => {
    await get('/api/agents/activity')
    await get('/api/agents/activity')
    expect(count('capture-pane')).toBe(4)
  })
})
