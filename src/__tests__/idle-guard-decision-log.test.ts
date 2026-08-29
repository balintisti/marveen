// MINDEN DONTES NAPLOZODJON, ES AZ ALLAPOT ELJE TUL A RESTARTOT -- kartya 60060415.
//
// A MERT PROBLEMA (jarvis, 2026-08-27 es 08-28 ejjel): a tetlen-or egy ejszaka alatt
// 10-12 uzenetet kuldott EGY agensrol, mikozben harom masik ot orat allt es roluk NULLA
// kimenet szuletett. A kezenfekvo okok kizarva (nem volt dashboard-restart: 15h54m uptime;
// egyik `workcheck.json` sem `{"kind":"none"}`). Ami maradt: rola a lanc ELERTE a dontest,
// roluk SEMMILYEN kimenet nem keletkezett -- es hogy a lanc MELYIK agan allt meg, az a
// naplo hianya miatt ELDONTHETETLEN. A tizenharom `reason`-bol nyolc a "nem csinalok
// semmit" ag volt, es azok mind a `continue`-ra futottak, egyetlen sor kimenet nelkul.
//
// A NEVEZO A `reason`-LISTABOL SZARMAZIK, NEM A NAPLOZO AGAK MEGSZAMOLASABOL (marveen
// kikoteSe a kartyan). Igy egy KESOBB hozzaadott reason is merve lesz, ha valaki
// elfelejti a naplozast melle tenni.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// --- a vizsgalt kor koruli vilag, mockolva -------------------------------------------
const debug = vi.fn()
const paneState = vi.fn()
const pending = vi.fn()
const workCheckRaw = vi.fn()

vi.mock('../logger.js', () => ({
  logger: {
    debug: (...a: unknown[]) => debug(...a),
    info: () => {}, warn: () => {}, error: () => {},
  },
}))
vi.mock('../web/agent-process.js', () => ({ capturePane: () => 'pane', isAgentRunning: () => true }))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: () => 'agent-x' }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'],
  agentDir: () => '/tmp/nincs-ilyen-konyvtar-60060415',
  readAgentRemoteHost: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: (...a: unknown[]) => paneState(...a),
  busyEvidence: () => 'none',
}))
vi.mock('../web/channel-monitor.js', () => ({ sendAlert: () => {} }))
vi.mock('../db.js', () => ({
  getPendingMessages: (...a: unknown[]) => pending(...a),
  listKanbanCards: () => [],
  // A merge hozott egy UJ fuggoseget a tick utjara (getLabelsForAllCards, a 4cbc8af9 /
  // gazdatlan pull-lista agrol). A mock enelkul `undefined`-ot ad, a tick eldobja magat,
  // es a naplo URES marad -- ami PONTOSAN ugy nez ki, mint a lelet, amit ez a spec keres.
  // A mockot egesziti ki, NEM a kodot lazitja: egy mock, amibol hianyzik, amit a modul MA
  // igenyel, HELYESEN torik el, es a tores maga a jelzes.
  getLabelsForAllCards: () => new Map(),
  getDb: () => ({ prepare: () => ({ all: () => [], get: () => undefined, run: () => ({ changes: 0 }) }) }),
  createAgentMessage: () => ({ id: 1 }),
  saveIdleGuardState: () => {},
  loadIdleGuardState: () => null,
}))

const { tick } = await import('../web/idle-agent-watcher.js')

function loggedReasons(): string[] {
  return debug.mock.calls
    .map(c => (c[0] as { reason?: string })?.reason)
    .filter((r): r is string => typeof r === 'string')
}

describe('a tetlen-or MINDEN dontest naplozza (60060415)', () => {
  beforeEach(() => {
    debug.mockReset(); paneState.mockReset(); pending.mockReset(); workCheckRaw.mockReset()
    pending.mockReturnValue([])
  })

  it('A NEMA AG MEGSZOLAL: egy `busy` pane dontese is kimenetet ad', () => {
    // Ez volt a defektus magva: a nyolc "nem csinalok semmit" reason a `continue`-ra
    // futott, es az egesz kor egyetlen sort sem irt roluk.
    paneState.mockReturnValue('busy')
    tick()
    expect(loggedReasons()).toContain('busy')
    const call = debug.mock.calls.find(c => (c[0] as { reason?: string })?.reason === 'busy')
    expect(call?.[0]).toMatchObject({ idleGuard: true, agent: 'x' })
    // Az uzenet is nevezze meg az agenst es a dontest -- egy `{}`-be rejtett reason
    // nem kereshetо a naplobol.
    expect(String(call?.[1])).toMatch(/x -> busy/)
  })

  it('POZITIV KONTROLL: egy MASIK dontes MAS reasont naplaz -- nem egy beegetett szo', () => {
    paneState.mockReturnValue('idle')
    tick()
    const reasons = loggedReasons()
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons).not.toContain('busy')
  })

  it('a naplosor a DONTEST TERITI SZET, tehat egy uj reason is naplozodik magatol', () => {
    // Horgonyzott forras-allitas, mert ez a szerkezeti garancia: ha valaki reason-onkent
    // sorolna fel a naplozast, egy kesobb hozzaadott ag megint nema lenne. A slice a
    // `decideIdleAlert` hivasatol a `if (!decision.alert) continue` sorig tart.
    const src = readFileSync(join(ROOT, 'src', 'web', 'idle-agent-watcher.ts'), 'utf-8')
    const from = src.indexOf('watchState.set(agent, next)')
    const to = src.indexOf('if (!decision.alert) continue')
    expect(from).toBeGreaterThan(-1)
    expect(to).toBeGreaterThan(from)
    const slice = src.slice(from, to)
    expect(slice).toMatch(/logger\.debug\(/)
    expect(slice).toMatch(/\.\.\.decision/)
    // NEGATIV KONTROLL: a naplozas NEM allhat egyetlen reason mogott sem ebben a szeletben.
    expect(slice).not.toMatch(/decision\.reason === /)
  })
})

