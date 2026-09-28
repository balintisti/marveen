// Tests for the evidence-rule block that every agent's CLAUDE.md carries.
//
// Background: on 2026-08-12 the main agent asserted three unverified technical
// claims in a row about the Meta Ads connector (it had "expired", it had
// "stopped working", a sub-agent "could never reach it"). All three were false,
// and a request to an external contractor was already drafted on top of them.
// The owner's instruction was to nail the rule down once and for all, so it
// lives in the scaffold rather than in a memory file: every respawn re-applies
// it to every agent, and a persona rewrite cannot silently drop it.
//
// Source-level assertions, matching the technique of the sibling scaffold tests
// (agent-scaffold-formatting-rules.test.ts): the body is a template built inside
// the generator, so the source is the only surface testable without a model.

import { describe, it, expect } from 'vitest'
import { buildEvidenceBody } from '../web/agent-scaffold.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCAFFOLD = readFileSync(join(__dirname, '..', 'web', 'agent-scaffold.ts'), 'utf-8')
const WEB = readFileSync(join(__dirname, '..', 'web.ts'), 'utf-8')
const AGENT_PROCESS = readFileSync(join(__dirname, '..', 'web', 'agent-process.ts'), 'utf-8')

const evidenceBody = SCAFFOLD.slice(
  SCAFFOLD.indexOf('function buildEvidenceBody('),
  SCAFFOLD.indexOf('export function ensureEvidenceSection('),
)

