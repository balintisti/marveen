---
name: reggeli-napindito
description: A reggeli napindító összeállítása és kiküldése Telegramra (DREAM.md bucketek, mentés-státusz, email, naptár, AI hírek), MarkdownV2-ben. Akkor használd, ha a reggeli-napindito ütemezett feladat tüzel, vagy ha a gazda reggeli összefoglalót kér.
---

> **EZ A SZÁLLÍTOTT PÉLDÁNY.** Nincs benne abszolút útvonal és nincs benne ágens-név, mert a
> `seed-skills/` telepítése SIMA `cp` -- **nincs mögötte `sed`-helyettesítés** (mérve 2026-08-23,
> `install-macos.sh` és `install-linux.sh` egyaránt: nulla `sed` a seed-skills hurokban).
> Egy kapcsos-zárójeles helyőrző itt NYERSEN szállítana, egy másik gép home-könyvtárára mutató
> abszolút út pedig ott nem létezik --
> és egy parancs, ami nem létező útra mutat, rosszabb, mint ha nem lenne ott.
> A gyökér a `CLAW_DIR` környezeti változóból jön, ahogy a `fleet-helper` skill is csinálja.

# Reggeli napindító

## Mikor használd

- A `reggeli-napindito` ütemezett feladat tüzel (jellemzően 07:30).
- A gazda kéri: "mi van ma", "napindító", "foglald össze a reggelt".

## Eljárás

1. **`date` ELŐSZÖR.** Kötelező, mielőtt bármit írnál. A napindító tele van
   időpont-állítással, és becsülni tilos.
2. **DREAM.md a legelejére.** `cat $CLAW_DIR/DREAM.md`, és az öt bucketet
   (skill-javaslatok, memória-egészség, top-3, external opportunity, skill-flotta health)
   TÖMÖRÍTVE tedd be, még az email/naptár szekció elé. Ha a fájl hiányzik vagy üres,
   az egész szekció kimarad. A DREAM.md hosszú: két-három mondat bucketenként elég,
   a részletek maradjanak a fájlban.
3. **NE KERESS ESZKÖZT. FUTTASD A LENTI PARANCSOKAT.** (javítva 2026-08-22, egy ügynök;
   a darabszám kivéve 2026-08-23, amikor harmadikká vált a kapacitás — egy szám a
   szövegben pontosan addig igaz, amíg valaki hozzá nem tesz egy negyediket.) Mindegyik
   ugyanazt a szerződést tartja: mindig 0-val lép ki, mindig JSON-t ad, és a JSON vagy
   `{"ok":true,...}` (megnéztük), vagy `{"ok":false,"error":"..."}` (nem tudtuk megnézni,
   és ez az ok). Harmadik alak nincs. Üres eredményt `ok:true` nélkül nem lehet kapni,
   tehát nem tudod összekeverni a nyugodt reggelt a néma hibával.
   A parancsok: **email** (4.), **naptár** (5.), **gépi keret** (6.), **kártya-áram** (7.).
4. **Email**: `python3 $CLAW_DIR/scripts/gmail-recent.py --minutes 720 --limit 15`
   Szűrd a spamot és a hírlevelet. NE a `mail_triage.py`-t: az a Mail.app-ot olvassa,
   ami ezen a gépen nincs beállítva, és a hiánya üres postafióknak látszik.
5. **Naptár**: `bash $CLAW_DIR/scripts/calendar-agenda.sh --hours 24`
   A `via` mező megmondja, melyik példány válaszolt (`dist` vagy `tsx-source`). Ha van
   `warning` mező, azt is írd ki: az azt jelenti, hogy olvastunk ugyan naptárt, de
   valószínűleg nem azt, amit akartunk.
**HA A PARANCS NEM LÉTEZIK** (`No such file or directory`): az azt jelenti, hogy a javítás még
NINCS BEOLVASZTVA az éles ágba -- a `$CLAW_DIR` fő checkout telepítési fa, és csak a
beolvasztott állapotot tartalmazza. Ez NEM "nincs naptár" és NEM "nincs levél": írd ki egy sorban
pontosan így, hogy *"naptár: a lekérdező szkript nincs beolvasztva (fix/6e6e40ce-napindito-adatforras)"*.
A különbség ugyanaz, mint mindenhol máshol ezen a lapon: az ÜRES és a NEM MÉRHETŐ nem ugyanaz.

