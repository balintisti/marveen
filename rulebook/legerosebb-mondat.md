# A legerősebb mondat utazik: a helyesbítés kézbesítésének öt kiadása

Ez 2026-09-10-ig a `CLAUDE.md`-ben állt. A TÖRVÉNYEK a lapon maradtak; itt az öt mért kiadás
áll -- mindegyik ugyanaz a rés, egyre nagyobb távolságra a keletkezés helyétől.

**MIKOR OLVASD EL:** ha egy állításodat vissza kell vonnod, és nem tudod, kinek; vagy ha egy
kártya-kommentet idézel egy döntéshez.

---

## A LEGERŐSEBB MONDAT UTAZIK, A FEJLÉC NEM (mandark, 2026-08-27)

**Az eset, és ennek nekem is közöm van hozzá.** Egy kártya-komment harmadik sora megnevezte a
környezetet: *"Környezet: :4230, `crm_e2e_test`"*. Negyven sorral lejjebb, ugyanabban a
kommentben, ez állt:

> *"Aki ezeket létrehozta, a felületen ma is azt látja, hogy a dokumentuma 'generálás alatt' áll
> -- öt napja, és örökre."*

Ezt idéztem a gazdának, majdnem szó szerint, éles tényként. Nem volt igaz: teszt-adatbázis, és a
37 sorból 36 magának az automata tesztkészletnek a maradéka.

**A mechanizmus, és ezt mandark fogalmazta meg, miután ELLENŐRIZTE azt az állításomat, ami őt
FELMENTETTE volna:**

> A fejléc-címke egy ÁLLAPOTOT ír le, az idézhető mondat viszont egy TÖRTÉNETET mond -- "aki
> ezeket létrehozta", "öt napja", "örökre". Egy történet magával viszi a saját olvasatát; a
> fejléc nem utazik vele. És aki továbbad, mindig a LEGERŐSEBB mondatot adja tovább, nem a
> fejlécet.

**A szabály, két oldalról:**

- **Aki ír:** minden mondat, ami FELHASZNÁLÓI KÁRT állít, vigye MAGÁBAN a környezetet -- akkor is,
  ha három sorral feljebb már ott áll, és akkor is, ha esetlenül ismétlődik. Az ismétlés olcsó.
  A kontroll: olvasd el a komment legerősebb mondatát ÖNMAGÁBAN, kiszakítva. Ha úgy élesre
  érthető, át kell írni.
- **Aki továbbad:** a legerősebb mondat mellé keresd meg a nevezőt, mielőtt idézed. Ha nincs a
  mondatban, az nem azt jelenti, hogy nincs.

**ÉS EGY SZINTTEL FELJEBB: A KÉSŐBBI CÁFOLAT SEM UTAZIK** (mandark mérte, 13:10).

A kanban-kommentek **append-only** -- nincs módosító végpont (`PUT .../comments/<id>` -> 404, egy
BIZTOSAN LÉTEZŐ id-vel mérve, tehát az ÚTVONAL hiányzik, nem a rekord).

**A következmény:** egy visszavont állítást tartalmazó komment ott marad, változatlanul
olvashatóan. Aki a kártyát VÉGIGOLVASSA, látja a cáfolatot. Aki EGY KOMMENTET IDÉZ -- ugyanaz a
mozdulat, amiből a fenti hibám született --, a cáfolat nélkül viszi tovább.

    A fejléc nem utazik a mondattal.
    A KÉSŐBBI CÁFOLAT nem utazik a kommenttel.

**Gyakorlati következmény:** ha kártya-kommentet idézel, nézd meg, van-e UTÁNA helyesbítés
ugyanattól a szerzőtől. A visszavonás mindig későbbi, mint amit visszavon.

**ES AZ ORVOSSAG, AMI MOSTANTOL KONVENCIO: EGY ELO, VALTOZO ARTEFAKTUM A KARTYA LEIRASABA MEGY, ES
A CIM MONDJA MEG, HOGY OTT VAN** (ket kartyan, ugyanabbol az okbol; a masodikat mandark javasolta,
marveen dontese, 2026-09-06).

    `30869dde`  DONTESI SORREND ISTINEK -- "AZ ERVENYES LISTA A KARTYA LEIRASABAN ALL"
    `2ee40464`  jogosultsagi reteg-terkep -- "AZ ELO RETEG-TERKEP A KARTYA LEIRASABAN ALL"

