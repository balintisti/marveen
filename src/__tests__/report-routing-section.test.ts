// REPORT ROUTING: the rule that ships to every agent's CLAUDE.md (card 074149c2, stage 3).
//
// With a front desk configured, reports (done, status, handoff, FYI) go to it and the coordinator
// gets only a decision, a crossed boundary, or something for the owner. The rule reaches an agent
// at its next start, as a generated section. What this file pins:
//   1. the rule's CONTENT (the coordinator's text on the card, names filled in);
//   2. the block is ALWAYS written (scripts/agent-core-check.py asks every page for every
//      generated name), but it carries the rule ONLY when the setting names a usable front desk;
//   3. turning the front desk off takes the rule OUT of a page that had it;
//   4. both start surfaces call it with the configured value.
//
// Functional part mirrors message-close-section.test.ts (temp root, mocked config).
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

const mkTmp = tmpDirs()

const tmpRoot = mkTmp('marveen-reportroute-test-')

vi.mock('../config.js', () => ({
  STORE_DIR: '/nonexistent/claudeclaw-test-store',
  PROJECT_ROOT: tmpRoot,
  OWNER_NAME: 'TestOwner',
  MAIN_AGENT_ID: 'agent-a',
  BOT_NAME: 'agent-a',
  CHANNEL_PROVIDER: 'telegram',
  WEB_PORT: 3420,
  OWNER_DRIVE_FOLDER: '',
  DASHBOARD_PUBLIC_URL: '',
  AGENT_API_ORIGIN: '',
  APP_TZ: 'Europe/Budapest',
}))

const FLEET = ['agent-a', 'agent-b', 'agent-desk']
const known = vi.hoisted(() => ({ throws: false }))

vi.mock('../web/agent-config.js', () => ({
  agentDir: (name: string) => join(tmpRoot, 'agents', name),
  agentConfigRoot: () => join(tmpRoot, 'agents'),
  listAgentNames: () => FLEET,
  readAgentCapabilities: () => [],
  isKnownAgent: (name: string) => {
    if (known.throws) throw new Error('registry unreadable')
    return FLEET.includes(name)
  },
}))

const setting = vi.hoisted(() => ({ value: '' as string | number, throws: false, keys: [] as string[] }))
vi.mock('../settings-store.js', () => ({
  getEffectiveSettingValue: (key: string) => {
    setting.keys.push(key)
    if (setting.throws) throw new Error('settings unreadable')
    return setting.value
  },
}))

vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
}))

const { ensureReportRoutingSection, buildReportRoutingBody } = await import('../web/agent-scaffold.js')
const { reportDesk, frontDeskIdProblem } = await import('../front-desk.js')
const { configuredFrontDesk } = await import('../web/front-desk-setting.js')

const BEGIN = '<!-- BEGIN GENERATED: report-routing (auto-generated, do not edit by hand) -->'
const END = '<!-- END GENERATED: report-routing -->'
const NO_RULE = 'this section adds no rule'

function setup(agent: string, content: string) {
  const dir = join(tmpRoot, 'agents', agent)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'CLAUDE.md'), content, 'utf-8')
}
const read = (agent: string) => readFileSync(join(tmpRoot, 'agents', agent, 'CLAUDE.md'), 'utf-8')
const blockOf = (text: string) => text.slice(text.indexOf(BEGIN), text.indexOf(END) + END.length)

