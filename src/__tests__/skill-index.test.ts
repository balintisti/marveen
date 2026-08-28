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
    const pick = (name: string) => {
      const m = src.match(new RegExp(`${name}="\\$\\{${name}:-(\\d+)\\}"`))
      if (!m) throw new Error(`nem talalom a ${name} alapertelmezeset a szkriptben`)
      return m[1]
    }
    return { base: pick('SKILL_BASELINE_LINES'), limit: pick('SKILL_GROWTH_LIMIT'),
             hard: pick('SKILL_HARD_LIMIT') }
  }

  it('a MAI konstansokkal a kemeny ag SOSEM szolal meg -- barmilyen fajlmeretnel', () => {
    const { base, limit, hard } = prodConstants()
    // A dormancia feltetele: HARD < LIMIT + BASE. Ha ez egyszer megfordul, a
    // ciklus alatti allitas HAMIS lesz -- es akkor ennek a tesztnek KELL buknia.
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
