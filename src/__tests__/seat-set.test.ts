// seat-set -- card 336501d7. Fixtures and fakes only: no live seat is moved by this file.
//
// The routine writes an agent's config and restarts its pane, so the tests weigh the refusals and
// the "nothing was written" cases as heavily as the happy path, and carry a canary token to prove
// that no token, and no hash of one, reaches any output line or ledger line.
import { describe, it, expect } from 'vitest'
import {
  SEAT_EXIT,
  applySeatChange,
  paneVerdictForRestart,
  planTokenPath,
  runSeatSet,
  sha256Hex,
  tokenFileSha,
  validateSeatRequest,
  verifyFacts,
  type ProcessFacts,
  type SeatContext,
  type SeatDeps,
  type SeatOptions,
} from '../seat-set.js'

const STORE = '/fx/store'
const CONFIG = '/fx/agents/ford/agent-config.json'
const LEDGER = '/fx/store/seat-ledger.log'
// Built at runtime so the file itself carries no secret-shaped literal (secret-gate).
const PREFIX = ['sk', 'ant', 'oat01'].join('-')
const TOKEN_ELSO = `${PREFIX}-CANARY-ELSO-0000000000`
const TOKEN_MASODIK = `${PREFIX}-CANARY-MASODIK-111111111`

const BASE_CONFIG = {
  model: 'claude-sonnet-5-5',
  securityProfile: 'developer-senior',
  projects: ['delta-crm'],
  team: { role: 'member', reportsTo: 'dexter' },
  authMode: 'shared',
  toolDeny: ['Artifact', 'ForkMe'],
}
const configText = (o: Record<string, unknown> = BASE_CONFIG): string => `${JSON.stringify(o, null, 2)}\n`

const ctx: SeatContext = {
  coordinatorIds: ['marveen'],
  knownModels: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'],
  storeDir: STORE,
  agentExists: (a) => a === 'ford' || a === 'dexter',
}

const FOOTER = '⏵⏵ bypass permissions on (shift+tab to cycle)'
const RULE = '─'.repeat(60)
const IDLE = ['scrollback', RULE, '❯ ', RULE, FOOTER].join('\n')
const WORKING = ['✻ Thinking… (12s · ↓ 3.1k tokens · esc to interrupt)', RULE, '❯ ', RULE, FOOTER].join('\n')
const PERMISSION = [' Do you want to proceed?', ' ❯ 1. Yes', '   2. No', '', ' Esc to cancel · Tab to amend'].join('\n')

interface Fake {
  deps: SeatDeps
  files: Map<string, string>
  copies: Array<[string, string]>
  writes: string[]
  ledger: string[]
  restarts: { n: number }
  order: string[]
}

interface FakeOpts {
  pane?: string | null
  /** Process facts returned by successive calls; the last repeats. */
  facts?: Array<ProcessFacts | null>
  restart?: { ok: boolean; error?: string }
  config?: string | null
  /** Make the write land different bytes than asked. */
  corruptWrite?: boolean
  files?: Record<string, string>
}

function fake(o: FakeOpts = {}): Fake {
  const files = new Map<string, string>()
  if (o.config !== null) files.set(CONFIG, o.config ?? configText())
  files.set(`${STORE}/.claude-oauth-token`, `${TOKEN_ELSO}\n`)
  files.set(`${STORE}/.claude-oauth-token-masodik`, `${TOKEN_MASODIK}\n`)
  for (const [k, v] of Object.entries(o.files ?? {})) files.set(k, v)
  const f: Fake = { deps: null as unknown as SeatDeps, files, copies: [], writes: [], ledger: [], restarts: { n: 0 }, order: [] }
  let factsCall = 0
  const frames = o.facts ?? [{ pid: '100', model: 'claude-sonnet-5-5', tokenSha: sha256Hex(TOKEN_ELSO) }]
  f.deps = {
    readText: (p) => files.get(p) ?? null,
    copyFile: (from, to) => {
      f.order.push('copy')
      f.copies.push([from, to])
      files.set(to, files.get(from) ?? '')
    },
    writeText: (p, t) => {
      f.order.push('write')
      f.writes.push(p)
      files.set(p, o.corruptWrite ? `${t}x` : t)
    },
    appendLine: (_p, line) => { f.ledger.push(line) },
    now: () => '2026-11-16 14:30:00',
    stamp: () => '20261116-143000',
    capturePane: () => (o.pane === undefined ? IDLE : o.pane),
    processFacts: () => frames[Math.min(factsCall++, frames.length - 1)],
    restart: async () => { f.order.push('restart'); f.restarts.n++; return o.restart ?? { ok: true } },
    delay: async () => {},
  }
  return f
}