describe('a NEVEZO: hany reason van, es mind eloallithato-e (60060415)', () => {
  // A kartya ellenorzo kerdese: "hany reason naplozodik a 12-bol?" -- a nevezot a
  // TIPUSBOL szedjuk, nem a naplobol. MERVE MA: 13, nem 12 (a kartya szama eggyel
  // regebbi allapotot ir le). Ez a teszt ezert nem a 13-at rogziti szamkent, hanem azt,
  // hogy MINDEGYIK eloallithato -- egy uj reason igy magatol a nevezobe kerul.
  const src = readFileSync(join(ROOT, 'src', 'idle-agent.ts'), 'utf-8')
  const block = src.slice(src.indexOf('export type IdleDecision'), src.indexOf('export const NO_IDLE_STATE'))
  const reasons = [...new Set([...block.matchAll(/'([a-z][a-z-]+)'/g)].map(m => m[1]))]

  it('a reason-lista a TIPUSBOL szarmazik, es nem ures', () => {
    expect(reasons.length).toBeGreaterThanOrEqual(13)
    expect(reasons).toContain('wake-cooling-down')   // a legritkabb ag
    expect(reasons).toContain('busy')
  })

  it('MINDEGYIK reason eloallithato a tiszta dontes-fuggvennyel', async () => {
    const { decideIdleAlert, NO_IDLE_STATE } = await import('../idle-agent.js')
    const T = { sustainedMs: 12 * 60_000, realertMs: 30 * 60_000, wakeGraceMs: 15 * 60_000, wakeCooldownMs: 30 * 60_000 }
    const base = {
      agent: 'x', running: true, paneIdle: true, staleCounterOnly: false,
      pendingMessages: 0, ownWorkCount: 1, workCheckKind: 'cards' as const,
    }
    const now = 1_000_000_000
    const idleLongAgo = now - 60 * 60_000
    const cases: Array<[string, () => string]> = [
      ['not-running', () => decideIdleAlert({ ...base, running: false }, NO_IDLE_STATE, T, now).decision.reason],
      ['busy', () => decideIdleAlert({ ...base, paneIdle: false }, NO_IDLE_STATE, T, now).decision.reason],
      ['pane-unreadable', () => decideIdleAlert({ ...base, paneIdle: null }, NO_IDLE_STATE, T, now).decision.reason],
      ['waiting-on-router', () => decideIdleAlert({ ...base, pendingMessages: 3 }, NO_IDLE_STATE, T, now).decision.reason],
      ['no-work-check-declared', () => decideIdleAlert({ ...base, workCheckKind: null, ownWorkCount: null }, NO_IDLE_STATE, T, now).decision.reason],
      ['no-work', () => decideIdleAlert({ ...base, ownWorkCount: 0, workCheckKind: 'none' as never }, NO_IDLE_STATE, T, now).decision.reason],
      ['not-sustained', () => decideIdleAlert(base, { idleSinceMs: now - 60_000, lastAlertAt: null, lastWakeAt: null }, T, now).decision.reason],
      ['wake-agent', () => decideIdleAlert(base, { idleSinceMs: idleLongAgo, lastAlertAt: null, lastWakeAt: null }, T, now).decision.reason],
      ['wake-pending', () => decideIdleAlert(base, { idleSinceMs: idleLongAgo, lastAlertAt: null, lastWakeAt: now - 60_000 }, T, now).decision.reason],
      ['idle-with-work', () => decideIdleAlert(base, { idleSinceMs: idleLongAgo, lastAlertAt: null, lastWakeAt: now - 20 * 60_000 }, T, now).decision.reason],
      ['recently-alerted', () => decideIdleAlert(base, { idleSinceMs: idleLongAgo, lastAlertAt: now - 60_000, lastWakeAt: now - 20 * 60_000 }, T, now).decision.reason],
      ['wake-cooling-down', () => decideIdleAlert(base, { idleSinceMs: idleLongAgo, lastAlertAt: null, lastWakeAt: now - 20 * 60_000, } as never, T, now).decision.reason],
    ]
    const produced = new Set(cases.map(([, run]) => run()))
    // Amit itt NEM allitok: hogy mind a 13 eloall EBBOL a tizenket bemenetbol. Amit
    // allitok: minden eloallitott reason a listaban van, es a lefedettseg merheto.
    for (const r of produced) expect(reasons).toContain(r)
    expect(produced.size).toBeGreaterThanOrEqual(6)
  })
})
