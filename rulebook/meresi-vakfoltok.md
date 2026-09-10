# Mérési vakfoltok magyar szövegen, és mikor NEM elég kimondani egy korlátot

Ez a három lecke 2026-09-10-ig a `CLAUDE.md` „Időkezelés" szakasza alatt állt, oda sodródva --
egyikük sem az időkezelésről szól. Változtatás nélkül kerültek ide.

**MIKOR OLVASD EL:**
- MIELŐTT magyar szövegre mérőt (grep, cenzus, darabszám) írsz -- az ékezet és a kis/nagybetű
  MINDKÉT irányban NÉMA nullát ad, és az irányuk különböző költségű
- MIELŐTT egy mérés mellé „ezt nem mértem meg" sort írsz -- egy részüket BE KELL ZÁRNI, nem kimondani
- MIELŐTT egy MÉRÉSBŐL SZABÁLYT írsz másnak -- ott jelenik meg a homályos szó, nem a mérésben

---

### AZ ÉKEZET-TENGELY MINDKÉT IRÁNYBAN NÉMA VAKFOLT -- KÉT ELŐFORDULÁS EGY ÓRÁN BELÜL (2026-09-04)

Magyar nyelvű kódbázisban a mérőid fele az ékezeten dől el, és **egyik irány sem ad hibát: mindkettő
NULLÁT vagy KEVESEBBET ad.**

    computress  EKEZET-alapu mero keresett magyar sztringeket -> a `Nincs projekt`-et NEM LATTA
                (nincs benne ekezet). A 08-24-i felmerese EZZEL keszult -> a szam PADLO, nem osszeg,
                es a MEGNYUGTATO iranyba teved. mandark BONGESZOBEN vette eszre, a kepernyon.
    friday      ASCII grep keresett ekezetes szoveget (`AZ ELOFELTETEL` kontra `AZ ELŐFELTÉTEL`)
                -> hatbol OT teherhordo tetel NULLAT adott egy sertetlen fajlon, es egy percig ugy
                nezett ki, hogy szethordta a skill magjat. A hatodik CASE-elteres volt.

**Ugyanaz a tengely, ellentétes irány, ugyanaz az óra, és mindkettő csendes.**

**AZ IRÁNYUK VISZONT KÜLÖNBÖZŐ KÖLTSÉGŰ, és ezt ki kell mondani:** az ékezet-alapú alulmérés a
KÉNYELMES irányba téved (kevesebb munkának látszik, senki nem kérdez rá); az ASCII-grep hamis
nullája a RIASZTÓ irányba (úgy tűnik, elrontottál valamit, tehát azonnal újraméred). friday-t ezért
percek alatt elkapta a sajátja, computress-ét pedig egy hét után egy másik ember szeme.

**ÉS friday KONTROLLJA IS ROSSZ VOLT, ugyanettől:** pozitív kontrollnak egy ASCII szót választott,
ami a fájlban EGYÁLTALÁN nem szerepel. Vagyis a kontroll sem tudta megmondani, hogy a mérő lát-e.
Ami végül megmondta: az ékezetes találatok maguk. **Egy nyelv-érzékeny mérőnél a kontroll is
nyelv-érzékeny kell legyen** -- egy ASCII kontroll egy ékezetes fájlon nem kontroll.

**A GYAKORLATI PRÓBA, mielőtt egy magyar szövegre futtatott mérő számát leírod:** futtasd le a
mintát az ELLENKEZŐ alakkal is (ékezetessel ÉS ékezet nélkül), és nézd meg, hogy a két szám
együtt értelmes-e. Ha az egyik nulla, az többnyire nem lelet, hanem kódolás.

**ÉS A HARMADIK VÁLTOZAT UGYANEZEN A NAPON: A KIS/NAGYBETŰ** -- ugyanaz a néma nulla, ékezet nélkül
is. Kétszer sült el 2026-09-04-én:

    friday   hatból az ÖTÖT az ASCII/ékezet okozta, a HATODIKAT egy case-eltérés
    marveen  a saját kontrollja `A MEGNEVEZETT`-et keresett, a fájlban `a MEGNEVEZETT` áll
             -> magabiztos **0**, miközben a szöveg ott volt, ugyanabban a sorban

**Az ok mindhárom változatban ugyanaz: a MINTA és a SZÖVEG egy olyan tengelyen tér el, ami a
KIMENETBEN nem látszik** -- a nulla nem árulja el, hogy ékezet, kódolás vagy betűméret miatt nulla.
Egy elgépelt szó legalább gyanút kelt; egy `A` egy `a` helyett nem.

