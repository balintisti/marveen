// A TETLEN-OR ZAJA -- kartya 3c27105f (Isti 5666: 268 gepi riasztas / 24 ora marveennek).
//
// A mert eset (2026-10-09, 7 napos visszajatszas, 238 uzenet / 245 tetel):
//   - 90 tetelt olyan agensrol kuldott, akinek a panelje FUTO hatter-al-agenseket mutatott
//     (a prompt szabad, az agens dolgozik): didi 10-07 11:55 es 12:25, harom-ot al-agenssel;
//   - 79 "a panel nem olvashato" sor, ugyanarrol az agensrol ujra meg ujra;
//   - 69 "ures prompton all, nincs kiosztva" -- uzenet, ami egy teljes fordulo a cimzettnek.
// Harom javitas, harom resz ebben a fajlban: (a) al-agens, (b) a vak panel ritkabban,
// (c) a "nincs kiosztva" ISMETLESE a napi osszesitobe megy (az idle-szakasz ELSO ertesitese elo marad, R3). Mindegyiknek van egy MEGFELELTETES-tesztje:
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
let failNextMessage = false
// A cselekves-nyom forrasai (a watcher ezeket olvassa): az utolso kimeno uzenet ideje (mp, null = nincs),
// a kartya-kommentek (kartya, szerzo, ido mp) es a tabla kartyai.
let outboundSec: number | null | (() => number | null) = null
let commentRows: Array<{ card_id: string; author: string; at: number }> = []
let cardRows: Array<Record<string, unknown>> = []

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
  listKanbanCards: () => cardRows,
  getLabelsForAllCards: () => new Map(),
  getLastOutboundMessageAt: () => (typeof outboundSec === 'function' ? outboundSec() : outboundSec),
  getDb: () => ({
    prepare: (sql: string) => ({
      all: () => (sql.includes('GROUP BY card_id, author') && !sql.includes('NOT IN') ? commentRows : []),
      get: () => undefined,
      run: () => ({ changes: 0 }),
    }),
  }),
  createAgentMessage: (from: string, to: string, content: string) => {
    if (failNextMessage) { failNextMessage = false; throw new Error('enqueue failed') }
    messages.push({ from, to, content }); return { id: messages.length }
  },
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => storedState,
}))

