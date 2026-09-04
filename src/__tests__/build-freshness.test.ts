/**
 * THE SOURCE IS NOT EVIDENCE -- card b807c756.
 *
 * On 2026-08-20 three people read the same source file and all three believed
 * it was running. The dashboard runs from `dist/`, that build was four days
 * old, and a fix written that morning had never executed. Nothing anywhere
 * compared the two.
 *
 * The tests below hold the three things the card asked for: ONE verdict rather
 * than one per file, BOTH ways of being stale, and -- the one that came out of
 * the evening itself -- that an unanswerable question is answered with "I do
 * not know" instead of with silence, because a missing value that looks like a
 * healthy one does not just fail to warn, it CLOSES the question.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { judgeBuildFreshness, judgeLocalOnly, newestMtime, isTestDir } from '../web/build-freshness.js'

const T = (h: number) => new Date(`2026-08-20T${String(h).padStart(2, '0')}:00:00Z`).getTime()

const input = (over: Partial<Parameters<typeof judgeBuildFreshness>[0]> = {}) => ({
  builtAt: T(10),
  sourceAt: T(9),
  newestSourceFile: 'src/db.ts',
  startedAt: T(11),
  ...over,
})

describe('judgeBuildFreshness', () => {
  it('is current when the build is newer than the source and older than the process', () => {
    expect(judgeBuildFreshness(input()).status).toBe('current')
  })

  describe('the source is newer than the build', () => {
    it('is stale-source: what you are reading is not what runs', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.status).toBe('stale-source')
    })

    it('says HOW MANY files are newer, not just which one is newest', () => {
      // The example alone was not enough, and the live case proved it: the
      // newest file there is a TEST, and a reader seeing only that concludes
      // "just a test changed". The count is what separates a stray touch from
      // four days of drift -- and it is still one line.
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newerSourceCount: 43 }))
      expect(v.detail).toContain('43 fajl ujabb')
      expect(v.detail.split('\n')).toHaveLength(1)
    })

    it('leaves the count out rather than printing a made-up zero', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).not.toContain('fajl ujabb')
      expect(v.newerSourceCount).toBeNull()
    })

    it('still reads as a sentence when there is no count to give', () => {
      // The first version glued the example on with a lowercase clause after a
      // full stop. A warning that reads as broken gets treated as broken.
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).toContain('A legfrissebb valtozas: src/db.ts.')
      expect(v.detail).not.toContain('. a legfrissebb')
    })

    it('names ONE example file, not every file that is newer', () => {
      // A stale build means hundreds of newer files. A hundred warnings is a
      // wall people learn to scroll past, so the verdict is one line and the
      // newest file is an example that tells the reader whether the difference
      // is a real change or a stray touch.
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newestSourceFile: 'src/web/routes/messages.ts' }))
      expect(v.detail).toContain('src/web/routes/messages.ts')
      expect(v.detail.split('\n')).toHaveLength(1)
    })

    it('says what to do, and that a build alone is not enough', () => {
      const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
      expect(v.detail).toContain('npm run build')
      expect(v.detail).toContain('ujrainditas')
    })

    it('survives having no example file to name', () => {
      const v = judgeBuildFreshness(
        input({ builtAt: T(9), sourceAt: T(10), newestSourceFile: null }))
      expect(v.status).toBe('stale-source')
      expect(v.detail).not.toContain('null')
    })
  })

  describe('the build is newer than the running process', () => {
    it('is stale-process: compiled, and still not running', () => {
      // The half that springs on the person who DID remember to build. The
      // process read dist/ once, at start, and holds the old code in memory.
      const v = judgeBuildFreshness(input({ sourceAt: T(9), builtAt: T(11), startedAt: T(10) }))
      expect(v.status).toBe('stale-process')
      expect(v.detail).toContain('ujrainditas')
    })

    it('does NOT ask for another build, which is not what is missing', () => {
      const v = judgeBuildFreshness(input({ sourceAt: T(9), builtAt: T(11), startedAt: T(10) }))
      expect(v.detail).not.toContain('npm run build')
    })

    it('reports the source problem first when both are true', () => {
      // Uncompiled AND unrestarted: the build has to happen before the restart
      // can carry anything, so that is the instruction to give.
      const v = judgeBuildFreshness(input({ sourceAt: T(12), builtAt: T(11), startedAt: T(10) }))
      expect(v.status).toBe('stale-source')
    })
  })

  describe('when it cannot tell', () => {
    it('says unknown -- never current -- with no build timestamp', () => {
      // THE LESSON OF THE EVENING, as a branch. A missing value that renders
      // identically to a healthy one is worse than no check: it also ends the
      // question, and nobody comes back to it.
      const v = judgeBuildFreshness(input({ builtAt: null }))
      expect(v.status).toBe('unknown')
      expect(v.status).not.toBe('current')
    })

    it('says unknown with no source timestamp either', () => {
      expect(judgeBuildFreshness(input({ sourceAt: null })).status).toBe('unknown')
    })

    it('spells out that unknown is NOT the same as up to date', () => {
      // Without this sentence a reader fills the gap with the comfortable
      // reading, which is exactly how four days went by.
      const v = judgeBuildFreshness(input({ builtAt: null }))
      expect(v.detail).toContain('NEM azt jelenti')
    })

    it('does not invent a verdict from the one timestamp it does have', () => {
      // A source newer than nothing is not "stale"; it is unmeasured.
      const v = judgeBuildFreshness(input({ builtAt: null, sourceAt: T(23) }))
      expect(v.status).toBe('unknown')
    })
  })

  it('always carries the raw numbers, so a reader can check the verdict', () => {
    // A verdict nobody can audit is a verdict people either trust blindly or
    // ignore. Both are worse than one they can subtract for themselves.
    const v = judgeBuildFreshness(input({ builtAt: T(9), sourceAt: T(10) }))
    expect(v.builtAt).toBe(T(9))
    expect(v.sourceAt).toBe(T(10))
    expect(v.startedAt).toBe(T(11))
  })
})

/**
 * THE SECOND QUESTION -- card b807c756, and the reason it needs its own answer.
 *
 * The build check compares the running process with the LOCAL source. On the
 * night this card was written a second thing was also true and that check
 * could not see it: the feature existed in two commits that no remote branch
 * contained. Against the local source the verdict would have been `current`,
 * and correct. A rebuild would have made it run HERE and nowhere else -- a
 * fresh install, or an `update.sh` pull, would not have the code at all.
 *
 * Same symptom, two causes, and the remedy for one does nothing for the other.
 */
