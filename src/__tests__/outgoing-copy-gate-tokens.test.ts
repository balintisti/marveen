import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// GATEKOTOJEL817 + GATEHYPH816: two false positives in five minutes, in a live
// owner conversation, both the same class -- the gate could not tell PROSE
// from IDENTIFIER. (1) `Drive-ot`: a Hungarian suffix attaches to a foreign
// proper noun WITH a hyphen (that is the correct spelling); the letters-only
// tokenizer cut at the hyphen and read the `ot` remainder as a standalone
// Hungarian word (ot -> öt). (2) `Video atalakitas`: a Drive FOLDER NAME
// quoted in prose -- a mid-sentence capitalized word is an identifier, not
// prose. The fix is TOKENIZATION, not the dictionary (a word exception list
// would also pass real errors): hyphenated forms are checked as the WHOLE
// token, and mid-sentence capitalized words are skipped -- while sentence-
// start capitals and lowercase prose remain fully checked.

const ROOT = join(__dirname, '..', '..')
const GATE = join(ROOT, 'scripts', 'hooks', 'outgoing-copy-gate.py')

function auditAccent(text: string): string[] {
  const out = execFileSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("gate", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps([p for p in g.audit(sys.argv[1]) if "HIANYZO" in p]))
`, text], { encoding: 'utf-8' })
  return JSON.parse(out.trim())
}

describe('outgoing-copy gate tokenization: prose vs identifier (GATEKOTOJEL817/GATEHYPH816)', () => {
  it('a hyphen-suffixed foreign proper noun passes: the suffix fragment is not a standalone word', () => {
    // Marveen's real blocked sentence, correctly accented -- must go through.
    expect(auditAccent('Ha a Drive-ot választod, elég a mappába dobni, és köszönöm, hogy már átküldted.')).toEqual([])
  })

  it('a quoted identifier (mid-sentence capitalized folder name) passes', () => {
    // The second real blocked sentence: a Drive folder called "Video atalakitas".
    expect(auditAccent('A neve Video átalakítás, ott találod, hogy már ne kelljen külön keresni.')).toEqual([])
  })

  it('lowercase prose "video" still fails -- the fix must not widen into a whitelist', () => {
    const probs = auditAccent('Szia, a video nagyon jól sikerült, köszönöm, hogy átküldted.')
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('video -> videó')
  })

  it('a sentence-START capitalized word is prose and still fails (the skip-rule must not over-reach)', () => {
    const probs = auditAccent('Köszönöm, hogy megnézted. Video lett a vége, már csak fel kell tölteni.')
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('video -> videó')
  })

  it('a standalone accentless word that ALSO exists as a suffix still fails (ot -> öt)', () => {
    const probs = auditAccent('Kérlek, küldj át ot darabot, hogy már ne kelljen várni.')
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('ot -> öt')
  })

  it('the finding names its context: 3 words each side plus the character position (no more grepping mid-conversation)', () => {
    const probs = auditAccent('Szia, a video nagyon jól sikerült, köszönöm, hogy átküldted.')
    // Neighbours on both sides and an @<pos> marker.
    expect(probs[0]).toMatch(/"\.\.\.[^"]*a video nagyon[^"]*\.\.\." @\d+/)
  })
})

// ADC93F84: the same class, one step further along. The fix above covered a
// LETTER-prefixed hyphenated form (`Drive-ot`); a NUMBER-prefixed one was still
// cut at the hyphen, so `176-ot` and `19-es` were reported as missing accents.
//
// What made it worth fixing rather than tolerating: the suggestion was WRONG
// HUNGARIAN. `176-öt` and `19-és` are errors. This gate exists because an
// unaccented message once reached a customer -- a gate that proposes a bad
// accent undermines its own purpose, and anyone following it literally fixes one
// error and introduces another.
//
// Marveen also measured that the false hit only ever appeared ALONGSIDE a real
// one, which is what limited the damage -- and what made it dangerous: a wrong
// item arrives with the credibility of the correct item next to it.
describe('outgoing-copy gate tokenization: number-prefixed hyphenated forms (ADC93F84)', () => {
  it('a multi-digit number with a Hungarian suffix passes: 176-ot is correct', () => {
    expect(auditAccent('Azt kell tudni, hogy 176-ot mértünk, és van rá magyarázat a naplóban.')).toEqual([])
  })

  it('and 19-es passes too -- the fragment `es` must not be read as a standalone word', () => {
    expect(auditAccent('Azt kell tudni, hogy a 19-es mérés jó, és van rá magyarázat a naplóban.')).toEqual([])
  })

  it('a standalone `es` in prose STILL fails -- the fix must not widen into a whitelist', () => {
    // The direction that makes the two above worth anything. Without it,
    // deleting the accent check entirely would pass.
    const probs = auditAccent('Azt kell tudni, hogy ez nem hiba, es van rá magyarázat a naplóban.')
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('es -> és')
  })

  it('and a standalone `ot` in prose still fails', () => {
    const probs = auditAccent('Azt kell tudni, hogy ot nem hiba, és van rá magyarázat a naplóban.')
    expect(probs.length).toBe(1)
    expect(probs[0]).toContain('ot -> öt')
  })

  it('the letter-prefixed form is unchanged -- the older fix still holds', () => {
    expect(auditAccent('Ha a Drive-ot választod, elég a mappába dobni, és köszönöm, hogy már átküldted.')).toEqual([])
  })

  it('a single-digit form passes for the RIGHT reason now, not by accident', () => {
    // `5-os` passed before the fix too -- but only because `os` happens not to
    // be in the accentless dictionary. Nothing tokenized it as one word. A
    // dictionary that grows one entry would have started failing it.
    expect(auditAccent('Azt kell tudni, hogy az 5-os mérés jó, és van rá magyarázat a naplóban.')).toEqual([])
  })
})
