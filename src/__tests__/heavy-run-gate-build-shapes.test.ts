/**
 * HEAVY-RUN KAPU, egesz-projekt build alakok (kartya bf2dbcba): `tsc -b`, `tsc -p`, `tsc --noEmit`, `eslint .`,
 * `npm run typecheck|lint` heavy-run.py nelkul tiltott, mint a teljes tesztkeszlet; egy fajlra szukitett futas,
 * a meta-kapcsolo es a heavy-run alatti futas atmegy. A kapu MINDEN Bash-hivason ul: a "nem tiltja" sorok
 * ugyanolyan fontosak, mint a tiltasok.
 *
 * EZ A FAJL SEMMIT NEM INDIT. A parancs csak SZOVEG a hook-payloadban, soha nem fut le.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mkTmp = tmpDirs()

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'heavy-run-gate.py')
const HR = '/Users/x/marveen/scripts/heavy-run.py'

let dir: string

function run(command: string) {
  const r = spawnSync('python3', [GATE], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: dir }),
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_HEAVY_GATE_LOG: join(dir, 'gate.log') },
  })
  return { code: r.status, stderr: r.stderr }
}

beforeAll(() => {
  dir = realpathSync(mkTmp('heavy-gate-build-'))
})

describe('heavy-run gate: refuses a whole-project tsc / eslint / typecheck / lint outside heavy-run.py', () => {
  it.each([
    // the 2026-11-12 21:48 shapes: one `tsc -b` was 6.3 GB RSS and 112% CPU
    ['npx tsc -b'],
    ['npx tsc -b --noEmit'],
    ['npx tsc --build'],
    ['npx tsc -p tsconfig.app.json'],
    ['npx tsc --project tsconfig.json --noEmit'],
    ['npx tsc --noEmit -p .'],
    // didi 60768 N4: a tsconfig named after -b/--build/--project is a project flag, not a narrowing file
    ['npx tsc -b tsconfig.app.json'],
    ['npx tsc --build tsconfig.json'],
    ['npx tsc -b tsconfig.app.json tsconfig.node.json'],
    ['npx tsc --project=tsconfig.json src/a.ts'],
    ['npx tsc --noEmit'],
    ['npx tsc --extendedDiagnostics'],
    ['npx tsc --noEmit --extendedDiagnostics'],
    // card 53f1258a: the value of a value flag is not a named file, so the run is still whole-project
    ['npx eslint . --ignore-pattern src/legacy/**'],
    ['npx eslint . --ignore-pattern dist/bundle.js'],
    ['npx eslint --ignore-pattern src/legacy/old.ts .'],
    ['npx eslint . --suppressions-location eslint-suppressions.json'],
    ['npx tsc --noEmit --outFile out/bundle.js'],
    ['npx tsc --noEmit --generateTrace trace/out.json'],
    ['npx tsc --noEmit --generateCpuProfile prof/run.json'],
    ['npx eslint . --stdin-filename a.ts'],
    // didi 60826 LELET 2: a directory-valued tsc flag with a variable value is still a value, not a variable file list
    ['npx tsc --noEmit --rootDir $SRC'],
    ['npx tsc --noEmit --rootDirs $SRC'],
    ['npx tsc --noEmit --baseUrl $ROOT'],
    ['npx tsc --noEmit --declarationDir $OUT'],
    ['npx tsc --noEmit --typeRoots $TYPES'],
    ['npx tsc --noEmit --sourceRoot $SRC'],
    ['npx tsc --noEmit --mapRoot $MAPS'],
    ['tsc'],
    ['cd frontend && npx tsc -b 2>&1 | tail -5'],
    ['NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit -p tsconfig.spec.json'],
    ['npx eslint .'],
    ['npx eslint src'],
    ['npx eslint src/**/*.ts'],
    ['npx eslint . --ext .ts,.tsx'],
    ['npx eslint --ext .ts,.tsx src'],
    ['npx eslint --max-warnings 0'],
    ['npm run typecheck'],
    ['npm run typecheck:tests'],
    ['npm run lint'],
    ['npm run lint:check'],
    ['npm run tsc:all'],
    ['yarn typecheck'],
    ['pnpm run lint'],
    ['npm run lint -- --fix'],
    ['git status; npx tsc -b'],
    ['(cd backend/api && npx tsc --noEmit)'],
    ['timeout 600 npx tsc --noEmit'],
  ])('%s -> exit 2', (command) => {
    expect(run(command).code).toBe(2)
  })

  it('names the shape and the correct form', () => {
    const r = run('npx tsc -b')
    expect(r.stderr).toContain('whole-project tsc/eslint')
    expect(r.stderr).toContain('npx tsc -b')
    expect(r.stderr).toContain('--short')
  })
})