**A LEIRAS SZERKESZTHETO, A KOMMENT NEM.** Egy lista, terkep vagy szam, ami VALTOZIK, kommentekben
tarolva minden korrekcioval egy TOVABBI meghaladott peldanyt hagy maga utan -- es az olvaso ott all
meg, ahol eppen.

**A MERT AR, ugyanazon a napon, ugyanazon a kartyan:** a `2ee40464` hetbol HET kommentje hordozott
meghaladott szamot (`191`, `207`, `209`, `12 hely`, `7 visel`), **es haromat a koordinator irta,
miközben az elozot probalta javitani** -- az egyik javitas maga is meghaladott lett negy perc alatt.
Minden megallasi pont az utolso elott rossz szamot ad.

**A CIM AZERT KELL, mert a mutato nelkul a leiras csak egy TOVABBI hely.** Es a mutato az ELSO 60
KARAKTERBE kerüljön: a tetlen-or `slice(0, 60)`-nal vag, tehat egy leletet elore toltő cim epp a
mutatot vagja le. *(Ezen a ket kartyan a cim eleje maga a mutato -- nem a lelet.)*

**AMIT EZ NEM VALT KI:** a komment tovabbra is a NYOM -- a meres, a kontroll, a kimondott hatar oda
kerül, es a leiras csak az EREDMENYT hordozza. Egy leirasba tomoritett meres elveszti azt, ami
ellenorizhetove teszi.

**ÉS A TÜKÖRKÉPE, EGY MÉRT PÉLDÁNNYAL: A HOZZÁFŰZÖTT MINŐSÍTŐ SEM UTAZIK A FEJLÉCCEL**
(friday mérte 2026-09-06, egy uptime-riasztó két hívóján; marveen írta be).

A fenti szakasz azt mondja, hogy a KONTEXTUS marad le az erős mondatról. Van egy ellentétes
irányú alakja, és ugyanaz a mechanizmus:

    az uptime-riasztás fejléce ..... "NO UPTIME DATA AT ALL -- zero series returned"
    a hívó saját kommentje UTÁNA ... egy hozzáfűzött tagmondat, ami KIMONDJA, hogy ez lehet
                                     mérési kudarc is -- és mindkét hívó így tett

**A fejléc egy MÉRÉST állít, ami meg sem történt.** És ami idézve lesz, amit egy `severity`-szűrő
illeszt, és amit egy ember a riasztás-listában lát, az a FEJLÉC -- a hozzáfűzött minősítő ott
nincs jelen.

> **Egy hozzáfűzött minősítő nem utazik. Ami utazik, az a fejléc.**

**ÉS A DEFEKTUS KÉT ÚTON ÁLLT ELŐ UGYANAZZAL A FEJLÉCCEL:** egy bukott `timeSeries` hívás
ugyanúgy üres listát ad, mint egy token-hiba -- tehát a "nem tudtam mérni" és a "mértem, és nincs
adat" BÁJT-AZONOS a kimeneten, miközben ELLENTÉTES teendőt ír elő.

**A javítás nem hosszabb magyarázat, hanem a fejléc SZÉTVÁGÁSA:** `NOT MEASURED -- <ok>` az egyik
úton, és a mért nulla a másikon, a hedge NÉLKÜL. Ami eddig a tagmondatban állt, az felkerül oda,
ahol az olvasó néz.

*(És a mért ár a másik felén: marveen ugyanezen a riasztáson egy OKOT talált ki -- "a gcloud
lassabb a 15 másodperces keretnél" -- egy BENYOMÁSBÓL, és kártya-CÍMBE írta. Mérve: 280-1160 ms,
13-27-szeresen a keret alatt, mindkét oldalon kontrollal. A cím az egyetlen hely, ami egyedül
utazik -- oda nem való meg nem mért ok.)*

### EGY KÁRTYA-ID ÉS EGY RÖVID COMMIT-HASH UGYANAZ AZ ALAK -- ÉS A KÁRTYA-ID **SOHA** NEM OLDÓDIK
### FEL, TEHÁT A HIBA TÖKÉLETESEN KÖVETKEZETES (dexter, mandark és computress, 2026-08-29)

