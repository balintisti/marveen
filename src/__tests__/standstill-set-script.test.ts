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
    const dir = mkTmp('standstill-engine-')
    const engine = join(dir, 'idle-agent.mjs')
    // The watcher's .env parser too: the script reads the coordinator name through it (card 292ee15a),
    // and a temp dir holding only the engine has no env-parse.js next to it.
    const envParse = join(dir, 'env-parse.mjs')
    const build = (file: string) =>
      transformSync(readFileSync(join(REPO, 'src', file), 'utf8'), { loader: 'ts', format: 'esm' }).code
    writeFileSync(engine, build('idle-agent.ts'))
    writeFileSync(envParse, build('env-parse.ts'))
    const out = execFileSync('bash', [SCRIPT, '--self-test'], {
      encoding: 'utf-8',
      env: { ...process.env, STANDSTILL_ENGINE: engine, STANDSTILL_ENV_PARSE: envParse },
    })
    expect(out).toContain('self-test: PASS')
    expect(out).not.toContain('BUKO')
  })
})
