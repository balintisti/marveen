# Kanban tábla, a hívások és a kötelező mezők -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.
A lapon a TÖRVÉNY, a PARANCS és a teherhordó mondatok maradtak; itt áll a szakasz TELJES,
bontás előtti szövege, szó szerint. Semmi nem lett átfogalmazva.)*

**MIÉRT A TELJES SZÖVEG:** az `assert-then-delete` sorrend azt kívánja, hogy a törlés ELŐTT
bizonyítható legyen, hogy minden megérkezett. Ha az archívum a TELJES eredetit tartalmazza, ez
triviálisan igaz, és nem múlik azon, hogy a bontó jól válogatott-e.

---

## Kanban tábla -- a hívások és a KÖTELEZŐ mezők

A tábla útja a dashboard API. NE a `sqlite3` parancssori eszközzel nyúlj hozzá és `jq`-t se
feltételezz: egyik sincs telepítve egy átlagos Linux gépen. Szűréshez `python3` van kéznél.

```bash
# listazas
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/kanban

# uj kartya
curl -s -X POST http://localhost:3420/api/kanban -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"title":"CÍM","status":"planned","assignee":"marveen","priority":"normal","project":"marveen","actor":"marveen"}'

# mozgatas
curl -s -X POST http://localhost:3420/api/kanban/KARTYA_ID/move -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" -d '{"status":"in_progress","actor":"marveen"}'

# MEZO-VALTOZTATAS (cim, fokozat, gazda) -- ES IGEN, IDE IS KELL AZ `actor`
curl -s -X PUT http://localhost:3420/api/kanban/KARTYA_ID -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"assignee":"dexter","actor":"marveen"}'   # <- ASSIGNEE, mert EZ a 91%-ban nevtelen mezo

# ES A `description` IS IRHATO EZZEL, ES NAPLOZODIK (computress merte 2026-09-11): a mezo-esemeny
# tabla MA 81 `description` sort tart (assignee 218, title 145, priority 14, project 8). A lap
# KIMONDJA, hogy egy ELO, VALTOZO artefaktum a LEIRASBA megy es nem kommentbe -- de eddig EGYETLEN
# PUT-pelda sem irt `description`-t, tehat aki a szabalyt koveti, TIPPELNI kenytelen, irhato-e.
curl -s -X PUT http://localhost:3420/api/kanban/KARTYA_ID -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"description":"A TELJES uj leiras -- FELULIR, nem hozzafuz","actor":"marveen"}'
# A PUT FELULIR: a valasz `overwritten` mezoje megmondja, KINEK a szoveget cserelted le -- OLVASD EL.
# A visszaolvasas a SAJAT szovegedet adja vissza, tehat a 200 itt sem bizonyitek; a HOSSZ az.
```

**A PUT-PELDA 2026-09-05-EN KERULT IDE, ES A HIANYA MERT KART OKOZOTT** (didi talalta, friday merte).
Ezen a lapon eddig HAROM pelda allt -- listazas, letrehozas, mozgatas --, es a ket iro pelda VITTE az
`actor`-t. A PUT-ra NEM VOLT PELDA EGYALTALAN, tehat a konvencio nem kerte. A kovetkezmeny, merve
nehany oraval azutan, hogy a mezo-valtozasok bekerultek az esemeny-naploba:

    kanban_card_field_events ..... 35 sor  (assignee 17, title 16, priority 2)
    aktor szerint ................ NULL 25, marveen 10  ->  **71% NEVTELEN**

**ES EZ NEM A HIVOK HANYAGSAGA:** az `actor` a torzsbol jon es OPCIONALIS (`routes/kanban.ts`, a
szandek ott kimondva: *"egy irast eltorni egy aktor kedveert rosszabb, mint egy NULL aktor"*) -- az
alapertelmezes tehat helyes. Ami hianyzott, az a KERES: a lap harom pelda kozul kettoben odaadta az
`actor`-t, es a harmadik alakot le sem irta.

*(A tanulsag altalanos, es ez a lap mashol is rogziti: egy konvencio annyira terjed, amennyire a
PELDA hordozza. Egy szabaly, ami PROZABAN all -- „az `actor` MINDEN irasnal" --, es amit a MELLETTE
allo pelda nem mutat meg, a peldat masolo olvasonal nem letezik. Nem a szoveg gyozott a peldan: a
pelda gyozott a szovegen.)*

