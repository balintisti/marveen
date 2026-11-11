// A FRONT_DESK_AGENT_ID write rewrites the rule files at once (card 074149c2 follow-up,
// coordinator's comment 57647 item 2).
//
// Before: an agent's sheet was rewritten at that agent's start, the coordinator's only at
// dashboard boot, so after the setting changed the sheets on disk named the old front desk until
// each of them happened to restart. What this file pins:
//   1. the refresh writes BOTH desk-dependent sections (report-routing, autonomy Level 3) on the
//      coordinator's sheet and on every agent's sheet, hidden agents included;
//   2. it reads the value AFTER the write (the sheets carry the NEW front desk);
//   3. a WEB_ONLY instance rewrites nothing; a sheet that cannot be written is NAMED and does not
//      stop the others; nothing here throws;
//   4. the settings route runs it for this key only, after a successful write only, and the
//      answer carries the outcome;
//   5. the rewrite goes under the sheet editors' lock (coordinator's decision 58301 item C): an
//      editor that holds a sheet while the setting is written loses nothing, and neither do we.
//
// The files are real (temp root) and so is the write step (web/sheet-lock.ts, the script under
// python3); the setting store, the registry listing and the route's two side channels (change
// log, store-write actor) are the mocked edges. A sheet that "cannot be written" is a real
// read-only file.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { writeFileSync, readFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { holdSheet } from './helpers/sheet-holder.js'
import type { RouteContext } from '../web/routes/types.js'

const mkTmp = tmpDirs()
const tmpRoot = mkTmp('marveen-desk-sheets-test-')

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

// 'agent-hidden' is in the full listing only: a hidden agent starts through the same path.
const h = vi.hoisted(() => ({
  all: ['agent-b', 'agent-desk', 'agent-hidden'],
  listThrows: false,
  value: '' as unknown,
  setOk: true,
  log: [] as unknown[][],
}))

vi.mock('../web/agent-config.js', () => ({
  agentDir: (name: string) => join(tmpRoot, 'agents', name),
  agentConfigRoot: () => join(tmpRoot, 'agents'),
  listAgentNames: () => h.all.filter((n) => n !== 'agent-hidden'),
  listAllAgentNames: () => {
    if (h.listThrows) throw new Error('agents dir unreadable')
    return h.all
  },
  readAgentCapabilities: () => [],
  isKnownAgent: (name: string) => name === 'agent-a' || h.all.includes(name),
}))

vi.mock('../settings-store.js', () => ({
  getEffectiveSettingValue: (key: string) => (key === 'FRONT_DESK_AGENT_ID' ? h.value : 'off'),
  setOverride: (key: string, value: unknown) => {
    if (!h.setOk) return { ok: false, error: 'a lemez megtelt' }
    if (key === 'FRONT_DESK_AGENT_ID') h.value = String(value)
    return { ok: true }
  },
}))

vi.mock('../db.js', () => ({ logConfigChange: (...a: unknown[]) => { h.log.push(a) } }))
vi.mock('../store-watcher.js', () => ({ setStoreWriteActor: () => { /* not under test */ } }))

const { refreshFrontDeskSheets } = await import('../web/front-desk-sheets.js')
const { ensureAutonomySection, ensureReportRoutingSection } = await import('../web/agent-scaffold.js')
const { tryHandleSettings } = await import('../web/routes/settings.js')

const PAGES = ['agent-a', 'agent-b', 'agent-desk', 'agent-hidden']
const pagePath = (agent: string) => (agent === 'agent-a' ? join(tmpRoot, 'CLAUDE.md') : join(tmpRoot, 'agents', agent, 'CLAUDE.md'))
const read = (agent: string) => readFileSync(pagePath(agent), 'utf-8')
const level3 = (agent: string) => read(agent).split('\n').filter((l) => l.startsWith('**Level 3'))
const OLD_L3 = '**Level 3 (autonóm)**: elvégzed, majd utána jelented a főágensnek.'
const L3 = (desk: string) => `**Level 3 (autonóm)**: elvégzed, majd utána jelented a front desknek (${desk}).`
const NO_RULE = 'this section adds no rule'

beforeEach(() => {
  h.value = ''; h.listThrows = false; h.setOk = true; h.log.length = 0
  delete process.env['WEB_ONLY']
  for (const a of PAGES) {
    if (a !== 'agent-a') mkdirSync(join(tmpRoot, 'agents', a), { recursive: true })
    // A test may have left its sheet read-only.
    if (existsSync(pagePath(a))) chmodSync(pagePath(a), 0o644)
    writeFileSync(pagePath(a), `# ${a}\n\npersona\n`, 'utf-8')
  }
})
afterEach(() => { delete process.env['WEB_ONLY'] })

