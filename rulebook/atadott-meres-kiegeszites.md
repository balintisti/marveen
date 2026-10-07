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


---
*(kikoltoztetve 2026-10-06, marveen)*

### A HELYESBÍTÉS MAGA IS ÁLLÍTÁS -- NEM ÖRÖKLI A VISSZAVONT MÉRÉS HITELÉT

    a KIZARAS indoka .... igaz lehet, es MERETLEN -- es eleg igaz ahhoz, hogy MEGALLITSA a merest
    a HELYESBITES ....... szinten MERETLEN, es a VISSZAVONAS TEKINTELYEVEL erkezik

**MIÉRT ÉLI TÚL: a *„tévedtem, valójában ez van"* alak gondosabbnak HANGZIK, mint az eredeti** --
maga a visszavonás aktusa olvasódik a körültekintés bizonyítékának. Ezért nem kéri számon senki a
kontrollt rajta.

**A FOGADÓ OLDALÁN UGYANEZ, ÉS OLCSÓBB JAVÍTANI:** egy MÉRÉSEKKEL érkező helyesbítés alapján
vissza lehet vonni egy HELYES döntést. A mérés valódi volt; csak nem arra a kérdésre válaszolt.
**Egy valódi szám nem bizonyíték arra, hogy az a szám, ami neked kell.**

> **A PRÓBA, ÉS UGYANAZ MINDKÉT IRÁNYBAN: a helyesbítés UGYANAZT a kontrollt kapja, mint egy
> eredeti lelet.** Ha a visszavont állításhoz mérés kellett volna, akkor a helyébe lépőhöz is.
> És aki helyesbítést KAP: kérdezd meg, MIT mért, mielőtt mozdulsz.

**ÉS EGY ALTERNATÍVA MEGCÁFOLÁSA NEM BIZONYÍTÉK A SAJÁTOD MELLETT -- MINDKETTŐ LEHET ROSSZ.** Mért
eset: az alternatívát gondosan, mindkét oldalról megmértem és MEGCÁFOLTAM, ebből azt vontam le, hogy
akkor az enyém igaz -- és elküldtem. **A sajátomat soha nem mértem meg**, mert annak MÁSIK mérő
felelt volna. Megmérve az is hamis volt: a valódi válasz egyik sem.

> **A PRÓBA: melyik MÉRŐ döntené el a SAJÁT hipotézisedet?** Ha ugyanaz, amivel az alternatívát
> cáfoltad, akkor nem mérted meg, csak kizártál. Egy A-vagy-B keret önmagában állítás -- és a
> leggyakoribb harmadik válasz az, hogy a kérdés rossz.

**ÉS EGY FOKKAL ERŐSEBB ALAK UGYANEBBŐL A CSALÁDBÓL: A LEHETETLENSÉG-ÁLLÍTÁS -- „NINCS OLYAN FORMA,
AMI MINDKETTŐT MEGADJA"** (didi mérte magán 2026-09-17, a saját állítását cáfolva meg).

Egy A-vagy-B keret azt mondja, hogy kettő közül kell választani. Ez azt, hogy **NINCS harmadik** --
és épp ezért nem néz utána senki: az állítás maga mondja ki, hogy nincs ott mit keresni.

    egy HIBÁS SZÁM ............ valaki előbb-utóbb újraméri
    egy HIBÁS LEHETETLENSÉG ... **bezár egy ajtót, és az ajtó zárva marad**

**A MECHANIZMUS, ÉS NEM HANYAGSÁG: KÉT TULAJDONSÁG, AMI A PÉLDÁBAN EGYÜTT JÁRT.** didi azt írta,
hogy az őr populáció-padlóját nem lehet próza-biztossá tenni anélkül, hogy visszanyitná a vakfoltot,
amit épp megtalált. Megmérve HAMIS: a komment-strip a kód-próbáját PIROSAN hagyja (a változón át
vezetett kapu KÓDBAN él, tehát túléli a strippelést), a padló-próbát PIROSRA viszi ott, ahol addig
némán zöld volt, és tüzeli a pint. Az ok: **a kód ALAKJÁT (`disabled={...isDirty...}`, ez volt a vak)
összemosta a kód SZÖVEGÉVEL (`isDirty` a kommenteken kívül, ez nem az).** A helyes kizárás szűkebb,
mint amit a lehetetlenség állított.