6. **GÉPI KERET (Claude-előfizetés) — EGY PARANCS** (kártya 8136d993):

   *A „kapacitás" szónak ebben a flottában KÉT jelentése van, és ez 2026-08-23-án egy
   teljes félreértést okozott: a gépi keret (ez a lépés) és a kártya-áram (7.). A cím
   ezért nevezi meg, MELYIKRŐL van szó.*

   ```bash
   bash $CLAW_DIR/scripts/capacity-report.sh
   ```

   Ugyanaz a szerződés, mint a naptárnál: mindig 0-val lép ki, mindig JSON, és vagy
   `{"ok":true,...}`, vagy `{"ok":false,"error":"..."}`. A `via` mező megmondja, melyik
   példány válaszolt (`dist` vagy `tsx-source`).

   Amit a napindítóba tegyél be belőle:
   - a **három szám**: `windows.five_hour`, `windows.seven_day`, `windows.seven_day_opus` (%),
   - és a `spare_capacity.sustained` alapján EGY mondat. Ha `true`: van tartósan szabad
     keret, jöhet új projekt. Ha `false`: **a `reason` mezőt írd ki**, ne csak annyit, hogy
     nincs — a „nem volt eldönthető" és a „nem volt alulhasználat" NEM ugyanaz.
   - Ha `source` nem `authoritative`, azt is írd oda: becsült adatból nem lehet keretről dönteni.

   **A küszöb SZÁM, nem szó**: három egymást követő TELJES nap (a mai nem számít bele, mert
   részleges), és mindegyiknek alulhasználatnak kell lennie. Egyetlen nem eldönthető nap is
   megbuktatja — a „nem tudom" nem alulhasználat.

   **HA A PARANCS NEM LÉTEZIK** (`No such file or directory`): a javítás még NINCS beolvasztva
   az éles ágba. Ez NEM „nincs kapacitás-adat": írd ki egy sorban pontosan így, hogy
   *„kapacitás: a lekérdező szkript nincs beolvasztva (feat/54ee459b-kapacitas-napindito)"*.

7. **Kártya-áram — a MÁSIK kapacitás-kérdés** (kártya 54ee459b):

   ```bash
   bash $CLAW_DIR/scripts/card-flow-report.sh
   ```

   Ugyanaz a szerződés. Amit betegyél: `numbers.created_last_full_day`,
   `numbers.closed_last_full_day`, `numbers.testing_now`, és a
   `convergence.converging` alapján egy mondat. Ha `false`, **a `reason`-t is** — ott áll,
   melyik napon mennyivel.

   **KÉT KÜLÖN KÉRDÉS, ÉS EGYIK SEM HELYETTESÍTI A MÁSIKAT**: a 6. pont a GÉPI keretről szól
   (van-e szabad kapacitás), ez a kártya-áramról (fogy-e a hátralék). Lehet bőven szabad keret
   úgy, hogy a hátralék nő — és fordítva. Isti kérdéséhez (jöhet-e új projekt) MINDKETTŐ kell.

   **KÉT FOLYAM ÉS EGY SZINT**: a `created`/`closed` napi folyam egy TELJES napra (a mai
   kimarad, mert a nap végéig nő), a `testing_now` viszont most mért szint. Ne írd ki őket
   egy sorban ugyanolyan számként.

   **HA A PARANCS NEM LÉTEZIK**: a javítás még nincs beolvasztva — írd ki egy sorban, hogy
   *„kártya-áram: a lekérdező szkript nincs beolvasztva (feat/54ee459b-kartya-aram)"*.

8. **AI hírek**: `WebSearch` a TEGNAPI dátummal. **Csak a fő-ágens** teszi be; sub-ágensnél
   ez a szekció kimarad.
9. **Ami mérhető és a gazdát érdekli, kerüljön bele akkor is, ha nem szerepel a
   sablonban.** Például egy éjjel lefutott mentés státusza. A sablon minimum, nem maximum.
10. **Küldés a `reply` toollal**, `format: "markdownv2"`, a wrapperben megadott `chat_id`-ra.
11. **Zárd egy rövid kérdéslistával**, ha döntésre vársz. A gazda reggel dönt a leggyorsabban.

## MarkdownV2 escape, ami tényleg működik

Ne kézzel escape-elj, és ne is escape-elj mindent egy generikus escaperrel (az a `*`-ot is
megeszi, és elveszik a félkövér). Írd meg a szöveget `*félkövér*` jelöléssel, aztán escape-eld
a `*` KIVÉTELÉVEL az összes speciális karaktert:

```bash
python3 - <<'PY' > out.txt
raw = open('nyers.txt', encoding='utf-8').read()
special = r'_[]()~`>#+-=|{}.!'      # a '*' szandekosan NINCS benne
print(''.join('\\' + c if c in special else c for c in raw), end='')
PY
```

Így a `*bold*` megmarad, minden más literál lesz, és a Telegram nem utasítja vissza az üzenetet.
Félkövér: EGY csillag, nem dupla. Markdown fejlécet (`#`) ne használj, a Telegram nem ismeri.

## Buktatók

- **A hiányzó adat ugyanúgy néz ki, mint a nyugodt reggel.** A szabály eddig az volt, hogy
  ha egy kategóriában nincs esemény, hagyd ki a szekciót. Csakhogy a NEM ELÉRHETŐ
  adatforrás is így néz ki, és így a napindító hónapokig ígérhet email- és naptár-blokkot
  úgy, hogy egyiket sem tudja lekérni -- senkinek nem tűnik fel. 2026-08-18-án derült ki.
  **Szabály: az ÜRES kategóriát hagyd ki, a NEM ELÉRHETŐT írd ki**, egy sorban, az okkal.