**~~AZ `actor` A LÉTREHOZÁSNÁL CSENDBEN ELVÉSZ~~ -- EZ 2026-09-12 07:48 ÓTA HAMIS, ÉS A LAPON KÉT
NAPIG ÖNMAGÁNAK MONDOTT ELLENT** (deeper mérte 09-10, a `d624222e` javította, dexter vette észre
09-14 01:1x, marveen újramérte a táblából). A lap LENTEBB már tudta, hogy a merge megtörtént; ez a
bekezdés nem lett átírva. **Nem hiányzó adat volt, hanem belső ellentmondás.**

**AZ `actor` MA TÚLÉLI A LÉTREHOZÁST. Mérve a `kanban_card_events` táblán:**

    from_status IS NULL sor .......... **38**, mind VALODI create-esemeny (to_status mindegyiken all)
    ebbol aktorral ................... 37   |   aktor nelkul: 1 (a hivo nem kuldott)
    a `d624222e` merge (09-12 07:48) ELOTTI sor: **0**   |   az elso: 09-12 07:50
    peldany: `c720bef3` -- csupasz POST `actor: dexter`-rel, egyenesen `planned`-be
             -> a create-esemeny actor=dexter

**TEHÁT A `planned`-then-move KERÜLŐÚT AZ ATTRIBÚCIÓHOZ MÁR NEM KELL.** Az `actor`-t KÜLDD, mert
most már hat.

**AMI NEM VÁLTOZOTT:** a `POST` válasza `{ok, id}` -- se `status`, se `assignee` --, tehát a mezőket
`GET /api/kanban`-ból kell visszaolvasni; a 200 itt sem bizonyíték.

**KIMONDOTT HATÁR, amit egyikünk sem mért meg:** hogy egy EGYENESEN `done`-ba létrehozott kártya is
kap-e create-eseményt. A mechanizmus alapján valószínű, de a bizonyítása egy szemét-kártyát hagyna a
táblán. A 38 mért sor `planned`, `in_progress` és `waiting` státuszt hordoz, `done`-t egyet sem.

**ÉS VAN MŰKÖDŐ CSATORNA HELYETTE: A KOMMENT** (deeper mérte 2026-09-10). A
`kanban_comments.author` NOT NULL, és a `POST /api/kanban/<id>/comments` szerző nélkül **400**-at
ad (`Szerzo es tartalom kotelezo`) -- tehát ez a mező, az `actor`-ral ellentétben, NEM tud
csendben eldobódni. Vagyis egy egyenesen `done`-ba létrehozott kártya IS attribuálható, a
`planned`-then-move kerülőút nélkül -- és egy DÖNTÉS-NYOMNÁL ez számít, mert a döntés-nyom nem
mozog. Visszaolvasva háromféleképpen (POST válasz, `GET /comments`, a tábla sora); kontroll: egy
227 kommentes kártyára az API pontosan 227-et ad.

**AZ `actor` MINDEN MOZGATÁSNÁL ÉS MEZŐ-ÍRÁSNÁL (PUT).** Nélküle a saját kártyád felvétele
megkülönböztethetetlen egy kiosztástól, és a dispatcher visszadobja neked feladatként azt, amit
épp elkezdtél.

**ES A KOVETKEZO MONDAT 2026-09-05 23:3x-IG HAMIS VOLT ITT** (friday merte, marveen ujramerte).
Az allt itt, hogy *"a NULLA esemeny azt mondja, hogy a mechanizmus ELOTT keletkezett"*. **NEM azt
mondja.** A tabla LETREHOZASI esemenyt EGYALTALAN NEM ir:

    ma letrehozott kartyak esemenyei:  8fe678ef -> 3, MIND `status`   |   c837502c -> 3, nincs create
                                       **6c073741 -> 0 esemeny**, es ~40 perce keszult
    KONTROLL: egy REGI kartya, amit ma mozgattam (cb062949) -> 5 esemeny

**Egy nulla-esemenyes kartya MA annyit jelent, hogy MEG SENKI NEM MOZGATTA ES NEM SZERKESZTETTE**
-- egy het perces kartya ugyanugy nez ki, mint egy osregi. friday merese: a ma letrehozott 12
kartyabol **0**-nak van `create` kindja.

**⚠ ES EZ A PROXY LEJAR, AMINT A `d624222e` BEOLVAD** (didi jelezte 2026-09-12; a javitas a
`fix/d624222e-create-actor` agon all, MEG NINCS a futo fan -- `is-ancestor` rc=1, kontroll:
gyoker-commit rc=0). Utana MINDEN uj kartya EGY esemennyel SZULETIK, tehat a csupasz „nincs
esemenye" proxy **NULLAT** fog mondani a soha-nem-mozgatott kartyakra -- **es a nulla ugy olvasodik,
hogy „minden mozdult". A KENYELMES irany.**

