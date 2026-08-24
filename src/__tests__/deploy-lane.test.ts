import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A telepitesi sav megnevezese (kartya a1c5d6ca).
//
// EZ A RENDSZER KET (VALOJABAN HAROM) TELEPITESI MODELLT HASZNAL EGYSZERRE:
// a `src/` a `dist/`-en at megy es BUILDRE var, a `scripts/` es a `web/` viszont
// a MUNKAFABOL fut, tehat a beolvasztassal AZONNAL eles -- build nelkul,
// ujrainditas nelkul, ellenorzes nelkul. Egy `*.plist` meg ennel is tovabb van:
// kulon `launchctl` lepes kell hozza.
//
// MIERT SZERSZAM: a szabaly eddig dokumentacioban allt, EGY SZAMMAL ("nyolc
// dist/ modul hivja futasidoben a scripts/-et"). Ujramerve 2026-08-23-an a szam
// 18 (a `scripts/<fajl>.<kit>` mintara), a barmilyen emlitesre 22, es a
// nevesitett nyolc nevbol NEGYNEK nincs talalata a lefordított faban. A szam
// elavult es nem szolt rola. Egy parancs ujramer.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'deploy-lane.sh')

function classify(paths: string[]): Record<string, string> {
  const out = execFileSync('bash', [SCRIPT, '--classify'], { input: paths.join('\n'), encoding: 'utf-8' })
  const map: Record<string, string> = {}
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [lane, ...rest] = line.split('|')
    map[rest.join('|')] = lane
  }
  return map
}

describe('deploy-lane -- a besorolas', () => {
  it('a harom sav es a semleges elkulonul', () => {
    const m = classify([
      'scripts/agent-msg.sh', 'web/app.js', 'update.sh',
      'src/idle-agent.ts', 'src/web/routes/messages.ts',
      'com.marveen.idle-reporter.plist',
      'CLAUDE.md', 'seed-skills/handoff/SKILL.md',
    ])
    expect(m['scripts/agent-msg.sh']).toBe('INSTANT')
    expect(m['web/app.js']).toBe('INSTANT')
    expect(m['update.sh']).toBe('INSTANT')
    expect(m['src/idle-agent.ts']).toBe('BUILD')
    expect(m['src/web/routes/messages.ts']).toBe('BUILD')
    expect(m['com.marveen.idle-reporter.plist']).toBe('INSTALL')
    expect(m['CLAUDE.md']).toBe('NEUTRAL')
    expect(m['seed-skills/handoff/SKILL.md']).toBe('NEUTRAL')
  })

  it('a teszt-fajl NEM BUILD, pedig a src/ alatt van', () => {
    // Kulon allitas, mert a `src/*` szabaly elnyelne. Egy teszt nem fut a
    // szolgaltatasban, tehat BUILD-kent jelentve minden teszt-only agrol azt
    // mondanank, hogy telepitesre var -- es a kovetkezo olvaso ezt a jelzest
    // fogja zajnak venni.
    expect(classify(['src/__tests__/idle-agent.test.ts'])['src/__tests__/idle-agent.test.ts']).toBe('NEUTRAL')
  })

  it('a `web/` INSTANT, mert a futo szolgaltatas a MUNKAFABOL szolgalja ki', () => {
    // src/web.ts: WEB_DIR = join(PROJECT_ROOT, 'web'), es a PROJECT_ROOT a
    // dist/-bol `join(__dirname, "..")` -- vagyis a munkafa gyokere, nem a dist.
    expect(classify(['web/app.js'])['web/app.js']).toBe('INSTANT')
  })
})

