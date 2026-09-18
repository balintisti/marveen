

<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:09 (kartya 2028900e) -->
## Reggeli napindító

Készíts reggeli napindító üzenetet a Telegram csatornán, MarkdownV2 formátumban.

Formázás:
- Bold: *szöveg* (EGY csillag, nem dupla)
- Speciális karaktereket escapelni kell: ( ) . - + = ! { } [ ] | ~ > #
- NE használj Markdown fejléceket -- a Telegram nem támogatja
- Emoji + félkövér szöveget használj szekciócímeknek

Utasítások:
1. Email: `python3 scripts/gmail-recent.py --minutes 720 --limit 15` (IMAP, saját eszköz),
   szűrd ki a spam/promo leveleket. A megjegyzésekhez/eredeti feladóhoz `--with-body`,
   a mellékletek listájához `--attachments` (nem tölt le).
   NE `search_emails`-t hívj: az egy MCP-eszköz, ami ebben a flottában NINCS bekötve, és a
   hiánya pontosan úgy néz ki, mint egy üres postafiók. 2026-08-20-ig a heartbeat is ezt
   hívta, hónapokig, némán.
2. Naptár: `bash scripts/calendar-agenda.sh --hours 24`. NE keress hozzá eszközt, és ne
   `ls`-elj hitelesítő fájlt: ez a parancs magát a lekérdezést futtatja le. Ugyanaz a
   szerződés, mint az emailnél -- mindig 0-val lép ki, mindig JSON, és vagy
   `{"ok":true,"events":[...]}`, vagy `{"ok":false,"error":"..."}`. A `via` mező megmondja,
   melyik példány válaszolt (`dist` vagy `tsx-source`); ha van `warning` mező, azt is írd ki.
   A naptárlista ÜRES marad akkor is, ha minden jó (megosztott naptárt a gépi fiók nem lát a
   saját listájában) -- ezért felderítésre soha ne építs, a szkript a beállított
   `HEARTBEAT_CALENDAR_ID`-vel kérdez.

   **ÉS AMIT EDDIG NEM MONDOTT KI: EGY ÜRES NAP ÉS EGY VAK NAPTÁR BÁJT-AZONOS -- a wrapper
   szerződése nem választja szét őket** (friday mérte 2026-09-03, marveen újramérte). Az `ok:false`
   arra való, hogy „nem tudtunk megnézni"; arra NEM, hogy „megnéztük olyan hitelesítővel, ami
   semmit nem lát".

   **A POZITÍV KONTROLL, és a CLI CSAK EZT AZ EGYET engedi:** az eszköz kizárólag `--hours N`-t
   fogad, az ablak mindig `most -> most+N`, a negatív órát ELUTASÍTJA, a maximum **744**. Vagyis
   visszafelé nézni nem lehet, tehát a 31 napos ablak az EGYETLEN elérhető kontroll.

   ```bash
   bash scripts/calendar-agenda.sh --hours 744     # count > 0  ->  a 24 órás nulla VALÓDI nemleges
   ```

   Mérve 2026-09-03 05:2x: `--hours 24` -> `ok:true, count 0`; `--hours 744` -> `ok:true, count 1`
   (egy esemény 09-21-re), mindkettő `via:dist`, `warning:null`. **A 24 órás nulla tehát valódi
   nemleges volt, nem vak mérő.**

   **A `warning` MÁS KÉRDÉSRE VÁLASZOL, és a kettőt nem szabad összemosni:** akkor tüzel, ha a
   `HEARTBEAT_CALENDAR_ID` értéke `primary` (a gépi fiók saját, mindig üres naptára). Egy
   `warning: null` ezt a csapdát zárja ki -- arról semmit nem mond, hogy a mérő lát-e eseményt.

   **AZ `{"ok":false}` MA KÉT KÜLÖNBÖZŐ ESETET FED, ÉS NEM LEHET SZÉTVÁLASZTANI** (jarvis mérte
   forrásból, 2026-08-24; Google-lekérdezést nem indított). Három ág van, de csak KETTŐ
   megkülönböztethető alak:

       (a) üres           -> `{"ok":true,"count":0}`                    megkülönböztethető
       (b) elérhetetlen   -> `{"ok":false,"error":"..."}`  a WRAPPER-ből
       (c) elért + hibázott -> `{"ok":false,"error":"..."}`  a CLI `fail()`-jéből

   A (b) és a (c) **bájt-azonos**: nincs `kind`, nincs `stage`, csak egy szabad szöveges `error`.

   **ÉS NINCS KÓD-FOGYASZTÓ**: a `calendar-agenda.sh`-t egyetlen produkciós modul sem hívja --
   csak doc-kommentek és egy teszt, ami azt ellenőrzi, hogy a parancs LÉTEZIK. A fogyasztó egy
   ÁGENS, aki ezt a lapot olvassa. Vagyis a három ág szétválasztása **teljes egészében prózán
   áll** -- és a próza az, ami háromszor elbukott (08-22 MCP-eszköz, `e88a1cb1` rossz út,
   `f4c59571` token-timeout). Három különböző ok, egy mondat Istinek: „nincs naptár".

   **AMIT EBBŐL TENNED KELL, AMÍG A `stage` mező nincs meg:** ha `ok:false` jön, NE írd ki, hogy
   „nincs naptár". Írd ki, hogy a lekérdezés HIBÁVAL tért vissza, és idézd az `error` szövegét
   szó szerint. Ha az `error` 5000 ms körüli időtúllépést említ, az MAJDNEM BIZTOSAN a Google
   token-csere (`f4c59571`), NEM a naptár -- a token-lépés örökli a naptár 5s-os korlátját, és a
   hibaszöveg félrevezetően a Calendar API-t nevezi meg.

   **Miért nem elég ide egy jó szabály** (2026-08-22, friday mérte): 08-22 reggel a napindító
   MCP-naptáreszközt keresett, nem talált, és azt írta ki Istinek, hogy "nincs bekötve
   naptár-eszköz". Aznap este megmérve a szolgáltatásfiók HTTP 200-at adott ugyanarra a
   naptárra, `accessRole: writer`-rel: **egy MŰKÖDŐ forrás lett elérhetetlennek jelentve.**
   A „nem elérhetőt írd ki" szabály közben helyesen tüzelt -- csak hamis állítást írt ki.
   Három leírás három különböző naptár-utat nevezett meg, és a napindítónak közülük kellett
   VÁLASZTANIA. Egy szabály, ami azon áll, hogy az olvasó a három közül a jót választja,
   nem szabály. Ezért lett egy parancs.
