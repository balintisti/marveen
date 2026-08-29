// A `behind: 0` NEM MERES VOLT, HANEM A KEZDOERTEK -- kartya d3770ec4.
//
// MERVE az ELO vegponton, ket alkalommal 16 ora kulonbseggel (jarvis 08-27 12:37,
// friday 08-28 05:19):
//     {"remote":"Szotasz/marveen","behind":0,
//      "error":"GitHub /commits/feat/google-service-account -> 422"}
// A nulla ugyanabban a valaszban all, amiben az `error` -- tehat a lekerdezes EL SEM
// JUTOTT az osszevetesig. A hivo szamara ez megkulonboztethetetlen volt attol, hogy a
// checkout naprakesz.
//
// A KAR HELYE, es ez pontosabb, mint ahogy a lelet elsore allt: az Updates OLDAL
// kezeli az `error`-t es kiirja, hogy a lekerdezes nem sikerult (az az ag helyes volt).
// A NAV-JELVENY viszont `(status.behind) || 0`-t szamolt, es nullanal ELREJTETTE magat
// -- vagyis minden feluleten, amit megnyitas nelkul latni, a kudarc ugy nezett ki, mint
// a "nincs frissites".
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CHECKER = readFileSync(join(ROOT, 'src', 'web', 'update-checker.ts'), 'utf-8')
const APP = readFileSync(join(ROOT, 'web', 'app.js'), 'utf-8')

describe('a checker: a nem mert allapot NULL, nem nulla', () => {
  it('a tipus megengedi a `null`-t -- kulonben nincs mivel kifejezni a "nem tudom"-ot', () => {
    expect(CHECKER).toMatch(/behind: number \| null/)
  })

  it('a frissitesi kor kezdoerteke NEM 0', () => {
    // A `refreshUpdateStatus` altal osszeallitott statusz init-je. Ha ez 0, minden
    // hibaag ujra "naprakesz"-t allit.
    const fn = CHECKER.slice(CHECKER.indexOf('export async function refreshUpdateStatus'))
    const init = fn.slice(0, fn.indexOf('if (!current)'))
    expect(init).toMatch(/behind: null/)
    expect(init).not.toMatch(/behind: 0/)
  })

  it('a nullat CSAK a ket MERT ag allitja be', () => {
    // (1) a remote feje == a helyi HEAD, (2) a fork-pont MAR az upstream feje.
    const zeros = [...CHECKER.matchAll(/status\.behind = 0/g)]
    expect(zeros.length).toBe(2)
    // es mindketto mellett ott az indoklas, hogy MERT nulla
    const around = zeros.map(m => CHECKER.slice(Math.max(0, m.index - 320), m.index))
    for (const ctx of around) expect(ctx).toMatch(/MERT nulla/)
  })

  it('a `merge-base` BUKASA mostantol hibat allit, nem nullat', () => {
    // Ez az ag korabban `behind = 0`-t adott, pedig itt semmit nem sikerult megmerni.
    const branch = CHECKER.slice(CHECKER.indexOf('} else if (!base) {'), CHECKER.indexOf('} else {', CHECKER.indexOf('} else if (!base) {')))
    expect(branch).toMatch(/status\.error/)
    expect(branch).not.toMatch(/status\.behind = 0/)
  })
})

describe('a jelveny: a kudarc NEM nezhet ki ugy, mint a "nincs frissites"', () => {
  // A DONTES FUTTATVA, nem a kod jelenletere allitva. Ezt egy mutacio kenyszeritette
  // ki: a korabbi valtozatban a feltetelt `false`-ra cserelve MIND a het teszt zold
  // maradt -- jelenlet-teszt volt, nem megfeleltetes (`jelenlet-vagy-megfeleltetes`).
  const src = APP.slice(APP.indexOf('function updatesBadgeState(status)'), APP.indexOf('function renderUpdatesBadge(status)'))
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const badgeState = new Function(`${src}; return updatesBadgeState`)() as (s: unknown) => { show: boolean; text: string; unknown: boolean; title?: string }

  it('VALODI nulla -> a jelveny REJTVE marad', () => {
    expect(badgeState({ behind: 0 })).toMatchObject({ show: false })
  })

  it('ELBUKOTT ellenorzes (behind 0 + error) -> LATSZIK, es nem szamot igér', () => {
    // Pontosan a ket alkalommal mert elo valasz.
    const r = badgeState({ behind: 0, error: 'GitHub /commits/feat/google-service-account -> 422' })
    expect(r.show).toBe(true)
    expect(r.text).toBe('?')
    expect(r.unknown).toBe(true)
    expect(r.title).toMatch(/422/)
  })

  it('NEM MERT (`behind: null`) -> szinten latszik', () => {
    expect(badgeState({ behind: null })).toMatchObject({ show: true, text: '?' })
  })

  it('VALODI szam -> a szam latszik, es NEM "ismeretlen"', () => {
    expect(badgeState({ behind: 3 })).toMatchObject({ show: true, text: '3', unknown: false })
  })

  it('a verzio-szam nyer a nyers commit-szam elott (regi viselkedes, valtozatlan)', () => {
    expect(badgeState({ behind: 7, releases: [{ version: 'v1.2.0' }, { version: '' }] })).toMatchObject({ text: '1' })
  })
})
