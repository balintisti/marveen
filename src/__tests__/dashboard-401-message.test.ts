import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

// A 401 EMBERI VALASZA (kartya 3cc50c2a).
//
// A LELET: a gazda azt jelentette, hogy "nem mukodik". A rendszer futott -- a
// `GET /` 200-at adott, es a Bearer fejleccel kuldott `GET /api/kanban` is --,
// a kepernyon viszont "Hiba: HTTP 401" allt minden dobozban, mogotte egy ANGOL
// `alert()`-tel. Vagyis egy ELUTASITASBOL lett LEALLAS-diagnozis, es a kepernyo
// pont ezt allitotta.
//
// Egy statuszkod nem uzenet: a 401 a HTTP-nek szol, nem az embernek.
//
// EZ A FAJL KETFELE MER, ES A KETTO NEM HELYETTESITI EGYMAST:
//   1. a HUMANIZALO fuggveny VISELKEDESE (a fuggvenyt kiemelve futtatjuk)
//   2. a BEKOTES szerkezete (hogy a fuggveny oda van kotve, ahol szamit)
// A masodik szoveg-rogzites, es ki is van mondva -- egy bongeszo-teszt nelkul
// ez a hatar.

/** A `window.mvHumanError` fuggveny kiemelve az app.js-bol, futtathatoan. */
function humanizer(reason: string | undefined, t?: (k: string) => string) {
  const w: Record<string, unknown> = { __marveenAuthReason: reason }
  if (t) w['t'] = t
  const src = APP.slice(APP.indexOf('window.mvHumanError = (raw) =>'))
  const body = src.slice(0, src.indexOf('\n  }') + 4)
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function('window', body + '\nreturn window.mvHumanError') as (w: unknown) => (raw: unknown) => string
  return fn(w)
}

describe('mvHumanError -- a fogalmazas EGY helyen all', () => {
  it('"nincs kulcs" allapotban EMBERI mondatot ad a statuszkod helyett', () => {
    expect(humanizer('no-key')('HTTP 401')).toMatch(/[Nn]incs eltarolva belepesi kulcs/)
  })

  it('"elutasitva" allapotban MAS mondatot ad -- nem allitja, hogy nincs kulcs', () => {
    // A kartya kikotese: egy magabiztos, de rossz magyarazat rosszabb a
    // statuszkodnal. Ha VOLT kulcs, nem mondhatjuk, hogy nincs.
    const msg = humanizer('rejected')('HTTP 401')
    expect(msg).toMatch(/ervenytelen vagy lejart/)
    expect(msg).not.toMatch(/[Nn]incs eltarolva/)
  })

  it('ISMERETLEN ok eseten a NYERS szoveget adja vissza, nem talal ki magyarazatot', () => {
    // Ez a hatar. Ha a burkolat nem latta a 401-et (pl. mas eredetu hiba), nincs
    // mit allitani -- es a statuszkod tobbet er egy hamis mondatnal.
    expect(humanizer(undefined)('HTTP 401')).toBe('HTTP 401')
  })

  it('NEM 401-es hibahoz hozza sem nyul', () => {
    expect(humanizer('no-key')('HTTP 500')).toBe('HTTP 500')
    expect(humanizer('no-key')('Network error')).toBe('Network error')
  })

  it('a forditott szoveget hasznalja, ha van `t()`', () => {
    expect(humanizer('no-key', (k) => k === 'auth.nokey.short' ? 'FORDITOTT' : '')('HTTP 401'))
      .toBe('FORDITOTT')
  })

  it('nem szall el null/undefined bemeneten', () => {
    expect(humanizer('no-key')(null)).toBe('')
    expect(humanizer('no-key')(undefined)).toBe('')
  })
})

describe('a BEKOTES -- szoveg-rogzites, es ez a hatara', () => {
  it('az OK a kulcs TORLESE ELOTT rogzul', () => {
    // Ket sorral lejjebb toroljuk a kulcsot, tehat onnantol a ket allapot
    // megkulonboztethetetlen. Ha a rogzites a torles UTAN allna, mindig
    // "nincs kulcs" jonne ki -- epp a hamis magabiztossag, amit tiltunk.
    const reason = APP.indexOf('__marveenAuthReason = hadToken')
    const wipe = APP.indexOf('localStorage.removeItem(TOKEN_KEY)', reason - 2000)
    expect(reason).toBeGreaterThan(-1)
    expect(reason).toBeLessThan(APP.indexOf('localStorage.removeItem(TOKEN_KEY)', reason))
    expect(wipe).toBeGreaterThan(-1)
  })

  it('a kozponti toast MEGKERDEZI az okot', () => {
    // A fuggveny TORZSEIG olvasunk, nem egy fix karakterszamig: az elso
    // valtozat 400 karakterre vagott, es egy KOMMENT-bovites elbuktatta --
    // vagyis a proza mozgatta a hatart, nem a kod.
    const start = APP.indexOf('function showToast(')
    const body = APP.slice(start, APP.indexOf('\n  }', start))
    expect(body).toContain('window.mvHumanError')
  })

  it('a regi ANGOL alert() MAR NINCS a hitelesitesi agban', () => {
    expect(APP).not.toContain('Dashboard authentication failed. Check the server log')
  })

  it('az overlay a NAPLOT nevezi meg, es NEM irja ki a tokent', () => {
    const ov = APP.slice(APP.indexOf('function showNoKeyOverlay('))
    const body = ov.slice(0, ov.indexOf('\n  }') + 4)
    expect(body).toContain('store/dashboard.log')
    // A token a naploban all; a kepernyore tenni feleslegesen sokszorozna a
    // helyet, ahol megjelenik.
    expect(body).not.toMatch(/TOKEN_KEY\)|getItem\(/)
  })
})

