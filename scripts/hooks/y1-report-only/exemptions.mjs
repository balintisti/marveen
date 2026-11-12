// y1-report-only/exemptions.mjs: the known FALSE classes among the gate's denies.
//
// A rule never says "this command is fine". It REWRITES the command into one that does the same or less, and the gate
// itself decides the rewrite: the call is `exempted` only when the gate allows the rewritten text. What a rule takes
// out of the text is exactly what it claims to be harmless; everything else is still read by the gate.
//   variable-resolved      `$NAME` / `${NAME}` after the ONE unconditional assignment of NAME to a literal or to
//                          $(mktemp ...): the value is written in its place
//   sqlite-mode-ro         a `file:<db>?mode=ro` URI where SQLite opens it: SQLite opens it read-only, its path
//                          becomes a neutral one
//   interpreter-read-only  the path literal of a call that can only read: python open('<p>') without a mode or with
//                          'r' / 'rb' / 'rt' whose handle is only read, Path('<p>').read_text() / read_bytes(), node
//                          readFileSync('<p>')
// The rules are tried alone, then together, smallest set first; the name is the rule, or `a+b`.
// A git deny is outside this hook (the upstream gate's git part is not what Y1 adopts): `git-hunk-excluded`. The
// gate names only its FIRST deny, so that name is given only after the gate has read the command WITHOUT its git
// commands (gitOut below, asked by decide.mjs) and allowed it; a deny it finds there is the call's verdict.
//
// A rule that meets something it cannot vouch for REFUSES: it leaves the text as it got it and says why (`refused`
// of rewrite(), for the tests and for whoever asks why a call stayed a would-deny). Every list below is a list of
// what a rule FOLLOWS; what is not on a list refuses, so a shape nobody thought of costs an exemption, not a miss.
//
// Stated limits (these are text rules, like the gate they stand next to):
//   - sqlite-mode-ro takes the URI out only as the database word of a `sqlite3` command or as the literal handed to
//     python's sqlite3.connect(. It refuses a command that can get the path back (database_list, load_extension) and,
//     next to the CLI, every dot-command that is not on its list of ones that only print or format. It does not
//     know SQL: an ATTACH of a second database by a path is the gate's to read.
//   - interpreter-read-only does not know which program reads the text. A python handle must be read on the spot,
//     handed whole to a reader, or bound to a name every appearance of which is a read; `open`, `Path` and the
//     readers must not be given another meaning; text run as code (exec, eval), a namespace asked for its names
//     (globals(), vars(), sys.modules, inspect) and the path or descriptor taken back (.name, fileno, getattr, repr
//     through a dunder) refuse. NOT seen: a name put together at run time by a way that is not on that list, and an
//     object in node that answers `readFileSync` with something else without the word being assigned.
//   - variable-resolved follows one shell: `eval`, `source`, `.`, `trap`, `alias`, `case`, an `IFS=` that is not the
//     `IFS= read` prefix, and every shape its reader cannot follow (an open quote, an unbalanced parenthesis, a
//     heredoc without its end) refuse the rule. It reads the command twice, as written and DEQUOTED ("unset" f and
//     un\set f are unset f), and decides on the text AFTER the substitution too, so a name a resolved value spells
//     (c=unset; $c f) is seen. It refuses a name the shell writes on its own (REPLY, OPTARG, MAPFILE, BASH_REMATCH,
//     PWD ...), a writer builtin whose target is made at run time, a command word any piece of which is made at run
//     time (an expansion, a brace expansion, a file name pattern: unse$(echo t) f, unse{t,} f, uns?t f and
//     unset {e..g} all unset f), indirect expansion, and ALL arithmetic over a name or a value (arithmetic evaluates
//     a value as an expression: x='f=5'; (( x )) assigns f). The writer builtins are a list (bash, and zsh with its
//     usual modules): a builtin of a module that is not on it is not seen. Neither is a command word where the
//     reader knows no command position, nor a function or alias the shell brings along from outside the command.
//     A comment is read as code AND left unpaired, so it holds under both readings of `#`.
//     A mktemp value is its template, or <TMPDIR of the hook>/tmp.XXXXXXXX: the directory is exact, the file name is
//     not (it cannot be a protected name by choice).

const NEUTRAL = '/nonexistent/y1-neutral'
const SAFE = String.raw`[\w@%+:,./-]+` // a value that is one word wherever it is written: no blank, glob, quote, $, ~
const PATH_CHARS = String.raw`[\w@%+=:,./{}~-]+`