**ÉS A MÁSODIK FELE AZ, AMI MIATT EGY ILYEN HELYESBÍTÉS ELMARAD: AZ AJÁNLÁS VÁLTOZATLAN MARADT.**
„Ma ne változtassunk" volt előtte és utána is -- tehát kívülről úgy néz ki, hogy nincs mit javítani.
De az INDOK megfordult: nem „nem lehet megjavítani anélkül, hogy elrontanánk", hanem „meg lehet,
olcsón, csak ma semminek nem kell". **A következő döntést az INDOKBÓL hozzák, nem az ajánlásból** --
és a régi indok mellett senki nem próbálja meg.

> **Ha egy cáfolat az INDOKOT dönti meg és az AJÁNLÁST nem, a helyesbítés akkor is köteles.**
> A próba: *ha valaki fél év múlva elővenné, a régi indok ELTÁNTORÍTANÁ-e?* Ha igen, megy a
> helyesbítés, akkor is, ha ma semmi nem változik tőle.

*(Miért él túl: a cáfolat MUNKA volt, mérésekkel és kontrollal, és a munka elvégzésének érzete
átterjed a maradék állításra. Minél alaposabb az alternatíva kizárása, annál magabiztosabb a
levezetett következtetés -- és annál kevésbé jut eszébe bárkinek külön megmérni.)*

**EGY DÖNTÉS-KÉRÉS PREMISSZÁJA TIPIKUSAN IGAZ EGY RÉSZRE, ÉS AZ EGÉSZRE VAN ALKALMAZVA.** A küldő
mérése rendszerint HELYES; ami hiányzik, az az ÁTMENET a mért állítás és a kért döntés között -- és
az a lépés LÁTHATATLAN, mert nincs kimondva. A koordinátori próba: **melyik átmenet a mért állítás
és a kért döntés között, és megmérte-e azt valaki?**

**A MUTÁCIÓS PRÓBÁRÓL:** a kérdés nem az, hogy „pirosra megy-e", hanem hogy „megkülönbözteti-e az
ÁLLÍTÁSOM azt a KÉT ÁLLAPOTOT, ami engem érdekel". A tizenkét ismert hibamód:
`rulebook/mutacios-alakok.md` és `rulebook/atadott-meres.md`. **És a legfontosabb egy mondatban:
mutáld azt, amit az ÁLLÍTÁS véd, ne azt, amit a JAVÍTÁS megváltoztatott.**



---
*(kikoltoztetve 2026-10-06, marveen)*

### A KONTROLLRÓL, HÁROM RÉTEGBEN

- **Egy diszkrimináló kontroll is válaszolhat a SZOMSZÉD kérdésre.** A kontroll azt igazolja, hogy a
  mérőd MŰKÖDIK; azt nem, hogy AZT MÉRI, AMIT KÉRDEZTÉL. Egy TÖRÖTT kontroll nem tüzel és ezt
  észreveszed; egy ÉRVÉNYES kontroll a ROSSZ OBJEKTUMON tüzel, és minél PONTOSABB, annál meggyőzőbb.
- **A kontroll a MÉRT HALMAZON KÍVÜLRŐL jöjjön**, és NE tartalmazza azt, amiben bizonytalan vagy.
  Egy rövid részlet UGYANABBÓL a hibás emlékezetből ugyanazt a defektust hordozza -- és akkor a
  kontroll MEGERŐSÍTI a törött mérőt.
- **A kontroll UGYANAZT AZ ALAKOT használja, amivel a mérés fut** (változóval, ha a mérés változóval
  megy). Különben pontosan azt a hibát nem látja, amiért létezik.
