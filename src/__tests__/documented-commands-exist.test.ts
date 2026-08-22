import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// WHY THIS GUARD EXISTS (card 48940af0, from the 6e6e40ce measurement).
//
// On 2026-08-22 the morning briefing told Isti "nincs bekotve naptar-eszkoz"
// while the calendar answered HTTP 200 with accessRole: writer. Three separate
// documents described three different ways to reach it -- an OAuth token file,
// an MCP tool, and the service account -- and the agent picked the one that
// does not exist. The rule was followed correctly; following it just required
// choosing between three contradicting instructions first.
//
// Making all three name ONE command moved the failure rather than removing it:
// a document can now name a command that is not installed.
//
// AND THE PART THAT IS EASY TO GET WRONG (Marveen caught it in the first
// version of this check): it is not enough to ask whether the file exists.
// It has to exist WHERE THE DOCUMENT SAYS IT WILL RUN. Resolving against the
// checkout the checker runs in answers the wrong question -- the author's own
// branch always has the file. That is the one place the answer is guaranteed
// to be yes, and it is never the place the 07:30 briefing runs from.

const REPO = join(__dirname, '..', '..')
const SCRIPT = join(REPO, 'scripts', 'doc-commands.py')

/** Drive the REAL extractor, so these tests cannot drift from what doctor.sh runs. */
function listFor(content: string, installDir = '/nonexistent-install'): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'doccmd-'))
  const doc = join(dir, 'DOC.md')
  writeFileSync(doc, content)
  const out = execFileSync('python3', [SCRIPT, doc, installDir, '--list'], { encoding: 'utf-8' })
  return out.split('\n').filter(Boolean)
}

function refsIn(content: string): string[] {
  return listFor(content).map((l) => l.split('\t')[0])
}

describe('the matcher itself, before it is trusted with a verdict', () => {
  // A discovery pattern is a hypothesis until both lists have been run through
  // it. The second list is the one that always gets skipped, because a hit
  // looks like success and nobody goes looking for false positives.

  const MUST_MATCH: Array<[string, string]> = [
    ['python3 /Users/isti/marveen/scripts/gmail-recent.py --minutes 720', '/Users/isti/marveen/scripts/gmail-recent.py'],
    ['bash    /Users/isti/marveen/scripts/calendar-agenda.sh --hours 24', '/Users/isti/marveen/scripts/calendar-agenda.sh'],
    ['`bash scripts/calendar-agenda.sh --hours 24`. NE keress hozza', 'scripts/calendar-agenda.sh'],
    ['     python3 $INSTALL_DIR/scripts/gmail-recent.py --minutes 720', '$INSTALL_DIR/scripts/gmail-recent.py'],
    ['     bash $INSTALL_DIR/scripts/calendar-agenda.sh --hours 24', '$INSTALL_DIR/scripts/calendar-agenda.sh'],
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
    // no interpreter, so the anchor alone rejects them and the stripper never
    // ran on them. A comment quoting the OLD invocation is the realistic
    // shape -- it is what someone writes when removing a script, and without
    // stripping the guard would demand a file that is gone on purpose.
    '# korabban ezt hivta: bash scripts/regi-valami.sh --hours 24',
    '   # python3 scripts/torolt-mero.py  (2026-08-01 ota nincs meg)',
    'Vagy hasznald a `scripts/agent-msg.sh` helpert (HTTP-statusz + id ellenorzes)',
    'A `scripts/` mappa a repo gyokereben van',
    'cd /Users/isti/marveen && python3 store/usage-collect.py',
    'node dist/agenda-cli.js --hours 24',
  ]

  it('finds every real invocation shape these documents actually use', () => {
    for (const [line, expected] of MUST_MATCH) {
      expect(refsIn(line), `nem talalta meg: ${line}`).toContain(expected)
    }
  })

  it('leaves prose, comments and non-scripts alone', () => {
    for (const line of MUST_NOT_MATCH) {
      expect(refsIn(line), `hamis talalat: ${line}`).toHaveLength(0)
    }
  })

  it('reports the population, so the numbers above mean something', () => {
    // 7 must-match / 8 must-not-match, 0 false negatives, 0 false positives.
    // The last two of the NOT list arrived after a mutation: deleting the
    // comment-stripper left every test green, which said more about this list
    // than about the code.
    expect(MUST_MATCH).toHaveLength(7)
    expect(MUST_NOT_MATCH).toHaveLength(8)
  })
})

