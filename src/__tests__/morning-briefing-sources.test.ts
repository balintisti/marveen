import { describe, it, expect } from 'vitest'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

// scripts/morning-briefing.sh is NOT dead code, and that is the point of this
// file. On this macOS box nothing runs it -- there is no LaunchAgent and
// store/morning.log has never been created -- so it reads as an abandoned
// copy. install-linux.sh:1771 wires it as the ExecStart of a systemd timer, so
// on every LINUX install it IS the morning briefing.
//
// It carried the pre-2026-08-20 instructions for two days after they were
// known wrong: `search_emails` (an MCP tool no agent in this fleet can reach)
// and `list-events` (likewise). A missing MCP tool produces no section, which
// reads exactly like a quiet morning -- the failure this whole chain exists to
// remove, still shipping to a platform nobody here runs.
//
// Source-pinned deliberately: the script's only behaviour is to hand a prompt
// to `claude`, and what has to stay true is the CONTENT of that prompt.

const RAW = readFileSync(join(__dirname, '..', '..', 'scripts', 'morning-briefing.sh'), 'utf-8')

// STRIP THE COMMENTS BEFORE MATCHING, and this file is the reason the rule
// exists rather than an example of it: the first version of the `primary`
// assertion below went red against the COMMENT that explains why `primary` was
// removed. The check alarmed on its own documentation, and the obvious way to
// "fix" that is to delete the explanation -- which is the one part worth
// keeping. The repo already knows this shape (the controller-permissions
// parser strips comments for exactly this reason); a checker that flags a
// correct file teaches everyone to ignore it, and the next real hit goes with
// it.
//
// Whole-line comments only. A `#` inside the quoted prompt is not a comment,
// and a greedier rule would silently eat instructions we are here to pin.
const SRC = RAW.split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n')