- **⚠ ÉS EZ A KETTŐ ÜTKÖZIK, HA A DEFEKTUS MAGÁBAN AZ ALAKBAN VAN -- A FELOLDÁS AZ, HOGY A KONTROLL
  AZT A TENGELYT VÁLTOZTASSA, AMIT ÉPP VIZSGÁLSZ** (deeper mérte magán 2026-09-20, marveen
  függetlenül reprodukálta). Az előző két pont szerint a kontroll jöjjön KÍVÜLRŐL, de UGYANAZZAL az
  alakkal. Ha a hiba az ALAKBAN ül, a második pont a kontrollba is beleviszi -- és akkor a kontroll
  nem cáfol, hanem MEGERŐSÍTI a törött mérőt.

  A mért eset: egy `T="$(cat .../.dashboard-token)" curl -H "Authorization: Bearer $T" ...`
  alak 401-et adott. Az ELŐTAG a PARANCS környezetét állítja, a `$T` viszont ugyanabban a sorban
  van, tehát a SZÜLŐ héj helyettesíti be ELŐBB, üresre -- a kérés hitelesítés NÉLKÜL ment ki.
  A szerző kontrollja egy MÁSIK VÉGPONT volt, ugyanazzal az alakkal, és az is 401-et adott.
  **Megerősítésnek olvasta. A saját hibájának megerősítése volt.**

      elotag-alak (`VAR=... cmd ... $VAR`) ... **401**
      ugyanaz `;`-vel ........................ 200   <- a TENGELY: az ALAK, nem a vegpont
      a hazi, dokumentalt inline alak ........ 200   (`Bearer $(cat ...)`)
      es zsh-ban meg csak el sem jut odaig: `no matches found` a csupasz `?` glob miatt

  **A PRÓBA: nevezd meg, MIT gyanítasz, és a kontroll AZT változtassa.** Szervert gyanítasz ->
  változtasd a KLIENST (másik alak, ismerten jó hívás). Alakot gyanítasz -> változtasd az ALAKOT.
  Egy szomszédos VÉGPONT ugyanazzal a törött paranccsal nem kontroll, hanem ugyanaz a mérés kétszer.

  **A KITETTSÉG MÉRVE, ÉS EZÉRT BEKEZDÉS, NEM LINT-SZABÁLY:** a követett fában NULLA káros
  előfordulás (egy találat, `scripts/start.sh:31`, ahol a változó a szülőben MÁR be van állítva,
  tehát ártalmatlan), a házi alak pedig hét szkriptben inline `$(cat ...)` -- immunis. A veszély az
  ELDOBHATÓ EGYSOROSBAN van, amit valaki egy fordulón belül gépel, és azt egy cenzus szerkezetileg
  nem látja. Ugyanaz a hatókör, mint a locale-kollációnál.
- **Egy BUKÓ pozitív kontroll nem hiba, hanem a lelet maga:** vagy a mérő rossz, VAGY a világ
  gazdagabb, mint a modelled. A kézenfekvő reakció -- a kontroll „megjavítása", amíg zöld nem lesz
  -- pont azt az alakot dobja el, amit épp felfedeztél.
- **ÉS EGY NEGYEDIK RÉTEG, AMI NEM A HELY, HANEM AZ IDŐ: A HELYREÁLLÍTOTT ADATNAK NINCS FÜGGETLEN
  TANÚJA, HA A VÁRAKOZÁST UTÓLAG ÍRJUK LE** (mandark alakja, 2026-09-24, a `50eee909` backfilljén).
  Egy pótlás után a kézenfekvő ellenőrzés az, hogy „megjelentek-e a sorok" -- az viszont csak
  JELENLÉTET mér, nem HELYESSÉGET, és a hiba iránya a megnyugtató: a rossz sorok is sorok.
  Ami működött: mandark a javítás ELŐTT rögzített egy független cenzust a transcriptekből
  (agensenkent, naponta), és a pótlás UTÁN ahhoz vetette a táblát -- mind a hét ágensre egyezett.
  **A kontroll ereje itt az IDŐBÉLYEGÉBŐL jön: egy a változás előtt leírt várakozást nem lehet az
  eredményhez igazítani.** Egy utólag levezetett „ennyinek kell lennie" ugyanabból az adatból jön,
  amit ellenőriz. *(És mellé egy NEGATÍV kontroll ugyanabban a futásban: „nincs új scratchpad-sor"
  -- vagyis a javítás nem is gyűjtött TÖBBET a kelleténél.)*
