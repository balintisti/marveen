import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

// A PLACEHOLDER INSIDE A PLAIN STRING IS NEVER INTERPOLATED, AND IT SHIPPED ONCE (card 82d9b960).
//
// `'${sender}'` in single quotes is the literal six characters, not the value. It shipped in
// 9fcfb33: the notice handed the reader a one-line query to re-measure their stuck messages, and
// pasted verbatim that command exited 0 and printed `[]` for a sender who had fifteen. A silent
// false negative, in the reassuring direction, in the one line that existed to replace a number
// the reader could not trust.
//
// WHY THIS GUARD IS SOURCE-LEVEL AND NOT A LIST OF BUILDERS. The first fix was a hand-written
// list of notice builders; jarvis measured that it missed one in its own file. The second fix
// compared two sets of NAMES -- and he measured again that the FILE axis was still hardcoded to
// two paths, which is the very axis the defect came from: buildRestartLossLine appeared in a NEW
// file, so the next one would be outside again. A registry keyed on files or names reproduces
// that failure at one remove every time.
//
// The defect is purely syntactic, so it can be caught where it is written rather than where it is
// rendered: no call sites, no fixtures, no per-builder arguments, and nothing to keep in sync.
const PLACEHOLDER = /\$\{[A-Za-z_$][\w$.]*\}/

interface Hit { file: string; line: number; text: string }

// THE ONE DELIBERATE EXCEPTION (card 6525aba3, port of upstream 29d7f340): the elements of the
// FLEET_BASELINE_DENY array in agent-scaffold.ts carry `${HOME}` in a plain string ON PURPOSE. They
// are profile rules, and agent-scaffold.ts runs every one through resolveProfilePlaceholders(rule, ctx)
// before it is written, exactly like profile.filesystem.deny. The exception is as narrow as it can
// be stated: that file, that one array, that one placeholder name. Anything else in the same file
// (another array, another placeholder) is still a hit, and the control below holds that.
const RESOLVED_RULE_FILE = 'src/web/agent-scaffold.ts'
const RESOLVED_RULE_ARRAY = 'FLEET_BASELINE_DENY'

function isResolvedProfileRule(file: string, node: ts.StringLiteral): boolean {
  if (file !== RESOLVED_RULE_FILE) return false
  // every placeholder in the text must be ${HOME}
  const names = [...node.text.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1])
  if (names.length === 0 || names.some((n) => n !== 'HOME')) return false
  const arr = node.parent
  if (!arr || !ts.isArrayLiteralExpression(arr)) return false
  const decl = arr.parent
  return !!decl && ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && decl.name.text === RESOLVED_RULE_ARRAY
}

function scanText(file: string, source: string): { hits: Hit[]; literals: number } {
  const hits: Hit[] = []
  let literals = 0
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const walk = (node: ts.Node): void => {
    // `isStringLiteral` is true for '...' and "..." and FALSE for template literals, which is
    // exactly the distinction that matters. A line-based regex cannot make it: jarvis's first
    // pattern returned ten hits, all of them apostrophes INSIDE backtick strings, and my own
    // earlier census had the same fault. The parser knows which is which.
    if (ts.isStringLiteral(node)) {
      literals++
      if (PLACEHOLDER.test(node.text) && !isResolvedProfileRule(file, node)) {
        hits.push({
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.text.slice(0, 80),
        })
      }
    }
    node.forEachChild(walk)
  }
  walk(sf)
  return { hits, literals }
}

function scanSource(files: string[]): { hits: Hit[]; literals: number } {
  const hits: Hit[] = []
  let literals = 0
  for (const file of files) {
    const r = scanText(file, readFileSync(file, 'utf8'))
    hits.push(...r.hits)
    literals += r.literals
  }
  return { hits, literals }
}