- **AZ EMAILHEZ MÁR VAN SAJÁT ESZKÖZ, NE MCP-T KERESS.** (2026-08-20.) A levelet ne
  `search_emails`-szel próbáld lekérni: az egy MCP-eszköz, ami ebben a flottában **nincs
  bekötve**, és a hiánya pontosan úgy néz ki, mint egy üres postafiók. Helyette:
  ```bash
  python3 scripts/gmail-recent.py --minutes 720 --limit 15
  # a megjegyzésekhez / eredeti feladóhoz:  --with-body
  # mellékletek listája (NEM tölt le):      --attachments
  ```
  Mindig `{"ok":true|false,...}` JSON-t ad, és MINDIG 0-val lép ki -- vagyis az `ok:false`
  az, amit ki kell írni a napindítóba, nem elhallgatni. IMAP + alkalmazásjelszó a
  szerepfiókon, nem jár le.
  **ÉS EGY TANULSÁG, AMI ENNÉL TÖBB:** ez a figyelmeztetés hónapokig itt állt a skillben --
  vagyis TUDTUK, hogy a `search_emails` nem létezik --, miközben a heartbeat kódja
  változatlanul azt hívta. A dokumentált megkerülés nem javítás: a tudás megvolt, a hiba
  maradt. Ha egy skill azt írja, hogy valami "nem garantált", az nem a végállomás, hanem egy
  nyitott kártya.
- **A KÉPESSÉG-ELLENŐRZÉS MA MÁR A PARANCS RÉSZE, ÉS EZ NEM UGYANAZ, MINT EGY `ls`.**
  (2026-08-22, egy ügynök.) Régen itt két `ls` állt a hitelesítő fájlokra. Egy létező fájl
  viszont nem bizonyítja, hogy a hívás sikerül -- és fordítva is tévedhet: aznap reggel a
  napindító `ToolSearch`-csel keresett naptár-eszközt, nem talált, és azt írta ki Istinek,
  hogy "nincs bekötve naptár-eszköz". Este megmérve a szolgáltatásfiók HTTP 200-at adott
  ugyanarra a naptárra, `accessRole: writer`-rel: **egy működő forrást jelentett
  elérhetetlennek.** A `calendar-agenda.sh` most magát a lekérdezést futtatja le, és az
  eredménye vagy adat, vagy megnevezett hiba -- nincs harmadik kimenet, amit értelmezni kell.
  **A `listCalendars()` üres listát ad akkor is, ha minden jó** -- megosztott naptárt a gépi
  fiók nem lát a listájában --, ezért felderítésre SOHA ne építs: a naptárat a beállított
  azonosítóval kell kérdezni, és a szkript pontosan ezt teszi.
- **A Mail.app AppleScripten át headless gépen nem megbízható.** A
  `osascript -e 'tell application "Mail" to get count of ...'` 90 másodperc után is futott,
  majd `-1712` (Apple-esemény időkorlát) hibával halt el. Ez tipikusan hiányzó
  Automation-engedély (Terminal/tmux -> Mail), amit egy GUI-párbeszéddel kellene megadni.
  Időkorláttal futtasd, és ha elhal, azt írd ki, ne csak hagyd ki.
- **Ne ismételd meg, amit öt perce küldtél.** Ha a döntési összefoglaló épp kiment, a
  napindító top-3 szekciója ugyanaz lenne. Hivatkozz rá egy sorral, és csak azt küldd, ami
  új.

- **Ne találj ki tartalmat hiányzó eszköz helyett.** 2026-08-16-án sem a Mail.app adatbázis,
  sem naptár-eszköz nem volt elérhető. A helyes lépés: a szekciót kihagyni ÉS megmondani,
  hogy miért, plusz felajánlani a bekötést. Az "üres nap" és a "nincs hozzáférésem" nem
  ugyanaz, és a kettő összekeverése hamis biztonságérzetet ad.
- **A `mail_triage.py`-t NE HASZNÁLD a napindítóhoz.** Az "Envelope Index not found" üzenete
  NEM azt jelenti, hogy nincs levél, hanem hogy a Mail.app nincs beállítva ezen a gépen -- és
  a JSON ilyenkor is `has_signal: false`-t ad, tehát a kimenetből egyedül nem derül ki, hogy
  baj van. A `gmail-recent.py` a helyette való út, IMAP-on.
- **A `timeout` parancs nincs meg macOS-en.** Ne csomagold vele a hívást, a `Bash` tool saját
  `timeout` paraméterét használd.
- **A wrapper fejléce és a task törzse ellentmondhat egymásnak** (a dream-engine fejléce
  Telegram-küldést kér, a törzse tiltja az éjszakai üzenetet). A KONKRÉTABB, a helyzethez
  illő utasítás nyer; éjszaka a gazda alszik, tehát nem küldesz.
- **A `chat_id: 0` a CLAUDE.md-ben általános placeholder.** Ha a wrapper konkrét `chat_id`-t ad,
  azt használd.

## Ellenőrzés

- Az üzenet TÉNYLEG kiment (a `reply` visszaadott egy id-t), nem csak a transzkriptben van.
- Minden szekció mögött futtatott parancs van; ami nem volt mérhető, az néven van nevezve.
- Az időpontok `date`-ből jönnek, nem becslésből.
- A napindító után a napi naplóba is bekerül, mi ment ki és mi maradt nyitva.