Mindkettő **nyolc hex karakter**. Egy `\b[0-9a-f]{7,10}\b` minta, ami „commit-hash"-t szed ki egy
kártya-kommentből, ugyanúgy megfogja a HIVATKOZOTT KÁRTYÁK azonosítóit -- és
`git merge-base --is-ancestor <kártya-id> HEAD` NEM-et válaszol.

    dexter:  öt kártya jött vissza NOT SHIPPED-ként egyetlen kötegben. Mind az öt SZÁLLÍTVA volt.
    jarvis:  „12 és 9 commit-hash" -> valójában 5 és 4; a többi kártya-id, köztük a kártya SAJÁTJA
    mandark: **1373 kártya-id a táblán, ebből commitként feloldódik: 0.**
             KONTROLL: egy ismert valódi hash ugyanabba a listába -> 1374 ellenőrizve, 1 old fel

**A HARMADIK SZÁM MEGFORDÍTJA A TANULSÁGOT:** nem az a kockázat, hogy egy kártya-id ÜTKÖZHET egy
committal. Az, hogy **soha nem oldódik fel: 1373-ból 0.** A hibás válasz tehát 100%-osan
konzisztens -- nincs kivétel, nincs furcsa találat, semmi nem kelt gyanút. **Egy csapda, ami néha
elsülne, évekkel ezelőtt feltűnt volna.**

**A JAVÍTÁS KÉT LÉPCSŐS, ÉS EGYIK SEM HELYETTESÍTI A MÁSIKAT:**

    KINYERÉSKOR   horgonyozz a `commit:` szóra, ne nyolc hex karakterre. Ez az EGYETLEN valódi
                  javítás -- utólagos párja nincs.
    JELENTÉSKOR   `case $?` a `||` helyett (didi): 0) MERGED  1) NOT merged  **128) CANNOT ANSWER**
                  A `--is-ancestor` egy nem létező objektumra 128-at ad, és a `||` ezt
                  „NOT merged"-dé alakítja: egy HIBÁT verdikté.

**AMI NEM MŰKÖDIK, pedig kézenfekvő** (computress): egy MÁR NYERS nyolc-hex listát
`rev-parse --verify`-val szűrni. Az egy kártya-id-ből „NOT A COMMIT"-ot csinál -- szállítási
kérdésben **ugyanaz a rossz válasz, más szavakkal**.

**A MEGKÜLÖNBÖZTETŐ A COMMIT TÁRGYA, NEM A FELOLDÁS.** Írasd ki a `%s`-t a hash mellé: egy üres
tárgy-oszlop azonnal megmutatja, hogy nem commit -- és elkapja azt is, amit a horgonyzás nem: egy
hasht, ami feloldódik, de MÁS munkához tartozik.

**AZ IRÁNY ITT IS A DRÁGA:** a „not shipped" egy KÉSZ kártyát tart nyitva. Ez a biztonságosnak
látszó rossz válasz, nem kerül semmibe láthatóan, és senki nem kérdőjelezi meg.

### ÉS A TÖRLÉS-KÁRTYÁKON A TARTALOM-ELLENŐRZÉS FORDÍTVA HAZUDIK: A SÍRKŐ (dexter, 2026-08-29)

Egy kártyán, aminek a JAVÍTÁSA egy TÖRLÉS, a hiány maga a bizonyíték. Egy tartalom-ellenőrzés
nem-nulla találata tehát „nincs leszállítva"-ként olvasódik. **És egy jó szerző SÍRKÖVET hagy** --
egy kommentet arról, mit és miért távolított el --, ami pontosan ezt a találatot termeli.

    94a7f8c3  `_findOrCreateCompany` -> 1 találat: egy spec KOMMENTJE, ami elmagyarázza, hogy azok
              halott kódok voltak. A metódusok nincsenek meg.
    c3efc0b4  `canReopenTask` -> 1 találat, a ROSSZ szolgáltatásban: komment a :309-en, hogy a
              metódus OTT LAKOTT, senki nem hívta, és EZEN a kártyán törölték
    computress: `TASK` a command-palette alatt -> HAT találat, öt sírkő és egy nem rokon komment
    mandark:    egy LECKE-NAPLÓ bejegyzés a törölt eszközről -- negyedik fajta, és egy repó, ami a
                saját történetét írja, ezt folyamatosan termeli

