import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card 3d05b3b9 (trillian 41046): the SEED's monthly threat-intel refresh copied
// upstream's catalogs file by file into the live catalog dir. The binary refuses a
// dir that mixes schema versions, so on 2026-09-28 0.2.0 catalogs next to a 0.1.0
// binary killed the weekly scan (rc=2). The live task was fixed; the seed was not,
// so every fresh install inherited the blind copy. This RUNS the seed's own bash
// block against a stub git and a stub binary, so the test follows the seed text,
// not a copy of it.

const mkTmp = tmpDirs()
const SEED = join(__dirname, '..', '..', 'seed-scheduled-tasks', 'bumblebee-hygiene-scan', 'SKILL.md')

function refreshBlock(): string {
  const md = readFileSync(SEED, 'utf-8')
  const step = md.slice(md.indexOf('**Monthly threat-intel refresh**'), md.indexOf('## Pitfalls'))
  const m = step.match(/```bash\n([\s\S]*?)```/)
  if (!m) throw new Error('no bash block in the seed refresh step')
  return m[1]
}

// upstream: the schema the stub clone delivers; the stub binary reads only 0.1.0
function runRefresh(upstream: string) {
  const root = mkTmp('bb-seed-')
  const bin = join(root, 'bin'), catalog = join(root, 'catalog'), fixture = join(root, 'upstream')
  mkdirSync(bin), mkdirSync(catalog), mkdirSync(fixture)
  writeFileSync(join(catalog, 'old.json'), '{"schema_version":"0.1.0","entries":[]}')
  writeFileSync(join(fixture, 'old.json'), `{"schema_version":"${upstream}","entries":[]}`)
  writeFileSync(join(fixture, 'new.json'), `{"schema_version":"${upstream}","entries":[]}`)
  writeFileSync(join(bin, 'git'),
    `#!/bin/bash\nfor d; do :; done\nmkdir -p "$d/threat_intel" && cp "${fixture}"/*.json "$d/threat_intel/"\n`)
  writeFileSync(join(bin, 'bumblebee'),
    '#!/bin/bash\nwhile [ $# -gt 0 ]; do [ "$1" = --exposure-catalog ] && dir="$2"; shift; done\n' +
    'grep -l \'"0.2.0"\' "$dir"/*.json >/dev/null 2>&1 && { echo "unsupported schema_version 0.2.0" >&2; exit 2; }\nexit 0\n')
  chmodSync(join(bin, 'git'), 0o755), chmodSync(join(bin, 'bumblebee'), 0o755)
  const r = spawnSync('bash', ['-c', refreshBlock()], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, BB_CATALOG: catalog, BB_BIN: join(bin, 'bumblebee') },
  })
  const schemas = readdirSync(catalog).filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(catalog, f), 'utf-8')).schema_version as string)
  return { out: r.stdout + r.stderr, schemas, marker: existsSync(join(catalog, '.last-refresh-check')) }
}

describe('seed bumblebee refresh: the binary decides, the set swaps whole (card 3d05b3b9)', () => {
  it('an upstream set the binary cannot read leaves the old catalogs untouched and no marker', () => {
    const r = runRefresh('0.2.0')
    expect(r.schemas).toEqual(['0.1.0'])
    expect(r.marker).toBe(false)
    expect(r.out).toContain('REFRESH SKIPPED')
  })
  it('CONTROL: a readable upstream set is swapped in whole and stamps the marker', () => {
    const r = runRefresh('0.1.1')
    expect(r.schemas.sort()).toEqual(['0.1.1', '0.1.1'])
    expect(r.marker).toBe(true)
    expect(r.out).toContain('catalogs swapped in')
  })
})
