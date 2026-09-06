import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error -- plain .mjs hook script, no types
import { isSendInvocation } from '../../scripts/email-send-gate.mjs'

// SUBGATEPOZ822 / msg 14289: the same command-position recognition now lives
// in TWO languages, in two files (the main-agent copy gate in python, the
// sub-agent hard-gate in JS). Several of today's findings came from exactly
// this pattern -- a parallel copy drifting silently. This test binds the two:
// EVERY case in the shared list runs through BOTH implementations, and both
// must equal the expected verdict. A future fix applied to only one copy
// fails here as a test, instead of surfacing weeks later as an incident.
//
// Deliberately NOT in the shared list: unparseable-input fallbacks. The two
// gates fall back differently by design (copy-gate: strong literals only;
// hard-gate: its full legacy pattern set, because it is a hard-deny that must
// never get weaker on that path). If that difference ever becomes a problem,
// unify there first.
//
// THAT SENTENCE USED TO END "each pins its own fallback in its scope test",
// AND MEASURED (didi, 2026-09-06) NEITHER SCOPE TEST PINS THE DIFFERENCE.
// Both use `sendmail` as their positive case -- a token the two gates AGREE on
// (10 and 13 occurrences; `sendEmail` and `mail.send` are 0 in both). A
// conformance pin whose positive case is a point of AGREEMENT is structurally
// unable to notice divergence being introduced OR removed. That is the fixture
// law one level up: choose the case where the correct and the incorrect
// implementation DIFFER. The block at the bottom of this file is that pin.

const ROOT = join(__dirname, '..', '..')
const GATE_PY = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')
const CASES = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'hooks', 'send-invocation-cases.json'), 'utf-8'),
) as { cases: Array<{ name: string; cmd: string; expected: boolean }> }

