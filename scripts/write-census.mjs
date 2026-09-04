#!/usr/bin/env node
/**
 * write-census.mjs -- AST census of file-WRITE call sites in src/, and which of them
 * share a destination path without sharing its guard.
 *
 * WHY IT EXISTS (card e3f8f2fd, then 99d3fef7). A destination written by SEVERAL functions
 * is a class, not an instance: hardening ONE of them looks like a fix and leaves the others
 * open. A text grep cannot answer it -- it finds the call but not the ENCLOSING FUNCTION, and
 * the enclosing function is the unit that either carries the guard or does not. Hence the AST.
 *
 * WHAT IT MEASURES
 *   1. every call to writeFileSync / atomicWriteFileSync / appendFileSync under src/**\/*.ts
 *      (excluding __tests__), with file, line, enclosing named function and the first argument
 *      as written;
 *   2. destination expressions written by 2+ DISTINCT functions in the same file;
 *   3. inside those groups, which functions call findDuplicateJsonKeys -- and prints ONLY the
 *      SPLIT ones (some guarded, some not). All-guarded and none-guarded are different
 *      questions and would be noise here.
 *
 * WHAT IT DOES NOT MEASURE -- read this before quoting a number from it
 *   - It matches the CALL NAME, so a write reached through an alias, a wrapper, a dynamic
 *     property or a re-export is invisible to it. The count is a floor, not a total.
 *   - It groups by the SOURCE TEXT of the first argument. Two functions writing the same file
 *     through differently-spelled expressions do not group; the same spelling in two files does
 *     not group either (the file is part of the key, deliberately).
 *   - "Unguarded" means the enclosing function does not itself call findDuplicateJsonKeys. It
 *     may be guarded by its caller, or need no guard at all. Every hit is a QUESTION, not a
 *     defect.
 *   - src/ only. scripts/, web/ and dist/ are outside the census.
 *
 * THE POSITIVE CONTROL IS ENFORCED, NOT PRINTED (this is the 2026-09-04 change). The previous
 * version printed "CONTROL PASSES if it names X AND Y" and then exited 0 regardless -- a
 * printed intention, which is the failure this repo keeps measuring. A census that silently
 * stops matching returns "0 findings", and zero findings reads as health. So: if the known
 * instance is not reproduced, this exits 2 and says so.
 *
 * RUN:   node scripts/write-census.mjs          (read-only; writes nothing, anywhere)
 * EXIT:  0 = census produced and control held | 2 = CONTROL FAILED, output not trustworthy
 */
import { readFileSync, globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Anchored to THIS FILE, not to cwd -- so it measures the tree it ships in, and a copy in a
// worktree measures that worktree. Same convention as dist/config.js PROJECT_ROOT.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// The compiler is resolved from THIS file's tree. A bare worktree has no node_modules, and the
// raw ERR_MODULE_NOT_FOUND stack reads like a broken script rather than a missing dependency --
// so say which it is, and use a distinct exit code so a caller can tell "not measured" from
// "measured, nothing found".
let ts
try {
  ts = (await import('typescript')).default
} catch {
  console.error(`  NEM MERHETO: a 'typescript' csomag nem oldhato fel innen: ${ROOT}`)
  console.error('  Ez NEM ures cenzus. Futtasd a fo checkoutbol, vagy telepitsd a fuggosegeket ott,')
  console.error('  ahol ez a fajl van (egy git worktree alapbol nem hoz node_modules-t).')
  process.exit(3)
}

const WRITERS = new Set(['writeFileSync', 'atomicWriteFileSync', 'appendFileSync'])
const GUARD = 'findDuplicateJsonKeys'
// The known instance: agent-scaffold.ts writes settingsPath from several functions, and this
// pair is guarded. If the census stops naming BOTH, it has broken.
const CONTROL_FILE = 'web/agent-scaffold.ts'
const CONTROL_PATH = 'settingsPath'
const CONTROL_FNS = ['ensureAgentHooks', 'writeAgentSettingsFromProfile']

const namedStack = (stack) => [...stack].reverse().find((s) => s !== '(anon)')

function walk(file, onCall) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const stack = []
  const visit = (n) => {
    let pushed = false
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) ||
        ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
      let name = n.name?.getText()
      if (!name && ts.isVariableDeclaration(n.parent)) name = n.parent.name.getText()
      if (!name && ts.isPropertyAssignment(n.parent)) name = n.parent.name.getText()
      stack.push(name || '(anon)'); pushed = true
    }
    if (ts.isCallExpression(n)) onCall(n, stack, src)
    ts.forEachChild(n, visit)
    if (pushed) stack.pop()
  }
  visit(src)
}