describe('egy jelolo sima sztringben SOHA nem helyettesitodik be', () => {
  // `src/*.ts`, NOT `src/**/*.ts`, AND THAT ONE CHARACTER EXCLUDED THE TWO FILES THIS WHOLE
  // THREAD IS ABOUT (jarvis, 2026-09-05). In a git pathspec `*` already crosses directory
  // separators, while `**/` REQUIRES an intermediate directory -- so the `**/` form silently
  // dropped everything sitting directly under `src/`. Measured: 587 files against 638, with
  // src/idle-agent.ts and src/context-guard.ts matching ZERO under the old pattern. The first is
  // where 9fcfb33 actually shipped the defect this guard exists to catch.
  const tracked = execSync("git ls-files 'src/*.ts'", { encoding: 'utf8' }).split('\n').filter(Boolean)
  // A TESZTEK KIZARASA MERT DONTES, NEM KEZLEGYINTES. Ugyanez a szkenner a `__tests__` alatt 20
  // talalatot ad, es MIND JOGOS: allitas-literalok (`not.toContain('${agent}')`) es shell-heredocok
  // teszt-fixture-okben. Bevéve a mero 100% hamis pozitiv lenne -- pontosan az a detektor, amit
  // ez a flotta nem szallit.
  const production = tracked.filter((f) => !f.includes('__tests__'))

  it('a POZITIV KONTROLL: a szkenner megtalalja a valodi, kiszallitott alakot', () => {
    // EZ A KONTROLL A TESZT FELE. A lenti allitas egy NULLARA epul, es egy nulla addig nem
    // allitas, amig nem tudjuk, hogy a mero tud igent mondani. A minta itt a 9fcfb33 valodi
    // sora, ugyanabban a konkatenacios alakban, ahogy kiszallt.
    const shipped = `const line = " ... ('" + '\${sender}' + "',))))"`
    const sf = ts.createSourceFile('shipped.ts', shipped, ts.ScriptTarget.Latest, true)
    const found: string[] = []
    const walk = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) && PLACEHOLDER.test(n.text)) found.push(n.text)
      n.forEachChild(walk)
    }
    walk(sf)
    expect(found).toContain('${sender}')
  })

  it('a NEGATIV KONTROLL: a HELYES (backtickes) alakot NEM jeloli meg', () => {
    // Enelkul egy mero, ami mindenre igent mond, ugyanugy atmenne a pozitiv kontrollon.
    const correct = 'const line = `nev: ${sender} vege`'
    const sf = ts.createSourceFile('correct.ts', correct, ts.ScriptTarget.Latest, true)
    const found: string[] = []
    const walk = (n: ts.Node): void => {
      if (ts.isStringLiteral(n) && PLACEHOLDER.test(n.text)) found.push(n.text)
      n.forEachChild(walk)
    }
    walk(sf)
    expect(found).toEqual([])
  })

  it('a KIVETEL SZUK: csak az agent-scaffold FLEET_BASELINE_DENY tombjenek ${HOME} elemei mentesek', () => {
    const rule = "const FLEET_BASELINE_DENY = ['Read(${HOME}/.ssh/**)', 'Bash(rm -rf ${HOME}:*)']"
    // positive: the real shape, in the real file, is not a hit
    expect(scanText('src/web/agent-scaffold.ts', rule).hits).toEqual([])
    // the same text in any other file is a hit (both elements)
    expect(scanText('src/web/other.ts', rule).hits).toHaveLength(2)
    // another array in the same file is a hit
    expect(scanText('src/web/agent-scaffold.ts', "const OTHER = ['Read(${HOME}/.x)']").hits).toHaveLength(1)
    // another placeholder inside the exempt array is a hit
    expect(scanText('src/web/agent-scaffold.ts', "const FLEET_BASELINE_DENY = ['Read(${sender}/.x)', 'Read(${HOME}/${x})']").hits).toHaveLength(2)
    // a bare plain string (not an array element) with ${HOME} in that file is a hit
    expect(scanText('src/web/agent-scaffold.ts', "const x = 'Read(${HOME}/.x)'").hits).toHaveLength(1)
    // the exempt NAME holding a string that is not an array element is a hit (didi A5 G3: without this
    // control the ArrayLiteralExpression check could be dropped and every case above would still pass)
    expect(scanText('src/web/agent-scaffold.ts', "const FLEET_BASELINE_DENY = ('Read(${HOME}/.x)')").hits).toHaveLength(1)
  })

  it('a TELJES forrasfaban egyetlen sima sztring sem hordoz jelolot', () => {
    const { hits, literals } = scanSource(production)
    // TAGSAG, NEM MERET -- ES AZ ELSO ALAKOM MERET VOLT, EZ PEDIG PONTOSAN A HIBA, AMIT NEM FOG MEG.
    // A regi kontroll `> 50` es `> 1000` volt, es a torott glob mellett KENYELMESEN atment (162 es
    // 8495), mikozben 51 nem-teszt fajl hianyzott -- koztuk az, amelyikben a defektus kiszallt.
    // A kommentje pontosan ezt a bukast nevezte meg, es kozben azt kerdezte, NAGY-e a halmaz, nem
    // azt, hogy TELJES. Egy kuszob a mero LETEZESET igazolja, a HATOKORET nem.
    //
    // A ket alak KULON-KULON is szuk, ezert mindketto rajta van: egy top-level fajl (amit a `**/`
    // alak elvesztett) ES egy melyen fekvo (amit egy csak-top-level alak vesztene el).
    for (const must of ['src/idle-agent.ts', 'src/context-guard.ts', 'src/web/routes/approvals.ts']) {
      expect(production, `${must} KIMARADT a szken populaciojabol`).toContain(must)
    }
    expect(literals, 'nulla string-literal -- a parser nem latott semmit').toBeGreaterThan(1000)
    expect(
      hits.map((h) => `${h.file}:${h.line} ${JSON.stringify(h.text)}`),
      'sima sztringben levo jelolo -- ez SOHA nem fog behelyettesitodni',
    ).toEqual([])
  })
})