// ---------------------------------------------------------------------------------------------- sqlite-mode-ro
// The URI is neutral only WHERE SQLITE OPENS IT: the database word of a `sqlite3` command, or the literal handed to
// python's sqlite3.connect(. The same text anywhere else (an argument of node, a `.shell` line) is a path some other
// program may write, and stays for the gate.
const RO_URI = String.raw`file:[^\s'"?\x60$\\]+\?mode=ro`
const SQLITE_CLI = new RegExp(String.raw`(?<=(?:^|[;&|(\n\x60]|(?<![\w./-])(?:do|then|else)[ \t])[ \t]*)(sqlite3(?:[ \t]+-[A-Za-z][\w-]*)*[ \t]+)(['"]?)${RO_URI}\2(?=[\s;|&)<>]|$)`, 'g')
const SQLITE_PY = new RegExp(String.raw`(?<![\w.])(sqlite3\.connect\(\s*[rRfF]?)(['"])${RO_URI}\2`, 'g')
// SQLite gives the path of an open database back (and a loaded extension can ask for it): read-only on the way in
// says nothing about what the command does with the path it prints.
const SQLITE_PATH_BACK = /database_list|load_extension/i
// A dot-command of the sqlite3 shell is named in full or by any prefix (`.sh` is `.shell`), so the harmless ones are
// listed and every other `.word` that could be one refuses the rule: `.shell` and `.system` run a command, `.databases`
// and `.show` print the path, `.open` and `.restore` open another way in.
const SQLITE_DOT_OK = new Set(['tables', 'schema', 'fullschema', 'indexes', 'indices', 'headers', 'header', 'mode', 'separator',
  'nullvalue', 'width', 'timer', 'echo', 'print', 'eqp', 'stats', 'changes', 'bail', 'limit', 'dump', 'help', 'quit', 'exit'])
