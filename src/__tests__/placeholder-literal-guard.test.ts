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

function scanSource(files: string[]): { hits: Hit[]; literals: number } {
  const hits: Hit[] = []
  let literals = 0
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const walk = (node: ts.Node): void => {
      // `isStringLiteral` is true for '...' and "..." and FALSE for template literals, which is
      // exactly the distinction that matters. A line-based regex cannot make it: jarvis's first
      // pattern returned ten hits, all of them apostrophes INSIDE backtick strings, and my own
      // earlier census had the same fault. The parser knows which is which.
      if (ts.isStringLiteral(node)) {
        literals++
        if (PLACEHOLDER.test(node.text)) {
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
  }
  return { hits, literals }
}

describe('egy jelolo sima sztringben SOHA nem helyettesitodik be', () => {
  const tracked = execSync("git ls-files 'src/**/*.ts'", { encoding: 'utf8' }).split('\n').filter(Boolean)
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

  it('a TELJES forrasfaban egyetlen sima sztring sem hordoz jelolot', () => {
    const { hits, literals } = scanSource(production)
    // A mero LATOTT valamit: enelkul egy elgepelt glob is nullat adna, es a nulla tisztanak
    // olvasodna. (Merve 2026-09-05: 162 fajl, 8495 string-literal, 126 ms.)
    expect(production.length, 'a fajl-lista ures -- a glob a rossz').toBeGreaterThan(50)
    expect(literals, 'nulla string-literal -- a parser nem latott semmit').toBeGreaterThan(1000)
    expect(
      hits.map((h) => `${h.file}:${h.line} ${JSON.stringify(h.text)}`),
      'sima sztringben levo jelolo -- ez SOHA nem fog behelyettesitodni',
    ).toEqual([])
  })
})
