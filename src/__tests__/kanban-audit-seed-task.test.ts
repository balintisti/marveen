import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

// Guards the SHIPPED kanban-audit scheduled task (card e4157868).
//
// THE DEFECT THIS EXISTS FOR: a task addressed to the coordinator can only land
// in an IDLE pane, and the coordinator is by definition the pane that is idle
// least often. Measured: 1636 deferrals, 1185 of them this one task -- i.e. zero
// runs, not "sometimes late". The fix is `forceSend`, which injects regardless.
//
// AND WHY IT NEEDED A SECOND FIX: `forceSend` was set only in the LIVE config
// under ~/.claude, which ships with nothing. The seed in this repo still
// described the pre-fix state, so every NEW install would reproduce the exact
// defect that produced those 1636 deferrals. A fix that exists only on the
// machine that found the bug is not shipped.
//
// MEASURED BEFORE WRITING THIS (jarvis left it open, and it decides whether the
// change reaches the wire at all): both hops pass the keys through unchanged.
//   install-macos.sh:990 / install-linux.sh -- a `sed` placeholder copy of the
//     whole file. No key whitelist, so new keys survive seeding.
//   src/web/scheduled-tasks-io.ts:122,129 -- the loader reads `forceSend` and
//     `stuckAfterMinutes` off the parsed config.
// Had either hop filtered keys, this edit would have been decoration.
const CONFIG_PATH = join(__dirname, '..', '..', 'seed-scheduled-tasks', 'kanban-audit', 'task-config.json')

interface TaskConfig {
  schedule: string
  agent: string
  enabled: boolean
  type: string
  skipIfBusy: boolean
  createdAt: number
  stuckAfterMinutes: number
  stuckAfterMinutesNote: string
  forceSend: boolean
  forceSendNote: string
}

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as TaskConfig

/**
 * The shipped shape, as a pure function so the MUTATION is assertable.
 *
 * Why a function and not inline expects (jarvis's correction to the original
 * spec, and he was right): an `it` block cannot assert an expected RED. Mutating
 * the parsed object and re-running the same inline expect does not demonstrate
 * the guard -- it just fails the suite. Worse, `config` is a module-level
 * constant, so a mutation inside one `it` leaks into every other one and the
 * suite becomes order-dependent.
 *
 * With a validator, "the guard fires on a broken config" becomes an ordinary
 * green assertion against a DEEP COPY, and nothing shared is touched.
 */
export function assertKanbanAuditSeed(cfg: TaskConfig): void {
  // Positive control FIRST: an empty or unreadable file must not read as "all
  // assertions passed". A guard over zero keys looks exactly like a guard that
  // found nothing wrong.
  if (Object.keys(cfg).length === 0) throw new Error('a beolvasott konfig URES -- a fajl hianyzik vagy nem JSON')
  if (cfg.forceSend !== true) throw new Error('forceSend nem true -- az uj telepitesek a javitas ELOTTI allapotot kapnak')
  if (cfg.stuckAfterMinutes !== 45) throw new Error('stuckAfterMinutes nem 45')
  if (cfg.agent !== '{{MAIN_AGENT_ID}}') throw new Error('az agent nem a helyorzo -- egy konkret agens neve nem hordozhato telepitesek kozott')
  if (cfg.type !== 'heartbeat') throw new Error('a type nem heartbeat')
  if (cfg.schedule !== '0 8,12,16,20 * * *') throw new Error('a cron megvaltozott')
  // The Notes carry the REASONING. Stripping them leaves two bare numbers that
  // the next reader cannot evaluate, and the card that explains them will be
  // archived long before the config is next touched.
  if (!cfg.forceSendNote?.trim()) throw new Error('a forceSendNote ures -- az indoklas elveszett')
  if (!cfg.stuckAfterMinutesNote?.trim()) throw new Error('a stuckAfterMinutesNote ures -- az indoklas elveszett')
}

/** Deep copy, so a mutated case cannot leak into the shared `config`. */
const mutalt = (patch: Partial<TaskConfig>): TaskConfig =>
  Object.assign(JSON.parse(JSON.stringify(config)) as TaskConfig, patch)

describe('kanban-audit seed task -- a mai javitas SZALLITHATO', () => {
  it('a szallitott konfig atmegy az oron', () => {
    expect(() => assertKanbanAuditSeed(config)).not.toThrow()
  })

  it('forceSend: true -- e nelkul az uj telepites ujratermeli az 1636 halasztast', () => {
    expect(config.forceSend).toBe(true)
  })

  it('stuckAfterMinutes: 45 -- a 15 a FORDULOT merte, nem a taskot', () => {
    expect(config.stuckAfterMinutes).toBe(45)
  })

  it('az agent a HELYORZO marad, nem egy konkret agens neve', () => {
    // Az eles fajlban `jarvis` all, es ott helyen is van. A seedbe azert nem
    // kerulhet at, mert egy agens-nev telepitesek kozott nem hordozhato -- egy
    // masik telepitesen az a nev egyszeruen nem letezik.
    expect(config.agent).toBe('{{MAIN_AGENT_ID}}')
  })

  it('a type es a cron valtozatlan', () => {
    expect(config.type).toBe('heartbeat')
    expect(config.schedule).toBe('0 8,12,16,20 * * *')
  })

  it('a ket Note hordozza az indoklast, es nem ures', () => {
    expect(config.forceSendNote).toMatch(/\S/)
    expect(config.stuckAfterMinutesNote).toMatch(/\S/)
  })
})

