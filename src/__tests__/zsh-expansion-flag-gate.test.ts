/**
 * ZSH EXPANSION-FLAG KAPU (kartya 8c744138): a `${(f)...}` / `${(@f)...}` alakot a PreToolUse Bash hook
 * megtagadja es a javitast megnevezi, mert a Claude Code engedely-ellenorzo nem tudja elolvasni, es
 * "Dangerous rm operation not ruled out" prompton PARKOL (mert 2026-11-03..13: 3 alkalom). A kapu MINDEN Bash
 * hivason ul: a "nem tiltja" sorok ugyanolyan fontosak, mint a tiltasok.
 *
 * EZ A FAJL SEMMIT NEM INDIT. A parancs csak SZOVEG a hook-payloadban, soha nem fut le.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const mkTmp = tmpDirs()

const GATE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'hooks', 'zsh-expansion-flag-gate.py')

let dir: string
let logFile: string

function runRaw(input: string) {
  const r = spawnSync('python3', [GATE], {
    input,
    encoding: 'utf8',
    env: { ...process.env, MARVEEN_ZSHFLAG_GATE_LOG: logFile },
  })
  return { code: r.status, stderr: r.stderr }
}

function run(command: string, tool = 'Bash') {
  return runRaw(JSON.stringify({ tool_name: tool, tool_input: { command } }))
}

beforeAll(() => {
  dir = realpathSync(mkTmp('zsh-flag-gate-'))
  logFile = join(dir, 'gate.log')
})

describe('zsh expansion-flag gate: refuses a parameter-expansion flag the permission check cannot read', () => {
  it.each([
    // the two real commands that parked a sub-agent (messages 10016712, 10016793)
    [`cd /x/sajat-crm/frontend && T=("\${(@f)$(git diff --name-only c4ffb0d260..HEAD -- src | grep -E '\\.test\\.tsx?$')}") && print -l $T`],
    [`cd /x && git add \${(f)"$(git status --short | grep a2a24d29 | awk '{print $2}')"} && git commit -q -m "test: red repro"`],
    ['F=(${(f)"$(git status --short)"})'],
    ['echo ${(u)ARR}'],
    ['for f in ${(f)LIST}; do echo $f; done'],
    ['echo "${(@f)LIST}"'],
    ['x=$(echo ${(f)LIST})'],
    ['ls | wc -l; echo ${(j:,:)ARR}'],
    ['git commit -q -m "fix: ${(f)x} is slow"'],
    // an unquoted heredoc body is expanded by the shell, so it is code, not data
    ['cat <<EOF\n${(f)x}\nEOF'],
    // a nested double quote inside a command substitution does not end the outer one
    ['echo "$(echo "a b") ${(f)LIST}"'],
    ['cd /x; for f in ${(f)"$(git ls-files)"}\ndo echo $f\ndone'],
  ])('%s -> exit 2', (command) => {
    expect(run(command).code).toBe(2)
  })

  it('names the shape and the way out', () => {
    const r = run('F=(${(f)"$(git status --short)"})')
    expect(r.stderr).toContain('ZSH EXPANSION-FLAG GATE: REFUSED')
    expect(r.stderr).toContain('while IFS= read -r')
    expect(r.stderr).toContain('xargs')
    expect(r.stderr).toContain('MARVEEN_ZSHFLAG_GATE=allow')
  })

  it('logs the refusal', () => {
    run('echo ${(f)LOGGED}')
    expect(readFileSync(logFile, 'utf8')).toMatch(/DENY .*LOGGED/)
  })
})

describe('zsh expansion-flag gate: lets everything else through', () => {
  it.each([
    // a plain parameter expansion and the `=` split flag are not the measured trigger
    ['echo ${HOME} ${#ARR} ${VAR:-x} ${ARR[1]}'],
    ['F=$(cat list.txt); python3 x.py ${=F}'],
    ['ls'],
    // data, not code: single quotes, a quoted heredoc delimiter, a comment, an escape, ANSI-C quoting
    [`grep -n '\${(' scripts/hooks/*.py`],
    [`echo '\${(f)x}'`],
    ["cat > run.zsh <<'EOF'\nF=(${(f)\"$(ls)\"})\nEOF"],
    ['cat > run.zsh <<"EOF"\nF=(${(f)x})\nEOF'],
    ['ls # ${(f)x}'],
    ['echo \\${(f)x}'],
    [`echo $'\${(f)x}'`],
    // a command that is only text
    ['git log --grep "zsh flags"'],
    // a heredoc written and then a plain command on the next line
    ["cat <<'EOF' > n.txt\n${(f)x}\nEOF\nls"],
    [''],
  ])('%s -> exit 0', (command) => {
    expect(run(command).code).toBe(0)
  })

  it('ignores a tool that is not Bash', () => {
    expect(run('echo ${(f)x}', 'Edit').code).toBe(0)
  })

  it('fails open on an unparseable payload', () => {
    expect(runRaw('not json').code).toBe(0)
    expect(runRaw('').code).toBe(0)
  })

  it('passes with the logged override', () => {
    const r = run('MARVEEN_ZSHFLAG_GATE=allow echo ${(f)x}')
    expect(r.code).toBe(0)
    expect(r.stderr).toContain('allowed by MARVEEN_ZSHFLAG_GATE=allow')
    expect(readFileSync(logFile, 'utf8')).toMatch(/OVERRIDE /)
  })
})
