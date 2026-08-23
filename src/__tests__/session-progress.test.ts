import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePaneTokens, nextTokenSample } from '../session-progress.js'
import { shouldEscalateStuckSession } from '../web/message-router.js'

// A BUSY-riasztas haladas-jele (kartya 09906ebf).
//
// A MERT ALLAS, amiert ez a valtozas letezik (jarvis, ot nap; marveen ujramerte):
//   BUSY-ag       59 riasztas -> 0 valodi talalat, median 3 perc a kovetkezo kimenetig
//   not-ready ag  13 riasztas -> 1 valodi talalat (08-18, a beavatkozas 3 perccel kesobb)
// A BUSY-ag felteteléhez ezert kerul a token-szam mozdulatlansaga; a not-ready ag
// VALTOZATLAN marad, mert ott van az egyetlen valodi talalat, es egy nulla-talalatos
// ag javitasa nem indok a masik piszkalasara.

describe('parsePaneTokens -- a jel kiolvasasa a panelbol', () => {
  it('a `k` szorzot alkalmazza', () => {
    expect(parsePaneTokens('✽ Unravelling… (32m 53s · ↓ 88.0k tokens)')).toBe(88000)
  })

  it('`k` nelkuli nyers darabszamot is olvas', () => {
    expect(parsePaneTokens('· Envisioning… (2m 1s · ↓ 940 tokens)')).toBe(940)
  })

  it('AZ UTOLSO talalatot veszi, nem az elsot', () => {
    // A panel scrollbackjeben tobb regi porgo-sor is allhat. Az ELSO talalat egy REGI
    // szamot adna -- ami "befagyottnak" latszana, vagyis pont azt a hibat termelne,
    // amit ez a jel mer. (Ez a sor onmagaban is elmondja, miert nem `match`-elso.)
    const pane = [
      '✽ Envisioning… (10m 0s · ↓ 12.0k tokens)',
      '✽ Unravelling… (32m 53s · ↓ 88.0k tokens)',
    ].join('\n')
    expect(parsePaneTokens(pane)).toBe(88000)
  })

  it('nincs token-sor -> null, es ez NEM nulla', () => {
    // A kulonbseg a hivo oldalan dont: a nulla azt jelenti, hogy MOST kezdtuk merni,
    // a null azt, hogy NEM TUDJUK. A ketto nem helyettesitheti egymast.
    expect(parsePaneTokens('❯ egy sima idle prompt')).toBeNull()
    expect(parsePaneTokens('')).toBeNull()
    expect(parsePaneTokens(null)).toBeNull()
  })
})

describe('nextTokenSample -- mennyi ideje all a szam', () => {
  it('elso mintavetel: frozenMs 0, nem null', () => {
    expect(nextTokenSample(null, 88000, 1000)).toEqual({ sample: { tokens: 88000, sinceMs: 1000 }, frozenMs: 0 })
  })

  it('VALTOZOTT szam -> a szamlalo ujraindul', () => {
    const prev = { tokens: 88000, sinceMs: 1000 }
    expect(nextTokenSample(prev, 90000, 5000)).toEqual({ sample: { tokens: 90000, sinceMs: 5000 }, frozenMs: 0 })
  })

  it('VALTOZATLAN szam -> a fagyas ideje no, es a `sinceMs` NEM csuszik', () => {
    // Ha a `sinceMs` minden mintavetelnel frissulne, a fagyas SOHA nem erne el a
    // kuszobot -- a jel nemava valna anelkul, hogy barki eszrevenne.
    const prev = { tokens: 88000, sinceMs: 1000 }
    const r = nextTokenSample(prev, 88000, 61_000)
    expect(r.frozenMs).toBe(60_000)
    expect(r.sample).toEqual(prev)
  })

  it('olvashatatlan token -> frozenMs NULL, es a korabbi minta MEGMARAD', () => {
    const prev = { tokens: 88000, sinceMs: 1000 }
    expect(nextTokenSample(prev, null, 61_000)).toEqual({ sample: prev, frozenMs: null })
  })
})