describe('judgeLocalOnly', () => {
  const NOW = new Date('2026-08-20T22:00:00Z').getTime()
  const HOUR = 3600_000

  const args = (over: Partial<Parameters<typeof judgeLocalOnly>[0]> = {}) => ({
    commits: 0,
    branch: 'develop',
    fetchedAt: NOW - HOUR,
    now: NOW,
    ...over,
  })

  it('says nothing when everything is on a remote somewhere', () => {
    // A banner that fires on the normal state is a banner people hide.
    expect(judgeLocalOnly(args()).detail).toBeNull()
  })

  it('names the count and the branch when commits exist only here', () => {
    const { detail } = judgeLocalOnly(args({ commits: 2, branch: 'feat/x' }))
    expect(detail).toContain('2 commit')
    expect(detail).toContain('feat/x')
  })

  it('says a rebuild does NOT fix this, which is the whole distinction', () => {
    // Without this sentence the reader applies the other card's remedy and
    // believes the problem is solved.
    const { detail } = judgeLocalOnly(args({ commits: 2 }))
    expect(detail).toContain('Ujraepites ezen NEM segit')
  })

  it('warns that the count can only be too HIGH when the refs are stale', () => {
    // The asymmetry is the reason the number is still usable: a commit that
    // really is unpushed can never be missed, only a pushed one over-counted.
    const { detail } = judgeLocalOnly(args({ commits: 2, fetchedAt: NOW - 72 * HOUR }))
    expect(detail).toContain('felfele torzithat')
  })

  it('does not add the caveat when the refs are fresh', () => {
    const { detail } = judgeLocalOnly(args({ commits: 2, fetchedAt: NOW - HOUR }))
    expect(detail).not.toContain('felfele torzithat')
  })

  it('treats never-fetched as stale rather than as fresh', () => {
    const { detail } = judgeLocalOnly(args({ commits: 2, fetchedAt: null }))
    expect(detail).toContain('felfele torzithat')
  })

  it('says "could not tell" -- never "all clear" -- when git could not answer', () => {
    // The neighbouring git helpers in this codebase fall back to 'main' on
    // failure. Here the equivalent guess would claim everything is pushed,
    // which is exactly the claim we do not have.
    const { detail } = judgeLocalOnly(args({ commits: null }))
    expect(detail).toContain('Nem tudni')
    expect(detail).toContain('NEM azt jelenti')
  })

  it('carries the raw numbers so the verdict can be checked', () => {
    const v = judgeLocalOnly(args({ commits: 3, branch: 'develop' }))
    expect(v.commits).toBe(3)
    expect(v.branch).toBe('develop')
  })
})

/**
 * A `__tests__` KIZARASA A FRISSESSEG-MEROBOL -- kartya 390532b0.
 *
 * A mero MTIME-VISZONYT mer, tehat szerkezetileg nem tudja megkulonboztetni:
 *     "a futo kod le van maradva"        <- VALODI, ujrainditast er
 *     "egy teszt-fajl nincs leforditva"  <- a futo szolgaltatas SOHA nem tolt be
 *                                           `__tests__` modult
 * marveen merte 2026-09-04-en: ket teszt-fajl commitolasa `stale-source`-t adott, build utan
 * `stale-process`-t. Aznap EGYSZER mar ment VALODI ujrainditasi keres Istihez ezen a jelzesen --
 * egy jelzes, ami teszt-fajlra is tuzel, elkopik, es a kovetkezo valodit is vallrandítas fogadja.
 *
 * A KONTROLL (a masodik eset) a lenyeg: `skipDir` NELKUL ugyanaz a fa BEVESZI a teszt-fajlt.
 * Enelkul mind a tobbi allitas igaz lenne egy olyan bejarora is, ami soha nem lat semmit.
 */
