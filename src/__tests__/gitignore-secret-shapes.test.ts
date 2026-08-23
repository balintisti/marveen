import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// A .gitignore MINTAVAL vedjen, ne nevsorral (kartya 8a79cddf).
//
// A LELET: a testverprojektben KILENC konkret `.env`-nev allt felsorolva, minta
// nelkul -- vagyis pontosan azok, amik a felirasukkor leteztek. A tizedik
// (`.env.local.bak`) tenylegesen commitolhato volt.
//
// ES A CSALAD EGGYEL FELJEBB IS: a push elotti titok-ellenorzes szinten LISTA.
// Computress megmerte, hogy nem azert engedett at, mert tiszta volt, hanem mert
// a `.psql_history` / `.docker/config.json` alakokat nem is kereste.
//
// EZERT NEM A .gitignore SZOVEGET NEZZUK, HANEM A VISELKEDESET: a `git
// check-ignore` a git sajat dontese. Egy szoveg-illesztes ("van-e benne .env*")
// atmenne akkor is, ha a mintat egy kesobbi negalas kiuti -- es epp az a fajta
// csendes elromlas, ami ellen a kartya szol.

/** A git sajat valasza: ignoralva lenne-e ez az utvonal? */
function ignored(path: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT })
    return true
  } catch {
    return false
  }
}

// Minden alak, amit a push elotti titok-ellenorzes keres, PLUSZ amit computress
// merese hozzatett. Ha ez a lista es a checklist eltavolodik egymastol, az itt
// fog kiderulni -- ezert all a ketto ugyanabbol a felsorolasbol.
const MUST_BE_IGNORED = [
  '.env',
  '.env.local',
  '.env.bak',
  '.env.local.bak',
  '.env.production',
  '.env.staging.local',
  '.env.valami.amire.senki.nem.gondolt',   // a "tizedik valtozat"
  'tokens.json',
  'service-account.json',
  'my-service-account.json',
  'credentials.json',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'cert.pem',
  'key.p12',
  '.psql_history',
  '.pgpass',
  '.npmrc',
  '.netrc',
  '.docker/config.json',
]

describe('.gitignore -- alakra ved, nem nevre', () => {
  it.each(MUST_BE_IGNORED)('ignoralja: %s', (p) => {
    expect(ignored(p)).toBe(true)
  })

  it('a TIZEDIK VALTOZAT is fennakad -- ez a lelet lenyege', () => {
    // Nem az a kerdes, hogy a ma ismert nevek fedve vannak-e, hanem hogy egy
    // MEG NEM LETEZO valtozat fennakad-e. Egy nevsor erre mindig nemet mond.
    expect(ignored('.env.' + 'jovobeli-valtozat')).toBe(true)
    expect(ignored('valami-service-account.json')).toBe(true)
  })
})

describe('.env.example VISZONT kovetett marad', () => {
  it('nincs ignoralva -- kulonben a referencia-fajl tunne el', () => {
    // Ez az EGYETLEN utkozes, amit a minta okoz (megmerve minden agon: 1
    // talalat). A negalas nelkul a minta egy szandekosan kovetett fajlt
    // ejtene ki, es a hiba csak egy uj klonozasnal derulne ki.
    expect(ignored('.env.example')).toBe(false)
  })

  it('es tenylegesen KOVETETT is a repoban', () => {
    const tracked = execFileSync('git', ['ls-files', '.env.example'], { cwd: ROOT, encoding: 'utf-8' })
    expect(tracked.trim()).toBe('.env.example')
  })
})

describe('a minta tenyleg MINTA, nem nevsor', () => {
  it('a .env sor csillagos, es a negalas UTANA all', () => {
    // A sorrend szamit: egy `!.env.example` a minta ELOTT hatastalan. Ezt a
    // viselkedes-teszt is fogja, de a sorrend kimondasa megmagyarazza, MIERT.
    const gi = readFileSync(join(ROOT, '.gitignore'), 'utf-8')
    const pat = gi.indexOf('\n.env*')
    const neg = gi.indexOf('\n!.env.example')
    expect(pat).toBeGreaterThan(-1)
    expect(neg).toBeGreaterThan(pat)
  })
})