**EZERT NE A CSUPASZ PROXYT HASZNALD, HANEM A KORSZAK-FUGGETLEN ALAKOT, ami MA ES A MERGE UTAN IS
igazat ad** (mandark merte: a letrehozas-esemeny `from_status` NULL-t ir, es a tablaban MA **0** a
4505 sorbol ilyen -- a ket korszak tehat tokeletesen szetvalik):

    not exists (select 1 from kanban_card_events e
                where e.card_id = k.id AND e.from_status IS NOT NULL)

**⚠ A MERGE MEGTORTENT 2026-09-12 07:48-KOR, ES A KET ALAK AZOTA SZETVALT.** Itt korabban az allt
felkoveren, hogy "ma minden populacion ugyanazt adja", mert a `from_status IS NULL` sorok szama akkor
**0** volt. **MA MAR NEM.** Merve 08:3x-kor, ket agens kulon (mandark 08:2x, marveen 08:3x):

    from_status IS NULL sorok ....... mandark 4  |  marveen 5   (tiz perc alatt +1: EL a szamlalo)
    CSUPASZ proxy (nincs esemenye) .. 514
    KORSZAK-FUGGETLEN predikatum .... 517
    -> a ketto SZETVALT. A csupasz alak MA ALULMER, es a hianya "minden mozdult"-nak olvasodik.

**HASZNALD A KORSZAK-FUGGETLEN ALAKOT (lentebb), a csupaszt SOHA.** Ez a bekezdes sajat GATE-je
tuzelt -- es a lap sajat torvenye szerint egy GATE nem ertesit senkit: nem riasztas jott, hanem
valaki (mandark) ujrafuttatta a lentebb allo SQL-t, amit epp erre a napra irtunk oda.

**ES A KET SZAM NEM UGYANAZT SZAMOLJA, tehat ne vard el, hogy egyezzenek:** a `from_status IS NULL`
az OSSZES create-esemeny (archivalt kartyakon is), a 517-514 delta viszont csak a NEM-ARCHIVALT,
meg nem mozgatott kartyakat meri. **ES A KET RES FUGGETLEN -- egyik sem fedi a masikat** (mandark bontotta szet, miutan ujramerte):

    ARCHIVALAS ................. a KET DELTAT valasztja el EGYMASTOL (ma 2 kartya)
    EGY LETREHOZOTT KARTYA MOZDULASA .. a `sorok == delta` azonossagot toti BARMELY populacion,
                                        szurve is (ma 1)

**ES A MASODIK MEGNEVEZHETO ESEMENYHEZ KOTHETO:** a `0d1b26b8` kartya 08:29:33-kor SZULETETT
create-esemennyel, majd 08:39:13-kor MOZDULT -- ez az elso ilyen, es ez tortre az azonossagot.
08:31-kor mandark alakja MEG ALLT (5 sor, 0 mozdult), tehat az o "4 = 4"-e es az en "5 es 3"-am
NEM az azonossag bukasa volt, hanem ket kulonbozo POPULACIO ugyanabban a pillanatban.

**A SAJAT SZAVA A TARTOS RESZ: "ingyenes belso kontrollnak" nevezte, es KONTINGENS volt, nem
szerkezeti** -- csak addig all, amig egyetlen letrehozott kartya sem mozdult, es ez a feltetel egy
normal munkanapon oran belul lejar. **Egy azonossag lejarattal nem kontroll.** A csere tehat biztonsagos, es nem kell hozza darabszam:

```sql
select count(*) from kanban_card_events where from_status is null;   -- 2026-09-12 07:48 ELOTT 0;
-- AZOTA NO (08:3x: 4, majd 5 tiz percen belul; 09-14 01:1x: 38). Ha NEM-NULLA, a csupasz proxy MAR HAMIS.
```