// One python process for the whole list: stdin carries the JSON cases, stdout
// returns the per-case verdicts. Spawning per-case would be ~30x slower.
function pythonVerdicts(cmds: string[]): boolean[] {
  const out = execFileSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(GATE_PY)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
cmds = json.load(sys.stdin)
print(json.dumps([g.is_send_invocation(c) for c in cmds]))
`], { encoding: 'utf-8', input: JSON.stringify(cmds) })
  return JSON.parse(out.trim())
}

describe('send-invocation conformance: both gates agree with the shared contract on every case', () => {
  const py = pythonVerdicts(CASES.cases.map((c) => c.cmd))

  CASES.cases.forEach((c, i) => {
    it(`${c.name} -> ${c.expected}`, () => {
      const js = isSendInvocation(c.cmd)
      expect(js, `JS verdict for: ${c.cmd}`).toBe(c.expected)
      expect(py[i], `python verdict for: ${c.cmd}`).toBe(c.expected)
    })
  })

  it('the shared list is non-trivial in both directions', () => {
    expect(CASES.cases.some((c) => c.expected)).toBe(true)
    expect(CASES.cases.some((c) => !c.expected)).toBe(true)
    expect(CASES.cases.length).toBeGreaterThanOrEqual(20)
  })
})

// ===========================================================================
// THE DIVERGENCE ITSELF, PINNED -- card 84c7fe5f, ruling 9ebde77b (fe418df).
//
// WHY A TEST AND NOT ONLY THAT COMMENT: a comment does not fail a suite. The
// ruling says these two gates SHOULD differ on unparseable input, each
// correctly for its own population -- and a later census that measures the
// difference, finds no statement beside it, and "aligns them away" is exactly
// the outcome the ruling exists to prevent. Aligning either direction should
// be loud.
//
// WHY IT NAMES A DIRECTION AND NOT JUST INEQUALITY: inequality alone survives
// aligning them THE WRONG WAY ROUND. The hard-gate must be the WIDER one on
// this path (a sub-agent deny that must never weaken); the copy-gate the
// narrower (its false positives land on ordinary internal commands).
//
// THE PRICE OF EACH SIDE IS VISIBLE IN THE TWO CASES BELOW, and they carry
// OPPOSITE expected verdicts on purpose:
//
//   the outbound case  `expected: true`  -- the copy-gate lets a REAL send
//                                           through here. That is its price.
//   the payload case   `expected: false` -- the hard-gate blocks an ORDINARY
//                                           command here. That is its price.
//
// Both are the designed trade, not defects, and neither is inheritable by the
// other gate.
//
// HOW THE FALLBACK IS REACHED: appending an unbalanced quote. That is OUR
// method for routing control to the fallback, not an observed production
// shape -- stated because the numbers below are only as general as that.
//
// AND THE METHOD ONLY WORKS ON A BALANCED COMMAND (jarvis measured it, dexter
// reproduced: card 84c7fe5f / 980ebc8c c18). Append a quote to a command that
// is ALREADY unbalanced and you BALANCE it -- so it takes the PARSED path,
// which is the opposite of what the forcing intends. Measured directly, not
// inferred from a verdict:
//
//   `echo 'smtplib`     unbalanced BEFORE: true   AFTER appending: FALSE
//   control, balanced   unbalanced BEFORE: false  AFTER appending: true
//
// In production the fallback runs exactly when a command does NOT tokenize --
// precisely where this forcing flips to the parsed path. So the method cannot
// sample the fallback's natural traffic, and the four cases below are valid
// ONLY because each is balanced to begin with. That is not a fact to trust: it
// is asserted, below, so swapping in an already-unbalanced case fails loudly
// instead of quietly measuring the other path.
// ===========================================================================
describe('the two gates diverge on unparseable input BY DESIGN, in a named direction', () => {
  // Taken from the shared list BY NAME rather than written out here, so the pin
  // moves with the corpus instead of drifting from it.
  const byName = (name: string) => {
    const found = CASES.cases.find((c) => c.name === name)
    // NOT FOUND IS NOT CLEARED: if the case is renamed or removed, this fails
    // rather than silently pinning nothing.
    expect(found, `case not found in the shared list: ${name}`).toBeDefined()
    return found!
  }

  const OUTBOUND = byName('M365 CLI outbound subcommand')
  const PAYLOAD = byName(
    "[marveen:fp-runner-path-in-message-content] runner-ut es 'send' alparancs egy inter-agent uzenet TARTALMABAN",
  )
  const AGREED_BLOCK = byName('wrapper shell -c with a real send (round 2)')
  const AGREED_PASS = byName('wrapper shell -c that only talks about sending')

  /** The same command with an unbalanced quote: neither gate can tokenize it. */
  const unparseable = (cmd: string) => `${cmd} '`

  const inputs = [OUTBOUND, PAYLOAD, AGREED_BLOCK, AGREED_PASS].map((c) =>
    unparseable(c.cmd),
  )
  const py = pythonVerdicts(inputs)
  const js = inputs.map((cmd) => isSendInvocation(cmd) as boolean)
  const [OUT, PAY, BLK, PSS] = [0, 1, 2, 3]

  it('the HARD-GATE is the wider one: it blocks a real send the copy-gate lets through', () => {
    // Direction, not inequality. Aligning the copy-gate WIDER, or the
    // hard-gate NARROWER, both turn this red.
    expect(js[OUT], `hard-gate on: ${inputs[OUT]}`).toBe(true)
    expect(py[OUT], `copy-gate on: ${inputs[OUT]}`).toBe(false)
  })

  it('and it pays for that width: it blocks an ordinary command the copy-gate allows', () => {
    // The other half of the same trade. Without this the pin would read as
    // "the hard-gate is simply better", which is not the ruling.
    expect(js[PAY], `hard-gate on: ${inputs[PAY]}`).toBe(true)
    expect(py[PAY], `copy-gate on: ${inputs[PAY]}`).toBe(false)
  })

  it('CONTROL: where they agree to BLOCK, both still block', () => {
    // Without this the pin degenerates into "these two functions differ
    // somewhere", which any refactor satisfies by accident.
    expect(js[BLK]).toBe(true)
    expect(py[BLK]).toBe(true)
  })

  it('CONTROL: where they agree to PASS, both still pass', () => {
    // The other direction of the same control: it also proves the fallback is
    // reached at all rather than everything blocking on a parse error.
    expect(js[PSS]).toBe(false)
    expect(py[PSS]).toBe(false)
  })

  it('CONTROL ON THE METHOD: every case here is balanced, so the forcing actually forces', () => {
    // The pin's own meter, checked rather than trusted. Appending a quote only
    // reaches the fallback if the command was balanced first; on an already
    // unbalanced one it BALANCES it and silently measures the parsed path.
    // Without this, a future case swap would degrade the four assertions above
    // into parsed-path assertions with nothing saying so.
    const unbalanced = (cmd: string) => {
      let quote: string | null = null
      for (const ch of cmd) {
        if (quote) {
          if (ch === quote) quote = null
        } else if (ch === "'" || ch === '"') {
          quote = ch
        }
      }
      return quote !== null
    }

    for (const c of [OUTBOUND, PAYLOAD, AGREED_BLOCK, AGREED_PASS]) {
      expect(unbalanced(c.cmd), `case is ALREADY unbalanced, forcing would balance it: ${c.name}`).toBe(false)
      expect(unbalanced(unparseable(c.cmd)), `forcing did not make it unparseable: ${c.name}`).toBe(true)
    }
  })

  it('CONTROL: on the PARSED path the two gates agree on these very cases', () => {
    // The divergence must be a property of the FALLBACK, not of the cases. If
    // these disagreed already when parseable, the four assertions above would
    // be pinning something else entirely.
    const parsed = [OUTBOUND, PAYLOAD, AGREED_BLOCK, AGREED_PASS].map((c) => c.cmd)
    const pyParsed = pythonVerdicts(parsed)
    parsed.forEach((cmd, i) => {
      expect(isSendInvocation(cmd), `parsed path disagrees on: ${cmd}`).toBe(pyParsed[i])
    })
  })
})