describe('deploy-lane -- az allapot, egy szintetikus telepitesi fan', () => {
  let install: string
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()

  const run = (arg: string, root = install): string[] => {
    const out = execFileSync('bash', [SCRIPT, arg], {
      encoding: 'utf-8',
      cwd: install,
      env: { ...process.env, MARVEEN_INSTALL_ROOT: root },
    })
    return out.trim().split('\n').filter(Boolean)
  }
  const line = (lines: string[], key: string): string | undefined =>
    lines.find((l) => l.startsWith(`${key}|`))?.slice(key.length + 1)

  beforeEach(() => {
    install = mkdtempSync(join(tmpdir(), 'lane-'))
    git(install, 'init', '-q', '-b', 'main')
    git(install, 'config', 'user.email', 't@t')
    git(install, 'config', 'user.name', 't')
    mkdirSync(join(install, 'scripts'), { recursive: true })
    writeFileSync(join(install, 'scripts', 'a.sh'), 'echo a\n')
    git(install, 'add', '-A')
    git(install, 'commit', '-qm', 'base')
  })
  afterEach(() => rmSync(install, { recursive: true, force: true }))

  it('egy MAR BEOLVASZTOTT ag INSTANT valtozasa: AZONNAL HAT', () => {
    // A valodi kerdes, amire ez a szerszam valaszol: "az en agam mar el?"
    // Ezert a ref egy AG, aminek a valtozasai mar bent vannak a telepiteseben.
    const base = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(install, 'scripts', 'a.sh'), 'echo b\n')
    git(install, 'commit', '-qam', 'scripts change')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    git(install, 'merge', '-q', '--no-edit', 'feature')
    // Egy ref, ami MAR benne van: a tartomany ilyenkor URES lenne (a kozos os maga
    // a ref). Egy ures lista ugy olvasodna, mintha az ag semmit nem hozott volna --
    // pont akkor hallgatna a szerszam, amikor a valasz "IGEN, mar el". Ezert a
    // tenyt mondja ki, a fajl-listahoz pedig explicit tartomanyt ker.
    const lines = run(feature)
    expect(lines.join(' ')).toMatch(/MAR BENNE VAN a telepitesi fa agaban/)
    expect(line(lines, 'ALLAPOT')).toMatch(/MAR AZONNAL HAT/)
    expect(lines.join(' ')).not.toMatch(/nulla valtozott fajl/)

    // Es explicit tartomannyal a fajl-lista is megvan, ugyanarra az agra.
    const explicit = run(`${base}..${feature}`)
    expect(explicit.some((l) => l === 'INSTANT|scripts/a.sh')).toBe(true)
  })

  it('egy MASIK agon levo INSTANT valtozas: a beolvasztas PILLANATABAN lesz eles', () => {
    git(install, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(install, 'scripts', 'b.sh'), 'echo b\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'new script')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    expect(line(run(feature), 'ALLAPOT')).toMatch(/NINCS a telepitesi fa agan -> a beolvasztas PILLANATABAN/)
  })

  it('BUILD sav: `.built-commit` nelkul NEM MERVE -- soha nem "kesz"', () => {
    git(install, 'checkout', '-q', '-b', 'feature')
    mkdirSync(join(install, 'src'), { recursive: true })
    writeFileSync(join(install, 'src', 'x.ts'), 'export const x = 1\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'src change')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    const l = run(feature).filter((x) => x.startsWith('ALLAPOT|')).join(' ')
    expect(l).toMatch(/BUILD: a dist\/\.built-commit nem olvashato -- NEM MERVE/)
    expect(l).not.toMatch(/-> HAT/)
  })

  it('BUILD sav: a futo build alapjahoz kepest mond BUILDRE VAR-t', () => {
    const base = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', '-b', 'feature')
    mkdirSync(join(install, 'src'), { recursive: true })
    writeFileSync(join(install, 'src', 'x.ts'), 'export const x = 1\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'src change')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    // A markert a VEGSO checkout UTAN irjuk: egy `git add -A` kulonben beveszi a
    // dist/-et a commitba, es a visszavaltas TORLI a fajlt -- a teszt ekkor a
    // "nem olvashato" agat merne, abban a hitben, hogy a kuszobot meri.
    mkdirSync(join(install, 'dist'), { recursive: true })
    writeFileSync(join(install, 'dist', '.built-commit'), base + '\n')
    expect(run(feature).filter((x) => x.startsWith('ALLAPOT|')).join(' ')).toMatch(/BUILD: BUILDRE VAR/)
  })

  it('REGRESSZIO: egy ref, ami MOGOTTE van a telepitesnek, NULLA valtozast hoz', () => {
    // A sajat hibam, merve 2026-08-23: az elso valtozat `INSTALL_HEAD..ref`-et
    // szamolt, tehat egy REGEBBI refre a TELEPITES sajat valtozasait listazta --
    // visszafele. A kerdesre ("mit hoz ez az ag?") magabiztosan az ellenkezojet
    // valaszolta. A javitas a kozos os (`merge-base`).
    const base = git(install, 'rev-parse', 'HEAD')
    writeFileSync(join(install, 'scripts', 'a.sh'), 'echo elore\n')
    git(install, 'commit', '-qam', 'install moves ahead')
    const lines = run(base)
    // A LENYEG: egyetlen fajl-sor sem keletkezik. A regi valtozat ITT irta ki a
    // TELEPITES sajat valtozasait, visszafele -- vagyis a `scripts/a.sh`-t ugy,
    // mintha ez az ag hozna. Ma a ref egy MAR BENNE LEVO allapot, es a szerszam
    // ezt mondja ki fajl-lista helyett.
    expect(lines.some((l) => l.startsWith('INSTANT|'))).toBe(false)
    expect(lines.join(' ')).toMatch(/MAR BENNE VAN a telepitesi fa agaban/)
    // Es a backtick-csapda regressziója: a kiirt szoveg tartalmazza a savneveket,
    // nem egy ures helyet, ahol a hej lefuttatta oket.
    expect(lines.join(' ')).toMatch(/scripts\/, web\/ vagy update\.sh/)
  })

  it('SZETAGAZO ag: a tartomany a KOZOS OSTOL megy, nem a telepitesi HEAD-tol', () => {
    // EZT A TESZTET A MUTACIO KENYSZERITETTE KI, es ez a resze a fontos: a
    // `merge-base` javitast visszaforditva a keszlet ZOLD MARADT (10/10), mert a
    // korabbi regresszios tesztem mar az "ancestor" korai again futott, tehat a
    // tartomany-szamitas EL SEM ERT. Egy javitas, amit semmi nem tart -- pontosan
    // az, amit a repo mashol "hazudo tesztnek" nevez.
    //
    // A valodi eset: a telepites is halad, az ag is. Ilyenkor a `INSTALL_HEAD..ref`
    // alak a telepites SAJAT fajljait is listazza, VISSZAFELE -- vagyis olyat allit
    // az agrol, amit az sosem ert.
    git(install, 'checkout', '-q', '-b', 'feature')
    writeFileSync(join(install, 'scripts', 'agam.sh'), 'echo agam\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'feature adds its own script')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    writeFileSync(join(install, 'scripts', 'telepitese.sh'), 'echo telepites\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'install moves on its own')

    const lines = run(feature)
    expect(lines.some((l) => l === 'INSTANT|scripts/agam.sh')).toBe(true)
    // A DONTO SOR: a telepites sajat fajlja NEM jelenhet meg az ag valtozasakent.
    expect(lines.some((l) => l.includes('telepitese.sh'))).toBe(false)
    expect(line(lines, 'INFO')).toMatch(/tartomany:/)
  })

  it('CSAK semleges fajlok: kimondja, hogy nincs telepitesi hatas -- nem hallgat', () => {
    // A csend itt ugyanaz a hiba, mint mindenhol: a "nincs allapot-sor" nem
    // kulonboztetheto meg attol, hogy a szerszam le sem futott. Merve a sajat
    // teszt-only againmon: ALLAPOT-sor nelkul jottek vissza, es a tablazatomban
    // "nulla valtozas"-kent latszottak -- pedig ket fajlt valtoztatnak.
    git(install, 'checkout', '-q', '-b', 'feature')
    mkdirSync(join(install, 'src', '__tests__'), { recursive: true })
    writeFileSync(join(install, 'src', '__tests__', 'a.test.ts'), 'export {}\n')
    writeFileSync(join(install, 'OLVASSEL.md'), '# doksi\n')
    git(install, 'add', '-A'); git(install, 'commit', '-qm', 'test-only')
    const feature = git(install, 'rev-parse', 'HEAD')
    git(install, 'checkout', '-q', 'main')
    const lines = run(feature)
    expect(line(lines, 'ALLAPOT')).toMatch(/NINCS TELEPITESI HATAS: mind a 2 valtozott fajl semleges/)
    expect(lines.some((l) => l.startsWith('INSTANT|') || l.startsWith('INSTALL|'))).toBe(false)
  })

  it('ISMERETLEN REF -> SKIP, nem "nulla valtozas" (didi lelete)', () => {
    // A hiba es a legitim ures eset kimenete AZONOS volt: egy elgepelt agnev ugyanazt a
    // mondatot adta ("nulla valtozott fajl"), mint egy valodi, semmit nem hozo ag. Es a lenti
    // REGRESSZIO-teszt epp azt a legitim esetet rogziti -- vagyis a keszlet MAGA dokumentalta
    // a ket kimenet azonossagat, csak nem nevezte meg.
    //
    // Ugyanez a fegyelem a hianyzo TELEPITESI FARA mar allt ebben a szkriptben. Az elv MASODIK
    // alkalmazasa kulon lepes, es itt elmaradt.
    const lines = run('nincs-ilyen-ref-a-tesztben')
    expect(line(lines, 'SKIP')).toMatch(/ismeretlen ref.*NEM MERVE/)
    expect(lines.join(' ')).not.toMatch(/nulla valtozott fajl/)
    expect(lines.some((l) => l.startsWith('INSTANT|') || l.startsWith('ALLAPOT|'))).toBe(false)
  })

  it('TARTOMANY romlott oldallal -> szinten SKIP', () => {
    // A `<base>..<ref>` alak MINDKET oldalat ellenorizni kell: egy elgepelt bazis ugyanolyan
    // nemán adna vissza egy ertelmetlen tartomanyt.
    expect(line(run('HEAD..nincs-ilyen-oldal'), 'SKIP')).toMatch(/ismeretlen ref: nincs-ilyen-oldal/)
  })

  it('hianyzo telepitesi fa -> SKIP, es SEMMILYEN allapot-allitas', () => {
    const lines = run('HEAD', join(install, 'nincs-ilyen'))
    expect(line(lines, 'SKIP')).toMatch(/NEM MERVE, nem 'rendben'/)
    expect(lines.some((l) => l.startsWith('ALLAPOT|'))).toBe(false)
  })

  it('a kilepesi kod MINDIG 0, es a szkript szintaktikailag ep', () => {
    expect(() => execFileSync('bash', ['-n', SCRIPT])).not.toThrow()
    expect(() =>
      execFileSync('bash', [SCRIPT, 'HEAD'], { cwd: install, env: { ...process.env, MARVEEN_INSTALL_ROOT: install } }),
    ).not.toThrow()
  })
})
