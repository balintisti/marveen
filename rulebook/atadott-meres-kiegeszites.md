# Egy átadott mérés -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.)*

---

## EGY ÁTADOTT MÉRÉS VIGYE MAGÁVAL, MIHEZ KÉPEST IGAZ (Isti kérdésére, 2026-08-22)

**MINDEN ÁTADOTT MÉRÉS MELLÉ HÁROM DOLOG JÁR:**

    1. MIKOR mérted        -- `date` KÖZVETLENÜL a leírás előtt, KÜLÖN hívásban. Nem becsülve,
                              és nem kompenzálva ("mire kimegy, később lesz"). A kimenetet
                              MÁSOLD, ne értelmezd.
    2. MILYEN ÁLLAPOTON     -- ág + COMMIT, vagy a tábla pillanatfelvétele, vagy a POPULÁCIÓ.
                              **Egy szám a nevezője nélkül nem állítás.** És egy LÉTEZÉS-állítás
                              ugyanígy: „X már ott van" fa nélkül fél mondat.
    3. MI TENNÉ ÉRVÉNYTELENNÉ -- ez a legerősebb, mert a fogadó egy pillanat alatt ellenőrzi.

**A FOGADÓ OLDALÁN:** ha a 3. pont feltétele megváltozott, a mérés ÚJRAMÉRENDŐ, nem vitatandó.
Ha nincs 3. pont, KÉRDEZZ VISSZA, ne építs rá.

**ÉS EGY HALMAZ A SZŰRŐJE NÉLKÜL NEM REKONSTRUÁLHATÓ.** Egy szám újramérhető; egy „melyeket
hagytam ki" halmaz nem: egy újralevezetett szűrő MÁSIK halmazt hagy ki, és a különbség
láthatatlan. **A szűrőt FUTÁS KÖZBEN írd le** -- utólag csak azt tudod rekonstruálni, amit
megtaláltál. És a legrosszabb fajta szűrő az, ami KORRELÁL azzal, amit mérsz: az nem zajt ad,
hanem szisztematikus, egyirányú torzítást, hihető szám mellett. A próba: *az a tulajdonság, ami
alapján kizárok, összefügg azzal, amit MÉROK?*

**EGY ÖSSZEHASONLÍTÓ ÁLLÍTÁS AZ ALAPVONALA NÉLKÜL NEM ÁLLÍTÁS, HANEM KÉTÉRTELMŰ** -- az olvasó a
sajátját teszi alá, és ugyanaz a mondat igaz az egyik alapvonalhoz és hamis a másikhoz.

**MIÉRT TÉR EL KÉT SZÁM -- ÉS CSAK AZ ELSŐ KETTŐT SZOKTUK KERESNI.** *(A fejléc szándékosan nem
mond számot: a lista nőtt már egyszer, és a fejlécbe írt darabszám némán elavul, miközben a fejléc
az egyetlen sor, ami önmagában utazik. Számold meg a sorokat.)*

    1. MÁS A NEVEZŐ (más populáció)
    2. MÁS A MÉRŐ (más definíció)
    3. **MÁS A FA** -- azonos definíció, azonos egység, MÁSIK COMMIT. Ez a legkönnyebben
       átsikló változó: mindkét szám helyes a saját fáján, és semmi nem hívja fel rá a figyelmet.
    4. **VÉLETLENÜL EGYEZNEK** -- és ez a rosszabb, mert nem szül vitát. Két szám ugyanazzal az
       értékkel, MÁS EGYSÉGBEN (fájl kontra hívási hely, sor kontra tétel), megerősítésnek
       látszik. **A próba: ha valaki más ugyanezt a számot kapja, abból következik-e, hogy
       ugyanazt MÉRTE?** Ha a mérő kézenfekvő és mindenki ahhoz nyúl, a válasz NEM.
    5. **TÖLCSÉR-ÁLLOMÁST OLVASUNK VÉGEREDMÉNYNEK** (`191 jelölt -> 47 gyanús -> 0 élő`): egy
       ÁLLOMÁS soha nem adódik hozzá semmihez, benne van az előtte állóban.
    6. **A POPULÁCIÓBAN KÉT KÜLÖNBÖZŐ ELŐÁLLÍTÓ VAN: GÉP ÉS EMBER** -- és összevonva a GÉPET méred,
       miközben az EMBERRŐL állítasz. **A hiba iránya a MEGNYUGTATÓ: 100%-ot jelent.**
    7. **A JAVÍTÁS MEGNÖVELI A NEVEZŐT, ÉS EMIATT A HIBASZÁM IS NŐ** (mandark mérte 2026-09-11).
       Egy teszt-suite, ami BE SEM TÖLTŐDIK, **NULLA tesztet ad a nevezőhöz** -- tehát a bukó
       TESZTEK száma nem alulméri a defektust, hanem ELREJTI:

           bukó SUITE ..... 11 -> 3        <- a javítás FÉLREÉRTHETETLEN
           bukó TESZT ..... 16 -> **20**   <- ugyanaz a javítás REGRESSZIÓNAK látszik
           össz teszt ..... 10638 -> 10732 <- +94 CSAK a javítás miatt vált futtathatóvá
           KONTROLL: 546 suite mindkét futásban, ÚJ bukó suite: nincs

       **Aki bukó TESZT-számra kapuz, egy MŰKÖDŐ javítást olvas regressziónak.** Általánosan: ha a
       vizsgált defektus maga csökkenti a populációt, akkor az előtte/utána összevetés a rossz
       tengelyen áll -- **arra kell kapuzni, ami a defektustól FÜGGETLENÜL számolható** (itt: a
       suite-ok, nem a tesztek).

    8. **EGY CSONKOLT NÉZETET OLVASUNK POPULÁCIÓNAK** -- `head -5`, `--limit 100`, egy lista első
       képernyője. A szám HELYES arról, amit visszaadtak, és HAMIS arról, amit kérdeztél.
       **A PRÓBA EGY SOR, ÉS INGYEN VAN: ha a visszakapott darabszám PONTOSAN EGYENLŐ a limittel,
       csonkolt.** (Mérve 2026-09-11 éjjel KÉTSZER, két ágensnél: `head -5` -> „3 szerver" a valódi
       12 helyett; `--limit 100` -> „100 GET" a valódi 104 helyett, és ez majdnem egy kártya CÍMÉBE
       került, ahol soha senki nem vezeti le újra. Mindkettőt ugyanaz a kérdés fogta meg: mi a
       NEVEZŐ. És mindkettő a KÉNYELMES irányba tévedett -- a kisebb szám kevesebb munkát ígér.)