const { decideIdleAlert, NO_IDLE_STATE, idleDigestLine } = await import('../idle-agent.js')
import type { IdleAgentThresholds } from '../idle-agent.js'
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
    subagentNoticeWindowMs: 2 * 3_600_000, subagentSilentMs: 2 * 3_600_000,
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

  it('a tartas lejarta UTAN a riasztas NEM inditja ujra a tartast es nem nullazza a tetlen-szakaszt (didi 31695)', () => {
    const first = decideIdleAlert({ ...base, runningSubagents: 1 }, NO_IDLE_STATE, T, now)
    const t1 = now + 121 * 60_000
    const past = decideIdleAlert({ ...base, runningSubagents: 1 }, { ...first.next, idleSinceMs: now - 60 * 60_000 }, T, t1)
    expect(past.decision).toMatchObject({ alert: true, reason: 'wake-agent' })
    expect(past.next.subagentsSinceMs).toBe(now)          // az ora a folyamatos jelenletet meri, nem a riasztast
    expect(past.next.idleSinceMs).not.toBeNull()          // a szakasz tovabb er, igy a 2. fokozat elerheto
  })

  // didi 31695 szimulacioja: 10 ora, percenkenti tick, tetlen agens 2 nyitott kartyaval, a watcher
  // valodi kuszobeivel; a futo al-agens-sor az egesz idon at latszik. A kontroll al-agens nelkul fut.
  // `trace`: a cselekves-nyom az adott percben (az utolso kimeno uzenet / kartya-komment ideje, ms),
  // undefined = nincs merve, null = nincs nyom.
  const simulate = (subagents: number, trace?: (min: number) => number | null | undefined, thr: IdleAgentThresholds = T) => {
    let st = { ...NO_IDLE_STATE } as typeof NO_IDLE_STATE
    const log: Array<{ min: number; reason: string }> = []
    for (let min = 0; min <= 600; min++) {
      const r = decideIdleAlert(
        { ...base, ownWorkCount: 2, ownWorkIds: ['a', 'b'], runningSubagents: subagents, lastActionAtMs: trace?.(min) },
        st, thr, now + min * 60_000,
      )
      st = r.next
      if (r.decision.alert) log.push({ min, reason: r.decision.reason })
    }
    return log
  }
  // Az agens minden percben ir valamit (a nyom mindig friss): a sor mellett DOLGOZIK.
  const alwaysTraced = (min: number) => now + min * 60_000
  const escalations = (l: Array<{ reason: string }>) => l.filter((e) => e.reason === 'idle-with-work').length

  it('sub-agent sor + nyom -> 1 ertesites / 2 h (marveen 26435 (1))', () => {
    const control = simulate(0)
    const held = simulate(1, alwaysTraced)
    expect(escalations(control)).toBe(20)                  // pozitiv kontroll: a szimulacio MER eszkalaciot
    expect(held.filter((e) => e.min < 120)).toEqual([])    // az elso 2 ora csendes
    expect(held[0]).toMatchObject({ reason: 'wake-agent' })
    // A tartas utan 2 oras ablakonkent EGY ertesites (132 ebresztes, majd 252, 372, 492 eszkalacio), nem 30 percenkent.
    expect(held.map((e) => e.min)).toEqual([132, 252, 372, 492])
    expect(held.slice(1).every((e) => e.reason === 'idle-with-work')).toBe(true)
    // Egyetlen 2 oras ablakban sincs ket ertesites.
    for (let a = 120; a + 120 <= 600; a += 1) expect(held.filter((e) => e.min >= a && e.min < a + 120).length).toBeLessThanOrEqual(1)
  })

  it('sub-agent sor + nulla nyom a TELJES 2 h tartasig -> eszkalacio (marveen 26435 (2), 26460)', () => {
    const control = simulate(0)
    const ghost = simulate(1, () => null)                  // sor latszik, az agens SEMMIT nem kuldott/irt
    expect(ghost.length).toBeGreaterThan(0)
    expect(ghost.filter((e) => e.min < 120)).toEqual([])   // 26460: a nyom-ablak = a tartas, 120 perc ELOTT nincs eszkalacio
    expect(ghost[0]).toEqual({ min: 132, reason: 'wake-agent' })
    // Szellem-sor: a menet a 120. perc utan az al-agens nelkulivel egyezik (szokasos 30 perces menet, nem 2 oras ablak).
    expect(ghost).toEqual(control.filter((e) => e.min <= 480).map((e) => ({ ...e, min: e.min + 120 })))
    expect(escalations(ghost)).toBeGreaterThan(escalations(simulate(1, alwaysTraced)))   // a nyom NELKUL tobb ertesites: nincs ablak
  })

  it('marveen 26460: 85 perc nulla nyom al-agens-sorral NEM eszkalal (merve: mandark 85, dexter 80 perc legitim csend)', () => {
    const first = decideIdleAlert({ ...base, runningSubagents: 2, lastActionAtMs: null }, NO_IDLE_STATE, T, now)
    // A tetlen-szakasz hosszu es van nyitott munka: ha a hold eldobodna, EBRESZTENE.
    const st = { ...first.next, idleSinceMs: now - 60 * 60_000 }
    for (const min of [30, 85, 119]) {
      const r = decideIdleAlert({ ...base, runningSubagents: 2, lastActionAtMs: null }, st, T, now + min * 60_000)
      expect(r.decision).toEqual({ alert: false, reason: 'subagents-running' })
    }
    // Pozitiv kontroll: ugyanez 120 perc utan, nulla nyommal, ESZKALAL.
    const at120 = decideIdleAlert({ ...base, runningSubagents: 2, lastActionAtMs: null }, st, T, now + 120 * 60_000)
    expect(at120.decision).toMatchObject({ alert: true, reason: 'wake-agent' })
    // Es a 85 perces csend egy hosszu, nyom nelkuli futason is csendes: a sim 85. perce.
    expect(simulate(1, () => null).filter((e) => e.min <= 85)).toEqual([])
  })

  it('a nyom a sor MEGJELENESE UTANI: egy regi nyom nem szamit (a szellem-sor mellett is eszkalal)', () => {
    const stale = simulate(1, () => now - 5 * 3_600_000)   // az utolso uzenet 5 oraval a sor elott
    expect(stale[0].min).toBe(132)
    expect(stale.filter((e) => e.min < 120)).toEqual([])
  })

  it('a nyom CSAK kartya-komment is lehet (nem csak uzenet): a sor mellett a tartas marad', () => {
    // A hivo a ket forras maximumat adja at; itt a komment a friss, az uzenet regi -- a dontes csak a maximumot latja.
    const held = simulate(1, (min) => now + min * 60_000 - 1000)
    expect(held.filter((e) => e.min < 120)).toEqual([])
  })

  it('MEGFELELTETES: nyom-ellenorzes nelkuli kuszob (subagentSilentMs hianyzik) -> a szellem-sor ablakonkent egyszer, nem 30 percenkent', () => {
    const { subagentSilentMs: _drop, ...noSilent } = T
    const ghost = simulate(1, () => null, noSilent)
    expect(ghost.filter((e) => e.min < 120)).toEqual([])
    expect(ghost.map((e) => e.min)).toEqual([132, 252, 372, 492])   // nyom-ellenorzes nelkul a szellem is csak az ablak szerint szol
  })

  it('MEGFELELTETES: ablak-kuszob nelkul a tartas utan a szokasos 30 perces menet fut', () => {
    const { subagentNoticeWindowMs: _drop, ...noWindow } = T
    const held = simulate(1, alwaysTraced, noWindow)
    expect(escalations(held)).toBeGreaterThan(10)
  })

  it('az elnyomott ertesites megtartja a tetlen-szakaszt es nem viszi el az ertesites konyvelet', () => {
    const t0 = now + 130 * 60_000
    const st = { ...NO_IDLE_STATE, idleSinceMs: t0 - 20 * 60_000, lastWakeAt: t0 - 18 * 60_000, subagentsSinceMs: now, lastSubagentNoticeAt: t0 - 18 * 60_000 }
    const r = decideIdleAlert({ ...base, ownWorkCount: 2, runningSubagents: 1, lastActionAtMs: t0 - 1000 }, st, T, t0)
    expect(r.decision).toEqual({ alert: false, reason: 'subagents-notice-window' })
    expect(r.next.idleSinceMs).toBe(st.idleSinceMs)
    expect(r.next.lastAlertAt).toBeNull()
    expect(r.next.lastSubagentNoticeAt).toBe(st.lastSubagentNoticeAt)
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
    storedState = null; failNextMessage = false
    outboundSec = null; commentRows = []; cardRows = []
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

  it('(a) a watcher 2 oras tartasa: 90 perc mulva meg al-agenses, 121 perc mulva mar nem (a THRESHOLDS bekotese)', () => {
    workcheck('x', 'assigned_open_cards')
    panes.set('agent-x', pane({ rows: [runningRow('b19-pw', 18)] }))
    outboundSec = () => Math.floor(Date.now() / 1000)       // az agens vegig ir valamit: a nyom nem engedi el a tartast
    tick()
    expect(reasonOf('x')).toBe('subagents-running')
    vi.setSystemTime(NOW + 90 * 60_000); tick()
    expect(reasonOf('x')).toBe('subagents-running')
    vi.setSystemTime(NOW + 121 * 60_000); tick()
    expect(reasonOf('x')).not.toBe('subagents-running')
  })

  // --- a cselekves-nyom es az ertesites-ablak bekotese (marveen 26435) ---------------------------
  const nowSec = () => Math.floor(Date.now() / 1000)
  const openCards = () => {
    cardRows = ['a', 'b'].map((n) => ({
      id: `card-${n}`, title: `t-${n}`, status: 'in_progress', assignee: 'x', priority: 'normal',
      archived_at: null, updated_at: nowSec(), due_date: null,
    }))
  }
  const rowsPane = () => pane({ rows: [runningRow('b19-pw', 18)] })

  it('(a/nyom) sor + friss kimeno uzenet: 45 perc mulva is tartas (a nyom jelen van)', () => {
    workcheck('x', 'assigned_open_cards'); panes.set('agent-x', rowsPane())
    outboundSec = () => nowSec()
    tick()
    vi.setSystemTime(NOW + 45 * 60_000); tick()
    expect(reasonOf('x')).toBe('subagents-running')
  })

  it('(a/nyom) sor + NULLA nyom: 85 perc meg tartas (marveen 26460), 121 perc utan elengedi, az agens ugy ertekelodik, mintha nem lenne al-agense', () => {
    workcheck('x', 'assigned_open_cards'); panes.set('agent-x', rowsPane())
    outboundSec = null
    tick()
    vi.setSystemTime(NOW + 85 * 60_000); tick()
    expect(reasonOf('x')).toBe('subagents-running')         // a legitim 85 perces csend NEM eszkalal
    vi.setSystemTime(NOW + 121 * 60_000); tick()
    expect(reasonOf('x')).not.toBe('subagents-running')
  })

  it('(a/nyom) a nyom lehet CSAK kartya-komment is (az agens sajat komentje), uzenet nelkul', () => {
    workcheck('x', 'assigned_open_cards'); openCards(); panes.set('agent-x', rowsPane())
    outboundSec = null
    commentRows = [{ card_id: 'card-a', author: 'X', at: Math.floor((NOW + 20 * 60_000) / 1000) }]   // nagybetu: a szerzo-egyezes kis/nagybetu-fuggetlen
    const at = (min: number) => { vi.setSystemTime(NOW + min * 60_000); tick(); return reasonOf('x') }
    expect(at(0)).toBe('subagents-running')
    expect(at(121)).toBe('not-sustained')
    expect(at(134)).toBe('wake-agent')
    expect(at(152)).toBe('subagents-notice-window')        // nyom van: a tartas utan az ablak szerint, nem szellem-sorkent
  })

  it('(a/nyom) MEGFELELTETES: egy MAS szerzo kommentje nem nyom', () => {
    workcheck('x', 'assigned_open_cards'); openCards(); panes.set('agent-x', rowsPane())
    commentRows = [{ card_id: 'card-a', author: 'marveen', at: Math.floor((NOW + 20 * 60_000) / 1000) }]
    const at = (min: number) => { vi.setSystemTime(NOW + min * 60_000); tick(); return reasonOf('x') }
    expect(at(0)).toBe('subagents-running')
    expect(at(121)).toBe('not-sustained')
    expect(at(134)).toBe('wake-agent')
    expect(at(152)).not.toBe('subagents-notice-window')    // nyom nincs: szellem-sor, a szokasos menet fut, nem az ablak
  })

  it('(a/ablak) a tartas utan, amig a sor latszik, 2 oras ablakonkent EGY ertesites (a THRESHOLDS bekotese)', () => {
    workcheck('x', 'assigned_open_cards'); openCards(); panes.set('agent-x', rowsPane())
    outboundSec = () => nowSec()                            // az agens vegig ir valamit: nincs szellem-gyanu
    const at = (min: number) => { vi.setSystemTime(NOW + min * 60_000); tick(); return reasonOf('x') }
    expect(at(0)).toBe('subagents-running')
    expect(at(121)).toBe('not-sustained')                   // a tartas lejart, a szakasz indul
    expect(at(134)).toBe('wake-agent')                      // az ablak EGYETLEN ertesitese
    expect(at(152)).toBe('subagents-notice-window')         // az eszkalacio mar az ablakba esik: elnyomva
    expect(at(165)).toBe('subagents-notice-window')         // 31 perc: a 30 perces ablak itt mar kiengedne
    expect(at(255)).toBe('idle-with-work')                  // az uj ablak ertesitese, a szakasz megmaradt
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

  // R3 (marveen's decision): az idle-szakasz ELSO "nincs kiosztva" ertesitese ELO uzenet marad (a
  // visszajatszas: 53/71 utan a koordinator munkat osztott), csak az ISMETLESEK mennek a napi osszesitobe.
  // A 4 ora + 1 perc azert kell: az azonos (ures) huzo-lista ismetleset a 88998fea 4 oraig elnyomja.
  const SPELL_REPEAT_MS = 4 * 3_600_000 + 60_000
  const noWorkMessages = () => toCoordinator().filter(m => m.content.includes('NINCS RA KIOSZTVA'))
  const digestLines = () => (existsSync(digestPath()) ? readFileSync(digestPath(), 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])
  const idleX = () => {
    workcheck('x', 'assigned_open_cards')
    mkdirSync(join(hoisted.root, 'store'), { recursive: true })
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane())
  }

  it('(c/R3) az idle-szakasz ELSO "nincs kiosztva" ertesitese ELO uzenet a koordinatornak, nem a napi osszesitobe', () => {
    idleX()
    tick()
    expect(noWorkMessages()).toHaveLength(1)
    expect(digestLines()).toHaveLength(0)
  })

  it('(c/R3) az ISMETLES ugyanabban az idle-szakaszban a napi osszesitobe megy, uzenet nem', () => {
    idleX()
    tick()
    vi.setSystemTime(NOW + SPELL_REPEAT_MS); tick()
    expect(noWorkMessages()).toHaveLength(1)
    const lines = digestLines()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ ts: NOW + SPELL_REPEAT_MS, agent: 'x', kind: 'assigned_open_cards' })
  })

  it('(c/R3) UJ idle-szakasz (kozben dolgozott) ujra ELO uzenetet kap', () => {
    idleX()
    tick()
    paneStates.set(panes.get('agent-x') as string, 'busy')
    vi.setSystemTime(NOW + 10 * 60_000); tick()           // dolgozik: a szakasz veget er
    paneStates.delete(panes.get('agent-x') as string)
    vi.setSystemTime(NOW + 20 * 60_000); tick()           // ujra tetlen: uj szakasz kezdodik
    vi.setSystemTime(NOW + 40 * 60_000 + SPELL_REPEAT_MS); tick()
    expect(noWorkMessages()).toHaveLength(2)
    expect(digestLines()).toHaveLength(0)
  })

  it('(c/R3) az elso ertesites, amit nem lehetett sorba tenni, NEM "elhasznalt": a kovetkezo elo megy', () => {
    idleX()
    failNextMessage = true
    tick()
    expect(noWorkMessages()).toHaveLength(0)
    expect(digestLines()).toHaveLength(1)                 // nem nyelodott el: a napi osszesitoben van
    vi.setSystemTime(NOW + SPELL_REPEAT_MS); tick()
    expect(noWorkMessages()).toHaveLength(1)
    expect(digestLines()).toHaveLength(1)
  })

  it('(c) AZ UT KIFELE: ha a napi osszesito nem irhato, az ismetles a regi uzenetkent megy (nem nyelodik el)', () => {
    workcheck('x', 'assigned_open_cards')
    // store/ nincs -> appendFileSync ENOENT
    storedState = { idleSinceMs: NOW - 20 * 60_000, lastAlertAt: null, lastWakeAt: null, updatedAt: NOW, staleIdleDropped: false }
    panes.set('agent-x', pane())
    tick()                                                // elso: elo uzenet
    vi.setSystemTime(NOW + SPELL_REPEAT_MS); tick()       // ismetles: a digest nem irhato -> uzenet
    expect(existsSync(digestPath())).toBe(false)
    expect(noWorkMessages()).toHaveLength(2)
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
