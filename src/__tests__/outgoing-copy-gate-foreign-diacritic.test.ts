import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// GATEHARMADIK924 (2026-09-24, card 972904fd): the THIRD class of codepoint
// substitution, which the two gates above it miss TOGETHER.
//
//   the text ............... `forditott` with U+00EC LATIN SMALL LETTER I WITH
//                            GRAVE where the Hungarian accented `i` belongs
//   combining-mark gate .... 0  (U+00EC is a PRECOMPOSED codepoint, not base+mark)
//   homoglyph gate ......... 0  (a Latin letter carrying its own diacritic, not a
//                                foreign script)
//   accent gate ............ 0  (the broken form is not a key in ACCENTLESS)
//
// Measured on the live file the same day: all three green, the broken word goes
// THROUGH. The first gate catches the BREAK (a decomposed codepoint), the second
// the SWAP (a foreign script), this third one the CONFUSION: right script, wrong
// letter.
//
// The specimens here are built FROM CODEPOINTS, never typed by hand. A hand-typed
// accent is the exact defect class this gate is about, and it has already happened
// once in this fleet: a hand-made copy of a source introduced an accent the source
// did not have, and the name search is accent-SENSITIVE.

const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')

const cp = (...codes: number[]) => codes.map((n) => String.fromCharCode(n)).join('')

const GRAVE_I = cp(0x00ec) // LATIN SMALL LETTER I WITH GRAVE  -- the defect
const ACUTE_I = cp(0x00ed) // LATIN SMALL LETTER I WITH ACUTE  -- the Hungarian `i`
const CARON_S = cp(0x0161) // LATIN SMALL LETTER S WITH CARON  -- Serbian, legitimate
const ACUTE_C = cp(0x0107) // LATIN SMALL LETTER C WITH ACUTE  -- Serbian, legitimate
const STROKE_D = cp(0x0111) // LATIN SMALL LETTER D WITH STROKE -- Serbian, no decomposition
const CIRC_O = cp(0x00f4) // LATIN SMALL LETTER O WITH CIRCUMFLEX

// GATEHARMADIK924-WARN (card ff3236b3, 2026-09-24): this class is no longer a
// `problems` entry -- it is a WARNING, so it leaves through `_gate_warn`, which
// prints a systemMessage line to stdout. The audit() RETURN VALUE is therefore
// the wrong place to look now, and a probe that kept reading it would report
// zero findings on a defect that did fire -- the silent-null shape this whole
// card is about. So the probe captures stdout and reads the warning itself.
function auditForeign(text: string): string[] {
  const out = execFileSync('python3', ['-c', `
import contextlib, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    g.audit(sys.argv[1])
msgs = []
for line in buf.getvalue().splitlines():
    line = line.strip()
    if not line:
        continue
    try:
        obj = json.loads(line)
    except ValueError:
        continue
    if isinstance(obj, dict) and "systemMessage" in obj:
        msgs.append(obj["systemMessage"])
print(json.dumps([m for m in msgs if "NEM HASZNALT EKEZET" in m]))
`, text], { encoding: 'utf-8' })
  return JSON.parse(out.trim().split('\n').pop()!)
}