- **Ingadozó alanyon a kontroll SZÁM, nem állapot.** Egy zöld futás nem cáfolat, csak egy minta
  n=1-gyel; a „nem történt meg" és a „nem történik meg" ugyanúgy néz ki.




<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2417-2421, szó szerint -->
*(A mért esetek TELJES szövege -- a nyolc eltérés-ok példái, a másodperc-pontosság cenzusa, a
helyesbítés-eset két lépcsője és az A-vagy-B keret cáfolata -- `rulebook/atadott-meres-kiegeszites.md`.
12 956 karakter volt itt. A `rulebook/atadott-meres.md` és a `rulebook/mutacios-alakok.md`
továbbra is érvényes.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2434-2443, szó szerint -->
**ÉS EGY HALMAZ A SZŰRŐJE NÉLKÜL NEM REKONSTRUÁLHATÓ.** Egy szám újramérhető; egy „melyeket hagytam
ki" halmaz nem: egy újralevezetett szűrő MÁSIK halmazt hagy ki, és a különbség láthatatlan. **A
szűrőt FUTÁS KÖZBEN írd le** -- utólag csak azt tudod rekonstruálni, amit megtaláltál. És a
legrosszabb fajta szűrő az, ami KORRELÁL azzal, amit mérsz: az nem zajt ad, hanem szisztematikus,
egyirányú torzítást, hihető szám mellett. **A próba:** *az a tulajdonság, ami alapján kizárok,
összefügg azzal, amit MÉROK?*

**EGY ÖSSZEHASONLÍTÓ ÁLLÍTÁS AZ ALAPVONALA NÉLKÜL NEM ÁLLÍTÁS, HANEM KÉTÉRTELMŰ** -- az olvasó a
sajátját teszi alá, és ugyanaz a mondat igaz az egyik alapvonalhoz és hamis a másikhoz.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2444-2468, szó szerint -->
### MIÉRT TÉR EL KÉT SZÁM -- ÉS CSAK AZ ELSŐ KETTŐT SZOKTUK KERESNI
*(A fejléc szándékosan nem mond számot: a lista nőtt már egyszer. Számold meg a sorokat.)*

1. **MÁS A NEVEZŐ** (más populáció).
2. **MÁS A MÉRŐ** (más definíció).
3. **MÁS A FA** -- azonos definíció, azonos egység, MÁSIK COMMIT. A legkönnyebben átsikló változó:
   mindkét szám helyes a saját fáján, és semmi nem hívja fel rá a figyelmet.
4. **VÉLETLENÜL EGYEZNEK** -- rosszabb, mert nem szül vitát. Két szám ugyanazzal az értékkel, MÁS
   EGYSÉGBEN (fájl kontra hívási hely), megerősítésnek látszik. **A próba: ha valaki más ugyanezt a
   számot kapja, abból következik-e, hogy ugyanazt MÉRTE?**
5. **TÖLCSÉR-ÁLLOMÁST OLVASUNK VÉGEREDMÉNYNEK** (`191 jelölt -> 47 gyanús -> 0 élő`): egy ÁLLOMÁS
   soha nem adódik hozzá semmihez, benne van az előtte állóban.
6. **KÉT KÜLÖNBÖZŐ ELŐÁLLÍTÓ: GÉP ÉS EMBER** -- összevonva a GÉPET méred, miközben az EMBERRŐL
   állítasz, és a hiba iránya a MEGNYUGTATÓ (100%-ot jelent). **A detektálása egy oszlop, nem ítélet:
   AZ ÉRTÉK PONTOSSÁGA megmondja, ki állította elő.** Másodperc-pontos fejléc = GÉPI bélyeg;
   PERC-pontos = ott a szerző VÁLASZTOTT, és csak ez hordoz jelet. Összevonva ~100% jön ki
   mindenkire; szétválasztva a valódi, EMBERI szám **94%**.
7. **A JAVÍTÁS MEGNÖVELI A NEVEZŐT, ÉS EMIATT A HIBASZÁM IS NŐ.** Egy teszt-suite, ami BE SEM
   TÖLTŐDIK, **NULLA tesztet ad a nevezőhöz**: bukó SUITE 11 -> 3 (félreérthetetlen javítás), bukó
   TESZT 16 -> **20** (ugyanaz a javítás REGRESSZIÓNAK látszik). **Aki bukó TESZT-számra kapuz, egy
   MŰKÖDŐ javítást olvas regressziónak.** Ha a defektus maga csökkenti a populációt, arra kapuzz,
   ami a defektustól FÜGGETLENÜL számolható.
8. **EGY CSONKOLT NÉZETET OLVASUNK POPULÁCIÓNAK** -- `head -5`, `--limit 100`. **A PRÓBA INGYEN VAN:
   ha a visszakapott darabszám PONTOSAN EGYENLŐ a limittel, csonkolt.**



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2469-2501, szó szerint -->
**HA KÉT MÉRÉS ELTÉR, A NÉZETELTÉRÉS MARADJON NYITVA**, amíg valaki meg nem méri, MELYIK POPULÁCIÓ.
Egy magyarázat, ami mindkét számot igazzá teszi, nem feloldás -- a GYÁRTOTT EGYETÉRTÉS eltünteti a
jelet, ami épp a hibát fogta volna meg. **A nézeteltérés mérőeszköz.**

**ÉS A PRÓBA, AMI EZT MECHANIKUSSÁ TESZI: EGY FELAJÁNLOTT MAGYARÁZAT TAGSÁGÁT SZÁMOLD MEG, MIELŐTT
KIMONDOD.** Mért eset: két cenzus 469 kontra 467, és a felajánlott magyarázat („a tesztem
whitespace-t vág") MINDKÉT számot igazzá tette volna. Lefuttatva: a mechanizmus tagsága **0**.
A valódi ok a mérő volt -- a két futás között leírtak két leírást.

> **Egy magyarázat, aminek nincs megszámolt tagsága, nem magyarázat, hanem javaslat.** A kérdés nem
> az, hogy HIHETŐ-e, hanem hogy **HÁNY ESETET FED -- és ha nullát, akkor semmit nem magyaráz.**

**ÉS A GYÁRTOTT EGYETÉRTÉS IKRE, AMIT SENKI NEM GYÁRT: KÉT FÜGGETLEN MÉRŐ, EGY KÖZÖS MŰSZER.** Mért
eset: két ágens egymástól függetlenül `tsc` -> **21 hiba**, bájtra ugyanaz, egész nap alapvonalként
idézve. A 21 nem a FA tulajdonsága volt, hanem egy HAT NAPOS, MEGOSZTOTT Prisma-kliensé -- ugyanabban
a fában `prisma generate` után **0 hiba**.

> **A megerősítés FÜGGETLEN MŰSZERT kíván, nem független megfigyelőt.** A kérdés nem az, hogy
> „ketten mérték-e", hanem hogy **UGYANAZT a szerszámot, fát, klienst vagy cache-t használták-e.**
> Amikor egy számot MÁSODSZOR mérsz, a kérdés nem „ugyanazt kapom-e", hanem „MÁS ÚTON kapom-e".

**A KATEGÓRIA NEVE A MECHANIZMUST NEVEZZE MEG, NE EGY PÉLDÁNYÁT.** Egy gyűjtő-kategória mindent
felszív és semmit nem mond; egy PÉLDÁNY-név betű szerint kihagy érvényes eseteket. Minden kategória
mellé egy mondat: MITŐL VÉD ez az alak.

**EGY SZABÁLY, AMI ÍRÁSKOR TÜZEL, CSAK A HANYAGON SEGÍT. AMI OLVASÁSKOR, AZ A GONDOSAT IS
MEGFOGJA.** Mért eset: három ágens futott ugyanabba a csapdába egy éjszakán, és a szabály MÁR LE
VOLT ÍRVA, névvel. Mindhárman figyeltek; írás közben egyikük sem hibázott. Ezért: amikor egy
leletből szabályt írsz, kérdezd meg, MIKOR tüzel -- és keress hozzá egy olcsó, olvasáskori próbát.

*(A mért esetek: `rulebook/atadott-meres-kiegeszites.md`.)*




<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2502-2528, szó szerint -->
### A KONTROLLRÓL

- **Egy diszkrimináló kontroll is válaszolhat a SZOMSZÉD kérdésre:** azt igazolja, hogy a mérő
  működik, nem azt, hogy AZT méri, amit kérdeztél.
- **A kontroll a mért halmazon KÍVÜLRŐL jöjjön, de UGYANAZZAL az alakkal** fusson, amivel a mérés.
- **Ha a defektus MAGÁBAN AZ ALAKBAN van, a kontroll AZT a tengelyt változtassa, amit gyanítasz.**
  Mért eset: `T="$(cat tok)" curl -H "Bearer $T"` -> 401 (a `$T`-t a SZÜLŐ héj helyettesíti be,
  üresre), és a „kontroll" egy másik végpont volt UGYANAZZAL a törött alakkal -- megerősítette a hibát.
- **Egy BUKÓ pozitív kontroll nem hiba, hanem a lelet maga:** ne „javítsd" zöldre.
- **Helyreállított adatnál a várakozást a VÁLTOZÁS ELŐTT írd le** (független cenzus), különben
  ugyanabból az adatból jön, amit ellenőriz.
- **Ingadozó alanyon a kontroll SZÁM, nem állapot** (n=1 zöld nem cáfolat).

**AMIKOR A MÉRŐ HIBÁJA UGYANOLYAN ALAKÚ, MINT A KERESETT DEFEKTUS**, a találat SOHA nem különbözteti
meg a kettőt. A kérdés a mérő megírásakor: *ha az eszközöm elromlik, az úgy fog kinézni, mint egy
TALÁLAT, vagy mint egy HIBA?* Ha találatnak, a kontroll nem szorgalmi feladat, hanem a mérés fele.

**A SZÓRÁS, NEM AZ ÉRTÉK.** Egy valódi mérés SZÓR; egy elhasalt mérő tökéletesen egyenletes. És a
tükörképe rosszabb: egy IMPLAUZIBILISAN KONZISZTENS találat ugyanúgy műszerhiba, csak a
reprodukálhatóság normálisan NÖVELI a bizalmat.

**A MÉRÉS ÉS A MAGYARÁZAT NE ÁLLJON UGYANABBAN A BEKEZDÉSBEN JELÖLETLENÜL.** A szám mellé a PARANCS
jár; az ok mellé az, hogy MI IGAZOLJA -- és ha semmi, akkor a szó, hogy *feltételezés*. **És a
fogadó oldalán: mielőtt egy kapott érvre CÍMET, STÁTUSZT vagy FOKOZATOT írsz át, válaszd szét,
melyik mondat a mérés és melyik a következtetés.** Ha az üzenetben nincsenek szétválasztva, a
szétválasztás a tiéd.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 2529-2545, szó szerint -->
### A HELYESBÍTÉS MAGA IS ÁLLÍTÁS -- NEM ÖRÖKLI A VISSZAVONT MÉRÉS HITELÉT

- **A helyesbítés UGYANAZT a kontrollt kapja, mint egy eredeti lelet** -- a „tévedtem, valójában"
  alak gondosabbnak hangzik, ezért senki nem kéri rajta számon. Aki helyesbítést KAP: kérdezd meg,
  MIT mért, mielőtt mozdulsz.
- **Egy alternatíva megcáfolása nem bizonyíték a sajátod mellett.** Melyik MÉRŐ döntené el a saját
  hipotézisedet? Ha nem mérted, csak kizártál.
- **A lehetetlenség-állítás („nincs olyan forma, ami mindkettőt megadja") bezár egy ajtót**, és az
  ajtó zárva marad. Ha egy cáfolat az INDOKOT dönti meg és az AJÁNLÁST nem, a helyesbítés akkor is
  köteles: a következő döntést az indokból hozzák.
- **Egy döntés-kérés premisszája tipikusan egy RÉSZRE igaz, és az egészre van alkalmazva.** Melyik
  átmenet a mért állítás és a kért döntés között, és megmérte-e valaki?
- **Mutációs próba:** mutáld azt, amit az ÁLLÍTÁS véd, ne azt, amit a JAVÍTÁS megváltoztatott
  (`rulebook/mutacios-alakok.md`).

*(A mért esetek: `rulebook/atadott-meres-kiegeszites.md`.)*