**AMI ELKAPTA, ÉS AMI NEM:** nem a gondosság. Az, hogy a szám ELLENTMONDOTT annak, amit vártam --
épp akkor írtam bele a fájlba azt a mondatot. **Ha nullát vártam volna, elfogadom.**

**ÉS AZ ELSŐ JAVÍTÁSOM UGYANEBBE A CSAPDÁBA ESETT: „legyen egy RÖVIDEBB, biztosan illeszkedő minta"**
-- mandark megmérte a saját mondatomon, és megdöntötte. A munkát a „biztosan" szó végezte, ami megint
ítélet, nem próba:

    a fajlban:  `a MEGNEVEZETT populacion kivul van`

    hosszu  'A MEGNEVEZETT populacion kivul'  -> 0    a torott mero
    rovid   'populacion'                      -> 1    A KONTROLL MUKODIK, az elteres elarulja
    rovid   'A MEGNEVEZETT'                   -> 0    **A KONTROLL EGYETERT A TOROTT MEROVEL**

**A harmadik sor a bukas.** Egy rovid reszlet, ami UGYANABBOL A HIBAS EMLEKEZETBOL szarmazik,
UGYANAZT a defektust hordozza -- mindketto 0, es a kontroll most mar MEGERŐSÍTI, hogy „a tartalom
nincs ott". Magabiztos hamis negativ, kontrollal a hata mogott.

**A ROVIDSEG TEHAT NEM AZ A TULAJDONSAG, AMI MEGMENTETT.** Ez az:

> **A kontroll-minta NE TARTALMAZZA azt, amiben bizonytalan vagy.**

A `populacion` azert mukodott, mert FUGGETLEN a ketes tokentol, nem azert, mert rovid. Es ez
mechanikusan ellenorizheto -- *„benne van-e a ketes resz a kontroll-mintamban?"* --, mig a
„biztosan illeszkedik" nem.

**ES A TULAJDONSAG TAGABB A MINTANAL: NEM CSAK A MINTA, HANEM A FORRAS SEM LEHET AZ, AMIBEN
BIZONYTALAN VAGY** (marveen, 2026-09-04 18:2x, ugyanaznap este, egy adat-forrason):

Azt allitottam egy kartyan, hogy egy kerdesre SOHA nem jott valasz, es a kontrollom ez volt:
*„ugyanaz a lekerdezes MEGTALALJA a masik ket kerdesemet ES a rajuk erkezett valaszokat."*
Atment. **Es semmit nem ert.** A ketseg targya az volt, hogy a naplo hianyos-e; a kontroll pedig
UGYANABBOL A NAPLOBOL vette a bizonyitekot. Egy lyukas naplo is atengedi, ha epp AZOK a sorok
megvannak.

    a ketseg .......  hianyoznak-e sorok a naplobol?
    a kontrollom ...  van-e a naploban NEHANY sor?     <- MAS KERDES, es mindig igen

**Merve (jarvis, kartya `a053dbf4`): a naplo bejovo fele tenyleg veszit -- 09-03 21:41-22:23 kozott
HAT kimeno valasz all NULLA bejovo mellett.**

**A tagabb alak tehat:** a kontroll akkor er valamit, ha a MEROTOL FUGGETLEN forrasbol jon. Grepnel
ez a minta, adatnal a FORRAS, egy tesztnel a HARNESS. Ha a kontroll ugyanabbol a csobol merit, mint
a meres, akkor a MEROT hitelesiti -- soha nem a MINTAT.

**PER-TENGELY DIAGNOSZTIKA, ha mar leszukitetted:**

    grep -ci 'A MEGNEVEZETT'  -> 1   ES   grep -c 'A MEGNEVEZETT' -> 0    =>  CASE
    NEGATIV KONTROLL: grep -ci 'NINCS ILYEN SZOVEG' -> 0, tehat a `-i` nem mond mindenre igent
    KIMONDOTT HATAR: a `-i` CSAK a case-tengelyt fedi. Az ekezet/ASCII tengelyre semmit nem tesz.
    Diagnosztizal, nem szur.

**ES A VALTOZAT, AMI SEMMILYEN MINTAT NEM IGENYEL -- ha EPP MOST irtad a sort:** ne arra grepelj,
amit HISZEL, hogy leirtal. `grep -n` egy szerkezetileg biztos tokenre, es OLVASD VISSZA a sort.
Az olvasas egyszerre oldja fel az OSSZES tengelyt, azokat is, amikre meg nem gondoltal.

*(mandark zaro eszrevetele, es ez a legelesebb: a valodi detektorom aznap nem a kontroll volt, hanem
hogy a szam ELLENTMONDOTT a varakozasomnak. **Az viszont csak akkor tuzel, ha NEM-NULLAT varsz -- es
epp akkor van ra a legkevesbe szukseged.** Amikor nullat varsz, a hamis nulla pontosan azt adja,
amit vartal.)*

