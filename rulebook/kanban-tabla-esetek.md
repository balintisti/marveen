# Kanban tábla (konvenciók) -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.
A lapon a TÖRVÉNY és a teherhordó mondatok maradtak; itt áll a szakasz TELJES, bontás előtti
szövege, szó szerint.)*

---

## Kanban tábla

### Ami egy hét múlva is számít, az kártyára megy (Isti kérdésére, 2026-08-18)
*(A mért esetek, köztük egy VISSZAVONT mérés: `rulebook/kartya-kontra-uzenet-esetek.md`.)*

Az inter-agent üzenet NEM nyilvántartás. **Egy üzenet elveszik. Egy kártya marad.**

- **Feladat** -> kártya.
- **Döntés**, ami a feladatot érinti -> a kártyára is, kommentként, az indoklással együtt.
  Akkor is, ha üzenetben már elmondtad. Az üzenet a beszélgetés, a komment a nyom.
- **Lelet** -> kártya, a bizonyítékkal (fájl:sor, forgatókönyv), nem csak a beszélgetésben.
- **Koordináció** (sorrend, „most ezt csináld", biztatás) -> marad üzenet. Ha ez is kártya
  lenne, a tábla egy hét alatt olvashatatlan zaj lenne, és pont az veszne el benne, ami számít.

Az önellenőrző kérdés: *ha holnap elveszne a beszélgetés, ez a tudás megmaradna?*

**HÁROM HELY, ÉS EGYIK SEM PÓTOLJA A MÁSIKAT:**

    a KOMMENT ..... azt őrzi meg, MIT döntöttünk
    a STÁTUSZ ..... azt mondja meg, VAN-E MÉG ITT MUNKA -- és a dispatcher meg a tétlen-őr EZT olvassa
    a SZABÁLYKÖNYV  azt mondja meg, MIT CSINÁLJUNK LEGKÖZELEBB

**Ha egy döntés megváltoztatja, hogy egy kártyát fel kell-e venni, a STÁTUSZ is mozdul** -- a
komment nem pótolja. Egy komment, amit senki nem olvas el a felvétel előtt, annyit ér, mint egy
nem létező. És ha a döntés a LAPRA kerül, a kártyára is oda kell kerülnie: **a lap nem értesít
senkit**, azt a következő munkamenet olvassa, a kártyát az, aki most vár rá.

**ÉS A KÉZBESÍTÉS NEM AZ EGYETLEN KÉRDÉS: EGY RENDELKEZÉS A KORMÁNYZÓ KÁRTYÁN NEM ÉR EL AHHOZ,
AKI A GAZDÁLT KÁRTYÁT OLVASSA** (mandark futott bele, computress fogalmazta meg, 2026-09-11).

Egy merge-előfeltétel a KÖTEG-kártyán állt: megírva, helyesen, elérhetően. mandark a felvételi
sorrend szerint végigolvasta mind a HÁROM gazdált kártyát (leírás és minden komment) -- és az
előfeltétel EGYIKEN SEM volt megtalálható. Elköltött egy böngésző-kört egy olyan előfeltételen,
amiről ki volt mondva, hogy nem teljesül.

    KÉZBESÍTÉS ... „megkapta valaki?"                       -> mérhető, és itt IGEN volt
    OLVASÁSI ÚT .. „megtalálja, aki a sorrendet követi?"     -> itt NEM

**A konvenció: ha egy köteg- vagy epic-kártyára olyan rendelkezés kerül, ami megváltoztatja, hogy
MÁS kártyákat fel lehet-e venni, akkor a gazdált kártyák is kapnak egy sort** -- elég egy mutató
(`előfeltétel: lásd <köteg-id>`). Valaminek ott kell ülnie azon a lapon, amit az olvasó a SAJÁT
eljárása szerint kinyit.

*(És egy visszavonás ugyanebből a körből, mert a tanulsága külön áll: ugyanezt az esetet először
KÉZBESÍTÉSI résnek neveztem, és azt írtam, hogy egy ágens „a kártya szövegéből routeolt" a
rendelkezésem után. Megmérve VERSENYHELYZET volt: a routing 22:38:59, a rendelkezésem 22:42:15 --
3 perc 16 másodperc, tehát még nem létezett. Aki megmérte, a MÁSIK ágens VISSZAVONÁSÁT is
állításnak tekintette és újramérte, mielőtt visszavonta volna azt, amit már három kártyára
továbbadott.)*

**A VÉGREHAJTHATÓ ALAK** (computress): *a kártya-mozgatás a COMMIT lépéséhez tartozik, nem a
jelentéshez.* A jelentés a kör végén van, amikor a munka a fejedben már lezárult -- ott a
legkönnyebb kihagyni egy lépést. A commit mechanikus pont, amit úgysem hagysz ki.

**ÉS AZ ELLENŐRZŐNEK NINCS ILYEN PONTJA -- EZ A FENTI SZABÁLY VAK FOLTJA, NEM A MEGSZEGÉSE**
(dexter mérte magán, 2026-09-04, három kártyán).

A commit-horgony a SZERZŐRE működik. Egy ELLENŐRZŐ viszont nem commitol: a köre azzal ér véget,
hogy elolvasta a kártyát és **nem talált nyitott tételt**. Abban a pillanatban semmi mechanikus
nem kényszeríti ki a státusz-mozgatást -- a helyes eredmény épp az, hogy nincs mit tenni.

    a SZERZŐ .......... a commit a kihagyhatatlan lépés  -> a szabály odakötve MŰKÖDIK
    az ELLENŐRZŐ ...... a köre egy NEM-LELETTEL zárul    -> nincs mihez kötni

**ÉS A HIÁNYZÓ „MIÉRT": A LÁTHATÓSÁG ASZIMMETRIKUS, EZÉRT AZ ELLENŐRZŐ SOHA NEM TANULJA MEG**
(mandark fogalmazta meg magán, 2026-09-04, miután UGYANAZNAP mindkét székben ült).

Ugyanaz az ember, ugyanaz a szabály, két szerep, és csak az egyikből látszik:

    GAZDAKÉNT ..... a rothadás LÁTHATÓ -- a kártya AZ ŐN OSZLOPÁBAN ül, és minden nap ránéz.
                    (aznap NÉGY saját kártyáját zárta le épp ezért: egy tiszta idegen verdikt
                     állt rajtuk, és a mező nem mozdult)
    ELLENŐRZŐKÉNT . a köre ŐSZINTÉN véget ér azzal, hogy nem talált semmit -- és a KÖLTSÉG
                    VALAKI MÁS oszlopában landol, ahová TÖBBÉ SOHA nem néz vissza.

> **Ezért kell a horgonynak a MOZDULAT lenni, nem az ÉSZREVÉTEL.**

**Ez nem figyelem-kérdés, és ezt a mérés bizonyítja:** aki aznap este MÁSOKNAK írta le ezt a
szabályt, ugyanaznap ellenőrzőként hagyta ott a mezőt egy idegen kártyán -- és az ELLENKEZŐ
irányban (gazdaként) helyesen járt el. **A szerep dönti el, nem az ember.**

*(A mért ár a másik oldalról: dexternek 33 kártyája állt `testing`-en, ebből 16-nak MÁS ember
kommentje volt az utolsó szó. Az ellenőrzők tiszta verdiktjei nyitott kártyákon ültek, és a
tétlen-őr azokból ajánlott fel neki munkát.)*

**ÉS A SZABÁLY MÁSIK FELE UGYANILYEN FONTOS: HA VAN NYITOTT TÉTEL, HAGYD OTT.** mandark ugyanabban
a körben az egyik kártyát MOZGATTA, a másikat SZÁNDÉKOSAN nem: ott a saját verdiktje NEM volt tiszta
(a kártya állítása a `bucket` mezőre épült, ami abban a sémában nem létezik, és ezt kimondta szám
helyett). **Egy lezárás ott egy IGAZOLATLAN állítást archivált volna.** A szabály nem „zárd le",
hanem „a mező kövesse a verdiktet -- mindkét irányban".

**ES A HARMADIK SZEREP, AMIT EZ A SZAKASZ EDDIG NEM FEDETT: A KOORDINATORE -- A GAZDA-MEZO IS EGY
VERDIKTET KOVET, CSAK NEM SAJATOT** (marveen merte magan, 2026-09-06, `4dc05974`).

A fenti ket alak a SZERZOre es az ELLENORZOre all. Van egy harmadik, es a mai ara ket ebresztes volt:

    20:5x  marveen RENDELKEZETT: a kartya marad `in_progress` ES marad friday-e, mert
           friday fele MEG NYITVA ALLT.  **Akkor IGAZ volt.**
    23:56  friday LEZARTA a sajat felet (`VERDIKT: NINCS NYITOTT TETEL | ...`)
           -> a rendelkezesem ATTOL A PERCTOL HAMIS, es SEMMI nem szolt
    23:52 / 07:22  a tetlen-or ketszer ajanlotta fel neki
           az elso JOGOS (meg volt nyitott fele), a MASODIK a rossz mezo ara

**A gazda-mezo tehat ugyanugy egy verdiktet kovet, mint a statusz -- csak a verdikt MASE, es epp
ezert nem all mellette senki, aki mozditsa.** Az ellenorzo lezarja a felet es tovabbmegy; a
koordinator, aki a mezot beallitotta, mar nem nezi.

**A HORDOZHATO ALAK: ha egy kartyat azzal hagysz valakinel, hogy „a maradek az enyem", az egy
LEJARATOS RENDELKEZES, es a lejarata az a pillanat, amikor O VEGEZ.** Vagy a mezot mozditod
akkor, vagy eleve nem az o neven hagyod.

**ES AMI NEM A VALASZ, PEDIG KEZENFEKVO: a `waiting`.** A `waiting` a BLOKKOLT kartyae -- ami olyanra
var, ami nem a csapat kezeben van. Egy „marveen: a mag javitasa" nevu blokkolo nem blokkolo, hanem
KIOSZTAS, es a `waiting` oszlop pontosan attol veszti el a jelenteset, ha kiosztast is oda teszunk.
A helyes mozdulat a GAZDA-mezo, nem a statusz.

*(A cimzett HELYESEN nem irta at ejfelkor a kimondott rendelkezesemet -- a lap sajat tilalma a
„mero es a szandek kozti res kihasznalasara" --, hanem kerdesként kuldte at. Ez az egy ebresztes
az ara annak, hogy a hiba LATHATOVA valt ahelyett, hogy egy nema mezo-valtozas lett volna belole.)*


**A MÉRT ÁR:** dexter 14:1x-kor elolvasta a `dd6ba79c`-t, látta didi „nincs nyitott tétel"
kommentjét, és `testing`-en hagyta. A tétlen-őr ezután **kész kártyákat ajánlott fel neki** -- és
JOGGAL, mert a STÁTUSZ azt mondta, van még munka. Három ilyen zárult le aznap, kettő már reggel
zárható lett volna.

### A VERDIKT-JELÖLŐ: EGY ELLENŐRZŐ KÖRE A STÁTUSSZAL ÉR VÉGET, NEM A KOMMENTTEL

Egy KIMONDOTT KORLÁT („az én zöldem nem fedi le a te mutációidat") és egy NYITOTT TÉTEL teljes
mondatban különbözik, SKIM-mélységben nem -- és a státusz-söprés skim-mélységben fut. Ezért az
ellenőrző köre EGY FIX SORRAL zárul, a komment VÉGÉN, a 0. oszlopban:

    VERDIKT: NINCS NYITOTT TETEL | <HATOKOR: mit fedett az ellenorzesem>
    VERDIKT: NYITOTT TETEL | <mi az, egy sorban>

**A PIPE UTÁNI RÉSZ A KONVENCIÓ RÉSZE, NEM DÍSZ.** Csupasz tokent kérve az uptake 0/27 volt:
egy ellenőrző csak a SAJÁT ellenőrzéséről tud beszélni, tehát a csupasz alak többet állítana, mint
amit mért. A pipe helyet ad az igaznak: balra ZÁRT token (ezt olvassa a gép), jobbra szabad szöveg
(ezt olvassa az ember).

**A TOKEN PONTOS ÉS ÉRINTETLEN, A MINŐSÍTŐ A PIPE UTÁN ÁLL -- SOHA A FRÁZISON BELÜL.**

    JÓ:    VERDIKT: NINCS NYITOTT TETEL | a frontend felen
    ROSSZ: VERDIKT: NINCS NYITOTT TETEL A FRONTEND FELEN | ...    <- a token már nem token

**EGY VERDIKT A SZERZŐJE ELLENŐRZÉSÉRŐL BESZÉL, SOHA NEM A KÁRTYÁRÓL.** A parser SZERZŐ SZERINT
csoportosít, és szerzőnként az UTOLSÓ verdiktet veszi. Bármelyik NYITOTT -> van nyitott tétel.
MIND NINCS -> egyetlen ELLENŐRZŐNEK sincs nyitott tétele, ami NEM azonos azzal, hogy a kártya kész:
a gazda lehet, hogy még nem szólalt meg, VAGY a hatókörök UNIÓJA kisebb a kártyánál. Ha minden
`NINCS` visel hatókört és EGYIK sem nevezi meg a kártya TÁRGYÁT, a helyes kimenet **NEM MÉRHETŐ**.

**HA A SAJÁT VERDIKTED A KÁRTYA EGY RÉSZÉRE ÁLL ÉS A TÁRGY ÉRINTETLEN, ÍRD KI KÜLÖN SORBAN, HOGY A
TÁRGY NYITOTT** -- a saját nevedben. Nem harmadik token: a meglévő kettő egyike, a maradékra.

**A `VERDIKT:` KIZÁRÓLAG ELLENŐRZÉSI verdiktre való.** Kapu-eredményhez, cenzus-lelethez, egy másik
ágens mechanizmusának értékeléséhez más horgony (`KAPU:`, `PROBA:`, `ERTEKELES:`) -- a `VERDIKT:`
egy MÉRŐESZKÖZ horgonya, nem stílus. Egy IDÉZETT verdikt-sor legyen BEHÚZVA: a 0. oszlop a valódié.

**ÉS AMI EBBŐL A MUNKÁRA KÖVETKEZIK:** ha a vizsgálat nem talált nyitott tételt, a `testing` ->
`done` mozgatás UGYANANNAK a mozdulatnak a része, nem külön lépés. A dispatcher és a tétlen-őr a
MEZŐT olvassa, nem a prózát. A szerzőnek a COMMIT a kihagyhatatlan horgony; az ellenőrzőnek nincs
ilyen pontja, mert a köre egy NEM-LELETTEL zárul -- ezért pont a KÉSZ kártyák ragadnak be.

**PARSERT ÍRSZ RÁ? NE A SAJÁT FEJEDBŐL.** A naiv `'NYITOTT' in sor` a „NINCS NYITOTT TETEL"-t is
NYITOTT-nak olvassa, és mérve 14/14-et adott 8/6 helyett. A kötelező alak, a három kimenet és a
mért csapdák: `rulebook/kanban-verdikt-konvencio.md`. **Olvasáskori próba, egy sor: ha a
verdikt-bontásod egyik rekesze PONTOSAN nulla, a parser a gyanúsított, nem a tábla.**

*(A teljes történet -- négy megbukott változat, a 0/27-es uptake-mérés, a prefix-, ékezet- és
elválasztó-csapdák, a ragadós NYITOTT verdikt korlátja -- `rulebook/kanban-verdikt-konvencio.md`.
41 496 karakter volt itt; a döntés pillanatában a fenti összefoglaló elég.)*

### A KÁRTYA MOZDULÁSA NEM AZ, HOGY A LELET NYITOTT-E

    `updated_at` ................. „mozdult-e a kártya"  -- egy KOMMENT is mozdítja
    `GET /api/kanban/<id>/events`  „mikor LÉPETT BE az oszlopba", `actor`-ral együtt
                                   -- **és 2026-09-05 óta TÖBB ennél: a `kind` mező a
                                   MEZŐ-változásokat is hordozza, lásd lentebb.** Ez a sor
                                   szándékosan a SZŰKEBB alakot mondja, mert itt a KONTRASZT a
                                   tárgy (`updated_at` kontra esemény), nem a végpont szerződése.

Egy nem mozduló kártya lehet ELAKADT és lehet KÉSZ, és az `updated_at` a kettőt BÁJT-AZONOSAN
mutatja. Aki időhatárra válogat vele, TÚL-válogat egy lefedett kártyára (egy komment mozdította)
és KIHAGY olyat, ami tényleg később érkezett -- és ha közben ő maga kommentelt, **a mérő a saját
tevékenységét méri.**

*(Ez a szakasz azért áll itt, mert a szerzője a SAJÁT, már szabállyá vált mérését vonta vissza
három órán belül. A tanulság nem a szám: egy PROXY-metrika (mozdult-e) észrevétlenül átveszi a
VALÓDI kérdés (nyitott-e) helyét.)*

**ÉS UGYANEZ A TULAJDONSÁG A LEVER, HA TE VAGY AZ, AKI VÁLTOZTAT: EGY SZÉTVÁGÁS ELSŐ KOMMENTJE A
FORRÁS-KÁRTYÁRA MEGY** (marveen mulasztása, mandark találta meg, didi mérte ki, 2026-09-04).

A fenti bekezdés arról szól, hogy a `komment mozdítja az updated_at-et` tulajdonság MÉRÉSKÉNT
rossz. Ugyanaz a tulajdonság JELZÉSKÉNT viszont az egyetlen, ami működik -- és 2026-09-04-én ez
egy kört vitt el, mert nem használtuk:

    15:25:00  eb89a639 `updated_at` (77 komment)
    15:27:45  A SZÉTVÁGÁS (`979dbda2`) -- a FORRÁS-kártyára NEM íródott semmi
    16:29:40  didi újra levezette ugyanazt a döntést -- `updated_at` MÉG MINDIG 15:25
    16:32:31  az első mutató a forráson
    KONTROLL: a régi ág-hash 8 kommentben ott van, tehát a kereső OLVASSA a kommenteket

**A forrás-kártya KÉT tengelyen volt néma: nem mondta el, hogy szétvágás történt, ÉS NEM IS
MOZDULT.** A flotta minden figyelője az egyiket olvassa (a tétlen-őr és a frissesség-szűrők az
`updated_at`-et), tehát egyik sem tudott szólni.

**A KÖZELI ELKERÜLÉS, AMI ROSSZABB A MEGTÖRTÉNTNÉL:** ha didi előző kommentje 15:25 UTÁN lett
volna, a kártya FRISSNEK látszik, és a szűrője FEL SEM AJÁNLJA -- miközben egy rögzítetlen
szétvágást hordoz. Vagyis a hiba nem „valaki újramér", hanem „senki nem néz oda".

**A KONVENCIÓ: minden TARTÓS ÁLLAPOT-VÁLTOZÁS (szétvágás, átsorolás, gazdaváltás) első nyoma a
FORRÁS-kártyára kerül, és NEM csak az újra vagy üzenetbe.** Egy komment ott mindkét tengelyt
kezeli egyszerre: tartalmat ad ÉS mozdítja az `updated_at`-et.

**ÉS A TÜKÖRKÉPE, AMI KIFEJEZETTEN A KOORDINÁTOR HIBÁJA: EGY MUNKA-UTASÍTÁS EGY `testing` KÁRTYA
KOMMENTJÉBEN SEMMILYEN MECHANIZMUSNAK NEM LÁTSZIK** (computress mérte magán és rajtam,
2026-09-05 -- 7,5 óra állás után KÉRDEZETT, nem állt neki).

    a tétlen-őr a `planned` + `in_progress` kártyákat számolja A NEVEDRE
    a kártya `testing` volt, és MÁSVALAKI munkájáról szólt
    -> az utasítás LÉTEZETT, és NULLA mechanizmus látta

Az őr aznap éjjel azt írta neki, hogy „nincs a nevén semmi", és a SAJÁT definíciója szerint IGAZA
VOLT. A „választ váró ellenőrzés" kategóriája 4-ből 1-et fogott meg -- feltehetően azért, mert egy
KOORDINÁTORI komment nem „ellenőrzés".

**A JAVÍTÁS UGYANAZ, MINT A LAP TÖBBI HELYÉN, csak a koordinátor oldalán: ha egy komment MUNKÁT
OSZT KI, akkor vagy a STÁTUSZ mozdul ugyanabban a mozdulatban, vagy az utasítás SAJÁT KÁRTYÁT kap.**
Egy `testing` kártya kommentje a NYOM helye, nem a KIOSZTÁSÉ.

**ÉS DETEKTORT NE ÍRJ RÁ:** egy „tartalmaz-e ez a komment utasítást" illesztő pontosan abba a
79/89/93/97%-os hamis-pozitív családba esik, amit ez a flotta ma ötször mért. A mechanizmus a
kártya-létrehozás, nem egy szűrő.

*(A mért ár: az utasítás 20:26-kor ment ki, 04:02-kor még mindig nem tudta senki, hogy él-e, és a
válasz „ÉL" volt. A címzett helyesen KÉRDEZETT ahelyett, hogy nekiállt volna -- de a kérdés maga is
egy fordulóba került. A 7,5 óra a koordinátoré, nem az övé.)*

**ÉS EGY HARMADIK ARTEFAKTUM UGYANEBBEN A CSALÁDBAN, AMI MEGJÓSOLJA, HOL KERESS: A BIZONYÍTÉK-MUTATÓ
NEM UTAZIK A DUPLIKÁTUMRA** (mandark fogalmazta meg, 2026-09-04, egy saját mérésén).

    a fejléc nem utazik a MONDATTAL
    a cáfolat nem utazik a KOMMENTTEL
    a helyesbítés nem utazik a MÁR ELKÜLDÖTT ÜZENETTEL
    **a MUTATÓ nem utazik a MÁSODIK KÁRTYÁRA**   <- ez az új
    **és a KIKÖTÉS nem utazik a FEJLÉCCEL** -- ugyanez visszafelé (didi mérte a lapon, 2026-09-05)

*(A visszafelé futó alak mért példánya: egy szakasz-fejlécbe `ES NINCS NEGYEDIK` került, miközben a
mérés HÁROM cáfolat volt, nem a nemlétezés bizonyítása. A helyes kikötés ott állt a lapon -- HUSZONKÉT
SORRAL LEJJEBB. Aki a szakaszt idézi, a FEJLÉCET idézi. Javítva `ES EGYIK SEM JOSOL`-ra, ami a
mérésről szól. **A fejléc a szakasz egyetlen olyan sora, ami önmagában is utazik -- tehát a
kikötésnek BELE kell férnie, nem alá.**)*

**A bizonyíték-mutató azon a kártyán él, ahol a bizonyíték KELETKEZETT. Amikor egy defektust
újra felfedeznek és MÁSODIK kártyát kap, a mutató nem követi -- és a munka a MÁSODIKON folyik.**

Mért eset: az `ed39a9fd` (08-23) végig hordozott egy futtatható bukó tesztet; a `814a5e98` (09-02),
ahol dexter, jarvis és didi ténylegesen dolgozott, **nulla említést tartalmazott róla** (kontroll:
`revokeSession` = 12 ugyanott, tehát a hiány valódi). Senki nem tudta, hogy a teszt már meg van írva.

**ÉS EZ NEM A NÉV-ELUTASÍTÁS ALAKJA -- én oda soroltam be, és mandark megmérte, hogy tévedtem.**
Ugyanaz az ág, MÁSIK commit, MÁSIK mechanizmus:

    08-29  `8fc8b944`  jarvis és én is a NEVE alapján utasítottuk el  -> név-szűrő
    09-04  `6f8bde4b`  senki nem utasított el semmit; a mutató SOHA NEM KERÜLT ELŐ  -> olvasatlan kártya

Egy rossz besorolás itt nem ártalmatlan: **bizonyítékot halmoz egy mechanizmusra, ami nem működött,
és elrejti azt, amelyik igen.**

**AMIÉRT EZ TÖBB A TÖBBINÉL: MEGMONDJA, HOL NÉZZ.** A név-minta nem. Ez igen: **ahol egy defektusnak
KÉT kártyája van.** Ott a mutató szinte biztosan az elsőn maradt, a munka meg a másodikon folyik.

**A HATÁRA, KIMONDVA, mert az első alakom alul- ÉS túlmondta** (didi javította): ez a TARTÓS
állapot-változásokra áll, ahol van mit leírni. Azt NEM zárja be, hogy egy MOST hozott döntésről a
másik fél nem tud -- 16:34:46-kor vettem át a kártyát, miközben didi levele már úton volt. Az
ágensek közti kézbesítési késés, és arra semmilyen kártya-konvenció nem hat.


