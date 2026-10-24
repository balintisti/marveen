import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Card 9ac56d05 (security). A secret in a curl argv (`-H "Authorization: Bearer $X"`,
// or a bot token in the URL path) is readable by every local user in
// `ps -eo args=` for the life of the request. The shell scripts hand it to curl in a
// `-K <(printf 'header = "..."\n' "$X")` config instead (a process substitution
// forks but never execs, so nothing reaches an argv). This pins that: a new
// `-H "...$secret"` or `api.telegram.org/bot$TOKEN` outside a printf config line fails.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Files that mention the old form WITHOUT running curl on it.
const ALLOWED: Record<string, string> = {
  // A one-shot migration that writes curl EXAMPLES into agent CLAUDE.md files (docs, not a call).
  'scripts/fix-agent-auth-headers.sh': 'rewrites documentation examples',
}

/**
 * The TRACKED shell scripts. Not a directory walk: in the live tree and in a test worktree, scripts/
 * also holds L2 files (symlinks into the separate marveen-l2 repo, or copies of them, listed in
 * .git/info/exclude), so a walk made this test's verdict depend on which tree it ran in.
 */
function shellFiles(): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'scripts', 'install-macos.sh', 'install-linux.sh'], {
    cwd: ROOT,
    encoding: 'utf-8',
  })
  return tracked
    .split('\0')
    .filter((f) => f.endsWith('.sh') && !/(^|\/)(__tests__|fixtures|node_modules)\//.test(f))
}

/** Backslash-continued lines joined; each logical line keeps the number of its first physical line. */
function logicalLines(text: string): Array<{ n: number; text: string }> {
  const res: Array<{ n: number; text: string }> = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    let joined = lines[i]
    const n = i + 1
    while (joined.endsWith('\\') && i + 1 < lines.length) {
      joined = joined.slice(0, -1) + ' ' + lines[++i].trim()
    }
    res.push({ n, text: joined })
  }
  return res
}

/**
 * The shell word that follows each `-H` / `--header` (quotes respected, so `"a b"` is one word).
 * Also the attached `-H"..."` form, and `-H` opening an array assignment (`H=(-H "...")`, `a+=(-H ...)`),
 * which reach the argv the same way (didi, 9ac56d05 re-verdict 10-24).
 */
function headerWords(line: string): string[] {
  const words: string[] = []
  const re = /(?:^|[\s(])(?:-H|--header)(?:\s+|=|(?=["'$]))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    let i = m.index + m[0].length
    let word = ''
    let quote = ''
    for (; i < line.length; i++) {
      const c = line[i]
      if (quote) {
        if (c === quote) quote = ''
        word += c
      } else if (c === '"' || c === "'") {
        quote = c
        word += c
      } else if (/\s/.test(c)) break
      else word += c
    }
    words.push(word)
  }
  return words
}

const SECRET_HEADER = /(authorization|api-key|token)[^:"']*:/i

/**
 * Variables a file assigns a secret header to (`AUTH="Authorization: Bearer $(cat f)"`).
 * `curl -H "$AUTH"` puts that value on the argv just like the literal form, but the
 * -H word itself shows only `$AUTH` (didi, 9ac56d05 verdict: this mutant stayed green).
 */
function secretHeaderVars(lines: string[]): Set<string> {
  const vars = new Set<string>()
  for (const line of lines) {
    const m = /^\s*(?:local\s+|export\s+|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m && SECRET_HEADER.test(m[2]) && m[2].includes('$')) vars.add(m[1])
  }
  return vars
}

/** Findings for one logical line: the reason, or null when the line is clean. */
function leak(line: string, secretVars: Set<string> = new Set()): string | null {
  if (line.trim().startsWith('#')) return null
  for (const w of headerWords(line)) {
    if (/(authorization|api-key|token)/i.test(w) && w.includes('$')) return `secret header on argv: ${w}`
    const v = /^"?\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"?$/.exec(w)
    if (v && secretVars.has(v[1])) return `secret header on argv via $${v[1]}: ${w}`
  }
  if (/api\.telegram\.org\/bot\$/.test(line) && !line.includes('printf')) return 'bot token in a URL on argv'
  return null
}

describe('shell scripts keep secrets off the curl argv', () => {
  it('the detector flags the old forms and passes the -K forms', () => {
    const bad = [
      'curl -s -H "Authorization: Bearer $TOKEN" http://x',
      'curl -s -H "Authorization: Bearer $(cat "$F")" http://x',
      'curl -s --header "x-goog-api-key: $K" http://x',
      `curl -s -H 'Authorization: Bearer '"$T" http://x`,
      'curl -s "https://api.telegram.org/bot${TOKEN}/getMe"',
      'curl -s https://api.telegram.org/bot$TOKEN/getMe',
      'curl -s -H "X-Auth: $TOKEN" http://x',
      'curl -s -H"Authorization: Bearer $T" http://x',
      `curl -s -H'Authorization: Bearer '"$T" http://x`,
      'HDRS=(-H "Authorization: Bearer $T")',
      'args+=(-H "Authorization: Bearer $(cat "$F")")',
    ]
    const good = [
      `curl -s -K <(printf 'header = "Authorization: Bearer %s"\\n' "$T") http://x`,
      `curl -s -K <(printf 'url = "%s"\\n' "https://api.telegram.org/bot\${TOKEN}/getMe")`,
      'curl -s -H "Content-Type: application/json" http://x',
      'curl -s -H"Content-Type: application/json" http://x',
      'HDRS=(-H "Content-Type: application/json")',
      '# curl -H "Authorization: Bearer $T" (comment)',
    ]
    for (const l of bad) expect(leak(l), l).not.toBeNull()
    for (const l of good) expect(leak(l), l).toBeNull()
  })

  it('the detector follows a secret header through a variable, and only a secret one', () => {
    const vars = secretHeaderVars([
      'AUTH_HDR="Authorization: Bearer $(cat "$F")"',
      '  local KEY_HDR="x-goog-api-key: ${K}"',
      'CT="Content-Type: application/json"',
      'TOKEN_FILE="$HOME/.token"',
    ])
    expect([...vars].sort()).toEqual(['AUTH_HDR', 'KEY_HDR'])
    expect(leak('curl -s -H "$AUTH_HDR" http://x', vars)).not.toBeNull()
    expect(leak('curl -s -H"$AUTH_HDR" http://x', vars)).not.toBeNull()
    expect(leak('curl -s --header "${KEY_HDR}" http://x', vars)).not.toBeNull()
    expect(leak('curl -s -H "$CT" http://x', vars)).toBeNull()
  })

  it('no tracked script puts a secret on a curl command line', () => {
    const files = shellFiles()
    expect(files.length).toBeGreaterThan(80) // population guard: the walk really found the scripts
    const hits: string[] = []
    for (const f of files) {
      if (ALLOWED[f]) continue
      const lines = logicalLines(readFileSync(join(ROOT, f), 'utf-8'))
      const vars = secretHeaderVars(lines.map((l) => l.text))
      for (const { n, text } of lines) {
        const why = leak(text, vars)
        if (why) hits.push(`${f}:${n}  ${why}`)
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
})
