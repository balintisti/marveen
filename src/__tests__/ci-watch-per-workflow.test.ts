import { describe, it, expect, beforeEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { writeFileSync, chmodSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'

// Card 5d7497a0: ci-watch read ONE shared `gh run list --limit 20` window and filtered it,
// so 19 Dependabot runs pushed CI out and a green main raised a false "missing" alert.
// A PATH-stubbed gh replays the measured 10-26 shape; nothing leaves the machine.
const SCRIPT = fileURLToPath(new URL('../../scripts/ci-watch.sh', import.meta.url))

type Run = { databaseId: number; workflowName: string; status: string; conclusion: string }
const run = (databaseId: number, workflowName: string, conclusion = 'success'): Run =>
  ({ databaseId, workflowName, status: 'completed', conclusion })

// newest first, like gh: 19 Dependabot + 1 Deploy fill the first 20, CI is the 21st
const RUNS: Run[] = [
  ...Array.from({ length: 19 }, (_, i) => run(500 - i, 'Dependabot Updates')),
  run(470, 'Deploy to Cloud Run'),
  run(460, 'CI'),
]

const mkTmp = tmpDirs()
let dir: string
beforeEach(() => { dir = mkTmp('ci-watch-') })

function setup(state: object) {
  const bin = join(dir, 'bin')
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(
    RUNS.map(r => ({ ...r, displayTitle: 't', createdAt: '2026-10-26T08:00:00Z', url: 'u' }))))
  // gh stub: --workflow X -> only X's runs (unknown X -> rc 1, like gh); no --workflow -> first 20
  writeFileSync(join(bin, 'gh'), `#!/bin/bash
echo "$@" >> "${dir}/gh-argv.log"
wf=""; while [ $# -gt 0 ]; do [ "$1" = "--workflow" ] && wf="$2"; shift; done
exec python3 - "$wf" "${dir}/runs.json" <<'PY'
import json, sys
wf, path = sys.argv[1:3]
runs = json.load(open(path))
if wf:
    runs = [r for r in runs if r["workflowName"] == wf]
    if not runs:
        print(f'could not find any workflows named {wf}'); sys.exit(1)
print(json.dumps(runs[:20]))
PY
`)
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n')
  writeFileSync(join(dir, 'notify.sh'), `#!/bin/bash\nprintf '%s\\n' "$1" >> "${dir}/notified.log"\n`)
  for (const f of [join(bin, 'gh'), join(bin, 'sleep'), join(dir, 'notify.sh')]) chmodSync(f, 0o755)
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state))
  return bin
}

function watch(bin: string, workflows?: string) {
  return spawnSync('/bin/bash', [SCRIPT], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/opt/homebrew/bin:/usr/bin:/bin`,
      CI_WATCH_REPO: dir,
      CI_WATCH_STATE: join(dir, 'state.json'),
      CI_WATCH_NOTIFY: join(dir, 'notify.sh'),
      ...(workflows === undefined ? {} : { CI_WATCH_WORKFLOWS: workflows }),
    },
  })
}

const GREEN_STATE = {
  last_key: 'CI:success|Deploy to Cloud Run:success',
  last_run_id: { CI: 460, 'Deploy to Cloud Run': 470 },
}

describe('ci-watch asks each watched workflow on its own (5d7497a0)', () => {
  it('finds CI behind 19 Dependabot runs: unchanged green, no "missing", no alert', () => {
    const r = watch(setup(GREEN_STATE))
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('valtozatlan (0 rossz)')
    expect(r.stdout).not.toContain('hianyzik')
    expect(existsSync(join(dir, 'notified.log'))).toBe(false)
    const argv = readFileSync(join(dir, 'gh-argv.log'), 'utf8')
    expect(argv).toContain('--workflow CI ')
    expect(argv).toContain('--workflow Deploy to Cloud Run ')
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).missing_streak).toBeUndefined()
  })

  it('a red CI behind the Dependabot runs is still reported', () => {
    RUNS[20] = run(461, 'CI', 'failure')
    try {
      const r = watch(setup(GREEN_STATE))
      expect(r.status).toBe(0)
      expect(readFileSync(join(dir, 'notified.log'), 'utf8')).toContain('CI: failure')
    } finally { RUNS[20] = run(460, 'CI') }
  })

  it('an unknown watched workflow is UNMEASURABLE (alert), not a partial green', () => {
    const r = watch(setup(GREEN_STATE), 'CI,Renamed Deploy')
    expect(r.status).toBe(1)
    expect(readFileSync(join(dir, 'notified.log'), 'utf8')).toContain('NEM TUDTAM MEGMERNI')
    expect(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).last_key).toBe('unmeasurable')
  })

  it('ALL keeps the shared window (no --workflow), under the launchd /bin/bash', () => {
    const r = watch(setup({}), 'ALL')
    expect(r.stderr).not.toContain('unbound variable')
    expect(readFileSync(join(dir, 'gh-argv.log'), 'utf8')).not.toContain('--workflow')
    expect(r.stdout).toContain('ALLAPOTVALTOZAS')
  })
})
