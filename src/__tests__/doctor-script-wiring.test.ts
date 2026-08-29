import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// MINDEN doctor-szekcio, ami KULSO SZKRIPTET HIV, HASZNALJA IS AZ EREDMENYT (kartya 57a92e12).
//
// A LELET (didi, 2026-08-24): a `doctor.sh` tobb szekcioja hiv kulso szkriptet, es ma EGYNEK
// van bekotes-tesztje. Didi kivette a hivasokat a fedetlen szekciokbol, es a TELJES keszlet
// zold maradt (334 fajl / 4474 teszt, mindket allapotban). Vagyis az elv, amit a `caaf32a4`-en
// mondtunk ki -- "egy or LETEZESE es a LEFUTASA ket kulon kerdes" -- ugyanabban a fajlban meg
// tobb helyen all fedetlenul.
//
// MIERT NEM HAROM KULON TESZT, ES MIERT NEM KEZI LISTA (didi javaslata, atveve): egy kezzel
// felsorolt lista mellett a KOVETKEZO szekcio megint kimarad -- ugyanaz az alak, mint minden
// mas felsorolas ezen a lapon. Ezert a populacio A FAJLBOL szarmazik.
//
// ES EGY MERES, AMI NELKUL EZ AZ OR HAMISAN RIASZTANA (friday, 2026-08-24): a
// "Managed-settings" szekcio EMLITI a `scripts/ensure-managed-channels-enabled.sh`-t -- egy
// `warn` uzenet SZOVEGEBEN, javaslatkent. Az nem hivas, es nincs mit fogyasztani belole.
// Egy naiv `bash scripts/*.sh` grep ezt is hivasnak venne, es a kezenfekvo "javitas" az lenne,
// hogy valaki KIVESZI a hasznos javaslatot a hibauzenetbol. Ezert valik szet a HIVAS es az
// EMLITES, es ezert van rá sajat allitas.
const DOCTOR = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'doctor.sh'),
  'utf-8',
)

interface Section { title: string; body: string; lines: { n: number; text: string }[] }

function sections(): Section[] {
  const out: Section[] = []
  const all = DOCTOR.split('\n')
  let cur: Section | null = null
  for (let i = 0; i < all.length; i++) {
    const line = all[i] as string
    const m = /^# --- (.+?) ---/.exec(line)
    if (m) {
      if (cur) out.push(cur)
      cur = { title: m[1] as string, body: '', lines: [] }
    }
    if (cur) {
      cur.body += line + '\n'
      cur.lines.push({ n: i + 1, text: line })
    }
  }
  if (cur) out.push(cur)
  return out
}

const INVOKE_RX = /bash\s+scripts\/[A-Za-z0-9_-]+\.(?:sh|py)/
/** Egy uzenet SZOVEGEBEN allo szkriptnev nem hivas -- javaslat az olvasonak. */
const MENTION_RX = /(?:echo|warn|fail|ok)\s+(?:-e\s+)?"/

/**
 * HIVAS-E EZ A SOR? A dontes NEM az idezojelen all, hanem a PARANCSHELYETTESITESEN.
 *
 * DIDI LELETE (2026-08-24), sajat kezbol ujramerve az ot jelolt soron: a puszta
 * idezojel-vizsgalat KETTOT a VESZELYES iranyba tevesztett --
 * `echo "$(bash scripts/x.sh)"` es `ok "$(bash scripts/x.sh | head -1)"` EMLITESNEK
 * konyvelodott, pedig VALODI hivas. Egy ilyen sorral a szekcio kiesne a populaciobol, es az
 * or rola tobbe SEMMIT nem allitana -- nemán, ami a legrosszabb kimenet.
 *
 * MA nincs ilyen sor a `doctor.sh`-ban (a ket kulon detektorunk a mai fajlon EGYETERT), tehat
 * ez HOLNAPRA szolo javitas. Epp ezert kerult be: egy detektor, ami a MAI fajlon jol dolgozik,
 * nem ugyanaz, mint egy detektor, ami HELYES.
 */
function isInvocation(line: string): boolean {
  const m = INVOKE_RX.exec(line)
  if (!m) return false
  const before = line.slice(0, m.index)
  // Nyitott `$(` a talalat elott -> parancshelyettesites, tehat HIVAS, akkor is, ha
  // idezojelen belul all. (A zarojel-merleg kozelites, de a hej-idezojelnel eleg.)
  const open = (before.match(/\$\(/g) ?? []).length - (before.match(/\)/g) ?? []).length
  if (open > 0) return true
  return !MENTION_RX.test(before)
}