const OPTS: SeatOptions = { apply: true, by: 'marveen', configPath: CONFIG, ledgerPath: LEDGER, storeDir: STORE, verifyWaitMs: 6, verifyPollMs: 3 }
const OLD: ProcessFacts = { pid: '100', model: 'claude-sonnet-5-5', tokenSha: sha256Hex(TOKEN_ELSO) }

describe('validateSeatRequest: refusals before any I/O', () => {
  it.each([
    ['the coordinator', { agent: 'marveen', model: 'claude-opus-5-5' }, /coordinator/],
    ['an unknown agent', { agent: 'nobody', model: 'claude-opus-5-5' }, /unknown agent/],
    ['a path-like agent name', { agent: '../ford', model: 'claude-opus-5-5' }, /not an agent name/],
    ['an unknown model id', { agent: 'ford', model: 'gpt-9' }, /unknown model id/],
    ['the gift API key as a plan', { agent: 'ford', plan: 'ANTHROPIC_API_KEY_SECOND' }, /API key, not a seat/],
    ['a plan that does not exist', { agent: 'ford', plan: 'harmadik' }, /only plans are elso and masodik/],
    ['a request that moves nothing', { agent: 'ford' }, /nothing to move/],
  ])('refuses %s', (_n, req, why) => {
    const r = validateSeatRequest(req, ctx)
    expect(r.ok).toBe(false)
    expect((r as { why: string }).why).toMatch(why)
  })

  it('accepts a known model and a known plan', () => {
    expect(validateSeatRequest({ agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }, ctx)).toEqual({ ok: true, plan: 'masodik' })
  })
})

describe('applySeatChange: only the changed keys change', () => {
  it('a model change leaves every other line byte for byte', () => {
    const before = configText()
    const r = applySeatChange(before, { model: 'claude-opus-5-5' }, STORE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const a = before.split('\n')
    const b = r.newText.split('\n')
    expect(b.length).toBe(a.length)
    const diff = a.map((l, i) => (l === b[i] ? null : [l, b[i]])).filter(Boolean)
    expect(diff).toEqual([['  "model": "claude-sonnet-5-5",', '  "model": "claude-opus-5-5",']])
    expect(r.before).toEqual({ model: 'claude-sonnet-5-5', plan: 'elso' })
    expect(r.after).toEqual({ model: 'claude-opus-5-5', plan: 'elso' })
  })

  it('the second plan adds oauthTokenFile as the last key; the first plan removes it again', () => {
    const before = configText()
    const m = applySeatChange(before, { plan: 'masodik' }, STORE)
    expect(m.ok && m.newText).toBe(configText({ ...BASE_CONFIG, oauthTokenFile: planTokenPath('masodik', STORE) }))
    if (!m.ok) return
    expect(m.after.plan).toBe('masodik')
    const e = applySeatChange(m.newText, { plan: 'elso' }, STORE)
    expect(e.ok && e.newText).toBe(before)
  })

  it('no real change reports changed=false', () => {
    const r = applySeatChange(configText(), { model: 'claude-sonnet-5-5', plan: 'elso' }, STORE)
    expect(r.ok && r.changed).toBe(false)
  })

  it('keeps a missing final newline as it was', () => {
    const noNl = JSON.stringify(BASE_CONFIG, null, 2)
    const r = applySeatChange(noNl, { model: 'claude-opus-5-5' }, STORE)
    expect(r.ok && r.newText.endsWith('\n')).toBe(false)
  })

  it('refuses a file that would be reformatted, invalid JSON and a non-object', () => {
    expect(applySeatChange(JSON.stringify(BASE_CONFIG, null, 4), { model: 'claude-opus-5-5' }, STORE)).toMatchObject({ ok: false })
    expect(applySeatChange('{"model": ', { model: 'claude-opus-5-5' }, STORE)).toMatchObject({ ok: false, why: expect.stringContaining('not valid JSON') })
    expect(applySeatChange('[]', { model: 'claude-opus-5-5' }, STORE)).toMatchObject({ ok: false, why: expect.stringContaining('not a JSON object') })
  })
})

describe('verifyFacts and paneVerdictForRestart', () => {
  const sha = sha256Hex(TOKEN_MASODIK)
  it('yes only when every requested check matches', () => {
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: sha }, { model: 'm', tokenSha: sha })).toEqual({ model: 'yes', plan: 'yes', verified: true })
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: sha }, { model: 'x', tokenSha: sha }).verified).toBe(false)
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: sha256Hex('other') }, { tokenSha: sha })).toMatchObject({ plan: 'no', verified: false })
  })
  it('an unreadable environment, no process, or a missing expectation is unknown, never yes', () => {
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: null }, { tokenSha: sha })).toMatchObject({ plan: 'unknown', verified: false })
    expect(verifyFacts(null, { model: 'm' })).toMatchObject({ model: 'unknown', verified: false })
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: sha }, { tokenSha: null })).toMatchObject({ plan: 'unknown', verified: false })
  })
  it('nothing requested is not verified', () => {
    expect(verifyFacts({ pid: '1', model: 'm', tokenSha: sha }, {}).verified).toBe(false)
  })
  it('tokenFileSha hashes the trimmed content and returns null for a missing or empty file', () => {
    expect(tokenFileSha(() => `${TOKEN_ELSO}\n`, 'p')).toBe(sha256Hex(TOKEN_ELSO))
    expect(tokenFileSha(() => null, 'p')).toBeNull()
    expect(tokenFileSha(() => ' \n', 'p')).toBeNull()
  })
  it('only an idle pane may be restarted', () => {
    expect(paneVerdictForRestart(IDLE)).toBe('idle')
    expect(paneVerdictForRestart(WORKING)).toBe('busy')
    expect(paneVerdictForRestart(PERMISSION)).toBe('busy')
    expect(paneVerdictForRestart(null)).toBe('unreadable')
    expect(paneVerdictForRestart('  ')).toBe('unreadable')
  })
})