describe('report-routing section: the rule, with a front desk', () => {
  const body = buildReportRoutingBody('agent-b', 'agent-desk')

  it('reports go to the front desk, by name, with the four kinds', () => {
    expect(body).toContain('REPORTS go to **agent-desk**: done, status, handoff, FYI.')
  })

  it('the coordinator gets ONLY the three things, each spelled out', () => {
    expect(body).toContain('**agent-a** gets ONLY:')
    expect(body).toContain('(a) a DECISION you cannot make yourself: first line starts with `DECISION:`, then the question in one line, the options, your recommendation, the evidence as ids;')
    expect(body).toContain('(b) a crossed boundary: production write, push target, secret, anything irreversible;')
    expect(body).toContain('(c) something that must reach TestOwner.')
  })

  it('a front desk that is down does not turn the coordinator back into the recipient', () => {
    expect(body).toMatch(/If agent-desk is not running[^\n]*the report goes on the card and to nobody\./)
  })

  it('no acknowledgement messages, either way', () => {
    expect(body).toContain('No acknowledgement messages in either direction.')
  })

  it('an ordinary agent is not told it is the desk or the coordinator', () => {
    expect(body).not.toContain('YOU are')
  })

  it('the front desk and the coordinator read the same rule from the other side', () => {
    const desk = buildReportRoutingBody('agent-desk', 'agent-desk')
    expect(desk).toContain('YOU are agent-desk, the front desk')
    expect(desk).not.toContain('the coordinator: this is the rule')
    expect(desk).toContain('REPORTS go to **agent-desk**')
    const coord = buildReportRoutingBody('agent-a', 'agent-desk')
    expect(coord).toContain('YOU are agent-a, the coordinator')
    expect(coord).not.toContain('the front desk: this is the rule')
    expect(coord).toContain('**agent-a** gets ONLY:')
  })

  it('house style and size: no em dash, and short (it is re-read on every turn of every agent)', () => {
    for (const who of ['agent-b', 'agent-desk', 'agent-a']) {
      const b = buildReportRoutingBody(who, 'agent-desk')
      expect(b).not.toContain('—')
      // CONTROL: the measure sees the real rule, not an empty string
      expect(b.length).toBeGreaterThan(400)
      expect(b.length, `${who}: ${b.length}`).toBeLessThanOrEqual(760)
    }
  })
})

describe('report-routing section: without a front desk it adds NO rule', () => {
  const body = buildReportRoutingBody('agent-b', null)

  it('says so in one line and names the setting', () => {
    expect(body).toContain(NO_RULE)
    expect(body).toContain('`FRONT_DESK_AGENT_ID`')
    expect(body.length).toBeLessThanOrEqual(140)
  })

  it('carries none of the rule', () => {
    for (const s of ['REPORTS go to', 'gets ONLY', 'DECISION', 'acknowledgement', 'YOU are']) {
      expect(body, s).not.toContain(s)
    }
  })
})

describe('reportDesk: which configured value names a front desk for the rule files', () => {
  const isKnown = (a: string) => FLEET.includes(a)

  it('a known agent that is not the coordinator: itself, trimmed', () => {
    expect(reportDesk('agent-a', 'agent-desk', isKnown)).toBe('agent-desk')
    expect(reportDesk('agent-a', '  agent-desk \n', isKnown)).toBe('agent-desk')
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null', null],
    ['undefined', undefined],
    ['malformed', 'agent desk'],
    ['malformed with a path', '../agent-desk'],
    ['the coordinator itself', 'agent-a'],
    ['not an agent of this fleet', 'agent-zzz'],
  ])('%s: null', (_label, value) => {
    expect(reportDesk('agent-a', value, isKnown)).toBeNull()
  })

  it('a registry that throws reads as "no front desk", it does not throw', () => {
    expect(reportDesk('agent-a', 'agent-desk', () => { throw new Error('boom') })).toBeNull()
  })

  it('the shared id test names the reason, in the router\'s own words', () => {
    expect(frontDeskIdProblem('agent-a', '')).toBe('not-configured')
    expect(frontDeskIdProblem('agent-a', 'a b')).toBe('malformed-id')
    expect(frontDeskIdProblem('agent-a', 'agent-a')).toBe('is-coordinator')
    expect(frontDeskIdProblem('agent-a', 'agent-desk')).toBeNull()
  })
})

