// A `staleCounterOnly` BEKOTESE -- kartya b5bff340, didi merese 2026-08-27.
//
// A ket VEG kulon-kulon vedett volt:
//   - `busyEvidence(pane) === 'counter'`  -> pane-state.test.ts
//   - a dontesi oldal (`countsAsIdleForNoWork`) -> idle-agent.test.ts:871, KEZZEL adott
//     `staleCounterOnly: true` ertekkel
// A KOZTUK LEVO SOR viszont sehol. Didi elvagta a szamitast, es mind a 3803 teszt ZOLD
// maradt. Ez a `jelenlet-vagy-megfeleltetes` osztaly: ket vedett veg, vedetlen bekotes.
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