**HA A PARANCS NEM LÉTEZIK** (`No such file or directory`): az azt jelenti, hogy a javítás még
NINCS BEOLVASZTVA az éles ágba -- a `/Users/isti/marveen` fő checkout telepítési fa, és csak a
beolvasztott állapotot tartalmazza. Ez NEM "nincs naptár" és NEM "nincs levél": írd ki egy sorban
pontosan így, hogy *"naptár: a lekérdező szkript nincs beolvasztva (fix/6e6e40ce-napindito-adatforras)"*.
A különbség ugyanaz, mint mindenhol máshol ezen a lapon: az ÜRES és a NEM MÉRHETŐ nem ugyanaz.

3. AI hírek: WebSearch a tegnapi dátummal
4. Telegram küldés: a reply tool-lal (chat_id: lásd lentebb)
5. Ha egy kategóriában NINCS ESEMÉNY, hagyd ki a szekciót. Ha viszont NEM ÉRTED EL az
   adatforrást, azt ÍRD KI egy sorban, az okkal. A kettő nem ugyanaz, és a napindító
   hónapokig ígérhet email-blokkot úgy, hogy egyszer sem tudta lekérni.

<!-- BEGIN GENERATED: autonomy-wiring (auto-generated, do not edit by hand) -->
<!-- FIGYELEM: az alabbi szakasz GENERALT. Ide beszurt szoveg a kovetkezo agens-indulasnal NYOMTALANUL ELVESZ. Uj szakaszt a fenti BEGIN sor FOLE irj. -->