**AZ INGYENES KONTROLL (computressé): nézd meg, hogy a TESTVÉREK látszanak-e még.** Az ő döntő
artefaktuma egy sor volt: `type: 'PROJECT' | 'COMPANY' | 'CONTACT'` -- a TASK eltűnt, a másik három
ott van, tehát a hiány VALÓDI hiány, nem törött mérő. Minden törlés-kártyán elérhető, egy
pillantásba kerül.

**AMIT EZ NEM AD: SÖPRÉST.** computress és mandark KÉT független populáción mérte a cím-alapú
keresést -- 12/84-ből 2-3 valódi, 4/36-ból 1. mandark három hamis pozitívja **ugyanannak a szónak
három KÜLÖNBÖZŐ jelentéséből** jött: a halott kód mért HIÁNYA, egy funkció TULAJDONNEVE, és egy
METAFORA. Ezért nem menti meg jobb minta: **a szó nem a fogalom.**

**ÉS A HARMADIK KIADÁS, UGYANAZON A NAPON: A HELYESBÍTÉS NEM UTAZIK A MÁR ELKÜLDÖTT ÜZENETTEL**
(computress mérte 2026-08-27 18:11-kor, egy neki szóló üzenetben).

jarvis egy kártya-kommentből (5664) üzenetet is küldött. A kommentből a HÉJ ette ki a
visszaperjeles részt, ő ezt észrevette, és a kártyán helyesbítette (5670) -- a helyesbített
állítása gyengébb ÉS helyes volt. Csakhogy **az üzenet a helyesbítés ELŐTTI érveléssel ment el**,
és a címzettnél az volt az egyetlen példány, amíg el nem olvasta a kártyát. A címzett a hibás
állítás alapján kezdett volna dolgozni.

    a fejléc nem utazik a MONDATTAL
    a későbbi cáfolat nem utazik a KOMMENTTEL
    a helyesbítés nem utazik a MÁR ELKÜLDÖTT ÜZENETTEL

A három ugyanaz a rés, három távolságra. És a harmadik a legrosszabb, mert a komment append-only
(a cáfolat legalább OTT VAN a kártyán, ha valaki végigolvassa), az elküldött üzenet viszont
**visszahívhatatlan** -- a címzett kontextusában nincs semmi, ami jelezné, hogy azóta megdőlt.

**A szabály:** ha helyesbítesz egy kommentet, amit ÜZENETBEN IS elküldtél, a helyesbítés is
menjen el üzenetben, ugyanannak a címzettnek. Nem elég a kártyára írni. Egy második üzenet olcsó;
egy hibás premisszán elkezdett munka nem az.

*(És ez az az eset, ahol a helyesbítő üzenet akkor is indokolt, ha a címzett sora tele van -- mert
nem ÚJ munkát tol, hanem egy már kézbesített, hibás utasítást von vissza.)*

**ÉS A NEGYEDIK KIADÁS, AHOL A KÜLDŐ MINDENT JÓL CSINÁLT: A HELYESBÍTÉS ELMEGY, DE SORBA ÁLL --
KÖZBEN EGY MÁSFAJTA ARTEFAKTUM AZONNAL LÁTSZIK** (computress mérte magán, 2026-08-28).

Dexter két, egymásnak ellentmondó dolgot látott tőle, és jogosan:

    6631  „a kérdés nyitva"          küldve 11:31:18   KÉZBESÍTVE 11:36:37
    cf802d6d commit                  11:37             <- AZONNAL látható
    6640  „a döntés a te oldaladra"  küldve 11:42:23   **PENDING, sosem kézbesült**

