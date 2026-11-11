/**
 * y1-report-only: the EXEMPTION rules (card 5b639edb, scripts/hooks/y1-report-only/exemptions.mjs).
 *
 * A rule rewrites the command and the gate decides the rewrite, so two things are tested apart:
 *   1. the rewrite itself: what each rule takes out of the text, and every shape it REFUSES (the text comes back
 *      unchanged, so the gate reads the original);
 *   2. the outcome through judge(): a command a rule could be fooled by stays a would-deny.
 * A refusal that stopped refusing would turn a would-deny into `exempted`: each refusal below has the write to a
 * protected file that shows it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { tmpDirs } from './helpers/tmp-dirs.js'
import { makeInstall, type Y1Install } from './helpers/y1-install.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { judge } from '../../scripts/hooks/y1-report-only/decide.mjs'
// @ts-expect-error -- plain .mjs hook script, no types
import { RULES, exemptionFor, rewrite, shellKinds } from '../../scripts/hooks/y1-report-only/exemptions.mjs'

const mkTmp = tmpDirs()
const NEUTRAL = '/nonexistent/y1-neutral'
const VAR = [0]
const SQLITE = [1]
const READ = [2]
const ENV = { TMPDIR: '/var/tmp/' }

const text = (command: string, set: number[], env: Record<string, string> = ENV): string => rewrite(command, set, env).text
const unchanged = (command: string, set: number[], env: Record<string, string> = ENV): void => {
  expect(rewrite(command, set, env)).toEqual({ text: command, changed: [] })
}

describe('y1-report-only exemptions: the rule list', () => {
  it('is these three, in this order (the sets below are indexes into it)', () => {
    expect(RULES.map((r: [string, unknown]) => r[0])).toEqual(['variable-resolved', 'sqlite-mode-ro', 'interpreter-read-only'])
  })

  it('names the rules that changed the text, and only those', () => {
    const cmd = `f=/tmp/a; python3 -c "open('/x/settings.json')" > $f`
    expect(rewrite(cmd, [0, 1, 2], ENV)).toEqual({ text: `f=/tmp/a; python3 -c "open('${NEUTRAL}')" > /tmp/a`, changed: ['variable-resolved', 'interpreter-read-only'] })
  })
})

describe('y1-report-only exemptions: shellKinds, what each character is to the shell', () => {
  const kinds = (s: string): string | null => shellKinds(s)?.join('') ?? null

  it.each([
    [`echo 'q' "d $(n)" x`, 'LLLLLqqqLdddNNNNdLL'],
    ['a `b` c', 'LLLNNLL'],
    ['(a)', 'LNN'],
    ['a\\ b', 'LLqL'],
    [`$'a\\'b'`, 'qqqqqqq'],
    ['a # b\nc', 'LLNNNLL'],
    [`cat <<'E'\n$f\nE\nx`, 'LLLLLLqqqLqqqqLL'],
    ['cat <<E\n$f\nE', 'LLLLLLqLdddq'],
  ])('%j', (s, want) => {
    expect(want).toHaveLength(s.length)
    expect(kinds(s)).toBe(want)
  })

  it.each([
    [`echo 'x`],
    ['echo "x'],
    ['echo )'],
    ['echo $(x'],
    ['echo `x'],
    ['cat <<E\nbody'],
    ['cat << \nbody'],
  ])('a shape it does not follow is null, not a guess: %j', (s) => {
    expect(shellKinds(s)).toBeNull()
  })
})

describe('y1-report-only exemptions: variable-resolved', () => {
  it.each([
    ['f=/tmp/a; echo x > $f', 'f=/tmp/a; echo x > /tmp/a'],
    ['f=/tmp/a\necho x > "$f" && cat ${f}', 'f=/tmp/a\necho x > "/tmp/a" && cat /tmp/a'],
    [`f='/tmp/a'; g="/tmp/b" && cp $f $g`, `f='/tmp/a'; g="/tmp/b" && cp /tmp/a /tmp/b`],
    ['d=/a; f=$d/b; cat $f', 'd=/a; f=/a/b; cat /a/b'],
    ['f=/tmp/a; echo "$(cat $f)" `cat $f`', 'f=/tmp/a; echo "$(cat /tmp/a)" `cat /tmp/a`'],
    ['f=/tmp/a; cat <<E\n$f\nE', 'f=/tmp/a; cat <<E\n/tmp/a\nE'],
    ['f=/tmp/a; IFS= read -r line < x; echo $f', 'f=/tmp/a; IFS= read -r line < x; echo /tmp/a'],
    ['f=$(mktemp); cat > $f', 'f=$(mktemp); cat > /var/tmp/tmp.XXXXXXXX'],
    ['f="$(mktemp -d)"; ls $f', 'f="$(mktemp -d)"; ls /var/tmp/tmp.XXXXXXXX'],
    ['f=$(mktemp -t pre); cat $f', 'f=$(mktemp -t pre); cat /var/tmp/pre.XXXXXXXX'],
    ['f=$(mktemp /tmp/y1.XXXXXX); cat $f', 'f=$(mktemp /tmp/y1.XXXXXX); cat /tmp/y1.XXXXXX'],
  ])('writes the value in place of the name: %j', (cmd, want) => {
    expect(rewrite(cmd, VAR, ENV)).toEqual({ text: want, changed: ['variable-resolved'] })
  })

  it('takes /tmp for mktemp when the hook has no TMPDIR', () => {
    expect(text('f=$(mktemp); cat > $f', VAR, {})).toBe('f=$(mktemp); cat > /tmp/tmp.XXXXXXXX')
  })

  it('leaves alone what the shell would not expand to this value', () => {
    // single quotes, an escaped dollar, a longer name, a quoted heredoc, zsh's subscript and modifier
    expect(text(`f=/tmp/a; echo '$f' \\$f $foo $f[1] $f:h $f`, VAR)).toBe(`f=/tmp/a; echo '$f' \\$f $foo $f[1] $f:h /tmp/a`)
    expect(text(`f=/tmp/a; cat <<'E'\n$f\nE\necho $f`, VAR)).toBe(`f=/tmp/a; cat <<'E'\n$f\nE\necho /tmp/a`)
    // a use BEFORE the assignment is not this value
    expect(text('echo $f; f=/tmp/a; echo $f', VAR)).toBe('echo $f; f=/tmp/a; echo /tmp/a')
  })

  it.each([
    ['assigned twice', 'f=/tmp/a; f=/tmp/b; echo $f'],
    ['appended to', 'f=/tmp/a; f+=/b; echo $f'],
    ['assigned again in a subshell', 'f=/tmp/a; (f=/tmp/b); echo $f'],
    ['assigned again in a command substitution', 'f=/tmp/a; x=$(f=/tmp/b; echo 1); echo $f'],
    ['assigned again behind a comment sign', 'f=/tmp/a; echo # ; f=/tmp/b\necho $f'],
    ['assigned under a condition', 'if true; then f=/tmp/a; fi; echo $f'],
    ['assigned in a loop', 'for x in 1 2; do f=/tmp/a; done; echo $f'],
    ['assigned after &&', 'true && f=/tmp/a; echo $f'],
    ['assigned after ||', 'true || f=/tmp/a; echo $f'],
    ['assigned in a { group', '{ f=/tmp/a; }; echo $f'],
    ['assigned in a function', 'function g { f=/tmp/a; }; echo $f'],
    ['a prefix of one command only', 'f=/tmp/a true; echo $f'],
    ['exported', 'export f=/tmp/a; echo $f'],
    ['read into', 'f=/tmp/a; read f < /tmp/p; echo $f'],
    ['a loop variable', 'f=/tmp/a; for f in /x /y; do :; done; echo $f'],
    ['written by printf -v', 'f=/tmp/a; printf -v f %s /tmp/b; echo $f'],
    ['unset', 'f=/tmp/a; unset f; echo $f'],
    ['declared local', 'f=/tmp/a; local f; echo $f'],
    ['written in arithmetic', 'f=1; ((f++)); echo $f'],
    ['used with a ${...} form other than ${f}', 'f=/tmp/a; echo ${f:-/tmp/b} $f'],
    ['a value with an expansion', 'f=$HOME/a; echo $f'],
    ['a value with a glob', 'f=/tmp/*; echo $f'],
    ['a value with a tilde', 'f=~/a; echo $f'],
    ['a value in $(...) that is not mktemp', 'f=$(cat /tmp/p); echo $f'],
    ['mktemp with a flag that is not followed', 'f=$(mktemp -p /x); echo $f'],
    ['mktemp with two templates', 'f=$(mktemp /a.XXXXXX /b.XXXXXX); echo $f'],
    ['mktemp after the command sets TMPDIR', 'TMPDIR=/x; f=$(mktemp); echo $f'],
    ['eval in the command', `f=/tmp/a; eval 'f=/tmp/b'; echo $f`],
    ['source in the command', 'f=/tmp/a; source ./x.sh; echo $f'],
    ['the dot command', 'f=/tmp/a; . ./x.sh; echo $f'],
    ['a trap', `f=/tmp/a; trap 'f=/tmp/b' EXIT; echo $f`],
    ['an alias', `f=/tmp/a; alias e='echo'; echo $f`],
    ['a case', 'f=/tmp/a; case x in x) :;; esac; echo $f'],
    ['IFS set', 'f=/tmp/a; IFS=/; echo $f'],
    ['an open quote', `f=/tmp/a; echo $f 'x`],
    ['a heredoc without its end', 'f=/tmp/a; cat <<E\n$f'],
    ['the only use inside an inner shell (single quotes)', `f=/tmp/a; bash -c 'echo x > $f'`],
  ])('refuses a name that is %s', (_why, cmd) => {
    unchanged(cmd, VAR)
  })

  it('refuses a name the hook itself has in its environment', () => {
    unchanged('f=/tmp/a; echo $f', VAR, { f: '/elsewhere' })
  })
})

describe('y1-report-only exemptions: sqlite-mode-ro', () => {
  it('takes the path out of a URI that ends in mode=ro', () => {
    expect(text(`sqlite3 'file:/x/store/claudeclaw.db?mode=ro' "select 1"`, SQLITE)).toBe(`sqlite3 'file:${NEUTRAL}?mode=ro' "select 1"`)
    expect(text(`c=sqlite3.connect("file:store/claudeclaw.db?mode=ro",uri=True)`, SQLITE)).toBe(`c=sqlite3.connect("file:${NEUTRAL}?mode=ro",uri=True)`)
    expect(text('sqlite3 file:a.db?mode=ro .tables; sqlite3 file:b.db?mode=ro', SQLITE)).toBe(`sqlite3 file:${NEUTRAL}?mode=ro .tables; sqlite3 file:${NEUTRAL}?mode=ro`)
  })

  it.each([
    [`sqlite3 'file:/x/claudeclaw.db?mode=rw' "select 1"`],
    [`sqlite3 'file:/x/claudeclaw.db?mode=rwc' "select 1"`],
    [`sqlite3 'file:/x/claudeclaw.db?mode=ro&mode=rw' "select 1"`],
    [`sqlite3 'file:/x/claudeclaw.db?mode=row' "select 1"`],
    [`sqlite3 'file:/x/claudeclaw.db?cache=shared' "select 1"`],
    [`sqlite3 /x/claudeclaw.db "select 'file:?mode=ro'"`],
    ['sqlite3 "file:$DB?mode=ro" .tables'],
    ['sqlite3 "file:`cat p`?mode=ro" .tables'],
  ])('leaves every other spelling to the gate: %j', (cmd) => {
    unchanged(cmd, SQLITE)
  })
})

describe('y1-report-only exemptions: interpreter-read-only', () => {
  const P = '/x/.claude/settings.json'

  it.each([
    [`open('${P}')`],
    [`open("${P}")`],
    [`open('${P}', 'r')`],
    [`open('${P}','rb')`],
    [`open('${P}', mode='rt')`],
    [`open('${P}', encoding='utf-8')`],
    [`open('${P}', 'r', encoding="utf-8", errors='replace')`],
    [`open('${P}', newline=None)`],
    [`Path('${P}').read_text()`],
    [`Path("${P}").read_bytes()`],
    [`Path('${P}').read_text(encoding='utf-8')`],
    [`readFileSync('${P}')`],
    [`fs.readFileSync("${P}", 'utf8')`],
  ])('takes the path out of a call that can only read: %s', (call) => {
    const cmd = `python3 -c "x = ${call}"`
    expect(rewrite(cmd, READ, ENV)).toEqual({ text: cmd.replace(P, NEUTRAL), changed: ['interpreter-read-only'] })
  })

  it.each([
    [`open('${P}', 'w')`],
    [`open('${P}', 'a')`],
    [`open('${P}', 'r+')`],
    [`open('${P}', 'rb+')`],
    [`open('${P}', 'x')`],
    [`open('${P}', mode='w')`],
    [`open('${P}', 'r', opener=o)`],
    [`open('${P}', buffering=0)`],
    [`open('${P}', m)`],
    [`os.open('${P}')`],
    [`reopen('${P}')`],
    [`open(p)`],
    [`open('/x/' + name)`],
    [`Path('${P}').write_text('{}')`],
    [`Path('${P}').open('w')`],
    [`Path('${P}').unlink()`],
    [`Path('${P}')`],
    [`writeFileSync('${P}', '{}')`],
    [`readFileSync('${P}', { flag: 'w' })`],
    [`appendFileSync('${P}', 'x')`],
    [`$readFileSync('${P}')`],
  ])('leaves every call that could do more: %s', (call) => {
    unchanged(`python3 -c "x = ${call}"`, READ)
  })

  it.each([
    ['the path taken back from the handle', `f = open('${P}'); open(f.name, 'w')`],
    ['the path taken back with a blank before name', `f = open('${P}'); open(f . name, 'w')`],
    ['the descriptor taken back', `f = open('${P}'); os.write(f.fileno(), b'x')`],
    ['open redefined by def', `def open(p): return io.open(p, 'w')\nopen('${P}')`],
    ['open redefined by assignment', `open = lambda p: io.open(p, 'w'); open('${P}')`],
  ])('refuses the whole command with %s', (_why, body) => {
    unchanged(`python3 - <<'PY'\n${body}\nPY`, READ)
  })
})

describe('y1-report-only exemptions: the gate decides the rewrite', () => {
  const job = { toolName: 'Bash', toolInput: { command: 'f=/tmp/a; echo x > $f' } }

  it('is exempted only when the gate allows the rewritten text, and is named after the rules that changed it', () => {
    const seen: string[] = []
    const allowResolved = (input: { command: string }): { deny: boolean } => {
      seen.push(input.command)
      return { deny: !input.command.endsWith('> /tmp/a') }
    }
    expect(exemptionFor(job, {}, { deny: true, reason: 'install-file' }, allowResolved, ENV)).toBe('variable-resolved')
    expect(seen).toEqual(['f=/tmp/a; echo x > /tmp/a'])
  })

  it('is not exempted when the gate denies the rewrite too, or fails on it', () => {
    expect(exemptionFor(job, {}, { deny: true, reason: 'install-file' }, () => ({ deny: true }), ENV)).toBeNull()
    expect(exemptionFor(job, {}, { deny: true, reason: 'install-file' }, () => ({ deny: false, error: 'boom' }), ENV)).toBeNull()
  })

  it('never asks the gate about a text no rule changed', () => {
    const asked = vi.fn(() => ({ deny: false }))
    expect(exemptionFor({ toolName: 'Bash', toolInput: { command: 'echo x >> /x/hook.mjs' } }, {}, { deny: true, reason: 'install-file' }, asked, ENV)).toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  it('has no rule for a file tool: a Write is what it says', () => {
    const asked = vi.fn(() => ({ deny: false }))
    expect(exemptionFor({ toolName: 'Write', toolInput: { file_path: '/x', command: 'f=/tmp/a; echo $f' } }, {}, { deny: true, reason: 'install-file' }, asked, ENV)).toBeNull()
    expect(asked).not.toHaveBeenCalled()
  })

  it('names a git deny as outside this hook, whatever the command', () => {
    expect(exemptionFor({ toolName: 'Bash', toolInput: { command: 'git push fork x' } }, {}, { deny: true, reason: 'git' }, null, ENV)).toBe('git-hunk-excluded')
  })
})

describe('y1-report-only exemptions: through the real gate, for a sub-agent', () => {
  let I: Y1Install
  let settings: string
  beforeAll(() => {
    I = makeInstall(mkTmp('y1-exempt-'), 'symlinked')
    vi.stubEnv('HOME', I.home)
    settings = join(I.root, '.claude', 'settings.json')
  })
  afterAll(() => vi.unstubAllEnvs())

  const verdict = (command: string, cwd?: string): string => {
    const v = judge(I.sub('dexter', 'Bash', { command }, cwd))
    return v.kind === 'exempted' ? `exempted:${v.exemption}` : v.kind
  }
  const roUri = (): string => `c=sqlite3.connect('file:${I.root}/store/claudeclaw.db?mode=ro',uri=True)`

  it('exempts a hook file only READ through a variable, the shape the corpus had most', () => {
    expect(verdict(`N=scripts/hooks/db-write-gate.mjs\necho '[1]' | node $N`, I.root)).toBe('exempted:variable-resolved')
    expect(verdict(`N=${I.root}/scripts/hooks/db-write-gate.mjs; node $N`)).toBe('exempted:variable-resolved')
    expect(verdict(`N=${I.root}/scripts/hooks/a.py; python3 $N`)).toBe('exempted:variable-resolved')
  })

  it('needs no exemption where the gate follows the variable itself', () => {
    expect(verdict(`H=${I.root}/scripts/hooks; grep -c exit $H/db-write-gate.mjs`)).toBe('allow')
  })

  it('exempts two rules together when neither is enough alone', () => {
    expect(verdict(`N=${I.root}/scripts/hooks/a.py; python3 $N; python3 -c "print(len(open('${settings}').read()))"`)).toBe('exempted:variable-resolved+interpreter-read-only')
  })

  it.each<[string, (i: Y1Install, s: string) => string, ((i: Y1Install) => string)?]>([
    ['the variable resolves to the settings', (_i, s) => `f=${s}; echo x > $f`],
    ['the variable is assigned twice', (i, s) => `f=${i.scratch}/a; f=${s}; echo x > $f`],
    ['the harmless assignment is conditional', (i) => `cd ${i.root}; if false; then\nf=/tmp/a\nfi\necho x > \${f}.claude/settings.json`],
    ['an inner shell assigns it again', (i, s) => `f=${i.scratch}/a; bash -c 'f=${s}; echo x > $f'`],
    ['eval assigns it again', (i, s) => `f=${i.scratch}/a; eval 'f=${s}'; echo x > $f`],
    ['the assignment is a prefix of one command', () => 'f=/tmp/a true; echo x > $f/.claude/settings.json', (i) => i.root],
    ['a mode=ro URI stands next to a write of the settings', (_i, s) => `python3 - <<'PY'\nimport sqlite3\n${roUri()}\nopen('${s}','w').write('{}')\nPY`],
    ['the file is opened for reading and written by its name', (_i, s) => `python3 -c "f=open('${s}'); open(f.name,'w').write('{}')"`],
    ['the file is opened r+', (_i, s) => `python3 -c "open('${s}','r+').write('{}')"`],
    ['the read is followed by a redirect to the file', (_i, s) => `python3 -c "print(open('${s}').read())" > ${s}`],
  ])('stays a would-deny when %s', (_why, make, cwd) => {
    expect(verdict(make(I, settings), cwd?.(I))).toBe('would-deny')
  })
})