describe('resolution -- where the document says it will run', () => {
  // This is the half that was wrong first, and the half that decides whether
  // the check is worth anything at all.
  const INSTALL = '/opt/some-install'

  function targetFor(line: string): string {
    return listFor(line, INSTALL)[0].split('\t')[1]
  }

  it('an ABSOLUTE path is checked exactly as written, not re-rooted', () => {
    // The two briefing documents name /Users/isti/marveen/... -- a promise
    // about the DEPLOY tree. Re-rooting it into whatever checkout the checker
    // happens to live in is how a missing file reads as present.
    expect(targetFor('bash /Users/isti/marveen/scripts/calendar-agenda.sh --hours 24'))
      .toBe('/Users/isti/marveen/scripts/calendar-agenda.sh')
  })

  it('$INSTALL_DIR resolves against the install, because that is what it does at runtime', () => {
    expect(targetFor('bash $INSTALL_DIR/scripts/calendar-agenda.sh --hours 24'))
      .toBe(`${INSTALL}/scripts/calendar-agenda.sh`)
  })

  it('a bare relative path resolves against the install root', () => {
    expect(targetFor('python3 scripts/gmail-recent.py --minutes 720'))
      .toBe(`${INSTALL}/scripts/gmail-recent.py`)
  })

  it('reports MISSING for a path that is not there, and only for that', () => {
    const rows = listFor(
      'bash /definitely/not/here/scripts/ghost.sh\npython3 scripts/gmail-recent.py --minutes 5',
      REPO,
    )
    const byRef = Object.fromEntries(rows.map((r) => [r.split('\t')[0], r.split('\t')[2]]))
    expect(byRef['/definitely/not/here/scripts/ghost.sh']).toBe('MISSING')
    expect(byRef['scripts/gmail-recent.py']).toBe('OK')
  })
})

describe('every command named in a repo document exists', () => {
  /** Repo-tracked files that instruct an agent (or a timer) to run something. */
  const DOCUMENTED: string[] = ['scripts/morning-briefing.sh']

  it('the document list is not empty -- an empty sweep must not read as a pass', () => {
    expect(DOCUMENTED.length).toBeGreaterThan(0)
    for (const d of DOCUMENTED) expect(existsSync(join(REPO, d)), `hianyzik: ${d}`).toBe(true)
  })

  it('finds at least one invocation in each -- a silent regex is not a green light', () => {
    for (const doc of DOCUMENTED) {
      const found = refsIn(readFileSync(join(REPO, doc), 'utf-8'))
      expect(found.length, `${doc}: nulla parancsot talaltam, a mero valoszinuleg vak`).toBeGreaterThan(0)
    }
  })

  it('every invoked script is present, resolved against THIS repo', () => {
    // morning-briefing.sh uses $INSTALL_DIR, which it computes from its own
    // location -- so for this document the checkout it ships in IS the tree it
    // runs from. That is why re-rooting is correct here and wrong for the
    // ~/.claude documents, which name an absolute path instead.
    for (const doc of DOCUMENTED) {
      const dir = mkdtempSync(join(tmpdir(), 'doccmd-repo-'))
      mkdirSync(join(dir, 'd'), { recursive: true })
      const copy = join(dir, 'd', 'DOC.md')
      writeFileSync(copy, readFileSync(join(REPO, doc), 'utf-8'))
      const missing = execFileSync('python3', [SCRIPT, copy, REPO], { encoding: 'utf-8' }).trim()
      expect(missing, `${doc} olyan parancsot hiv, ami nincs a repoban`).toBe('')
    }
  })

  it('does not miss a NEW instruction document added next to the old one', () => {
    // The list above is hand-maintained, which is a weakness worth naming: a
    // second briefing script would be checked by nobody. This catches the
    // likely shape -- another *briefing*.sh in scripts/.
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

  it('uses the same extractor as these tests, not a second copy of the rule', () => {
    // Two implementations of one pattern drift, and the one nobody runs is the
    // one that keeps passing.
    expect(SRC).toContain('scripts/doc-commands.py')
  })

  it('FAILS when it examined nothing -- an empty sweep is not a pass', () => {
    expect(SRC).toMatch(/DOC_SEEN.*-eq 0/)
    expect(SRC).toMatch(/EGYETLEN utasitas-dokumentumot sem talaltam/)
  })

  it('prints how many it examined, so the silence has a denominator', () => {
    expect(SRC).toMatch(/\$DOC_SEEN dokumentum atnezve/)
  })

  it('maps a missing command to `fail`, so the exit status carries it', () => {
    expect(SRC).toMatch(/fail "\$DOC_LABEL ezt hivja/)
  })

  it('labels each document by a path that identifies it, not by basename', () => {
    // Both documents are called SKILL.md and both sit in a directory called
    // reggeli-napindito. The first version printed "SKILL.md ezt hivja" twice,
    // for two different files, telling the reader nothing about which to open.
    expect(SRC).not.toMatch(/fail "\$\(basename "\$doc"\) ezt hivja/)
    expect(SRC).toMatch(/DOC_LABEL="\$\{doc#"\$HOME"\/\}"/)
  })
})