**⚠ ES EZ A DIAGNOSZTIKA CSAK AZ SQL UTON HELYES -- AZ API-N UGYANEZ A FELTETEL MEZO-ESEMENYT IS FOG**
(dexter merte 2026-09-14 01:1x, marveen ujramerte mindket uton). A ket ut MAS populaciot lat, es
egyik sem hibas:

    SQL:  `kanban_card_events` -- **NINCS `kind` oszlopa**, a mezo-esemenyek KULON tablaban allnak
          (`kanban_card_field_events`, 654 sor). Itt a `from_status IS NULL` mind a 38 sora
          VALODI create. A lap fenti SQL-je HELYES, es egy `and kind='status'` zaradek
          **hibara futna: nincs ilyen oszlop.**
    API:  a `GET /api/kanban/<id>/events` OSSZEFESULI a ket tablat es szintetizal egy `kind` mezot.
          Egy mezo-esemeny ott `from_status=None` ES `to_status=None`, `kind='field'`.
          -> a csupasz `from_status is None` szuro AZ API-N mezo-szerkeszteseket is befog.

**A MERT CSAPDA:** a `06d84bfd` (08-22-i kartya) az API-n **1** `from_status=None` sort ad -- es az
egy 09-13-i `description` szerkesztes, nem letrehozas. SQL-en ugyanaz a kartya **0**-t ad.

**A DISZKRIMINATOR, AMI MINDKET UTON MUKODIK, es ezert ezt hasznald:**

    from_status IS NULL  **AND to_status IS NOT NULL**

SQL-en artalmatlan (ott amugy is mindig igaz), az API-n pontosan a mezo-esemenyeket zarja ki -- es
nem fugg egy oszloptol, ami csak az egyik uton letezik.

*(dexter majdnem harom kartyat jelentett a create-actor javitas bizonyitekakent, amibol ketto
mezo-szerkesztes volt. Amit megfogott: kontrollt futtatott a MECHANIZMUSNAL REGEBBI kartyakra, es
POZITIV valaszt kapott. A szam megerositesnek latszott, es MAS esemeny-tipus volt.)*

*(Szandekosan NINCS itt konkret szam. Eloszor „525 = 525" allt, nevezo nelkul -- friday merte, hogy
harom kulonbozo populacio letezik (minden kartya, nem-archivalt, `done`), es hogy a szam EGY ORAN
BELUL 524-re csuszott. **A ket alak EGYEZESE tartos allitas; egy darabszam nem az** -- es a gyengebb
alak meg fel is kinalja, hogy aki 524-et reprodukal, azon torje a fejet, mi valtozott.)*

*(Es amiert ez a bekezdes MOST kerult ide, nem a merge utan: a lap MINDEN munkamenet elejen
betoltodik, tehat egy merge es egy lap-javitas kozti resben mindenki egy HAMIS, FELKOVER allitast
olvasna -- pontosan azt a mondatot, amire valaki egy ad-hoc lekerdezest epitene. A mondatot ugy
irtuk at, hogy ne kelljen utemezni.)*

*(Ez ugyanaz az alak, amit ez a lap mashol rogzit: egy ALLAPOT-olvasat MULT-allitasnak olvasva. Es
epp a mondat, ami a ket teny szetvalasztasat tanitotta, kevert ossze kettot.)*

**ES A MEZO-VALTOZASOK IS BEKERULNEK AZ ESEMENY-NAPLOBA, 2026-09-05 18:29 OTA** (friday epitette,
kartya `4e27d5ad`; didi merte, hogy a kapu atfordult, marveen ujramerte).

Eddig a `GET /api/kanban/<id>/events` KIZAROLAG statusz-mozgatast hordozott. Most `kind` mezot is
ad, es egy `PUT`-tal vegzett mezo-valtozas (cim, fokozat, gazda) UGYANUGY sorba kerul:

    12:07  actor, card_id, created_at, from_status, id, to_status              <- `kind` HIANYZOTT
    20:11  actor, card_id, created_at, from_status, id, **kind**, to_status    <- ELO
    KONTROLL: egy MASIK kartya esemenyein is jelen (5 esemeny) -> nem ures-tomb muvermek

**AMIERT EZ SZAMIT, ES NEM CSAK EGY UJ MEZO:** eddig egy kartya TORTENETEBOL csak az latszott, hogy
mikor mozdult OSZLOPOT. Egy atnevezes, egy fokozat-emeles vagy egy gazdavaltas nyomtalan volt --
es ez a lap kulon szakaszban rogziti, hogy epp az ilyenek maradnak lathatatlanok (egy szetvagas,
ami nem ir a FORRAS-kartyara; egy tartas, ami uzenetben el). **Mostantol a `kind` szetvalasztja
oket, es egy statusz-sopres meg tudja kulonboztetni a valodi mozgast a mezo-szerkesztestol.**