**A 6. DETEKTÁLÁSI MÓDJA A LEGHASZNÁLHATÓBB RÉSZE, mert nem ítélet kell hozzá, hanem egy oszlop:
AZ ÉRTÉK PONTOSSÁGA MEGMONDJA, KI ÁLLÍTOTTA ELŐ** (mandark mérte 2026-09-11, a saját első futását
döntve meg vele).

    MÁSODPERC-pontos fejléc (`18:31:29`) ... 507/507, 952/952, 798/798 EXACT <=2s
                                             -> ezt senki nem gépeli be ezerszer. GÉPI BÉLYEG.
    PERC-pontos fejléc (`16:25 CEST`) ...... 0/62, 2/29, 0/27 exact
                                             -> ITT a szerző VÁLASZTOTT, és CSAK ez hordoz jelet

**Összevonva ~100% „pontosság" jött ki mindenkire.** Szétválasztva a valódi, EMBERI szám:
**142 negatív / 9 pozitív eltérés = 94%**, ágensenként 89-100%, a legnagyobb pozitív **+4 perc**.
*(A kontroll a szerző saját hipotézisét ölte meg: feltételezte, hogy a közös helper okozta a
másodperc-csúcsot -- az arány viszont a helper ELŐTT volt 100%, és UTÁNA esett 76-89%-ra.)*

**ÉS EBBŐL KÖVETKEZIK A „CITÁLTSÁG NEM OLVASÁS" LIMIT POZITÍV FELE:** ahol egy VISELKEDÉSI törvény
betartása MÉRHETŐ NYOMOT hagy -- itt egy ELŐJELET --, ott a megfelelés KÖZVETLENÜL mérhető, és nem
kell idézettséggel közelíteni. Ahol nem hagy (egy hangnem-szabálynak nincs előjele), ott a válasz
**NEM MÉRHETŐ, nem nulla.** A kettő nem szimmetrikus, és ugyanaz a mérő az egyikre válaszol, a
másikra nem.

**HA KÉT MÉRÉS ELTÉR, A NÉZETELTÉRÉS MARADJON NYITVA**, amíg valaki meg nem méri, MELYIK
POPULÁCIÓ. Egy magyarázat, ami mindkét számot igazzá teszi, nem feloldás -- és a GYÁRTOTT
EGYETÉRTÉS eltünteti a jelet, ami épp a hibát fogta volna meg. **A nézeteltérés mérőeszköz.**

**A KATEGÓRIA NEVE A MECHANIZMUST NEVEZZE MEG, NE EGY PÉLDÁNYÁT.** Egy gyűjtő-kategória
mindent felszív és semmit nem mond; egy PÉLDÁNY-név betű szerint kihagy érvényes eseteket. Minden
kategória mellé egy mondat: MITŐL VÉD ez az alak.

