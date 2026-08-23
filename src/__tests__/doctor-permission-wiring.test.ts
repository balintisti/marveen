import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// A BEKOTES, mert az or letezese es a lefutasa KET KULON KERDES (kartya caaf32a4).
//
// MERT ESET, ES ROLAM SZOL: megirtam a `permission-guard-check.sh`-t kilenc teszttel,
// didi ot szintetikus kontrollal fuggetlenul igazolta, hogy MUKODIK -- es kozben
// `git grep permission-guard-check` EGYETLEN talalatot adott: a sajat tesztemet.
// Vagyis az or, ami epp az ellen epult, hogy egy vedelem NEM SUL EL, maga sem sult
// volna el soha. A kartya cime is "doctor.sh egy sora"-t mond; az az egy sor hianyzott.
//
// AMIT EZ A FAJL NEM LAT, kimondva: szoveget olvas, nem futtatja a doctort. Egy
// atnevezett valtozo pirosra valtja anelkul, hogy barmi elromlana -- ez a szerkezeti
// rogzites ara, es vallaljuk. Amit CSERELBE ad: egy hianyzo hivas nem tud eszrevetlen
// maradni.
const DOCTOR = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'doctor.sh'),
  'utf-8',
)

/**
 * A szekcio szovege, nem az egesz fajl. Egy globalis grep akkor is talalna, ha a
 * hivatkozas egy MASIK szekcioban (vagy egy kommentben) all -- pontosan az a
 * "jelenlet kontra megfeleltetes" alak, amibe ma este tobbszor belefutottunk.
 */
function section(title: string): string {
  const start = DOCTOR.indexOf(`# --- ${title}`)
  if (start < 0) throw new Error(`nincs ilyen szekcio a doctor.sh-ban: ${title}`)
  const next = DOCTOR.indexOf('\n# --- ', start + 1)
  return DOCTOR.slice(start, next < 0 ? undefined : next)
}

describe('doctor.sh -- a jogosultsagi or BE VAN KOTVE', () => {
  // LUSTA hivas, nem `const sec = section(...)` a describe torzseben. Merve
  // (2026-08-24): a szekciot TELJESEN torolve a describe-szintu hivas COLLECT-hibat
  // dobott, es a futas "Tests no tests"-et irt -- vagyis a fajl nem egy PIROS
  // ALLITAST adott, hanem eltunt. A suite-meret or (A) aga megfogja ugyan, de egy
  // bekotes-teszt maga ne egy MASIK or-re bizza, hogy eszrevegyek a hianyat.
  const sec = (): string => section('Coordinator permission brake')

  it('a szekcio letezik, es a kivagas nem ures (kontroll a nema atmenes ellen)', () => {
    expect(sec().length).toBeGreaterThan(200)
    expect(() => section('Nincs Ilyen Szekcio')).toThrow(/nincs ilyen szekcio/)
  })

  it('TENYLEG hivja a szkriptet -- a szekcion BELUL', () => {
    expect(sec()).toMatch(/bash scripts\/permission-guard-check\.sh/)
  })

  it('a FAIL sor HIBAKENT jelenik meg, nem elnyelve', () => {
    // A legfontosabb allitas: ha a FAIL az `ok`-ra vagy az `echo`-ra kepzodne, a
    // doktor ZOLD maradna egy olyan gepen, ahol nincs fek a koordinatoron.
    expect(sec()).toMatch(/FAIL\)\s*fail "\$text"/)
    expect(sec()).toMatch(/OK\)\s*ok "\$text"/)
  })

  it('a SOROKAT olvassa, NEM a kilepesi kodot', () => {
    // A szkript szandekosan MINDIG 0-val lep ki (a hivo dont). Aki a kilepesi kodra
    // kotne, csendben atengedne minden talalatot -- didi kulon kiirta ezt a sort.
    expect(sec()).toMatch(/IFS='\|' read -r status text/)
    expect(sec()).not.toMatch(/permission-guard-check\.sh[^\n]*\|\|/)
  })

  it('a hianyzo szkript sem nema: van kulon aga', () => {
    expect(sec()).toMatch(/missing or not executable/)
    expect(sec()).toMatch(/no output/)
  })
})
