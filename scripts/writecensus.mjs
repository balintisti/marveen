#!/usr/bin/env node
/**
 * writecensus.mjs -- AST-cenzus a FAJLIRO hivohelyekrol, es arrol, hogy egy utat
 * TOBB KULONBOZO fuggveny ir-e (kartya 9ca92d74).
 *
 * MIERT LETEZIK, ES MIERT NEM EGY grep. A `writeFileSync(...)` mintara kotott grep
 * megmondja, HANY iras van; azt nem, hogy MELYIK FUGGVENYBOL. A kartya kerdese pedig
 * pont ez volt: ugyanazt a fajlt ket kulon fuggveny irja-e, mert akkor a ket iro
 * ELSODRODHAT egymastol -- az egyik kap egy ellenorzest, a masik nem. Ehhez a
 * befoglalo fuggveny kell, azt pedig csak a szintaxisfa tudja. A soronkenti mero itt
 * szerkezetileg vak, nem pontatlan.
 *
 * MIERT NEM CSAK A PAROKAT IRJA KI. Egy csoport, ahol MINDEN iro hordozza az
 * ellenorzest, egeszseges; ahol EGYIK SEM, az mas kerdes (lehet, hogy nem is kell).
 * A lelet a MEGOSZTOTT csoport: ahol az egyik iro vedve van es a masik nem. Ezert a
 * kimenet CSAK a split-coverage csoportokat nyomtatja -- a tobbi zaj lenne, es egy
 * mero, ami mindenre riaszt, par kor utan nem mero.
 *
 * A POZITIV KONTROLL, SZOBAN, mert enelkul a nulla nem allitas: a
 * `web/agent-scaffold.ts` `settingsPath` irasait keresi, es KOVETELI, hogy KET
 * nevesitett fuggvenyt talaljon -- `ensureAgentHooks` ES
 * `writeAgentSettingsFromProfile`. Ez a ket iras BIZONYITOTTAN letezik es
 * BIZONYITOTTAN ket kulon fuggvenybol jon, tehat ha a cenzus ezeket nem latja,
 * akkor a CENZUS a rossz, nem a kod. A kontroll NEM tanacs es nem kommentben all:
 * ha elbukik, a szkript `exit 2`-vel megall, es NEM ir ki cenzus-szamot.
 *
 * MIERT VEZETI LE A GYOKERET ES NEM DROTOZZA BE. Az elso valtozat
 * `/Users/isti/marveen`-t tartalmazott negy helyen. Egy bedrotozott ut egy MASIK
 * checkoutbol (worktree, masik gep, friss klon) nem hibat ad, hanem URES
 * eredmenyt -- "0 iro hivohely" --, ami pontosan ugy nez ki, mint egy tiszta fa.
 * Ez a lap altal ketszer rogzitett hibaalak. Ezert a gyoker a `git rev-parse
 * --show-toplevel`-bol jon, es ha nincs, a szkript MEGALL ahelyett, hogy nullat
 * mondana.
 *
 * Hasznalat:  node scripts/writecensus.mjs        (barhonnan a repon belul)
 */
import ts from 'typescript'
import { readFileSync, globSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const WRITERS = new Set(['writeFileSync', 'atomicWriteFileSync', 'appendFileSync'])
const GUARD = 'findDuplicateJsonKeys'

// A gyoker levezetve. Egy hianyzo gyoker HANGOS hiba, nem csendes ures halmaz.
let ROOT
try {
  ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
} catch {
  console.error('writecensus: nem git-repobol futott (git rev-parse --show-toplevel elhasalt).')
  console.error('  Ez SZANDEKOSAN hiba es nem ures eredmeny: egy 0-s cenzus itt')
  console.error('  megkulonboztethetetlen lenne egy tiszta fatol.')
  process.exit(2)
}

const files = globSync('src/**/*.ts', { cwd: ROOT })
  .filter(f => !f.includes('__tests__'))
  .map(f => path.join(ROOT, f))

// Ugyanaz az ok, egy szinttel lejjebb: ha a glob semmit nem talal, a fa nem tiszta,
// hanem a mero nezett rossz helyre.
if (files.length === 0) {
  console.error(`writecensus: NULLA forrasfajl a ${ROOT}/src alatt -- a mero nezett rossz helyre.`)
  process.exit(2)
}

/** A befoglalo, NEVESITETT fuggveny nevet adja vissza minden iro hivohelyhez. */
function enclosingNamed(node, stack) {
  return [...stack].reverse().find(s => s !== '(anon)') || '(top-level)'
}
function pushName(n, stack) {
  if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ||
      ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
    let name = n.name?.getText()
    if (!name && ts.isVariableDeclaration(n.parent)) name = n.parent.name.getText()
    if (!name && ts.isPropertyAssignment(n.parent)) name = n.parent.name.getText()
    stack.push(name || '(anon)')
    return true
  }
  return false
}

