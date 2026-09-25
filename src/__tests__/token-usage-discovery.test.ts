// Card 50eee909 (mandark measured it and wrote the spec): token-usage discovery keyed on the
// `-agents-<name>$` dir-name suffix, but since 2026-09-18 agents/<name> is a SYMLINK and Claude
// Code keys a project by the RESOLVED cwd -- so every live transcript lands in
// `-Users-Shared-marveen-<name>` and the collector wrote nothing for seven agents.
//
// What this pins, on a fixture with a real symlink (no mocked realpath):
//   - a symlinked agent's transcripts are found under the RESOLVED-path key;
//   - the legacy `-agents-<name>` dir stays attributed as a second key (old transcripts);
//   - both keys attribute to the SAME agent name;
//   - an agent whose dir is not a symlink is listed once, not twice;
//   - CONTROL: the old suffix rule alone would miss the resolved dir (the defect, on the fixture).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdirSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Removed when this file finishes (card 66756e73): every temp dir in a test goes through here.
const mkTmp = tmpDirs()

vi.mock('../logger.js', () => ({ logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} } }))

let root: string
let agentsBase: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return {
    ...actual,
    agentDir: (name: string) => join(agentsBase, name),
    listAllAgentNames: () => ['linked', 'plain'],
  }
})

const { discoverAgentSources } = await import('../web/token-usage.js')

const enc = (p: string) => realpathSync(p).replace(/[/.]/g, '-')
let projects: string

beforeAll(() => {
  root = mkTmp('tokdisc-')
  agentsBase = join(root, 'agents')
  mkdirSync(agentsBase)
  // 'linked': agents/linked -> Shared/marveen-linked, like the live fleet since 09-18
  const shared = join(root, 'Shared', 'marveen-linked')
  mkdirSync(shared, { recursive: true })
  symlinkSync(shared, join(agentsBase, 'linked'))
  // 'plain': a real directory, no symlink
  mkdirSync(join(agentsBase, 'plain'))
  projects = join(root, 'home', '.claude', 'projects')
  mkdirSync(projects, { recursive: true })
  mkdirSync(join(projects, enc(shared)))                                        // the live key
  mkdirSync(join(projects, `${join(agentsBase, 'linked').replace(/[^a-zA-Z0-9-]/g, '-')}`)) // legacy -agents-linked
  mkdirSync(join(projects, enc(join(agentsBase, 'plain'))))                     // plain agent, one dir
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const dirsOf = (agent: string) =>
  discoverAgentSources(projects).filter((s) => s.agent === agent).map((s) => s.projectDir.split('/').pop())

describe('token-usage discovery follows the agent, not the dir name', () => {
  it('a symlinked agent is found under the RESOLVED-path key', () => {
    expect(dirsOf('linked')).toContain(enc(join(root, 'Shared', 'marveen-linked')))
  })
  it('the legacy -agents-<name> dir stays attributed to the same agent (second key)', () => {
    const d = dirsOf('linked')
    expect(d.some((x) => x!.endsWith('-agents-linked'))).toBe(true)
    expect(d).toHaveLength(2)
  })
  it('a non-symlinked agent is listed once, not twice', () => {
    expect(dirsOf('plain')).toHaveLength(1)
  })
  it('CONTROL: the resolved dir does NOT end in -agents-<name>, so the old suffix rule alone misses it', () => {
    expect(enc(join(root, 'Shared', 'marveen-linked'))).not.toMatch(/-agents-linked$/)
  })
  it('a missing projects dir yields nothing rather than throwing', () => {
    expect(discoverAgentSources(join(root, 'nope'))).toEqual([])
  })
})
