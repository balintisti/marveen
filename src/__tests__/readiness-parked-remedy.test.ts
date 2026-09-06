/**
 * A KESZENLETI UT NE TEKINTSE KESZNEK AZT A PANELT, AMI CSAK LATSZIK URESJARATNAK (kartya 4dc05974).
 *
 * A MECHANIZMUS: nem az tortenik, hogy az eszkalacio lefut es nem lat semmit -- EL SEM INDUL.
 * A `message-router` csendes-sopres aga `isSessionReadyForPrompt`-ot kerdez, es ha az igent mond,
 * `agentStuckSince.delete(agent)` + `continue`. Egy hosszan tordelt parkolt uzenetnel a
 * `detectPaneState` `idle`-t olvas, tehat a keszenleti mag IGAZAT adott -- a stuck-ora torlodott,
 * es a riasztasi ag SOHA nem futott le.
 *
 * A `paneRemedy` `read-the-pane` verdiktje az EGYETLEN, ami kimondja magarol, hogy a panel hazudik
 * (sajat `why`-ja: "the pane reads idle when it is actually parked"). Ez a suite azt pineli, hogy
 * a keszenleti ut ezt a verdiktet HONORALJA -- es hogy a masik iranyba nem tulzott: egy VALODI
 * ures doboz tovabbra is keszen all.
 *
 * A FIXTURE MAGASSAGA TEHERHORDO, ES MERVE VAN. Minden elo panel a flottaban 24x80
 * (`tmux list-panes -a` -> 9/9 magassag 24), es a `capturePane` `-S` nelkul hivja a
 * `capture-pane`-t, tehat a LATHATO panelt kapja. A kartya tablaja 25 soros fixture-rel keszult,
 * es ezert EGGYEL eltolva jelenti a savokat. Valos magassagon:
 *
 *     wrap <= 20 ... `typing`         -> a keszenleti mag MAR ma hamisat ad (mukodik)
 *     wrap == 21 ... `read-the-pane`  -> EZT nyeri vissza ez a valtozas
 *     wrap >= 22 ... `none`           -> BAJT-AZONOS egy ures dobozzal; MARAD VAK
 *
 * A vaksag tehat a CAPTURE MAGASSAGANAK tulajdonsaga, nem a `paneRemedy`-e: 24 -> 22-tol vak,
 * 25 -> 23, 30 -> 28, 40 -> 38. A magassag emelese MOZGATJA a savot es minden `capturePane`-
 * fogyasztot erint -- kulon kartya, nem ezé. A 4. eset ezt a hatart PINELI, hogy a kartya ne
 * olvasodjon megoldottnak.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
const execFileSync = vi.fn()
vi.mock('node:child_process', () => ({ execFileSync: (...a: unknown[]) => execFileSync(...a) }))

const PANE_HEIGHT = 24        // MERVE: mind a 9 elo panel 24 sor

/** Egy parkolt uzenetet tarto panel, `wrapLines` tordelt folytatassal, VALOS magassagra vagva. */
function parkedPane(wrapLines: number, height = PANE_HEIGHT): string {
  const body = Array.from({ length: wrapLines }, (_, i) => `  wrapped continuation ${i}`)
  return [
    'some scrollback',
    '─'.repeat(40),
    '❯ [inbox-wakeup] pending inter-agent messages',
    ...body,
    '─'.repeat(40),
    'bypass permissions on (shift+tab to cycle)',
  ].slice(-height).join('\n')
}

const EMPTY_BOX = [
  'work', 'done',
  '─'.repeat(40),
  '❯ ',
  '─'.repeat(40),
  'bypass permissions on (shift+tab to cycle)',
].join('\n')

function pane(text: string | null): void {
  execFileSync.mockImplementation(() => {
    if (text == null) throw new Error('no server running')
    return text
  })
}

async function ready(): Promise<boolean> {
  const m = await import('../web/agent-process.js')
  return m.isSessionReadyForPrompt('s-readiness')
}

async function remedyOf(p: string): Promise<string> {
  const m = await import('../web/parked-pane-remedy.js')
  return m.paneRemedy(p).remedy
}

beforeEach(() => { execFileSync.mockReset() })

describe('keszenlet: a read-the-pane verdikt nem olvasodik uresjaratnak', () => {
  it('1. a fixture VALOBAN azt az alakot allitja elo, amirol a suite szol', async () => {
    // Enelkul minden tovabbi eset egy olyan panelre allitana, amirol nem tudjuk, mit tartalmaz.
    expect(await remedyOf(parkedPane(21))).toBe('read-the-pane')
    expect(await remedyOf(EMPTY_BOX)).toBe('none')
  })

  it('2. a LELET: egy `read-the-pane` panel NEM keszen allo', async () => {
    pane(parkedPane(21))
    expect(await ready()).toBe(false)
  })

  it('3. KONTROLL: egy VALODI ures doboz tovabbra is keszen all', async () => {
    // Ez a kapu masik oldala. Nelkule a 2. eset egy olyan valtozason is zold lenne, ami
    // MINDENT nem-keszenek mond -- es az a router teljes leallasa volna.
    pane(EMPTY_BOX)
    expect(await ready()).toBe(true)
  })

  it('4. KIMONDOTT HATAR: wrap>=22 valos magassagon MARAD VAK, es ez pinelve van', async () => {
    // Nem hiba, hanem a capture magassaganak kovetkezmenye. Azert all itt allitaskent, hogy
    // ha valaki a magassagot megemeli, EZ a sor bukjon el es olvassa el a docblockot.
    expect(await remedyOf(parkedPane(22))).toBe('none')
    pane(parkedPane(22))
    expect(await ready()).toBe(true)
  })

  it('5. a valtozas NULLA extra tmux-hivasba kerul', async () => {
    // A `paneRemedy` tiszta string-fuggveny; a panelt a keszenleti ut MAR elfogta. Ha valaha
    // capture-t adna hozza, ez a szam megnone.
    pane(EMPTY_BOX)
    await ready()
    const onReadyPath = execFileSync.mock.calls.length
    execFileSync.mockClear()
    pane(parkedPane(21))
    await ready()
    const onParkedPath = execFileSync.mock.calls.length
    // A parkolt ut az ELSO capture utan visszater, tehat nem tobb, mint a kesz ute.
    expect(onParkedPath).toBeLessThanOrEqual(onReadyPath)
    expect(onParkedPath).toBeGreaterThan(0)   // es tenylegesen olvasott is panelt
  })
})

describe('bekotes: a keszenleti ut tenyleg a verdiktet kerdezi', () => {
  it('6. az `isSessionReadyForPrompt` torzse hivja a `paneRemedy`-t', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../web/agent-process.ts', import.meta.url), 'utf8')
    const i = src.indexOf('export async function isSessionReadyForPrompt')
    const body = src.slice(i, src.indexOf('\nexport ', i + 10))
    expect(body).toContain('paneRemedy(plain)')
    expect(body).toContain("!== 'read-the-pane'")
  })
})
