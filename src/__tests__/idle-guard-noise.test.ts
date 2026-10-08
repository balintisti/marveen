// A TETLEN-OR ZAJA -- kartya 3c27105f (Isti 5666: 268 gepi riasztas / 24 ora marveennek).
//
// A mert eset (2026-10-09, 7 napos visszajatszas, 238 uzenet / 245 tetel):
//   - 90 tetelt olyan agensrol kuldott, akinek a panelje FUTO hatter-al-agenseket mutatott
//     (a prompt szabad, az agens dolgozik): didi 10-07 11:55 es 12:25, harom-ot al-agenssel;
//   - 79 "a panel nem olvashato" sor, ugyanarrol az agensrol ujra meg ujra;
//   - 69 "ures prompton all, nincs kiosztva" -- uzenet, ami egy teljes fordulo a cimzettnek.
// Harom javitas, harom resz ebben a fajlban: (a) al-agens, (b) a vak panel ritkabban,
// (c) a "nincs kiosztva" a napi osszesitobe megy. Mindegyiknek van egy MEGFELELTETES-tesztje:
// a bemenet valtozasa mozditja a kimenetet (nem csak a jo dolog van ott).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { tmpDirs } from './helpers/tmp-dirs.js'

// A digest fajl a PROJECT_ROOT/store alatt van: a teszt NEM irhat az igazi store-ba.
const hoisted = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  return { root: mkdtempSync(join(tmpdir(), 'idle-noise-')) }
})
// Made before the imports (the config mock needs it), so it is handed to the helper that removes it.
tmpDirs().adopt(hoisted.root)
const debug = vi.fn()
const info = vi.fn()
const panes = new Map<string, string | null>()
const paneStates = new Map<string, string>()
const messages: Array<{ from: string; to: string; content: string }> = []
let storedState: Record<string, unknown> | null = null

vi.mock('../logger.js', () => ({
  logger: { debug: (...a: unknown[]) => debug(...a), info: (...a: unknown[]) => info(...a), warn: () => {}, error: () => {} },
}))
vi.mock('../config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config.js')>()
  return { ...actual, PROJECT_ROOT: hoisted.root }
})
vi.mock('../web/agent-process.js', () => ({
  capturePane: (session: string) => (panes.has(session) ? panes.get(session) : null),
  isAgentRunning: () => true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: (a: string) => `agent-${a}` }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: (a: string) => join(hoisted.root, 'agents', a),
  readAgentRemoteHost: () => null,
  readAgentProjects: () => null,
}))
// A VALODI runningSubagentCount fut (importOriginal): a bekotest akarjuk merni, nem egy mock-ot.
vi.mock('../pane-state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../pane-state.js')>()
  return {
    ...actual,
    detectPaneState: (pane: string) => paneStates.get(pane) ?? 'idle',
    busyEvidence: () => 'none',
    detectsUsageLimitReached: () => false,
  }
})
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: () => [],
  listKanbanCards: () => [],
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: (from: string, to: string, content: string) => { messages.push({ from, to, content }); return { id: messages.length } },
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => storedState,
}))

const { decideIdleAlert, NO_IDLE_STATE, idleDigestLine } = await import('../idle-agent.js')
const { runningSubagentCount } = await import('../pane-state.js')
let { tick } = await import('../web/idle-agent-watcher.js')
const { MAIN_AGENT_ID } = await import('../config.js')

// --- a panelek: a 2026-10-09-i ELO panelekrol, a tartalom nelkul ------------------------
const SEP = '─'.repeat(80)
const FOOTER = '  ⏵⏵ bypass permissions on · 7 shells, 1 monitor · ↓ to manage'
const runningRow = (name: string, mins: number) =>
  `  ◯ ${name.padEnd(16)} Valami feladat leirasa…  ${mins}m 12s · ↓ 125.7k tokens`
const idleRow = (name: string) => `  ◯ ${name.padEnd(16)} Batch 19 B-layer resume                 idle`
const panel = (rows: string[]) => ['', '  ⏺ main', ...rows]
const pane = (opts: { rows?: string[]; waiting?: number; footer?: string } = {}) => [
  '  Valami kimenet a beszelgetesbol.',
  ...(opts.waiting ? ['', `✻ Waiting for ${opts.waiting} background agents to finish`] : []),
  '',
  SEP, '❯ ', SEP,
  opts.footer ?? FOOTER,
  ...(opts.rows ? panel(opts.rows) : []),
].join('\n')

