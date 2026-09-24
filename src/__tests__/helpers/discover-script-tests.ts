import { readdirSync } from 'node:fs'

/**
 * Every `*.test.*` FILE under `dir`, at ANY depth, as paths relative to `dir` (card 20258ef3).
 *
 * The collector used a flat `readdirSync(dir)`, while its sibling, scripts/run-python-contract-tests.py,
 * globs recursively and says why in its docblock: a test put in a subdirectory drops out SILENTLY, and
 * the zero-files guard cannot see it, because every other test keeps running. Measured 2026-09-24:
 * 51 test files, all at the top level, no subdirectories -- exposure zero, which is why this is a
 * guard and not a fix for a lost test.
 *
 * Generated directories are skipped: `__pycache__` holds `*.test.*.pyc` whenever one test imports
 * another, and the collector's "every .test.* file has a handler" check would fail on them (upstream
 * met exactly this, PYCHYGIENE918). `node_modules` is never a test source.
 */
const SKIP_DIRS = new Set(['__pycache__', 'node_modules'])

export function discoverScriptTests(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.includes('.test.')) continue
    const parent = entry.parentPath
    const rel = parent === dir ? entry.name : `${parent.slice(dir.length + 1)}/${entry.name}`
    if (rel.split('/').some((seg) => SKIP_DIRS.has(seg))) continue
    out.push(rel)
  }
  return out.sort()
}
