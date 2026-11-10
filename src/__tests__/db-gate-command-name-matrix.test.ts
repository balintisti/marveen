/**
 * THE DB GATE AND THE SPELLING OF A COMMAND NAME (card 1a701051; measured by trillian on 9b5cf828,
 * 2026-11-10, on the live gate).
 *
 *     \<client> -c "DROP TABLE users"      -> PASSED
 *     \git push <remote> <branch> --force  -> PASSED
 *
 * while the plain, quoted, spliced and env-prefixed spellings of the same lines were refused. To the
 * shell all of them are ONE word: quote removal drops an unquoted backslash exactly as it drops a
 * pair of quotes (a leading backslash only skips an alias). The gate removed the quotes and kept the
 * backslash, and every name pattern wants the name at the start or after a separator.
 *
 * THE FIXTURE (fixtures/db-gate-command-name-matrix.json) is trillian's matrix (three destructive
 * lines in seven spellings, two prose controls) grown by two more lines, five more spellings and
 * nine allow controls that carry a backslash or a quote in an ARGUMENT. Every row holds the verdict
 * from BEFORE the fix (`before`) and the one required now (`expect`). It was generated from the two
 * gate versions, then read row by row; the generator is not part of the repo, the rows are.
 *
 * ROUND 2 (didi's review, comment 57750 on the card) added the spellings the first round left out:
 * `$'name'` / `$"name"` / `$'\xHH..'`, a backslash-newline inside the name, the group `interpreter
 * heredoc` (a quoted, backslashed, spliced, path-qualified or continued interpreter name before a
 * heredoc whose body is the code), the group `continuation in executed code`, didi's four
 * witnesses for the backslash rule (a digit and an underscore after the backslash, an escaped
 * space in a file name and after `git`), and the group `dollar-quoted name after a quote`: a
 * `$'name'` that follows an escaped quote, with three allow controls where the `$'` is text
 * inside quotes. Each of those rows is the only one that fails when one rule of the quote
 * tracking is taken out.
 *
 * This file hands TEXT to the gate's verdict() and executes nothing.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE = join(HERE, '..', '..', 'scripts', 'hooks', 'db-destructive-gate.py')

interface Row { group: string; form: string; command: string; before: string; expect: string }
const ROWS: Row[] = JSON.parse(readFileSync(join(HERE, 'fixtures', 'db-gate-command-name-matrix.json'), 'utf8'))

/** verdict() of the gate for every command TEXT, in one python process ("none" | "e2e" | "override" | "deny"). */
function verdicts(commands: string[]): string[] {
  const driver = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("g", ${JSON.stringify(GATE)})
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
print(json.dumps([g.verdict(c, env={})[0] for c in json.loads(sys.stdin.read())]))
`
  const out = execFileSync('python3', ['-I', '-B', '-c', driver], { input: JSON.stringify(commands), encoding: 'utf8' })
  return JSON.parse(out.trim())
}

const GOT = verdicts(ROWS.map((r) => r.command))
const at = (pick: (r: Row) => boolean): Array<[string, string, string]> =>
  ROWS.map((r, i) => [r, GOT[i]] as const).filter(([r]) => pick(r)).map(([r, got]) => [`${r.group} / ${r.form}`, r.command, got])
const isLimit = (r: Row): boolean => r.form === 'var-assembled' && r.expect === 'none'

describe('db-destructive-gate: one verdict for every spelling of a command name (1a701051)', () => {
  // A fixture that lost rows would pass every row it still has.
  it('the fixture is whole', () => {
    expect(ROWS).toHaveLength(138)
    expect(GOT).toHaveLength(ROWS.length)
    expect(ROWS.filter((r) => r.expect === 'deny')).toHaveLength(108)
    expect(ROWS.filter((r) => r.group === 'allow control')).toHaveLength(28)
    expect(ROWS.filter((r) => r.group === 'interpreter heredoc')).toHaveLength(17)
    expect(ROWS.filter((r) => r.group === 'continuation in executed code')).toHaveLength(5)
    expect(ROWS.filter((r) => r.group === 'dollar-quoted name after a quote')).toHaveLength(6)
    expect(ROWS.filter(isLimit)).toHaveLength(2)
    expect(new Set(ROWS.map((r) => r.command)).size).toBe(ROWS.length)
  })

  it.each(at((r) => r.expect === 'deny' && r.before === 'deny'))('still REFUSED: %s', (_name, _cmd, got) => {
    expect(got).toBe('deny')
  })

  // The cells the fix exists for: each of them passed before it.
  it('59 rows passed before the fix, trillian\'s two among them', () => {
    const fixed = ROWS.filter((r) => r.before !== r.expect)
    expect(fixed).toHaveLength(59)
    expect(fixed.every((r) => r.before === 'none' && r.expect === 'deny')).toBe(true)
    expect(fixed.map((r) => r.command)).toEqual(expect.arrayContaining(['\\psql -c "DROP TABLE users"', '\\git push fork main --force']))
  })
  it.each(at((r) => r.before !== r.expect))('REFUSED now, passed before: %s', (_name, _cmd, got) => {
    expect(got).toBe('deny')
  })

  // The false-deny side: prose, a backslash or a quote in an ARGUMENT, an escaped backslash (a
  // command really named `\<client>` is not the client), and the harmless twins of the refused lines.
  it.each(at((r) => r.group === 'allow control'))('still PASSES: %s', (_name, _cmd, got) => {
    expect(got).toBe('none')
  })

  // ACCEPTED LIMIT, not a fix (marveen's decision on 9b5cf828; the comment is in the gate, next to
  // "guessing what `$f` held"): a name held in a variable that is not a DB client is not expanded.
  // Pinned as it IS: when this starts to refuse, or when a DB client held the same way stops being
  // refused, this block says so, and the decision is reopened on purpose instead of by accident.
  it.each(at(isLimit))('ACCEPTED LIMIT, passes: %s', (_name, _cmd, got) => {
    expect(got).toBe('none')
  })
  it.each(at((r) => r.form === 'var-assembled' && r.expect === 'deny'))('the variable-held DB tool is refused: %s', (_name, _cmd, got) => {
    expect(got).toBe('deny')
  })
})