describe('(a) runningSubagentCount -- a panel futo sorai', () => {
  it('a futo sorokat szamolja, a panel a lablec ALATT', () => {
    expect(runningSubagentCount(pane({ rows: [runningRow('general-purpose', 57), runningRow('b19-pw', 18), runningRow('x', 1)] }))).toBe(3)
  })

  it('a `idle` sor NEM futo al-agens (kesz csapattars, uzenetre var)', () => {
    expect(runningSubagentCount(pane({ rows: [idleRow('b19-blayer-2'), runningRow('b19-pw', 18)] }))).toBe(1)
    expect(runningSubagentCount(pane({ rows: [idleRow('b19-blayer-2')] }))).toBe(0)
  })

  it('a `Waiting for N background agents` sor is szamit, es a nagyobbik nyer', () => {
    // A panel lehet rejtett vagy rovidebb a capture-nel; a sor akkor is ott van.
    expect(runningSubagentCount(pane({ waiting: 10 }))).toBe(10)
    expect(runningSubagentCount(pane({ waiting: 10, rows: [runningRow('a', 1), runningRow('b', 2)] }))).toBe(10)
    expect(runningSubagentCount(pane({ waiting: 1, rows: [runningRow('a', 1), runningRow('b', 2)] }))).toBe(2)
  })

  it('NEGATIV KONTROLL: panel nelkuli pane 0, es a gorgetett multbeli sor nem panel', () => {
    expect(runningSubagentCount(pane())).toBe(0)
    // Ugyanaz a sor a lablec FELETT (egy idezett naplo): nem a panel.
    const quoted = [runningRow('x', 5), pane()].join('\n')
    expect(runningSubagentCount(quoted)).toBe(0)
    expect(runningSubagentCount('')).toBe(0)
  })

  it('lablec nelkul csak `⏺ main` fejlec ALATT szamol', () => {
    const rows = [runningRow('a', 3), runningRow('b', 4)]
    expect(runningSubagentCount([...panel(rows)].join('\n'))).toBe(2)
    expect(runningSubagentCount(rows.join('\n'))).toBe(0)
  })
})

describe('(a) decideIdleAlert -- futo al-agens mellett nincs ebresztes, nincs eszkalacio', () => {
  const T = {
    sustainedMs: 12 * 60_000, realertMs: 30 * 60_000, wakeGraceMs: 15 * 60_000, wakeCooldownMs: 30 * 60_000,
    paneUnreadableRealertMs: 6 * 3_600_000, subagentHoldMs: 2 * 3_600_000,
  }
  const base = { agent: 'x', running: true, paneIdle: true as boolean | null, pendingMessages: 0, ownWorkCount: 3, workCheckKind: 'assigned_open_cards' }
  const now = 1_800_000_000_000
  const longIdle = { ...NO_IDLE_STATE, idleSinceMs: now - 60 * 60_000 }

  it('MEGFELELTETES: ugyanaz a bemenet al-agens nelkul ebreszt, al-agenssel nem', () => {
    expect(decideIdleAlert(base, longIdle, T, now).decision).toMatchObject({ alert: true, reason: 'wake-agent' })
    const r = decideIdleAlert({ ...base, runningSubagents: 2 }, longIdle, T, now)
    expect(r.decision).toEqual({ alert: false, reason: 'subagents-running' })
    expect(r.next.idleSinceMs).toBeNull()          // a tetlen-ablak ujraindul, nem orokolt
  })

  it('a 2. fokozat (az ebresztes nem hatott) sem tuzel al-agens mellett', () => {
    const woken = { ...longIdle, lastWakeAt: now - 20 * 60_000 }
    expect(decideIdleAlert(base, woken, T, now).decision).toMatchObject({ alert: true, reason: 'idle-with-work' })
    expect(decideIdleAlert({ ...base, runningSubagents: 3 }, woken, T, now).decision.alert).toBe(false)
  })

  it('a nem olvashato pane SEM riaszt, ha a panel sorai latszanak (a gard nem vak)', () => {
    expect(decideIdleAlert({ ...base, paneIdle: null }, NO_IDLE_STATE, T, now).decision).toMatchObject({ reason: 'pane-unreadable' })
    expect(decideIdleAlert({ ...base, paneIdle: null, runningSubagents: 1 }, NO_IDLE_STATE, T, now).decision)
      .toEqual({ alert: false, reason: 'subagents-running' })
  })

  it('a tartas HATARA: 2 ora utan az agens ugy ertekelodik, mintha nem lenne al-agense', () => {
    const first = decideIdleAlert({ ...base, runningSubagents: 1 }, NO_IDLE_STATE, T, now)
    expect(first.next.subagentsSinceMs).toBe(now)
    const inside = decideIdleAlert({ ...base, runningSubagents: 1 }, first.next, T, now + 119 * 60_000)
    expect(inside.decision.reason).toBe('subagents-running')
    const past = decideIdleAlert({ ...base, runningSubagents: 1 }, { ...first.next, idleSinceMs: now - 60 * 60_000 }, T, now + 121 * 60_000)
    expect(past.decision).toMatchObject({ alert: true, reason: 'wake-agent' })
    // Hatar nelkul (a kuszob nincs megadva) a tartas orok: ezert van a kuszob.
    const { subagentHoldMs: _drop, ...noHold } = T
    expect(decideIdleAlert({ ...base, runningSubagents: 1 }, first.next, noHold, now + 10 * 3_600_000).decision.reason).toBe('subagents-running')
  })

  it('az ora NULLAZODIK, ha egy tick nem lat al-agenst', () => {
    const first = decideIdleAlert({ ...base, runningSubagents: 1 }, NO_IDLE_STATE, T, now)
    const gone = decideIdleAlert(base, first.next, T, now + 60_000)
    expect(gone.next.subagentsSinceMs).toBeNull()
    const again = decideIdleAlert({ ...base, runningSubagents: 1 }, gone.next, T, now + 3 * 3_600_000)
    expect(again.next.subagentsSinceMs).toBe(now + 3 * 3_600_000)
    expect(again.decision.reason).toBe('subagents-running')
  })

  it('al-agens nelkuli allapotnal a next-be NEM kerul uj kulcs (a regi hivok toEqual-ja ep marad)', () => {
    const r = decideIdleAlert(base, longIdle, T, now)
    expect('subagentsSinceMs' in r.next).toBe(false)
  })
})

