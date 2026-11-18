// THE EGRESS GATE AND THE SPELLING OF A COMMAND NAME (card 1a701051; first measured by trillian on
// 9b5cf828, 2026-11-10, on the live gate):
//
//     "python3" -c "...urlopen('https://...')"      -> PASSED
//     env "python3" -c "..."                        -> PASSED
//
// The probe grown to the parser's whole INTERPRETER list, in the same spellings, showed the same
// for every one of them, and three more shapes with the same cause:
//
//     "<tool>" "URL"     every word quoted: the masked sub-command has no word left, and the
//                        "no command here" branch skipped it. A plain external curl went out.
//     env "<tool>" -s "URL"   the masked index ran past the end: the tool's own option was read
//                        as an option of env.
//     python3 "-c" CODE       the quoted code FLAG is blank in the masked words too.
//     "bash" <<< '...'        the stdin-feed reader took the command word from the masked text.
//
// ONE CAUSE: the command NAME was read from the shell words (where quotes are resolved), but the
// index of the command and its arguments from the MASKED words (where a quoted word is blank).
//
// THE FIXTURE (fixtures/egress-command-name-matrix.json) is trillian's matrix (curl https, curl
// http, the python one-liner, seven spellings each, two prose controls) grown by the fourteen
// other interpreter forms, four more spellings, the shapes above and fourteen new allow controls.
// Every row holds the verdict BEFORE the fix (`before`) and the one required now (`expect`). It was
// generated from the two parser versions, then read row by row; the rows are the test, the
// generator is not in the repo.
//
// ROUND 2 (didi's review, comment 57750 on the card): the group `variable-held code flag` (the
// code flag is read from the EXPANDED words, so `F=-c; <interpreter> $F CODE` is the one-liner it
// runs), the group `reader witness` (one row for each reader the first round moved to the shell
// words and no row pinned: a quoted `read`, a here-string before the shell word, a quoted option
// of a prefix command) and five more allow controls, a prefix option before a script file among them.
//
// CARD 219bae8c (a backslash-newline INSIDE a command name): the parser turned every backslash-newline
// into a space, so `cu\<newline>rl URL` read the name `cu` and went out (`curl URL` is denied). The
// rows of the groups `continued name, ...` and `continued argument, ...` pin the glued reading; the
// `allow control` rows of the localhost URL and the single-quoted prose pin the other side: an allowed
// host stays allowed, and a quoted prose line is not a command. Round 2 (didi 69297 K1, 69304 K2): the
// parser's own quote reading does not know a heredoc body, a comment or $'...', so an odd apostrophe
// there left it "inside single quotes" and the continued name after it passed. classify() now also
// reads the line glued without any quote reading and denies when either reading denies. The group
// `odd apostrophe before a continued name` pins the four shapes, each with an apostrophe-free control;
// the two single-quoted continued names (`'cu\<newline>rl' URL`) moved from the allow controls to
// `single-quoted continued name (accepted over-deny)`: bash would not glue them, the gate now denies.
//
// classify() reads TEXT. Nothing here is executed; the hook-process cases hand the same text to the
// hook's entry point, which only decides.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpDirs } from './helpers/tmp-dirs.js'
// @ts-expect-error -- plain .mjs hook script, no types
import { classify } from '../../scripts/hooks/bash-egress-parser.mjs'

const mkTmp = tmpDirs()
const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, '..', '..', 'scripts', 'hooks', 'bash-egress-parser.mjs')

interface Row { group: string; form: string; command: string; before: 'deny' | 'allow'; expect: 'deny' | 'allow' }
const ROWS: Row[] = JSON.parse(readFileSync(join(HERE, 'fixtures', 'egress-command-name-matrix.json'), 'utf8'))

const got = (r: Row): 'deny' | 'allow' => (classify(r.command).deny ? 'deny' : 'allow')
const named = (pick: (r: Row) => boolean): Array<[string, Row]> =>
  ROWS.filter(pick).map((r) => [`${r.group} / ${r.form}`, r])
const OPEN_GROUP = 'open, not this card'
// the one must-deny row this card leaves open: a SUBSTITUTED PowerShell name (see the last block)
const isOpenPwsh = (r: Row): boolean => r.group === 'powershell.exe -c' && r.form === '$(echo name) args'

