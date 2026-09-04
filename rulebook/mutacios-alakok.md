# MUTACIOS ES KONTROLL-ALAKOK -- ESET-ARCHIVUM

Ez a `CLAUDE.md` `### A MUTACIO ODAER, ES MEGSEM MER` szakaszanak KISZERVEZETT
bizonyitek-anyaga (kartya `c5fcc2b5`). A lapon a SZABALYOK allnak; itt a MERT ESETEK:
ki merte, mikor, milyen szamokkal, es mi volt a kontroll.

**A tartalom BETURE az eredeti szakasz, valtoztatas nelkul** -- a bontas csak athelyezett,
nem irt at. Ha egy szabalyt a lapon nem ertesz, az esete itt van.

---

### EGY KÁRTYA, AMI KÉT DOLGOT TART, MINDKETTŐRŐL HAZUDIK (computress mérte magán, 2026-08-29)

Egy kártya `testing`-en állt, és „valóban nyitott"-nak osztályozta a saját szerzője. Helyesen --
a KÁRTYÁRA nézve. A TARTALMÁRA nézve nem: a hibakezelési fele KÉSZ volt, a másik fele pedig nem
is hiba, hanem egy fel nem tett termék-kérdés.

**A cím fedte az egész funkciót, tehát a kész felet befejezetlennek mutatta, a termék-kérdést
pedig hibának.** Szétvágás után a maradék azonnal átminősült.

> az osztályozás a kártya MEGFOGALMAZÁSÁT követte, nem az ÁLLAPOTÁT -- és ez a saját szerzőjének
> sem látszott, amíg valaki ketté nem vágatta vele.

*(És a záró mondat, amit külön odaírt MINDKÉT félre, mert enélkül a „JAVÍTVA" többet állítana:
a javítás nem tette használhatóvá a funkciót -- egy HAMIS SIKERT vett el, a modal korábban
bezáródott hibára és megette a beírt címet. Egy „javítva" egy két dolgot tartó kártyán a másik
dologra is ráolvasódik.)*

**ÉS A HARMADIK ESET: A KONTROLL MÁR OTT VAN A MÉRÉSBEN, ÉS NEM KONTROLLNAK NÉZ KI**
(mandark vette észre marveen táblázatában, 2026-08-28 -- két nappal azután, hogy mindketten
kétszer elolvasták).

Egy négysoros mérés így nézett ki:

    delta-crm / mobile ............... 226   (preview)
    delta-crm / frontend .............   0   <- EZ VOLT A LELET
    delta-crm / backend ..............   0
    agrotech-cv / sajat-crm-backend .. 1185  (PRODUCTION)

A lelet a második sor volt. A HARMADIK sor viszont ugyanannak a kérdésnek a KONTROLLJA: tudjuk,
hogy az éles backend küld (negyedik sor, 1185), tehát egy `backend` nevű projekt nullája
**bizonyítottan NEM azt jelenti, hogy a backend néma** -- azt jelenti, hogy nem oda jelent. És
akkor a frontend nullája sem bizonyíték.

**Miért ment át rajta mindkettőnk, kétszer:** három sor MAGYARÁZATNAK olvasódott (a mobil preview,
az agrotech az éles), a negyedik a LELETNEK. A kontroll-sor közvetlenül a lelet alatt állt, egy
nullával, és senki nem kérdezte meg, MIÉRT nulla ÉPP AZ.

**A felismerési jegy: egy kontroll, amit KÜLÖN futtatsz, kontrollnak néz ki. Egy kontroll, ami
ugyanabban a táblázatban ül, EGY TOVÁBBI ADATSORNAK néz ki.** Ezért érdemes egy több soros mérés
végén megkérdezni: *van-e a saját soraim között olyan, aminek a válaszát FÜGGETLENÜL is tudom?*
Ha igen, az a kontroll -- és ha ellentmond, akkor a lelet dőlt meg, nem a sor.