describe('refreshFrontDeskSheets', () => {
  it('writes both sections on the coordinator\'s sheet and on every agent\'s sheet, hidden ones too', () => {
    h.value = 'agent-desk'
    expect(refreshFrontDeskSheets()).toEqual({ pages: PAGES, failed: [] })
    for (const a of PAGES) {
      expect(read(a)).toContain('persona')
      expect(read(a)).toContain('REPORTS go to **agent-desk**')
    }
    expect(level3('agent-b')).toEqual([L3('agent-desk')])
    expect(level3('agent-hidden')).toEqual([L3('agent-desk')])
    // The two the rule is about read it from the other side.
    expect(level3('agent-desk')).toEqual([OLD_L3])
    expect(level3('agent-a')).toEqual([OLD_L3])
    expect(read('agent-a')).toContain('YOU are agent-a, the coordinator')
  })

  it('the setting moves: every sheet follows, to another front desk and back to none', () => {
    h.value = 'agent-desk'
    refreshFrontDeskSheets()
    h.value = 'agent-b'
    refreshFrontDeskSheets()
    for (const a of PAGES) {
      expect(read(a)).toContain('REPORTS go to **agent-b**')
      expect(read(a)).not.toContain('agent-desk**')
    }
    expect(level3('agent-desk')).toEqual([L3('agent-b')])
    expect(level3('agent-b')).toEqual([OLD_L3])
    h.value = ''
    refreshFrontDeskSheets()
    for (const a of PAGES) {
      expect(read(a)).toContain(NO_RULE)
      expect(read(a)).not.toContain('REPORTS go to')
      expect(level3(a)).toEqual([OLD_L3])
      expect(read(a).split('BEGIN GENERATED: report-routing').length - 1).toBe(1)
      expect(read(a).split('BEGIN GENERATED: autonomy-wiring').length - 1).toBe(1)
    }
  })

  it('a WEB_ONLY instance rewrites nothing and says so', () => {
    h.value = 'agent-desk'
    process.env['WEB_ONLY'] = 'true'
    const before = PAGES.map(read)
    expect(refreshFrontDeskSheets()).toEqual({ skipped: 'web-only' })
    expect(PAGES.map(read)).toEqual(before)
  })

  it('a sheet that cannot be written is NAMED, and the others are still written', () => {
    h.value = 'agent-desk'
    chmodSync(pagePath('agent-b'), 0o444)
    expect(refreshFrontDeskSheets()).toEqual({ pages: ['agent-a', 'agent-desk', 'agent-hidden'], failed: ['agent-b'] })
    expect(read('agent-b')).not.toContain('REPORTS go to')
    expect(read('agent-hidden')).toContain('REPORTS go to **agent-desk**')
    expect(read('agent-a')).toContain('REPORTS go to **agent-desk**')
  })

  it('an editor holds a sheet\'s lock while the setting is written: its edit AND both sections are on the sheet', async () => {
    h.value = 'agent-desk'
    // Shaped like scripts/claude-md-edit.py: it has read the sheet under the lock and will write
    // its own text back in place. A rename from our side would leave that write in a file no
    // path names; a write from our side that did not wait would be overwritten by it.
    const editor = await holdSheet(pagePath('agent-b'), 'edit', 600)
    expect(refreshFrontDeskSheets()).toEqual({ pages: PAGES, failed: [] })
    expect(await editor.done).toBe(0)
    expect(read('agent-b')).toContain('persona\nEDITOR LINE\n')
    expect(read('agent-b')).toContain('REPORTS go to **agent-desk**')
    expect(level3('agent-b')).toEqual([L3('agent-desk')])
  })

  // Each writer alone: in the refresh above the first writer does the waiting for both.
  it.each([
    ['autonomy', ensureAutonomySection, () => expect(level3('agent-b')).toEqual([L3('agent-desk')])],
    ['report routing', ensureReportRoutingSection, () => expect(read('agent-b')).toContain('REPORTS go to **agent-desk**')],
  ] as const)('the %s section alone, against an editor that holds the sheet: both texts stay', async (_name, ensure, sectionIsThere) => {
    const editor = await holdSheet(pagePath('agent-b'), 'edit', 600)
    ensure('agent-b', 'agent-desk')
    expect(await editor.done).toBe(0)
    expect(read('agent-b')).toContain('persona\nEDITOR LINE\n')
    sectionIsThere()
  })

  it('an agent list that cannot be read: nothing written, the answer does not read as success, no throw', () => {
    h.value = 'agent-desk'
    h.listThrows = true
    const before = PAGES.map(read)
    expect(refreshFrontDeskSheets()).toEqual({ pages: [], failed: ['*'] })
    expect(PAGES.map(read)).toEqual(before)
  })

  it('the coordinator is written once even when it also has a directory under agents/', () => {
    h.value = 'agent-desk'
    h.all.push('agent-a')
    try {
      expect(refreshFrontDeskSheets()).toEqual({ pages: PAGES, failed: [] })
    } finally {
      h.all.pop()
    }
    expect(existsSync(join(tmpRoot, 'agents', 'agent-a', 'CLAUDE.md'))).toBe(false)
  })
})

