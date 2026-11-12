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

// what the rules did to the text; WHY a rule refused is asserted apart, by refuses()
const rw = (command: string, set: number[], env: Record<string, string> = ENV): { text: string; changed: string[] } => {
  const { text, changed } = rewrite(command, set, env)
  return { text, changed }
}
const text = (command: string, set: number[], env: Record<string, string> = ENV): string => rewrite(command, set, env).text
const unchanged = (command: string, set: number[], env: Record<string, string> = ENV): void => {
  expect(rw(command, set, env)).toEqual({ text: command, changed: [] })
}
// a refusal, and WHY: the text comes back as it was, and the rule names what it would not follow
const refuses = (command: string, set: number[], why: string): void => {
  const r = rewrite(command, set, ENV)
  expect({ text: r.text, changed: r.changed }).toEqual({ text: command, changed: [] })
  expect(r.refused).toEqual({ [RULES[set[0]][0]]: why })
}

describe('y1-report-only exemptions: the rule list', () => {
  it('is these three, in this order (the sets below are indexes into it)', () => {
    expect(RULES.map((r: [string, unknown]) => r[0])).toEqual(['variable-resolved', 'sqlite-mode-ro', 'interpreter-read-only'])
  })

  it('names the rules that changed the text, and only those', () => {
    const cmd = `f=/tmp/a; python3 -c "open('/x/settings.json').read()" > $f`
    expect(rw(cmd, [0, 1, 2], ENV)).toEqual({ text: `f=/tmp/a; python3 -c "open('${NEUTRAL}').read()" > /tmp/a`, changed: ['variable-resolved', 'interpreter-read-only'] })
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
    expect(rw(cmd, VAR, ENV)).toEqual({ text: want, changed: ['variable-resolved'] })
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
    expect(rw(cmd, READ, ENV)).toEqual({ text: cmd.replace(P, NEUTRAL), changed: ['interpreter-read-only'] })
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

// didi's E1 (comment 58963): a name can be written without its assignment being in sight. Each command below ends in
// the write that showed it: after the unseen write, ${f}.claude/settings.json is not under /tmp/a.
describe('y1-report-only exemptions: variable-resolved, a name written out of sight', () => {
  const T = 'echo x > ${f}.claude/settings.json'

  it.each([
    ['unset through a name the reader resolves', `f=/tmp/a; G=f; unset $G; ${T}`, 'f: written by unset f'],
    ['unset through a name nobody knows', `f=/tmp/a; unset $G; ${T}`, 'name from an expansion: unset $'],
    ['read into an expansion', `f=/tmp/a; read -r "$G" < /tmp/p; ${T}`, 'name from an expansion: read -r $'],
    ['exported under an expansion', `f=/tmp/a; export $G=/etc; ${T}`, 'name from an expansion: export $'],
    ['declared under a quoted expansion', `f=/tmp/a; declare "$G=/etc"; ${T}`, 'name from an expansion: declare $'],
    ['the target of printf -v from an expansion', `f=/tmp/a; printf -v "$G" %s /etc; ${T}`, 'name from an expansion: printf -v $'],
    ['the name getopts fills, from an expansion', `f=/tmp/a; getopts a: $G; ${T}`, 'name from an expansion: getopts a: $'],
    ['the array mapfile fills, from an expansion', `f=/tmp/a; mapfile -t $G < /tmp/p; ${T}`, 'name from an expansion: mapfile -t $'],
    ['reached through a nameref to an expansion', `f=/tmp/a; declare -n r=$G; r=/etc; ${T}`, 'name from an expansion: declare -n'],
    ['reached through a nameref to it', `f=/tmp/a; declare -n r=f; r=/etc; ${T}`, 'f: written by declare -n r=f'],
    ['unset by a builtin in double quotes', `f=/tmp/a; "unset" f; ${T}`, 'f: written by unset f'],
    ['unset by a builtin half in single quotes', `f=/tmp/a; 'un'set f; ${T}`, 'f: written by unset f'],
    ['unset by a builtin with an escaped letter', `f=/tmp/a; un\\set f; ${T}`, 'f: written by unset f'],
    ['declared again inside quotes', `f=/tmp/a; declare "f=/etc"; ${T}`, 'f: written by declare f'],
    ['written by a quoted let', `f=/tmp/a; let "f = 5"; ${T}`, 'f: written by let f'],
    ['read into with a zsh prompt', `f=/tmp/a; read 'f?go'; ${T}`, 'f: written by read f'],
    ['given a descriptor by {f}>', `f=/tmp/a; exec {f}>/dev/null; ${T}`, 'f: written by {f}>'],
    ['unset by a command that is itself a resolved name', `f=/tmp/a; c=unset; $c f; ${T}`, 'f: written by unset f'],
    ['next to a command that is an expansion', `f=/tmp/a; "$1" f; ${T}`, 'command from an expansion: ; $'],
    ['next to an expansion run through command', `f=/tmp/a; command $c f; ${T}`, 'command from an expansion: ; command $'],
    ['next to arithmetic over a name', `f=/tmp/a; x='f=5'; (( x )); ${T}`, 'arithmetic over a value: (( x'],
    ['next to an arithmetic expansion over a name', `f=/tmp/a; echo $(( x + 1 )); ${T}`, 'arithmetic over a value: (( x'],
    ['next to a numeric test', `f=/tmp/a; [[ $x -eq 0 ]]; ${T}`, 'arithmetic over a value: -eq'],
    ['next to a subscript over a name', `f=/tmp/a; echo \${a[x]}; ${T}`, 'arithmetic over a value: ${a['],
    ['next to an assignment under a subscript', `f=/tmp/a; a[$x]=1; ${T}`, 'arithmetic over a value: a[$x]='],
    ['next to zsh indirect assignment', `f=/tmp/a; : \${(P)G::=/etc}; ${T}`, 'indirect expansion: ${(P'],
    ['next to an eval in double quotes', `f=/tmp/a; "eval" 'f=/etc'; ${T}`, 'not followed: eval'],
    ['next to a source half in single quotes', `f=/tmp/a; 'so'urce /x/y; ${T}`, 'not followed: source'],
    ['the name wait -p fills, from an expansion', `f=/tmp/a; sleep 1 & wait -n -p "$G"; ${T}`, 'name from an expansion: wait -n -p $'],
    ['the array set -A fills, from an expansion', `f=/tmp/a; set -A "$G" /etc; ${T}`, 'name from an expansion: set -A $'],
    ['filled by wait -p', `f=/tmp/a; sleep 1 & wait -n -p f; ${T}`, 'f: written by wait -n -p f'],
    ['filled by set -A', `f=/tmp/a; set -A f /etc; ${T}`, 'f: written by set -A f'],
    ['next to bash indirect assignment', `f=/tmp/a; : \${!G:=/etc}; ${T}`, 'indirect expansion: ${!G:='],
    ['written by a module builtin under an expansion', `f=/tmp/a; strftime -s $G fmt 0; ${T}`, 'name from an expansion: strftime -s $'],
    // only the reading AS WRITTEN refuses this one (the shell unsets af): the second opinion is kept on purpose
    ['next to a quoted piece glued to it', `f=/tmp/a; unset "a"f; ${T}`, 'f: written by unset f'],
  ])('refuses a name that is %s', (_why, cmd, why) => {
    refuses(cmd, VAR, why)
  })

  // Each of these unsets or fills f in a real shell (bash 3.2 and zsh 5.9, measured 2026-11-12; `$"` in bash only,
  // strftime, the short function body, repeat and the `-` precommand in zsh only; the two patterns with a file named
  // `unset` or `f` in the directory). The word that does it is made when the command runs.
  it.each([
    ['a substitution', `unse$(echo t) f`, 'command from an expansion: ; unse$'],
    ['a name nobody knows', `unse\${T} f`, 'command from an expansion: ; unse$'],
    ['a quoted piece and an expansion', `"unse"$T f`, 'command from an expansion: ; unse$'],
    ['a brace expansion', `unse{t,} f`, 'command from an expansion: ; unse{'],
    ['a locale string', `rea$"d" f <<< ''`, 'command from an expansion: ; rea$'],
    ['an ANSI string with an escape', `unse$'\\x74' f`, 'command from an expansion: ; unse%%'],
    ['an ANSI string', `rea$'d' f <<< ''`, 'command from an expansion: ; rea%'],
    ['the name of a file', `uns?t f`, 'command from an expansion: ; uns?'],
    ['an expansion after command and its option', `c=$(echo unset); command -p $c f`, 'command from an expansion: ; command -p $'],
    ['a substitution after builtin', `builtin unse$(echo t) f`, 'command from an expansion: ; builtin unse$'],
    ['a substitution after a redirection', `2>/dev/null unse$(echo t) f`, 'command from an expansion: ; 2>/dev/null unse$'],
    ['a substitution after an assignment that holds a blank', `x=$(date +%s) unse$(echo t) f`, 'command from an expansion: ; x=$(date +%s) unse$'],
    ['a substitution as a short function body', `r() unse$(echo t) f; r`, 'command from an expansion: () unse$'],
    ['a substitution under repeat', `repeat 1 unse$(echo t) f`, 'command from an expansion: repeat 1 unse$'],
    ['a substitution after the - precommand', `- unse$(echo t) f`, 'command from an expansion: ; - unse$'],
  ])('refuses a command word made at run time by %s', (_why, cmd, why) => {
    refuses(`f=/tmp/a; ${cmd}; ${T}`, VAR, why)
  })

  it.each([
    ['a range of names', `unset {e..g}`, 'name from an expansion: unset {'],
    ['the name of a file', `unset ?`, 'name from an expansion: unset ?'],
    ['a range read into', `read {e..g} <<< 'a b c'`, 'name from an expansion: read {'],
    ['a pattern declared', `declare ?=/etc`, 'name from an expansion: declare ?'],
    ['a pattern in brackets', `unset [e-g]`, 'name from an expansion: unset ['],
    ['every file name', `unset *`, 'name from an expansion: unset *'],
    ['a pattern after printf -v', `printf -v ? %s /etc`, 'name from an expansion: printf -v ?'],
    ['a pattern after wait -p', `sleep 1 & wait -n -p ?`, 'name from an expansion: wait -n -p ?'],
    ['a pattern after set -A', `set -A ? /etc`, 'name from an expansion: set -A ?'],
  ])('refuses a writer whose target is made at run time by %s', (_why, cmd, why) => {
    refuses(`f=/tmp/a; ${cmd}; ${T}`, VAR, why)
  })

  // the rule reads text: every place a command word can stand is on a list, and each entry is held here
  it.each([
    ...[';', '&&', '||', '|', '\n', '{ ', '! ', 'then ', 'do ', 'else ', 'elif ', 'if ', 'while ', 'until '].map((sep) => `true ${sep}WORD f`),
    ...['time ', 'command ', 'builtin ', 'exec ', 'noglob ', 'nocorrect ', 'time -p ', 'A=1 B="$(c d)" ', '>/dev/null 2>&1 '].map((pre) => `${pre}WORD f`),
    '(WORD f)',
  ])('sees the command word in %j', (shape) => {
    const r = rewrite(`f=/tmp/a; ${shape.replace('WORD', 'unse$(echo t)')}; ${T}`, VAR, ENV)
    expect(r.changed).toEqual([])
    expect(r.refused['variable-resolved']).toMatch(/^command from an expansion: .*unse\$$/)
  })

  it.each(['REPLY', 'reply', 'OPTARG', 'OPTIND', 'MAPFILE', 'BASH_REMATCH', 'match', 'MATCH', 'PWD', 'OLDPWD', 'path', '_'])(
    'never takes %s for its assignment: the shell writes it on its own', (name) => {
      refuses(`${name}=/tmp/a; read; echo x > \${${name}}.claude/settings.json`, VAR, `${name}: the shell writes it`)
    })

  it.each([
    ['PY=/usr/bin/python3; f=/tmp/a; $PY -c 1 > $f', 'PY=/usr/bin/python3; f=/tmp/a; /usr/bin/python3 -c 1 > /tmp/a'],
    ['f=/tmp/a; export PATH="$PATH:/x"; cat $f', 'f=/tmp/a; export PATH="$PATH:/x"; cat /tmp/a'],
    ['f=/tmp/a; while read -r l; do echo "$l"; done < "$f"', 'f=/tmp/a; while read -r l; do echo "$l"; done < "/tmp/a"'],
    ['f=/tmp/a; read -r x < "$f"', 'f=/tmp/a; read -r x < "/tmp/a"'],
    ['f=/tmp/a; echo $((1+2)) > $f', 'f=/tmp/a; echo $((1+2)) > /tmp/a'],
    ['d=/a; f=$d/b; arr=($f $d); cat $f', 'd=/a; f=/a/b; arr=(/a/b /a); cat /a/b'],
    ['f=/tmp/a; echo "read it" > $f', 'f=/tmp/a; echo "read it" > /tmp/a'],
    ['f=/tmp/a; printf "%s\\n" "$f"', 'f=/tmp/a; printf "%s\\n" "/tmp/a"'],
    ['f=/tmp/a; [[ ! -f $x ]] && cat $f', 'f=/tmp/a; [[ ! -f $x ]] && cat /tmp/a'],
    ['f=/tmp/a; [ ! -d "$d" ] || cat $f', 'f=/tmp/a; [ ! -d "$d" ] || cat /tmp/a'],
    ['f=/tmp/a; /usr/bin/$tool $f', 'f=/tmp/a; /usr/bin/$tool /tmp/a'],
    ['f=/tmp/a; x=$(date +%s); cat $f', 'f=/tmp/a; x=$(date +%s); cat /tmp/a'],
    ['f=/tmp/a; for i in {1..3}; do cat $f; done', 'f=/tmp/a; for i in {1..3}; do cat /tmp/a; done'],
    ['f=/tmp/a; { ls *.json; echo {a,b}; } > $f', 'f=/tmp/a; { ls *.json; echo {a,b}; } > /tmp/a'],
    ['f=/tmp/a; command -v node > $f', 'f=/tmp/a; command -v node > /tmp/a'],
    ['f=/tmp/a; 2>/dev/null cat $f', 'f=/tmp/a; 2>/dev/null cat /tmp/a'],
  ])('still follows what only looks like one of these: %j', (cmd, want) => {
    expect(rewrite(cmd, VAR, ENV)).toEqual({ text: want, changed: ['variable-resolved'], refused: {} })
  })
})

// didi's E2: the URI was made neutral wherever it stood, so a second program handed the same text wrote the file.
describe('y1-report-only exemptions: sqlite-mode-ro, only where SQLite opens the URI', () => {
  const U = 'file:/x/claudeclaw.db?mode=ro'
  const N = `file:${NEUTRAL}?mode=ro`

  it.each([
    [`node -e "require('fs').writeFileSync(new URL('${U}'), '')"`],
    [`echo sqlite3 '${U}'`],
    [`./sqlite3 '${U}' .tables`],
    [`/x/bin/sqlite3 '${U}' .tables`],
    [`sqlite3 -cmd '.shell id' '${U}'`],
    [`sqlite3 /x/other.db "attach '${U}' as a"`],
    [`u='${U}'; echo $u`],
    [`python3 -c "import sqlite3; x.connect('${U}', uri=True)"`],
    [`python3 -c "import urllib.request; urllib.request.urlopen('${U}')"`],
  ])('leaves the URI where another program reads it: %j', (cmd) => {
    expect(rewrite(cmd, SQLITE, ENV)).toEqual({ text: cmd, changed: [], refused: {} })
  })

  it('takes out the one sqlite3 opens and leaves the same text handed to node', () => {
    expect(text(`sqlite3 '${U}' "select 1"; node -e "new URL('${U}')"`, SQLITE)).toBe(`sqlite3 '${N}' "select 1"; node -e "new URL('${U}')"`)
  })

  it.each([
    ['.shell', `sqlite3 '${U}' ".shell touch x"`, 'dot-command: .shell'],
    ['.system', `sqlite3 '${U}' ".system touch x"`, 'dot-command: .system'],
    ['a prefix of .shell', `sqlite3 '${U}' ".sh touch x"`, 'dot-command: .sh'],
    ['.databases, which prints the path', `sqlite3 ${U} .databases`, 'dot-command: .databases'],
    ['.show, which prints the path', `sqlite3 '${U}' '.show'`, 'dot-command: .show'],
    ['.open', `sqlite3 '${U}' ".open /x/claudeclaw.db"`, 'dot-command: .open'],
    ['a dot-command on stdin', `printf '.shell id\\n' | sqlite3 '${U}'`, 'dot-command: .shell'],
    ['a dot-command in a heredoc', `sqlite3 '${U}' <<'E'\n.system id\nE`, 'dot-command: .system'],
    ['PRAGMA database_list', `sqlite3 '${U}' 'PRAGMA database_list' | awk '{print $3}' | xargs rm`, 'path-back: database_list'],
    ['pragma_database_list in any case', `sqlite3 '${U}' 'select file from PRAGMA_DATABASE_LIST'`, 'path-back: database_list'],
    ['load_extension', `sqlite3 '${U}' "select load_extension('/x/e')"`, 'path-back: load_extension'],
    ['database_list from python', `python3 -c "import sqlite3; c=sqlite3.connect('${U}',uri=True); print(c.execute('pragma database_list').fetchall())"`, 'path-back: database_list'],
  ])('refuses a command with %s', (_what, cmd, why) => {
    refuses(cmd, SQLITE, why)
  })

  it.each([
    [`for p in a b; do sqlite3 '${U}' "select '$p'"; done`, `for p in a b; do sqlite3 '${N}' "select '$p'"; done`],
    [`id=$(sqlite3 -readonly -header '${U}' .tables)`, `id=$(sqlite3 -readonly -header '${N}' .tables)`],
    [`sqlite3 ${U} ".mode json" ".headers on" "select 1"`, `sqlite3 ${N} ".mode json" ".headers on" "select 1"`],
    [`sqlite3 ${U} "select 1"; python3 -c 'print(" ".join(["a"]))'`, `sqlite3 ${N} "select 1"; python3 -c 'print(" ".join(["a"]))'`],
  ])('still takes the URI out of %j', (cmd, want) => {
    expect(rewrite(cmd, SQLITE, ENV)).toEqual({ text: want, changed: ['sqlite-mode-ro'], refused: {} })
  })
})

// didi's E3: repr(f) and str(f) carry the path of the handle. The handle of an open( the rule takes out can only be read.
describe('y1-report-only exemptions: interpreter-read-only, a handle that is only read', () => {
  const P = '/x/.claude/settings.json'
  const py = (body: string): string => `python3 - <<'PY'\n${body}\nPY`

  it.each([
    ['repr of the handle', `f = open('${P}'); print(repr(f))`, 'handle not read: f'],
    ['str of the handle', `f = open('${P}'); p = str(f)`, 'handle not read: f'],
    ['the handle printed', `with open('${P}') as f:\n  print(f)`, 'handle not read: f'],
    ['the handle in an f-string', `f = open('${P}'); print(f'{f}')`, 'handle not read: f'],
    ['the handle formatted', `f = open('${P}'); print('%s' % f)`, 'handle not read: f'],
    ['the handle under a second name', `f = open('${P}'); g = f; print(g)`, 'handle not read: f'],
    ['the handle passed to a function nobody knows', `f = open('${P}'); show(f)`, 'handle not read: f'],
    ['an unbound handle printed', `print(open('${P}'))`, 'handle not read: unbound open('],
    ['an unbound handle kept in a list', `h = [open('${P}')]`, 'handle not read: unbound open('],
    ['getattr on the handle', `f = open('${P}'); f.read(); getattr(f, 'na' + 'me')`, 'handle-back: getattr'],
    ['vars()', `f = open('${P}'); f.read(); print(vars())`, 'handle-back: vars('],
    ['the descriptor asked by fcntl', `import fcntl\nf = open('${P}'); f.read()`, 'handle-back: fcntl'],
    ['open imported under that name', `from shutil import rmtree as open\nopen('${P}')`, 'name reused: open'],
    ['a star import', `from os import *\nx = open('${P}').read()`, 'handle-back: import *'],
    ['Path redefined', `Path = lambda p: Bad(p)\nPath('${P}').read_text()`, 'name reused: Path'],
    // the handle as one of several things: the name holds it inside what the lists do not describe
    ['a handle bound next to a second value', `f = open('${P}'), 1\nfor h in f: print(h)`, 'handle not read: unbound open('],
    ['a handle bound to the second of two names', `g, f = open('${P}'), 1\nprint(g)`, 'handle not read: unbound open('],
    ['a handle bound under two names at once', `g = f = open('${P}')\nprint(g)`, 'handle not read: unbound open('],
    ['a handle bound as a keyword of a call', `show(f = open('${P}'))`, 'handle not read: unbound open('],
    ['a handle iterated next to a second value', `for h in open('${P}'), 1: print(h)`, 'handle not read: unbound open('],
    ['a bound handle iterated next to a second value', `f = open('${P}')\nfor h in f, 1: print(h)`, 'handle not read: f'],
    ['a handle yielded into a reader', `hs = list(open('${P}') for _ in [1]); print(hs)`, 'handle not read: unbound open('],
    ['something of the handle that is not a read', `b = open('${P}').buffer`, 'handle not read: unbound open('],
    ['the repr of the handle given to a reader', `p = ''.join(list(open('${P}').__repr__()))`, 'handle-back: __repr__'],
    ['the handle formatted by its own method', `f = open('${P}'); f.read(); f.__format__('')`, 'handle-back: __format__'],
    // text run as code, a namespace reached without the name
    ['exec', `f = open('${P}'); f.read(); exec('pr' + 'int(f)')`, 'handle-back: exec('],
    ['eval', `f = open('${P}'); f.read(); eval('f')`, 'handle-back: eval('],
    ['the frame asked for its names', `import sys\nf = open('${P}'); f.read(); sys._getframe().f_locals`, 'handle-back: _getframe'],
    ['inspect', `import inspect\nf = open('${P}'); f.read()`, 'handle-back: import inspect'],
    ['the main module imported', `import __main__ as m\nf = open('${P}'); f.read(); print(m.f)`, 'handle-back: import __main__'],
    ['sys.modules', `import sys\nf = open('${P}'); f.read(); sys.modules['__main__']`, 'handle-back: sys.modules'],
    ['builtins', `import builtins\nbuiltins.list = repr\nprint(list(open('${P}')))`, 'handle-back: builtins'],
    ['a reader patched by its text', `from unittest import mock\nmock.patch('json.load', repr).start()\njson.load(open('${P}'))`, 'handle-back: mock.patch'],
    // open, Path or a reader given another meaning
    ['open as a loop variable', `import os\nfor open in [os.remove]: open('${P}')`, 'name reused: open'],
    ['open as a parameter', `import os\n(lambda open: open('${P}'))(os.remove)`, 'name reused: open'],
    ['open as a default of a parameter', `import os\ndef g(open=os.remove): open('${P}')`, 'name reused: open'],
    ['open declared global', `def g():\n  global open\ng()\nx = open('${P}').read()`, 'name reused: open'],
    ['open as a tuple target', `import os\nopen, x = os.remove, 1\nopen('${P}')`, 'name reused: open'],
    ['open defined', `def open(p): import os; os.remove(p)\nopen('${P}')`, 'name reused: open'],
    ['a reader assigned', `list = repr\nprint(list(open('${P}')))`, 'name reused: list'],
    ['a reader assigned next to a bound handle', `sorted = repr\nf = open('${P}')\nprint(sorted(f))`, 'name reused: sorted'],
    ['a reader as a parameter', `def g(len): return len(open('${P}'))\ng(repr)`, 'name reused: len'],
    ['a reader imported under that name', `from builtins2 import repr as next\nnext(open('${P}'))`, 'name reused: next'],
    ['a reader of a module assigned', `import json\njson.load = repr\nprint(json.load(open('${P}')))`, 'name reused: json'],
    ['a module of readers replaced', `import pprint as json\njson.load(open('${P}'))`, 'name reused: json'],
    ['a module of readers handed to a setter', `import json\nsetattr(json, 'load', repr)\njson.load(open('${P}'))`, 'name reused: json'],
    ['Path as a parameter', `import os\n(lambda Path: Path('${P}').read_text())(Bad)`, 'name reused: Path'],
  ])('refuses the whole command with %s', (_why, body, why) => {
    refuses(py(body), READ, why)
  })

  it.each([
    [`x = open('${P}').read()`, `x = open('${NEUTRAL}').read()`],
    [`n = len(open('${P}').readlines())`, `n = len(open('${NEUTRAL}').readlines())`],
    [`d = json.load(open('${P}'))`, `d = json.load(open('${NEUTRAL}'))`],
    [`rows = [l for l in open('${P}')]`, `rows = [l for l in open('${NEUTRAL}')]`],
    [`with open('${P}') as f:\n  for line in f: print(line)\n  f.seek(0)\n  print(f.read())`, `with open('${NEUTRAL}') as f:\n  for line in f: print(line)\n  f.seek(0)\n  print(f.read())`],
    [`with open('${P}') as f: r = list(csv.reader(f, delimiter=';'))`, `with open('${NEUTRAL}') as f: r = list(csv.reader(f, delimiter=';'))`],
    [`f = open('${P}'); d = json.load(f); f.close()`, `f = open('${NEUTRAL}'); d = json.load(f); f.close()`],
    [`d = json.load(open('${P}')); print(type(d).__name__)`, `d = json.load(open('${NEUTRAL}')); print(type(d).__name__)`],
    // a word in a sentence, a pattern or a path is not the name given another meaning
    [`import json, re\nprint('open by status', json.load(open('${P}')), re.findall(r"open\\([^)]*", 'x'))`, `import json, re\nprint('open by status', json.load(open('${NEUTRAL}')), re.findall(r"open\\([^)]*", 'x'))`],
    [`from pathlib import Path\nif __name__ == '__main__': print(Path('${P}').read_text())`, `from pathlib import Path\nif __name__ == '__main__': print(Path('${NEUTRAL}').read_text())`],
    [`import csv, sys\nrows = sorted(csv.reader(open('/x/list.csv')), key=lambda r: r[0])`, `import csv, sys\nrows = sorted(csv.reader(open('${NEUTRAL}')), key=lambda r: r[0])`],
    // the handle's name inside a path is not the handle
    [`f = open('/x/f/settings.json'); print(f.read())`, `f = open('${NEUTRAL}'); print(f.read())`],
  ])('still takes the path out when the handle is only read: %j', (body, want) => {
    expect(rewrite(py(body), READ, ENV)).toEqual({ text: py(want), changed: ['interpreter-read-only'], refused: {} })
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

  // didi's D7: the order of the tries is what makes the name the SMALLEST set of rules that was enough
  describe('with a command all three rules change', () => {
    const all = { toolName: 'Bash', toolInput: { command: `f=/x/a; cat $f; sqlite3 'file:/x/c.db?mode=ro' "select 1"; python3 -c "print(open('/x/s.json').read())"` } }
    const tries = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]].map((set) => text(all.toolInput.command, set))
    const ask = (allow: (command: string) => boolean): { name: string | null; seen: string[] } => {
      const seen: string[] = []
      const name = exemptionFor(all, {}, { deny: true, reason: 'install-file' }, (input: { command: string }) => {
        seen.push(input.command)
        return { deny: !allow(input.command) }
      }, ENV)
      return { name, seen }
    }

    it('asks the gate about every set of rules, one rule first, all three last', () => {
      expect(new Set(tries).size).toBe(7)
      expect(ask(() => false)).toEqual({ name: null, seen: tries })
    })

    it('stops at the first rewrite the gate allows', () => {
      expect(ask(() => true)).toEqual({ name: 'variable-resolved', seen: [tries[0]] })
    })

    it('names two rules when two were enough, and all three only when all three were needed', () => {
      expect(ask((c) => c === tries[5] || c === tries[6])).toEqual({ name: 'sqlite-mode-ro+interpreter-read-only', seen: tries.slice(0, 6) })
      expect(ask((c) => c === tries[6])).toEqual({ name: 'variable-resolved+sqlite-mode-ro+interpreter-read-only', seen: tries })
    })
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
  const dbUri = (i: Y1Install): string => `file:${i.root}/store/claudeclaw.db?mode=ro`
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
    // didi's E1, E2, E3 (comment 58963): each of these was `exempted` before the fix round
    ['the name is unset through a second name', (i) => `f=${i.scratch}/a; G=f; unset $G; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['the name is unset by a quoted builtin', (i) => `f=${i.scratch}/a; "unset" f; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['the name is one read fills on its own', (i) => `REPLY=${i.scratch}/a; read < /dev/null; echo x > \${REPLY}.claude/settings.json`, (i) => i.root],
    ['the name is one getopts fills on its own', (i) => `OPTARG=${i.scratch}/a; getopts a: o -a ''; echo x > \${OPTARG}.claude/settings.json`, (i) => i.root],
    // found in the fix round: `exempted` under didi's three fixes too, each unsets f in a real shell
    ['the name is unset by a builtin a substitution completes', (i) => `f=${i.scratch}/a; unse$(echo t) f; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['the name is unset by a builtin a brace expansion completes', (i) => `f=${i.scratch}/a; unse{t,} f; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['the name is unset by a builtin an ANSI string completes', (i) => `f=${i.scratch}/a; unse$'\\x74' f; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['the name is unset inside a range of names', (i) => `f=${i.scratch}/a; unset {e..g}; echo x > \${f}.claude/settings.json`, (i) => i.root],
    ['a dot-command hands the mode=ro URI to a second program', (i) => `sqlite3 '${dbUri(i)}' ".shell node -e \"fs.rmSync(new URL('${dbUri(i)}'))\""`],
    ['a dot-command spelled .system does the same', (i) => `sqlite3 '${dbUri(i)}' ".system node -e \"fs.rmSync(new URL('${dbUri(i)}'))\""`],
    ['the file is opened for reading and written by the repr of its handle', (_i, s) => `python3 -c "f=open('${s}'); open(repr(f).split(chr(39))[1],'w').write('{}')"`],
    ['the file is opened for reading and its handle is printed for the next command', (_i, s) => `python3 -c "f=open('${s}'); print(str(f))" | cut -d"'" -f2 | xargs rm`],
  ])('stays a would-deny when %s', (_why, make, cwd) => {
    expect(verdict(make(I, settings), cwd?.(I))).toBe('would-deny')
  })
})