describe('outgoing-copy gate: a Latin letter with a diacritic Hungarian does not use (GATEHARMADIK924)', () => {
  it('the defect fires: U+00EC where the Hungarian accented i belongs', () => {
    const probs = auditForeign(`A cim ford${GRAVE_I}tott, es kesz.`)
    expect(probs.length).toBe(1)
  })

  it('and the finding NAMES the character and its codepoint, not just a count', () => {
    // MADE LOAD-BEARING BY A REAL BUG: the first version of this gate's OK-set
    // listed six uppercase letters where Hungarian has nine -- `O`, `U` and `U`
    // with double acute were missing -- and it reported FIVE hits that were all
    // correct Hungarian words. A bare count concealed exactly what it had found.
    const probs = auditForeign(`A cim ford${GRAVE_I}tott, es kesz.`)
    expect(probs[0]).toContain('LATIN SMALL LETTER I WITH GRAVE')
    expect(probs[0]).toContain('U+00EC')
  })

  it('the correct Hungarian form passes', () => {
    expect(auditForeign(`A cim ford${ACUTE_I}tott, es kesz.`)).toEqual([])
  })

  it('the fleet’s own Serbian customer names pass: caron and acute on c', () => {
    // THE DIRECTION THAT MAKES THE GATE USABLE. A broader rule ("any non-ASCII
    // character outside the Hungarian accent set") fires on these, and they are
    // real customers in a real CRM. A gate that cries wolf on the fleet's own
    // data stops being read, and then the true alarm goes by unnoticed too.
    expect(auditForeign(`Zlatko ${CARON_S}tefkovi${ACUTE_C} ugyfele, rendben.`)).toEqual([])
    expect(auditForeign(`${STROKE_D}eki${ACUTE_C} Aleksandra ugyfele, rendben.`)).toEqual([])
  })

  it('a letter with no base+mark decomposition passes (the stroke is not a mark)', () => {
    expect(auditForeign(`${STROKE_D}or${STROKE_D}e je u redu.`)).toEqual([])
  })

  it('a legitimate circumflex still fires: the boundary, stated rather than hidden', () => {
    // NOT a bug and NOT a whitelist gap. This is a CODEPOINT gate: it cannot tell
    // a French quotation from a mistyped Hungarian letter, because the codepoint
    // is identical in both. The failure direction is the safe one (a false alarm,
    // not a missed defect), and narrowing the mark set is a one-line change if
    // the fleet ever needs it.
    expect(auditForeign(`A h${CIRC_O}tel nevu hely, rendben.`).length).toBe(1)
  })

  it('two different bad characters are BOTH named, not collapsed into a count', () => {
    const probs = auditForeign(`A cim ford${GRAVE_I}tott, a hely h${CIRC_O}tel, es kesz.`)
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('U+00EC')
    expect(probs[0]).toContain('U+00F4')
  })

  it('the other two gates are untouched by this one: a homoglyph still fires as a homoglyph', () => {
    // The A in a Cyrillic word -- the SECOND gate's job. This one must not claim
    // it, or the two checks would report the same defect under two names.
    const cyr = cp(0x0410) + 'NNA'
    expect(auditForeign(`A nev ${cyr}, rendben.`)).toEqual([])
  })
})

// THE COVERAGE BOUNDARY, MEASURED RATHER THAN ASSUMED.
//
// Measured 2026-09-24 against the six CP1250->CP1252 pairs documented on card
// 6151a160 (the CRM contact-name corruption census), plus that card's EXTRA
// class. This gate catches HALF of them, and the half it misses is not random.
//
// WHY, and it is the same mechanism as everything else here: the gate fires only
// when the base letter is in `aeiou` AND the character decomposes into base+mark.
// `æ` is a ligature, `ð` has no decomposition at all, and the bases of `c`, `d`
// and `n` carry no Hungarian accent to be mistaken for -- so those three pairs
// go straight through.
//
// THIS IS NOT A DEFECT AND NOT A GAP TO CLOSE. The gate's assertion is narrow:
// a Hungarian vowel carrying the wrong accent. Widening it to "any mojibake"
// would be a DIFFERENT gate with a different false-positive profile. What made
// this worth pinning is that the six pairs are exactly the characters in the
// CRM's own corruption census -- so the natural reading, "the gate catches the
// corrupted customer names", is half true, and a half-true coverage claim is
// how a gate gets trusted for work it does not do.
describe('outgoing-copy gate, third class: the coverage boundary against known mojibake (GATEHARMADIK924)', () => {
  // the three pairs it MISSES: base not in aeiou, or no base+mark decomposition
  const AE_LIG = cp(0x00e6) // ae ligature      -- `a` is accentable, but this is a ligature
  const ETH = cp(0x00f0) // eth              -- no decomposition
  const N_TILDE = cp(0x00f1) // n with tilde     -- `n` is not an accentable base
  // the three pairs it CATCHES: accentable base, real mark
  const E_GRAVE = cp(0x00e8) // e with grave
  const O_TILDE = cp(0x00f5) // o with tilde
  const U_CIRC = cp(0x00fb) // u with circumflex

  it('MEASURED BLIND SPOT: the ae ligature (`c-acute` -> `ae`) passes', () => {
    expect(auditForeign(`Vlado Glu${AE_LIG}evi${AE_LIG}, rendben.`)).toEqual([])
  })

  it('MEASURED BLIND SPOT: eth (`d-stroke` -> `eth`) passes', () => {
    expect(auditForeign(`Ra${ETH}ovan ${ETH}uri${ETH}ev, rendben.`)).toEqual([])
  })

  it('MEASURED BLIND SPOT: n-tilde (`n-acute` -> `n-tilde`) passes', () => {
    expect(auditForeign(`Stevan Ma${N_TILDE}a${N_TILDE}i, rendben.`)).toEqual([])
  })

  it('the same census, the half it DOES catch -- so the boundary is a line, not a failure', () => {
    expect(auditForeign(`Stefan Kova${E_GRAVE}, rendben.`).length).toBe(1)
    expect(auditForeign(`Gy${O_TILDE}z${O_TILDE} Adanko, rendben.`).length).toBe(1)
    expect(auditForeign(`Sz${U_CIRC}gyi Arpad, rendben.`).length).toBe(1)
  })
})