describe('ensureReportRoutingSection: what lands in the file', () => {
  it('with a front desk: appends the rule, once, and a second run changes nothing', () => {
    setup('agent-b', '# B\n\npersona text\n')
    ensureReportRoutingSection('agent-b', 'agent-desk')
    const first = read('agent-b')
    expect(first).toContain('persona text')
    expect(blockOf(first)).toContain('REPORTS go to **agent-desk**')
    ensureReportRoutingSection('agent-b', 'agent-desk')
    expect(read('agent-b')).toBe(first)
    expect(first.split(BEGIN).length - 1).toBe(1)
  })

  it.each([
    ['empty', ''],
    ['malformed', 'agent desk'],
    ['the coordinator itself', 'agent-a'],
    ['not an agent of this fleet', 'agent-zzz'],
  ])('setting %s: the block is there (the core check asks for it) and holds no rule', (label, value) => {
    const agent = `agent-off-${label.replace(/\W+/g, '-')}`
    setup(agent, '# X\n')
    ensureReportRoutingSection(agent, value)
    const out = read(agent)
    expect(out).toContain(BEGIN)
    expect(out).toContain(END)
    expect(blockOf(out)).toContain(NO_RULE)
    expect(out).not.toContain('REPORTS go to')
  })

  it('turning the front desk OFF takes the rule out of a page that had it, and keeps the rest', () => {
    setup('agent-c', '# C\n\nbefore\n')
    ensureReportRoutingSection('agent-c', 'agent-desk')
    writeFileSync(join(tmpRoot, 'agents', 'agent-c', 'CLAUDE.md'), read('agent-c') + '\ntail\n', 'utf-8')
    expect(read('agent-c')).toContain('REPORTS go to **agent-desk**')
    ensureReportRoutingSection('agent-c', '')
    const out = read('agent-c')
    expect(out).not.toContain('REPORTS go to')
    expect(out).not.toContain('gets ONLY')
    expect(blockOf(out)).toContain(NO_RULE)
    expect(out).toContain('before')
    expect(out).toContain('tail')
    expect(out.split(BEGIN).length - 1).toBe(1)
  })

  it('turning it ON replaces the no-rule line, and a changed desk replaces the name', () => {
    setup('agent-d', '# D\n')
    ensureReportRoutingSection('agent-d', '')
    ensureReportRoutingSection('agent-d', 'agent-desk')
    expect(blockOf(read('agent-d'))).not.toContain(NO_RULE)
    expect(read('agent-d')).toContain('REPORTS go to **agent-desk**')
    ensureReportRoutingSection('agent-d', 'agent-b')
    expect(read('agent-d')).toContain('REPORTS go to **agent-b**')
    expect(read('agent-d')).not.toContain('agent-desk')
    expect(read('agent-d').split(BEGIN).length - 1).toBe(1)
  })

  it('an unreadable agent registry writes the no-rule form, it does not stop the start', () => {
    setup('agent-e', '# E\n')
    known.throws = true
    try {
      expect(() => ensureReportRoutingSection('agent-e', 'agent-desk')).not.toThrow()
    } finally {
      known.throws = false
    }
    expect(blockOf(read('agent-e'))).toContain(NO_RULE)
  })

  it('the front desk\'s own page and the coordinator\'s page (at PROJECT_ROOT) get their variant', () => {
    setup('agent-desk', '# Desk\n')
    ensureReportRoutingSection('agent-desk', 'agent-desk')
    expect(read('agent-desk')).toContain('YOU are agent-desk, the front desk')
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), '# Main\n', 'utf-8')
    ensureReportRoutingSection('agent-a', 'agent-desk')
    const main = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf-8')
    expect(main).toContain(BEGIN)
    expect(main).toContain('YOU are agent-a, the coordinator')
  })

  it('no CLAUDE.md: nothing is created', () => {
    mkdirSync(join(tmpRoot, 'agents', 'agent-nofile'), { recursive: true })
    ensureReportRoutingSection('agent-nofile', 'agent-desk')
    expect(() => read('agent-nofile')).toThrow()
  })
})

describe('report-routing section: wired to BOTH surfaces, with the configured value', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const live = (rel: string) => readFileSync(join(here, '..', rel), 'utf-8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')

  it('web.ts ensures it for the main agent at boot', () => {
    expect(live('web.ts')).toMatch(/^\s*ensureReportRoutingSection\(MAIN_AGENT_ID, configuredFrontDesk\(\)\)/m)
  })

  it('agent-process.ts ensures it for every agent start', () => {
    expect(live('web/agent-process.ts')).toMatch(/^\s*ensureReportRoutingSection\(name, configuredFrontDesk\(\)\)/m)
  })

  it('the value both pass is the FRONT_DESK_AGENT_ID setting as written; an unreadable setting reads as empty', () => {
    setting.keys.length = 0
    setting.value = 'agent-desk'
    expect(configuredFrontDesk()).toBe('agent-desk')
    expect(setting.keys).toEqual(['FRONT_DESK_AGENT_ID'])
    setting.throws = true
    try {
      expect(configuredFrontDesk()).toBe('')
    } finally {
      setting.throws = false
    }
  })
})