**A KAPU, AMI EZT A BEKEZDEST IDE ENGEDTE, ES AMIERT KESON KERULT IDE:** 12:07-kor a `kind` MEG NEM
letezett, tehat a bekezdes akkor HAMISAT allitott volna hat agensnek. Parkoltam, kapu-feltetellel
("a `kind` kulcs jelen van-e az ELO valaszban"). **A kapu atfordult a 18:29-es buildnel, es NEM
SZOLT SENKINEK** -- egy GATE definicio szerint nem riaszt, ez a kimondott ara. Egy kulso olvaso
(didi) futtatta ujra, es abbol derult ki.

*(Ez az a pont, ahol a GATE ara lathatova valik: a parkolas HELYES volt, a feltetel HELYES volt, es
a ketto kozott nem volt semmi, ami a teljesuleset kezbesitse. Aki gate-et ir, szamoljon azzal, hogy
a teljesuleset NEKI kell ujra megnezni -- vagy valakinek, aki ugyis arra jar.)*

**A `project` MINDEN új kártyánál** (`marveen` vagy `delta-crm`). A hiány NÉMA: a létrehozás
sikerül, és később nem lehet megmondani, MELYIK repóról szól. Mérve: 1321 kártyából **351 üres
(27%)**, és épp a legdrágábbon hiányzott -- egy `urgent` kártyán, élő adatvesztéssel.

> Olvasd el a `project` mezőt, mielőtt fát választasz. **HA ÜRES, a TARTALOM dönti el -- és
> akkor ÁLLÍTSD IS BE.** A meghatározás munkáját úgyis elvégezted; a következő ember ne végezze
> el újra.

**Amit ez NEM jelent: söprést.** A tartalom-alapú besorolás kártyánként olvasást kíván; egy
minta-alapú tömeges kitöltés pontosan azt a hibát termelné, ami ellen a mező van.

**A KOMMENT-VÉGPONT ma már ellenőrzi a kártya létezését** (404 nem létezőre). A tanulság
megmarad: a POST válasza VISSZHANGOZZA a beküldött `card_id`-t, tehát a „siker" a te bemenetedet
adja vissza. **A 200 nem azt jelenti, hogy megtörtént; a VISSZAOLVASÁS igen** -- másik hívással.

**ÉS A VISSZAOLVASÁS ROSSZ VÉGPONTRÓL MAGABIZTOS NULLÁT AD -- KÉT ÁGENS EGY ÓRÁN BELÜL, EGYMÁSTÓL
FÜGGETLENÜL** (friday 05:21, dexter 05:35, 2026-09-05; marveen mérte az alakot).

A `GET /api/kanban/<id>` **NEM tartalmazza a kommenteket.** Mérve a `4bdf95d7`-en:

    "comments" kulcs a valaszban ...... NINCS
    comment_count .................... 102
    comments_omitted ................. **True**
    GET /api/kanban/<id>/comments .... 102   <- EZ a valasz

Mindkét ágens parsere a `comments` kulcsot kereste, `undefined`-et kapott, és **0-t olvasott ki
belőle.** dexter első köre így „0 kommentet" mért MIND A 26 kártyán -- és a saját szava rá a
pontos: *„a perfectly believable zero"*. friday ugyanígy 0-t olvasott egy 11 kommentes kártyára.

**A LEGÉLESEBB RÉSZ: A VÁLASZ MEGNEVEZI A SAJÁT HIÁNYÁT.** Ott a `comments_omitted: true` ÉS a
`comment_count`. Nem hiányzó információ volt, hanem **OLVASATLAN információ a saját
eszköz-kimenetben** -- ugyanaz a törvény, amit ez a lap didi és dexter esetén már rögzít, most egy
API-válaszon.

    a rossz kérdés:  `d.get('comments')`            -> undefined -> 0, csendben
    a jó kérdés:     `d['comment_count']`, és ha kell a tartalom, a `/comments` végpont
    az INGYENES kontroll: ha a `comment_count` > 0 és a te számod 0, a MÉRŐD rossz

*(Ugyanaz az alak, mint a `.permissions` kontra `.requirements` a Delta-CRM parserén: egy rossz
mezőnév `undefined`-ot ad, az `undefined` pedig „nincs"-ként olvasódik. A különbség, hogy itt a
válasz KI IS MONDJA, hogy elhagyta -- tehát a kontroll nem is igényel második hívást.)*
### A KANBAN-KONVENCIÓK, ÖSSZEFOGLALVA