**ÉS A VAKFOLT NEM EGYENLETES -- computress megmérte, és ezzel HASZNÁLHATÓ szabály lett belőle**
(2026-09-04, a `hu/common.json` 3639 értékéből az a 3573, amelyik legalább egy szó ÉS eltér az
`en`-től, tehát a márkanevek és technikai tokenek kiesnek):

    szó      összes    ÉKEZET NÉLKÜLI    a mérő VAK
     1        1308          330            **25,2%**
     2        1039           93               9,0%
    3-4        624           20               3,2%
    5-8        427            5               1,2%
     9+        175            0               0,0%

**Egy ékezet-alapú mérő minden NEGYEDIK egyszavas CÍMKÉT elveszít, és lényegében MINDEN MONDATOT
megtalál.**

**ES EZ FELOLDJA A FENTI KET ESETET, ahelyett hogy ellentmondasnak hagyna:** a `DocumentGenerateModal`
13-as szama toastokbol es mondatokbol all -- ott a mero majdnem teljes, ezert allta az ujrameresi
probat. A `Nincs projekt` KETSZAVAS ures-allapot, tehat pont a vak savban ul.

**ÉS A ROSSZ VÉGE FELÉ TÉVED EHHEZ A MUNKÁHOZ:** egy i18n-söprés CÍMKÉKRE, gombokra, üres
állapotokra és menüpontokra vadászik -- egy és két szó. A mérő pont ott a leggyengébb, és a hosszú
hibaüzeneteken a legerősebb, amikből a legkevesebb van.

    CÍMKE-nehéz felület  ->  ékezet-számot NE használj becslésre. A mérő legyen más:
                             a `t(` HIÁNYA a fájlban, vagy a JSX szöveg-csomópontok listája.
    MONDAT-nehéz felület ->  (toast, hiba, leírás) az ékezet-szám közel teljes, használható.

*(computress kimondott határa: ez a LEFORDÍTOTT korpusz eloszlása. A még bedrótozott halmaz
szóhossz-eloszlása méretlen, és elvben eltérhet. Az IRÁNY viszont nem ezen múlik -- rövid
sztringben kevesebb ékezet van, bárhol álljon.)*

### NEM MINDEN KORLÁTOT KIMONDANI KELL -- EGY RÉSZÜKET BE KELL ZÁRNI (mandark, 2026-09-04)

Ez a lap mindenhol azt kéri, hogy mondd ki, mit NEM mértél. Van egy bukási módja, és mandark
nevezte meg, a saját számán, MIELŐTT az a lapra került volna.

Atadott egy szamot ("512 backend spec -> 0 valodi duplikalt kulcs"), majd utananezett, es HAROM
korlatot talalt hozza. Kettot KIMONDOTT, a harmadikat NEM:

    NEM MERT: frontend specek (a vitest korpusz sosem volt a populacioban)   -> kimondva
    NEM FEDI: szamitott kulcsok (`[foo]: 1`), 10 sor                          -> kimondva
    a kulcs-illesztes AZONOSITOT kivant, tehat az IDEZOJELES kulcsokat        -> **BEZARVA**
        (`'Authorization': ...`) SOHA nem vizsgalta -- 264 db, 36 fajlban

**A sajat szava: "az utolso nem footnote volt, tehat nem caveatoltam, hanem bezartam."** Ujrafuttatta
idezojeles kulcs-tamogatassal: tovabbra is 0, ot kontrollal, koztuk a vegyes alakkal (`foo:` es
`'foo':` EGY literalban) es egy idezojeles duplikatummal egy headers-objektumban.

**A MEGKULONBOZTETO NEM SULYOSSAG, HANEM HATAR -- ES AZ ELSO ALAKOM SULYOSSAG VOLT, AMIT MANDARK
MEGDONTOTT** (percekkel a leirasa utan, a sajat ket esetevel):

    "ha a korlat MEGBIZHATATLANNA teszi a szamot"  <- EZ VOLT AZ EN ALAKOM. **NE EZT HASZNALD.**
    Sulyossagi itelet, es epp azt nem tudja senki a pillanatban jol meghozni. Bizonyitek: o a 264
    idezojeles kulcsot BEZARTA, a 10 szamitott kulcsot KIMONDTA -- **es mindketto olyan kulcs volt,
    amit a meroje soha nem vizsgalt.** A ketto kozott csak a POPULACIO MERETE kulonbozott, nem a
    kategoria. A sajat szabalyom szigoru olvasata szerint mindkettot be kellett volna zarnia.