describe('morning-briefing.sh -- the sources it tells the agent to use', () => {
  it('does not send the agent looking for MCP tools that do not exist', () => {
    expect(SRC).not.toMatch(/search_emails/)
    expect(SRC).not.toMatch(/list-events/)
  })

  it('names the real mail command', () => {
    expect(SRC).toMatch(/gmail-recent\.py --minutes 720/)
  })

  it('names the real calendar command', () => {
    expect(SRC).toMatch(/calendar-agenda\.sh --hours/)
  })

  it('spells out the empty-vs-unreachable rule, the one that was violated', () => {
    // "Skip an empty category, spell out an unreachable one." Without this the
    // model writes the same calm sentence for both.
    expect(SRC).toMatch(/ok:true es ures, HAGYD KI/)
    expect(SRC).toMatch(/ok:false,\s*\n?\s*#?\s*IRD KI/)
  })

  it('SOURCE SHAPE: does not re-introduce the `:-0` fallback', () => {
    // A szoveg-rogzites ITT helyes: azt orzi, hogy a szkript ne TALALJON KI egy
    // nullat. Amit viszont NEM allit -- es a regi neve ("refuses to run ...")
    // azt igerte --, az a "0" ERTEK elutasitasa. Didi megmerte: az
    // `if [ -z "$CHAT_ID" ]` sort `if false`-ra cserelve, a ket szoveg-horgonyt
    // erintetlenul hagyva, mind a hat allitas ZOLD maradt.
    // A viselkedes-allitas most kulon all, lentebb.
    expect(SRC).not.toMatch(/ALLOWED_CHAT_ID:-0/)
  })

  it('does not default the calendar to `primary`', () => {
    // On the service-account path `primary` is the machine account's own
    // calendar: 200, zero events, forever. A default that always answers
    // "free day" is worse than no default.
    expect(SRC).not.toMatch(/HEARTBEAT_CALENDAR_ID:-primary/)
  })
})

// A KAPU VISELKEDESE -- ES MIERT EZ AZ EGY LEP KI A SZOVEG-ROGZITESBOL.
//
// A fajl fejlece kimondja, miert szoveg-rogzitett: a szkript egyetlen
// viselkedese az, hogy atad egy promptot a `claude`-nak, es ami igaznak kell
// maradnia, az a prompt TARTALMA. Az ot masik allitasnal ez HELYES.
//
// EZ AZ EGY KIVETEL, mert itt nem prompt-tartalom a kerdes, hanem hogy a
// szkript MEGALL-E. Didi lelete: a teszt NEVE azt igerte, hogy a "0" ERTEKET
// elutasitja, az allitasai viszont csak szoveg-horgonyok voltak. Mutacio:
// `if [ -z "$CHAT_ID" ]` -> `if false`, a horgonyok erintetlenul -> 6/6 ZOLD.
//
// A `0` NEM elmeleti: ezen a telepitesen az `.env` tenylegesen `ALLOWED_CHAT_ID=0`-t
// tartalmaz, es a repo sajat `owner-chat-fresh-install.test.ts`-e ezt nevezi meg
// "no usable ALLOWED_CHAT_ID"-kent -- ez a FRISS TELEPITES alakja.
describe('morning-briefing.sh -- a chat-id kapu VISELKEDESE', () => {
  /**
   * A szkriptet egy eldobhato telepitesben futtatja, hamis `claude`-dal.
   * A `claude` stub egy fajlt ir, ha meghivjak -- igy megkerdezheto, hogy a
   * briefing OSSZEALLT-E. Halozat nincs, valodi `claude` nincs.
   */
  function run(chatId: string | null) {
    const home = mkdtempSync(join(tmpdir(), 'briefing-'))
    mkdirSync(join(home, 'scripts'), { recursive: true })
    mkdirSync(join(home, 'store'), { recursive: true })
    // A STUB A `$HOME/.local/bin`-BE MEGY, ES EZ NEM STILUS-KERDES.
    // A szkript 6. sora KIKENYSZERITI a sajat PATH-jat:
    //     export PATH="$HOME/.local/bin:...:/opt/homebrew/bin:/usr/bin:/bin"
    // vagyis egy hivo-oldali PATH-prefixet ELDOB. Az elso valtozatom igy a
    // VALODI `claude`-ot inditotta el (a naplo "Not logged in"-t irt) -- egy
    // teszt, ami eles binarist hiv. A `HOME` felulirasaval a szkript sajat
    // elso PATH-eleme mutat a temp konyvtarba, tehat a stub nyer.
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    copyFileSync(join(__dirname, '..', '..', 'scripts', 'morning-briefing.sh'),
                 join(home, 'scripts', 'morning-briefing.sh'))
    writeFileSync(join(home, '.env'), chatId === null ? '' : `ALLOWED_CHAT_ID=${chatId}\n`)
    // A stub NEM hiv semmit -- csak nyomot hagy, hogy eljutottunk-e idaig.
    writeFileSync(join(home, '.local', 'bin', 'claude'), `#!/bin/bash\ntouch "${home}/store/.claude-hivva"\n`)
    chmodSync(join(home, '.local', 'bin', 'claude'), 0o755)
    const r = spawnSync('bash', [join(home, 'scripts', 'morning-briefing.sh')], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: home, MORNING_FORCE: '1' },
    })
    const log = existsSync(join(home, 'store', 'morning.log'))
      ? readFileSync(join(home, 'store', 'morning.log'), 'utf-8') : ''
    const composed = existsSync(join(home, 'store', '.claude-hivva'))
    rmSync(home, { recursive: true, force: true })
    return { status: r.status, log, composed }
  }

  it('a "0" ERTEKRE megall, es NEM allit ossze briefinget', () => {
    // Ez az allitas, amit a regi NEV igert, es amit egyetlen sor sem allitott.
    const r = run('0')
    expect(r.status).toBe(1)
    expect(r.composed, 'a briefing OSSZEALLT chat 0-ra').toBe(false)
    expect(r.log).toMatch(/nem hasznalhato/)
  })

  it('URES ertekre is megall (a korabbi eset, valtozatlanul)', () => {
    const r = run(null)
    expect(r.status).toBe(1)
    expect(r.composed).toBe(false)
  })

  it('POZITIV KONTROLL: valodi chat-id mellett ATMEGY a kapun', () => {
    // Enelkul a ket fenti attol is zold lenne, hogy a szkript MINDIG megall --
    // es akkor a kapu nem mer semmit, csak mindent elutasit.
    const r = run('8362010684')
    expect(r.composed, 'valodi chat-id mellett sem jutott el a briefingig').toBe(true)
  })
})