describe('a nyelvi fajlok', () => {
  it('mindket nyelv ismeri az uj kulcsokat', () => {
    const hu = readFileSync(join(ROOT, 'web', 'lang', 'hu.js'), 'utf-8')
    const en = readFileSync(join(ROOT, 'web', 'lang', 'en.js'), 'utf-8')
    for (const k of ['auth.nokey.title', 'auth.nokey.short', 'auth.nokey.how', 'auth.rejected.title', 'auth.rejected.short']) {
      expect(hu, `hu: ${k}`).toContain(`'${k}'`)
      expect(en, `en: ${k}`).toContain(`'${k}'`)
    }
  })
})

// AZ OR: MINDEN HIBA-MEGJELENITES MENJEN AT A FOGALMAZON -- ES A POPULACIO
// SZARMAZTATOTT, NEM FELSOROLT (didi lelete, 2026-08-23).
//
// A LELET: az elso javitasom a kozponti `showToast`-ba kotote be a fogalmazot,
// es a kommentje azt allitotta, hogy a 28 gyarto hely "mind ide fut be".
// NEM IGAZ: TIZENHET hely KOZVETLENUL ir DOM-ba, es soha nem ert a toasthoz --
// es epp azok a DOBOZOK. A kartyat szulo kepernyokepen egy doboz allt
// ("Aktivitas -- Hiba: HTTP 401"), nem egy toast: a toast atmeneti, a doboz
// OTT MARAD.
//
// EZERT NEM EGY LISTA VAN ITT, HANEM EGY SZARMAZTATAS. Egy felsorolt lista
// pontosan azokat a helyeket vedi, amik a felirasakor leteztek -- a tizennyolcadik
// doboz holnap ugyanugy kimaradna. A teszt MEGKERESI az osszes DOM-irast, es
// mindegyikre allitja, hogy a fogalmazon at megy.
describe('MINDEN hiba-megjelenites a fogalmazon at megy (szarmaztatott populacio)', () => {
  /**
   * Minden sor, ami HIBAT ir DOM-ba -- akar a nyers `err.message`-dzsel, akar a
   * fogalmazon at.
   *
   * A POPULACIOT NEM A DEFEKTUSBOL SZARMAZTATJUK, ES EZ MERT DEFEKTUS-JAVITAS:
   * az elso valtozatom csak a `(err|e).message` alakra szurt -- vagyis pontosan
   * arra, amit a javitas MEGSZUNTET. A javitas utan a populacio NULLA lett, es
   * az `it.each` nulla esetet futtatva ZOLD maradt volna. Egy or, ami nulla
   * elemet ellenoriz, pontosan ugy nez ki, mint egy or, ami mindent rendben
   * talal. A sajat pozitiv kontrollja fogta meg (`a populacio NEM URES`).
   */
  const domWrites = APP.split('\n')
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /(innerHTML|textContent)[^=]*=/.test(line))
    .filter(({ line }) => /\b(err|e)\.message\b/.test(line) || /mvErrText\(/.test(line))

  // A POPULACIO MERETE A JAVITAS ELOTT ES UTAN UGYANAZ: 15 sor. Elotte mind a
  // 15 FEDETLEN volt, utana mind a 15 FEDETT -- nem 15 -> 0.
  // Ez didi erosebb kontrollja, es a helyes populacio-definicio PROBAJA: ha a
  // szam CSOKKENNE a javitastol, akkor a szures a HIBA alakjara ment, es a
  // sikeres javitas megvakitana az ort.
  const POPULACIO_ALAPVONAL = 15

  it('a populacio NEM URES -- kulonben a teszt semmit nem allit', () => {
    // Egy or, ami nulla elemet ellenoriz, pontosan ugy nez ki, mint egy or,
    // ami mindent rendben talal.
    expect(domWrites.length).toBeGreaterThan(5)
  })

  it('a populacio MERETE nem csokken -- a javitas nem vakithatja meg az ort', () => {
    // Uj hiba-megjelenites JOHET (a szam nohet); eltunnie viszont csak akkor
    // szabad, ha valaki tenylegesen TOROL egy dobozt -- es akkor ezt a szamot
    // ugyanabban a commitban kell frissiteni, latható modon.
    expect(domWrites.length).toBeGreaterThanOrEqual(POPULACIO_ALAPVONAL)
  })

  it('EGYETLEN DOM-iras sem hasznal NYERS err.message-t', () => {
    const nyers = domWrites.filter(({ line }) => !/mvErrText\(/.test(line))
    expect(nyers.map(x => `app.js:${x.no}`)).toEqual([])
  })
})

describe('mvErrText -- a hibaobjektumot is kezeli', () => {
  function errText(reason: string | undefined) {
    const human = humanizer(reason)
    const w = { mvHumanError: human } as Record<string, unknown>
    const src = APP.slice(APP.indexOf('window.mvErrText = (err) =>'))
    const body = src.slice(0, src.indexOf('\n\n'))
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return (new Function('window', body + '\nreturn window.mvErrText') as (w: unknown) => (e: unknown) => string)(w)
  }

  it('Error objektumbol a MESSAGE-et veszi, es fogalmaz', () => {
    expect(errText('no-key')(new Error('HTTP 401'))).toMatch(/[Nn]incs eltarolva/)
  })

  it('nyers stringet is elfogad', () => {
    expect(errText('no-key')('HTTP 401')).toMatch(/[Nn]incs eltarolva/)
  })

  it('ismeretlen ok eseten a NYERS szoveget adja -- a hatar valtozatlan', () => {
    expect(errText(undefined)(new Error('HTTP 500'))).toBe('HTTP 500')
  })
})