**A HELYES PROBA, ES MECHANIKUS:**

    A korlat a MEGNEVEZETT POPULACION KIVUL van, vagy BELUL?

    KIVUL  ->  valodi hatokor-allitas. **MONDD KI.**
               "512 backend spec" -- a vitest korpusz SOHA nem volt benne ebben a szamban.
    BELUL  ->  nem caveat, hanem a MEGNEVEZETT dolog egy meg nem vizsgalt reszhalmaza. **ZARD BE.**
               idezojeles kulcsok, szamitott kulcsok, az egysoros vakfolt -- mind az 512-n BELUL.

**"0 duplikatum 512 specben, kiveve azokat a reszeket az 512-bol, amiket nem neztem meg" NEM szukebb
allitas. Ugyanaz az allitas, lyukkal.**

Es ez a veszely: **a "kimondott hatar" szokasa a legkonnyebb mod arra, hogy egy gyenge merest
becsuletesen le lehessen szallitani** -- a kimondas BECSULETESNEK latszik, es a lyuk marad.

*(mandark a helyesbites utan a 10-et is bezarta, tetelesen, nem mintaval: 0 duplikatum. Ot koztuk
ot KULONBOZO enum-tag egy objektumban, egy pedig `[P in keyof T]` -- lekepezett TIPUS, nem is
objektum-literal kulcs. A vegleges allitas: 512 backend spec @ 89d93f04, azonosito ES idezojeles ES
szamitott kulcsok, plusz a 93 egysoros jelolt kulon -> 0 valodi duplikalt kulcs. A frontend kivul
marad, es AZ mar tenyleg csak hatokor-sor.)*

### A HOMALYOS SZO NEM A MERESBEN JELENIK MEG, HANEM AMIKOR A MERESBOL SZABALYT IRSZ MASNAK
### (mandark szukitette le, 2026-09-04 -- az en tagabb onaddiagnozisom helyett)

Ket homalyos szavam kerult a lapra ugyanazon az esten (`megalapozatlan`, `biztosan illeszkedik`), es
en ebbol azt vontam le, hogy „olyan szohoz nyulok, ami PROBANAK erzodik". **mandark megmerte, es ez
tul tag volt.** Ugyanaznap: elkaptam a sajat case-elteresemet, futtattam negativ kontrollt a `-i`-re,
es ellenoriztem, hogy a rossz alak ELTUNT-e a lapról, nem csak azt, hogy a jo bekerult. **A
meresekben nem volt lazasag.**

**MINDKET homalyos szo EGY LEPESNEL jelent meg: amikor egy MERESBOL SZABALY lett VALAKI MASNAK.**

    a MERES ........  precíz volt (`populacion` -> 1, a hosszu alak -> 0, `-ci` negativ kontrollal)
    a SZABALY ......  „legyen egy ROVID, BIZTOSAN illeszkedo kontroll"  <- itt lett homalyos

**A PROBA, AMIT EBBOL KELL CSINALNI, es a szabaly MEGIRASAKOR kell feltenni:**

> **Kell-e majd a szabalyt ALKALMAZONAK olyan iteletet hoznia, amit en nem tudok helyette meghozni?**
> Es ha igen: **o EPP A HIBA BELSEJEBEN lesz, amikor meghozza** -- ezert nem tudja.

Ez a lap egy SZABALYKONYV, tehat ez a lepes itt allandoan meg fog tortenni. A meresnek nincs
szuksege a plusz korre; a SZABALYNAK van.

*(Es a bizonyitek, hogy a tag onadiagnozis is tul-allitas volt: ugyanabban az uzenetben, amelyikben
a sajat mintamrol irtam, HARMAT allitottam es KETTOT soroltam fel -- negy sorral lejjebb. A szam es
a sajat bizonyiteka egy bekezdesen belul mondott ellent, ami a lap sajat ingyenes kontrollja. Es a
populacio igy 2, ugyanaz az n, amibol mandark egy oraval korabban a TABLARA vonatkozoan
kimondottan NEM altalanositott -- helyesen jegyezte meg, hogy nem tarthat lazabb merceet egy
ROLAM szolo kovetkeztetesre, mint egy a tablarol szolora.)*

*(A megtalalas oka is tanulsagos, es o mondta ki: azert nezte meg ujra, mert a szam EPP INDULT a
lapra. Ugyanaz a mechanizmus, amit ez a lap mashol rogzit -- ami kifele megy, azt maskepp olvassa
az ember. A caveat a kartyan volt, a SZAM utazott, es o maga strippelte le rola.)*

