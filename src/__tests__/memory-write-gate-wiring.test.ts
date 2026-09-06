/**
 * A MEMORY.md IRAS-KAPU BEKOTESE (kartya c837502c).
 *
 * A kapu maga a `scripts/hooks/memory-index-write-gate.py`, sajat python-kontraktussal. Ez a
 * suite a MASIK felet rogziti: hogy a kapu ELER az agensekhez -- mert egy megirt es tesztelt
 * or, amit senki nem kot be, pontosan ugy nez ki, mint a kesz munka. Ennek a repónak MERT
 * precedense van ra: a `json-dup-keys` modul 2026-08-29-en INERT-kent landolt a torzson, sajat
 * tesztjei zolden, NULLA produkcios hivoval (`agent-scaffold-json-dup-wiring.test.ts`).
 *
 * MIERT KODBOL ES NEM SETTINGS-FAJLBOL -- marveen dontese, meresen:
 * nincs olyan settings-fajl, ami MIND A HAT agenst eleri ES verziozva van. A projekt-szintu
 * `marveen/.claude/settings.json` KOVETETT, de csak a fo agenst eri el; az `agents/` alatti
 * minden fajl gitignore-olt. A `db-destructive-gate` nem az a precedens, aminek latszik: EGY
 * hivatkozasa van `src/` alatt, es az egy TESZT -- kezzel lett bekotve. Az `ensureEgressGate`
 * az igazi minta: verziozott forras, determinisztikus mind a hat agensre, es tulel egy
 * `git clean`-t.
 *
 * A 4. ESET A LEGFONTOSABB, es szandekosan ellentetes a governance-kapukkal: a matcher a `Bash`-t
 * IS fedi, tehat egy `test -x ... || exit 2` alak egy HIANYZO szkriptnel MINDEN shell-hivast
 * blokkolna. Ezert fail-OPEN, ugyanaz az alak, mint a staleness-hooke.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('../logger.js', () => ({
  logger: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
}))

let agentRoot: string
vi.mock('../web/agent-config.js', async (orig) => {
  const actual = await orig<typeof import('../web/agent-config.js')>()
  return { ...actual, agentDir: () => agentRoot }
})

const { ensureMemoryIndexWriteGate } = await import('../web/agent-scaffold.js')

const SETTINGS = () => join(agentRoot, '.claude', 'settings.json')
const read = () => JSON.parse(readFileSync(SETTINGS(), 'utf-8')) as Record<string, any>
const entries = () => (read().hooks?.PreToolUse ?? []) as any[]
const ours = () => entries().filter(e => JSON.stringify(e).includes('memory-index-write-gate.py'))

beforeEach(() => {
  agentRoot = mkdtempSync(join(tmpdir(), 'memgate-'))
  mkdirSync(join(agentRoot, '.claude'), { recursive: true })
})
afterEach(() => rmSync(agentRoot, { recursive: true, force: true }))

describe('a MEMORY.md iras-kapu bekotese', () => {
  it('1. beirja magat egy URES settings-fajlba', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    expect(ensureMemoryIndexWriteGate('probe')).toBe(true)
    expect(ours()).toHaveLength(1)
  })

  it('2. IDEMPOTENS: a masodik hivas nem ir, es nem duplikal', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureMemoryIndexWriteGate('probe')
    expect(ensureMemoryIndexWriteGate('probe')).toBe(false)
    expect(ours()).toHaveLength(1)
  })

  it('3. KONTROLL: a MEGLEVO hookokat nem tunteti el', () => {
    // Enelkul az 1. eset zold volna egy olyan valtozason is, ami az egesz blokkot lecsereli --
    // es az minden mas or nema elvesztese lenne.
    writeFileSync(SETTINGS(), JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'WebFetch', hooks: [{ type: 'command', command: 'egress-gate.mjs' }] }] },
    }))
    ensureMemoryIndexWriteGate('probe')
    expect(JSON.stringify(entries())).toContain('egress-gate.mjs')
    expect(ours()).toHaveLength(1)
  })

  it('4. FAIL-OPEN alak: hianyzo szkriptnel `exit 0`, NEM `exit 2`', () => {
    // A matcher a Bash-t is fedi. Egy fail-closed alak egy hianyzo szkriptnel MINDEN
    // shell-hivast blokkolna -- ezert ter el szandekosan a governance-kapuktol.
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureMemoryIndexWriteGate('probe')
    const cmd = ours()[0].hooks[0].command as string
    expect(cmd).toContain('exit 0')
    expect(cmd).not.toContain('exit 2')
    expect(cmd).toContain('[ -f ')
  })

  it('5. a matcher fedi a HAROM utat, amin a megkerules tortenik', () => {
    writeFileSync(SETTINGS(), JSON.stringify({}))
    ensureMemoryIndexWriteGate('probe')
    const m = ours()[0].matcher as string
    for (const tool of ['Write', 'Edit', 'Bash']) expect(m).toContain(tool)
    // NotebookEdit KIMARAD, es ez dontes: a kapu nem tud notebook-irast meretezni, tehat
    // fail-open lenne -- a matcherbe veve csak egy interpreter-inditast venne meg semmiert.
    expect(m).not.toContain('NotebookEdit')
  })

  it('6. BEKOTES: a `src/web.ts` tenylegesen HIVJA -- kulonben a fenti ot eset inert kodot mer', () => {
    const src = readFileSync(new URL('../web.ts', import.meta.url), 'utf-8')
    expect(src).toContain('ensureMemoryIndexWriteGate')
    // ...es nem csak importalja: a startup-hurokban hivja is.
    expect(src).toMatch(/if \(ensureMemoryIndexWriteGate\(agentName\)\)/)
  })
})

/**
 * A FRISSEN LETREHOZOTT AGENS IS MEGKAPJA A KAPUKAT (kartya 5967c260).
 *
 * MERVE 2026-09-06: a sablon a staleness-hookot hordozza (1) es SEMMI MAST -- `egress-gate` 0,
 * `self-pace-gate` 0, `memory-index-write-gate` 0 (kontroll: `PreCompact` 1, tehat a mero
 * OLVASSA a sablont). Minden mas kaput az `ensure*` csalad ir be, es annak EGYETLEN hivasi helye
 * volt: a `src/web.ts` hurokja a `startWebServer`-ben. Vagyis egy DASHBOARD-INDULASOK KOZOTT
 * letrehozott agens kapu nelkul futott a kovetkezo restartig, es semmi nem szolt rola.
 *
 * A res PRE-EXISTING es nem a memoria-kapu sajatja: az `ensureEgressGate` ugyanigy hianyzott.
 * Elo kitettseg a meres pillanataban NULLA volt (6/6 agens hordozza oket a legutobbi
 * indulasbol) -- a res a KOVETKEZO, futas kozben letrehozott agenst erinti.
 */
