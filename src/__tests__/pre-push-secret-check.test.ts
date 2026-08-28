// A push elotti titok-ellenorzes DELEGAL, nem ismetli meg a kaput -- kartya dd5e07b4.
//
// A MERT ESET (2026-08-28): a lapon allo KEZI recept (`git ls-tree <ag> | grep <minta>`)
// egy elgepelt agnevre `fatal: Not a valid object name`-et irt a STDERR-re, a ciklus
// szamlaloja nullan maradt, es a verdikt "talalat: nincs" lett. **Egy nem letezo ag
// pontosan ugy nezett ki, mint egy tiszta ag.** A mero jo volt, a kontroll jo volt -- a
// BEMENET nem letezett, es errol a verdikt nem szolt.
//
// A repo sajat kapuja (`scripts/secret-gate.ts`, EVIDGUARD818) mindkettot tudja: fail-closed
// a meghatarozhatatlan halmazra, es kulon mondja a "NOT SCANNED"-et a "tiszta"-tol. Ez a
// szkript ezert NEM ellenoriz maga -- feloldja a refeket, aztan delegal.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCRIPT = join(ROOT, 'scripts', 'pre-push-secret-check.sh')

function run(...args: string[]) {
  const r = spawnSync('bash', [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf-8', timeout: 60_000 })
  return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe('a BEMENET feloldasa elozi meg az ellenorzest (dd5e07b4)', () => {
  it('NEM LETEZO ref -> 2, es kimondja, hogy ez NEM "tiszta"', () => {
    const r = run('fix/ez-a-ag-biztosan-nem-letezik-dd5e07b4')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/NEM OLDHATO FEL/)
    // A lenyeg nem a kod, hanem hogy a szoveg megkulonbozteti a ket allapotot.
    expect(r.out).toMatch(/nem vizsgaltunk meg/)
  })

  it('NEM LETEZO bazis -> szinten 2, es megnevezi a bazist', () => {
    const r = run('HEAD', 'origin/ez-a-bazis-sem-letezik')
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/BAZIS nem oldhato fel/)
  })

  it('ARGUMENTUM NELKUL -> 2, hasznalati sorral', () => {
    const r = run()
    expect(r.code).toBe(2)
    expect(r.out).toMatch(/hasznalat:/)
  })

  it('a verdikt MEGNEVEZI, MIT vizsgalt (ref + bazis SHA)', () => {
    // Ez a masodik fele a leletnek: a regi recept nem mondta meg, melyik fat nezte.
    // A HEAD-re futtatva a kimenet elso sora tartalmazza mindket SHA-t.
    const r = run('HEAD', 'HEAD')
    expect(r.out).toMatch(/pre-push-secret-check: HEAD = [0-9a-f]{40} \| bazis HEAD = [0-9a-f]{40}/)
  })
})

describe('KET TENGELY -- FUTTATVA, nem a forrasbol allitva (marveen onhelyesbitese, 06:16)', () => {
  // AZ ELSO KET TESZTEM ITT JELENLET-TESZT VOLT: a mintat kerestem a forrasban, es ket
  // mutacio -- a fajlnev-tengely kikapcsolasa (`if false`) es a verdikt szukiteSe csak a
  // kapura -- MINDKETTO TULELTE. Egy szoveg jelenlete nem viselkedes.
  // Ezert a szkript a fajl-listat egy MERHETO SEAM-en is elfogadja (PRE_PUSH_NAME_LIST), es
  // ezek a tesztek a DONTEST futtatjak.
  //
  // A TENGELYEK KULONBSEGE MERVE (ideiglenes worktreeben, tehat a kapu OLVASTA a fajlt):
  //   egy `.env`, benne `API_PASSWORD=nagyontitkos`  ->  a KAPU exit 0 ("no secret shape"),
  //   a FAJLNEV-tengely viszont fogja. Ha csak a kapura epitunk, ez a fajl atmegy.
  const BASE = 'd7b533e'   // valodi, nem ures tartomany: a kapu ilyenkor tenylegesen mer

  function runWithList(list: string) {
    const r = spawnSync('bash', [SCRIPT, 'HEAD', BASE], {
      cwd: ROOT, encoding: 'utf-8', timeout: 120_000,
      env: { ...process.env, PRE_PUSH_NAME_LIST: list },
    })
    return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') }
  }

  it('egy `.env` a listaban MEGALLITJA a pusht -- pedig a kapu atengedi', () => {
    const r = runWithList('src/a.ts\n.env')
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/FAJLNEV-TALALAT/)
    // A verdikt MEGNEVEZI, melyik tengely szolalt meg: kapu=0, fajlnev=1.
    expect(r.out).toMatch(/kapu=0, fajlnev-talalat=1/)
  })

  it('tiszta lista -> mindket tengely tiszta, exit 0', () => {
    const r = runWithList('src/a.ts\nREADME.md')
    expect(r.code).toBe(0)
    expect(r.out).toMatch(/mindket tengely tiszta/)
  })

  it('a mintat a fajlnev VEGE dönti el, nem egy reszkarakterlanc', () => {
    // `environment.ts` NEM `.env`. Egy tul tag minta par kor utan zajja valna.
    expect(runWithList('src/environment.ts\nsrc/tokens-ui.tsx').code).toBe(0)
    expect(runWithList('config/id_rsa').code).toBe(1)
    expect(runWithList('certs/server.pem').code).toBe(1)
  })

  // A maradek ket allitas SZERKEZETI (sorrend es hely) -- ezeket futtatassal nem lehet
  // megfogni, es ezt kimondjuk: forrast olvasnak, kommentek nelkul.
  const SRC = readFileSync(SCRIPT, 'utf-8')
  const CODE = SRC.split('\n').filter(l => !l.trimStart().startsWith('#')).join('\n')

  it('a ref-feloldas MEGELOZI a delegalast (sorrend, nem jelenlet)', () => {
    // A KOMMENTEKET ELOSZOR CSUPASZITJUK -- a repo sajat szabalya, es ez a teszt
    // elsore EPP ezen bukott el: a `secret-gate.ts` a FEJLEC-KOMMENTBEN all elobb
    // (748. karakter), a kodban kesobb (2724.), tehat a sorrend-allitas a
    // MAGYARAZATOT merte, nem a kodot.
    const resolve = CODE.indexOf('rev-parse --verify --quiet')
    const gate = CODE.indexOf('secret-gate.ts')
    expect(resolve).toBeGreaterThan(-1)
    expect(gate).toBeGreaterThan(resolve)
  })

  it('a ki nem csekkolt ref eseten ideiglenes worktreet nyit, es NEM /tmp-ben', () => {
    // A kapu a TARTALMAT a munkafabol olvassa: enelkul egy masik agra "NOT SCANNED"-et
    // adna. A /tmp azert kizart, mert a hook-path guard elutasitja -- akkor a kapu egy
    // MASIK hibaba futna, es a verdikt megint mast merne, mint amit hiszunk.
    expect(SRC).toMatch(/worktree add --detach/)
    expect(SRC).toMatch(/\$HOME\/\.marveen-secretcheck-/)
    expect(SRC).not.toMatch(/\/tmp\/marveen-secretcheck/)
  })
})