const rows = []
for (const file of files) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const stack = []
  const visit = (n) => {
    const pushed = pushName(n, stack)
    if (ts.isCallExpression(n)) {
      const base = n.expression.getText().split('.').pop()
      if (WRITERS.has(base) && n.arguments.length) {
        rows.push({
          file: path.relative(ROOT, file),
          line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          fn: enclosingNamed(n, stack),
          pathExpr: n.arguments[0].getText().replace(/\s+/g, ' ').slice(0, 60),
        })
      }
    }
    ts.forEachChild(n, visit)
    if (pushed) stack.pop()
  }
  visit(src)
}

// --- POZITIV KONTROLL ELOSZOR, es FATALIS, ha bukik ------------------------
// Sorrend szandekos: a cenzus-szam a kontroll UTAN kerul kepernyore, kulonben egy
// vak mero szama akkor is olvashato marad, ha a kontroll mellette elbukott.
const REQUIRED = ['ensureAgentHooks', 'writeAgentSettingsFromProfile']
const known = rows.filter(r => r.file.endsWith('web/agent-scaffold.ts') && r.pathExpr.includes('settingsPath'))
const knownFns = new Set(known.map(r => r.fn))
const missing = REQUIRED.filter(f => !knownFns.has(f))
console.log(`  POZITIV KONTROLL -- settingsPath irasok az agent-scaffold.ts-ben: ${known.length}`)
for (const r of known) console.log(`    :${r.line}  fn=${r.fn}`)
if (missing.length) {
  console.error(`  KONTROLL BUKOTT: hianyzik ${missing.join(', ')} -- a CENZUS a rossz, nem a kod.`)
  console.error('  Cenzus-szamot NEM irok ki: egy vak mero szama rosszabb, mint a semmi.')
  process.exit(2)
}
console.log(`  KONTROLL OK: mindket ismert iro megvan (${REQUIRED.join(', ')})`)
console.log(`\n  AST iro hivohely osszesen: ${rows.length}  (${files.length} forrasfajlbol)`)

// --- A CENZUS: mely utakat ir 2+ KULONBOZO fuggveny ugyanabban a fajlban? ---
const byPath = new Map()
for (const r of rows) {
  const key = `${r.file}::${r.pathExpr}`
  if (!byPath.has(key)) byPath.set(key, new Set())
  byPath.get(key).add(r.fn)
}
const paired = [...byPath.entries()].filter(([, fns]) => fns.size >= 2)
console.log(`\n  === UTAK, AMIKET 2+ KULONBOZO FUGGVENY IR (azonos fajlban) ===`)
console.log(`  jelolt csoport: ${paired.length} / ${byPath.size} ut-kifejezes`)
for (const [k, fns] of paired.sort((a, b) => b[1].size - a[1].size)) {
  const [file, expr] = k.split('::')
  console.log(`   ${fns.size}x  ${file}  path=${expr}`)
  console.log(`        ${[...fns].join(', ')}`)
}

// --- A jelolt csoportokon belul KI hordozza az ellenorzest? -----------------
console.log(`\n  === ${GUARD} LEFEDETTSEG a jelolt csoportokon belul ===`)
let splits = 0
for (const [k, fns] of paired.sort((a, b) => b[1].size - a[1].size)) {
  const [file] = k.split('::')
  const full = path.join(ROOT, file)
  const src = ts.createSourceFile(full, readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true)
  const withGuard = new Set()
  const stack = []
  const visit = (n) => {
    const pushed = pushName(n, stack)
    if (ts.isCallExpression(n) && n.expression.getText().includes(GUARD)) {
      const named = [...stack].reverse().find(s => s !== '(anon)')
      if (named) withGuard.add(named)
    }
    ts.forEachChild(n, visit)
    if (pushed) stack.pop()
  }
  visit(src)
  const has = [...fns].filter(f => withGuard.has(f))
  const lacks = [...fns].filter(f => !withGuard.has(f))
  if (has.length && lacks.length) {
    splits++
    console.log(`  *** MEGOSZTOTT LEFEDETTSEG  ${k.split('::')[1]}  itt: ${file}`)
    console.log(`        vedve: ${has.join(', ')}`)
    console.log(`      VEDTELEN: ${lacks.join(', ')}`)
  }
}
console.log(`  megosztott csoport: ${splits}`)
console.log('  (ahol MINDEN vagy EGYIK SEM iro hordozza az ellenorzest, azt nem nyomtatjuk -- csak a megosztottat)')