describe('(b) a "panel nem olvashato" agensenkent ablakonkent egyszer', () => {
  const T = {
    sustainedMs: 12 * 60_000, realertMs: 30 * 60_000, wakeGraceMs: 15 * 60_000, wakeCooldownMs: 30 * 60_000,
    paneUnreadableRealertMs: 6 * 3_600_000,
  }
  const blind = { agent: 'x', running: true, paneIdle: null, pendingMessages: 0, ownWorkCount: 3 }
  const now = 1_800_000_000_000

  it('az elso riaszt, a 6 oran beluli ismetles nem, a 6 ora utani igen', () => {
    const a = decideIdleAlert(blind, NO_IDLE_STATE, T, now)
    expect(a.decision).toEqual({ alert: true, reason: 'pane-unreadable' })
    expect(a.next.lastPaneUnreadableAt).toBe(now)
    // 31 perc: a regi 30 perces ablak MAR elmult -- eddig ez uzenetet jelentett.
    expect(decideIdleAlert(blind, a.next, T, now + 31 * 60_000).decision).toEqual({ alert: false, reason: 'recently-alerted' })
    expect(decideIdleAlert(blind, a.next, T, now + 5 * 3_600_000).decision.alert).toBe(false)
    expect(decideIdleAlert(blind, a.next, T, now + 6 * 3_600_000 + 1).decision).toEqual({ alert: true, reason: 'pane-unreadable' })
  })

  it('KONTROLL: a kuszob hianyaban a regi viselkedes marad (30 perc)', () => {
    const { paneUnreadableRealertMs: _drop, ...old } = T
    const a = decideIdleAlert(blind, NO_IDLE_STATE, old, now)
    expect(decideIdleAlert(blind, a.next, old, now + 31 * 60_000).decision.alert).toBe(true)
  })

  it('agensenkent KULON: egy masik agens allapota nem fogja vissza', () => {
    const a = decideIdleAlert(blind, NO_IDLE_STATE, T, now)
    expect(decideIdleAlert({ ...blind, agent: 'y' }, NO_IDLE_STATE, T, now + 60_000).decision.alert).toBe(true)
    expect(a.next.lastPaneUnreadableAt).toBe(now)
  })
})

describe('(c) idleDigestLine', () => {
  it('egy sor, JSON, ujsorral zarva; az ts EZREDMASODPERC', () => {
    const line = idleDigestLine('x', 20, 1_800_000_000_000, 'assigned_open_cards')
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line)).toEqual({ ts: 1_800_000_000_000, agent: 'x', minutes: 20, kind: 'assigned_open_cards' })
    expect(JSON.parse(idleDigestLine('x', 1, 5)).kind).toBeNull()
  })
})