A helyesbítés LÉTEZIK és EL LETT KÜLDVE. A címzett sorában ül -- ami 3-on állt, amikor ment --,
miközben egy COMMIT azonnal olvasható volt neki. **A commit nem áll sorba. Az üzenet igen.**

    a fejléc nem utazik a MONDATTAL
    a cáfolat nem utazik a KOMMENTTEL
    a helyesbítés nem utazik a MÁR ELKÜLDÖTT ÜZENETTEL
    és a helyesbítés UTAZIK, csak LASSABBAN, mint egy másfajta artefaktum ugyanarról
    és a helyesbítés IDŐBEN ODAÉR, csak MÁS CÍMZETTHEZ -- ahhoz, aki a MUNKÁT végzi,
        nem ahhoz, aki az ÁLLÍTÁST viszi kifelé

Ez a negyedik a legalattomosabb, mert **senki nem hibázott**: a küldő helyesbített, üzenetben,
azonnal. A rés a KÉZBESÍTÉSI SEBESSÉGEK KÜLÖNBSÉGÉBEN keletkezett, és a címzett oldalán úgy néz ki,
mint két ellentmondó állítás ugyanattól az embertől.

**A gyakorlati következmény nem új szabály, hanem egy meglévő INDOKA: ha egy döntés COMMITBA kerül,
kerüljön a KÁRTYÁRA is, ne csak üzenetbe. A kártya nem áll sorba.** computress fel is írta a kártyára
(komment 35, 11:33) -- de dextert ÜZENETBEN szólította meg, tehát ő a sorra várt.

*(És ezért nem elég a „ha tele a sora, írd a kártyára" szabály önmagában: az a KÜLDÉST szabályozza.
Itt a küldés rendben ment; a kártya azért kellett volna, hogy a címzett a saját tempójában TALÁLJA
MEG, ne a router adja oda.)*

**ÉS AZ ÖTÖDIK KIADÁS, AHOL A HELYESBÍTÉS IDŐBEN MEGÉRKEZETT -- CSAK NEM AHHOZ, AKI AZ ÁLLÍTÁST
KIFELÉ VITTE** (jarvis mérte, 2026-09-05; a hibás mondat marveené, egy Istinek szóló összefoglalóban).

mandark 00:16:17-kor azt írta nekem, hogy a `73e14f45` 3. tétele NEM MÉRHETŐ. 00:21:12-kor
**VISSZAVONTA -- de jarvisnak**, mert jarvis mérte ki közben, hogy mérhető (225 = 260 - 35,
kontrollal: mind a 35 futásidejű útvonal a statikus megjelöletlen halmazON BELÜL van, 35 be / 0 ki).
jarvis eredménye viszont csak mandarkhoz ment.

    a helyesbítés LÉTEZETT ....... 00:21:12
    KÉZBESÍTVE volt ............... igen, mandarknak
    marveen összefoglalója ........ ~00:26, és „item 3 mindkettőjük által ELUTASÍTVA"-t állított
    -> **ÖT PERCCEL a helyesbítés után, és senki, aki tudta, nem beszélt azzal, aki írta**

**Ez NEM időzítési kérdés, mint a negyedik kiadás.** Ott a helyesbítés lassabban utazott, mint egy
másik artefaktum. Itt IDŐBEN odaért, a helyes tartalommal, a helyes emberhez a MUNKA szempontjából
-- és rossz emberhez az ÁLLÍTÁS szempontjából.

**A SZABÁLY: ha visszavonsz egy állítást, a visszavonás annak IS menjen, akitől az állítás
SZÁRMAZOTT vagy aki TOVÁBBVISZI** -- tipikusan a koordinátornak --, nem csak annak, akivel épp
együtt méred. A munkatárs a méréssel megy tovább; a koordinátor a MONDATTAL.

*(A gyakorlati jegy, amiről felismerhető: ha valakinek „nem mérhető"-t mondtál, és utána KIDERÜL,
hogy mérhető, akkor pontosan az az egy ember hordozza a hamis mondatot, akinek először mondtad.)*

**ÉS AMIT A SZERZŐ TETT HOZZÁ, MERT KÜLÖNBEN EZ A SZAKASZ IS HAZUDNA** (mandark, ugyanaznap):

> A hibás mondatom NEM figyelmetlenségből született. Azért írtam úgy, mert a felhasználói HATÁST
> akartam érzékeltetni -- vagyis pont a jó szándék termelte a bajt.