**EGY SZABÁLY, AMI ÍRÁSKOR TÜZEL, CSAK A HANYAGON SEGÍT. AMI OLVASÁSKOR, AZ A GONDOSAT IS
MEGFOGJA.** Mért eset: három ágens futott ugyanabba a csapdába egy éjszakán, és a szabály MÁR LE
VOLT ÍRVA, névvel. Mindhárman figyeltek; írás közben egyikük sem hibázott. Ezért: amikor egy
leletből szabályt írsz, kérdezd meg, MIKOR tüzel -- és keress hozzá egy olcsó, olvasáskori
próbát, még ha redundánsnak látszik is.

**A KONTROLLRÓL, HÁROM RÉTEGBEN:**
- **Egy diszkrimináló kontroll is válaszolhat a SZOMSZÉD kérdésre.** A kontroll azt igazolja,
  hogy a mérőd MŰKÖDIK; azt nem, hogy AZT MÉRI, AMIT KÉRDEZTÉL. Egy TÖRÖTT kontroll nem tüzel és
  ezt észreveszed; egy ÉRVÉNYES kontroll a ROSSZ OBJEKTUMON tüzel, és minél PONTOSABB, annál
  meggyőzőbb.
- **A kontroll a MÉRT HALMAZON KÍVÜLRŐL jöjjön**, és NE tartalmazza azt, amiben bizonytalan vagy.
  Egy rövid részlet UGYANABBÓL a hibás emlékezetből ugyanazt a defektust hordozza -- és akkor a
  kontroll MEGERŐSÍTI a törött mérőt.
- **A kontroll UGYANAZT AZ ALAKOT használja, amivel a mérés fut** (változóval, ha a mérés
  változóval megy). Különben pontosan azt a hibát nem látja, amiért létezik.
- **Egy BUKÓ pozitív kontroll nem hiba, hanem a lelet maga:** vagy a mérő rossz, VAGY a világ
  gazdagabb, mint a modelled. A kézenfekvő reakció -- a kontroll „megjavítása", amíg zöld nem
  lesz -- pont azt az alakot dobja el, amit épp felfedeztél.
- **Ingadozó alanyon a kontroll SZÁM, nem állapot.** Egy zöld futás nem cáfolat, csak egy minta
  n=1-gyel; a „nem történt meg" és a „nem történik meg" ugyanúgy néz ki.

**AMIKOR A MÉRŐ HIBÁJA UGYANOLYAN ALAKÚ, MINT A KERESETT DEFEKTUS**, a találat SOHA nem
különbözteti meg a kettőt, és semmennyi újraolvasás nem segít. A kérdés a mérő megírásakor: *ha
az eszközöm elromlik, az úgy fog kinézni, mint egy TALÁLAT, vagy mint egy HIBA?* Ha találatnak,
a kontroll nem szorgalmi feladat, hanem a mérés fele.

**A SZÓRÁS, NEM AZ ÉRTÉK.** Egy valódi mérés SZÓR; egy elhasalt mérő tökéletesen egyenletes. És
a tükörképe rosszabb: egy IMPLAUZIBILISAN KONZISZTENS találat ugyanúgy műszerhiba, csak a
reprodukálhatóság normálisan NÖVELI a bizalmat.

**A MÉRÉS ÉS A MAGYARÁZAT NE ÁLLJON UGYANABBAN A BEKEZDÉSBEN JELÖLETLENÜL.** A szám mellé a
PARANCS jár; az ok mellé az, hogy MI IGAZOLJA -- és ha semmi, akkor a szó, hogy *feltételezés*.
Kettő közül csak az egyiket ellenőrizte valaki. **És a fogadó oldalán: mielőtt egy kapott érvre
CÍMET, STÁTUSZT vagy FOKOZATOT írsz át, válaszd szét, melyik mondat a mérés és melyik a
következtetés.** Ha az üzenetben nincsenek szétválasztva, a szétválasztás a tiéd.

**ÉS A HELYESBÍTÉS MAGA IS ÁLLÍTÁS -- NEM ÖRÖKLI A VISSZAVONT MÉRÉS HITELÉT** (computress mérte
magán 2026-09-11, két lépcsőben; marveen ugyanaznap a FOGADÓ oldalán).

    a KIZÁRÁS indoka .... „ezek ikonok, rájuk 3:1 vonatkozik"  -> IGAZ, és MÉRETLEN
                          -- és elég igaz volt ahhoz, hogy MEGÁLLÍTSA a mérést
    a HELYESBÍTÉS ....... „háromnál a 3:1 sem teljesül"        -> szintén MÉRETLEN
                          (a téma LEGROSSZABB sima felületéhez mérve, nem a VALÓDI háttérhez)
    újramérve ........... **nulla megerősített** -- egy átment, egy alfa-kompozitált (ebben a
                          populációban nem is volt benne), egy pedig szomszédos címkével áll,
                          tehát dekoratív, és a kritérium nem vonatkozik rá

