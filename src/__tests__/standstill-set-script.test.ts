import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transformSync } from 'esbuild'
import { tmpDirs } from './helpers/tmp-dirs.js'

// WHY THIS TEST EXISTS (card 292ee15a). scripts/standstill-set.sh writes an agent's workcheck.json
// `standstill` and reads it back through the idle watcher's own evaluator. Its --self-test carries
// the positive and negative controls (and the fake evaluators that force the read-back to disagree),
// but nothing ran it: a change to parseWorkCheck / standstillVerdict (a new field, a new rule for
// `until`) would leave the helper believing the old rules. The evaluator is built from SOURCE here,
// not taken from dist/, so the test sees the code a rebuild would ship.

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'standstill-set.sh')
const mkTmp = tmpDirs()

describe('scripts/standstill-set.sh --self-test', () => {
  it('passes against the evaluator built from src/idle-agent.ts', () => {
    const engine = join(mkTmp('standstill-engine-'), 'idle-agent.mjs')
    const src = readFileSync(join(REPO, 'src', 'idle-agent.ts'), 'utf8')
    writeFileSync(engine, transformSync(src, { loader: 'ts', format: 'esm' }).code)
    const out = execFileSync('bash', [SCRIPT, '--self-test'], {
      encoding: 'utf-8',
      env: { ...process.env, STANDSTILL_ENGINE: engine },
    })
    expect(out).toContain('self-test: PASS')
    expect(out).not.toContain('BUKO')
  })
})
