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

const { ensureAgentHooks } = await import('../web/agent-scaffold.js')

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
