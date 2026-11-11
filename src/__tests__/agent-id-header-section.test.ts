import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

// b62414d0 (port of a30553d6d): the X-Agent-Id section tells every agent to
// send its name on memory writes. Same idempotency pin as the other generated
// sections, plus the one sentence that must not regress: a DELETE is final,
// so the section may not promise that a delete is recoverable from /versions.

const tmpRoot = mkTmp('marveen-agentid-test-')

vi.mock('../config.js', () => ({
  STORE_DIR: '/nonexistent/claudeclaw-test-store',
  PROJECT_ROOT: tmpRoot,
  OWNER_NAME: 'TestOwner',
  MAIN_AGENT_ID: 'main-agent',
  BOT_NAME: 'main-agent',
  CHANNEL_PROVIDER: 'telegram',
  WEB_PORT: 3420,
  OWNER_DRIVE_FOLDER: '',
  DASHBOARD_PUBLIC_URL: '',
  AGENT_API_ORIGIN: '',
}))

vi.mock('../web/agent-config.js', () => ({
  agentDir: (name: string) => join(tmpRoot, 'agents', name),
  agentConfigRoot: () => join(tmpRoot, 'agents'),
  listAgentNames: () => ['agent-a'],
  readAgentCapabilities: () => [],
}))

vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
}))

const { ensureAgentIdHeaderSection } = await import('../web/agent-scaffold.js')

const BEGIN = '<!-- BEGIN GENERATED: agent-id-header (auto-generated, do not edit by hand) -->'
const END = '<!-- END GENERATED: agent-id-header -->'

function setup(agentName: string, content: string) {
  const dir = join(tmpRoot, 'agents', agentName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'CLAUDE.md'), content, 'utf-8')
}
const read = (agentName: string) => readFileSync(join(tmpRoot, 'agents', agentName, 'CLAUDE.md'), 'utf-8')
const count = (s: string, sub: string) => s.split(sub).length - 1

describe('ensureAgentIdHeaderSection', () => {
  it('appends one block naming the agent in the X-Agent-Id header', () => {
    setup('agent-a', '# agent-a\n\nexisting text\n')
    ensureAgentIdHeaderSection('agent-a')
    const out = read('agent-a')
    expect(out.startsWith('# agent-a\n\nexisting text\n')).toBe(true)
    expect(count(out, BEGIN)).toBe(1)
    expect(count(out, END)).toBe(1)
    expect(out).toContain('-H "X-Agent-Id: agent-a"')
  })

  it('is idempotent: a second run changes nothing', () => {
    setup('agent-b', '# agent-b\n')
    ensureAgentIdHeaderSection('agent-b')
    const once = read('agent-b')
    ensureAgentIdHeaderSection('agent-b')
    expect(read('agent-b')).toBe(once)
  })

  it('replaces a stale block in place instead of adding a second one', () => {
    setup('agent-c', `# agent-c\n\n${BEGIN}\nold body\n${END}\n\n## after\n`)
    ensureAgentIdHeaderSection('agent-c')
    const out = read('agent-c')
    expect(count(out, BEGIN)).toBe(1)
    expect(out).not.toContain('old body')
    expect(out.trimEnd().endsWith('## after')).toBe(true)
  })

  it('says a delete is final, and does not promise a pre-image for it', () => {
    setup('agent-d', '# agent-d\n')
    ensureAgentIdHeaderSection('agent-d')
    const out = read('agent-d')
    expect(out).toContain('A TÖRLÉS viszont VÉGLEGES')
    expect(out).not.toMatch(/felülírás és törlés előtt eltárolódik/)
  })

  it('does nothing when the agent has no CLAUDE.md', () => {
    expect(() => ensureAgentIdHeaderSection('no-such-agent')).not.toThrow()
  })
})