describe('a frissen scaffoldolt agens is megkapja a kapukat (5967c260)', () => {
  it('7. a `scaffoldAgentDir` a sablon UTAN futtatja az `ensure*` csaladot', () => {
    const src = readFileSync(new URL('../web/agent-scaffold.ts', import.meta.url), 'utf-8')
    const i = src.indexOf('export function scaffoldAgentDir')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, src.indexOf('\nexport ', i + 10))   // SZERKEZETI hatar, nem fix ablak
    for (const fn of ['ensureAgentHooks', 'ensureAgentStalenessHook', 'ensureEgressGate',
                      'ensureGovernanceGateCommands', 'ensureMemoryIndexWriteGate']) {
      expect(body, `hianyzik a scaffoldbol: ${fn}`).toContain(`${fn}(name)`)
    }
    // A SORREND TEHERHORDO: mindegyik OLVASSA a settings-fajlt es beleolvaszt, tehat a
    // sablon-vetesnek ELOTTUK kell allnia -- kulonben felulirja oket.
    //
    // AZ ELSO ALAKOM ITT GYENGE VOLT, es egy mutacio mutatta meg: a
    // `indexOf('settings.json.template') < indexOf('ensureEgressGate')` allitas ATENGEDETT egy
    // olyan valtozast, ami a kapuk UTAN irt MEGIS a settings-fajlba -- mert a sablon-SZTRING
    // helye valtozatlan maradt. Egy pozicio-allitas a SZTRINGROL nem allitas az IRASROL.
    // Ezert most azt merem, ami szamit: az ELSO `ensure*` hivas utan NINCS settings-iras.
    const firstEnsure = body.indexOf('ensureAgentHooks(name)')
    expect(firstEnsure).toBeGreaterThan(-1)
    expect(body.slice(firstEnsure)).not.toContain('atomicWriteFileSync(settingsJson')
    expect(body.indexOf('settings.json.template')).toBeLessThan(firstEnsure)
  })

  it('8. KONTROLL: a SABLON tenyleg nem hordozza oket -- ezert kell a 7.', () => {
    // Ha a sablon egyszer megkapja oket, ez az eset bukik, es akkor a 7. duplikacio, nem hiany.
    const tpl = readFileSync(new URL('../../templates/settings.json.template', import.meta.url), 'utf-8')
    expect(tpl).toContain('PreCompact')          // a mero OLVASSA a sablont
    expect(tpl).not.toContain('egress-gate')
    expect(tpl).not.toContain('memory-index-write-gate')
  })
})
