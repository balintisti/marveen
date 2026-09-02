// A `json-dup-keys` modul BEKOTESE -- kartya 6872b0aa (a 0aa0161b folytatasa).
//
// A modul 2026-08-29-en INERT-kent landolt a torzson: letezett, sajat tesztjei zoldek
// voltak, es NULLA produkcios hivoja volt. Ez a spec azt rogziti, hogy MOSTANTOL HIV
// valaki -- es hogy a hivas TENYLEG megszolal a defektusra, nem csak le van irva.
//
// A VEDETT DEFEKTUS: a `JSON.parse` egy duplikalt kulcsbol CSAK AZ UTOLSOT tartja meg.
// Egy settings-fajl ket "PreToolUse" blokkal tehat NEMAN eldobja az elsoben allo osszes
// hookot -- az or nem hibazik, nem figyelmeztet, csak nincs. A bizonyitek KIZAROLAG a
// NYERS szovegben letezik, ezert kell a parse ELOTT megnezni.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const warns: Array<{ ctx: Record<string, unknown>; msg: string }> = []
vi.mock('../logger.js', () => ({
  logger: {
    warn: (ctx: Record<string, unknown>, msg: string) => { warns.push({ ctx, msg }) },
    info: () => {}, debug: () => {}, error: () => {},
  },
}))

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})

const { ensureAgentHooks, ensureAgentStalenessHook, ensureEgressGate,
        ensureGovernanceGateCommands } = await import('../web/agent-scaffold.js')

describe('json-dup-keys BE VAN KOTVE az agent-settings olvasasaba (6872b0aa)', () => {
  beforeEach(() => {
    warns.length = 0
    agentRoot = mkdtempSync(join(tmpdir(), 'dupwire-'))
    mkdirSync(join(agentRoot, '.claude'), { recursive: true })
  })
  afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

  function writeSettings(body: string): void {
    writeFileSync(join(agentRoot, '.claude', 'settings.json'), body)
  }

  it('POZITIV: ket "PreToolUse" kulcs eseten MEGSZOLAL, es megnevezi a kulcsot', () => {
    // Ket hook-blokk. A JSON.parse csak a masodikat tartja meg -- az elsoben allo
    // gate NEMAN eltunik. Ez a fixture PONTOSAN ezt az alakot allitja elo.
    writeSettings('{\n "hooks": {\n  "PreToolUse": [{"a":1}],\n  "PreToolUse": [{"b":2}]\n }\n}\n')
    ensureAgentHooks('proba-agens')
    const hit = warns.find(w => String(w.msg).includes('duplicate JSON keys'))
    expect(hit, `nem szolalt meg; warns=${JSON.stringify(warns)}`).toBeTruthy()
    expect(JSON.stringify(hit!.ctx.dupKeys)).toContain('PreToolUse')
  })

  it('NEGATIV KONTROLL: duplikatum NELKUL NEM szolal meg', () => {
    // Enelkul a fenti allitas akkor is zold lenne, ha a kod MINDEN fajlra figyelmeztetne
    // -- egy or, ami mindig szol, ugyanannyit er, mint amelyik soha.
    writeSettings('{\n "hooks": {\n  "PreToolUse": [{"a":1}],\n  "PostToolUse": [{"b":2}]\n }\n}\n')
    ensureAgentHooks('proba-agens')
    expect(warns.find(w => String(w.msg).includes('duplicate JSON keys'))).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A BEKOTES OTBOL KETTOT FEDETT -- kartya e3f8f2fd.
//
// Egy AST-cenzus megmerte, hany fuggveny irja a `settingsPath`-t EBBEN a fajlban:
// OT, nem ketto. A masik harom ugyanazt a read-modify-write mintat vegezte egy
// csupasz egysoros parse-szal, tehat pontosan ugyanaz a defektus allt fenn benne.
// A javitas nem a beszurt blokk negyedik-otodik masolata, hanem egy kozos
// ellenorzott olvasas: az OR AZ UTBAN van, nem a szerzo emlekezeteben.
// ---------------------------------------------------------------------------
describe('a dup-key or MIND AZ OT settingsPath-irot fedi (e3f8f2fd)', () => {
  beforeEach(() => {
    warns.length = 0
    agentRoot = mkdtempSync(join(tmpdir(), 'dupwire5-'))
    mkdirSync(join(agentRoot, '.claude'), { recursive: true })
  })
  afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

  const DUP = '{\n "hooks": {\n  "PreToolUse": [{"a":1}],\n  "PreToolUse": [{"b":2}]\n }\n}\n'
  const CLEAN = '{\n "hooks": {\n  "PreToolUse": [{"a":1}],\n  "PostToolUse": [{"b":2}]\n }\n}\n'
  const write = (body: string) =>
    writeFileSync(join(agentRoot, '.claude', 'settings.json'), body)
  const fired = () => warns.filter(w => String(w.msg).includes('duplicate JSON keys'))

  // Egyenkent, mert egy osszevont "valamelyik megszolal" allitas AKKOR IS zold lenne,
  // ha csak az egyik van bekotve -- vagyis pont a mert defektust engedne at.
  const SITES: Array<[string, (n: string) => boolean]> = [
    ['ensureAgentStalenessHook', ensureAgentStalenessHook],
    ['ensureEgressGate', ensureEgressGate],
    ['ensureGovernanceGateCommands', ensureGovernanceGateCommands],
  ]

  for (const [label, fn] of SITES) {
    it(`POZITIV: ${label} megszolal a duplikatumra, es megnevezi MAGAT`, () => {
      write(DUP)
      fn('proba-agens')
      const hit = fired()
      expect(hit.length, `nem szolalt meg; warns=${JSON.stringify(warns)}`).toBeGreaterThan(0)
      // A `site` mezo azert kell, mert ot hivo eseten a puszta "megszolalt valaki"
      // nem mondja meg, MELYIK -- es a naplo olvasoja ebbol dolgozik.
      expect(hit.map(h => h.ctx.site)).toContain(label)
    })

    it(`NEGATIV KONTROLL: ${label} duplikatum NELKUL nem szolal meg`, () => {
      write(CLEAN)
      fn('proba-agens')
      expect(fired()).toEqual([])
    })
  }
})
