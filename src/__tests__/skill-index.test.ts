import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'skill-index.sh')

function makeSkillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

function runScript(args: string[], env: Record<string, string>): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`bash "${SCRIPT}" ${args.map(a => `"${a}"`).join(' ')}`, {
      encoding: 'utf-8',
      env: { ...process.env, ...env },
    })
    return { stdout, exitCode: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number }
    return { stdout: e.stdout ?? '', exitCode: e.status ?? 1 }
  }
}

describe('skill-index.sh -- no-arg mode (backward compat)', () => {
  let tmpHome: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'skill-index-test-'))
    mkdirSync(join(tmpHome, '.claude', 'skills', 'skill-alpha'), { recursive: true })
    writeFileSync(
      join(tmpHome, '.claude', 'skills', 'skill-alpha', 'SKILL.md'),
      makeSkillMd('skill-alpha', 'Global skill alpha description'),
    )
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('writes the index to ~/.claude/skills/.skill-index.md', () => {
    runScript([], { HOME: tmpHome })
    const indexPath = join(tmpHome, '.claude', 'skills', '.skill-index.md')
    expect(existsSync(indexPath)).toBe(true)
  })

  it('includes global skill in the index', () => {
    runScript([], { HOME: tmpHome })
    const content = readFileSync(join(tmpHome, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    expect(content).toContain('skill-alpha')
    expect(content).toContain('Global skill alpha description')
  })

  it('uses the two-column table format (no Scope column)', () => {
    runScript([], { HOME: tmpHome })
    const content = readFileSync(join(tmpHome, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    expect(content).toContain('| Skill | Leírás |')
    expect(content).not.toContain('| Scope |')
  })

  it('does NOT create an index in any other directory', () => {
    const agentDir = join(tmpHome, 'agents', 'agent-a')
    mkdirSync(join(agentDir, '.claude', 'skills', 'skill-beta'), { recursive: true })
    writeFileSync(
      join(agentDir, '.claude', 'skills', 'skill-beta', 'SKILL.md'),
      makeSkillMd('skill-beta', 'Agent-specific skill beta'),
    )
    runScript([], { HOME: tmpHome })
    const agentIndex = join(agentDir, '.claude', 'skills', '.skill-index.md')
    expect(existsSync(agentIndex)).toBe(false)
  })
})

describe('skill-index.sh -- AGENT_DIR mode (merged index)', () => {
  let tmpHome: string
  let agentDir: string

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'skill-index-test-'))
    // Global skill
    mkdirSync(join(tmpHome, '.claude', 'skills', 'skill-global'), { recursive: true })
    writeFileSync(
      join(tmpHome, '.claude', 'skills', 'skill-global', 'SKILL.md'),
      makeSkillMd('skill-global', 'A global skill visible to all agents'),
    )
    // Agent-specific skill
    agentDir = join(tmpHome, 'agents', 'agent-a')
    mkdirSync(join(agentDir, '.claude', 'skills', 'skill-local'), { recursive: true })
    writeFileSync(
      join(agentDir, '.claude', 'skills', 'skill-local', 'SKILL.md'),
      makeSkillMd('skill-local', 'An agent-local skill for agent-a only'),
    )
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  it('writes the merged index to <AGENT_DIR>/.claude/skills/.skill-index.md', () => {
    runScript([agentDir], { HOME: tmpHome })
    const indexPath = join(agentDir, '.claude', 'skills', '.skill-index.md')
    expect(existsSync(indexPath)).toBe(true)
  })

  it('includes global skill in the merged index', () => {
    runScript([agentDir], { HOME: tmpHome })
    const content = readFileSync(join(agentDir, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    expect(content).toContain('skill-global')
    expect(content).toContain('A global skill visible to all agents')
  })

  it('includes agent-specific skill in the merged index', () => {
    // This is the core regression test: fails when AGENT_DIR handling is removed
    runScript([agentDir], { HOME: tmpHome })
    const content = readFileSync(join(agentDir, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    expect(content).toContain('skill-local')
    expect(content).toContain('An agent-local skill for agent-a only')
  })

  it('labels global and agent-specific skills with scope', () => {
    runScript([agentDir], { HOME: tmpHome })
    const content = readFileSync(join(agentDir, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    expect(content).toContain('| global |')
    expect(content).toContain('| agent |')
  })

  it('does NOT modify the global index when running in agent mode', () => {
    const globalIndexPath = join(tmpHome, '.claude', 'skills', '.skill-index.md')
    // Ensure there is no stale global index before the run
    expect(existsSync(globalIndexPath)).toBe(false)
    runScript([agentDir], { HOME: tmpHome })
    expect(existsSync(globalIndexPath)).toBe(false)
  })

  it('creates agent .claude/skills/ directory if it does not exist yet', () => {
    const freshAgentDir = join(tmpHome, 'agents', 'agent-b')
    // Only the agent dir exists, no .claude/skills/ inside
    mkdirSync(freshAgentDir, { recursive: true })
    runScript([freshAgentDir], { HOME: tmpHome })
    expect(existsSync(join(freshAgentDir, '.claude', 'skills', '.skill-index.md'))).toBe(true)
  })

  it('two different agents get independent indexes with their own agent-local skills', () => {
    // agent-b has a different local skill
    const agentBDir = join(tmpHome, 'agents', 'agent-b')
    mkdirSync(join(agentBDir, '.claude', 'skills', 'skill-b-only'), { recursive: true })
    writeFileSync(
      join(agentBDir, '.claude', 'skills', 'skill-b-only', 'SKILL.md'),
      makeSkillMd('skill-b-only', 'Only for agent-b'),
    )

    runScript([agentDir], { HOME: tmpHome })
    runScript([agentBDir], { HOME: tmpHome })

    const indexA = readFileSync(join(agentDir, '.claude', 'skills', '.skill-index.md'), 'utf-8')
    const indexB = readFileSync(join(agentBDir, '.claude', 'skills', '.skill-index.md'), 'utf-8')

    // agent-a sees skill-local but not skill-b-only
    expect(indexA).toContain('skill-local')
    expect(indexA).not.toContain('skill-b-only')

    // agent-b sees skill-b-only but not skill-local
    expect(indexB).toContain('skill-b-only')
    expect(indexB).not.toContain('skill-local')

    // both see the global skill
    expect(indexA).toContain('skill-global')
    expect(indexB).toContain('skill-global')
  })
})

describe('skill-index.sh -- graceful handling of missing global dir', () => {
  // Measured 2026-08-22, and the mistake was mine: the size warning already went to
  // stderr, which is correct -- and I still lost it, twice, by running the script as
  // `>/dev/null 2>&1` to hide the routine "index generated" line. In those same two
  // turns I pushed a skill from 611 to 643 lines. The guard worked perfectly and
  // nobody heard it.
  //
  // A message is only as loud as the CALLER permits. An exit code is not: it survives
  // both streams being discarded, and it stops an `&&` chain. Hence exit 3 -- its own
  // value, so a real generation failure stays distinguishable from "index built, and
  // the size guard found something".
  // The other half of the same fix, and the one that removes the REASON rather than
  // surviving it: two agents ran this script as `>/dev/null 2>&1` on the same night --
  // not to hide the warning, but to hide the routine "index generated" line. The `2>&1`
  // then took the warning with it. Separating the streams was right and not enough,
  // because a caller does not think per-stream, it thinks "print nothing".
  //
  // Quiet by default, so there is nothing to silence. This is NOT a silent success: the
  // EXIT CODE answers "did it run" (0 = done, 3 = done + over limit, else failure). A
  // script that is both mute and status-less would indeed be indistinguishable from one
  // that never started.
  it('prints NOTHING on the happy path, so no caller has a reason to redirect', () => {
    const home = mkdtempSync(join(tmpdir(), 'skill-quiet-'))
    try {
      const dir = join(home, '.claude', 'skills', 'thin-one')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), makeSkillMd('thin-one', 'x'))
      const { stdout, exitCode } = runScript([], { HOME: home, SKILL_LINE_LIMIT: '500' })
      expect(stdout.trim()).toBe('')
      expect(exitCode).toBe(0)
      // ...and it really did the work, which is the point of measuring silence at all.
      expect(existsSync(join(home, '.claude', 'skills', '.skill-index.md'))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('-v restores the confirmation line for a human who wants it', () => {
    const home = mkdtempSync(join(tmpdir(), 'skill-verbose-'))
    try {
      const dir = join(home, '.claude', 'skills', 'thin-one')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), makeSkillMd('thin-one', 'x'))
      const { stdout } = runScript(['-v'], { HOME: home, SKILL_LINE_LIMIT: '500' })
      expect(stdout).toContain('Skill index generated')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('EXITS NON-ZERO when a skill is over the limit, so a silenced caller still trips', () => {
    const home = mkdtempSync(join(tmpdir(), 'skill-size-'))
    try {
      const dir = join(home, '.claude', 'skills', 'fat-one')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), makeSkillMd('fat-one', 'x') + 'line\n'.repeat(60))
      const { exitCode } = runScript([], { HOME: home, SKILL_LINE_LIMIT: '50' })
      expect(exitCode).toBe(3)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('exits 0 when every skill is under the limit -- the guard must not cry wolf', () => {
    // The other direction, and the one that makes the test above mean something: a
    // guard wired to fail always would pass the assertion above and be useless.
    const home = mkdtempSync(join(tmpdir(), 'skill-size-ok-'))
    try {
      const dir = join(home, '.claude', 'skills', 'thin-one')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), makeSkillMd('thin-one', 'x'))
      const { exitCode } = runScript([], { HOME: home, SKILL_LINE_LIMIT: '500' })
      expect(exitCode).toBe(0)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('exits cleanly when ~/.claude/skills does not exist', () => {
    const emptyHome = mkdtempSync(join(tmpdir(), 'skill-index-test-'))
    try {
      const { exitCode } = runScript([], { HOME: emptyHome })
      expect(exitCode).toBe(0)
    } finally {
      rmSync(emptyHome, { recursive: true, force: true })
    }
  })
})

describe('skill-index.sh -- a MARADEK KERET, nem csak az ertek (mandark, 2026-08-27)', () => {
  // A sor eddig megmondta, MENNYI a novekedes, es nem mondta meg, MENNYI FER MEG.
  // Aki a "+15"-ot latta, nem tudta belole, hogy egyetlen sor valasztja el a
  // riasztastol -- es a riasztast nem az kapja, aki a keretet elhasznalta, hanem a
  // KOVETKEZO, aki egy jogos sort beir.

  function baselinedHome(lines: number) {
    const home = mkdtempSync(join(tmpdir(), 'skill-room-'))
    const dir = join(home, '.claude', 'skills', 'pinned')
    mkdirSync(dir, { recursive: true })
    const head = makeSkillMd('pinned', 'x')
    const headLines = head.split('\n').length - 1
    writeFileSync(join(dir, 'SKILL.md'), head + 'line\n'.repeat(Math.max(0, lines - headLines)))
    return home
  }

  it('kiirja, hany sor fer meg -- es a szam a kerettel egyutt mozdul', () => {
    const home = baselinedHome(100)
    try {
      const base = { HOME: home, SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: '90' }
      // novekedes +10 mindharom esetben; csak a keret valtozik
      expect(runScript([], { ...base, SKILL_GROWTH_LIMIT: '10' }).stdout).toContain('0 sor maradt')
      expect(runScript([], { ...base, SKILL_GROWTH_LIMIT: '15' }).stdout).toContain('5 sor maradt')
      expect(runScript([], { ...base, SKILL_GROWTH_LIMIT: '30' }).stdout).toContain('20 sor maradt')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('a SZUKEBB korlatot mondja, es megnevezi, ha a KEMENY korlat kot', () => {
    // Egy szam a kotoereje nelkul ugyanaz a hiba, mint egy szam populacio nelkul:
    // "20 sor maradt" hamis igeret, ha a kemeny korlat 2 sorra van.
    const home = baselinedHome(100)
    try {
      const base = { HOME: home, SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: '90',
                     SKILL_GROWTH_LIMIT: '50' }
      const laza = runScript([], { ...base, SKILL_HARD_LIMIT: '600' }).stdout
      expect(laza).toContain('40 sor maradt')
      expect(laza).not.toContain('KEMENY korlat kot')

      const szoros = runScript([], { ...base, SKILL_HARD_LIMIT: '103' }).stdout
      expect(szoros).toContain('3 sor maradt')
      expect(szoros).toContain('KEMENY korlat kot')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('a "0 sor maradt" AZT JELENTI, hogy a kovetkezo sor tuzel -- a szam es a kapu egyben', () => {
    // EZ AZ, AMITOL A SZAM NEM DISZ. A ket elozo teszt a SZOVEGET meri; ez azt meri,
    // hogy a szoveg IGAZAT mond a kapurol. Enelkul a maradek-szamot el lehetne rontani
    // ugy, hogy minden szoveg-allitas zold marad.
    const base = { SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: '90',
                   SKILL_GROWTH_LIMIT: '10', SKILL_HARD_LIMIT: '600' }
    const hatarOn = baselinedHome(100)   // novekedes +10, keret 10 -> 0 maradt
    const eggyelTul = baselinedHome(101) // +11 -> tuzel
    try {
      const a = runScript([], { ...base, HOME: hatarOn })
      expect(a.stdout).toContain('0 sor maradt')
      expect(a.exitCode).toBe(0)

      const b = runScript([], { ...base, HOME: eggyelTul })
      expect(b.exitCode).toBe(3)
    } finally {
      rmSync(hatarOn, { recursive: true, force: true })
      rmSync(eggyelTul, { recursive: true, force: true })
    }
  })
})

describe('skill-index.sh -- a KEMENY ag ALSZIK a mai konstansokkal (didi, 2026-08-27)', () => {
  // didi merte: a "KEMENY korlat kot" ag feltetelebol a FAJLMERET KIESIK --
  //     HARD - n < LIMIT - (n - BASE)   <=>   HARD < LIMIT + BASE
  // A mai ertekekkel (HARD 600, LIMIT 15, BASE 489): 600 < 504 -> HAMIS.
  // Numerikus kontroll n=1..600-ra: nulla talalat.
  //
  // MIERT TESZT ES NEM TORLES. Az ag helyes, es az alapvonal MA HAROMSZOR mozdult;
  // ha atlepi a kuszobot, a masik ag "35 sor maradt"-ot igerne, mikozben a kemeny
  // korlat ket sorra van. De egy ag, ami sosem tuzel, megkulonboztethetetlen egy
  // helyestol -- pontosan az az alak, amit a szomszedos pozitiv-kontroll blokk
  // kommentje kimond, es amit az a blokk NEM fedett le erre az uj agra.
  // Ez a teszt akkor bukik, amikor az ag FELEBRED: igy nem eszrevetlenul valik
  // elove, hanem szolva.

  function homeWith(lines: number) {
    const home = mkdtempSync(join(tmpdir(), 'skill-dormant-'))
    const dir = join(home, '.claude', 'skills', 'pinned')
    mkdirSync(dir, { recursive: true })
    const head = makeSkillMd('pinned', 'x')
    writeFileSync(join(dir, 'SKILL.md'),
      head + 'line\n'.repeat(Math.max(0, lines - (head.split('\n').length - 1))))
    return home
  }

  // A KONSTANSOKAT A SZKRIPTBOL OLVASSUK KI, NEM HARDKODOLJUK. Az elso valtozat
  // BASE=489-et irt be "a produkcios harmas" nevvel; harom oran belul 436 lett
  // (alapvonal-racsni a references/ bontas utan). A teszt tovabbra is ZOLD maradt
  // volna, csak mar NEM AZT allitotta volna, amit a neve mond -- ugyanaz az alak,
  // mint egy szam a nevezoje nelkul, csak tesztben.
  function prodConstants() {
    const src = readFileSync(join(REPO_ROOT, 'scripts', 'skill-index.sh'), 'utf-8')
    // A SOR-ALAPVONAL 2026-09-12 ota LISTA (tobb alapvonalas skill). A regi `(\d+)` alak
    // EGYETLEN szamot feltetelezett, es a masodik skill bekerulesekor NEM rosszabb szamot
    // adott, hanem kivetelt dobott -- ez a jo irany, de a teszt allitasa attol meg a REGI
    // vilagrol szolt. Most a LISTAT olvassa, es a dormancia MINDEN alapvonalra allitodik.
    const pick = (name: string) => {
      const m = src.match(new RegExp(`${name}="\\$\\{${name}:-([\\d ]+)\\}"`))
      if (!m) throw new Error(`nem talalom a ${name} alapertelmezeset a szkriptben`)
      return m[1].trim()
    }
    const bases = pick('SKILL_BASELINE_LINES').split(/\s+/)
    return { bases, base: String(Math.max(...bases.map(Number))),
             limit: pick('SKILL_GROWTH_LIMIT'), hard: pick('SKILL_HARD_LIMIT') }
  }

  it('a MAI konstansokkal a kemeny ag SOSEM szolal meg -- barmilyen fajlmeretnel', () => {
    const { bases, base, limit, hard } = prodConstants()
    // A dormancia feltetele: HARD < LIMIT + BASE. Ha ez egyszer megfordul, a
    // ciklus alatti allitas HAMIS lesz -- es akkor ennek a tesztnek KELL buknia.
    // MINDEN alapvonalra allitjuk, nem csak egyre: a kemeny ag skillenkent kulon alszik,
    // es a KOTO eset a LEGNAGYOBB alapvonal -- azzal megy a ciklus is lentebb.
    expect(bases.length).toBeGreaterThan(0)
    for (const b of bases) {
      expect(Number(hard)).toBeGreaterThanOrEqual(Number(limit) + Number(b))
    }
    expect(Number(hard)).toBeGreaterThanOrEqual(Number(limit) + Number(base))
    const home = homeWith(Number(base) + 15)
    try {
      const env = { HOME: home, SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: base,
                    SKILL_GROWTH_LIMIT: limit, SKILL_HARD_LIMIT: hard }
      for (const n of [Number(base) + 1, Number(base) + 6, Number(base) + 11, Number(base) + 15]) {
        const h = homeWith(n)
        try {
          const out = runScript([], { ...env, HOME: h }).stdout
          expect(out).not.toContain('KEMENY korlat kot')
        } finally { rmSync(h, { recursive: true, force: true }) }
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('a KUSZOB pontosan BASE >= 586 -- ez a teszt ebreszt, ha a konstansok atlepik', () => {
    // 585-nel meg 600 < 600 HAMIS; 586-nal 600 < 601 IGAZ. Egy sor a kulonbseg,
    // es ez az a hatar, aminel a fenti teszt jelentese megvaltozik.
    const mk = (base: number, lines: number) => {
      const h = homeWith(lines)
      try {
        return runScript([], { HOME: h, SKILL_BASELINE_NAMES: 'pinned',
          SKILL_BASELINE_LINES: String(base), SKILL_GROWTH_LIMIT: '15',
          SKILL_HARD_LIMIT: '600' }).stdout
      } finally { rmSync(h, { recursive: true, force: true }) }
    }
    expect(mk(585, 590)).not.toContain('KEMENY korlat kot')
    expect(mk(586, 590)).toContain('KEMENY korlat kot')
  })
})

describe('skill-index.sh -- a KARAKTER-KERET: sajat alapvonal (83cac1ed)', () => {
  // didi merte: egy fajl 504 sorrol 504 sorra "valtozott", +300 karakterrel. A
  // sor-alapu or semmit nem latott. A karakter-novekedes a SAJAT alapvonalahoz
  // merodik, a kerete a sor-keret ugyanabban a suruségben (LIMIT * atlagos sorhossz).

  function fileWith(lines: number, chars: number) {
    const home = mkdtempSync(join(tmpdir(), 'skill-chars-'))
    const dir = join(home, '.claude', 'skills', 'pinned')
    mkdirSync(dir, { recursive: true })
    const per = Math.floor(chars / lines)
    const rows: string[] = []
    let used = 0
    for (let i = 0; i < lines - 1; i++) { rows.push('x'.repeat(per - 1)); used += per }
    rows.push('x'.repeat(chars - used - 1))
    const body = rows.join('\n') + '\n'
    writeFileSync(join(dir, 'SKILL.md'), body)
    return { home, actual: { lines: body.split('\n').length - 1, chars: Buffer.byteLength(body) } }
  }

  const BASE = { lines: 504, chars: 37453 }       // A = 74, keret 15*74 = 1110
  const env = (extra: Record<string, string>) => ({
    SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: String(BASE.lines),
    SKILL_BASELINE_CHARS: String(BASE.chars), SKILL_GROWTH_LIMIT: '15',
    SKILL_HARD_LIMIT: '600', ...extra,
  })
  const MARKER = 'A KARAKTER-KERET ELFOGYOTT'

  it('POZITIV KONTROLL: a sor-kereten BELUL, a karakter-kereten TUL -> TUZEL', () => {
    // +10 sor (a 15-os kereten belul), +1442 karakter (a 1110-es kereten tul).
    // Ez a mai valodi eset alakja: a sor-kapu nemán marad, a karakter szol.
    const { home, actual } = fileWith(514, 37453 + 1442)
    try {
      expect(actual.lines).toBe(514)
      const out = runScript([], env({ HOME: home })).stdout
      expect(out).toContain(MARKER)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('NEGATIV KONTROLL: valodi BONTAS (mindketto csokken) -> NEM tuzel', () => {
    const { home } = fileWith(436, 32848)
    try {
      expect(runScript([], env({ HOME: home })).stdout).not.toContain(MARKER)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('a NORMAL munka nem tuzel: +10 sor atlagos hosszal', () => {
    const { home } = fileWith(514, 37453 + 10 * Math.floor(37453 / 504))
    try {
      expect(runScript([], env({ HOME: home })).stdout).not.toContain(MARKER)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('mindket szam ott van az informativ sorban (alapvonal-PAR es novekedes-PAR)', () => {
    const { home } = fileWith(504, 37453)
    try {
      const out = runScript([], env({ HOME: home })).stdout
      expect(out).toContain('alapvonal 504/37453')
      expect(out).toContain('+0 kar')
      expect(out).not.toContain(MARKER)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  // A KAPU, NEM CSAK A HANG (card 07e5b171). Every test above asserts that the
  // guard SPEAKS. None asserted that it STOPS anything -- and that was exactly
  // the defect: the character branch printed its warning and returned 0, while
  // the summary line in the SAME output said every skill was under its limit.
  // Two contradicting statements, and the exit code sided with the comforting
  // one. A guard whose tests only read its stdout cannot tell a gate from a
  // narrator.

  it('a karakter-tullepes SAJAT kilepesi kodot ad (4), nem 0-t', () => {
    // The whole card in one assertion. Before the fix this returned 0, so an
    // `&&` chain or a CI step walked straight past it -- and a warning the
    // caller can silence with `>/dev/null` is worth what the caller allows.
    const { home } = fileWith(514, 37453 + 1442)
    try {
      const r = runScript([], env({ HOME: home }))
      expect(r.stdout).toContain(MARKER)
      expect(r.exitCode).toBe(4)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('es 4, NEM 3 -- a ket allitas kulonbozo, a hivo meg tudja kulonboztetni', () => {
    // 3 says a skill broke its LINE limit; 4 says it fits in lines and not in
    // characters. Collapsing them would lose the distinction the second number
    // was added for, and a caller that already handles 3 keeps its meaning.
    const { home } = fileWith(514, 37453 + 1442)
    try {
      expect(runScript([], env({ HOME: home })).exitCode).not.toBe(3)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('a SOR-tullepes tovabbra is 3, es elozi a karakter-agat', () => {
    // Precedence, pinned: a file over the HARD limit is also over its character
    // frame, and the harder violation must be the one reported. Without this
    // the new branch could quietly take over the older code.
    const { home } = fileWith(650, 37453 + 40000)
    try {
      expect(runScript([], env({ HOME: home })).exitCode).toBe(3)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('a kereten BELUL 0 marad -- egy or, ami mindig tuzel, nem or', () => {
    const { home } = fileWith(504, 37453)
    try {
      expect(runScript([], env({ HOME: home })).exitCode).toBe(0)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('az osszegzo sor NEM allitja, hogy minden rendben, amikor karakterben nincs', () => {
    // The contradiction itself. `--verbose` because the reassuring line only
    // prints there (the script forces VERBOSE=0 otherwise, so the env var is
    // inert -- measured, and already documented at skill-index.sh:274).
    const { home } = fileWith(514, 37453 + 1442)
    try {
      const out = runScript(['--verbose'], env({ HOME: home })).stdout
      expect(out).not.toContain('minden skill a sajat hatara alatt')
      expect(out + '').toContain(MARKER)
    } finally { rmSync(home, { recursive: true, force: true }) }
  })

  it('es AKKOR allitja, amikor tenyleg rendben van -- kulonben a sor semmit nem mondana', () => {
    // The other direction, and the one that makes the assertion above mean
    // something: without it, deleting the summary line entirely would pass.
    const { home } = fileWith(504, 37453)
    try {
      const out = runScript(['--verbose'], env({ HOME: home })).stdout
      expect(out).toContain('minden skill a sajat hatara alatt')
      // And the control must not be declaring itself broken. It used to: the
      // arms check looked for a hardcoded skill name, so under this harness's
      // own baseline ('pinned') the guard reported "NEM megbizhato" on every
      // run -- and 25 tests passed anyway, because none of them read this line.
      expect(out).not.toContain('pozitiv kontroll ELBUKOTT')
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})

// === `--check <skill>`: a szerzo a SAJAT fajljara kap szamot, iras ELOTT (kartya 0d0e3892)
//
// A mert problema: a meret-or a `$GLOBAL_SKILLS_DIR/*/SKILL.md` cikluson megy vegig, tehat
// MINDEN skillt nez (2026-08-27: 56), es a jelzest definicio szerint az kapja, aki legkozelebb
// futtatja -- fuggetlenul attol, ki irta a novekedest. Merve ugyanaznap: negy futas, mind
// ugyanarra a fajlra figyelmeztetett, amit a futtato nem szerkesztett.
//
// Amit a mod SZANDEKOSAN nem csinal: nem blokkol iras kozben. Egy blokk C-t allitana meg A
// tullepett fajlja miatt; egy or, ami miatt valaki nem tud irni, ki lesz kapcsolva.
describe('skill-index.sh -- `--check <skill>` (0d0e3892)', () => {
  let tmpHome: string
  const skills = () => join(tmpHome, '.claude', 'skills')

  function write(skill: string, lines: number, pad = ''): void {
    mkdirSync(join(skills(), skill), { recursive: true })
    const body = Array.from({ length: lines - 4 }, (_, i) => `sor ${i}${pad}`).join('\n')
    writeFileSync(join(skills(), skill, 'SKILL.md'), `---\nname: ${skill}\ndescription: d\n---\n${body}\n`)
  }

  function check(args: string[], env: Record<string, string> = {}) {
    const r = spawnSync('bash', [SCRIPT, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: tmpHome, ...env },
    })
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 }
  }

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'skill-check-'))
    write('sajat-skill', 40)
    write('masik-skill', 40)
  })
  afterEach(() => rmSync(tmpHome, { recursive: true, force: true }))

  it('a hatar alatti sajat fajlrol SZAMOT ad, nem csendet', () => {
    // Broadcastban ez csend (helyesen: 55 skillrol nem kell jelenteni). Check modban a csend
    // nem valasz -- a szerzo azert futtatta, hogy megtudja, mennyi maradt.
    const r = check(['--check', 'sajat-skill'])
    expect(r.code).toBe(0)
    expect(r.stderr).toMatch(/sajat-skill\s+40 sor \/ \d+ karakter \(hatar 500 -- 460 sor maradt\)/)
  })

  it('CSAK a kert skillt meri -- a masik fajl tullepese nem az o dolga', () => {
    // Ez a lelet magva: broadcastban a masik skill tullepese MINDENKIT terhel.
    write('masik-skill', 520)
    const r = check(['--check', 'sajat-skill'])
    expect(r.code).toBe(0)
    expect(r.stderr).not.toMatch(/masik-skill/)
    expect(r.stdout).not.toMatch(/masik-skill/)
    // KONTROLL, hogy a fixture tenyleg tullepo: broadcastban ugyanez a fa PANASZKODIK
    const b = check([])
    expect(b.code).toBe(3)
    expect(b.stderr).toMatch(/masik-skill/)
  })

  it('a sajat fajl tullepese 3-mal ter vissza, es a szoveg stderr-en van', () => {
    write('sajat-skill', 520)
    const r = check(['--check', 'sajat-skill'])
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/sajat-skill/)
  })

  it('ALAPVONALAS skillnel a KARAKTER-kapu is 3-mal bukik -- broadcastban ez 0 volt', () => {
    // A mod egyetlen celja, hogy egy `&&` lanc ele lehessen tenni. Broadcastban a
    // karakter-figyelmeztetes stdoutra megy es 0-t ad (kartya 83cac1ed) -- ott ez didi
    // kerdese; itt a 3 a szerzodés.
    write('alapvonalas', 100, ' '.repeat(200))
    const env = { SKILL_BASELINE_NAMES: 'alapvonalas', SKILL_BASELINE_LINES: '95', SKILL_BASELINE_CHARS: '1000' }
    const r = check(['--check', 'alapvonalas'], env)
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/A KARAKTER-KERET ELFOGYOTT/)
    // NEGATIV KONTROLL: ugyanaz a fajl, tagas karakter-alapvonallal -> 0 es nincs panasz
    const ok = check(['--check', 'alapvonalas'], { ...env, SKILL_BASELINE_CHARS: '30000' })
    expect(ok.code).toBe(0)
    expect(ok.stderr).not.toMatch(/ELFOGYOTT/)
  })

  it('a KARAKTER-alapvonal a SAJAT skille, nem az ELSO-e (a par egyben marad)', () => {
    // MERT DEFEKTUS, 2026-09-12: a `SKILL_BASELINE_LINES` mar pozicionalis lista volt, a
    // `SKILL_BASELINE_CHARS` viszont EGYETLEN ertek. Egy MASODIK alapvonalas skill igy az
    // ELSO karakter-alapvonalahoz mert volna -- a script sajat kikotese ellenere ("a baseline
    // PAR: a ket szam UGYANABBOL a fajl-allapotbol valo"). A kar NEM hibauzenet: egy idegen,
    // nagyobb nevezo mellett a keret CSENDBEN tagul.
    write('elso',    100, ' '.repeat(200))   // 100 sor, ~200 kar/sor
    write('masodik', 100, ' '.repeat(200))
    const env = {
      SKILL_BASELINE_NAMES: 'elso masodik',
      SKILL_BASELINE_LINES: '95 95',
      // az ELSO tagas, a MASODIK szuk -> ha a masodik az ELSOT hasznalja, NEM bukik
      SKILL_BASELINE_CHARS: '30000 1000',
    }
    const r = check(['--check', 'masodik'], env)
    expect(r.code).toBe(3)
    expect(r.stderr).toMatch(/A KARAKTER-KERET ELFOGYOTT/)

    // NEGATIV KONTROLL, ES EZ A LENYEG: ugyanez az ELSO skillre NEM bukik, mert AZ tagas.
    // Ha a kiolvaso megint "mindig az elso"-t adna, ez a ket allitas EGYUTT nem allhatna fenn.
    const ok = check(['--check', 'elso'], env)
    expect(ok.code).toBe(0)
    expect(ok.stderr).not.toMatch(/ELFOGYOTT/)

    // ES A SORREND SEM VELETLEN: megforditva a ket szamot, a verdikt is megfordul.
    const swapped = { ...env, SKILL_BASELINE_CHARS: '1000 30000' }
    expect(check(['--check', 'elso'], swapped).code).toBe(3)
    expect(check(['--check', 'masodik'], swapped).code).toBe(0)

    // ES UGYANEZ A SOR-ALAPVONALRA. Ez a fele MAR pozicionalis volt, de SENKI nem allitotta:
    // egy mutacio, ami a sor-kiolvasot "mindig az elso"-re allitja, a fenti allitasokon
    // TULELT (merve 2026-09-12). Ket KULONBOZO, de mindketto TAGAS alapvonal, hogy a
    // kapu ne tuzeljen -- igy a lagy sor MEGNEVEZI a part, es a par az, amit allitunk.
    const pairEnv = {
      SKILL_BASELINE_NAMES: 'elso masodik',
      SKILL_BASELINE_LINES: '98 96',
      SKILL_BASELINE_CHARS: '30000 30000',
    }
    const e = check(['--check', 'elso'], pairEnv)
    const m = check(['--check', 'masodik'], pairEnv)
    expect(e.code).toBe(0)
    expect(m.code).toBe(0)
    expect(e.stdout + e.stderr).toMatch(/alapvonal 98\/30000/)
    expect(m.stdout + m.stderr).toMatch(/alapvonal 96\/30000/)
    // KONTROLL, hogy a minta nem vak: a MASIK skill szama NE alljon ott
    expect(m.stdout + m.stderr).not.toMatch(/alapvonal 98\//)
  })

  it('check modban NEM allitja, hogy "minden skill a hatara alatt" -- egyet nezett meg', () => {
    // Egy ures populacio, ami tiszta bizonyitvanynak olvasodik, pontosan az az alak, ami
    // ellen ez az or keszult.
    const r = check(['--check', 'sajat-skill', '-v'])
    expect(r.stdout + r.stderr).not.toMatch(/minden skill a sajat hatara alatt/)
    // KONTROLL: broadcastban ugyanez a mondat MEGJELENIK
    const b = check(['-v'])
    expect(b.stdout + b.stderr).toMatch(/minden skill a sajat hatara alatt/)
  })

  it('check modban nincs "N skill lepte tul" fejlec ures lista folott', () => {
    write('sajat-skill', 520)
    const r = check(['--check', 'sajat-skill'])
    expect(r.stderr).not.toMatch(/skill lepte tul a hatarat/)
  })

  it('ismeretlen skill 66, hianyzo nev 64 -- ugyanaz a szerzodés, mint az `--outline`-nal', () => {
    expect(check(['--check', 'nincs-ilyen']).code).toBe(66)
    expect(check(['--check']).code).toBe(64)
  })

  // A 38221eef javitas az ALAPVONALAS agra landolt, es ez a TESTVER-SOR bajtot szamolt
  // tovabb, "karakter" cimke alatt (megtalalva 2026-08-29). Magyar prozan 5,8-7,9% tulmeres
  // ket valodi skillen merve -- es epp ezen az uton latja a SZERZO a sajat fajljanak a szamat.
  // A tanulsag nem a sor volt, hanem hogy a javitas utan nem futtattam ujra az EREDETI
  // detektort a teljes fajlon; egy testver-elofordulas igy elte tul a javitast.
  it('a --check szam KARAKTER, nem BAJT -- ekezetes fixture-rel merve', () => {
    // A fixture-nek TOBB bajtja kell legyen, mint karaktere, kulonben a ket egyseg EGYBEESIK
    // es a teszt egy bajt-szamlalon is zold lenne. Ez a kontroll, nem dekoracio.
    mkdirSync(join(skills(), 'ekezetes'), { recursive: true })
    const BODY = '---\nname: ekezetes\ndescription: d\n---\narvizturo tukorfurogep: ÁÉÍÓŐÚŰ öüó ééé\n'
    writeFileSync(join(skills(), 'ekezetes', 'SKILL.md'), BODY)
    const bytes = Buffer.byteLength(BODY, 'utf8')
    const chars = [...BODY].length
    expect(chars, 'a fixture nem tobb-bajtos -- a proba vak lenne').toBeLessThan(bytes)

    const r = check(['--check', 'ekezetes'])
    expect(r.code).toBe(0)
    const m = r.stderr.match(/ekezetes\s+\d+ sor \/ (\d+) karakter/)
    expect(m, `nem talaltam a szamot: ${r.stderr}`).not.toBeNull()
    expect(Number(m![1])).toBe(chars)
    expect(Number(m![1])).not.toBe(bytes)
  })

  it('a BROADCAST viselkedese valtozatlan (regresszio)', () => {
    write('masik-skill', 520)
    const b = check([])
    expect(b.code).toBe(3)
    expect(b.stderr).toMatch(/1 skill lepte tul a hatarat/)

  })
})

// A MERET-OR EGYSEGE: KARAKTER, ES LOCALE-FUGGETLENUL -- kartya 38221eef, jarvis merese.
//
// A cimke "karakter"-t mondott, a mero `wc -c`-t hasznalt, ami BAJT. A kezenfekvo csere
// `wc -m`-re UGYANEZT a hibat hozta volna vissza, csak rejtve: a `wc -m` LOCALE-FUGGO, es
// `LC_ALL=C` alatt BAJTOT ad. Merve ugyanazon a fajlon: wc -c 35165 | wc -m C 35165 |
// wc -m UTF-8 32582 | python3 32582.
//
// ES AMIERT EZ NEM ELMELETI: a `com.marveen.dashboard.plist` EnvironmentVariables-e CSAK HOME
// es PATH -- locale NINCS. Locale nelkul az LC_CTYPE alapertelmezese `C`, tehat a `wc -m`
// BAJTOT szamolt volna EPP OTT, AHOL AZ OR FUT, mikozben a fejleszto shelljeben helyesnek
// latszik. Kezzel tesztelve jo, elesben rossz.
describe('skill-index.sh -- a karakter-szam LOCALE-FUGGETLEN (38221eef)', () => {
  function charCountUnder(locale: string, home: string): number | null {
    const r = spawnSync('bash', [SCRIPT], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, LC_ALL: locale, SKILL_BASELINE_NAMES: 'egy-skill', SKILL_BASELINE_LINES: '1', SKILL_BASELINE_CHARS: '1' },
    })
    const m = ((r.stdout ?? '') + (r.stderr ?? '')).match(/egy-skill\s+\d+ sor \/ (\d+) karakter/)
    return m ? Number(m[1]) : null
  }

  it('ugyanazt a szamot adja `LC_ALL=C` es UTF-8 alatt -- ez a kartya elfogadasi probaja', () => {
    const home = mkdtempSync(join(tmpdir(), 'skill-charcount-'))
    mkdirSync(join(home, '.claude', 'skills', 'egy-skill'), { recursive: true })
    // TENYLEG EKEZETES tartalom. Az elso valtozatom ASCII-t irt ide ("arvizturo"), es ezzel a
    // ket egyseg EGYBEESETT -- a teszt zold volt a `wc -c`-vel ES a locale-fuggo `wc -m`-mel is,
    // tehat SEMMIT nem mert. A sajat komment figyelmeztetett ra, es en irtam ala a fixture-t.
    const BODY = '---\nname: egy-skill\ndescription: árvíztűrő tükörfúrógép\n---\nÁÉÍÓŐÚŰ öüó ééé\n'
    writeFileSync(join(home, '.claude', 'skills', 'egy-skill', 'SKILL.md'), BODY)
    const c = charCountUnder('C', home)
    const utf8 = charCountUnder('en_US.UTF-8', home)
    rmSync(home, { recursive: true, force: true })

    expect(c, 'C locale alatt nem sikerult kiolvasni a szamot').not.toBeNull()
    expect(utf8).not.toBeNull()
    expect(c).toBe(utf8)
    // ES A KONTROLL, ami nelkul a fenti egyenloseg semmit nem allit: a fixture-nek TENYLEG
    // KEVESEBB karaktere van, mint bajtja. Ha ez a ketto egybeesne (ASCII fixture), akkor egy
    // bajt-szamlalo ES a locale-fuggo `wc -m` is atmenne a fenti egyenlosegen.
    const bytes = Buffer.byteLength(BODY, 'utf8')
    const chars = [...BODY].length
    expect(chars, 'a fixture nem tartalmaz tobb-bajtos karaktert -- a proba vak lenne').toBeLessThan(bytes)
    expect(c).toBe(chars)
  })
})

// --- LAGY KUSZOB: korai jelzes, ami NEM buktat (kartya 2dce876b) ---------------
//
// A BUKAS ALAKJA, amiert ez az ag letezik: a sor-kapu akkor tuzel, ha valaki TULLEPI
// az 500-at. Aki a kapu kozeleben akarna irni, nem lepi tul -- KIHAGYJA a beirast, es
// akkor nincs piros, nincs `exit 3`, a lecke nem kerul be. Hat skill csuszott 490+
// sorra anelkul, hogy barmi szolt volna.
//
// AMIT EZEK PINNELNEK, es miert ezek: a jelzes LEGYEN MEG broadcastban (ez volt a nema
// ag), NE valtoztassa a kilepesi kodot (marveen kimondott politikaja: a bontas nyugodt
// korben tortenjen, egy buktato korai jelzes epp azt a kort torne meg), es NE TUNJON EL,
// amikor valami sulyosabb is igaz -- a korai jelzes nem versenyezhet a kesoivel ugyanazert
// a helyert.

function runWithStderr(args: string[], env: Record<string, string>) {
  const p = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
  return { stdout: p.stdout ?? '', stderr: p.stderr ?? '', exitCode: p.status ?? 1 }
}

function makeSkillOfLines(home: string, name: string, lines: number): void {
  mkdirSync(join(home, '.claude', 'skills', name), { recursive: true })
  const head = `---\nname: ${name}\ndescription: ${name} description\n---\n`   // 4 lines
  const body = Array.from({ length: Math.max(0, lines - 4) }, (_, i) => `line ${i}`).join('\n')
  writeFileSync(join(home, '.claude', 'skills', name, 'SKILL.md'), head + body + '\n')
}

describe('skill-index.sh -- soft threshold (early warning)', () => {
  let tmpHome: string
  const ENV = { SKILL_LINE_LIMIT: '100', SKILL_SOFT_HEADROOM: '20' }

  beforeEach(() => { tmpHome = mkdtempSync(join(tmpdir(), 'skill-soft-')) })
  afterEach(() => rmSync(tmpHome, { recursive: true, force: true }))

  it('reports a skill above the soft threshold in BROADCAST mode -- the branch that was silent', () => {
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    const r = runWithStderr([], { HOME: tmpHome, ...ENV })
    expect(r.stderr).toContain('KORAI JELZES')
    expect(r.stderr).toContain('nearly-full')
    expect(r.stderr).toMatch(/a SAJAT kapujaig \(100\) 10 sor/)
  })

  it('does NOT change the exit code -- it reports, it does not fail', () => {
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    expect(runWithStderr([], { HOME: tmpHome, ...ENV }).exitCode).toBe(0)
  })

  it('stays silent for a skill below the threshold -- the meter discriminates', () => {
    makeSkillOfLines(tmpHome, 'small-one', 40)
    const r = runWithStderr([], { HOME: tmpHome, ...ENV })
    expect(r.stderr).not.toContain('KORAI JELZES')
    expect(r.exitCode).toBe(0)
  })

  it('a skill OVER the gate still exits 3 and is not also counted as approaching', () => {
    makeSkillOfLines(tmpHome, 'over-gate', 120)
    const r = runWithStderr([], { HOME: tmpHome, ...ENV })
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain('lepte tul')
    expect(r.stderr).not.toMatch(/KORAI JELZES.*over-gate/s)
  })

  it('still reports the approaching skill when ANOTHER skill is over the gate', () => {
    // The design point: the soft block is NOT an arm of the summary if/elif chain. Put it
    // there and the early warning vanishes exactly when the tree is already moving -- which
    // is when it is most needed.
    makeSkillOfLines(tmpHome, 'over-gate', 120)
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    const r = runWithStderr([], { HOME: tmpHome, ...ENV })
    expect(r.exitCode).toBe(3)
    expect(r.stderr).toContain('lepte tul')
    expect(r.stderr).toContain('KORAI JELZES')
    expect(r.stderr).toContain('nearly-full')
  })

  it('omits the "N skill" header in --check mode -- one measurement cannot claim a population', () => {
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    const r = runWithStderr(['--check', 'nearly-full'], { HOME: tmpHome, ...ENV })
    expect(r.stderr).not.toContain('KORAI JELZES')
  })

  it('the summary sentence carries the count, so it cannot read as "nothing to see"', () => {
    // "every skill is under its limit" stays TRUE while six skills sit eight lines from the
    // gate. The quotable sentence has to carry the number with it.
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    const r = runWithStderr(['-v'], { HOME: tmpHome, ...ENV })
    expect(r.stdout + r.stderr).toMatch(/minden skill a sajat hatara alatt.*DE 1 skill/s)
  })

  it('the positive control FAILS LOUDLY if the soft branch could never fire', () => {
    // The easiest silent break in the whole guard: a headroom of zero (nothing can ever be
    // inside it) or one that swallows the whole gate -- output byte-identical to "nothing is
    // approaching".
    makeSkillOfLines(tmpHome, 'nearly-full', 90)
    for (const hr of ['0', '100', '150']) {
      const r = runWithStderr([], { HOME: tmpHome, SKILL_LINE_LIMIT: '100', SKILL_SOFT_HEADROOM: hr })
      expect(r.stderr, `headroom=${hr} must be rejected`).toContain('pozitiv kontroll ELBUKOTT')
    }
    const ok = runWithStderr([], { HOME: tmpHome, ...ENV })
    expect(ok.stderr).not.toContain('pozitiv kontroll ELBUKOTT')
  })

  // --- the two regimes (didi, 2026-09-11) ---------------------------------------
  //
  // The tree has TWO gates: a baselined skill's real gate is baseline+growth, everything
  // else is SKILL_LINE_LIMIT. The first cut measured a raw line count against one absolute
  // number and reported distance to the global gate -- so the skill with the SMALLEST
  // headroom in the whole population fell off the list, because its gate is lower. Worse,
  // the check sat in the `else` arm after `if [ -n "$base" ]`, so a baselined skill never
  // reached it AT ALL, at any threshold.

  const BASELINE_ENV = {
    SKILL_LINE_LIMIT: '500', SKILL_SOFT_HEADROOM: '40',
    SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: '200', SKILL_GROWTH_LIMIT: '15',
  }

  it('a baselined skill at its OWN gate is listed, though far below the global one', () => {
    // gate = 200 + 15 = 215. At 215 lines the headroom is 0, while the global gate is 500.
    makeSkillOfLines(tmpHome, 'pinned', 215)
    const r = runWithStderr([], { HOME: tmpHome, ...BASELINE_ENV })
    expect(r.stderr).toContain('KORAI JELZES')
    expect(r.stderr).toMatch(/pinned.*a SAJAT kapujaig \(215\) 0 sor/)
  })

  it('the distance is reported from the skill OWN gate, not the global limit', () => {
    makeSkillOfLines(tmpHome, 'pinned', 210)        // 5 lines from 215, 290 from 500
    const r = runWithStderr([], { HOME: tmpHome, ...BASELINE_ENV })
    expect(r.stderr).toMatch(/pinned.*\(215\) 5 sor/)
    expect(r.stderr).not.toMatch(/pinned.*290/)
  })

  it('a baselined skill with room is NOT listed -- the meter discriminates', () => {
    makeSkillOfLines(tmpHome, 'pinned', 150)        // 65 lines of headroom
    const r = runWithStderr([], { HOME: tmpHome, ...BASELINE_ENV })
    expect(r.stderr).not.toContain('KORAI JELZES')
  })

  it('a skill already PAST its own gate is not also reported as approaching', () => {
    // It is over: the hard branch fires rc=3. Listing it as "approaching" too would put two
    // contradictory statements about the same skill in one run.
    makeSkillOfLines(tmpHome, 'pinned', 230)        // past 215
    const r = runWithStderr([], { HOME: tmpHome, ...BASELINE_ENV })
    expect(r.exitCode).toBe(3)
    expect(r.stderr).not.toMatch(/KORAI JELZES[\s\S]*pinned/)
  })

  it('the hard ceiling still binds when baseline+growth would exceed it', () => {
    // With today's constants (420+15 vs 600) this clamp never binds, so nothing exercised
    // it -- a mutation removing it survived. It is not dead code: it encodes "the hard limit
    // always wins", and an untested invariant is one refactor from being dropped.
    makeSkillOfLines(tmpHome, 'pinned', 295)
    const r = runWithStderr([], {
      HOME: tmpHome, SKILL_LINE_LIMIT: '500', SKILL_SOFT_HEADROOM: '20',
      SKILL_BASELINE_NAMES: 'pinned', SKILL_BASELINE_LINES: '290', SKILL_GROWTH_LIMIT: '50',
      SKILL_HARD_LIMIT: '300',                       // 290+50 = 340, clamped to 300
    })
    expect(r.stderr).toMatch(/pinned.*a SAJAT kapujaig \(300\) 5 sor/)
    expect(r.stderr).not.toMatch(/pinned.*\(340\)/)
  })

  it('the list is ordered by REMAINING headroom, tightest first', () => {
    // The decision-time artefact has to carry the discriminator: in glob order the
    // zero-headroom skill landed at the BOTTOM.
    makeSkillOfLines(tmpHome, 'aaa-roomy', 470)     // 30 left
    makeSkillOfLines(tmpHome, 'zzz-tight', 499)     //  1 left
    const r = runWithStderr([], { HOME: tmpHome, SKILL_LINE_LIMIT: '500', SKILL_SOFT_HEADROOM: '40' })
    const block = r.stderr.slice(r.stderr.indexOf('KORAI JELZES'))
    expect(block.indexOf('zzz-tight')).toBeLessThan(block.indexOf('aaa-roomy'))
  })
})