describe('az OR maga: minden vedett mezo elrontasa PIROSAT ad', () => {
  // Ez az, ami megmondja, hogy a fenti hat teszt tenyleg mer valamit. Mindegyik
  // eset MELY MASOLATON dolgozik, tehat a modul-szintu `config` erintetlen.
  it.each([
    ['forceSend kikapcsolva', { forceSend: false } as Partial<TaskConfig>, /forceSend nem true/],
    ['forceSend hianyzik', { forceSend: undefined } as unknown as Partial<TaskConfig>, /forceSend nem true/],
    ['stuckAfterMinutes visszaallt 15-re', { stuckAfterMinutes: 15 }, /stuckAfterMinutes nem 45/],
    ['az agent konkret nevre valt', { agent: 'jarvis' }, /nem a helyorzo/],
    ['a type elromlik', { type: 'task' }, /nem heartbeat/],
    ['a cron megvaltozik', { schedule: '0 * * * *' }, /cron megvaltozott/],
    ['a forceSendNote kiurul', { forceSendNote: '   ' }, /forceSendNote ures/],
    ['a stuckAfterMinutesNote kiurul', { stuckAfterMinutesNote: '' }, /stuckAfterMinutesNote ures/],
  ])('%s -> az or dob', (_nev, patch, minta) => {
    expect(() => assertKanbanAuditSeed(mutalt(patch))).toThrow(minta)
  })

  it('POZITIV KONTROLL: egy URES konfig is dob -- a nema siker kizarva', () => {
    // A hianyzo vagy ures fajl a legveszelyesebb eset: minden `expect` amit nem
    // futtatunk, zoldnek latszik.
    expect(() => assertKanbanAuditSeed({} as TaskConfig)).toThrow(/URES/)
  })

  it('a mutaciok NEM szennyeztek a megosztott konfigot', () => {
    // A modul-szintu allapot szivargasa pont az a hiba, amit a validator-alak
    // elkerul -- ezert allitjuk, nem felteteleezzuk.
    expect(config.forceSend).toBe(true)
    expect(config.agent).toBe('{{MAIN_AGENT_ID}}')
  })
})

// ---------------------------------------------------------------------------
// A SZALLITOTT SKILL.md OSZTALYOZO SZABALYAI (kartya 93f2dd69).
//
// A LELET: az egyetlen utemezett feladat, ami TANUL, epp az volt, aminek a
// tanulsaga nem szallitodott. Az elo peldany kilenc nap alatt megtanulta, hogy
// a gazdatlan `planned` es a szandekosan parkolo `waiting` EGESZSEGES allapot --
// a seed viszont a regi valtozatot vitte tovabb, tehat egy UJ telepites elso
// futasa HAMIS RIASZTASOKAT kapott volna a sajat helyes mukodesere.
//
// A DONTES (marveen) MASOLAS HELYETT KIVONAT volt: a SZABALYOK altalanosak es
// szallitandok, a mert esetek, kartya-azonositok, agens-nevek es a mi
// darabszamaink NEM. Ez a teszt azt meri, hogy a kivonat szabalyai TENYLEG
// mukodnek -- es nem egy masolaton, hanem a SZALLITOTT fajlbol kiszedett kodon.
// Egy fixture, amit a sajat feltetelezesunkbol epitunk, nem tud elbukni.
const SKILL_PATH = join(__dirname, '..', '..', 'seed-scheduled-tasks', 'kanban-audit', 'SKILL.md')
const skillSrc = readFileSync(SKILL_PATH, 'utf-8')

/**
 * A megnevezett python-reszlet a SZALLITOTT lapbol. Dob, ha nincs meg: egy
 * kihagyott kivonat kulonben ures kodot adna, es minden alabbi allitas
 * "atmenne" -- pontosan az a nema siker, amit ez a lap maga tilt.
 */
function auditSnippet(marker: string): string {
  const at = skillSrc.indexOf(`# AUDIT-SNIPPET: ${marker}`)
  if (at < 0) throw new Error(`nincs ilyen reszlet a szallitott SKILL.md-ben: ${marker}`)
  const start = skillSrc.lastIndexOf('python3 -c "', at)
  if (start < 0) throw new Error(`a(z) ${marker} reszlet nem python3 -c hivasban all`)
  const from = skillSrc.indexOf('\n', start) + 1
  const end = skillSrc.indexOf('\n"\n', from)
  if (end < 0) throw new Error(`a(z) ${marker} reszlet nincs lezarva`)
  return skillSrc.slice(from, end)
}