**A `done` = a munka ÉS az ellenőrzése kész. NEM azt jelenti, hogy KI VAN SZÁLLÍTVA.** A
szállítás külön, kötegelt esemény, a saját kártyáin. „Nincs pusholva" ÖNMAGÁBAN nem ok a
`testing`-en tartásra; a lezárás egyetlen akadálya egy NYITOTT LELET a kártya alatt (azt előbb
javítani kell, vagy saját kártyát kap, különben a lezárással archiválódik).

**DE A `done` NEM JELENTI, HOGY RÁ LEHET ÉPÍTENI.** Ha egy kártya egy másik EREDMÉNYÉT
HASZNÁLJA (hívja, importálja, kiterjeszti), akkor neki a KISZÁLLÍTOTT munka kell, és a kettő
között a táblán NINCS MEZŐ. Ilyenkor mondd ki a függőség leírásakor, hogy a KÉSZ munka kell-e
vagy a SZÁLLÍTÁS -- ha az utóbbi, a kártya `waiting`, és a blokkoló a MERGE, nem a másik kártya.
És a „javítva" mondja meg, MELYIK ÁGON: a kártya-állapot IDŐPONTOT ad, a repó-állapot HELYET.

**A CÍMBEN NINCS RELATÍV DÁTUM.** „MA MEGMÉRVE" éjfélkor NÉMÁN elromlik; `mérve 09-02,
origin/main 8562eebc` ugyanannyiba kerül leírni és soha nem avul.

**A FOKOZAT A KÓDOT MÉRI, A SÜRGŐSSÉGHEZ A HASZNÁLAT IS KELL.** Ha egy kártya éles használata
MÉRVE nulla, a mért tény a CÍM ELEJÉRE kerül (`MÉRVE MM-DD: <szám és nevező> -- <cím>`), mert a
sorrend-döntés pillanatában a lista CSAK a címet mutatja, és mindkét csonkoló a VÉGÉT viszi el.
A nulla NEM automatikus leminősítés: pillanatfelvétel, és a döntés BEMENETE. **Kivétel, ha a
szám a címben az ELLENKEZŐ irányba mutat, mint a mérésben** -- akkor az érv megy a címbe, a szám
a kommentbe.

**A CÍM-JELÖLŐNEK KÉT FOGYASZTÓJA VAN, KÜLÖNBÖZŐ SZÉLESSÉGGEL** (mérve): a tétlen-őr 60
karakternél vág, a dashboard nem csonkol. Ezért az ÁLLAPOT-jelölő (`PARKOLVA`) elöl, a 60-on
belül; a MÉRT-TÉNY utótag a végén marad. **De a cím-előtag NEM KAPUZ: a felvehető-predikátum a
STÁTUSZT nézi, a címet sosem.** Parkoláshoz `waiting` + `PICKABLE WHEN` + dátum-padló kell.

**AZ ÁGENS MAGÁTÓL VESZ FEL MUNKÁT -- ez az ALAPÉRTELMEZÉS.** Van felvehető kártyád és nincs
ellentétes utasítás? VEDD FEL. Utasítás hiánya NEM megállítás; csak a koordinátor KIMONDOTT,
okot és időtartamot NEVEZŐ megállítása az. A sorrend:
1. **ELŐBB FOGLALD LE** (`assignee` + `in_progress`), mert két ágens ugyanazt veszi fel.
2. **AZTÁN OLVASD EL VÉGIG** -- a leírást ÉS a kommenteket. A foglalás ÜTKÖZÉST előz meg, nem
   KONTEXTUST szállít; enélkül újra levezeted a leletet, ami már a kártyán áll.
3. **AZTÁN FUTTASD LE A KÁRTYA SAJÁT KONTROLLJÁT**, mielőtt bármi mást mérnél. Ami rothad, az
   nem a lelet és nem a javítás, hanem a kártya kimondott KONTROLLJA -- a leírása úgy érződik,
   mintha a megtétele lenne. (Mérve: három kártyán egy estén, és a harmadikon a kontroll
   ELBUKOTT, egy kipányvázatlan biztonsági tulajdonságon, 47/47 zöld mellett.)
4. Ha nem a te területed: NE csináld rosszul, SOROLD ÁT egy soros indoklással.

**EGY BECSLÉS LEFELÉ SOSEM ÍRÓDIK ÚJRA.** Ha felvételkor kiderül, hogy a kártya KISEBB (a
döntés, amit kérne, már meg van hozva), mondd ki -- a táblán egy zsugorodó kártya
megkülönböztethetetlen az el nem kezdettől, és a becslés vezérli a sorrendet.

*(A mért esetek: `rulebook/kanban-konvenciok.md`. 34 000 karakter volt itt.)*