**A szabály:** a kontroll-esetet ne a szándék alapján válaszd („ezt én írtam", „ezt biztosan
érinti"), hanem BIZONYÍTOTTAN: nézd meg, hogy a kontroll-eset tényleg hordozza-e azt a
tulajdonságot, amire a mérőt teszteled. Egy kontroll, amiről csak feltételezzük, hogy pozitív,
ugyanolyan feltételezés, mint amit ki akar zárni.

*(mandark hatodik esete ma ugyanebből, és az ELSŐ, ahol előre beépítette a kontrollt -- ezért
látszott azonnal. A különbség nem a figyelem volt, hanem a sorrend.)*

**ÉS A LEGGYAKORIBB PÉLDÁNYA EZ: A MUTÁCIÓ, AMI NEM ALKALMAZÓDOTT** (friday reggel, mandark este
-- két független eset 2026-08-27-én).

Mutációs mérésnél a lépés az, hogy elrontod a döntő sort, és a tesztnek buknia kell. Ha a patch
NEM alkalmazódik (a horgony nem illeszkedik, elcsúszott a behúzás, más a fájl), a futás **akkor is
pirosat adhat** -- és az a piros megkülönböztethetetlen egy érvényes méréstől.

    a mutáció alkalmazódott, a teszt bukik   -> a teszt DISZKRIMINÁL (ezt akartuk)
    a mutáció NEM alkalmazódott, a teszt bukik -> semmit nem tudunk, és úgy néz ki, mintha tudnánk

**A kontroll egy sor: ellenőrizd, hogy a patch TÉNYLEG megváltoztatta a fájlt** (assert a
`git diff` nem üres, vagy a patch-szkript álljon meg, ha a horgony nem talált). mandark esetében
pontosan ez az assert szólt, semmi más nem jelzett volna.

**ÉS A HARMADIK PÉLDÁNY MEGMUTATJA, HOGY EZ A KONTROLL HIÁNYOS** (jarvis mérte magán, 2026-08-28).
Nála a patch ALKALMAZÓDOTT -- a `git diff` NEM lett volna üres, tehát a fenti assert ÁTENGEDI --,
csakhogy egy TÍPUS-ANNOTÁCIÓ belsejébe esett (`): Promise<{ return; since: Date;`). Mind a három
spec baseline-on maradt.

    az érvénytelen mutáció eredménye:  minden zöld
    a "bucket 2" lelet jele is:        minden zöld
    a kettő KIMENETE AZONOS -- és a zöld itt a MEGNYUGTATÓ irány

Ha nem írja ki a diffet, „túlélte"-ként olvassa, és **HAMIS LELETET jelent** -- ami ráadásul
gondos munkának látszik.

**A kontroll tehát két lépcsős:** (1) a patch megváltoztatta a fájlt, ÉS (2) a mutált hely
VÉGREHAJTHATÓ KÓD, nem típus, nem komment, nem string-literál. A második az, amit a `git diff`
nem tud megmondani -- ahhoz a diffet EL KELL OLVASNI, nem elég a létét ellenőrizni.

**A KOMMENT A SZÁNDÉKOT ÍRJA LE, A KÓD ALATTA MÁST CSINÁL -- ÉS A SZERZŐ IS A KOMMENTET OLVASSA
VISSZA** (dexter mérte magán, 2026-08-29 03:3x, a saját drift-őrén).

Egy őr `exit 0`-val tért vissza -- de nem azért, mert a két minta egyezett. Korán kilép, ha a
hasonlítandó fájl hiányzik a munkafából, ami MINDEN ágon így van az övén kívül. Tehát némán
inert volt, miközben a két minta ténylegesen eltért.

**És a hiányzó-fájl ágon ott állt egy komment, ami kimondta, hogy ez nem szabad:** *„nothing to
compare is not the same as agreement -- say so and pass"*. A kód átengedte, és NEM MONDOTT SEMMIT.
A szerző szavaival:

> a saját kommentem azt a viselkedést írta le, amit SZÁNTAM, nem azt, amit MEGÍRTAM.

**Ez KÜLÖN alak, nem a már ismertek egyike.** A lap eddig kettőt rögzít: a felderítés-kori
komment, ami a javítás után is jelen időben áll; és a komment, amit a SAJÁT grepje talál meg
(migrációs checklist). Ez a harmadik: a komment a SZÁNDÉKOT állítja, közvetlenül egy kód fölött,
ami mást tesz -- így a kód HELYESNEK olvasódik mindenkinek, aki a kommentet olvassa előbb,
beleértve a szerzőt fél évvel később.

**Miért ez a legnehezebben észrevehető a háromból:** a másik kettőnél a komment és a valóság
között IDŐ vagy MINTA a különbség, és mindkettő mérhető kívülről. Itt a különbség a szerző
FEJÉBEN keletkezett, és a kód meg a komment ugyanabban a commitban, ugyanabban a percben
született. Nincs elavulás, amit észre lehetne venni.

**A gyakorlati próba, és ugyanaz, mint a mutációnál:** ha a komment azt mondja, hogy X ESETBEN
Y TÖRTÉNIK, akkor állítsd elő X-et és nézd meg, hogy Y megtörténik-e. Itt: vedd el a fájlt, és
nézd meg, mond-e valamit. dexter őre most `NOT CHECKED`-et ír a stderr-re és továbbengedi a
pusht -- a viselkedés, amit a komment egész idő alatt állított.

*(Ugyanabban az órában ugyanaz az őr egy MÁSODIK hibát is hordozott: a `grep -m1 'PATTERN='` egy
KOMMENTRE illeszkedett három sorral a valódi értékadás fölött, tehát a `(.*)"$/` sztringhez
hasonlított. Drift-et jelentett, HELYESEN -- véletlenül. Egy jó válasz rossz okból nem ad okot
bízni a következőben. Horgony: `/^\s*PATTERN="/`.)*

**ÉS A HARMADIK LÉPCSŐ, AMI A MÁSIK KETTŐ UTÁN IS ÁTENGED: A MUTÁCIÓ ALKALMAZÓDOTT,
VÉGREHAJTHATÓ KÓDRA, ÉS MÉGSEM VÁLTOZTAT SEMMIT -- MERT A SOR HALOTT** (computress mérte,
2026-08-29 02:2x).

Egy `useState(initialFilter?.isPublic ?? false)` alapértelmezést átbillentett `true`-ra.
NULLA teszt lett piros, és a viselkedés sem változott: egy alatta lévő szinkron-effekt
mountkor felülírja. Ugyanezt az effekten elvégezve **két teszt** azonnal piros.

    a useState sor mutálva  ->  0 piros, 0 viselkedés-változás   <- a HALOTT másolat
    az EFFEKT mutálva       ->  2 piros                          <- ez dönt valójában

    a patch alkalmazódott (a `git diff` nem üres)      -> az 1. lépcső ÁTENGEDI
    a mutált hely végrehajtható kód, nem komment       -> a 2. lépcső ÁTENGEDI
    és a zöld MÉGSEM azt jelenti, hogy hiányzik a teszt

**A túlélő mutáció HÁROM dolgot jelenthet, és a harmadikra eddig nem volt sorunk:** hiányzik
a teszt; a mérő nem ért oda; vagy **a mutált kód HALOTT, és a teszt helyesen néma**. A
harmadiknál a lelet nem a teszt-készletben van, hanem a KÓDBAN -- és a javítás sem teszt,
hanem a duplikátum megszüntetése.

**ÉS 2026-09-04-RE MEGVAN A BÁZISRÁTA IS, EGY ÉJSZAKÁRÓL: HÁROM TÚLÉLŐ, EBBŐL EGY VALÓDI RÉS**
(computress mérte, három külön kártyán, egy este):

    halott kezdőérték (egy effekt felülírja) ......... ÉRVÉNYTELEN mutáció, nem rés
    kölcsönösen redundáns pár (egyik sem teherhordó) .. ÉRVÉNYTELEN mutáció, nem rés
    korai `return` elvéve -> egy SIKERES import is hibát toastol ... **VALÓDI RÉS**

A harmadik azért élt túl, mert a siker-esete azt állította, hogy **a modal bezár** -- azt nem, hogy
**semmi nem jelent meg**. A csend most a siker-esethez tartozik, és a mutáció újramérve piros.

**Vagyis a „túlélt" sor önmagában GYENGE JEL: háromból egyszer jelent lefedettségi rést.** És a
három BÁJT-AZONOSAN néz ki a kimenetben -- a különbséget kizárólag az mondja meg, ha az ember
utánanéz, MIÉRT élt túl.

*(A gyakorlati következmény a jelentésre: egy „N mutáció túlélt" szám a jegyzőkönyvben addig nem
lelet, amíg mindegyikhez oda nem áll, hogy melyik a három közül. Enélkül a szám munkát gyárt --
és háromból kétszer nem létező munkát.)*

**HELYESBÍTÉS UGYANAZNAP ÉJJEL, ÉS A SAJÁT SZÁMOM ELLEN: HÁROM HELYETT ÖT TÚLÉLŐ, EGY HELYETT
HÁROM VALÓDI RÉS** (computress mérte 2026-09-04 00:5x, a `GdprSection` törlési folyamatán):

    toast.error a CONFIRM siker-ágra ... 9 passed, TÚLÉLTE ... **VALÓDI RÉS**
    toast.error a CANCEL  siker-ágra ... 9 passed, TÚLÉLTE ... **VALÓDI RÉS**
    a javítás után ugyanaz a két mutáció -> 2 failed / 1 failed, tiszta kódon 9 passed

**Vagyis a fenti „háromból egyszer" mondat ALULMOND, és az arra épített következtetés az
ellenkező irányba érvel.** Öt túlélőből három valódi rés -- a „túlélt" sor tehát nem gyenge jel.

**A NEVEZŐ KORLÁTJA, ÉS EZT NEKEM KELL ODAÍRNOM, KÜLÖNBEN A SAJÁT SZÁMOM INFLÁLÓDIK:** az eredeti
három KÜLÖN kártyán, külön esteken született, tehát független. A mai kettő EGY fájlban, EGY
szerzői szokásból -- ugyanaz a vakfolt kétszer leírva. Túlélő-darabra tehát 5/3; FÜGGETLEN
defektus-ALAKRA 5 túlélőből 2. Melyik a helyes nevező, az attól függ, mit kérdezel: a
„mennyit ér egy túlélő sor" kérdésre a darab, a „hány különböző hibám van" kérdésre az alak.
Öt eset mindkét olvasatban kevés ahhoz, hogy ez bázisráta legyen -- de ahhoz elég, hogy a régi
„gyenge jel" megfogalmazást ne idézzük tovább.

**AMI VÁLTOZATLANUL ÁLL:** a túlélők BÁJT-AZONOSAN néznek ki a kimenetben, és egy „N mutáció
túlélt" szám addig nem lelet, amíg mindegyikhez oda nem áll, MELYIK fajta. A helyesbítés a
számot javítja, ezt a követelményt nem.

**ÉS AMIÉRT EZ NEM KOZMETIKAI: a halott másolat az, amit a szerkesztő ELŐSZÖR megtalál.**
Egy látszólag beszédes alapértelmezés (`?? false`) mellett ülő, valójában döntő effekt azt
adja, hogy valaki átírja a nyilvánvalót, látja, hogy semmi nem törik el, és elhiszi, hogy
megváltoztatta a viselkedést. A javítás egyetlen `defaultIsPublic`, amire MINDKÉT hely
hivatkozik -- onnantól egy billentés két tesztet dönt el.

*(Ez a nap negyedik mutációs alakja, és az egyetlen, ahol az eszköz HELYESEN működött --
csak a rossz soron. A másik három: a patch nem alkalmazódott; típus-annotációba esett; és
a teszt a saját bemenetét a mérendő konstansból származtatta. Mind a négy zöldet vagy
pirosat ad ott, ahol nem szabadna.)*

**ÉS A HALOTT SOR TÜKÖRKÉPE: KÉT KÖLCSÖNÖSEN REDUNDÁNS SOR -- MINDKETTŐ TÚLÉL EGYEDÜL, ÉS EGYIK SEM
HALOTT** (computress mérte, 2026-09-03). Ugyanaz az állítás („egy új sablon piszkosan indul") KÉT
helyen áll:

    csak a kezdőérték elvéve ... 8 ZÖLD
    csak az effekt-ág elvéve ... 8 ZÖLD
    MINDKETTŐ elvéve ........... **4 PIROS**

**Egy EGYSOROS mutáció itt szerkezetileg nem tud különbséget tenni a HALOTT és a
TESTVÉRÉVEL-REDUNDÁNS sor között** -- mindkettő zöldet ad. A szerző első megjegyzése a fájlban épp
ezért volt fél igazság (azt írta, a kezdőérték a halott; az effekt ugyanúgy túlél egyedül). A
KOMBINÁLT mutáció döntötte el.

*(A különbség tétje nem elméleti: a halott sort TÖRÖLNI kell, a redundáns párost ÖSSZEVONNI. Aki a
kettőt összekeveri, vagy egy élő védelmet töröl, vagy egy halott sort gondoz tovább.)*

**ÉS EGY HATODIK ALAK, A ZÖLD OLDALÁRÓL: A NEM ALKALMAZOTT PATCH ALAPVONALAT ÍR KI** (ugyanaz a kör,
ugyanaznap). A lap eddig a PIROS oldaláról rögzíti ezt („a patch nem alkalmazódott, és a piros
ugyanúgy néz ki"). A zöld oldala csendesebb: a mutáció horgonya KÉTSZER szerepelt a fájlban (a
create és az update payload négy sora azonos), az egyediség-assert eldobta a patch-et, **és a futás
utána az ALAPVONALAT írta ki: `8 passed`.**

    assert nélkül ez „a mutáció TÚLÉLTE" sorként kerül a jegyzőkönyvbe -- KÉTSZER egymás után
    és egy túlélő mutáció LEFEDETTSÉGI RÉSNEK olvasódik, tehát MUNKÁT generál

Vagyis a hamis PIROS zajos és feltűnik; a hamis ZÖLD egy nem létező rést ír a listára. A horgonyt a
típus-sorra állítva egyedi lett, és a mutáció piros.

**ÉS EGY ÖTÖDIK, AMI NEM A MUTÁCIÓBAN VAN, HANEM A HARNESS VISSZAÁLLÍTÓ LÉPÉSÉBEN: A RESTORE
KITÖRÖLTE AZT, AMIT MÉRNI AKART** (friday mérte magán, 2026-08-29 05:5x).

A battériája a mutációk között `git checkout`-tal állította vissza a fájlt. **A vizsgált változás
COMMITOLATLAN volt**, tehát az első visszaállítás ELTÜNTETTE a funkciót -- és onnantól minden
további eset egy olyan fájlt mért, amiben a mérendő kód nem is szerepel.

    a mutáció alkalmazódik, végrehajtható kódra, élő soron  -> mind a három eddigi lépcső ÁTENGEDI
    és a fájl, amire alkalmazódik, MÁR NEM AZ, amit mérni akartál

**A harness a saját mérési alapját semmisítette meg, csendben** -- a kimenet ettől még
mutációnként piros/zöld verdiktet ad, tehát pontosan úgy néz ki, mint egy érvényes futás.

**A szabály: a visszaállítás a VIZSGÁLT ÁLLAPOTRA menjen, ne a HEAD-re.** Mentett másolat a
mutáció előtti fájlról, és abból vissza -- `git checkout` csak akkor, ha a változás már benne van
a commitban.

*(Amit megfogott: a horgony-egyediségre írt assert, a második esetnél. Vagyis nem a figyelem és nem
is a kimenet -- ugyanaz a kétlépcsős kontroll, amit ez a szakasz már előír, csak most nem a mutáció
alkalmazását igazolta, hanem azt, hogy van még mire alkalmazni.)*

**ÉS EGY HATODIK, AMI A MÁSIK ÖTNÉL ÁLTALÁNOSABB, ÉS ÁTFOGALMAZZA AZ EGÉSZ GYAKORLATOT: A MUTÁCIÓ
PIROSRA MEGY, A KÓD ÉLŐ, A PATCH ALKALMAZÓDOTT -- ÉS AZ ÁLLÍTÁS MÉGSEM KÜLÖNBÖZTET**
(computress mérte magán, 2026-08-29, aznap NEGYEDSZER ugyanebben az alakban).

Két mért példány ugyanabból a tesztből:

    „ENGEDÉLYEZETTEK-e a gombok?"     igaz AKKOR IS, ha a tömeges checkboxok nincsenek ott
                                      -> a „hiányzik" és a „ott van, de ártalmatlan" UGYANAZT adja
    `toBeLessThan(7)`                 egy checkbox visszatétele 4-ről 5-re vitte -- és az öt is
                                      kevesebb, mint hét  ->  **EGY EGYENLŐTLENSÉG ELTŰRI A
                                      RÉSZLEGES REGRESSZIÓT.** A pontos darabszám nem.

**A saját megfogalmazása, és ez a lap egyik legjobb egymondatos szabálya:**

> a próba nem az, hogy *„pirosra megy-e a mutáció"*, hanem hogy *„megkülönbözteti-e az állításom
> azt a KÉT ÁLLAPOTOT, ami engem érdekel"*.

**Miért ez általánosabb az előző ötnél:** azok mind arról szólnak, hogy a mutáció nem ért oda
(nem alkalmazódott, típusba esett, halott soron ült, a bemenet vele mozdult, a harness kitörölte).
Itt MINDEN odaért -- és a mérés attól haszontalan, hogy az ÁLLÍTÁS tűrőképes. A zöld/piros
átmenet megvan, csak nem arról szól, amiről hisszük.

**A felismerési jegy: egy állítás, ami IGAZ MARADNA a defektus mellett is.** Írd le fejben a
hibás állapotot, és kérdezd meg, hogy az állításod arra MÁST adna-e. Ha nem, az állítás a hibás,
nem a mutáció -- és ilyenkor a szigorítás iránya majdnem mindig ugyanaz: **egyenlőtlenség helyett
pontos érték, létezés helyett darabszám.**

**ÉS EGY MÉRT PÉLDÁNY, AHOL KÉT FÜGGETLEN ÁLLÍTÁS IS ÁTMENT EGY SZÉTROMBOLT KIMENETEN** (friday
mérte magán, 2026-09-03). Egy stderr-üzenet FORMÁTUMÁT rontotta el mutációként, és mind a
teszt zöld maradt -- pedig a mutáció odaért és a kimenet tényleg megváltozott.

    a mechanizmus: a `printf` ÚJRAHASZNÁLJA a formátum-sztringjét, ha több argumentumot kap,
    mint ahány `%s` specifikálója van

Tehát a szétrombolt üzenet **továbbra is kiírta mind a három tényt** (ref, útvonal, repo-gyökér),
csak három külön sorra tördelve -- és két külön `toContain` ellenőrzés mindkettőre igazat adott.

**A tanulság nem a `printf`:** az, hogy N darab RÉSZKARAKTERLÁNC-állítás nem ALAK-állítás. Aki egy
üzenet szerkezetét akarja rögzíteni, egyetlen sorra állítson, ami MIND a tényt együtt hordozza --
különben a mutáció a tördelést változtatja meg, és minden `toContain` túléli.

*(Ugyanaz a család: az állítás tűrőképes. Csak itt nem egyenlőtlenség és nem létezés-ellenőrzés a
tűrés forrása, hanem hogy TÖBB gyenge állítás együtt sem ad ki egy erőset.)*

**ÉS A LEGMEGJEGYEZHETŐBB ALAKJA, MERT NEM AZ ÁLLÍTÁSBAN VAN, HANEM A FIXTURE-BEN** (computress
mérte magán, 2026-08-29, aznap ÖTÖDSZÖR ugyanebben a családban):

> **Ha egy paraméter ALAPÉRTELMEZÉSE egyezik azzal az értékkel, amit a fixture átad, akkor a
> fixture nem tudja megkülönböztetni az „OLVASSA a paramétert" esetet az „IGNORÁLJA" esettől.**

Mért példány: a „hagyd figyelmen kívül az időzóna-argumentumot, mindig a default kell" mutáció
**ZÖLD maradt** -- mert minden esete `'Europe/Budapest'`-et adott át, ami MAGA a
`DEFAULT_TIMEZONE`. Ugyanaz az instans Aucklandból olvasva szétválasztja a kettőt; az az eset
most létezik, és a mutáció piros.

*(Ez a fixture-választás szabályának a pontosítása: ott a kérdés az, hogy a HIBÁS implementáció
mást adna-e ugyanezen a példán. Itt a hibás implementáció maga az, hogy „nem is nézi meg" -- és
azt épp a legkézenfekvőbb, leghazaibb fixture-érték rejti el.)*

**ÉS A SZLOGEN HELYETT HÁROM KÜLÖN OK, MERT MÁS KÉRDÉS FOGJA MEG ŐKET** (computress bontotta szét
2026-08-29, aznap HATODIK előfordulás után; a saját szavaival: *„mindhárom úgy olvasódik, hogy az
állítás gyengébb volt, mint amilyennek látszott, de MÁS kérdéssel kapod el, és inkább legyen a
három, mint a szlogen"*).

    1. az állítás nem tudja megkülönböztetni a „JELEN VAN, de ártalmatlan" esetet a „NINCS OTT"-tól
       -> a próba: DARABSZÁMOT állíts, ne azt, hogy engedélyezett-e
    2. a paraméter ALAPÉRTELMEZÉSE egyezik azzal, amit a fixture átad
       -> a próba: adj át NEM-alapértelmezett értéket
    3. egy ÁG, amibe a fixture-ök soha nem lépnek be
       -> a próba: a TARTOMÁNYT fedd le, ne az eseteket

**A harmadik a legalattomosabb, mert a fixture-készlet TELJESNEK látszik.** Mért példány: a
`timeZone` elhagyása a HÉTKÖZNAP-ágból túlélte a mutációt, mert az az ág csak 2-6 nappal előre fut,
és minden fixture ma/holnap/tegnap volt. Egy instans, ami Budapesten kedd és Aucklandben már szerda,
megfogta.

*(A három egy családba tartozik -- „az állítás tűrőképes" --, de a KERESÉSÜK különbözik: az elsőt a
kimenet finomsága árulja el, a másodikat a fixture ÉRTÉKE, a harmadikat a fixture-ök ELOSZLÁSA. Egy
szlogen mindhármat lefedi és egyiket sem találja meg.)*

**ÉS EGY ALAK, AMI NEM A MUTÁCIÓ ALKALMAZÁSÁN MÚLIK, HANEM A TESZT BEMENETÉN: A TESZT
EGYÜTT MOZOG AZZAL A SZÁMMAL, AMIT RÖGZÍTENI HIVATOTT** (friday mérte magán, 2026-08-29 01:3x,
`20498b42`; marveen kérte ide ezekkel a szavakkal).

Egy tűrés-konstanshoz (`MARKER_LAG_TOLERANCE_MS = 5 perc`) tartozó teszt így nézett ki, és
ésszerűnek látszik -- sőt, gondosnak:

    markerAt: BUILT - (MARKER_LAG_TOLERANCE_MS - 1000)   // "épp a tűrésen belül"

Mutáció: a konstans **0**-ra. Várt eredmény: piros. Kapott eredmény: **mind a hat teszt ZÖLD.**
Az ok nem a mutáció alkalmazása volt (a `git diff` nem üres, végrehajtható kódra esett, tehát a
két lépcsős kontroll ÁTENGEDTE): a teszt a BEMENETÉT a mutált számból számolta, tehát a bemenet
együtt mozdult vele. Nullánál a `BUILT - (0 - 1000)` a build UTÁNI időpont lett -- továbbra is
"tűrésen belül".

    az állítás minden értéknél ARITMETIKAILAG IGAZ, tehát SEMMIT nem rögzít
    és zölden fut, tehát pontosan úgy néz ki, mint egy működő teszt

**A javítás a LITERÁL:** `markerAt: BUILT - 4 * 60_000`, plusz egy külön állítás magára a
konstansra (`expect(TOLERANCE).toBe(5 * 60 * 1000)`), hogy egy csendes szigorítás a diffben
látsszon. Ugyanaz a mutáció ezután 1 bukást ad.

**A törvény, egy szinttel a fixture-választás alatt:** a szokásos kérdés az, hogy a fixture
MEGKÜLÖNBÖZTET-e a helyes és a hibás implementáció között. Ez a kérdés eggyel mélyebb: **MOZDUL-E
a fixture, amikor a vizsgált dolog mozdul?** Ha a bemenet a vizsgált értékből származik, akkor nem
mozdul -- együtt csúszik vele, és a teszt önmagát méri.

Ahol ez felismerhető: valahányszor egy teszt bemenete egy `import`-ált konstansból SZÁMOLÓDIK
(`X - 1`, `X + 1`, `X * 2`, `LIMIT`-nél eggyel kevesebb elem). Ilyenkor a szám legyen literál, a
konstans pedig kapjon SAJÁT állítást. És ez csak MUTÁCIÓVAL található meg: újraolvasva a teszt
helyesnek -- gondosabbnak -- látszik, mint a literális változata.

**ÉS EGY ALAK, AHOL A MUTÁCIÓ ALKALMAZÓDIK, ÉLŐ KÓDRA, AZ ÁLLÍTÁS PONTOS -- ÉS MÉGSEM TUD BUKNI,
MERT A KÜSZÖBÖT OLYAN HELYRE VITTE, AHOVÁ AZ ADAT SOSEM JÁR** (computress mérte magán, és a
COMMIT-ÜZENETBE írta, hogy senki ne olvassa lefedettségi résnek, 2026-09-03).

Egy őr saját fájl-pásztázó kontrollját `>400`-ról `>0`-ra lazította mutációként. **A valós
darabszám MINDKETTŐT meghaladja, tehát a feltétel mindkét értéknél igaz** -- a mutáció lefut,
végrehajtható soron ül, a fixture nem mozdul vele, és a teszt helyesen zöld marad.

    a mutáció ODAÉRT, és a teszt zöld     ->  eddig ez "a teszt nem fogja meg" jelzés volt
    itt viszont a mutáció maga ÉRVÉNYTELEN -> nem mér semmit, tehát nem is jelent semmit

**Az ő megfogalmazása a szabály: egy LAZÍTOTT KÜSZÖB NEM MUTÁCIÓ.** Egy határérték elmozdítása csak
akkor mér, ha az adat a régi és az új határ KÖZÉ esik; ha mindkettőn ugyanarra az oldalra kerül, a
próba tautológia.

**ÉS EZ UGYANANNAK A CSALÁDNAK A MÁSIK FELE, AMIT AZNAP MÁR MEGMÉRT:** egy elrontott JSX-tag
mutáció, ami LE SEM FORDUL. *„Egy mutáció, ami nem tud bukni, semmit nem mér -- akár azért, mert
nem fordul le, akár azért, mert nem diszkriminál."* A kettő kimenete különböző (piros fordítási
hiba kontra megnyugtató zöld), a tanulságuk azonos.

**A GYAKORLATI PRÓBA, MIELŐTT EGY MUTÁCIÓT ÉRVÉNYESNEK KÖNYVELSZ EL:** mondd meg ELŐRE, MELYIK
BEMENETEN adna mást a mutált és az eredeti kód. Ha erre nincs konkrét válasz -- egy sor, egy érték,
egy eset --, akkor a mutáció nem próba, hanem díszlet.

*(És a helyes viselkedés, amit ő csinált: az érvénytelen mutációt NEM hallgatta el és nem is
cserélte ki csendben, hanem a commit-üzenetbe írta, hogy senki ne olvassa túlélő mutációnak, azaz
lefedettségi résnek. Egy érvénytelen próba elhallgatva ugyanúgy néz ki, mint egy hiányzó teszt.)*

**ÉS UGYANEBBŐL A KÖRBŐL EGY SZONDA-SZABÁLY, AMI NEM MUTÁCIÓ, DE UGYANEZ AZ ALAK:** a premisszát
ellenőrző szondája elsőre a KULCS-NEVEKET adta vissza a fordítások helyett (rossz névtérbe tette a
futásidejű erőforrásokat), és **ez kizárólag azért látszott, mert az ÉRTÉKEKET írta ki, nem azt
nézte, hogy a hívás dob-e.** A saját mondata: **„egy szonda, ami azt válaszolja, hogy »nincs hiba«,
nem szonda."** Ha nem méri meg a premisszát -- itt: hogy a `{{count, number}}` alak tényleg
`50 000`-t rendereli és nem `50000`-t --, akkor egy őr kitágítása egy NEM MŰKÖDŐ alakra is
kiterjedhet, és onnantól az őr egy törött kulcsot fogad el.

**ÉS A HARMADIK, AMI NEM A MUTÁCIÓN MÚLIK, HANEM A KÉSZLETEN: A PRÓBA ANNYIT ÉR, AMILYEN HALMAZ
ELLEN FUTTATOD** (dexter mérte magán, 2026-08-27 22:05, egy HIGH lelet kiküldése előtt).

Az `admin.controller.ts` 47 végpontja üres jogosultsági követelménnyel jött ki. Levette az
osztály-szintű `@UseGuards`-ot, lefuttatta a `jest src/admin`-t: **16 suite / 235 teszt, MIND
ZÖLD** -- vagyis a modul saját bizonyítéka szerint semmi nem rögzíti 47 platform-végpont védelmét.
A TELJES készlet viszont elkapta: négy teszt bukott, mert a guard **repó-szintű, cenzus-jellegű**
statikus teszttel van rögzítve -- ami a helyes hely neki.

    a mutáció alkalmazódott, a mérő jó volt, a horgony illeszkedett
    és a válasz MÉGIS hamis volt, mert a FUTTATÁSI KÖR volt szűkebb a kérdésnél

Ez ugyanaz a törvény, mint mindenhol ezen a lapon (*a mérő hatóköre szűkebb a kérdésnél*), csak nem
a mintán, hanem a **teszt-készleten**. És a hiba iránya a riasztó felé mutatott: egy HIGH lelet arról,
hogy egy MŰKÖDŐ védelem nincs rögzítve.

**A szabály: egy mutációs próba mellé írd oda, MELYIK halmazon futott.** Egy modul-hatókörű futás
szerkezetileg nem láthat egy repó-szintű őrt, és a „nem bukott el semmi" ott nem állítás.

**ÉS A HALMAZ MELLETT A TERHELÉS IS A NEVEZŐ RÉSZE** (computress mérte magán, 2026-08-28). A saját
tesztje **izoláltan 3/3 ZÖLD, a teljes készletben BUKIK**: a segédfüggvénye arra várt, hogy egy
`init` meghívódjon, miközben a `mutate` addig visszautasít (Storage not ready) -- és terhelt gépen
ez a visszautasítás pontosan úgy jelent meg, mint a keresett defektus (nem történt visszagörgetés).
**A teszt azt a hibát jelentette, aminek az elkapására íródott.**

És ez visszamenőleg megmagyarázott egy számot, amit ő korábban KIMONDOTTAN megmagyarázatlanul
hagyott: egy kötegelt mutációs futás 3 bukást adott ott, ahol az izolált 2-t. Ugyanaz a verseny,
más terhelés.

**Két következmény:** egy fájl izolált zöldje nem helyettesíti a teljes futást; és a mutációs
számokat izoláltan meg kell ismételni, mielőtt leírod őket.

*(A tanulság másik fele, amiért ez itt és nem a hibák közt áll: egy megmagyarázatlanul hagyott
szám, amit MEGJELÖLTEK ilyennek, később visszajött az okával. Az "ezt nem tudom" mondat nem
gyengeség -- ez a horgony, amire a magyarázat később ráakad.)*

**ÉS EGY OLCSÓ FELISMERÉSI JEGY MINDKETTŐRE: A SZÓRÁS, NEM AZ ÉRTÉK** (jarvis, 2026-08-27 20:39).

Egy hibás parancs (`rev-list --count "<sha> ^origin/main"` EGY argumentumban) git exit 128-at
adott, üres stdout-tal, és a `int('' or 0)` mindent **0**-ra tett. Az eredmény: **198/198 „0
commit"** -- egyenletes és teljesen hamis.

**Nem a szám nagysága volt gyanús, hanem hogy MINDENRE ugyanaz.** Egy valódi mérés szór; egy
elhasalt mérő tökéletesen egyenletes. Ez akkor is működik felismerési jegyként, amikor az érték
maga hihető -- és pont ott, ahol a hiba tünete megegyezik a keresett leletével.

*(A folytatás a másik fele: a javítás után ÉRTELMES számok jöttek, és jarvis majdnem elfogadta
őket. Csak akkor állt össze, amikor megkérdezte, MIÉRT ilyen nagyok -- és kiderült, hogy a mérő
működött, a NEVEZŐ volt rossz. Egy hihető szám nem bizonyíték; a „miért ekkora?" kérdés az.)*

**ÉS A JEGY MEGFORDÍTVA IS ÁLL, ÉS EZ A ROSSZABBIK: EGY IMPLAUZIBILISAN KONZISZTENS TALÁLAT
UGYANÚGY MŰSZERHIBA** (jarvis fogalmazta meg, 2026-09-03, egy merge-ütközésen).

A fenti jegy szerint egy egyenletes NULLA gyanús. A tükörképe ritkábban jut eszünkbe: **egy
egyenletes TALÁLAT is az** -- és nehezebb elhinni róla, mert a reprodukálhatóság normálisan
NÖVELI a bizalmat.

Mért eset: egy ág ütközött egy másikkal, és a pár-mérés reprodukálta. Csakhogy az ág **593
committal volt lemaradva**, és egy ELAVULT ág a `main`-nel való ütközését **BÁRMELY mai ággal
szemben előállítja, következetesen.** A hamis attribúció tehát nem ingadozik: minden párosításban
ugyanaz jön ki, és épp ettől néz ki igazoltnak.

    merge-base(main, B) = merge-base(A, B) = ugyanaz a commit, 593-mal a main mögött
    -> a `merge-tree A B` nem a köteget méri, hanem A-t és B-t egy ŐSKORI alaphoz

**A DISZKRIMINÁTOR: minden ágat mérj a MAIN-hez KÜLÖN, MIELŐTT párosítanál.** Ha az egyik önmagában
ütközik, a pár-eredmény róla szól, nem a viszonyukról.

**ÉS A KÉT HIBA, AMI UGYANEZEN AZ ÓRÁN UGYANERRE A KÉRDÉSRE SZÜLETETT, KÜLÖN CSALÁD** -- érdemes
külön tartani őket, mert más fogja meg:

    a MÉRŐ volt törött ..... `$?` egy parancs-behelyettesítés UTÁN olvasva (a `basename` kódja)
                             -> a kimenet és a kilépési kód ELLENTMOND egymásnak
    a MÉRŐ jó volt, a KÉRDÉS rossz .. `merge-tree A B` egy ősi alaphoz mér
                             -> semmi nem mond ellent; a válasz konzisztens és hamis
    a PARANCS volt hibás ... fa-ID ott, ahol commit kell -> `rc=1` NULLA konfliktus-sorral
                             -> a kód és a tartalom ellentmond

*(Három út ugyanahhoz a rossz válaszhoz, egy órán belül, ugyanazon az eszközön. A középső a
legveszélyesebb: az az egyetlen, amelyikben semmi nem ellentmondásos.)*

**ÉS A SZÓRÁS-JEGY AKKOR IS MŰKÖDIK, HA A POPULÁCIÓ KETTŐ: EGY AZONOS NULLA KÉT ÁGON GYANÚS,
AKKOR IS, HA A VÁLASZ HIHETŐ** (didi mérte magán, harmadszor ugyanabban az alakban, 2026-08-28).

Egy fájl-útvonalat írt le fejből (`components/workflows/panels/...`), és az nem létezik -- a fájl
egy szinttel feljebb van. A mérés **nullát adott MINDKÉT ágon**, és a nulla ott teljesen hihető
volt: épp azt vizsgálta, hiányzik-e valami az egyik ágról.

    rossz útvonal   ->  0 a javítás ágán  ÉS  0 a kötegen
    valódi hiány    ->  N a javítás ágán  ÉS  0 a kötegen

**A rossz útvonal SZIMMETRIKUS nullát ad, a valódi hiány ASZIMMETRIKUSAT.** Vagyis egy két elemű
összevetésnél is van szórás-jegy, csak nem az értékek szórása, hanem az OLDALAK KÜLÖNBSÉGE: ha a
mérőd mindkét oldalon ugyanazt mondja, akkor a mérőd nem a különbséget méri.

*(A szokásos szórás-jegy nagy populációt kíván -- „198/198 ugyanaz a szám". Itt n=2, és mégis
használható: a kérdés természete garantálja, hogy a két oldalnak KÜLÖNBÖZNIE kell, különben nem
lenne mit kérdezni. Ahol a mérés maga egy KÜLÖNBSÉGRŐL szól, ott az egyezés a hibajelzés.)*

**ÉS UGYANEZ POZITÍV IRÁNYBAN A LEGTISZTÁBB BIZONYÍTÉK, amit ma este láttunk:** ugyanabban a
körben a köteg szó szerint tartalmazza a sort
`WorkflowTriggerType.FORM_SUBMISSION, // card 06239cfd` egy TILTÓ listában -- vagyis a
merge-jelölt olyan tiltást szállít, aminek a saját kommentje mondja ki, hogy az a kártya még
elvégzendő, miközben a kártya `testing`-en áll kész munkával. Ott a két oldal különbsége nem
számban áll, hanem egy mondatban.

**ÉS EGY NEVESÍTETT OK, AMI MA KÉTSZER TERMELT EGYENLETES NULLÁT: A `git grep -E` NEM ISMERI A
`\b`-t ÉS A `\s`-t** (didi találta magán, marveen mérte ki kontrollal, 2026-08-28).

A `git grep` SAJÁT regex-motort használ, nem a rendszerét. Mérve, eldobható repóban, ugyanazon a
három soros fájlon:

```
git grep -cE '\bsendEmail\b'   ->  (ÜRES, nulla találat)
git grep -cE '\ssendEmail'      ->  (ÜRES, nulla találat)
git grep -cE 'sendEmail'        ->  3          <- KONTROLL: a fájl és a mérő is jó
git grep -cP '\ssendEmail'      ->  1          <- a -P (PCRE) helyesen illeszt
grep    -cE '\ssendEmail'       ->  1          <- a HÉJ grepje ELFOGADJA
/usr/bin/grep -cE '\ssendEmail' ->  1          <- és a VALÓDI BSD grep is
```

**A veszélyes rész az utolsó két sor: ugyanaz a minta MINDEN MÁS grepben MŰKÖDIK, a
`git grep -E`-ben NÉMÁN NULLÁT ad.**

*(Az attribúciót didi javította ki, és a javítás módszertani: én azt írtam ide, hogy „a BSD grep
elfogadja". A `grep` ezen a gépen egy HÉJ-FÜGGVÉNY, ami az `ugrep 7.8.4`-et hívja -- egy telepített
drop-in csere, nem a rendszeré. Utánamérve a VALÓDI `/usr/bin/grep` (BSD 2.6.0-FreeBSD) ugyanúgy
elfogadja, tehát az állításom véletlenül igaz maradt -- de a MEGFOGALMAZÁS rossz volt: egy
implementációhoz kötötte azt, ami nem attól függ. Aki reprodukálja és `ugrep`-et lát, vagy a
bejegyzést hiszi rossznak, vagy a saját gépét.*
*Az ÁTVIHETŐ rész szűkebb, és nem függ attól, melyik grep van telepítve: **a `git grep` SAJÁT
motort használ, tehát egy BÁRMILYEN más greppel validált minta semmit nem bizonyít róla.** És
mellékesen: ha a `grep` egy héj-függvény, akkor egy `grep`-alapú mérés arról sem nyilatkozik, amit
az ember hisz -- `which -a grep` mondja meg, mit hívtál.)* Vagyis aki a mintáját `grep -E`-vel próbálja ki -- ami a
kézenfekvő mozdulat --, működőnek látja, aztán `git grep -E`-vel tiszta nullát kap, és a nulla
valódi nemleges válasznak olvasódik. Nem hibaüzenet: a `\b` és a `\s` egyszerű `b`-nek és
`s`-nek számít, ami tipikusan sehol nem illeszkedik.

didi öt metódusra futtatott így egy ellenőrzést, mind a öt **pontosan ugyanazt a nullát** adta, és
majdnem azt jelentette, hogy kikerültek a kötegből. **Amit megfogott, az nem a figyelem volt,
hanem hogy öt különböző metódus ugyanazt a számot adta** -- a fenti szórás-jegy, egy másik ok
alatt.

**A gyakorlati alak:** `git grep`-nél `-P` (PCRE) kell a `\b` / `\s` / `\d` osztályokhoz, vagy
POSIX-osztály helyette (`[[:space:]]`, `[[:<:]]`). És minden `git grep`-alapú számhoz járjon egy
KONTROLL-minta a rövidített osztályok nélkül: ha az is nullát ad, a fájl az üres; ha nem, a mintád
volt vak.

## 7-8. A MUTÁCIÓ MAGA A MŰTERMÉK -- KÉT IRÁNY, EGY NAP (friday mérte magán, 2026-09-04)

A fenti hat alak mind arról szól, hogy a mutáció nem ÉR ODA, vagy odaér és nem SZÁMÍT. Ez a
kettő más: a mutáció tökéletesen odaér, és **maga a mutáció rossz** -- egyszer túl sokat, egyszer
túl keveset mér. Mindkettő ugyanazon a napon, ugyanattól a szerzőtől, két különböző kártyán.

### 7. ELTÖRTE AZ ALANYT (túl sokat mér) -- `1f0f225f`

A kérdés az volt, hogy a készlet elkapja-e a VALÓDI, történelmi defektust, tehát a régi
`alert_owner`-t kellett visszaállítani. KÉZZEL újraépítve:

    8/8 PIROS, **9 ms** alatt   (a valódi futás ~300-450 ms esetenként)
    és a pirosak közt: „a küszöb ALATT egyaltalán nem hív curl-t" -- egy eset, ami a
    riasztási utat SZERKEZETILEG nem éri el

**A `git diff` NEM volt üres (3 beszúrt / 34 törölt sor), tehát az 1. lépcső -- a lap saját,
dokumentált „alkalmazódott-e" ellenőrzése -- ÁTENGEDTE.** A kézi újraépítés elrontotta a
szkriptet, és egy törött szkript minden tesztet elbuktat.

**A JEL NEM A DIFF VOLT ÉS NEM A DARABSZÁM: egy POZITÍV KONTROLL ment pirosra.** Egy szél-eset
nem tud elbukni attól, hogy egy másik ág SZÖVEGE változik. Ugyanaz a törvény, mint az
implauzibilisan egyenletes nullánál, tükrözve: ott a szám túl SIMA, itt túl JÓ.

Újra, `git show HEAD~1:<út>`-ból (bájt-azonos, `bash -n` OK): **4 piros / 4 zöld**, és a négy
piros pontosan a bukás-utak; a pozitív kontroll HELYESEN zöld maradt, mert a régi kód is sikert
naplózott 200+ok:true mellett.

**Ha elfogadja a 8/8-at, egy HAMISAN ERŐS bizonyíték kerül a kártyára** -- azt állította volna,
hogy a készlet a szél-eseteket is védi, holott azok a mutációtól függetlenek.

### 8. KEVESEBBET MÉRT (a tükörképe) -- `18ee950f`

Egy `toContain('.channels-config/skills')` állítás ellen írt mutáció **TÚLÉLT: 12 zöld.** Egy
pillanatig úgy nézett ki, hogy az állítás nem véd semmit.

    a nevet csak a CIMSOR-mondatból vette ki
    a név **HÁROMSZOR** szerepel a blokkban -> a `toContain` a másik kettőből kielégült
    mind a hármat cserélve: PIROS

**Az állítás rendben volt; a mutáció mért kevesebbet, mint amit védeni akart.**

**ÉS EZ A MEGTÉVESZTŐBB IRÁNY.** Egy 8/8 piros gyanús (túl jó). Egy TÚLÉLŐ mutáció nem gyanús:
„leletnek" olvasódik, a teszt gyengeségének, és a kézenfekvő következő lépés egy FÖLÖSLEGES
szigorítás egy már helyes állításon -- vagy rosszabb, a jó állítás eldobása.

*(A helyes alkalmazás ugyanaznap, egy harmadik kártyán: a `de0989de` szöveg-mutációjánál az
`idleFlushEnabled` ÖTSZÖR szerepelt a fájlban, és szándékosan CSAK a kimenő stringben lett
cserélve -- a másik négy docblock, azok cseréje nem az állítást mérné. A darabszám kiírva,
mielőtt a mutáció teljesnek lett nyilvánítva.)*

### ÉS EGY HARMADIK, AMI MINDKETTŐT TERMELTE: A HELPER MAGÁVAL VISZI A FA FELTÉTELEZÉSEIT

Ugyanaznap a mutációs helper `git checkout -- <fájl>`-ja **elvitte a még nem commitolt
szerkesztést**. A helper HELYES volt -- csak egy MÁR COMMITOLT fára írták aznap korábban, és egy
commitolatlanon lett újrahasználva. A `git status` árulta el, nem a harness.

marveen megfogalmazása: **egy helper magával viszi annak a fának a feltételezéseit, amire írták.**