describe('newestMtime: a __tests__ kizarasa', () => {
  const made: string[] = []
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }) })

  /** Fa, ahol a LEGUJABB fajl szandekosan a `__tests__` alatt van. */
  function tree(): string {
    const d = mkdtempSync(join(tmpdir(), 'newest-mtime-'))
    made.push(d)
    mkdirSync(join(d, 'web'), { recursive: true })
    mkdirSync(join(d, '__tests__'), { recursive: true })
    writeFileSync(join(d, 'web', 'app.ts'), 'x')
    utimesSync(join(d, 'web', 'app.ts'), new Date(1_000_000), new Date(1_000_000))
    writeFileSync(join(d, '__tests__', 'spec.ts'), 'x')
    utimesSync(join(d, '__tests__', 'spec.ts'), new Date(9_000_000), new Date(9_000_000))
    return d
  }

  const ts = (n: string) => n.endsWith('.ts')
  const notTests = isTestDir

  it('a teszt-fajl NEM viszi fel a legujabb mtime-ot', () => {
    const r = newestMtime(tree(), ts, notTests)
    expect(r?.file).toBe('web/app.ts')
    expect(r?.at).toBe(1_000_000)
  })

  it('KONTROLL: kizaras NELKUL ugyanaz a fa a teszt-fajlt adja', () => {
    const r = newestMtime(tree(), ts)
    expect(r?.file).toBe('__tests__/spec.ts')
  })

  it('a kizart fajlok az `all` tombbol is kimaradnak (a newerSourceCount ebbol szamol)', () => {
    expect(newestMtime(tree(), ts, notTests)?.all).toHaveLength(1)
    expect(newestMtime(tree(), ts)?.all).toHaveLength(2)
  })

  /**
   * A BEKOTES, ES NEM A FUGGVENY -- ez a resz MERESBOL kerult ide, nem elovigyazatossagbol.
   *
   * A fenti esetek a BEJAROT merik, es zoldek maradnak akkor is, ha a hivasi hely NEM adja at a
   * kizarast. Megmerve (mutacio, 2026-09-04): a `notTests` predikatumot `() => false`-ra cserelve
   * mind a 28 teszt ZOLD MARADT -- vagyis a defektus visszaterhetne ugy, hogy semmi nem szol.
   * Ezert allit ez a fajta MAGARA A HIVASRA. (A `getBuildFreshness` a valodi `PROJECT_ROOT`-ot
   * jarja be, ezert nem viselkedessel, hanem a forrason allitunk -- ugyanaz az alak, mint a
   * repo mas szerkezeti orjeinél.)
   */
  it('a getBuildFreshness MINDKET oldalon atadja a kizarast (bekotes, nem csak kepesseg)', () => {
    const src = readFileSync(new URL('../web/build-freshness.ts', import.meta.url), 'utf8')
    const body = src.slice(src.indexOf('export function getBuildFreshness'))
    // SORONKENT, nem `[^)]*`-gal: a hivas beagyazott `join(...)`-t tartalmaz, tehat egy
    // zarojelig tarto minta a `join(...)`-nal elvagna, es a talalat SOSEM tartalmazna a
    // harmadik argumentumot -- vagyis a teszt mindig bukna, barmit is csinal a kod.
    const calls = body.slice(0, body.indexOf('judgeBuildFreshness'))
      .split('\n').filter(l => l.includes('newestMtime('))
    expect(calls).toHaveLength(2)                      // a src/ es a dist/ oldal
    for (const c of calls) expect(c).toContain('isTestDir')
    // ES A VISELKEDESE, kulonben ez csak NEV-egyezes: egy `() => false`-ra irt predikatum
    // atmenne a fenti sztring-ellenorzesen. Merve -- az elso valtozatomat pont ez a
    // mutacio elte tul.
    expect(isTestDir('__tests__')).toBe(true)
    expect(isTestDir('web')).toBe(false)
  })

  it('a kizaras a NEVRE szol, nem az utvonalra: a mely __tests__ is kimarad', () => {
    const d = tree()
    mkdirSync(join(d, 'web', '__tests__'), { recursive: true })
    writeFileSync(join(d, 'web', '__tests__', 'deep.ts'), 'x')
    utimesSync(join(d, 'web', '__tests__', 'deep.ts'), new Date(8_000_000), new Date(8_000_000))
    expect(newestMtime(d, ts, notTests)?.file).toBe('web/app.ts')
  })
})