describe('heavy-run gate: lets a narrowed or a meta build command through', () => {
  it.each([
    ['npx tsc --version'],
    ['npx tsc -v'],
    ['npx tsc --help'],
    ['npx tsc --showConfig'],
    ['npx eslint --version'],
    ['npx eslint --print-config src/a.ts'],
    ['npx eslint src/components/Foo.tsx'],
    ['npx eslint --fix src/a.ts src/b.ts'],
    ['npx eslint --ext .ts src/a.ts'],
    ['npx eslint --max-warnings 0 src/a.ts'],
    ['npx eslint $F'],
    ['npx eslint src/components/clients'],
    ['npx eslint ./src/hooks/queries'],
    ['npm run lint -- src/a.ts'],
    ['npm run lint -- --fix src/a.ts'],
    ['npx tsc --noEmit src/a.ts'],
    // didi 60768 LELET 2: --extendedDiagnostics is a boolean tsc flag, the file after it is still named
    ['npx tsc --extendedDiagnostics src/a.ts'],
    ['npx tsc --noEmit --extendedDiagnostics src/a.ts'],
    ['npx eslint --ignore-pattern dist/bundle.js src/a.ts'],
    ['npx tsc --noEmit --outFile out/bundle.js src/a.ts'],
    // didi 60826 LELET 1: with --stdin eslint lints the piped text only, whatever path arguments follow
    ['cat src/a.ts | npx eslint --stdin --stdin-filename src/a.ts'],
    ['npx eslint --stdin --stdin-filename src/a.ts < src/a.ts'],
    ['npx eslint --stdin --stdin-filename a.ts < $F'],
    // what only NAMES the tool
    ['git log --grep tsc'],
    ['grep -rn "tsc -b" docs/'],
    ['echo "run npm run typecheck later"'],
    ['git commit -m "fix: npx tsc -b is slow"'],
    ['ls node_modules/.bin/eslint'],
    ['pkill -f tsc'],
    ['npm run typecheck-notes:open'],
    // a wrapper variable set in an earlier call is invisible here: fail open
    ['$HR npx tsc -b'],
    ['"${H[@]}" npx eslint .'],
  ])('%s -> exit 0', (command) => {
    expect(run(command).code).toBe(0)
  })
})

describe('heavy-run gate: a whole-project build under heavy-run.py passes', () => {
  it.each([
    [`python3 ${HR} --label "ford bf2d tsc" --short -- npx tsc -b`],
    [`python3 ${HR} --label x --short -- npx eslint .`],
    [`python3 ${HR} --label x --short -- npm run typecheck:tests`],
    [`nohup python3 ${HR} --label x --short -- npm run lint > out 2>&1 &`],
    [`python3 ${HR} --label x -- sh -c 'npx tsc --noEmit'`],
  ])('%s -> exit 0', (command) => {
    expect(run(command).code).toBe(0)
  })

  it('passes with the logged override', () => {
    const r = run('MARVEEN_HEAVY_GATE=allow npx tsc -b')
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('allowed by MARVEEN_HEAVY_GATE=allow')
  })
})