function untouched(f: Fake): void {
  expect(f.copies).toEqual([])
  expect(f.writes).toEqual([])
  expect(f.ledger).toEqual([])
  expect(f.restarts.n).toBe(0)
  expect(f.files.get(CONFIG)).toBe(configText())
}

describe('runSeatSet: nothing is written unless it is asked for and allowed', () => {
  it('a dry run prints old -> new and writes nothing, restarts nothing', async () => {
    const f = fake()
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }, ctx, { ...OPTS, apply: false, by: '' })
    expect(r.exit).toBe(SEAT_EXIT.OK)
    const text = r.lines.join('\n')
    expect(text).toContain('DRY RUN')
    expect(text).toContain('model: claude-sonnet-5-5 -> claude-opus-5-5')
    expect(text).toContain('plan: elso -> masodik')
    expect(text).toContain('backup would be: /fx/agents/ford/agent-config.json.bak-seatset-20261116-143000')
    expect(text).toContain('pane: idle')
    untouched(f)
  })

  it('a refused request writes nothing', async () => {
    const f = fake()
    const r = await runSeatSet(f.deps, { agent: 'marveen', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.REFUSED)
    untouched(f)
  })

  it('an unreadable config is refused and nothing is written', async () => {
    const f = fake({ config: null })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.REFUSED)
    expect(f.writes).toEqual([])
    expect(f.restarts.n).toBe(0)
  })

  it('a config that is not valid JSON is refused', async () => {
    const f = fake({ config: '{"model": ' })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.REFUSED)
    expect(f.writes).toEqual([])
  })

  it('a missing plan token file refuses the move (it could not be verified)', async () => {
    const f = fake({ files: { [`${STORE}/.claude-oauth-token-masodik`]: '' } })
    const r = await runSeatSet(f.deps, { agent: 'ford', plan: 'masodik' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.REFUSED)
    untouched(f)
  })

  it('--apply without --by is a usage error and writes nothing', async () => {
    const f = fake()
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, { ...OPTS, by: '' })
    expect(r.exit).toBe(SEAT_EXIT.USAGE)
    untouched(f)
  })

  it('a request that changes nothing writes nothing, even with --apply', async () => {
    const f = fake()
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-sonnet-5-5', plan: 'elso' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.OK)
    expect(r.lines.join('\n')).toContain('nothing to change')
    untouched(f)
  })
})

