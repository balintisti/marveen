// A `staleCounterOnly` BEKOTESE -- kartya b5bff340, didi merese 2026-08-27.
//
// A ket VEG kulon-kulon vedett volt:
//   - `busyEvidence(pane) === 'counter'`  -> pane-state.test.ts
//   - a dontesi oldal (`countsAsIdleForNoWork`) -> idle-agent.test.ts:871, KEZZEL adott
//     `staleCounterOnly: true` ertekkel
// A KOZTUK LEVO SOR viszont sehol. Didi elvagta a szamitast, es mind a 3803 teszt ZOLD
// maradt. Ez a `jelenlet-vagy-megfeleltetes` osztaly: ket vedett veg, vedetlen bekotes.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from './helpers/strip-comments.js'

const capturePane = vi.fn()
const detectPaneState = vi.fn()
const busyEvidence = vi.fn()

vi.mock('../web/agent-process.js', () => ({
  capturePane: (...a: unknown[]) => capturePane(...a),
  isAgentRunning: () => true,
}))
vi.mock('../web/channel-mcp-reconnect.js', () => ({ resolveAgentSession: () => 'agent-x' }))
vi.mock('../web/agent-config.js', () => ({
  listAgentNames: () => ['x'], agentDir: () => '/tmp/x', readAgentRemoteHost: () => null,
}))
vi.mock('../pane-state.js', () => ({
  detectPaneState: (...a: unknown[]) => detectPaneState(...a),
  busyEvidence: (...a: unknown[]) => busyEvidence(...a),
}))

const { readPane } = await import('../web/idle-agent-watcher.js')

describe('readPane -- a staleCounterOnly BEKOTESE (b5bff340)', () => {
  beforeEach(() => {
    capturePane.mockReset(); detectPaneState.mockReset(); busyEvidence.mockReset()
    capturePane.mockReturnValue('valamilyen pane-szoveg')
  })

  it('POZITIV: ha a busyEvidence "counter", a staleCounterOnly IGAZ', () => {
    detectPaneState.mockReturnValue('busy')
    busyEvidence.mockReturnValue('counter')
    expect(readPane('x').staleCounterOnly).toBe(true)
  })

  it('NEGATIV: ha a busyEvidence MAS, a staleCounterOnly HAMIS', () => {
    // Enelkul egy MINDIG-IGAZ valtozat is atmenne a pozitiv teszten.
    detectPaneState.mockReturnValue('busy')
    for (const ev of ['spinner', 'tokens', 'none']) {
      busyEvidence.mockReturnValue(ev)
      expect(readPane('x').staleCounterOnly, `evidence=${ev}`).toBe(false)
    }
  })

  it('a MEGFELELTETES: a bemenet valtozasa MOZDITJA a kimenetet', () => {
    // Ez az, amit a ket veg kulon-kulon NEM allit: hogy EZ a ket dolog van
    // osszekotve. Egy fix `false` mindket elozo tesztet megbuktatna, de egy
    // MASIK forrasbol szamolt ertek nem -- ezert megy vegig a par.
    detectPaneState.mockReturnValue('busy')
    const parok: Array<[string, boolean]> = [
      ['counter', true], ['spinner', false], ['counter', true], ['none', false],
    ]
    for (const [ev, vart] of parok) {
      busyEvidence.mockReturnValue(ev)
      expect(readPane('x').staleCounterOnly, `evidence=${ev}`).toBe(vart)
    }
    expect(busyEvidence).toHaveBeenCalledTimes(parok.length)
  })

  it('a korai kilepesek MIND hamisat adnak (nincs pane / ismeretlen allapot)', () => {
    detectPaneState.mockReturnValue('unknown')
    busyEvidence.mockReturnValue('counter')          // meg IGY sem lehet igaz
    expect(readPane('x')).toEqual({ idle: null, staleCounterOnly: false })

    capturePane.mockReturnValue(null)
    expect(readPane('x')).toEqual({ idle: null, staleCounterOnly: false })
  })
})

// THE EVALUATION LOG IS A BINDING, AND BINDINGS ARE WHAT THIS FILE EXISTS FOR (card 4cbc8af9,
// marveen's request 2026-08-29). The sweep is not exported -- driving it needs the db, the
// message writer and the timer -- so this is STRUCTURAL, and weaker than a behavioural test in
// exactly the way the header above describes. It is here because the alternative was shipping
// an observability line whose own wiring nothing checked, on a card about unchecked wiring.
//
// What it pins is the ORDER: the evaluation must be logged BEFORE the branch, or zero-orphan
// sweeps go unrecorded and the silence means two things again.
describe('the ownerless pull-list is logged on EVALUATION, not only on firing (4cbc8af9)', () => {
  const src = stripComments(
    readFileSync(join(import.meta.dirname, '..', 'web', 'idle-agent-watcher.ts'), 'utf8'),
  )
  const branch = src.slice(src.indexOf("decision.reason === 'idle-no-work'"))

  it('logs orphanCount before it branches on it', () => {
    const evalAt = branch.indexOf('orphanCount: pull.length')
    expect(evalAt, 'the evaluation must record the count it evaluated').toBeGreaterThan(-1)
    const branchAt = branch.indexOf('if (pull.length > 0)')
    expect(branchAt, 'the pull-list branch not found').toBeGreaterThan(-1)
    // NEGATIVE CONTROL for the whole assertion: the count has to be computed first, or the
    // order below is trivially satisfiable by a line that reads nothing.
    expect(branch.indexOf('orphanPullList(cards')).toBeLessThan(evalAt)
    expect(evalAt, 'a zero-orphan sweep must still be recorded -- logging only inside the branch is the silence this card is about')
      .toBeLessThan(branchAt)
  })
})
