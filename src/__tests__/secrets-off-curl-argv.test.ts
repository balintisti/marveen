import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
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

function shellFiles(): string[] {
  const out: string[] = ['install-macos.sh', 'install-linux.sh']
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === '__tests__' || name === 'fixtures' || name === 'node_modules') continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.sh')) out.push(relative(ROOT, p))
    }
  }
  walk(join(ROOT, 'scripts'))
  return out
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

/** The shell word that follows each `-H` / `--header` (quotes respected, so `"a b"` is one word). */
function headerWords(line: string): string[] {
  const words: string[] = []
  const re = /(?:^|\s)(?:-H|--header)(?:\s+|=)/g
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

/** Findings for one logical line: the reason, or null when the line is clean. */
function leak(line: string): string | null {
  if (line.trim().startsWith('#')) return null
  for (const w of headerWords(line)) {
    if (/(authorization|api-key|token)/i.test(w) && w.includes('$')) return `secret header on argv: ${w}`
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
    ]
    const good = [
      `curl -s -K <(printf 'header = "Authorization: Bearer %s"\\n' "$T") http://x`,
      `curl -s -K <(printf 'url = "%s"\\n' "https://api.telegram.org/bot\${TOKEN}/getMe")`,
      'curl -s -H "Content-Type: application/json" http://x',
      '# curl -H "Authorization: Bearer $T" (comment)',
    ]
    for (const l of bad) expect(leak(l), l).not.toBeNull()
    for (const l of good) expect(leak(l), l).toBeNull()
  })

  it('no tracked script puts a secret on a curl command line', () => {
    const files = shellFiles()
    expect(files.length).toBeGreaterThan(80) // population guard: the walk really found the scripts
    const hits: string[] = []
    for (const f of files) {
      if (ALLOWED[f]) continue
      for (const { n, text } of logicalLines(readFileSync(join(ROOT, f), 'utf-8'))) {
        const why = leak(text)
        if (why) hits.push(`${f}:${n}  ${why}`)
      }
    }
    expect(hits, hits.join('\n')).toEqual([])
  })
})