const SQLITE_DOT = /(?:^|[\s'"])\.([A-Za-z]\w*)(?=[\s'"]|$)/g

function sqliteModeRo(command) {
  const neutral = (_m, head, q) => `${head}${q}file:${NEUTRAL}?mode=ro${q}`
  const cli = command.replace(SQLITE_CLI, neutral)
  const text = cli.replace(SQLITE_PY, neutral)
  if (text === command) return { text }
  const back = SQLITE_PATH_BACK.exec(command)
  if (back) return { refused: `path-back: ${back[0].toLowerCase()}` }
  const dot = cli === command ? undefined : [...command.matchAll(SQLITE_DOT)].find((m) => !SQLITE_DOT_OK.has(m[1]))
  if (dot) return { refused: `dot-command: .${dot[1]}` }
  return { text }
}

// ----------------------------------------------------------------------------------------- interpreter-read-only
const STR = (n) => `(?:(['"])[\\w-]*\\${n}|None)` // a quoted word (its quote is group n) or None
const READ_CALLS = [
  new RegExp(String.raw`(?<![\w.])(open\(\s*[rRfF]?)(['"])${PATH_CHARS}\2(\s*(?:,\s*(?:mode\s*=\s*)?(['"])r[bt]?\4\s*)?(?:,\s*(?:encoding|errors|newline)\s*=\s*${STR(5)}\s*)*\))`, 'g'),
  new RegExp(String.raw`(?<![\w.])(Path\(\s*[rRfF]?)(['"])${PATH_CHARS}\2(\s*\)\s*\.\s*read_(?:text|bytes)\(\s*(?:(?:encoding\s*=\s*)?${STR(4)}\s*)?\))`, 'g'),
  new RegExp(String.raw`(?<![\w$])(readFileSync\(\s*)(['"])${PATH_CHARS}\2(\s*(?:,\s*(['"])[\w-]+\4\s*)?\))`, 'g'),
]
// The path or the descriptor taken back from a handle, a handle or a namespace reached without its name, text run as
// code, or `readFileSync` made to mean something else.
const HANDLE_BACK = new RegExp([
  String.raw`\.\s*name\b|fileno|getattr|__(?:dict|reduce|reduce_ex|getattribute|getstate|self|closure|globals|builtins|import|subclasses|repr|str|format)__|\b(?:import|from)\s+__main__\b|__main__\s*\.|import_module`,
  String.raw`(?<![\w.])(?:globals|locals|vars|dir|eval|exec|compile)\s*\(|\bgc\s*\.|\bbuiltins\b|\bimport\s+inspect\b|\binspect\s*\.|_getframe|sys\s*\.\s*modules`,
  String.raw`\bfcntl\b|F_GETPATH|/dev/fd|/proc/|\bimport\s*\*`,
  String.raw`\bmock\s*\.\s*patch|(?<![\w.])patch\s*\(|globalThis|\bFunction\s*\(|\bReflect\b|defineProperty|Object\s*\.\s*assign`,
  String.raw`(?<![\w$])readFileSync\s*(?::|=(?!=))|\bfunction\s+readFileSync\b|\bas\s+readFileSync\b`,
].join('|'))
// `open`, `Path` and the readers below are what their names say only while nothing in the command gives the name
// another meaning. Python has many ways to do that (an assignment, `as`, `for`, a parameter, a lambda, `global`, a
// tuple target), and all of them write the name where a NAME is expected: after a binding word, or before `=`, `,`,
// `)`, `:`, `]`, `in`, or the end of the statement. An appearance like that refuses the rule; a call (open(), a word
// in a sentence or a piece of a path does not. `import json` and `from pathlib import Path` bind the real thing.
const BINDS_NEXT = /\b(?:def|class|function|as|import|global|nonlocal|lambda|for)\s+$/
const BOUND_HERE = /^(?:(?:\s*\.\s*\w+)*\s*=(?!=)|\s*(?:[,):;\]]|\n|$|(?:in|for|as)\b))/
const REAL_IMPORT = /(?:^|[;\n'"])\s*(?:import\s+(?:[\w.]+\s*,\s*)*|from\s+pathlib\s+import\s+(?:\w+\s*,\s*)*|from\s+)$/
const keepsMeaning = (name, text) => {
  for (const u of text.matchAll(new RegExp(String.raw`(?<![\w.$/-])${name}(?![\w/-])`, 'g'))) {
    const head = text.slice(Math.max(0, u.index - 80), u.index)
    const rest = text.slice(u.index + name.length, u.index + name.length + 60)
    if (REAL_IMPORT.test(head) && !/^\s+as\b/.test(rest)) continue
    if (BINDS_NEXT.test(head) || BOUND_HERE.test(rest)) return false
  }
  return true
}
// A python handle is a way back to its path (repr(f), str(f), '%s' % f, print(f) all carry it), so an open( call is
// taken out only when the handle can do nothing but be read: read on the spot, handed WHOLE to a reader, or bound to a
// name whose EVERY other appearance in the command is a read. What is not on these lists refuses the rule; so does a
// handle that is one of several things (`f = open(p), 1`, `for h in open(p), x`): the name then holds the handle
// inside something the lists do not describe.
const READERS = String.raw`(json\.load|yaml\.safe_load|tomllib\.load|csv\.reader|csv\.DictReader|list|tuple|set|sorted|enumerate|len|sum|next)`
const READ_ON_THE_SPOT = /^\s*\.\s*(?:read|readline|readlines)\s*\(/
const READER_OPENS = new RegExp(String.raw`(?<![\w.])${READERS}\(\s*$`)
const ITERATED = /\bin\s+$/
const ARGUMENT_ENDS = /^\s*[,)]/
const ITERABLE_ENDS = /^\s*(?:[:\])};\n'"]|if\b|$)/
const STATEMENT_ENDS = /^\s*(?:[;\n'"]|$)/
const BOUND_BEFORE = /(?<=[;\n:'"][ \t]*)([A-Za-z_]\w*)\s*=\s*$/
const BOUND_AFTER = /^\s+as\s+([A-Za-z_]\w*)\s*[:,)]/
// how the handle at `pre`|`post` is held: { reader } (handed to one), { name } (bound), {} (read where it stands, or
// iterated), null (none of these)
const held = (pre, post, bindable) => {
  const reader = READER_OPENS.exec(pre)?.[1]
  if (reader) return ARGUMENT_ENDS.test(post) ? { reader } : null
  if (ITERATED.test(pre)) return ITERABLE_ENDS.test(post) ? {} : null
  if (!bindable) return null
  const after = BOUND_AFTER.exec(post)?.[1]
  if (after) return { name: after }
  const before = BOUND_BEFORE.exec(pre)?.[1]
  return before && STATEMENT_ENDS.test(post) ? { name: before } : null
}
// every appearance of the bound name is its binding or a read; `readers` collects the readers it is handed to
const readsOnly = (name, text, readers) => {
  // not the same letters inside a path ('/x/f.json') or a shell's $f
  const use = new RegExp(String.raw`(?<![\w.$/-]|\$\{)${name}(?![\w/])`, 'g')
  const binds = new RegExp(String.raw`^${name}\s*=(?!=)`)
  const reads = new RegExp(String.raw`^${name}\s*\.\s*(?:read|readline|readlines|close|seek|tell)\s*\(`)
  for (const u of text.matchAll(use)) {
    const rest = text.slice(u.index, u.index + 80)
    if (binds.test(rest) || reads.test(rest)) continue
    const pre = text.slice(Math.max(0, u.index - 60), u.index)
    const post = text.slice(u.index + name.length, u.index + name.length + 20)
    if (/\bas\s+$/.test(pre) && /^\s*[:,)]/.test(post)) continue
    const how = held(pre, post, false)
    if (!how) return false
    if (how.reader) readers.add(how.reader)
  }
  return true
}

function interpreterReadOnly(command) {
  const back = HANDLE_BACK.exec(command)
  if (back) return { refused: `handle-back: ${back[0].replace(/\s+/g, ' ')}` }
  let refused = null
  const kept = new Set()
  const text = READ_CALLS.reduce((acc, re, k) => acc.replace(re, (m, head, q, tail, ...rest) => {
    if (k === 1) kept.add('Path')
    if (k === 0) { // python open(: the only one of the three that leaves a handle
      kept.add('open')
      const at = rest[rest.length - 2]
      const pre = (at > 200 ? '' : '\n') + command.slice(Math.max(0, at - 200), at)
      const post = command.slice(at + m.length, at + m.length + 60)
      if (!READ_ON_THE_SPOT.test(post)) {
        const how = held(pre, post, true)
        if (!how) refused ??= 'handle not read: unbound open('
        else if (how.reader) kept.add(how.reader)
        else if (how.name && !readsOnly(how.name, command, kept)) refused ??= `handle not read: ${how.name}`
      }
    }
    return `${head}${q}${NEUTRAL}${q}${tail}`
  }), command)
  if (text === command) return { text }
  const reused = [...kept].map((name) => name.split('.')[0]).find((name) => !keepsMeaning(name, command))
  if (reused) return { refused: `name reused: ${reused}` }
  return refused ? { refused } : { text }
}

// --------------------------------------------------------------------------------------------- variable-resolved
// What each character of a command is to the shell that runs it:
//   'L' its own code   'N' code of a nested shell ($(...), `...`, (...)) or a comment
//   'd' text it expands but does not run (double quotes, the body of an unquoted heredoc)
//   'q' text it leaves alone ('...', $'...', an escaped character, the body of a quoted heredoc)
// null = a shape this reader does not follow.
function shellRead(s) {
  const kind = new Array(s.length).fill('L')
  const body = new Array(s.length).fill(false)
  const pending = []
  let i = 0
  const fail = () => { throw new SyntaxError('shape') }
  const bodies = (K) => {
    while (pending.length) {
      const h = pending.shift()
      for (;;) {
        if (i >= s.length) fail()
        let end = s.indexOf('\n', i)
        if (end === -1) end = s.length
        const line = s.slice(i, end)
        const last = (h.tabs ? line.replace(/^\t+/, '') : line) === h.word
        kind.fill(last || h.literal ? 'q' : 'd', i, end)
        body.fill(true, i, last ? end : Math.min(end + 1, s.length))
        if (end < s.length) kind[end] = last ? K : (h.literal ? 'q' : 'd')
        i = Math.min(end + 1, s.length)
        if (last) break
      }
    }
  }
  const dquote = (depth) => {
    kind[i++] = 'd'
    while (i < s.length) {
      const c = s[i]
      if (c === '"') { kind[i++] = 'd'; return }
      if (c === '\\') { kind[i] = 'd'; if (i + 1 < s.length) kind[i + 1] = 'q'; i += 2; continue }
      if (c === '$' && s[i + 1] === '(') { kind[i] = kind[i + 1] = 'N'; i += 2; code(depth + 1, ')'); continue }
      if (c === '`') { kind[i++] = 'N'; code(depth + 1, '`'); continue }
      if (c === '\n' && pending.length) fail()
      kind[i++] = 'd'
    }
    fail()
  }
  function code(depth, close) {
    const K = depth ? 'N' : 'L'
    while (i < s.length) {
      const c = s[i]
      if (c === close) { kind[i++] = 'N'; return }
      if (c === '\\') {
        if (s[i + 1] === '\n' && pending.length) fail()
        kind[i] = K
        if (i + 1 < s.length) kind[i + 1] = 'q'
        i += 2
      } else if (c === "'" || (c === '$' && s[i + 1] === "'")) {
        const ansi = c === '$'
        let e = i + (ansi ? 2 : 1)
        while (e < s.length && s[e] !== "'") e += ansi && s[e] === '\\' ? 2 : 1
        if (e >= s.length) fail()
        kind.fill('q', i, e + 1)
        i = e + 1
      } else if (c === '"') {
        dquote(depth)
      } else if (c === '`') {
        kind[i++] = K
        code(depth + 1, '`')
      } else if (c === '(') {
        kind[i++] = K
        code(depth + 1, ')')
      } else if (c === ')') {
        fail()
      } else if (c === '#' && (i === 0 || /[\s;|&(]/.test(s[i - 1]))) {
        let e = s.indexOf('\n', i)
        if (e === -1) e = s.length
        kind.fill('N', i, e)
        i = e
      } else if (c === '<' && s[i + 1] === '<' && s[i + 2] === '<') {
        kind.fill(K, i, i + 3)
        i += 3
      } else if (c === '<' && s[i + 1] === '<') {
        const m = /^<<(-?)[ \t]*(?:'([^'\n]+)'|"([^"\n]+)"|(\\?)([\w.+-]+))/.exec(s.slice(i, i + 200))
        if (!m) fail()
        pending.push({ word: m[2] ?? m[3] ?? m[5], literal: m[5] === undefined || m[4] === '\\', tabs: m[1] === '-' })
        kind.fill(K, i, i + 2)
        kind.fill('q', i + 2, i + m[0].length)
        i += m[0].length
      } else {
        kind[i++] = K
        if (c === '\n' && pending.length) bodies(K)
      }
    }
    if (close) fail()
  }
  try {
    code(0, null)
    if (pending.length) fail()
    return { kind, body }
  } catch (err) {
    if (err instanceof SyntaxError) return null
    throw err
  }
}

export function shellKinds(s) {
  return shellRead(s)?.kind ?? null
}

const WORD = (alts) => String.raw`(?<![\w./\x01-])(?:${alts})(?![\w./=-])` // \x01: inside a quoted word, see flatten()
const NOT_FOLLOWED = new RegExp(String.raw`${WORD('eval|source|trap|alias|case|esac')}|(?<![\w$])IFS\+?=(?! read\b)|(?:^|[;&|({\n])[ \t]*\.[ \t]`)
// before the assignment: anything that could make it conditional, or part of a function
const CONDITIONAL = new RegExp(String.raw`${WORD('if|then|else|elif|fi|while|until|for|do|done|function|select|coproc')}|(?:^|[;&|(\n])\s*\{\s`)
const VALUE = new RegExp(String.raw`^(?:(${SAFE})|'(${SAFE})'|"(${SAFE})"|("?)\$\(\s*mktemp((?:[ \t]+${SAFE})*)\s*\)\4)`)

// The assignment at `a` opens a statement that always runs: at the start, after a `;`, or on a new line that does not
// continue a pipe, an `&&` / `||` or a backslash.
function opensStatement(s, kind, a) {
  let j = a - 1
  while (j >= 0 && kind[j] === 'L' && (s[j] === ' ' || s[j] === '\t')) j--
  if (j < 0) return true
  if (kind[j] !== 'L') return false
  if (s[j] === ';') return s[j - 1] !== ';'
  if (s[j] !== '\n') return false
  while (j >= 0 && (kind[j] === 'q' || kind[j] === 'd' || /\s/.test(s[j]))) j--
  return j < 0 || !'|&\\'.includes(s[j])
}

function mktempValue(args, live, env) {
  if (/(?<![\w$])TMPDIR\+?=/.test(live)) return null
  const words = args.trim().split(/\s+/).filter(Boolean)
  let template = null
  let prefix = null
  for (let k = 0; k < words.length; k++) {
    const w = words[k]
    if (/^-[dqu]+$/.test(w)) continue
    if (w === '-t' && words[k + 1] && !words[k + 1].startsWith('-') && prefix === null) prefix = words[++k]
    else if (!w.startsWith('-') && template === null) template = w
    else return null
  }
  if (template !== null && prefix !== null) return null
  if (template !== null) return template
  const tmp = env.TMPDIR === undefined ? '/tmp' : env.TMPDIR.replace(/\/+$/, '')
  if (!new RegExp(`^${SAFE}$`).test(tmp)) return null
  return `${tmp}/${prefix ?? 'tmp'}.XXXXXXXX`
}

// The value NAME gets at `v` (just after the `=`), when the statement is the assignment alone.
function valueAt(s, kind, v, live, env) {
  const m = VALUE.exec(s.slice(v, v + 600))
  if (!m) return null
  let j = v + m[0].length
  while (s[j] === ' ' || s[j] === '\t') j++
  const ends = j >= s.length || s[j] === '\n' || (s[j] === ';' && s[j + 1] !== ';') || (s[j] === '&' && s[j + 1] === '&')
  if (!ends || (j < s.length && kind[j] !== 'L')) return null
  const value = m[1] ?? m[2] ?? m[3] ?? mktempValue(m[5], live, env)
  return value === null ? null : { value, end: v + m[0].length }
}

// The same command with its quotes taken off: what its WORDS are. `"unset" f`, `'un'set f` and `un\set f` all name
// the builtin, and a reading that blanks quoted text sees none of them. Inside quotes a blank or an operator is part
// of the word (\x01: it neither ends a statement nor starts a word), and a `$` the shell will not expand is `%`.
// A heredoc body is text, not words: blank.
const INSIDE = /[\s;|&(){}<>]/
function flatten(s, kind, body) {
  let out = ''
  for (let k = 0; k < s.length; k++) {
    const c = s[k]
    if (body[k]) out += ' '
    else if (kind[k] === 'L' || kind[k] === 'N') {
      if (c !== '\\') out += c
      else if (s[k + 1] === '\n') k++
    } else if (kind[k] === 'd') {
      if (c === '\\') {
        if (!'$`"\\\n'.includes(s[k + 1] ?? ' ')) out += '\x01'
        else if (s[k + 1] === '\n') k++
      } else if (c !== '"') out += c === '$' || c === '`' ? c : INSIDE.test(c) ? '\x01' : c
    } else if (c !== "'") out += c === '$' || c === '`' || c === '\\' ? '%' : INSIDE.test(c) ? '\x01' : c
  }
  return out
}

function views(s) {
  const read = shellRead(s)
  if (!read) return null
  const { kind, body } = read
  const mask = (keep) => { let out = ''; for (let k = 0; k < s.length; k++) out += keep.includes(kind[k]) ? s[k] : ' '; return out }
  return { kind, top: mask('L'), live: mask('LN'), expanded: mask('LNd'), flat: flatten(s, kind, body) }
}

// What refuses the rule for the whole command, read on the text AFTER the substitutions: a name the reader resolved
// is a literal there (`c=unset; $c f` reads `unset f`), and what is still an expansion is a value nobody here knows.
const X = String.raw`[$\x60%]`
// A word the shell makes at run time is not only an expansion with a `$`: `{e..g}` and `unse{t,}` are words by brace
// expansion, `?`, `*` and `[f]` by the name of a file that happens to be there.
const MADE = String.raw`(?:${X}|[?*]|\[(?!\[?[ \t])|\{(?=[^\s{}]*(?:,|\.\.)[^\s{}]*\}))`
const STMT = String.raw`[^;\n|&]*`
// Where a command word stands: the start of a statement, then what may come before the word (assignments,
// redirections, a precommand word with its options).
const BEFORE_WORD = String.raw`(?<![\w./\x01-])`
const STARTS = String.raw`(?:^|[;&|\n\x60]|(?<!=)\(|\(\)|\{[ \t]|![ \t]|${BEFORE_WORD}(?:then|do|else|elif|if|while|until|repeat[ \t]+\w+)[ \t])`
// the value of an assignment is one word, and a substitution in it may hold blanks: x=$(date +%s)
const VALUE_WORD = String.raw`(?:[^\s;|&()\x60]|\((?:[^()]|\([^()]*\))*\)|\x60[^\x60]*\x60)*`
const LEADS = String.raw`(?:(?:[A-Za-z_]\w*(?:\[[^\]\s]*\])?\+?=${VALUE_WORD}|(?:\d*|\{\w+\})[<>]{1,3}[&|!]?[ \t]*[^\s;|&()<>]+)[ \t]+)*`
const PRECOMMANDS = String.raw`(?:${BEFORE_WORD}(?:time|command|builtin|exec|noglob|nocorrect|nohup|xargs|env|sudo|-)[ \t]+(?:-[\w-]*[ \t]+)*${LEADS})*`
const DECLARES = 'declare|typeset|local|export|readonly|integer|float'
const REFUSALS = [
  ['not followed', NOT_FOLLOWED, ['live', 'flat']],
  // a builtin that writes a variable, and the NAME it writes comes from an expansion (`unset $G`, `read "$G"`,
  // `export $G=/etc`, `printf -v $G`, `unset {e..g}`, `unset ?`), or is another name for a variable
  // (`declare -n ref=...`)
  ['name from an expansion', new RegExp([
    String.raw`${WORD('read|mapfile|readarray|vared|sysread')}[^;\n|&<>]*${MADE}`,
    String.raw`${WORD('unset|getopts|zparseopts|zstyle|zstat|strftime')}${STMT}${MADE}`,
    String.raw`${WORD('printf|print')}${STMT}[ \t]-v[ \t]*${MADE}`,
    String.raw`${WORD('wait')}${STMT}[ \t]-p[ \t]*${MADE}`,
    String.raw`${WORD('set')}${STMT}[ \t][-+]A[ \t]*${MADE}`,
    String.raw`${WORD(DECLARES)}${STMT}?[ \t](?:[-+][A-Za-z]*n[A-Za-z]*(?=[ \t])|[^\s;|&=]*${MADE})`,
  ].join('|')), ['flat']],
  // arithmetic evaluates a VALUE as an expression, again and again: with x='f=5', `(( x ))`, `$(( x + 1 ))`,
  // `[[ $x -eq 0 ]]` and `${a[x]}` all assign f. Only arithmetic over plain numbers is followed.
  ['arithmetic over a value', new RegExp(String.raw`\(\([^)]*[A-Za-z_$\x60%]|\$\[[^\]]*[A-Za-z_$\x60%]|${WORD('let')}|[ \t]-(?:eq|ne|lt|le|gt|ge)[ \t]`), ['flat']],
  ['arithmetic over a value', /[A-Za-z_]\w*\[[^\]\n]*[A-Za-z_$`][^\]\n]*\]\+?=/, ['live']],
  ['arithmetic over a value', /\$\{?[A-Za-z_]\w*\[(?![-0-9@*#, ]*\])/, ['expanded']],
  ['indirect expansion', /\$\{\([^)]*P|\$\{![^}]*=/, ['expanded']],
  // the command word, or a piece of it, is made at run time: `$c f`, `unse$(echo t) f`, `rea$'d' f`, `unse{t,} f` and
  // `uns?t f` can all be `unset f`. A word with a `/` before that piece is a path, and no builtin.
  ['command from an expansion', new RegExp(String.raw`${STARTS}[ \t]*${LEADS}${PRECOMMANDS}[^\s;|&()<>/=]*${MADE}`), ['flat']],
]
function commandRefusal(v) {
  for (const [why, re, where] of REFUSALS) {
    for (const view of where) {
      const m = re.exec(v[view])
      if (m) return `${why}: ${m[0].replace(/[\s\x01]+/g, ' ').trim().slice(0, 40)}`
    }
  }
  return null
}

// A name the shell writes on its own, or that is tied to another one: an assignment to it is not its last word.
const SPECIAL = new RegExp('^(?:_|REPLY|reply|OPTARG|OPTIND|OPTERR|MAPFILE|COPROC|BASH_\\w+|ZSH_\\w+|COMP_\\w+|match|mbegin|mend|MATCH|MBEGIN|MEND'
  + '|PWD|OLDPWD|RANDOM|SECONDS|EPOCH\\w*|LINENO|PIPESTATUS|pipestatus|status|argv|ARGC|IFS|TMPDIR|COLUMNS|LINES|HISTCMD|SHLVL|FUNCNAME|funcstack'
  + '|(?:cd|f|man|mail|module_)?path|(?:CD|F|MAN|MAIL|MODULE_)?PATH|fignore|FIGNORE|psvar|PSVAR|watch|WATCH)$')
const WRITERS = `for|select|read|${DECLARES}|unset|mapfile|readarray|getopts|printf|print|let|vared|sysread|zparseopts|zstyle|zstat|strftime|coproc|wait|set`

// Why NAME, assigned at `a` of the top-level text, may hold something else than that value. null = nothing found.
function nameRefusal(name, v, a) {
  if (SPECIAL.test(name)) return `${name}: the shell writes it`
  const N = String.raw`(?<![\w$])${name}(?!\w)`
  const sets = [...v.live.matchAll(new RegExp(String.raw`(?<![\w$.-])${name}(?:\+|\[[^\]\n]*\])?=(?!=)`, 'g'))]
  if (sets.length !== 1 || (a !== undefined && sets[0].index !== a)) return `${name}: assigned ${sets.length} times`
  const writer = new RegExp(String.raw`${WORD(WRITERS)}${STMT}${N}|\(\([^)]*${N}|\$\[[^\]]*${N}|\{${name}\}[<>]`)
  // the dequoted reading first: it names the builtin the shell runs ('un'set is unset, not set). The reading as
  // written is a second opinion, kept on purpose: it refuses more (`unset "a"f` unsets af, and is refused), and it
  // does not depend on flatten() being right.
  const w = writer.exec(v.flat) ?? writer.exec(v.live)
  if (w) return `${name}: written by ${w[0].replace(/[\s\x01]+/g, ' ').trim().slice(0, 40)}`
  return null
}

// `names` collects what was substituted; `names.held` is the first reason a name with a readable value was left alone.
function resolveOnce(s, env, names) {
  const v = views(s)
  if (!v) return null
  const { kind, top, live } = v
  const uses = []
  for (const m of top.matchAll(/(?<![\w$.{[-])([A-Za-z_]\w*)=/g)) {
    const name = m[1]
    const a = m.index
    if (env[name] !== undefined || !opensStatement(s, kind, a) || CONDITIONAL.test(top.slice(0, a))) continue
    const val = valueAt(s, kind, a + name.length + 1, live, env)
    if (!val) continue
    const held = nameRefusal(name, v, a)
      ?? (new RegExp(String.raw`\$\{[^}]*(?<![\w$])${name}(?!\w)`).test(s.replaceAll('${' + name + '}', '')) ? `${name}: inside a \${...} that is not \${${name}}` : null)
    if (held) { names.held ??= held; continue }
    // `$f[1]` and `$f:h` are zsh's subscript and modifier: left as they are, for the gate to read
    const use = new RegExp(String.raw`\$(?:\{${name}\}|${name}(?![\w[]|:[A-Za-z&]))`, 'g')
    use.lastIndex = val.end
    for (let u; (u = use.exec(s));) {
      if ('LNd'.includes(kind[u.index]) && s[u.index - 1] !== '\\') { uses.push({ at: u.index, len: u[0].length, value: val.value }); names.add(name) }
    }
  }
  if (!uses.length) return null
  uses.sort((x, y) => x.at - y.at)
  let out = ''
  let at = 0
  for (const u of uses) {
    out += s.slice(at, u.at) + u.value
    at = u.at + u.len
  }
  return out + s.slice(at)
}

// A substituted value can make the next assignment a literal (`d=/a; f=$d/b`), so the pass repeats. The text that
// comes out is then read once more as a whole: every refusal is decided on IT, not on a pass in between.
function variableResolved(command, env) {
  let text = command
  const names = new Set()
  for (let pass = 0; pass < 4; pass++) {
    const next = resolveOnce(text, env, names)
    if (next === null) break
    text = next
  }
  if (text === command) return names.held ? { refused: names.held } : { text }
  const v = views(text)
  if (!v) return { refused: 'shape' }
  const why = commandRefusal(v) ?? [...names].map((name) => nameRefusal(name, v)).find(Boolean)
  return why ? { refused: why } : { text }
}

// ------------------------------------------------------------------------------------------------------ the rules
export const RULES = [
  ['variable-resolved', variableResolved],
  ['sqlite-mode-ro', sqliteModeRo],
  ['interpreter-read-only', interpreterReadOnly],
]
const SETS = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]

// The rewrite of `command` by the rules of `set`, which of them changed the text, and which refused and why (a rule
// that refuses leaves the text as it got it).
export function rewrite(command, set, env = process.env) {
  const changed = []
  const refused = {}
  let text = command
  for (const k of set) {
    const r = RULES[k][1](text, env)
    if (r.refused) { refused[RULES[k][0]] = r.refused; continue }
    if (r.text !== text) changed.push(RULES[k][0])
    text = r.text
  }
  return { text, changed, refused }
}

// ---------------------------------------------------------------------------------------------- git-hunk-excluded
// `cd /gone; git add a; echo x > <protected>` is a git deny AND a write, and the gate names only the first. So the git
// command words are taken out and the gate reads the rest: the word `git` (the last piece of a path to it too) becomes
// TAKEN_OUT, a command the gate knows nothing about. Its arguments, the assignments, the redirections and the
// substitutions of the statement stay where they are.
//
// Why an allow of that text says "only the git deny was dropped": to the gate a git command differs from an unknown
// one in its git rule (the deny that is being taken out, and an allow that ends the reading of the segment) and in
// what it lets git do with a protected path (a read, the text of a commit message). An unknown command gets none of
// these: a protected path among its words is a deny. The rest is therefore read at least as strictly as the original
// would be without the git rule. A word the gate knows (`true`, `:`) is the wrong stand-in for that reason: measured
// on the corpus, `true` lost 5 denies and made 15 (`true ... | tar -x`).
// The price, on purpose: next to a git deny, a git command that only reads a protected file, names one in a commit
// message, or stages one is a would-deny.
//
// Only a word at a COMMAND position, in code and with no quoted piece, is taken; a `git` after a redirection operator
// (`>| git`, `>& git`, `&> git`, `<(git ...)`) is left. The positions are those of STARTS / LEADS / PRECOMMANDS, a
// text reading: where it takes a word that is an argument after all (`echo { git x; }`), a file called git gets another
// name in the same directory, and no protected path leaves the text. null = nothing to ask the gate about: a shape
// the reader does not follow, an array or zsh `=(` (its words are not commands, or are), a command that names the
// stand-in itself, or no git command word found. A git the gate still finds in the text (quoted, in a heredoc, behind
// `sh -c`, after an option of a precommand this reader does not know) keeps the call a would-deny for git, in decide.mjs.
export const TAKEN_OUT = 'y1-taken-out'
const GIT_COMMAND = new RegExp(String.raw`(?<![<>])(?!&>)${STARTS}[ \t]*${LEADS}${PRECOMMANDS}(?:[^\s;|&()<>=\x01\x60]*\/)?git(?=[ \t\n;|&)]|$)`, 'g')
export function gitOut(command) {
  const read = shellRead(command)
  if (!read || command.includes(TAKEN_OUT)) return null
  // quoted text is \x01, as in flatten(): it is part of a word, and no word taken here may hold one
  let code = ''
  for (let k = 0; k < command.length; k++) code += read.kind[k] === 'L' || read.kind[k] === 'N' ? command[k] : '\x01'
  if (code.includes('=(')) return null
  let out = ''
  let at = 0
  for (const m of code.matchAll(GIT_COMMAND)) {
    const word = m.index + m[0].length - 'git'.length
    out += command.slice(at, word) + TAKEN_OUT
    at = word + 'git'.length
  }
  return at === 0 ? null : out + command.slice(at)
}

export function exemptionFor(job, opts, verdict, redecide, env = process.env) {
  // a git deny is decide.mjs's to explain (gitOut above): no rule here rewrites it away
  if (verdict.reason === 'git') return null
  const command = job.toolName === 'Bash' ? job.toolInput?.command : null
  if (typeof command !== 'string' || !redecide) return null
  const tried = new Set([command])
  for (const set of SETS) {
    const { text, changed } = rewrite(command, set, env)
    if (tried.has(text)) continue
    tried.add(text)
    const d = redecide({ ...job.toolInput, command: text })
    if (!d.deny && !d.error) return changed.join('+')
  }
  return null
}
