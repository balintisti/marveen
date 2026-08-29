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

  /**
   * MINDEN hivasi hely, a DEFINICIO nelkul -- es a hozza tartozo argumentum-szam.
   *
   * Az elso valtozatom egyetlen `toMatch`-csel allitotta, hogy "a hivas harom argumentumot
   * ad at". Jarvis megfogta: az JELENLETET mer, nem MEGFELELTETEST. Egy MASODIK, ket
   * argumentumos hivas mellett a minta tovabbra is illeszkedik az elsore, es a teszt zold
   * marad -- kozben az uj hivasi helyen csendben visszaall a regi viselkedes, mert az uj
   * argumentumnak ALAPERTELMEZESE van.
   *
   * Ezert a populacio a FORRASBOL szarmazik, es MINDEN talalatra allitunk.
   */
  function callSites(): { args: number; text: string }[] {
    const out: { args: number; text: string }[] = []
    const rx = /shouldEscalateStuckSession\(/g
    for (let m = rx.exec(routerSrc); m !== null; m = rx.exec(routerSrc)) {
      const open = m.index + m[0].length - 1
      // A DEFINICIOT kihagyjuk: azt az `export function` elozi meg.
      if (/export function\s*$/.test(routerSrc.slice(Math.max(0, m.index - 40), m.index))) continue
      let depth = 0, end = open
      for (let i = open; i < routerSrc.length; i++) {
        if (routerSrc[i] === '(') depth++
        else if (routerSrc[i] === ')') { depth--; if (depth === 0) { end = i; break } }
      }
      const inner = routerSrc.slice(open + 1, end)
      // Felso szintu vesszok szamolasa (egy beagyazott hivas vesszoi nem szamitanak).
      let d = 0, commas = 0
      for (const ch of inner) {
        if (ch === '(' || ch === '[' || ch === '{') d++
        else if (ch === ')' || ch === ']' || ch === '}') d--
        else if (ch === ',' && d === 0) commas++
      }
      out.push({ args: inner.trim() ? commas + 1 : 0, text: inner.trim() })
    }
    return out
  }

  it('a harmadik argumentum A JEL, nem egy tetszoleges harmadik ertek', () => {
    // JARVIS KIKOTESE, ES MERTEM IS (2026-08-24): a szerkezeti allitas (lent) HAROM
    // argumentumot kovetel, de nem mondja meg, MI a harmadik. Megmutatva: a hivast
    // `shouldEscalateStuckSession(paneState, stuckMs, 0)`-ra irva a keszlet ZOLD MARADT --
    // es az a hivas SOHA nem riasztana a BUSY-agon (a "0 ms-a fagyott" mindig a kuszob alatt
    // van). Vagyis a zaj helyett TELJES NEMASAG jonne, ami rosszabb a kiindulasnal.
    //
    // Ezert a ket allitas KET KULONBOZO KERDES, es egyik sem helyettesiti a masikat:
    //   ez itt        -> a KONKRET argumentumot koti (frozenMs)
    //   a kovetkezo   -> a SZERKEZETET koti (minden hivas harom argumentumot ad at)
    // Jarvis nem cserekent javasolta, hanem melle -- es a meres ot igazolja.
    expect(routerSrc).toMatch(/shouldEscalateStuckSession\(paneState, stuckMs, frozenMs\)/)
  })

  /**
   * A SOPRES NULL TOKEN-OLVASASA NAPLOZODJON (kartya bd7de2ba, jarvis kimondott hatara).
   *
   * Egy `null` token-olvasas `frozenMs: null`-t ad, az pedig FAIL-OPEN -- a 09906ebf
   * SZANDEKOLT szemantikaja szerint, nem hianyzo bekotes miatt. Kivulrol a ketto AZONOS:
   * mindketto ugy nez ki, hogy a kapu nem szol. Ha a sopres nemán fail-openre valt, az
   * megkulonboztethetetlen attol, hogy a bekotes hianyzik -- es epp ezt a kulonbseget
   * epitettuk ma ejjel a tetlen-or kiertekelesi soraba is.
   *
   * A sopres hivasi helyet a KULCSA azonositja: `agent`, nem `msg.to_agent`.
   */
  function sweepTokenBlock(): string {
    const KEY = 'nextTokenSample(agentTokenSample.get(agent)'
    const hits = routerSrc.split(KEY).length - 1
    // Kontroll az egyediseg ellen: egy masodik, azonos kulcsu hivas eseten az `indexOf`
    // onkenyesen valasztana. Ez ma ejjel egy MASIK oron valodi hamis atengedes volt.
    expect(hits, `a sopres nextTokenSample hivasa pontosan egyszer szerepeljen, ${hits} talalat`).toBe(1)
    const at = routerSrc.indexOf(KEY)
    // A NULL-AG BLOKKJA, nem egy fix ablak. Az elso valtozatom 700 karaktert vagott ki innen
    // es abban keresett `logger.`-t -- es a mutacio megfogta: a naplo-sorokat KITOROLVE a
    // teszt ZOLD maradt, mert az ablakba beleert az ALATTA levo eszkalacios `logger.warn`.
    // A mero hatoköre szelesebb volt a kerdesnel, es egy szomszedos ERVENYES peldany
    // elegitette ki -- ugyanaz az alak, mint az `indexOf('{')` lelet a masik oron.
    const nullAt = routerSrc.indexOf('if (tokens == null)', at)
    expect(nullAt, 'a sopresben legyen egy `tokens == null` ag').toBeGreaterThan(at)
    const open = routerSrc.indexOf('{', nullAt)
    let depth = 0, end = -1
    for (let i = open; i < routerSrc.length; i++) {
      if (routerSrc[i] === '{') depth++
      else if (routerSrc[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    expect(end, 'a null-ag blokkja nem zarodik').toBeGreaterThan(open)
    return routerSrc.slice(open, end)
  }

  it('a sopres NULL token-olvasasa naplozodik -- kulonben a fail-open nema', () => {
    const block = sweepTokenBlock()
    expect(block, 'a null-agnak SZOLNIA kell -- egy nema fail-open ugyanugy nez ki, mint egy hianyzo bekotes')
      .toContain('logger.')
  })

  it('KONTROLL: mindket ut hasznal token-mintat, nem csak a kezbesitesi', () => {
    // Ha ez valaha 1-re esik, az egyik ut visszament fail-openbe.
    const sites = routerSrc.split('nextTokenSample(').length - 1
    expect(sites, 'ket hivasi hely kell: a kezbesitesi hurok es a csendes-agens sopres').toBe(2)
  })

  it('MINDEN hivasi hely harom argumentumot ad at -- nem csak az elso', () => {
    const sites = callSites()
    // Kontroll a nema atmenes ellen: ha a kereso egy nap nullat adna, a ciklus semmit
    // nem allitana. (Ma pontosan egy hivas van; a szam NOHET, de nullara nem eshet.)
    expect(sites.length).toBeGreaterThanOrEqual(1)
    for (const site of sites) {
      expect(site.args, `ket argumentumos hivas: shouldEscalateStuckSession(${site.text})`).toBe(3)
    }
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
