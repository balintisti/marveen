// Functional test for ensureSkillsPathTrapSection() -- mirrors
// autonomy-section.test.ts. SKILLUTCSAPDA822: the `.claude-config/skills`
// path IS the shared global dir (symlink), reads as "my own config", and five
// third-party skills landed fleet-wide through it on 2026-08-22. This proves
// the warning block actually reaches the agent file on respawn, idempotently.
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmpRoot = mkdtempSync(join(tmpdir(), 'marveen-skilltrap-test-'))

vi.mock('../config.js', () => ({
  PROJECT_ROOT: tmpRoot,
  OWNER_NAME: 'TestOwner',
  MAIN_AGENT_ID: 'agent-a',
  BOT_NAME: 'agent-a',
  CHANNEL_PROVIDER: 'telegram',
  WEB_PORT: 3420,
  OWNER_DRIVE_FOLDER: '',
  DASHBOARD_PUBLIC_URL: '',
  APP_TZ: 'Europe/Budapest',
}))

vi.mock('../web/agent-config.js', () => ({
  agentDir: (name: string) => join(tmpRoot, 'agents', name),
  agentConfigRoot: () => join(tmpRoot, 'agents'),
  listAgentNames: () => ['agent-a', 'agent-b'],
  readAgentCapabilities: () => [],
}))

vi.mock('../web/atomic-write.js', () => ({
  atomicWriteFileSync: (path: string, content: string) => writeFileSync(path, content, 'utf-8'),
}))

const { ensureSkillsPathTrapSection, ensureAutonomySection, ensureFleetRosterSection } =
  await import('../web/agent-scaffold.js')

const MARKER_BEGIN = '<!-- BEGIN GENERATED: skills-path-trap (auto-generated, do not edit by hand) -->'
const MARKER_END = '<!-- END GENERATED: skills-path-trap -->'

function setup(agentName: string, content: string) {
  const dir = join(tmpRoot, 'agents', agentName)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'CLAUDE.md'), content, 'utf-8')
}

function read(agentName: string): string {
  return readFileSync(join(tmpRoot, 'agents', agentName, 'CLAUDE.md'), 'utf-8')
}

describe('ensureSkillsPathTrapSection', () => {
  it('appends the warning block to a CLAUDE.md that lacks it', () => {
    setup('agent-b', '# Agent B\n\nSome persona.\n')
    ensureSkillsPathTrapSection('agent-b')
    const out = read('agent-b')
    expect(out).toContain(MARKER_BEGIN)
    expect(out).toContain(MARKER_END)
    expect(out).toContain('.claude-config/skills')
    expect(out).toContain('NEM a saját mappád')
    expect(out).toContain('.claude/skills/')
    // Existing content untouched.
    expect(out).toContain('Some persona.')
    // A NEZOPONT is a szoveg resze: a figyelmeztetes RELATIV utat hasznal, es a repo
    // gyokerebol nezve az az ut nem letezik. Enelkul a sor nelkul egy onnan ellenorzo
    // olvaso elavultnak hiszi a blokkot es "kijavitja" -- ez 2026-08-25-en megtortent
    // (kartya 12dffabf), es a javitas konkret es hianyos lett (nyolcbol ket ut).
    expect(out).toContain('MUNKAKÖNYVTÁRADHOZ KÉPEST RELATÍV')
    expect(out).toContain('KILENC ilyen symlink')
  })

  // A NEV SZERINTI FELSOROLAS EGYET KIHAGYOTT, ES EPP A KOORDINATORET (kartya 18ee950f).
  // A blokk 2026-08-25 ota `nyolc`-at mondott es a `.claude-config` NEVET nevezte meg;
  // a kilencedik ugyanaz a symlink ugyanarra a globalis fara, de `.channels-config`
  // neven -- es 09-04-en marveen pontosan azon setalt be, a szabaly ISMERETEBEN.
  // Merve 2026-09-04: 6 agens-mappa + 2 worker-home + 1 koordinator = 9, mind
  // `-> /Users/isti/.claude/skills`.
  it('names the coordinator path too, and gives a check that does not depend on the name', () => {
    setup('agent-c', '# Agent C\n')
    ensureSkillsPathTrapSection('agent-c')
    const out = read('agent-c')
    // A KIHAGYOTT ut, nevvel. Ez az allitas az, ami egy csak-`.claude-config` blokkon PIROS.
    expect(out).toContain('.channels-config/skills')
    // ES A KRITERIUM A TAGSAG HELYETT: a felsorolas elavul, a parancs nem. Enelkul a
    // fenti sor csak a mai kilencedik utat rogziti, es a tizedik megint hianyozni fog.
    expect(out).toContain('os.path.realpath')
    // A DISZKRIMINATOR: a blokk mondja ki, hogy a NEV volt a csapda -- nelkule az
    // olvaso ugyanugy nev szerint fog keresni, csak eggyel hosszabb listaval.
    expect(out).toContain('A NEVE REJTETTE EL')
  })

  it('is idempotent: a second call changes nothing', () => {
    setup('agent-b', '# Agent B\n')
    ensureSkillsPathTrapSection('agent-b')
    const first = read('agent-b')
    ensureSkillsPathTrapSection('agent-b')
    expect(read('agent-b')).toBe(first)
    // Exactly one block, not stacked.
    expect(first.split(MARKER_BEGIN).length - 1).toBe(1)
  })

  it('replaces ONLY the marked block, preserving hand-written text around it', () => {
    setup('agent-b', `# Agent B\n\n${MARKER_BEGIN}\nRÉGI SZÖVEG\n${MARKER_END}\n\nKézzel írt lábjegyzet.\n`)
    ensureSkillsPathTrapSection('agent-b')
    const out = read('agent-b')
    expect(out).not.toContain('RÉGI SZÖVEG')
    expect(out).toContain('Kézzel írt lábjegyzet.')
    expect(out).toContain('.claude-config/skills')
  })

  it('skips silently when there is no CLAUDE.md', () => {
    expect(() => ensureSkillsPathTrapSection('agent-nonexistent')).not.toThrow()
  })

  it('the main agent path targets PROJECT_ROOT/CLAUDE.md', () => {
    writeFileSync(join(tmpRoot, 'CLAUDE.md'), '# Main\n', 'utf-8')
    ensureSkillsPathTrapSection('agent-a')
    const out = readFileSync(join(tmpRoot, 'CLAUDE.md'), 'utf-8')
    expect(out).toContain(MARKER_BEGIN)
  })
})