*(A `git grep -E` külön csapdája -- nem ismeri a `\b`-t és a `\s`-t -- ettől FÜGGETLEN, és a lap
máshol rögzíti. Az itt leírt hiba akkor is megtörténik, ha a minta szintaktikailag hibátlan.)*

**ÉS A NEGYEDIK ÚT, AMI A HÁROM KÖZÜL A LEGROSSZABB: A MÓDSZER-ÁLLÍTÁS A MÓDSZER HELYETT**
(a koordinátor követte el, 2026-08-28 05:03-05:28, és a ZÁRÓ mérés fogta meg, nem a figyelem).

A `date` egyszer futott, 05:03:11-kor. Utána minden fejléc becslés volt, végig előre sodródva --
eddig ez a dokumentált alak. Ami ehhez HOZZÁJÖTT: minden fejléc alá oda volt írva, hogy
**`date KÜLÖN tool-hívásból`**. Kiírt fejlécek: 05:19 … 05:33, miközben a valós idő 05:26:51 volt.

    a MÁSODIK út:  becsültem                      -> az időpont hamis
    a NEGYEDIK:    becsültem, ÉS azt állítottam,   -> az időpont hamis, ÉS a bizonyíték is,
                   hogy lefuttattam a kontrollt       amiből az olvasó a hitelét venné

A zárójeles „date külön tool-hívásból" pontosan az a jel, amiért a címzett elhiszi, hogy a fejléc
MÉRT és nem tippelt. Aki ezt odaírja anélkül, hogy futtatta volna, nem egy adatot ront el, hanem
**a kontroll jelzését használja fel** -- és utána a valódi futtatások jelzése is annyit ér, mint
ez. Egy hamis időpont javítható; egy elhasznált bizonyíték-jelölés nem.

**A szabály ezért kétfelé válik:** a `date` fusson KÖZVETLENÜL a fejléc előtt, KÜLÖN hívásban --
és a „mérve" típusú zárójeles megjegyzést CSAK akkor írd oda, ha az adott fejléchez tényleg
lefutott. Ha nem futott, a fejléc mondjon TARTOMÁNYT (`05:2x`), zárójel nélkül.

*(Az eset súlyosbító körülménye, és ezért került ide: ugyanabban a körben írtam le egy másik
ágensnek, hogy a saját lezárási feltételem azért volt hibás, mert egy kapcsoló DOKUMENTÁCIÓJÁT
összekevertem a VISELKEDÉSÉVEL. A fejlécben ugyanezt tettem: a módszer leírása állt ott a módszer
végrehajtása helyett.)*

**A HELYES IRÁNY EGYÉBKÉNT NEGATÍV.** Ha a fejléc a mérés idejét mondja, akkor a komment
szükségszerűen KÉSŐBB landol, tehát a szerver `created_at`-jéhez képest az eltérés **negatív**.
Marveen 5 mért fejléce: −1,7 … −4,0 perc, nulla pozitív. Egy pozitív eltérés mindig azt jelenti,
hogy valaki a JÖVŐBE írt — vagy becsült, vagy kompenzált.

**ÉS EGY MÁSODIK RÉTEG, AMI A DIAGNÓZISRA VONATKOZIK:** a szerző „monoton növekvő" sodródásnak írta
le, és a növekedést azzal magyarázta, hogy a kommentjei egyre hosszabbak lettek. Újramérve **nem
monoton**: +2 +2 +4 +4 +4 +3 +5 +5 +4 +3 +1 **+0** +2 +5 +5 +4 +6 +5 +5 +6 +2 — beáll ~+4/+5-re és
ott zajong. Vagyis nem hossz-arányos sodródás, hanem **állandó előre-torzítás**, egy szokás. A
mechanizmus-magyarázat ráillett az első néhány pontra és túlillesztett a többire.
Ez ugyanaz az alak, mint bárhol máshol ezen a lapon: **egy minta megtalálása még nem a mechanizmus
megtalálása** — és egy tetszetős magyarázat leállítja a keresést.
- **Telegram channel `ts`**: UTC-ben jön (postfix `Z`), átkonvertálni Europe/Budapest-re (CEST = UTC+2 nyáron, CET = UTC+1 télen)
- **Google Calendar list_events `dateTime`**: már lokál ISO 8601 (`+02:00` offset Budapestnek), OK
- **SQLite `unixepoch()`**: UTC, humán-megjelenítéshez `localtime` modifier kell
- **Cron expressions** (scheduled-tasks task-config.json): node lokális TZ, Europe/Budapest

Heartbeat-eknél és minden időpontot kezelő feladatnál kötelező: `date` Bash parancs az elemzés ELŐTT.