// --- a tick() vegig, mockolt vilaggal: a BEKOTES a tesztelt dolog ------------------------
describe('tick() -- a bekotes', () => {
  const NOW = new Date('2026-10-09T10:00:00Z').getTime()
  const workcheck = (agent: string, kind: string) => {
    const dir = agent === MAIN_AGENT_ID ? hoisted.root : join(hoisted.root, 'agents', agent)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'workcheck.json'), JSON.stringify({ kind }))
  }
  const toCoordinator = () => messages.filter(m => m.to === MAIN_AGENT_ID && m.from === 'system')
  const digestPath = () => join(hoisted.root, 'store', 'idle-digest.jsonl')

  beforeEach(async () => {
    // A watcher allapota (watchState) modul-szintu: tesztenkent friss modul, hogy az elozo teszt
    // allapota ne dontson a kovetkezo helyett.
    vi.resetModules()
    ;({ tick } = await import('../web/idle-agent-watcher.js'))
    rmSync(join(hoisted.root, 'store'), { recursive: true, force: true })
    vi.useFakeTimers(); vi.setSystemTime(NOW)
    debug.mockReset(); info.mockReset(); panes.clear(); paneStates.clear(); messages.length = 0
    storedState = null
    workcheck(MAIN_AGENT_ID, 'none')
    panes.set(`agent-${MAIN_AGENT_ID}`, 'COORDINATOR-PANE')
  })
  afterEach(() => { vi.useRealTimers() })

  const reasonOf = (agent: string) => {
    const calls = debug.mock.calls.filter(c => (c[0] as { agent?: string })?.agent === agent)
    return (calls.at(-1)?.[0] as { reason?: string } | undefined)?.reason
  }

  it('(a) a futo al-agenses pane NEM tetlen: a watcher atadja a szamot a dontesnek', () => {
    workcheck('x', 'assigned_open_cards')
    // Egy kartya sem kell: az `idle` + 0 tetel + 12 perc az idle-no-work ag -- al-agens nelkul.
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane({ rows: [runningRow('b19-pw', 18), runningRow('report', 7)] }))
    tick()
    expect(reasonOf('x')).toBe('subagents-running')
    expect(messages).toHaveLength(0)
    expect(existsSync(digestPath())).toBe(false)
  })

  it('(a) MEGFELELTETES: ugyanaz az allapot al-agens NELKUL a "nincs kiosztva" agra fut', () => {
    workcheck('x', 'assigned_open_cards')
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane())
    tick()
    expect(reasonOf('x')).toBe('idle-no-work')
  })

  it('(a) a pane OSZTALYOZO-szerint ismeretlen, de a panel sorai latszanak: nem vak, nem riaszt', () => {
    workcheck('x', 'assigned_open_cards')
    const unknownWithRows = pane({ rows: [runningRow('b19-pw', 18)] })
    panes.set('agent-x', unknownWithRows); paneStates.set(unknownWithRows, 'unknown')
    tick()
    expect(reasonOf('x')).toBe('subagents-running')
    expect(toCoordinator().filter(m => m.content.includes('NEM OLVASHATO'))).toHaveLength(0)
  })

  it('(c) a "nincs kiosztva" a napi osszesitobe kerul, a koordinatornak NEM megy uzenet', () => {
    workcheck('x', 'assigned_open_cards')
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane())
    tick()
    const lines = readFileSync(digestPath(), 'utf8').trim().split('\n').map(l => JSON.parse(l))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ ts: NOW, agent: 'x', minutes: 20, kind: 'assigned_open_cards' })
    expect(toCoordinator().filter(m => m.content.includes('NINCS RA KIOSZTVA'))).toHaveLength(0)
  })

  it('(c) AZ UT KIFELE: ha a napi osszesito nem irhato, a regi uzenet megy (nem nyelodik el)', () => {
    workcheck('x', 'assigned_open_cards')
    // store/ nincs -> appendFileSync ENOENT
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane())
    tick()
    expect(existsSync(digestPath())).toBe(false)
    expect(toCoordinator().filter(m => m.content.includes('NINCS RA KIOSZTVA'))).toHaveLength(1)
  })

  it('(b) a vak panel 30 perc mulva MAR nem, 6 ora mulva ujra megy (a THRESHOLDS bekotese)', () => {
    workcheck('x', 'assigned_open_cards')
    panes.set('agent-x', 'GARBAGE'); paneStates.set('GARBAGE', 'unknown')
    const blindMessages = () => toCoordinator().filter(m => m.content.includes('NEM OLVASHATO') && m.content.includes('"x"'))
    tick()
    expect(blindMessages()).toHaveLength(1)
    vi.setSystemTime(NOW + 31 * 60_000); tick()
    expect(blindMessages()).toHaveLength(1)
    vi.setSystemTime(NOW + 5 * 3_600_000); tick()
    expect(blindMessages()).toHaveLength(1)
    vi.setSystemTime(NOW + 6 * 3_600_000 + 60_000); tick()
    expect(blindMessages()).toHaveLength(2)
  })
})

// A teszt-folyamat sem kerulhet az eles store-ba: a PROJECT_ROOT mock a bizonyitek.
describe('a teszt hermetikus', () => {
  it('a digest gyokere a mock tmp mappa, nem az eles telepites', () => {
    expect(hoisted.root.startsWith(tmpdir())).toBe(true)
  })
})