const files = globSync('src/**/*.ts', { cwd: ROOT })
  .filter((f) => !f.includes('__tests__'))
  .map((f) => path.join(ROOT, f))

const rows = []
for (const file of files) {
  walk(file, (n, stack, src) => {
    const base = n.expression.getText().split('.').pop()
    if (!WRITERS.has(base) || !n.arguments.length) return
    rows.push({
      file: path.relative(ROOT, file),
      line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1,
      fn: namedStack(stack) || '(top-level)',
      pathExpr: n.arguments[0].getText().replace(/\s+/g, ' ').slice(0, 60),
    })
  })
}
console.log(`  AST write call sites: ${rows.length}   (files scanned: ${files.length})`)

// ---- POSITIVE CONTROL, ENFORCED -------------------------------------------------------
const known = rows.filter((r) => r.file.endsWith(CONTROL_FILE) && r.pathExpr.includes(CONTROL_PATH))
const knownFns = new Set(known.map((r) => r.fn))
const missing = CONTROL_FNS.filter((f) => !knownFns.has(f))
console.log(`  POSITIVE CONTROL -- ${CONTROL_PATH} writes in ${CONTROL_FILE}: ${known.length}`)
for (const r of known) console.log(`    :${r.line}  fn=${r.fn}`)
if (missing.length) {
  console.error(`  CONTROL FAILED: expected ${CONTROL_FNS.join(' AND ')}; missing ${missing.join(', ')}.`)
  console.error('  The census is NOT trustworthy in this state -- a silent zero here would read as health.')
  process.exit(2)
}
console.log(`  control OK (names ${CONTROL_FNS.join(' and ')})`)

// ---- destinations written by 2+ distinct functions -------------------------------------
const byPath = new Map()
for (const r of rows) {
  const key = `${r.file}::${r.pathExpr}`
  if (!byPath.has(key)) byPath.set(key, new Set())
  byPath.get(key).add(r.fn)
}
const paired = [...byPath.entries()].filter(([, fns]) => fns.size >= 2)
  .sort((a, b) => b[1].size - a[1].size)
console.log(`\n  === PATHS WRITTEN BY 2+ DISTINCT FUNCTIONS (same file) ===`)
console.log(`  candidate groups: ${paired.length} of ${byPath.size} path-expressions`)
for (const [k, fns] of paired) {
  const [file, expr] = k.split('::')
  console.log(`   ${fns.size}x  ${file}  path=${expr}`)
  console.log(`        ${[...fns].join(', ')}`)
}

// ---- guard coverage INSIDE those groups -- only SPLIT ones are printed ------------------
console.log(`\n  === GUARD (${GUARD}) COVERAGE inside each paired group ===`)
let splits = 0
for (const [k, fns] of paired) {
  const [file, expr] = k.split('::')
  const withGuard = new Set()
  walk(path.join(ROOT, file), (n, stack) => {
    if (!n.expression.getText().includes(GUARD)) return
    const named = namedStack(stack)
    if (named) withGuard.add(named)
  })
  const has = [...fns].filter((f) => withGuard.has(f))
  const lacks = [...fns].filter((f) => !withGuard.has(f))
  if (has.length && lacks.length) {
    splits++
    console.log(`  *** SPLIT COVERAGE  ${expr}  in ${file}`)
    console.log(`        guarded: ${has.join(', ')}`)
    console.log(`      UNguarded: ${lacks.join(', ')}`)
  }
}
console.log(`  split groups: ${splits}  (all-guarded and none-guarded are NOT printed -- different questions)`)
