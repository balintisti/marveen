// A HANG-ATIRAT HIANYA LATSZODJON A FELHASZNALONAK -- kartya 477682a0, marveen (c) pontja.
//
// A MERT ALLAPOT (2026-08-28): `~/.local/share/marveen-voice/` NEM LETEZIK, tehat
// `isVoiceInstalled()` hamis, `transcribeVoiceFile()` null-t ad, es a router eddig egy
// `logger.warn`-t irt -- amit CSAK MI latunk. Az agens egy olvashatatlan hang-blokkot kapott,
// a felhasznalo pedig annyit erzekelt, hogy ertetlenul valaszolunk a hangüzenetere. A leheto
// legrosszabb kovetkeztetes (hogy nem ertjuk OT) volt az, amit a csend felkinalt.
//
// A lap szabalya: "A hibat ne javithatova tedd, hanem lathatova: ami elmaradt, azt a rendszer
// mutassa meg, ne a felhasznalo memoriaja orizze."
//
// ES A FUGGETLENSEG, amit marveen kulon kikotott: ez NEM a telepites helyett van. Ha holnap
// telepitunk, a kovetkezo kieses ugyanide vezetne -- a sor az, ami a kiesest KIMONDHATOVA teszi.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { injectVoiceUnavailable } from '../web/message-router.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROUTER = readFileSync(join(ROOT, 'src', 'web', 'message-router.ts'), 'utf-8')

// A fuggveny EXPORTALVA es IMPORTALVA -- nem forrasbol evalva. (Az elso valtozatom a
// forrast prooalta `new Function`-nel futtatni, es a TS tipus-annotaciokon elhasalt:
// "Unexpected token ':'". Egy teszt, ami a MERES eszkozen bukik el, nem a kodrol mond
// semmit -- az export a helyes ar ezert.)
const INBOUND = '<channel provider="telegram" chat_id="8362010684" attachment_kind="voice" attachment_file_id="AwACAgQAAx">\n(empty message)\n</channel>'

describe('a nem elerheto atirat KIMONDVA erkezik (477682a0)', () => {
  it('a hang-blokk helyere EXPLICIT sor kerul', () => {
    const out = injectVoiceUnavailable(INBOUND, false)
    expect(out).toMatch(/\[Hang átirat NEM ELERHETO\]/)
    // A ket dolog, amit a felhasznalonak tudnia kell: nem hallottuk, es mit tegyen.
    expect(out).toMatch(/NEM hallottuk/)
    expect(out).toMatch(/irja le/)
  })

  it('MEGNEVEZI, MELYIK kudarcrol van szo, ES HOGY MIT ER AZ UJRAKULDES', () => {
    // A ket eset nem azert kulon, mert ket kulonbozo OK -- hanem mert ket kulonbozo TEENDO
    // (marveen, 2026-08-28): a "nincs telepitve" allo allapot, ott az ujrakuldes ERTELMETLEN;
    // a "whisper hibazott" egyszeri, ott ERTELMES. Ha egy mondat fedne mindkettot, a
    // felhasznalo vagy azt probalna ujra, ami rendszerszinten nem megy, vagy feladna azt,
    // ami masodszorra menne.
    const notInstalled = injectVoiceUnavailable(INBOUND, false)
    const whisperFailed = injectVoiceUnavailable(INBOUND, true)
    expect(notInstalled).toMatch(/NINCS TELEPITVE/)
    expect(notInstalled).toMatch(/ujrakuldes NEM segit/)
    expect(whisperFailed).toMatch(/sikertelen/)
    expect(whisperFailed).toMatch(/ujrakuldes segithet/)
    expect(whisperFailed).not.toMatch(/NINCS TELEPITVE/)
  })

  it('a hang-attributumok ELTUNNEK, kulonben az agens megint hang-blokkot lat', () => {
    const out = injectVoiceUnavailable(INBOUND, false)
    expect(out).not.toMatch(/attachment_kind="voice"/)
    expect(out).not.toMatch(/attachment_file_id=/)
    // a `<channel ...>` keret megmarad: a chat_id-nek at kell jutnia
    expect(out).toMatch(/chat_id="8362010684"/)
  })

  it('NEGATIV KONTROLL: a SIKERES ut valtozatlan -- ez nem irja felul az atiratot', () => {
    // A `injectTranscript` a szomszedja; ha valaha osszecsusznanak, egy sikeres atirat
    // is "nem elerheto"-t mondana.
    const transcript = ROUTER.slice(ROUTER.indexOf('function injectTranscript'), ROUTER.indexOf('function injectVoiceUnavailable'))
    expect(transcript).toMatch(/\[Hang átirat\]: \$\{transcript\}/)
    expect(transcript).not.toMatch(/NEM ELERHETO/)
  })
})

describe('a router tenyleg ezt hivja a bukas-agon (bekotes)', () => {
  const branch = ROUTER.slice(ROUTER.indexOf('const transcript = await callVoiceSTT'), ROUTER.indexOf('} else if (chatId) {'))

  it('a bukas-ag a kezbesitett tartalmat CSERELI, nem csak naploz', () => {
    expect(branch).toMatch(/deliveryContent = injectVoiceUnavailable\(msg\.content, isVoiceInstalled\(\)\)/)
  })

  it('a naplo megmarad, es mostantol azt is rogziti, telepitve van-e', () => {
    expect(branch).toMatch(/voiceInstalled: isVoiceInstalled\(\)/)
  })

  it('NEGATIV KONTROLL: a SIKERES ag tovabbra is az atiratot injektalja', () => {
    expect(branch).toMatch(/deliveryContent = injectTranscript\(msg\.content, transcript\)/)
  })
})

describe('a `stt.sh` szerepe ki van mondva (marveen (b) pontja)', () => {
  const STT = readFileSync(join(ROOT, 'scripts', 'voice', 'stt.sh'), 'utf-8')

  it('a fejlec kimondja, hogy NEM a produkcios ut, es megnevezi, mi az', () => {
    expect(STT).toMatch(/DIAGNOSZTIKAI ESZKOZ, NEM A PRODUKCIOS UT/)
    expect(STT).toMatch(/routes\/voice\.ts/)
    expect(STT).toMatch(/_vtools\.py/)
  })

  it('a hibauzenete VALTOZATLAN -- a dontes a szerepet mondja ki, nem a viselkedest irja at', () => {
    expect(STT).toMatch(/a hang-futtatokornyezet nincs telepitve/)
    expect(STT).toMatch(/install-voice\.sh/)
  })
})