function fakeCtx(body: unknown): { ctx: RouteContext; res: { statusCode: number; body: string } } {
  const req = new EventEmitter() as unknown as RouteContext['req'] & { destroy(): void }
  ;(req as unknown as { headers: Record<string, string> }).headers = {}
  ;(req as { destroy(): void }).destroy = () => { /* readBody over-limit hook */ }
  const state = { statusCode: 0, body: '' }
  const res = {
    writeHead(code: number) { state.statusCode = code; return res },
    end(data?: unknown) { state.body = String(data ?? '') },
    setHeader() { /* not used by json() */ },
  } as unknown as RouteContext['res']
  process.nextTick(() => {
    ;(req as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)))
    ;(req as unknown as EventEmitter).emit('end')
  })
  const path = '/api/settings'
  return { ctx: { req, res, path, method: 'POST', url: new URL(`http://localhost${path}`), fedPeer: null }, res: state }
}

async function post(body: unknown): Promise<{ statusCode: number; json: Record<string, unknown> }> {
  const { ctx, res } = fakeCtx(body)
  expect(await tryHandleSettings(ctx)).toBe(true)
  return { statusCode: res.statusCode, json: res.body ? JSON.parse(res.body) : {} }
}

describe('POST /api/settings', () => {
  it('FRONT_DESK_AGENT_ID: the sheets carry the NEW value when the answer arrives, and the answer says which', async () => {
    h.value = 'agent-b'
    refreshFrontDeskSheets()
    const r = await post({ key: 'FRONT_DESK_AGENT_ID', value: 'agent-desk', actor: 'test' })
    expect(r.statusCode).toBe(200)
    expect(r.json).toMatchObject({ ok: true, key: 'FRONT_DESK_AGENT_ID', value: 'agent-desk', requiresRestart: false })
    expect(r.json.sheets).toEqual({ pages: PAGES, failed: [] })
    for (const a of PAGES) expect(read(a)).toContain('REPORTS go to **agent-desk**')
    expect(level3('agent-b')).toEqual([L3('agent-desk')])
    expect(h.log).toEqual([['FRONT_DESK_AGENT_ID', 'agent-b', 'agent-desk', 'test']])
  })

  it('a sheet that could not be rewritten is in the answer, and the setting is still saved', async () => {
    chmodSync(pagePath('agent-hidden'), 0o444)
    const r = await post({ key: 'FRONT_DESK_AGENT_ID', value: 'agent-desk' })
    expect(r.statusCode).toBe(200)
    expect(r.json.sheets).toEqual({ pages: ['agent-a', 'agent-b', 'agent-desk'], failed: ['agent-hidden'] })
    expect(h.value).toBe('agent-desk')
  })

  it('another key rewrites no sheet and answers without the field', async () => {
    h.value = 'agent-desk'
    const before = PAGES.map(read)
    const r = await post({ key: 'RESTART_NOTICE_SWALLOW_MODE', value: 'dry-run' })
    expect(r.statusCode).toBe(200)
    expect(r.json.ok).toBe(true)
    expect('sheets' in r.json).toBe(false)
    expect(PAGES.map(read)).toEqual(before)
  })

  it('a write that fails rewrites no sheet', async () => {
    h.setOk = false
    const before = PAGES.map(read)
    const r = await post({ key: 'FRONT_DESK_AGENT_ID', value: 'agent-desk' })
    expect(r.statusCode).toBe(400)
    expect('sheets' in r.json).toBe(false)
    expect(PAGES.map(read)).toEqual(before)
  })

  // The registry takes any string for this key; whether it NAMES a front desk is the router's
  // test (reportDesk). So a value that cannot be one is saved, and the sheets say "no rule".
  it('a value that cannot be a front desk is saved, and takes the rule OUT of every sheet', async () => {
    h.value = 'agent-desk'
    refreshFrontDeskSheets()
    const r = await post({ key: 'FRONT_DESK_AGENT_ID', value: 'agent zzz' })
    expect(r.statusCode).toBe(200)
    expect(r.json.sheets).toEqual({ pages: PAGES, failed: [] })
    for (const a of PAGES) {
      expect(read(a)).toContain(NO_RULE)
      expect(read(a)).not.toContain('REPORTS go to')
      expect(level3(a)).toEqual([OLD_L3])
    }
  })

  it('WEB_ONLY: the setting is saved, the sheets are not touched, the answer says so', async () => {
    process.env['WEB_ONLY'] = 'true'
    const before = PAGES.map(read)
    const r = await post({ key: 'FRONT_DESK_AGENT_ID', value: 'agent-desk' })
    expect(r.statusCode).toBe(200)
    expect(r.json.sheets).toEqual({ skipped: 'web-only' })
    expect(PAGES.map(read)).toEqual(before)
  })
})
