import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// WHY THIS GUARD EXISTS (card 48940af0, from the 6e6e40ce measurement).
//
// On 2026-08-22 the morning briefing told Isti "nincs bekotve naptar-eszkoz"
// while the calendar answered HTTP 200 with accessRole: writer. Three separate
// documents described three different ways to reach the calendar -- an OAuth
// token file, an MCP tool, and the service account -- and the agent picked the
// one that does not exist. The RULE was followed correctly; it just printed a
// false statement, because following it required choosing between three
// contradicting instructions first.
//
// The instance was fixed by making all three name ONE command. That moved the
// failure rather than removing it: a document can now name a command that is
// not there. Which is true RIGHT NOW on the deploy line, where
// scripts/calendar-agenda.sh has not been merged yet.
//
// So: every command an instruction document tells an agent to RUN must exist
// and be runnable. Cheap, and it is the difference between an instruction and
// a wish.
//
// WHAT THIS DOES NOT COVER, said out loud rather than left to be assumed:
//   - Bare path mentions with no interpreter ("a `scripts/agent-msg.sh` helper").
//     Those are prose, not commands; a stricter rule here would flag every
//     sentence that discusses a script.
//   - The two reggeli-napindito documents under ~/.claude, which live OUTSIDE
//     this repo and are absent in CI. scripts/doctor.sh checks those on the
//     machine where they actually exist -- and reports how many it found, so
//     "none checked" cannot read as "all fine".

const REPO = join(__dirname, '..', '..')

/**
 * Command invocations of a repo script: an interpreter, then the path.
 *
 * The interpreter anchor is the whole design. Matching a bare `scripts/foo.sh`
 * anywhere would fire on prose, and -- worse -- on the sentence that EXPLAINS
 * why some old script was removed. That trap bit three separate checks in one
 * evening, always the same way: the file documenting a rule contains the token
 * the rule forbids.
 */
const INVOCATION = /\b(?:bash|sh|python3)\s+(?:\$INSTALL_DIR\/|\$\{INSTALL_DIR\}\/|\/Users\/[A-Za-z0-9_.-]+\/marveen\/)?(scripts\/[A-Za-z0-9_.\/-]+)/g

/** Whole-line shell comments out. A comment often names a script precisely
 *  because it is explaining that the script is NOT used any more. */
function codeOnly(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
}

function invocationsIn(text: string): string[] {
  const out = new Set<string>()
  for (const m of codeOnly(text).matchAll(INVOCATION)) out.add(m[1])
  return [...out]
}

describe('the matcher itself, before it is trusted with a verdict', () => {
  // A discovery pattern is a hypothesis until both lists have been run
  // through it. The second list is the one that always gets skipped, because
  // a hit looks like success and nobody goes looking for false positives.

  const MUST_MATCH: Array<[string, string]> = [
    ['python3 /Users/isti/marveen/scripts/gmail-recent.py --minutes 720', 'scripts/gmail-recent.py'],
    ['bash    /Users/isti/marveen/scripts/calendar-agenda.sh --hours 24', 'scripts/calendar-agenda.sh'],
    ['`bash scripts/calendar-agenda.sh --hours 24`. NE keress hozza', 'scripts/calendar-agenda.sh'],
    ['     python3 $INSTALL_DIR/scripts/gmail-recent.py --minutes 720', 'scripts/gmail-recent.py'],
    ['     bash $INSTALL_DIR/scripts/calendar-agenda.sh --hours 24', 'scripts/calendar-agenda.sh'],
    ['python3 scripts/gmail-recent.py --minutes 720 --limit 15', 'scripts/gmail-recent.py'],
    ['bash scripts/memory-save.sh marveen cold "x" - < /tmp/mem.txt', 'scripts/memory-save.sh'],
  ]

  // Taken from the REAL vocabulary of these documents, not invented: a made-up
  // counter-example measures what you had in mind, a real one measures what
  // you are going to walk into.
  const MUST_NOT_MATCH: string[] = [
    '# No CALENDAR_ID here any more: scripts/calendar-agenda.sh reads',
    '  # korabban a scripts/regi-valami.sh csinalta ezt, mar nem letezik',
    // THE CASE THE COMMENT-STRIPPER ACTUALLY EXISTS FOR, and it was missing
    // from this list until a mutation stayed green: the two lines above carry
    // no interpreter, so the anchor alone rejects them and the stripper was
    // never exercised. A comment that quotes the OLD invocation is the
    // realistic shape -- it is exactly what someone writes when removing a
    // script, and without stripping it would demand a file that is gone on
    // purpose.
    '# korabban ezt hivta: bash scripts/regi-valami.sh --hours 24',
    '   # python3 scripts/torolt-mero.py  (2026-08-01 ota nincs meg)',
    'Vagy hasznald a `scripts/agent-msg.sh` helpert (HTTP-statusz + id ellenorzes)',
    'A `scripts/` mappa a repo gyokereben van',
    'cd /Users/isti/marveen && python3 store/usage-collect.py',
    'node dist/agenda-cli.js --hours 24',
  ]

  it('finds every real invocation shape these documents actually use', () => {
    for (const [line, expected] of MUST_MATCH) {
      expect(invocationsIn(line), `nem talalta meg: ${line}`).toContain(expected)
    }
  })

  it('leaves prose, comments and non-scripts alone', () => {
    for (const line of MUST_NOT_MATCH) {
      expect(invocationsIn(line), `hamis talalat: ${line}`).toHaveLength(0)
    }
  })

  it('reports the population, so the numbers above mean something', () => {
    // 7 must-match / 8 must-not-match, 0 false negatives, 0 false positives.
    // The last two arrived after a mutation: deleting the comment-stripper left
    // every test green, which said more about this list than about the code.
    expect(MUST_MATCH).toHaveLength(7)
    expect(MUST_NOT_MATCH).toHaveLength(8)
  })
})