function invokingSections(): { title: string; calls: number; body: string }[] {
  return sections()
    .map((s) => ({
      title: s.title,
      body: s.body,
      calls: s.lines.filter((l) => isInvocation(l.text)).length,
    }))
    .filter((s) => s.calls > 0)
}

/**
 * HASZNALJA-E a szekcio a hivas eredmenyet? Harom ELFOGADOTT alak, mert a negy szkript
 * szerzodese kulonbozik, es egy egysegesitett alak eroltetese itt karos lenne:
 *   (a) valtozoba kapja el, es a valtozot kesobb OLVASSA is    -> a sor-alapu szerzodes
 *   (b) a kilepesi kodra agazik (`if ! bash ...`, `|| ...`)     -> a verdikt-alapu szerzodes
 *   (c) csoben feldolgozza (`| while read` / `| grep`)          -> a megjelenito ut
 */
function consumesResult(body: string): boolean {
  const capture = /([A-Z_][A-Z0-9_]*)="\$\(\s*bash\s+scripts\//.exec(body)
  if (capture) {
    const varName = capture[1] as string
    // A puszta ertekadas NEM fogyasztas: a valtozonak MEG EGYSZER elo kell fordulnia.
    const uses = body.split(`$${varName}`).length - 1 + (body.split(`\${${varName}`).length - 1)
    if (uses > 0) return true
  }
  if (/if\s+!\s*bash\s+scripts\//.test(body)) return true
  if (/bash\s+scripts\/[A-Za-z0-9_-]+\.(?:sh|py)[^\n]*\|\s*(?:grep|while|python3|sed|awk)/.test(body)) return true
  return false
}

/**
 * VAN-E A SZEKCIONAK ERVENYES VERDIKTJE?
 *
 * A "hasznalja-e az eredmenyt" kerdes szekcio-szinten TUL DURVA, es ezt egy mutacio
 * mutatta meg (friday, 2026-08-24): a Channel health szekcio KET hivast tesz -- egyet a
 * MEGJELENITESRE (csoben), egyet a VERDIKTRE (kilepesi kod). A verdikt-utat kivéve a
 * szekcio tovabbra is "hasznalja" az eredmenyt (a cso megvan), tehat az elozo allitas
 * ZOLD maradt -- kozben a doktor mar csak MUTATNA az egeszsegtelen csatornat, es
 * "All OK"-kal zarna.
 *
 * ES A CSAPDA, AMIT A doctor.sh SAJAT KOMMENTJE MAR ISMER (87. sor: "Re-check exit code
 * separately since subshell can't set FAIL"): a csoben futo `while` ALHEJ, tehat a benne
 * allo `FAIL=1` ELVESZIK. Vagyis a megjelenito ut latszolag ad verdiktet, valojaban nem.
 * Ezert a csobol etetett `while ... done` blokk NEM szamit verdiktnek.
 *
 * A HATAR, KIMONDVA: ez azt kovetelI, hogy MINDEN szkriptet hivo szekcio adjon verdiktet.
 * Ma mind a harom ad. Ha egyszer keletkezik egy szandekosan CSAK TAJEKOZTATO szekcio, ez
 * hamisan riasztana -- akkor NEM a szabalyt kell kikapcsolni, hanem a kivetelt kimondani.
 */
function hasEffectiveVerdict(body: string): boolean {
  // A csobol etetett while-blokkok kivagasa: ami bennuk all, alhejban all.
  // A `done` NEM feltetlenul sor elején all (egysoros alak: `| while read l; do X; done`).
  // Az elso valtozatom `\ndone`-t kert, es a SAJAT KONTROLL-TESZTEM buktatta meg -- pont azert
  // irtam a kontrollt, mert egy felismero, amit senki nem mer, ugyanolyan hitre epul, mint az
  // or, amit helyettesit.
  const withoutSubshells = body.replace(/\|\s*while[\s\S]*?done/g, '')
  return /(?:^|\s)fail\s+"/.test(withoutSubshells) || /(?:^|\s)FAIL=1/.test(withoutSubshells)
}

describe('doctor.sh -- minden szkript-hivas eredmenye FEL IS VAN HASZNALVA', () => {
  it('a populacio A FAJLBOL jon, es nem ures (kontroll a nema atmenes ellen)', () => {
    const inv = invokingSections()
    // Ha a parser egy nap ures listat adna, az alabbi ciklus SEMMIT nem allitana -- pontosan
    // az a nema siker, ami ellen ez az or epult.
    // A SZAM AGFUGGO, es ez nem hiba: a torzson MA ket hivo szekcio van (Channel health,
    // Google access), a `caaf32a4` aga hoz egy harmadikat (Coordinator permission brake).
    // Ezert a kontroll ALSO KORLAT + nevesitett horgonyok, nem pontos egyezes -- kulonben
    // a kovetkezo szekcio hozzaadasa buktatna a tesztet, es a "javitas" a szam atirasa lenne.
    expect(inv.length).toBeGreaterThanOrEqual(2)
    expect(inv.map((s) => s.title)).toEqual(
      expect.arrayContaining(['Channel health', 'Google access (calendar + Drive + mail)']),
    )
    expect(sections().length).toBeGreaterThan(10)
  })

  it('MINDEN hivo szekcio hasznalja az eredmenyt', () => {
    for (const s of invokingSections()) {
      expect(consumesResult(s.body), `a(z) "${s.title}" szekcio hiv egy szkriptet, de nem hasznalja az eredmenyet`).toBe(true)
    }
  })

  it('MINDEN hivo szekcio ad ERVENYES verdiktet -- alhejban elveszo FAIL nem szamit', () => {
    for (const s of invokingSections()) {
      expect(hasEffectiveVerdict(s.body), `a(z) "${s.title}" szekcio hiv, de nem tud FAIL-t adni (vagy csak alhejban)`).toBe(true)
    }
  })

  it('a verdikt-felismero KIZARJA a csobol etetett while-blokkot (a doctor.sh sajat csapdaja)', () => {
    // Kontroll a felismerore: e nelkul nem tudnank, hogy tenyleg szetvalasztja-e a ket esetet.
    expect(hasEffectiveVerdict('bash scripts/a.sh | while read l; do FAIL=1; done\n')).toBe(false)
    expect(hasEffectiveVerdict('bash scripts/a.sh | while read l; do FAIL=1; done\nif ! bash scripts/a.sh; then FAIL=1; fi')).toBe(true)
    expect(hasEffectiveVerdict('X="$(bash scripts/a.sh)"\nfail "nem szolt"\n')).toBe(true)
  })

  it('EMLITES NEM HIVAS: egy uzenet szovegeben allo szkriptnev nem kovetel bekotest', () => {
    // Merve: a "Managed-settings" szekcio egy `warn` uzenetben JAVASOLJA a szkriptet.
    // Egy naiv grep ezt hivasnak venne, es a kezenfekvo "javitas" a hasznos javaslat
    // TORLESE lenne a hibauzenetbol -- vagyis az or rontana a lapon.
    const managed = sections().find((s) => s.title.startsWith('Managed-settings'))
    expect(managed).toBeDefined()
    expect(INVOKE_RX.test(managed!.body)).toBe(true)          // a NEV ott van
    expect(invokingSections().some((s) => s.title.startsWith('Managed-settings'))).toBe(false) // de nem hivas
  })

  it('a HIVAS-FELISMERO ot mert eseten -- a dontes a parancshelyettesitesen all, nem az idezojelen', () => {
    // Didi ot jelolt sora, valtozatlanul atveve. Az elso valtozatom a harmadikat es a
    // negyediket EMLITESNEK vette -- mindketto VALODI hivas, es mindketto a VESZELYES
    // iranyba tevedt: a szekcio kiesne a populaciobol, es az or nemán hallgatna rola.
    expect(isInvocation('PG="$(bash scripts/x.sh)"')).toBe(true)
    expect(isInvocation('warn "Fix: bash scripts/x.sh"')).toBe(false)
    expect(isInvocation('echo "$(bash scripts/x.sh)"')).toBe(true)
    expect(isInvocation('ok "$(bash scripts/x.sh | head -1)"')).toBe(true)
    expect(isInvocation('bash scripts/x.sh | while read l; do :; done')).toBe(true)
  })

  it('a fogyasztas-felismero MINDHAROM szerzodest elfogadja, es a puszta ertekadast NEM', () => {
    // Kontroll a felismerore magara: e nelkul nem tudnank, hogy a fenti ciklus tenyleg
    // merte-e a kulonbseget, vagy csak mindenre igazat mond.
    expect(consumesResult('X="$(bash scripts/a.sh)"\nif [ -z "$X" ]; then :; fi')).toBe(true)
    expect(consumesResult('if ! bash scripts/a.sh &>/dev/null; then FAIL=1; fi')).toBe(true)
    expect(consumesResult('bash scripts/a.sh | grep -E "x" | while read l; do :; done')).toBe(true)
    expect(consumesResult('X="$(bash scripts/a.sh)"\n')).toBe(false)   // elkapja, de sosem olvassa
    expect(consumesResult('bash scripts/a.sh >/dev/null\n')).toBe(false)
  })
})
