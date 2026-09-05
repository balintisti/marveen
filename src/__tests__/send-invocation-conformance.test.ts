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
// gates fall back differently BY RULING, not by omission (copy-gate: strong
// literals only; hard-gate: its full legacy pattern set, because it is a
// hard-deny that must never get weaker on that path) -- card 9ebde77b, with
// the three measured reasons stated at the fallback in outgoing-copy-gate.py.
//
// Each gate pins ITS OWN SIDE of that difference in its scope test, and the
// pin stands on a DIVERGENCE token (`sendEmail` / `mail.send`), never on the
// shared `sendmail` -- card de5e1709. That distinction is the entire
// protection: until 2026-09-06 both pins used `sendmail`, which is on BOTH
// lists, so they pinned what the gates AGREE on and left the ruling
// undefended -- measured, a mutation aligning EITHER gate to the other kept
// the full suite green. So if a census flags the difference: do not unify it.
// Read the ruling first -- the difference IS the decision.

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