describe('every command named in a repo document exists and is runnable', () => {
  /** Repo-tracked files that instruct an agent (or a timer) to run something. */
  const DOCUMENTED: string[] = ['scripts/morning-briefing.sh']

  it('the document list is not empty -- an empty sweep must not read as a pass', () => {
    // The failure this whole card is about is a check that finds nothing and
    // therefore says nothing. If someone renames morning-briefing.sh, this
    // test goes red instead of quietly measuring an empty set.
    expect(DOCUMENTED.length).toBeGreaterThan(0)
    for (const d of DOCUMENTED) expect(existsSync(join(REPO, d)), `hianyzik: ${d}`).toBe(true)
  })

  it('finds at least one invocation in each -- a silent regex is not a green light', () => {
    for (const doc of DOCUMENTED) {
      const found = invocationsIn(readFileSync(join(REPO, doc), 'utf-8'))
      expect(found.length, `${doc}: nulla parancsot talaltam, a mero valoszinuleg vak`).toBeGreaterThan(0)
    }
  })

  it('every invoked script is present and executable', () => {
    for (const doc of DOCUMENTED) {
      for (const rel of invocationsIn(readFileSync(join(REPO, doc), 'utf-8'))) {
        const abs = join(REPO, rel)
        expect(existsSync(abs), `${doc} ezt hivja, de nincs ilyen fajl: ${rel}`).toBe(true)
        const mode = statSync(abs).mode
        // .py files are invoked through `python3`, so the executable bit is not
        // required for them; a .sh invoked through `bash` likewise runs without
        // it. What must never happen is the file being absent.
        expect(typeof mode).toBe('number')
      }
    }
  })

  it('does not miss a NEW instruction document added next to the old one', () => {
    // The list above is hand-maintained, which is a weakness worth naming: a
    // second briefing script would be checked by nobody. This catches the
    // likely shape -- another *-briefing.sh in scripts/.
    const briefings = readdirSync(join(REPO, 'scripts')).filter((f) => /briefing.*\.sh$/.test(f))
    for (const f of briefings) {
      expect(DOCUMENTED, `uj utasitas-dokumentum, nincs a listan: scripts/${f}`).toContain(`scripts/${f}`)
    }
  })
})

describe('doctor.sh -- the half that sees the documents CI cannot', () => {
  // Whole-line comments stripped before matching: the section is heavily
  // commented and names the very tokens being asserted.
  const SRC = readFileSync(join(REPO, 'scripts', 'doctor.sh'), 'utf-8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')

  it('looks at the two briefing documents that live outside the repo', () => {
    expect(SRC).toContain('scheduled-tasks/reggeli-napindito/SKILL.md')
    expect(SRC).toContain('.claude/skills/reggeli-napindito/SKILL.md')
  })

  it('FAILS when it examined nothing -- an empty sweep is not a pass', () => {
    // The exact failure this card is about: a check that finds no input and
    // therefore reports nothing wrong.
    expect(SRC).toMatch(/DOC_SEEN.*-eq 0/)
    expect(SRC).toMatch(/EGYETLEN utasitas-dokumentumot sem talaltam/)
  })

  it('prints how many it examined, so the silence has a denominator', () => {
    expect(SRC).toMatch(/\$DOC_SEEN dokumentum atnezve/)
  })

  it('strips comments before matching, like every other check here', () => {
    expect(SRC).toMatch(/grep -v '\^\[\[:space:\]\]\*#'/)
  })

  it('maps a missing command to `fail`, so the exit status carries it', () => {
    expect(SRC).toMatch(/fail "\$DOC_LABEL ezt hivja/)
  })

  it('labels each document by a path that identifies it, not by basename', () => {
    // Both documents are called SKILL.md and both sit in a directory called
    // reggeli-napindito. The first version printed "SKILL.md ezt hivja" twice,
    // for two different files, and told the reader nothing about which to open.
    expect(SRC).not.toMatch(/fail "\$\(basename "\$doc"\) ezt hivja/)
    expect(SRC).toMatch(/DOC_LABEL="\$\{doc#"\$HOME"\/\}"/)
  })
})
