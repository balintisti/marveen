/**
 * A `git push --force` TILTAS ALAKJA A PROFIL-SABLONOKBAN (kartya 9e3f2f5c, G2).
 *
 * MIERT NEM EGY SZABALY, ES MIERT NEM SZABAD EGGYE VONNI. A `Bash(...)` minta
 * szemantikaja MERVE van (computress, negy szonda + pozitiv kontroll, 2026-09-06):
 *
 *     `:*`-ra vegzodo minta  ->  LITERALIS ELOTAG a nyers parancs-sztringen
 *     `:*` NELKULI minta     ->  PONTOS EGYEZES
 *     a mintan BELULI `*`    ->  a `*` KARAKTER, nem joker
 *
 * A korabbi egyetlen szabaly `Bash(git push --force:*)` volt, es KET IRANYBA
 * tevedett egyszerre:
 *
 *     git push --force-with-lease x   ->  MEGTAGADVA   <- a BIZTONSAGOSABB alak,
 *                                         mert a `git push --force` az elotagja
 *     git push origin main --force    ->  ATENGEDVE    <- a veszelyes alak
 *
 * Vagyis a helyes megoldast jelolte hibanak, es a kezenfekvo megkerulest
 * atengedte. A par-alak ezt szunteti meg: a PONTOS szabaly a csupasz alakot
 * fogja, a SZOKOZ-elotagos az argumentumosakat, es a `--force-with-lease`
 * egyiknek sem felel meg (a `--force` utan `-` all, nem szokoz).
 *
 * AMI EZUTAN IS ATMEGY, es ez KIMONDOTT hatar, nem feledekenyseg:
 * `git push origin main --force` -- a kapcsolo a parancs VEGEN all, az illesztes
 * meg elotag-alapu. Egy elotag-minta ezt nem tudja kifejezni.
 *
 * EZ A FAJL AZERT LETEZIK, mert harom szabaly ott, ahol egy is "eleg lenne",
 * pontosan az az alak, amit egy kesobbi takaritas osszevon -- es az osszevonas
 * NEM lenne eszrevehetetlen hiba: visszahozna mindket fenti tevedest, csendben.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROFILES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'profiles')

type Profile = { filesystem?: { deny?: string[] } }

const load = (): { name: string; deny: string[] }[] =>
  readdirSync(PROFILES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const profile = JSON.parse(readFileSync(join(PROFILES, f), 'utf-8')) as Profile
      return { name: f, deny: profile.filesystem?.deny ?? [] }
    })

const EXACT = 'Bash(git push --force)'
const PREFIX = 'Bash(git push --force :*)'
const MERGED = 'Bash(git push --force:*)'

describe('a --force tiltas alakja a profil-sablonokban', () => {
  const profiles = load()

  it('KONTROLL: a sablonok betoltodnek, es van kozottuk push-tiltas', () => {
    // Enelkul minden alabbi allitas URESEN igaz volna: nulla sablon, nulla
    // szabaly, csupa zold -- pontosan az az alak, amit ez a lap "ures halmazon
    // a kontroll trivialis" neven rogzit.
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.filter((p) => p.deny.some((r) => r.includes('git push')))).not.toHaveLength(0)
  })

  it('EGYETLEN sablon sem hordozza az OSSZEVONT alakot', () => {
    // Ez az allitas, ami egy kesobbi "takaritsuk ossze" valtozast megall.
    const merged = profiles.filter((p) => p.deny.includes(MERGED)).map((p) => p.name)
    expect(merged).toEqual([])
  })

  it('ahol a --force tiltva van, ott MINDKET fele ott all', () => {
    // Fel par ket kulon hibat ad: csak a PONTOS -> az argumentumos alak atmegy;
    // csak az ELOTAGOS -> a csupasz `git push --force` megy at, es epp az a
    // veszelyes (a jelenlegi agat tolja fel eroszakkal).
    const half = profiles
      .filter((p) => p.deny.includes(EXACT) !== p.deny.includes(PREFIX))
      .map((p) => p.name)
    expect(half).toEqual([])
  })

  it('a rovid kapcsolo kulon szabalyt kap, mert a --force minta nem fogja', () => {
    // `git push -f` a `--force` rovid alakja, es EGYETLEN `--force`-alaku minta
    // sem illeszkedik ra. Ahol a hosszu alak tiltva van, a rovidnek is annak
    // kell lennie, kulonben a tiltas egy karakterrel megkerulheto.
    const missingShort = profiles
      .filter((p) => p.deny.includes(EXACT) && !p.deny.includes('Bash(git push -f:*)'))
      .map((p) => p.name)
    expect(missingShort).toEqual([])
  })

  it('KONTROLL: egy BLANKETTA push-tiltas nem igenyli a part', () => {
    // Aki egyaltalan nem pusholhat (`Bash(git push:*)`), annal a finomsag
    // ertelmetlen -- es az allitas fent ezert a --force-tiltasra szur, nem
    // minden sablonra. Ha ez a kontroll ures lesz, a fenti harom allitas
    // populacioja is megvaltozott.
    const blanket = profiles.filter((p) => p.deny.includes('Bash(git push:*)'))
    expect(blanket.length).toBeGreaterThan(0)
    for (const profile of blanket) {
      expect(profile.deny).not.toContain(EXACT)
    }
  })
})
