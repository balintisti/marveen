// y1-report-only/exemptions.mjs: the known FALSE classes among the gate's denies.
//
// A rule never says "this command is fine". It REWRITES the command into one that does the same or less, and the gate
// itself decides the rewrite: the call is `exempted` only when the gate allows the rewritten text. What a rule takes
// out of the text is exactly what it claims to be harmless; everything else is still read by the gate.
//   variable-resolved      `$NAME` / `${NAME}` after the ONE unconditional assignment of NAME to a literal or to
//                          $(mktemp ...): the value is written in its place
//   sqlite-mode-ro         a `file:<db>?mode=ro` URI: SQLite opens it read-only, its path becomes a neutral one
//   interpreter-read-only  the path literal of a call that can only read: python open('<p>') without a mode or with
//                          'r' / 'rb' / 'rt', Path('<p>').read_text() / read_bytes(), node readFileSync('<p>')
// The rules are tried alone, then together, smallest set first; the name is the rule, or `a+b`.
// A git deny is outside this hook (the upstream gate's git part is not what Y1 adopts): `git-hunk-excluded`.
//
// Stated limits (these are text rules, like the gate they stand next to):
//   - interpreter-read-only does not know which program reads the text. It refuses a command that names `.name` or
//     `fileno` (the path or the descriptor taken back from the handle) or redefines `open`; a name put together at
//     run time (getattr(f, 'na' + 'me')) is not seen.
//   - variable-resolved follows one shell: `eval`, `source`, `.`, `trap`, `alias`, `case`, an `IFS=` that is not the
//     `IFS= read` prefix, and every shape its reader cannot follow (an open quote, an unbalanced parenthesis, a
//     heredoc without its end) refuse the rule. A comment is read as code AND left unpaired, so it holds under both
//     readings of `#`. A mktemp value is its template, or <TMPDIR of the hook>/tmp.XXXXXXXX: the directory is exact,
//     the file name is not (it cannot be a protected name by choice).

const NEUTRAL = '/nonexistent/y1-neutral'
const SAFE = String.raw`[\w@%+:,./-]+` // a value that is one word wherever it is written: no blank, glob, quote, $, ~
const PATH_CHARS = String.raw`[\w@%+=:,./{}~-]+`