describe('shouldEscalateStuckSession -- a BUSY-ag mostantol a HALADAST nezi', () => {
  const MIN = 60_000

  it('BUSY + a token MOZOG -> NINCS riasztas, akkor sem, ha regota busy', () => {
    // Ez az 59 mert zaj-eset. A porgo-jelzo 30+ percet mutat, a token viszont no.
    expect(shouldEscalateStuckSession('busy', 45 * MIN, 0)).toBe(false)
    expect(shouldEscalateStuckSession('busy', 120 * MIN, 2 * MIN)).toBe(false)
  })

  it('BUSY + a token 15 percnel regebben all -> RIASZT', () => {
    expect(shouldEscalateStuckSession('busy', 45 * MIN, 16 * MIN)).toBe(true)
  })

  it('BUSY + hosszu TOOL-HIVAS (a token all, de csak par perce) -> NINCS riasztas', () => {
    // Marveen mert esete (11:45): 32 perc porgo, valtozatlan 88.0k token, es az ok egy
    // futo TELJES BACKEND E2E volt. Ha a puszta mozdulatlansag riasztana, ez a fordulo
    // kapott volna egy "elakadt" jelzest a kellos kozepen.
    expect(shouldEscalateStuckSession('busy', 45 * MIN, 5 * MIN)).toBe(false)
  })

  it('BUSY, de a 30 perces kuszob alatt -> NINCS riasztas (a regi feltétel megmarad)', () => {
    expect(shouldEscalateStuckSession('busy', 20 * MIN, 60 * MIN)).toBe(false)
  })

  it('ISMERETLEN token-jel -> a REGI viselkedes, vagyis riaszt (fail-open)', () => {
    // Szandekos: egy nem mert jel nem lehet ok a HALLGATASRA. A mai riasztas zajos,
    // de a hallgatas egy VALODI elakadasnal dragabb -- es a not-ready agon van az
    // egyetlen valodi talalatunk.
    expect(shouldEscalateStuckSession('busy', 45 * MIN, null)).toBe(true)
  })

  it('A not-ready AG VALTOZATLAN: a token-jel NEM befolyasolja', () => {
    // A kartya dontesenek fele. Itt van az egyetlen valodi talalat (1/13), es a
    // token-jel bevezetese NEM nyulhat hozza -- egy nulla-talalatos ag javitasa nem
    // indok a mukodo ag piszkalasara.
    expect(shouldEscalateStuckSession('idle', 11 * MIN, 0)).toBe(true)
    expect(shouldEscalateStuckSession(null, 11 * MIN, 0)).toBe(true)
    expect(shouldEscalateStuckSession('idle', 9 * MIN, 99 * MIN)).toBe(false)
  })

  it('AZ OLVASHATATLAN PANEL NEM BUSY: hamarabb riaszt, nem kesobb', () => {
    expect(shouldEscalateStuckSession(null, 11 * MIN, null)).toBe(true)
  })
})

describe('a jel UGYANAZT olvassa, mint a kezi szerszam', () => {
  it('a token-minta megegyezik a scripts/agent-progress.sh mintajaval', () => {
    // Ha a ketto eltérne, a szkript es a router MAS valaszt adna ugyanarra a panelre --
    // es a kettot senki nem vetne ossze. A szkript a mai kezi diagnozis eszkoze.
    const sh = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'agent-progress.sh'),
      'utf-8',
    )
    expect(sh).toContain("([\\d.]+)k?\\s+tokens")
    // es a mi oldalunkon ugyanaz a ket eset ugyanazt adja
    expect(parsePaneTokens('↓ 43.6k tokens')).toBe(43600)
    expect(parsePaneTokens('↓ 940 tokens')).toBe(940)
  })
})

describe('A BEKOTES -- a router TENYLEG atadja a haladas-jelet', () => {
  // MA ESTE EZ A VISSZATERO LECKE (kartya b5bff340): egy UJ argumentumot, aminek van
  // ALAPERTELMEZESE, semmi nem tart a hivasi helyen. A tiszta fuggveny helyesen dolgozik,
  // a hivo elfelejti atadni, es MINDEN teszt zold marad -- a regi viselkedes csendben
  // visszaall. A tiz meglevo `router-stuck-alert` teszt epp ezert marad zold: azok a KET
  // argumentumos alakot hivjak.
  //
  // AMIT EZ NEM LAT (kimondva): forrasszoveget olvas. Egy valtozo atnevezese pirosra valt
  // anelkul, hogy barmi elromlana. Cserebe egy ELMARADT bekotes nem tud eszrevetlen maradni.
  const routerSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'message-router.ts'),
    'utf-8',
  )

  it('a hivas HAROM argumentumot ad at, nem kettot', () => {
    expect(routerSrc).toMatch(/shouldEscalateStuckSession\(paneState, stuckMs, frozenMs\)/)
  })

  it('a jel UGYANABBOL a capture-bol jon, extra tmux-hivas nelkul', () => {
    // Ha ez egy MASODIK capturePane-re menne, a ket olvasat kulonbozo pillanatot mutatna,
    // es a "nem mozdult" allitas ket kulonbozo panelrol szolna.
    expect(routerSrc).toMatch(/nextTokenSample\([\s\S]{0,120}parsePaneTokens\(pane\)/)
  })

  it('a haladas-jel allapota TAKARITODIK, amikor a session eltunik vagy keszen all', () => {
    // Kulonben egy uj session egy REGI token-szamot orokolne, es az elso mintavetel
    // azonnal "fagyottnak" latszana.
    const deletes = routerSrc.match(/agentTokenSample\.delete\(/g) ?? []
    expect(deletes.length).toBeGreaterThanOrEqual(2)
  })
})