describe('bash-egress-parser: one verdict for every spelling of a command name (1a701051)', () => {
  // A fixture that lost rows would pass every row it still has.
  it('the fixture is whole', () => {
    expect(ROWS).toHaveLength(272)
    expect(new Set(ROWS.map((r) => r.command)).size).toBe(ROWS.length)
    expect(ROWS.filter((r) => r.expect === 'deny')).toHaveLength(245)
    expect(ROWS.filter((r) => r.group === 'allow control')).toHaveLength(24)
    expect(ROWS.filter((r) => r.group === 'variable-held code flag')).toHaveLength(6)
    expect(ROWS.filter((r) => r.group === 'reader witness')).toHaveLength(3)
    expect(ROWS.filter((r) => r.group === OPEN_GROUP)).toHaveLength(2)
    expect(ROWS.filter(isOpenPwsh)).toHaveLength(1)
    // nothing that was denied may be allowed now
    expect(ROWS.filter((r) => r.before === 'deny' && r.expect !== 'deny')).toEqual([])
  })

  it.each(named((r) => r.before === 'deny'))('still DENIED: %s', (_name, r) => {
    expect(got(r)).toBe('deny')
  })

  // The cells the fix exists for: each of them passed before it.
  it('100 rows passed before the fix, trillian\'s two among them', () => {
    const fixed = ROWS.filter((r) => r.before !== r.expect)
    expect(fixed).toHaveLength(100)
    const forms = fixed.filter((r) => r.group === 'python3 -c').map((r) => r.form)
    expect(forms).toEqual(expect.arrayContaining(['"name" args', 'env "name" args']))
  })
  it.each(named((r) => r.before === 'allow' && r.expect === 'deny'))('DENIED now, passed before: %s', (_name, r) => {
    expect(got(r)).toBe('deny')
  })

  // The false-deny side: prose that only NAMES the spelling, a quote or a backslash in an ARGUMENT,
  // a quoted interpreter running a SCRIPT FILE (that family is not touched), and the harmless twins
  // of the denied lines (localhost, code with no network call, a URL that is only data).
  it.each(named((r) => r.group === 'allow control'))('still PASSES: %s', (_name, r) => {
    expect(got(r)).toBe('allow')
  })

  // NOT fixed here, pinned as they ARE so that a change shows in either direction:
  //  - wget in any spelling: the parser's header leaves every other network binary to the name list;
  //  - `$(echo powershell.exe) -c "iwr URL"`: the SUBSTITUTED command word is judged by namesNetwork,
  //    which does not know the PowerShell cmdlets. A different family from a quoted name.
  it.each(named((r) => r.group === OPEN_GROUP || isOpenPwsh(r)))('OPEN, passes: %s', (_name, r) => {
    expect(got(r)).toBe('allow')
  })

  // The hook as Claude Code runs it: classify() being right is worth nothing if the entry point
  // decides differently. One row of every fixed shape, and the allow controls of the same shapes.
  it('the hook process denies one row of every fixed shape and stays silent on their harmless twins', () => {
    const dir = mkTmp('bash-egress-name-matrix-')
    const run = (command: string) => spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf-8',
      env: { ...process.env, BASH_EGRESS_BLOCK_LOG: join(dir, 'blocks.jsonl'), BASH_EGRESS_VENDOR_HOSTS: join(dir, 'none.json') },
    })
    const fixedGroups = [...new Set(ROWS.filter((r) => r.before !== r.expect).map((r) => r.group))]
    expect(fixedGroups).toHaveLength(28)
    for (const g of fixedGroups) {
      const r = ROWS.find((x) => x.group === g && x.before !== x.expect)!
      expect({ cmd: r.command, out: run(r.command).stdout }).toEqual({ cmd: r.command, out: expect.stringContaining('"permissionDecision":"deny"') })
    }
    for (const r of ROWS.filter((x) => x.group === 'allow control')) {
      expect({ cmd: r.command, out: run(r.command).stdout }).toEqual({ cmd: r.command, out: '' })
    }
  })
})