Ha úgy olvasódik, mintha hanyagság lett volna, akkor **mindenki azt hiszi, hogy ő nem esne bele**
-- és a leginkább elkötelezett író fog belefutni, mert épp ő akarja majd élesen érzékeltetni, mi
forog kockán. Egy szabály, ami „vigyázz jobban"-t mond, ezt nem fogja meg. Ami megfogja, az a
**mechanikus kontroll**: olvasd el a legerősebb mondatot kiszakítva.

**Miért nem elég a fogadói fegyelem.** A címke ott volt, és pontosan azért nem védett, mert nem a
mondat része volt. Egy szabály, ami azon áll, hogy a továbbadó visszalapoz negyven sort, nem
szabály -- ugyanaz az alak, amit ez a lap máshol is tilt.

**ÉS A KONTROLL UGYANAZON A NAPON MŰKÖDÖTT, ELŐRE** (computress, 2026-08-27 18:06 -- öt órával a
fenti eset után, egy MÁSIK ágensnél, aki csak a leírt szabályt ismerte).

A kész mondata ez volt: *„egy kötelező igen/nem mező, AMIT A FELHASZNÁLÓ SOSEM LÁTOTT, a nevében
'nem'-re válaszolódik."* Erős, jól hangzik, és **hamis** -- a szekció típus-szűrés nélkül
rendereli a kötelező mezőket, tehát a checkbox ott van a képernyőn, kipipálatlanul.

**A commit ELŐTT nézte meg, nem utána**, és nem azért, mert gyanús volt: azért, mert a mondat
erős volt. Ez a szabály teljes mechanikája, és pont annyi. A délelőtti eset és ez ugyanaz a
mozdulat, ellentétes irányban -- a különbség nem a figyelem volt, hanem hogy valaki elolvasta a
saját legerősebb mondatát ÖNMAGÁBAN, mielőtt utazni engedte.

*(A megmaradt lelet nem lett gyengébb attól, hogy a mondat pontosabb: a kötelező mezők
alapértelmezései ASZIMMETRIKUSAK -- a BOOLEAN átenged, a CHECKBOX megállít, a NUMBER a
checkboxszal viselkedik egyformán --, és ez egyik alapértelmezésből sem látszik. A visszavonás a
túlállítást vitte el, nem a leletet.)*

### EGY HÍVÁS-ALAKRA HORGONYZOTT MINTA VAK A PONT-MENTES ÁTADÁSRA -- ÉS A JELE AZ EGYENLETESSÉG
(dexter mérte magán, 2026-09-03; a mérő HELYES kódra mondta, hogy nincs ott)

    grep -cF 'withoutTriggerCredentials('   ->  2, HÁROM KÜLÖNBÖZŐ FÁN, betűre ugyanaz

A minta a NYITÓ ZÁRÓJELRE horgonyzott, a kód viszont `.map(withoutTriggerCredentials)` alakban adja
át a függvényt -- **név után nincs zárójel**. Vagyis a mérő pont azt a hívási formát nem látta,
amelyik számít, és a `-F` (fix sztring) miatt nem is tudott volna.

**AMI MEGFOGTA, AZ NEM A FIGYELEM VOLT: a szám HÁROM eltérő fán volt AZONOS.** Egy valódi mérés
szór; egy implauzibilisan egyenletes eredmény műszerhiba. A szerző majdnem azt írta le, hogy a saját
ágán nincs redaktálva az, amit ő maga javított -- **hamis negatív a saját kész munkájára.**

**A GYAKORLATI ALAK:** ha egy függvény MEGHÍVÁSÁT keresed, a `név(` horgony a `.map(név)`,
`.then(név)`, `[név]`, `= név` alakokat mind kihagyja. Vagy horgonyozz a PUSZTA NÉVRE és szűrd a
találatokat, vagy mérd meg mindkét alakot külön és add össze -- de a darabszám mellé mindig nézd
meg, hogy SZÓR-e ott, ahol szórnia kellene.

*(Ugyanaznap ugyanattól a szerzőtől a testvér-hiba: `grep -A4` egy olyan `return` fölött, amit a
saját ötsoros kommentje kitolt az ablakból. Az ABLAK túl szűk, ez a MINTA túl szűk -- két külön
mechanizmus, azonos néma nulla.)*
