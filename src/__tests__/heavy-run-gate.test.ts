/**
 * HEAVY-RUN KAPU (kartya c29f01b7): teljes tesztkeszlet heavy-run.py nelkul nem indulhat.
 * A tiltasok mellett a kontrollok (szukitett futas, heavy-run alatt, csak irt heredoc) ugyanolyan
 * fontosak: a kapu MINDEN Bash-hivason ul, egy hamis tiltas az egesz flottat allitja meg.
 *
 * EZ A FAJL SEMMILYEN TESZTET NEM INDIT. A parancs csak SZOVEG a hook-payloadban, soha nem fut le.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mkTmp = tmpDirs()

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'heavy-run-gate.py')
const HR = '/Users/x/marveen/scripts/heavy-run.py'

let dir: string
let logFile: string

function runGate(gate: string, input: string, log = logFile) {
  const r = spawnSync('python3', [gate], {
    input,
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_HEAVY_GATE_LOG: log },
  })
  return { code: r.status, stderr: r.stderr }
}

function run(command: string, cwd = dir) {
  return runGate(GATE, JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }))
}

beforeAll(() => {
  dir = realpathSync(mkTmp('heavy-gate-'))
  logFile = join(dir, 'gate.log')
  writeFileSync(join(dir, 'run-all.sh'), 'set -e\ncd backend\nnpx jest --silent\n')
  writeFileSync(join(dir, 'run-one.sh'), 'npx jest src/a.spec.ts\n')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub', 'full.sh'), 'npx vitest run\n')
})

describe('heavy-run gate: refuses a full suite outside heavy-run.py', () => {
  it.each([
    // 2026-11-03 22:10: the sub-agent run that took the machine to load 96
    ['nohup sh -c "npx jest --testPathIgnorePatterns integration > $S/x 2>&1" &'],
    ['npm run test > f 2>&1'],
    ['npm test'],
    ['npm test -- --runInBand'],
    ['npx vitest run --reporter=dot'],
    ['npx vitest run --reporter dot --pool forks'],
    ['TZ=UTC npx jest --silent'],
    ['cd backend && npx jest --coverage'],
    ["bash -c 'npx vitest run'"],
    ['npx playwright test'],
    ['yarn test'],
    ['./node_modules/.bin/jest --ci'],
    ['git status; npx jest --exclude legacy'],
    // a runner passed to a shell function as arguments
    ['step() { "$@"; }; step vitest npx vitest run'],
  ])('%s -> exit 2', (command) => {
    expect(run(command).code).toBe(2)
  })

  it('reads a script written by a heredoc in the same command and run there', () => {
    const cmd = "cat > $S/run-mo.sh <<'EOF'\ncd backend\nnpx vitest run\nEOF\nsh $S/run-mo.sh"
    expect(run(cmd).code).toBe(2)
  })

  it('reads a script already on disk: absolute path, relative to the payload cwd, and after cd', () => {
    expect(run(`bash ${dir}/run-all.sh`, '/').code).toBe(2)
    expect(run('bash run-all.sh').code).toBe(2)
    expect(run('./run-all.sh').code).toBe(2)
    expect(run('cd sub && sh full.sh').code).toBe(2)
  })

  it('names the command and the correct form, and logs the refusal', () => {
    const r = run('npm run test > f 2>&1')
    expect(r.stderr).toContain('HEAVY-RUN GATE: REFUSED')
    expect(r.stderr).toContain('npm run test')
    expect(r.stderr).toMatch(/python3 \S+heavy-run\.py --label/)
    expect(r.stderr).toContain('MARVEEN_HEAVY_GATE=allow')
    expect(readFileSync(logFile, 'utf8')).toMatch(/ DENY npm run test \| npm run test > f 2>&1\n/)
  })
})

describe('heavy-run gate: lets the routine through', () => {
  it.each([
    [`python3 ${HR} --label "friday c29f be" -- npx jest`],
    [`python3 ${HR} --label x --short -- npm test`],
    [`nohup python3 ${HR} --label x -- sh -c 'npx vitest run' > out 2>&1 &`],
    [`H=(python3 ${HR} --label c); $H --short -- npx jest`],
    [`HR="python3 ${HR}"; $HR --label x -- npx vitest run`],
    [`hr() { python3 ${HR} --label "$1" -- "\${@:2}"; }; hr x npx jest`],
    ['npx vitest run src/__tests__/heavy-run-gate.test.ts'],
    ['npx jest src/a.spec.ts --runInBand'],
    ['npx jest -t "refuses a name"'],
    ['npx jest --testPathPattern=clients'],
    ['npx playwright test --grep @smoke'],
    ['npm test -- src/a.test.ts'],
    ['npx vitest related src/x.ts'],
    ['ls src/*.test.ts | xargs npx vitest run'],
    ['npx vitest list'],
    ['npx jest --listTests'],
    ['npx vitest --version'],
    ['git log --grep vitest'],
    ['grep -rn "npx jest" docs/'],
    ['echo "run npm test later"'],
    ['pkill -f vitest'],
    ['bash -n run-all.sh'],
    ['bash run-one.sh'],
    ['npm run testdata:seed -- foo.json'],
  ])('%s -> exit 0', (command) => {
    expect(run(command).code).toBe(0)
  })

  it('a heredoc body that is only written is data, not a run', () => {
    expect(run("cat > $S/r.sh <<'EOF'\nnpx jest\nEOF\nchmod +x $S/r.sh").code).toBe(0)
  })

  it('a heredoc script run under heavy-run.py passes', () => {
    expect(run(`cat > $S/r.sh <<'EOF'\nnpx jest\nEOF\npython3 ${HR} --label x -- bash $S/r.sh`).code).toBe(0)
  })

  it('passes with the logged override', () => {
    const r = run('MARVEEN_HEAVY_GATE=allow npx jest')
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('allowed by MARVEEN_HEAVY_GATE=allow')
    expect(readFileSync(logFile, 'utf8')).toMatch(/ OVERRIDE MARVEEN_HEAVY_GATE=allow npx jest \| MARVEEN_HEAVY_GATE=allow npx jest\n/)
  })

  it('ignores other tools and an unparseable payload', () => {
    expect(runGate(GATE, JSON.stringify({ tool_name: 'Read', tool_input: { command: 'npx jest' } })).code).toBe(0)
    expect(runGate(GATE, 'not json').code).toBe(0)
  })
})

describe('heavy-run gate: fails open', () => {
  it('on unparseable shell syntax, logged', () => {
    expect(run('npx jest "unterminated').code).toBe(0)
    expect(readFileSync(logFile, 'utf8')).toMatch(/ FAIL-OPEN unparseable shell syntax \| npx jest "unterminated\n/)
  })

  it('when heavy-run.py is missing: the correct form must exist before the wrong one is refused', () => {
    const root = realpathSync(mkTmp('heavy-gate-copy-'))
    mkdirSync(join(root, 'scripts', 'hooks'), { recursive: true })
    const gate = join(root, 'scripts', 'hooks', 'heavy-run-gate.py')
    copyFileSync(GATE, gate)
    const log = join(root, 'copy.log')
    const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'npx jest' }, cwd: root })

    expect(existsSync(join(root, 'scripts', 'heavy-run.py'))).toBe(false)
    expect(runGate(gate, input, log).code).toBe(0)
    expect(readFileSync(log, 'utf8')).toContain('FAIL-OPEN heavy-run.py missing')

    // positive control: the same copy refuses once heavy-run.py is there
    writeFileSync(join(root, 'scripts', 'heavy-run.py'), '')
    expect(runGate(gate, input, log).code).toBe(2)
  })
})