describe('evidence-rule scaffold block', () => {
  it('defines BEGIN/END markers matching the generated-block convention', () => {
    expect(SCAFFOLD).toContain("const EVIDENCE_BEGIN = '<!-- BEGIN GENERATED: evidence-rule")
    expect(SCAFFOLD).toContain("const EVIDENCE_END = '<!-- END GENERATED: evidence-rule -->'")
  })

  it('uses a non-greedy block regex so it cannot eat unrelated content', () => {
    const re = SCAFFOLD.slice(SCAFFOLD.indexOf('const EVIDENCE_BLOCK_RE'))
    expect(re.slice(0, 300)).toContain('[\\\\s\\\\S]*?')
  })

  it('ensureEvidenceSection is exported and writes atomically', () => {
    expect(SCAFFOLD).toContain('export function ensureEvidenceSection(')
    const fn = SCAFFOLD.slice(SCAFFOLD.indexOf('export function ensureEvidenceSection('))
    expect(fn.slice(0, 1200)).toContain('atomicWriteFileSync')
  })

  it('resolves the main agent CLAUDE.md at PROJECT_ROOT, sub-agents under agentDir', () => {
    const fn = SCAFFOLD.slice(SCAFFOLD.indexOf('export function ensureEvidenceSection('))
    expect(fn.slice(0, 800)).toContain('name === MAIN_AGENT_ID')
    expect(fn.slice(0, 800)).toContain("join(PROJECT_ROOT, 'CLAUDE.md')")
    expect(fn.slice(0, 800)).toContain("join(agentDir(name), 'CLAUDE.md')")
  })

  it('returns without writing when the computed block is unchanged', () => {
    const fn = SCAFFOLD.slice(SCAFFOLD.indexOf('export function ensureEvidenceSection('))
    expect(fn.slice(0, 1200)).toContain('if (updated === existing) return')
  })

  it('is applied to the main agent on startup and to every sub-agent on respawn', () => {
    expect(WEB).toContain('ensureEvidenceSection(MAIN_AGENT_ID)')
    expect(AGENT_PROCESS).toContain('ensureEvidenceSection(name)')
  })

  it('states the three allowed forms of a claim', () => {
    expect(evidenceBody).toContain('**Tény.**')
    expect(evidenceBody).toContain('**Tipp.**')
    expect(evidenceBody).toContain('**Nem tudom.**')
  })

  it('forbids the specific failures that produced the rule', () => {
    // inventing a cause, declaring something impossible, guessing dates,
    // and building downstream work on an unverified claim
    expect(evidenceBody).toContain('Nem találsz ki magyarázatot')
    expect(evidenceBody).toContain('lejárt vagy leállt, amíg meg nem nézted')
    expect(evidenceBody).toContain('emlékezetből')
    expect(evidenceBody).toContain('RÁÉPÜL')
  })

  // 2026-08-14: the recurring form of the failure is not a long false claim but
  // a short concrete detail written from habit -- support@connectors.hu, which
  // bounced 550 because nobody had ever seen that address.
  it('names the concrete-detail class and forbids the role-address habit', () => {
    expect(evidenceBody).toContain('A konkrétum mindig forrásból jön')
    expect(evidenceBody).toContain('`support@`, `info@`, `hello@` szokásból')
    expect(evidenceBody).toContain('From fejléce')
    // "no source" has to be an allowed answer, or the rule just moves the guess
    expect(evidenceBody).toContain('nem találom sehol')
  })

  // ADAPTED IN THE 88c366f2 MERGE (A1): upstream's recipient ledger is NOT taken on this install
  // (marveen a55e02ed, card 5140afc7), so the gate paragraphs say what OUR gate does. The upstream
  // cases asserted the ledger's own sentences (the file, the add command, fail-closed recovery); the
  // claims they protected -- no overclaiming, and no protection promised where none runs -- are
  // asserted below against the true text instead.
  it('promises no ledger: neither the file nor its command appears in the generated block', () => {
    expect(evidenceBody).not.toContain('verified-recipients.json')
    expect(evidenceBody).not.toContain('recipient-ledger.mjs')
  })

  it('does not overclaim: the address is named as NOT machine-checked', () => {
    expect(evidenceBody).toContain('ne olvasd védelemnek ott, ahol nincs')
    expect(evidenceBody).toContain('címzett-ledger')
  })

  it('keeps Hungarian accents and uses no em dash, like its sibling blocks', () => {
    expect(evidenceBody).toContain('ellenőrizz')
    expect(evidenceBody).not.toContain('—')
  })

  // LEDGERFOAGENS922 (2026-09-22): the recipient-ledger hook is wired ONLY into
  // sub-agent settings (`name !== MAIN_AGENT_ID`); the main agent's sends run
  // through the approval gate and the copy gate, neither of which reads the
  // ledger. Measured on the live install: the main settings carry no
  // email-send-gate entry, the two main-agent hooks have zero ledger
  // references. The block used to promise the SAME machine gate to the main
  // agent, in its own instructions -- a false protection claim on the one path
  // where the main agent writes to customers. The two audiences now get two
  // texts, and neither may drift back.
  describe('recipient-gate paragraph is true for BOTH audiences', () => {
    const main = buildEvidenceBody(true)
    const sub = buildEvidenceBody(false)

    it('main agent: the address is not checked by any machine gate here, and says so', () => {
      expect(main).toContain('a CÍMET ezen a telepítésen semmilyen gépi kapu nem ellenőrzi')
      expect(main).toContain('ne olvasd védelemnek ott, ahol nincs')
      // the hook FILE NAMES stay out of the generated text: the seeding-surface scan
      // (hook-registration-completeness.test.ts) reads agent-scaffold.ts as a corpus.
      expect(main).not.toContain('email-approval-gate.py')
      expect(main).not.toContain('outgoing-copy-gate.py')
    })

    it('sub-agent: names what the gate DOES (blocks sending) and what it does not (the address)', () => {
      expect(sub).toContain('a KÜLDÉST tiltja')
      expect(sub).toContain('A CÍMET nem ellenőrzi')
      expect(sub).not.toContain('a CÍMET ezen a telepítésen semmilyen gépi kapu nem ellenőrzi')
    })

    it('neither audience carries a ledger command', () => {
      for (const body of [main, sub]) expect(body).not.toContain('recipient-ledger.mjs')
    })

    it('both outputs keep accents and use no em dash', () => {
      for (const body of [main, sub]) {
        expect(body).not.toContain('\u2014')
        expect(body).toMatch(/[áéíóöőúüű]/)
      }
    })

    it('ensureEvidenceSection passes the main-agent flag, so the main CLAUDE.md gets the true text', () => {
      const fn = SCAFFOLD.slice(SCAFFOLD.indexOf('export function ensureEvidenceSection('))
      expect(fn.slice(0, 1200)).toContain('buildEvidenceBody(name === MAIN_AGENT_ID)')
    })
  })
})