describe('runSeatSet --apply', () => {
  it('idle pane: backup BEFORE the write, one restart, verified on the new process, ledger yes', async () => {
    const f = fake({
      facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: sha256Hex(TOKEN_MASODIK) }],
    })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.OK)
    expect(f.order).toEqual(['copy', 'write', 'restart'])
    expect(f.copies[0]).toEqual([CONFIG, '/fx/agents/ford/agent-config.json.bak-seatset-20261116-143000'])
    expect(f.files.get('/fx/agents/ford/agent-config.json.bak-seatset-20261116-143000')).toBe(configText())
    expect(f.restarts.n).toBe(1)
    expect(r.lines.join('\n')).toContain('written. read back: model=claude-opus-5-5 plan=masodik')
    expect(f.ledger).toEqual([
      '2026-11-16 14:30:00 | ford | model claude-sonnet-5-5 -> claude-opus-5-5 | plan elso -> masodik | applied, restarted | verified=yes | by=marveen',
    ])
  })

  it('BUSY pane: config written, NOT restarted, distinct exit, ledger says no', async () => {
    const f = fake({ pane: WORKING })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.WRITTEN_NOT_RESTARTED)
    expect(f.restarts.n).toBe(0)
    expect(f.writes).toEqual([CONFIG])
    expect(r.lines.join('\n')).toContain('takes effect at next restart')
    expect(f.ledger[0]).toContain('verified=no')
  })

  it.each([
    ['a permission prompt', PERMISSION],
    ['an unreadable pane', null],
  ])('%s is never restarted', async (_n, pane) => {
    const f = fake({ pane })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.WRITTEN_NOT_RESTARTED)
    expect(f.restarts.n).toBe(0)
  })

  it('the new process holds the OLD token: unverified, exit 11, ledger no (the config alone proves nothing)', async () => {
    const f = fake({ facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: sha256Hex(TOKEN_ELSO) }] })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.UNVERIFIED)
    expect(r.lines.join('\n')).toContain('plan token on the process: no')
    expect(f.ledger[0]).toContain('verified=no')
  })

  it('the new process runs the OLD model: unverified', async () => {
    const f = fake({ facts: [OLD, { pid: '200', model: 'claude-sonnet-5-5', tokenSha: sha256Hex(TOKEN_ELSO) }] })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.UNVERIFIED)
    expect(r.lines.join('\n')).toContain('model on the process: no')
  })

  it('the pid never changes (the restart did not replace the process): unverified', async () => {
    const f = fake({ facts: [OLD] })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.UNVERIFIED)
    expect(r.lines.join('\n')).toContain('NOT SEEN')
  })

  it('an environment that cannot be read is unverified, not yes', async () => {
    const f = fake({ facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: null }] })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.UNVERIFIED)
    expect(r.lines.join('\n')).toContain('plan token on the process: unknown')
  })

  it('a failed restart call: exit 12, config stays written, ledger no', async () => {
    const f = fake({ restart: { ok: false, error: 'the dashboard answered HTTP 500' } })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.RESTART_FAILED)
    expect(f.writes).toEqual([CONFIG])
    expect(f.ledger[0]).toContain('restart failed')
  })

  it('a write that does not read back as asked: exit 13 and the backup is copied back', async () => {
    const f = fake({ corruptWrite: true })
    const r = await runSeatSet(f.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.WRITE_FAILED)
    expect(f.files.get(CONFIG)).toBe(configText())
    expect(f.restarts.n).toBe(0)
  })

  it('moving plan only does not check the model, and a model-only move does not check the token', async () => {
    const f = fake({ facts: [OLD, { pid: '200', model: 'whatever', tokenSha: sha256Hex(TOKEN_MASODIK) }] })
    const r = await runSeatSet(f.deps, { agent: 'ford', plan: 'masodik' }, ctx, OPTS)
    expect(r.exit).toBe(SEAT_EXIT.OK)
    const g = fake({ facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: null }] })
    const r2 = await runSeatSet(g.deps, { agent: 'ford', model: 'claude-opus-5-5' }, ctx, OPTS)
    expect(r2.exit).toBe(SEAT_EXIT.OK)
  })
})

describe('no token, and no hash of one, ever leaves the routine', () => {
  it('the canary tokens and their sha256 appear in no output line and no ledger line', async () => {
    const needles = [TOKEN_ELSO, TOKEN_MASODIK, sha256Hex(TOKEN_ELSO), sha256Hex(TOKEN_MASODIK)]
    const runs: Array<[Fake, Parameters<typeof runSeatSet>[1]]> = [
      [fake({ facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: sha256Hex(TOKEN_MASODIK) }] }), { agent: 'ford', model: 'claude-opus-5-5', plan: 'masodik' }],
      [fake({ facts: [OLD, { pid: '200', model: 'claude-opus-5-5', tokenSha: sha256Hex(TOKEN_ELSO) }] }), { agent: 'ford', plan: 'masodik' }],
      [fake({ pane: WORKING }), { agent: 'ford', plan: 'masodik' }],
    ]
    for (const [f, req] of runs) {
      const r = await runSeatSet(f.deps, req, ctx, OPTS)
      const all = [...r.lines, ...f.ledger].join('\n')
      for (const n of needles) expect(all).not.toContain(n)
      // and no token file was written: the only writes are the agent config
      expect(f.writes.every(p => p === CONFIG)).toBe(true)
      expect(f.copies.every(([from]) => from === CONFIG || from.includes('.bak-seatset-'))).toBe(true)
    }
  })
})