**A második hiba UGYANAZ AZ ALAK, mint az első, egy szinttel feljebb -- és a szerzője ÉPP AKKOR
követte el, amikor az elsőről szóló tanulságot írta le.**

**MIÉRT ÉLI TÚL: a helyesbítés a VISSZAVONÁS TEKINTÉLYÉVEL érkezik.** A *„tévedtem, valójában ez
van"* alak gondosabbnak HANGZIK, mint az eredeti -- maga a visszavonás aktusa olvasódik a
körültekintés bizonyítékának. Ezért nem kéri számon senki a kontrollt rajta.

**A FOGADÓ OLDALÁN UGYANEZ, ÉS OLCSÓBB JAVÍTANI:** aznap este egy MÉRÉSEKKEL érkező helyesbítés
alapján visszavontam egy HELYES döntésemet. A mérés valódi volt; csak nem arra a kérdésre
válaszolt (a küldő a LANDOLÁSRA mérte, és az INDÍTÁSRÓL mondta ki). **Egy valódi szám nem
bizonyíték arra, hogy az a szám, ami neked kell.**

> **A PRÓBA, ÉS UGYANAZ MINDKÉT IRÁNYBAN: a helyesbítés UGYANAZT a kontrollt kapja, mint egy
> eredeti lelet.**

**ÉS EGY ALTERNATÍVA MEGCÁFOLÁSA NEM BIZONYÍTÉK A SAJÁTOD MELLETT -- MINDKETTŐ LEHET ROSSZ**
(marveen mérte magán 2026-09-11, három Telegram-üzenet árán).

    (A) a hiba-MENNYISÉG ugrott     <- az én magyarázatom
    (B) csak a jelentés CÉLJA változott  <- a kézenfekvő alternatíva

Megmértem a **(B)**-t, gondosan, mindkét oldalról (a régi és az új projekt napi bontása), és
MEGCÁFOLTAM. **Ebből azt vontam le, hogy akkor (A) igaz** -- és elküldtem.

**De az (A)-t soha nem mértem meg.** Az (A) mérője a NAPLÓ, nem a Sentry; a Sentry számai
mindkét hipotézisben ugyanazok. Megmérve: a napló szerint a mennyiség VÉGIG ugyanaz volt, sőt
csökkent -- **tehát (A) is hamis, és a valódi válasz egyik sem volt.**

> **A PRÓBA: melyik MÉRŐ döntené el a SAJÁT hipotézisedet?** Ha ugyanaz, amivel az alternatívát
> cáfoltad, akkor nem mérted meg, csak kizártál. Egy A-vagy-B keret önmagában állítás -- és a
> leggyakoribb harmadik válasz az, hogy a kérdés rossz.

*(Miért él túl: a cáfolat MUNKA volt, mérésekkel és kontrollal, és a munka elvégzésének érzete
átterjed a maradék állításra. Minél alaposabb az alternatíva kizárása, annál magabiztosabb a
levezetett következtetés -- és annál kevésbé jut eszébe bárkinek külön megmérni.)* Ha a visszavont állításhoz mérés kellett volna, akkor a helyébe lépőhöz is.
> És aki helyesbítést KAP: kérdezd meg, MIT mért, mielőtt mozdulsz.


**EGY DÖNTÉS-KÉRÉS PREMISSZÁJA TIPIKUSAN IGAZ EGY RÉSZRE, ÉS AZ EGÉSZRE VAN ALKALMAZVA.** A
küldő mérése rendszerint HELYES; ami hiányzik, az az ÁTMENET a mért állítás és a kért döntés
között -- és az a lépés LÁTHATATLAN, mert nincs kimondva. A koordinátori próba: **melyik átmenet
a mért állítás és a kért döntés között, és megmérte-e azt valaki?**

**A MUTÁCIÓS PRÓBÁRÓL:** a kérdés nem az, hogy „pirosra megy-e", hanem hogy „megkülönbözteti-e
az ÁLLÍTÁSOM azt a KÉT ÁLLAPOTOT, ami engem érdekel". A tizenkét ismert hibamód -- a patch nem
alkalmazódott, típus-annotációba esett, halott soron ült, a fixture vele mozdult, a harness
visszaállította, az állítás tűrőképes, a mutáció eltörte az alanyt, kevesebbet mért, a harness
elejtette a dimenziót, az alany szűkebb a claimnél, a futtató semmire nem illesztett, és a
sorrend-függés -- `rulebook/mutacios-alakok.md` és `rulebook/atadott-meres.md`.
**És a legfontosabb egy mondatban: mutáld azt, amit az ÁLLÍTÁS véd, ne azt, amit a JAVÍTÁS
megváltoztatott.**

*(A teljes eset-anyag, a visszavonásokkal és a kontrollokkal: `rulebook/atadott-meres.md`.
81 309 karakter volt itt.)*