// ---------------------------------------------------------------------------------------------- sqlite-mode-ro
function sqliteModeRo(command) {
  return command.replace(/file:[^\s'"?`$\\]+\?mode=ro(?=['"\s]|$)/g, `file:${NEUTRAL}?mode=ro`)
}

// ----------------------------------------------------------------------------------------- interpreter-read-only
const STR = (n) => `(?:(['"])[\\w-]*\\${n}|None)` // a quoted word (its quote is group n) or None
const READ_CALLS = [
  new RegExp(String.raw`(?<![\w.])(open\(\s*[rRfF]?)(['"])${PATH_CHARS}\2(\s*(?:,\s*(?:mode\s*=\s*)?(['"])r[bt]?\4\s*)?(?:,\s*(?:encoding|errors|newline)\s*=\s*${STR(5)}\s*)*\))`, 'g'),
  new RegExp(String.raw`(?<![\w.])(Path\(\s*[rRfF]?)(['"])${PATH_CHARS}\2(\s*\)\s*\.\s*read_(?:text|bytes)\(\s*(?:(?:encoding\s*=\s*)?${STR(4)}\s*)?\))`, 'g'),
  new RegExp(String.raw`(?<![\w$])(readFileSync\(\s*)(['"])${PATH_CHARS}\2(\s*(?:,\s*(['"])[\w-]+\4\s*)?\))`, 'g'),
]
const HANDLE_BACK = /\.\s*name\b|fileno|\bdef\s+open\b|(?<![\w.])open\s*=(?!=)/

function interpreterReadOnly(command) {
  if (HANDLE_BACK.test(command)) return null
  return READ_CALLS.reduce((text, re) => text.replace(re, (_m, head, q, tail) => `${head}${q}${NEUTRAL}${q}${tail}`), command)
}

// --------------------------------------------------------------------------------------------- variable-resolved
// What each character of a command is to the shell that runs it:
//   'L' its own code   'N' code of a nested shell ($(...), `...`, (...)) or a comment
//   'd' text it expands but does not run (double quotes, the body of an unquoted heredoc)
//   'q' text it leaves alone ('...', $'...', an escaped character, the body of a quoted heredoc)
// null = a shape this reader does not follow.
export function shellKinds(s) {
  const kind = new Array(s.length).fill('L')
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
    return kind
  } catch (err) {
    if (err instanceof SyntaxError) return null
    throw err
  }
}

const WORD = (alts) => String.raw`(?<![\w./-])(?:${alts})(?![\w./=-])`
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

function resolveOnce(s, env) {
  const kind = shellKinds(s)
  if (!kind) return null
  const mask = (keep) => { let out = ''; for (let k = 0; k < s.length; k++) out += keep.includes(kind[k]) ? s[k] : ' '; return out }
  const top = mask('L')
  const live = mask('LN')
  if (NOT_FOLLOWED.test(live)) return null
  const uses = []
  for (const m of top.matchAll(/(?<![\w$.{[-])([A-Za-z_]\w*)=/g)) {
    const name = m[1]
    const a = m.index
    if (env[name] !== undefined || !opensStatement(s, kind, a) || CONDITIONAL.test(top.slice(0, a))) continue
    const val = valueAt(s, kind, a + name.length + 1, live, env)
    if (!val) continue
    const N = String.raw`(?<![\w$])${name}(?!\w)`
    const sets = [...live.matchAll(new RegExp(String.raw`(?<![\w$.-])${name}(?:\+|\[[^\]\n]*\])?=(?!=)`, 'g'))]
    if (sets.length !== 1 || sets[0].index !== a) continue
    const otherWriter = new RegExp(String.raw`${WORD('for|select|read|local|declare|typeset|export|readonly|unset|mapfile|readarray|getopts|printf|let')}[^;\n|&]*${N}|\(\([^)]*${N}`)
    if (otherWriter.test(live)) continue
    if (new RegExp(String.raw`\$\{[^}]*${N}`).test(s.replaceAll('${' + name + '}', ''))) continue
    // `$f[1]` and `$f:h` are zsh's subscript and modifier: left as they are, for the gate to read
    const use = new RegExp(String.raw`\$(?:\{${name}\}|${name}(?![\w[]|:[A-Za-z&]))`, 'g')
    use.lastIndex = val.end
    for (let u; (u = use.exec(s));) {
      if ('LNd'.includes(kind[u.index]) && s[u.index - 1] !== '\\') uses.push({ at: u.index, len: u[0].length, value: val.value })
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

// A substituted value can make the next assignment a literal (`d=/a; f=$d/b`), so the pass repeats.
function variableResolved(command, env) {
  let text = command
  for (let pass = 0; pass < 4; pass++) {
    const next = resolveOnce(text, env)
    if (next === null) break
    text = next
  }
  return text
}

// ------------------------------------------------------------------------------------------------------ the rules
export const RULES = [
  ['variable-resolved', variableResolved],
  ['sqlite-mode-ro', sqliteModeRo],
  ['interpreter-read-only', interpreterReadOnly],
]
const SETS = [[0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]]

// The rewrite of `command` by the rules of `set`, and which of them changed the text.
export function rewrite(command, set, env = process.env) {
  const changed = []
  let text = command
  for (const k of set) {
    const next = RULES[k][1](text, env) ?? text
    if (next !== text) changed.push(RULES[k][0])
    text = next
  }
  return { text, changed }
}

export function exemptionFor(job, opts, verdict, redecide, env = process.env) {
  if (verdict.reason === 'git') return 'git-hunk-excluded'
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