type Card = Record<string, unknown>
const NOW = Math.floor(Date.now() / 1000)
const card = (id: string, extra: Card = {}): Card => ({
  id, status: 'planned', assignee: null, priority: 'normal', updated_at: NOW, archived_at: null, title: `card ${id}`, ...extra,
})

function runSnippet(marker: string, cards: Card[], subst?: [string, string]): string[] {
  let code = auditSnippet(marker)
  if (subst) code = code.replace(subst[0], subst[1])
  const out = execFileSync('python3', ['-c', code], { input: JSON.stringify(cards), encoding: 'utf-8' })
  return out.trim().split('\n').filter(Boolean)
}

describe('a szallitott osztalyozas NEM riaszt egy egeszseges tablara', () => {
  it('a reszlet tenyleg megvan a szallitott lapon (kontroll az ures kivonat ellen)', () => {
    expect(auditSnippet('osztalyozas')).toContain('TALALAT-OSSZESEN')
    expect(() => auditSnippet('nincs-ilyen')).toThrow(/nincs ilyen reszlet/)
  })

  it('EGESZSEGES TABLA -> nulla talalat', () => {
    // A ket alak, amire a regi szabaly riasztott volna, es amelyik ma HELYES:
    //   - gazdatlan `planned`: azt jelenti, hogy barki felveheti
    //   - `waiting`, ami 48 oranal regebb ota all, de kiirt indokkal parkol
    // A parkolo kartya `ELLENORZENDO` sort kap -- az a MECHANIKUS szuro, nem a
    // jelentes: a lap 7. lepese kimondja, hogy elolvasas utan csendben marad, ha
    // a kartya megmondja, mire var. Mechanikusan ezt eldonteni nem lehet, ezert
    // amit ez a teszt rogzit: TALALAT nem keletkezik belole.
    const sorok = runSnippet('osztalyozas', [
      card('p1'),
      card('p2', { priority: 'low' }),
      card('w1', { status: 'waiting', updated_at: NOW - 72 * 3600, assignee: 'valaki' }),
      card('i1', { status: 'in_progress', assignee: 'valaki' }),
      card('t1', { status: 'testing', assignee: 'valaki' }),
    ])
    expect(sorok.filter((l) => l.startsWith('TALALAT '))).toEqual([])
    expect(sorok).toContain('TALALAT-OSSZESEN 0')
  })

  it('POZITIV KONTROLL: a gazdatlan in_progress ES testing MEGSZOLALTATJA', () => {
    // E nelkul az elozo teszt csak annyit bizonyitana, hogy a szuro nema.
    const sorok = runSnippet('osztalyozas', [
      card('i2', { status: 'in_progress' }),
      card('t2', { status: 'testing' }),
      card('p3'),
    ])
    expect(sorok).toContain('TALALAT-OSSZESEN 2')
    expect(sorok.some((l) => l.startsWith('TALALAT gazdatlan-in_progress i2'))).toBe(true)
    expect(sorok.some((l) => l.startsWith('TALALAT gazdatlan-testing t2'))).toBe(true)
  })

  it('a HIGH gazdatlan planned HUZO-sort kap, es NEM talalatot', () => {
    // A kulonbseg maga a dontes: megnevezni igen (kulonben lathatatlanul all),
    // riasztani nem (mert a gazdatlansaga a helyes allapot).
    const sorok = runSnippet('osztalyozas', [card('h1', { priority: 'high' }), card('u1', { priority: 'urgent' })])
    expect(sorok).toContain('TALALAT-OSSZESEN 0')
    expect(sorok.filter((l) => l.startsWith('HUZO ')).length).toBe(2)
  })

  it('az archivalt kartyak nem szamitanak', () => {
    const sorok = runSnippet('osztalyozas', [card('a1', { status: 'in_progress', archived_at: NOW - 10 })])
    expect(sorok).toEqual(['TALALAT-OSSZESEN 0'])
  })
})

describe('a beakadt-detektalas kihagyja az ALLANDO SOR kartyat', () => {
  const LAST = String(NOW - 3600)
  const futtat = (cards: Card[]): string[] => runSnippet('beakadt', cards, ["'''$LAST'''", `'''${LAST}'''`])

  it('egy szandekosan orokke in_progress kartya NEM beakadt', () => {
    const sorok = futtat([
      card('s1', { status: 'in_progress', assignee: 'valaki', updated_at: NOW - 7200, title: 'valaki ALLANDO SORA: napi munka' }),
    ])
    expect(sorok).toEqual([])
  })

  it('POZITIV KONTROLL: egy sima beakadt kartya viszont megjelenik', () => {
    const sorok = futtat([
      card('s2', { status: 'in_progress', assignee: 'valaki', updated_at: NOW - 7200, title: 'egy rendes feladat' }),
    ])
    expect(sorok.length).toBe(1)
    expect(sorok[0]).toContain('s2')
  })

  it('az ekezetes ALLANDO SORA alak is kimarad', () => {
    const sorok = futtat([
      card('s3', { status: 'in_progress', assignee: 'valaki', updated_at: NOW - 7200, title: 'valaki ÁLLANDÓ SORA: napi munka' }),
    ])
    expect(sorok).toEqual([])
  })
})