describe('wiring contracts', () => {
  it('startAgentProcess calls the ensure on every (re)spawn', () => {
    const src = readFileSync(join(__dirname, '../../src/web/agent-process.ts'), 'utf-8')
    const roster = src.indexOf('ensureFleetRosterSection(name)')
    const trap = src.indexOf('ensureSkillsPathTrapSection(name)')
    expect(roster).toBeGreaterThan(0)
    expect(trap).toBeGreaterThan(roster)
  })

  it('the generated template names the trap inline too', () => {
    const src = readFileSync(join(__dirname, '../../src/web/agent-scaffold.ts'), 'utf-8')
    expect(src).toContain('CSAPDA: a .claude-config/skills NEM a tiéd')
  })
})

describe('a generalt blokk a BESZURASI PONTON szol (kartya 7a8d972b)', () => {
  // A mert eset: a `BEGIN` sor utan KOZVETLENUL egy `##` fejlec allt, es a
  // termeszetes szerkesztesi mozdulat ("szurj be uj szakaszt a `## X` ELE") pontosan
  // a BEGIN es a fejlec koze esik -- vagyis A BLOKKBA. Marveen igy vesztett el harom
  // lap-szerkesztest 2026-08-27-en, es a hiba RACSNIZ: minden bejutott szakasz
  // tavolabb tolja a markert (a blokk 10 sorrol ~115-re nott).

  it('a BEGIN utani ELSO sor NEM `##` fejlec, hanem a figyelmeztetes', () => {
    setup('agent-b', '# Agent B\n')
    ensureSkillsPathTrapSection('agent-b')
    const lines = read('agent-b').split('\n')
    const i = lines.findIndex((l) => l === MARKER_BEGIN)
    expect(i).toBeGreaterThanOrEqual(0)
    // EZ a lenyeg: a fejlec nem tapadhat a markerhez.
    expect(lines[i + 1].startsWith('## ')).toBe(false)
    expect(lines[i + 1]).toContain('GENERALT')
    expect(lines[i + 1]).toContain('NYOMTALANUL ELVESZ')
    // es a fejlec kozvetlenul a figyelmeztetes UTAN jon -- tehat aki a fejlecre
    // gorget, a sor folott latja
    expect(lines[i + 2].startsWith('## ')).toBe(true)
  })

  it('a figyelmeztetes a blokkon BELUL van, tehat az iro karbantartja', () => {
    // Ha kivul lenne, egy kezi torles utan sosem jonne vissza.
    setup('agent-b', '# Agent B\n')
    ensureSkillsPathTrapSection('agent-b')
    const out = read('agent-b')
    const block = out.slice(out.indexOf(MARKER_BEGIN), out.indexOf(MARKER_END))
    expect(block).toContain('NYOMTALANUL ELVESZ')
  })

  it('idempotens marad a figyelmeztetessel egyutt', () => {
    setup('agent-b', '# Agent B\n')
    ensureSkillsPathTrapSection('agent-b')
    const first = read('agent-b')
    ensureSkillsPathTrapSection('agent-b')
    expect(read('agent-b')).toBe(first)
  })
})

describe('MIND A HAROM generalt blokk a beszurasi ponton szol (7a8d972b)', () => {
  // Az elozo blokk CSAK a skills-path-trap-et rogziti. Harombol egy nem rogziti a
  // masik kettot -- ugyanaz az alak, mint egy szam populacio nelkul, csak tesztben.
  // Ez a teszt mind a harmat ugyanabban a fajlban renderli ki es meri.

  it('egyik blokkban SEM tapad `##` fejlec a BEGIN markerhez', () => {
    setup('agent-b', '# Agent B\n')
    ensureAutonomySection('agent-b')
    ensureFleetRosterSection('agent-b')
    ensureSkillsPathTrapSection('agent-b')
    const lines = read('agent-b').split('\n')

    const begins = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.includes('BEGIN GENERATED:'))
    // POZITIV KONTROLL a merore: ha nulla blokkot talal, az allitas ures.
    expect(begins.length).toBe(3)

    for (const { l, i } of begins) {
      const nev = l.slice(l.indexOf('BEGIN GENERATED:') + 16, l.indexOf('(')).trim()
      expect(lines[i + 1].startsWith('## '), `${nev}: fejlec tapad a markerhez`).toBe(false)
      expect(lines[i + 1], `${nev}: hianyzik a figyelmeztetes`).toContain('NYOMTALANUL ELVESZ')
    }
  })
})