// GATEHARMADIK924, the INTER-AGENT arm. This one is not decoration: my own
// specimen came from MY outgoing text, and `agent-msg.sh` and card comments are
// Bash commands, not email sends -- so putting the check only in audit() would
// leave the path where the defect actually appeared unguarded.
//
// The failure directions follow that arm's own structure: an UNREADABLE body is
// NEM MERT and fails open loudly. A MEASURED defect is then split BY TARGET --
// it BLOCKS on the card comment, the one write-once channel, and WARNS
// everywhere else including /api/messages, because every other channel has a
// way back. BOTH directions are pinned below, so neither can quietly become
// the other.
function iaArm(cmd: string): { code: number; stderr: string; stdout: string } {
  const out = execFileSync('python3', ['-c', `
import contextlib, importlib.util, io, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
err = io.StringIO(); cap = io.StringIO(); sys.stderr = err; code = 0
try:
    with contextlib.redirect_stdout(cap):
        g.inter_agent_homoglyph_gate(sys.argv[1])
except SystemExit as e:
    code = e.code if e.code is not None else 0
print(json.dumps({"code": code, "stderr": err.getvalue(), "stdout": cap.getvalue()}))
`, cmd], { encoding: 'utf-8' })
  return JSON.parse(out.trim().split('\n').pop()!)
}

const postTo = (body: string) =>
  `curl -s -X POST http://localhost:3420/api/messages -H 'Content-Type: application/json' -d '${body}'`

describe('outgoing-copy gate, inter-agent arm: the same third class (GATEHARMADIK924)', () => {
  it('/api/messages: the defect WARNS and the message passes -- that channel has a way back', () => {
    // The card's closing shape, pinned rather than assumed: a block belongs
    // where there is NO second chance, and an agent message can be corrected.
    const r = iaArm(postTo(`{"from":"deeper","to":"marveen","content":"A cim ford${GRAVE_I}tott."}`))
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('U+00EC')
    expect(r.stdout).toContain('LATIN SMALL LETTER I WITH GRAVE')
    expect(r.stdout).toContain('FIGYELMEZTETES')
  })

  it('the same POST with the correct Hungarian form passes -- the block must not be unconditional', () => {
    const r = iaArm(postTo(`{"from":"deeper","to":"marveen","content":"A cim ford${ACUTE_I}tott."}`))
    expect(r.code).toBe(0)
  })

  it('the Serbian names pass here too, in the arm that carries fleet traffic', () => {
    const r = iaArm(postTo(`{"from":"deeper","to":"marveen","content":"Zlatko ${CARON_S}tefkovi${ACUTE_C} ugyfele."}`))
    expect(r.code).toBe(0)
  })

  it('MEASURED SCOPE LIMIT: the body of an agent-msg.sh heredoc is NOT in the command, so it is not scanned', () => {
    // Not a regression and not introduced here: the arm matches a curl POST to
    // /api/messages, and `agent-msg.sh` carries its body on the SCRIPT's stdin,
    // so the command the hook sees holds no data flag to read. Pinning it so the
    // limit is visible rather than assumed away -- this is the shape my own
    // outgoing inter-agent text actually uses.
    const r = iaArm(`bash /Users/isti/marveen/scripts/agent-msg.sh deeper marveen - <<'VEGE'\nA cim ford${GRAVE_I}tott.\nVEGE`)
    expect(r.code).toBe(0)
  })

  it('a card comment carrying the defect BLOCKS -- the one channel with no second chance', () => {
    // GATEHARMADIK924-TARGET. This is the exact INVERSE of the test it replaces:
    // the measurement then was "a different endpoint, so it is not scanned", and
    // the card closed by making it scanned. The comment channel is write-once
    // (no PUT, no DELETE), so here the gate must REFUSE rather than warn -- a
    // warning would let the damaged text land where nothing can correct it.
    const r = iaArm(`curl -s -X POST http://localhost:3420/api/kanban/abc/comments -d '{"author":"deeper","content":"A cim ford${GRAVE_I}tott."}'`)
    expect(r.code).toBe(2)
    expect(r.stderr).toContain('U+00EC')
    expect(r.stderr).toContain('IRAS-MEGYSSZOR')
  })

  it('the card-comment block is NOT unconditional: correct Hungarian passes there too', () => {
    // Without this, the test above would also pass on a gate that blocks EVERY
    // comment -- strictly worse than the defect it guards.
    const r = iaArm(`curl -s -X POST http://localhost:3420/api/kanban/abc/comments -d '{"author":"deeper","content":"A cim ford${ACUTE_I}tott."}'`)
    expect(r.code).toBe(0)
  })
})
