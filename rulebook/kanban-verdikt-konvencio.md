# A VERDIKT-jelölő: a konvenció, és ahogy méréssel kialakult

Ez a fájl a `CLAUDE.md` „Kanban tábla" szakaszából került ki 2026-09-10-én, változtatás nélkül.
A MŰKÖDTETŐ szabály (amit betartani kell) a lapon MARADT; itt az áll, hogy MIÉRT pont az az alak,
és milyen méréseken bukott meg négy korábbi változat.

**MIKOR OLVASD EL:** ha a jelölőre PARSERT vagy CENZUST írsz, ha a konvenciót MEG AKAROD
VÁLTOZTATNI, vagy ha nem érted, miért nem elég egy csupasz token. A napi verdikt-íráshoz a lapon
álló összefoglaló elég.

**AMIÉRT KÜLÖN FÁJL:** 41 496 karakter volt, a betöltött lap 9,4 százaléka, és minden ágens minden
indulásakor elolvasta. A benne álló mérések értékesek, de nem a döntés pillanatában kellenek.

---

### ÉS EGY KIMONDOTT KORLÁT SKIM-MÉLYSÉGBEN AZONOS ALAKÚ EGY NYITOTT TÉTELLEL
### (dexter mérte magán, 2026-09-05 -- és a saját hibáját ő maga vonta vissza fél órán belül)

didi két kártyát így zárt le: *"a mutációid a tieid, és az én zöldem NEM fedi le őket."* dexter ezt
NYITOTT TÉTELNEK olvasta, és két kártyát emiatt hagyott `testing`-en. **Nem az volt: didi a SAJÁT
ELLENŐRZÉSE HATÁRÁT mondta ki** -- azt, hogy az ő zöld futása nem áll a másik mutációs bizonyítéka
helyett. Ugyanígy a *"24 route nyitva"*, ami a VÁLTOZATLAN blokkban állt tény-összefoglalóként.

    egy KIMONDOTT KORLÁT ...... "ezt nem mértem / az én zöldem nem fedi" -> LEZÁRT állítás
    egy NYITOTT TÉTEL ......... "ez még hátravan"                        -> marad munka

**Teljes mondatban a kettő világosan különbözik. SKIM-mélységben nem** -- és a státusz-söprés
pontosan skim-mélységben fut. dexter tévedése a ÓVATOS irányba ment, tehát semmi nem jelezte:
**egy kész kártya nyitva hagyva nem hibának látszik, hanem fegyelemnek.**

**A KONVENCIÓ, MOSTANTÓL: egy ellenőrző köre EGY FIX SORRAL zárul, a komment VÉGÉN.** Kettő van,
és pontosan egy állhat ott:

    VERDIKT: NINCS NYITOTT TETEL | <HATOKOR: mit fedett az ellenorzesem>
    VERDIKT: NYITOTT TETEL | <mi az, egy sorban>

**A `|` UTANI RESZ 2026-09-05 12:2x OTA A KONVENCIO RESZE, ES EZ EGY MERT JAVITAS AZ ELSO
ALAKOMON.** Elso alakomban a jelölő KET CSUPASZ sor volt, es a hatokor-minositest (*"reszemrol"*,
*"az en oldalamon"*) a sor FOLE, a prozaba kertem. **jarvis megmerte az elso napjan, en
fuggetlenul ujramertem, es az uptake NULLA volt:**

    NINCS NYITOTT TETEL, CSUPASZAN (amit eloirtam) .....  **0**
    NINCS NYITOTT TETEL + hatokor-minosito A SORON .....  **27**
    NYITOTT TETEL -- <mi> (ott a zaradek eleve megengedett)  32
    sem egyik, sem masik ...............................   1
    (55 elo `in_progress`+`testing` kartya; negy kulonbozo szerzo)

**27/27, es ez NEM fegyelmi kerdes.** jarvis mondata a diagnozis: **egy ellenorzo csak a SAJAT
ellenorzeserol tud beszelni.** A csupasz alak tobbet allitana, mint amit megmert -- tehat a
konvencio azt kerte, hogy hagyja el pont azt, amitol a mondata igaz. Egy szabaly, ami valotlanna
teszi a betartojat, nem lesz betartva, es helyesen nem.

**A JAVITAS NEM HARMADIK JELOLO-ALLAPOT, HANEM STRUKTURA.** Egy harmadik allapot visszahozna azt a
ketertelmuseget, amiert a jelölő letezik (a skim-melysegu olvaso megint azt kerdezne, marad-e
munka). A `|` ehelyett HELYET ad az igaznak: balra egy ZART token, amit gep olvas, jobbra szabad
szoveg, amit ember olvas. A parser a bal oldalt nezi, es a hatokor tovabbra is ott all, ahol a
szerzo kimondta.

**ES EZ EGY MERT MEROESZKOZ-HIBAT IS BEZAR:** jarvis szuroje a sor PREFIXET olvasta, es ezzel 12
kartyat "lezartnak nyilvanitott", amelyik egyiket sem mondta. Egy kemeny hatarolo nelkul a
prefix-olvasas SZERKEZETILEG rossz -- a hatarolo teszi a jelölőt gepileg olvashatova, nem a
csupaszsag.

**AMIT A `|` NEM VALTOZTAT MEG:** a jobb oldal NEM modositja a verdiktet. Egy "NINCS NYITOTT TETEL |
csak a sajat mutacioimra" TOVABBRA IS lezart allitas -- azt mondja meg, MIRE all, nem azt, hogy
felig all. A kimondott korlatok hosszabb kifejtese tovabbra is a prozaba valo, a sor FOLE.

**VISSZAMENOLEG NEM SOPORJUK.** A 27 meglevo sor a maganak megfelelo alakban all, es egy mintaval
valo atirasuk pontosan azt a ketertelmuseget kodolna be, ami ellen a konvencio szol.

**ES EGY HIANY A SAJAT KONVENCIOMBAN, AMIT EGY ELO SZENNYEZODES HOZOTT ELO (friday, 2026-09-05
12:49): NEM VOLT KIMONDVA, HOGY EGY KARTYAN MELYIK VERDIKT-SOR SZAMIT.**

Egy komment-lanc append-only, tehat EGY kartyan TOBB `VERDIKT:` sor allhat. friday `c85a2663`-as
kommentje `VERDIKT: NINCS NYOM`-mal kezdodott -- egy MERESI eredmennyel, nem zart tokennel --, es
a valodi jelölő a komment VEGEN allt. **Egy prefix-olvaso parser, ami az ELSO talalatot veszi, a
rosszat kapja** -- pontosan az a szerkezeti bukas, amit a hatarolo bezarni hivatott, csak most a
sorok SORRENDJEN.

**A SZABALY, JAVITVA EGY ORAVAL A MEGIRASA UTAN (didi merte, elo adaton -- az elso alakom
"EGY KARTYA VERDIKTJE AZ UTOLSO SOR" volt, es az EGY ELLENORZOT FELTETELEZ):**

    a "UTOLSO NYER" a SZERZON BELUL all, NEM a kartyan keresztul
    a parser SZERZO SZERINT CSOPORTOSIT, es szerzonkent az UTOLSO verdiktet veszi

**MERT ADAT, amiert ez nem finomitas:** 56 elo kartya, 70 sor-eleji verdikt-sor, 26 kartya hordoz
verdiktet -- es ebbol **HATON (23%) TOBB SZERZO ir verdiktet.** Azokon a kartyakon a "utolso nyer"
alak szerint a kartya verdiktjet az IDOZITES donti el, nem a HATOKOR: aki utoljara postazott, az
beszel a kartya neveben.

**AZ ELO PELDANY A ROSSZ IRANYBAN, es didi a SAJAT sorain talalta:** a `25850d4b` DEXTERE, `testing`,
es HET sor-eleji verdiktet hordoz, MIND didie. Az utolso "NINCS NYITOTT TETEL" IGAZ az O ellenorzesere
-- de a regi szabaly szerint az lett volna A KARTYA verdiktje, egy olyan kartyan, ami nem az ove, es
aminek a nyitott tetelei UGYANABBAN a kommentjeben vannak megnevezve.

**ES A HATAROLO EZT NEM ZARJA BE, HANEM ELESITI.** Ma azert nem robban, mert didi sorai `--`-t
hasznalnak, tehat a `split('|')[0]` az EGESZ mondatot adja vissza -> NEM KONFORM, nem hamis lezaras.
**Amint valaki a HELYES uj alakot irja (`NINCS NYITOTT TETEL | csak a sajat ellenorzesemre`), a bal
oldal PONTOSAN a zart token, es a parser a kartyat lezartnak olvassa.** A javitasom termelte volna a
hibat, nem a regi alak.

**A HELYES OLVASAT, ES EZ A JELÖLŐ EREDETI SZANDEKA IS: EGY VERDIKT A SZERZOJE ELLENORZESEROL
BESZEL, SOHA NEM A KARTYAROL.**

    minden szerzo utolso verdiktje ..... ez a szerzo allitasa
    barmelyik NYITOTT ................... a kartyan VAN nyitott tetel
    MIND NINCS .......................... egyetlen ELLENORZONEK sincs nyitott tetele
                                          -- ami NEM azonos azzal, hogy a kartya kesz:
                                          a GAZDA lehet, hogy meg nem szolalt meg

**A parser tehat nem zar le kartyat. Osszefoglal:** ki mondott mit, es maradt-e barkinek nyitott
tetele. A lezaras tovabbra is a gazda mozdulata -- ez a lap mashol is ezt mondja.

**ES EGY RES, AMI A KONVENCIO SAJAT SZERKEZETEBOL JON: EGY KOORDINATORI DONTES LATHATATLAN A
PARSERNEK, MERT NEM VERDIKT** (computress merte 2026-09-06, marveen kartyajan; marveen irta be).

A `VERDIKT:` sor ELLENORZESI verdiktre valo -- ezt a lap fentebb kimondja, es helyesen. Csakhogy egy
kartya nyitott tetele gyakran nem ellenorzest var, hanem DONTEST: a koordinatorét vagy Istiét. Az a
valasz, amikor megerkezik, **nem verdikt, tehat nem visel `VERDIKT:` sort** -- es egy sor-eleji
horgonyra kotott parser SEMMIT nem lat belole.

    a `c547cfd9` k4-e 14:0x-kor MEGVALASZOLTA a kartya nyitott kerdeset  (marveen, DONTES)
    a parser ugyanezen a kartyan CSAK computress szuk NINCS-et latta
    a gazda 17:09-es handoffja meg mindig azt irta: "awaiting marveen"   -> **HAROM ORA**

**ES A HANDOFF AZ, AMI TARTOSSA TESZI:** egy handoff MEMORIA, es amit egy kartya allapotarol allit,
ugyanugy avul, mint barmely mas allapot-allitas -- csak epp TULELI a context-resetet, tehat az
elavult "X-re var" mondat friss kontextusban ujra megjelenik, ahol mar semmi nem cafolja.

**A JAVITAS A MEGLEVO KET TOKENNEL, HARMADIK NELKUL:** ha koordinatorkent (vagy barki, aki nem
ellenorzokent) MEGVALASZOLSZ egy kartya nyitott kerdeset, irj MELLE sajat verdikt-sort:

    VERDIKT: NINCS NYITOTT TETEL | a kartya nyitott KERDESERE, dontéskent

Nem uj allapot es nem uj mezo -- a dontes igy legalabb LATSZIK annak a merőnek, amit erre epitettunk.
Es a masik iranyba: egy handoff "X-re var" sora DATUMOZOTT ALLITAS, nem tenyallas. Olvasd el a
kartyat, mielott ratamaszkodsz.

**ES A `MIND NINCS` SOR INDOKA SZUKEBB VOLT, MINT A JELENSEG -- MERT PELDANNYAL, ES A GAZDA IS
BESZELT** (friday merte 2026-09-06, `cc666d39`; marveen irta be).

A fenti sor azt mondja, hogy a `MIND NINCS` azert nem azonos a keszsel, mert **a GAZDA lehet, hogy
meg nem szolalt meg**. Van egy masodik ut ugyanoda, es ma egy elo kartyan allt: **a gazda IS
megszolalt, `NINCS`-et mondott, es a kartya targya MERHETOEN nem kesz.**

    ket verdikt a kartyan (didi es friday), MINDKETTO `NINCS NYITOTT TETEL`
    MINDKETTO IGAZ, es MINDKETTO a `premium` szalra hatokorozve
    a kartya TARGYA (az arva archivum-sor bekotese) kozben nyitva

**A mechanizmus nem a hallgatas, hanem a HATOKOROK UNIOJA: minden szerzo becsuletesen leszukitette
a sajat verdiktjet egy RESZ-SZALRA, es a reszek unioja kisebb a kartyanal.** Egy parser, ami
szerzonkent az utolso verdiktet veszi, ezt szerkezetileg nem latja -- pontosan azt csinalja, amire
tervezve van, es `MIND NINCS`-et ad.

**A KARTYA ALLAPOTA UGYANEBBEN A PERCBEN, KET FUGGETLEN TENGELYEN, MINDKETTO KONTROLLAL:**

    OSOODES ..... `is-ancestor(83c3625, HEAD)` **rc=1**            KONTROLL rc=0
    TARTALOM .... az ELO `scripts/memory-index-add.py`-ben
                  `ARCHIVE_MARKER` / `archive_pointer_line`: **0**  KONTROLL: `def main` = 1

**Es epp a `scripts/` sav teszi ezt drágává: az AZONNAL-ELO sav, tehat a "nincs a futo fan" itt
azt jelenti, hogy a javitas MA SEM HAT** -- mikozben a kartya `testing`-en all, ami atnezettnek
olvasodik.

**A VEDELEM MAR A KONVENCIO RESZE, CSAK NEM VOLT KIMONDVA, HOGY MIRE JO: A PIPE JOBB OLDALA.**
Ha minden `NINCS` visel hatokort, es EGYIK hatokor sem nevezi meg a kartya TARGYAT, akkor a parser
kimenete nem `NINCS`, hanem **NEM MERHETO** -- ugyanaz a harmadik allapot, amit ez a szakasz
mashol is megkovetel. Nem kell hozza uj token es uj mezo: a hatokor-szoveg mar ott all, csak
eddig senki nem OLVASTA a parser oldalarol.

*(Es ezert nem sopres a valasz: a ket verdikt HELYES, a szerzoik HELYESEN szukitettek, es
visszamenoleg atirni oket epp azt a szokast vinne el, amit a 27/27-es uptake-meres a legjobb
jelnek nevez. Amit csinalni kell: aki parser-kimenetbol soporne, olvassa el a hatokoroket.)*

**ES A MASODIK MERT PELDANY UGYANAZNAP, MAS AGENSTOL, MAS KARTYAN -- ES O JOBB ORVOSSAGOT
ALKALMAZOTT, MINT AMIT EN ELOIRTAM** (dexter, 2026-09-06, `f9cac51f`; marveen ellenorizte a kartyan).

Ugyanaz az alak: ket `NINCS NYITOTT TETEL` (dexter a paletta-letiltasra, didi a paletta-utra es az
eles nevezore), mindketto IGAZ es HELYESEN szukitve -- **es a ket hatokor UNIOJA kisebb, mint a
kartya**, aminek a cime KET dolgot nevez meg (nincs jovahagyo kepernyo; az ertesites rossz helyre
visz). Egyik verdikt sem er hozzajuk.

**A FENTI ORVOSSAGOM az volt, hogy a parser a PIPE JOBB OLDALAT olvassa, es ha egyik hatokor sem
nevezi meg a kartya TARGYAT, a kimenet legyen NEM MERHETO.** dexter ehelyett egyszerubbet tett:

    harmadik sort irt, SAJAT NEVEBEN:  `VERDIKT: NYITOTT TETEL | a kartya targya (...)`

**Ezzel a `f9cac51f` MA HELYESEN olvasodik** -- szerzonkent az utolso verdikt szerint dexteré
NYITOTT, tehat a parser nem mond MIND NINCS-et. Ellenorizve: harom sor-eleji verdikt all a kartyan,
es a helyes kimenet all elo, PARSER-VALTOZTATAS NELKUL.

    az EN alakom .... a parser KOVETKEZTET a hatokor-PROZABOL -> uj logika, es a proza szabad szoveg
    dexter alakja ... a GAZDA KIMONDJA a targyra, hogy nyitott -> nulla uj logika, es a meglevo
                      "utolso verdikt szerzonkent" szabaly MAR kezeli

**A gyakorlati szabaly: ha a sajat verdikted a kartya EGY RESZERE all es a targy erintetlen marad,
ird ki KULON sorban, hogy a targy NYITOTT.** Nem harmadik token es nem uj mezo -- a meglevo ket
token egyike, a sajat nevedben, a maradekra.

*(A ketto nem valtja ki egymast: dexter alakja SZERZO-oldali es olcsobb, de csak akkor mukodik, ha
a gazda eszreveszi. A NEM MERHETO olvasat PARSER-oldali vedelem arra az esetre, amikor senki nem
irja ki. Egymast fedik.)*

**ES A KONVENCIO MERT KORLATJA, A MEGIRASA NAPJAN, jarvis meresebol (2026-09-05, a65623ef c187):
EGY VERDIKTET CSAK UGYANAZ A SZERZO TUD VISSZAVONNI, EGY UJABBAL. Es a szerzo tipikusan nem jon
vissza.**

A fenti szabaly szandekos: senki nem beszelhet a masik ellenorzese neveben. A KOVETKEZMENYE viszont
nem allt itt: amikor a GAZDA orvosolja a reviewer nevesitett tetelet -- prozaban, majd lezarja a
kartyat, ami a NORMALIS mozdulat --, **a reviewer NYITOTT verdiktje orokre ott marad.**

    a szerzo utolso verdiktje = NYITOTT   ->  a parser szerint a kartyan van nyitott tetel
    a gazda orvosolta, prozaban, es lezarta ->  a parser errol SEMMIT nem tud
    -> a NYITOTT verdikt SZERKEZETILEG RAGADOS

**MERVE (utolso verdikt szerzonkent, NYITOTT):** `in_progress` 3, `testing` 28 -- ez a cenzus
hatokore; `planned` 14, `waiting` 14, `done` 10 -- ezen KIVUL. **A fele a hatokoron kivul esik.**

**ES A `done` TIZE NEM TIZ NYITOTT TETEL: 10/10 kapott kesobbi kommentet, es a ket `BLOKKOLO`
cimut kezzel elolvasva 2/2 HAMIS** -- mindketto megoldva es szandekosan lezarva. **Tehat a 38
JELOLT-PLAFON, nem darabszam.**

**MIERT NEM VEZETUNK BE HARMADIK TOKENT VAGY SOPREST -- es ez jarvis dontese is volt:** egy
`done` kartya elavult verdiktje NEM KERUL SEMMIBE, mert a statusz-sopres csak elo kartyakat
olvas. A hatosugarat a FOGYASZTO hatarolja, nem a jelölő. Egy harmadik allapot visszahozna azt a
ketertelmuseget, amiert a jelölő letezik.

**AHOL VISZONT TENYLEGESEN KERUL VALAMIBE: egy ELO (`in_progress`/`testing`) kartyan, ahol a gazda
orvosolt es a reviewer nem jott vissza.** Ott a ragados NYITOTT tartja a kartyat -- es ez ugyanaz a
mechanizmus, amit ez a lap mar rogzit: **az ELLENORZO kore egy NEM-LELETTEL zarul, tehat semmi nem
huzza vissza.**

**A GYAKORLATI ALAK, ES SZANDEKOSAN NEM MECHANIZMUS:** ha GAZDAKENT orvosolsz egy reviewer
nevesitett tetelet, irj SAJAT verdikt-sort. Az nem vonja vissza az ovet -- nem is teheti --, de a
parser kimenetén a ket allitas EGYUTT latszik (reviewer: NYITOTT, gazda: NINCS), es az egy
ELLENTMONDAS, amit el kell olvasni. Egy egyoldalu NYITOTT nem az: ugy nez ki, mint egy el nem
vegzett munka.

*(A hatar altalanos alakja: egy append-only jelölő, ami SZERZO SZERINT csoportosit, szerkezetileg
nem tud allapot-valtozast rogziteni, ha az allapotot MASVALAKI valtoztatta meg. Ez nem javithato a
jelölőn belul -- csak kimondhato, es a fogyasztoval hatarolhato.)*

**ES AZ ORVOSSAG, AMIT AZ ELOZO BEKEZDES ELOIR, A SAJAT BETEGSEGEBE FUT -- MERVE, EGY ORAVAL A
LEIRASA UTAN** (jarvis merte, a65623ef c188; marveen irta elo, es o maga nem merte meg).

31 elo kartya, ahol BARKI NYITOTT-at jelez:

    a gazda NEMA .................................................. 14
    **ELLENTMONDAS** (gazda NINCS + reviewer NYITOTT) ..............  7   <- amit eloirtam
    a gazda VALASZOLT, de a sora NEM OLVASHATO .....................  4   <- **EZ A LELET**
    csak a gazda jelez .............................................  4
    mindketten nyitottat .......................................... 2

**A NEGY GAZDA PONTOSAN AZT TETTE, AMIT KEREK -- irtak sajat verdikt-sort --, es a parser EGYIKET
SEM olvassa**, mert a minosito a TOKENEN BELUL all: *"NINCS NYITOTT TETEL AZ EN OLDALAMON"*,
*"... RESZEMROL"*. Szigoruan mind a negy **NEM MERHETO**, tehat megkulonboztethetetlen a NEMA
gazdatol -- vagyis attol az allapottol, amit az orvossag megszuntetni hivatott.

**11 gazda-valaszbol 4 olvashatatlan (36%), es ez PONTOSAN mandark ~20%-os beepult-minosito
rataja, rafutva arra a mechanizmusra, ami tole fugg.**

**AMI EBBOL KOVETKEZIK, ES AMI NEM.** Az orvossag NEM ervenytelen: 7 kartyan mar ma is eloall az
ELLENTMONDAS, ami olvasasra kesztet. De **nem 100%-os, hanem a beepult-minosito rataval csokkentett**
-- es ezt az elozo bekezdes elhallgatta, mert nem mertem meg, mielott eloirtam.

**A HELYES ALAK TEHAT SZIGORUBB, MINT AHOGY ELOSZOR IRTAM:** a gazda verdikt-sora akkor er valamit,
ha a TOKEN ERINTETLEN es a minosito a PIPE UTAN all. Ez mar a konvencio resze -- most viszont mert
bukasi rataja van, es az orvossag ORoKLI azt a ratat. Aki erre epit, ne 11-bol 11-et varjon.

*(jarvis sajat helyesbitese ugyanebbol a korbol, es ugyanaz a torveny: az elso bontasa KET rekeszt
hasznalt, es ezt a negyet az "egyoldalu" rekeszbe tette. Harom kimenet, sosem ketto -- amit o maga
idezett egy oraval korabban. A NEM MERHETO harmadik allapot elhagyasa itt PONTOSAN azt a negy esetet
tuntette volna el, amiert a meres keszult.)*

*(didi adata a valtozas MELLETT szol, nem ellene: a hat kartya utolso soraibol HAROM kerdezetlenul
szukiti magat -- "reszemrol tovabbra sem", "reszemrol. A kartya nyitott fele marveene",
"NINCS NYITOTT TETEL AZ EN OLDALAMON". Ugyanaz a 27/27 uptake-jel. Es a harmadik a legjobb elo erv a
hatarolo mellett: friday a minositot a TOKENBE tette, tehat ott a `split('|')[0]` is elvetene.)*

*(Az eredeti mondat, amit ez felulir, es amiert megis igaz marad EGY szerzon belul: append-only
lancban egy rossz sort nem torolni kell, hanem FELULIRNI egy kesobbivel -- amit friday meg is tett.)*

    parser:  az OSSZES sor-eleji `VERDIKT:` talalat kozul az UTOLSO, majd `split('|')[0].strip()`

**ES A `split('|')[0]` MAGA MEG NEM ELEG -- A NAIV FOLYTATAS MEGFORDITJA A JELENTEST** (mandark
merte a TELJES korpuszon, 2026-09-05; ujramerve 13:0x-kor **223** sor-eleji (0. oszlop) es
**303** barhol-a-sorban -- a korabban itt allo 231 egy KI NEM MONDOTT harmadik horgonybol jott, es
mandark maga vonta vissza; egy komment-korpusz csak NO, tehat 231 egyik alaknak sem regebbi olvasata):

    NAIV substring-teszt (`'NYITOTT TETEL' in sor`), amit barki elsore ir:
      "NINCS NYITOTT TETEL | HATOKOR: ..."  -> **NYITOTT**   <- A HELYES UJ ALAK, MEGFORDITVA
      "NINCS UJ NYITOTT TETEL"              -> **NYITOTT**   <- a jelentese NINCS
      "NINCS NYITOTT TÉTEL | ..."           ->  NINCS, de VELETLENUL (a 'NINCS' szotol)

**A "NINCS NYITOTT TETEL" TARTALMAZZA a "NYITOTT TETEL"-t, tehat a hatarolo ONMAGABAN nem ved:**
minden helyesen megirt NINCS sort NYITOTT-ra osztalyoz. Ez nem elmeleti -- ez az elso alak, amit
barki megir.

**A KOTELEZO PARSER-ALAK, mind a negy eseten igazolva:**

    0. **A HORGONY `^\**VERDIKT:` -- A KIEMELES MEGENGEDETT, es ez 2026-09-05 19:2x-kor
       DOLT EL** (didi merte, marveen ujramerte a teljes elo tablan). A konvencio "0. oszlop"-ot
       mond, es a `**` A 0. OSZLOPBAN VAN, csak a token nem -- tehat a betuje eleve ketertelmu volt,
       es HET szerzo mar a bold alakot valasztotta. Merve, elo kartyakon (583):
         szigoru `^VERDIKT:` ......... 73 kartya
         bold-turo `^\**VERDIKT:` .... **80**   -> 7 kartya CSAK bolddal
         KONTROLL: a szigoru halmaz RESZHALMAZA a bold-turonek -> a lazitas nem eszik mast
       **ES A HIBA IRANYA A BIZTONSAGOSNAK LATSZO:** a rejtett kartya "NEM MERHETO"-kent
       olvasodik, amit senki nem hajszol -- kozben LEZARHATO nem-lelet. didi 24 elemu
       mintajan ez 9/15-ot forditott 15/9-re, azaz **40%-os alulmeres**.
       *(Ugyanaz a torveny, mint a reggeli 27/27 hatokor-minosito meres: egy szabaly, ami a
       kovetoit teszi parszolhatatlanna, a SZABALY hibaja, nem a kovetoe.)*
       **ES A TALALAT A 0. OSZLOPBAN KEZDODJON** (a `**`-ot beleertve): egy BEHUZOTT
       `VERDIKT:` idezet, nem verdikt. Ez a legolcsobb szures, es a 0. lepes resze.
    0/b. **VAGD LE A `VERDIKT:` PREFIXET.** Ez a lepes 13:08-ig HIANYZOTT a leirt eljarasbol, es
         nelkule a 4. lepes PONTOS EGYENLOSEGE a HELYESEN megirt sorokat is elutasitja (didi merte:
         34 parbol 0 konform; a prefix levagasaval 3 -- a kontroll szerint pontosan ez a kulonbseg)
    1. az OSSZES ilyen talalat kozul az UTOLSO, SZERZONKENT
    2. **`re.split(r'\||--|\.', body, maxsplit=1)[0]`** `.strip().upper()`, zaro irasjelek levagva
       -- HAROM elvalaszto, es mindharom MERT okbol all itt:
         `|`  az ajanlott alak
         `--` az ELOZO ELOIRT alak (a nelkul mind a 33 nyitott verdikt ertelmezhetetlen -- jarvis)
         `.`  a MONDATZARO PONT: a token egy teljes tagmondat, tehat a magyar iro lezarja es
              folytatja. mandark merte MINDKET IRANYBAN: +7 NINCS, es a ket osztaly, amiert a
              szabaly letezik, VALTOZATLAN (a BEEPULT alak 13/13 es a szabad szovegu 10/10 tovabbra
              is NEM MERHETO), mert ott a pont a MINOSITO UTAN all, tehat a bal oldal ugysem token
    3. EKEZET-NORMALIZALAS (NFD + a `Mn` kategoria eldobasa) -- lasd lentebb
    4. **PONTOS EGYENLOSEG** a ket tokenre. NEM `in`, NEM `startswith`.
    5. barmi mas = **NEM MERHETO**, ami NEM verdikt es NEM "nincs nyitott tetel": kezzel olvasd el

**ES A 4. LEPES ELVAGTA AZOKAT, AKIK A SZABALYT BETARTOTTAK -- EZ A NAP LEGSULYOSABB HIBAJA, ES AZ
ENYEM** (jarvis merte 13:09-kor, MIELOTT atallt volna ra):

    73 sor-eleji sor a mai elo korpuszon:
      pontos NINCS ....... 8      <- tehat a mero TUD igent mondani
      pontos NYITOTT ..... **0**
      ertelmezhetetlen ... 65   (**89%**)
    a VALOSAG ugyanezen: **33 nyitott tetel, mind megnevezve**

**A nulla oka nem hanyagsag: mind a 33 nyitott verdikt `--`-t hasznal, es a `--` VOLT AZ EN
EREDETI, ELOIRT ALAKOM** (`VERDIKT: NYITOTT TETEL -- <mi az>`). **Aki a reggeli szabalyt BETU
SZERINT kovette, 100%-ban ertelmezhetetlen a delutani alatt.** Egy uj alak bevezetese a migracios
koltseget pontosan azokra tolta, akik megfeleltek.

**ES A KAR IRANYA A LEHETO LEGROSSZABB:** az ERTELMEZHETETLEN es a NINCS ugyanazt a szamot adja.
Ma futtatva a mero azt mondja, *"0 nyitott verdikt az elo kartyakon"*, ami ugy olvasodik, hogy
EGYETLEN kartyan sincs nyitott tetel -- **batran a lezaras fele.** Ez a lap sokat ir arrol, hogy a
hibas mero a kenyelmes iranyba teved; itt a SAJAT konvencio-valtasom termelte.

**KET JAVITAS, ES MINDKETTO KOTELEZO:**

    (a) ELVALASZTO: `|` VAGY `--`. A `--` nem "regi szemet", hanem az ELOZO ELOIRT ALAK,
        tehat KONFORM. Aki `--`-t ir, helyesen ir; a `|` az ajanlott, nem a kizarolagos.
    (b) HAROM KIMENET, SOHA KETTO: NINCS / NYITOTT / **NEM MERHETO**. A harmadik NEM
        olvashato "nincs nyitott tetel"-kent -- se szamban, se osszegzesben, se szinben.
        Egy jelentes, ami a NEM MERHETO-t es a NINCS-et egy szamba vonja, hasznalhatatlan.

**ES EGY NEGYEDIK, AMI MAGAROL A LAPROL SZOL, ES MA HAROMSZOR TORTENT MEG** (didi mérte
mindharomszor, 13:18):

    12:2x  "a kartya UTOLSO sora nyer"  -> EGY ellenorzot feltetelezett
    13:0x  a szamozott eljaras SOHA nem vagta le a `VERDIKT:` prefixet
    13:1x  az `--` elfogadasa a PROZABA kerult, a 2. LEPES valtozatlan maradt

**Mindharomszor a SZAMOZOTT resz es a korulotte allo PROZA mondott mast, es mindharomszor a
SZAMOZOTT volt a rossz.** Mérve: a szamozott eljaras betu szerint futtatva 0 NYITOTT-ot adott,
mikozben a prozat elolvasva nyilvanvalo, mi a szandek.

**A SZABALY EBBOL: ha egy eljaras SZAMOZOTT LEPESEKBEN all, a javitas a LEPESBE megy, nem a
korulotte levo magyarazatba.** Epp azert szamozott, hogy ne kelljen joindulatuan olvasni -- egy
prozaban elrejtett javitas visszaadja a jóindulatú olvasas szuksegesseget, es azzal az egesz alak
ertelmet veszti.

**A TAGABB ALAK, AMI TULMUTAT EZEN A JELÖLŐN:** ha egy formatumot szigoritasz, a REGI ELOIRT alak
attol nem lesz hiba -- a te migracios koltseged. Aki koveti a szabalyt, sosem lehet rosszabb
helyzetben, mint aki nem: **ma a szabalykoveto lett 100%-ban ertelmezhetetlen, a szabalyszego pedig
(veletlenul) parszolhato.** Ha egy valtoztatas ezt termeli, a valtoztatas hibas, nem a kovetok.

A pontos egyenloseg a `NINCS UJ NYITOTT TETEL`-t is helyesen NEM-KONFORMNAK jeloli, ahelyett hogy
csendben az ellenkezojere osztalyozna.

**AZ EKEZET-TENGELY MOST A JELÖLŐN CSAPOTT LE:** computress `NYITOTT TÉTEL`-t irt, es
`'TÉTEL' != 'TETEL'`, tehat egy szigoru egyezes NEMAN kihagyja. Ez a lap kulon szakaszban rogziti
az ekezetet mint nema-nulla forrast ebben a kodbazisban -- most a sajat konvenciónk hordozojan.
**A javitas a PARSER oldalan van, nem az iroen:** magyar szoveget iro ember ekezetet fog irni.

**ES A HARMADIK ES NEGYEDIK HASZNALAT, AMIT A CENZUS TALALT (19 nem-konform sor, 8,2%):**

    didi 9 ...... SZABAD SZOVEGU review-verdikt ("A MECHANIZMUSOD ALL") -- mandark szerint a
                  korpusz LEGERDEMIBB reviewjai, mert MAS agens mechanizmusat ertekelik
    mandark 7 ... per-TETEL cenzus-lelet 08-21-rol, a jelölő elott ("VERDIKT: 8 db HALOTT VEZERLO")
    computress 2  kozeli-tevesztesek (a fenti ket veszely)
    marveen 1 ... a sajat `MEG NEM` kapu-eredmenyem

**A DONTES: NEM VEZETUNK BE HARMADIK TOKENT, ES DIDI 9 SORA NEM VESZIT SEMMIT.** A `VERDIKT:`
sor-eleji alakja MECHANIZMUS-HORGONY: a statusz-sopres olvassa, es pontosan ket valaszt tud
kezelni. Minden mas -- kapu-eredmeny, cenzus-lelet, egy masik agens mechanizmusanak ertekelese --
**PROZA**, es ha horgonyt akar, valasszon olyat, ami nem `VERDIKT:` (`KAPU:`, `PROBA:`, `ERTEKELES:`).

Ha egy kartya MINDKETTOT akarja -- erdemi ertekelest ES gepileg olvashato verdiktet --, akkor
mindkettot megkapja: a proza FOLOTT, a jelölő UTOLSO sorkent. Ez a szerkezet mar a konvencio resze.

**Uj kotelezo szokincset azert nem irunk elo, mert kilenc sorra egy szerzotol egy harmadik
reszervalt szo pontosan az a tulmeretezes, amit ez a lap mashol elutasit.**

**ES KET TOVABBI MERES UGYANARROL A JELÖLŐRŐL, KET SZERZOTOL, EGY ORAN BELUL. MINDKETTO A
MEGFOGALMAZASRA VONATKOZIK, NEM A PARSER-RE.**

**(A) A BEHUZOTT `VERDIKT:` IDEZET, ES AMIERT MA NEM ROBBAN** (jarvis, 12:59). 77 sor-eleji talalat
az 56 elo kartyan: **72 a 0. oszlopban, mind VALODI; 5 behuzva, es 5/5 NEM verdikt** (a sajat
`MEG NEM`-em plusz negy SPEC-IDEZET). A komment-en BELULI tobbszoros verdikt mind idezet: a 0.
oszlopra horgonyozva **3 -> 0**, es a ket olvasat mindenhol egyezik.

**A veszely, amit ez megnyit: egy komment VEGEN allo spec-idezet lenne a kartya verdiktje.** Ma
csak azert nem harap, mert MINDENKI behuzza az idezeteket -- **egy szokas, amit senki nem irt elo.**

    a 0. OSZLOP a VALODI verdikte. Egy IDEZETT `VERDIKT:` sor BEHUZVA all.

**(B) A HATAROLO A DOMINANS SZOKAST FORMALIZALJA -- ES EPP EZERT A MEGFOGALMAZAS A KAR**
(mandark, 13:00, a 134 NINCS soron):

    sor-eleji (0. oszlop) `VERDIKT:` .... 223     korpusz: 12 009 komment
    ebbol NINCS-alaku .................. **137**  <- EZ A NEVEZO
      csupasz, pontos token ............  35   25,5%
      `--` utan, a TOKEN TISZTA ........  65   47,4%   -> mechanikus csere `|`-ra
      BEEPULT a frazisba / egyeb .......  28   20,4%   <- a nem-konform osztaly
      mar `|`-t hasznal ................   9    6,6%
      -> minosito JELEN, barmely alakban 102  **74,5%**
    horgony: `line.startswith('VERDIKT:')`, NFD + Mn-eldobas az osszehasonlitas elott

**Vagyis a pipe nem uj szokast vezet be, hanem egy ~74,5%-os tobbseget formalizal.** Ez jo hir az
uptake-re, es MERVE van, nem remelve.

**A BAJ A 93-on BELUL VAN:**

    a minosito `--`-vel kezdodik, a TOKEN TISZTA elotte ....  66   mechanikus csere `|`-ra
    a minosito BEEPULT A TOKEN-FRAZISBA ...................  **27**  (a NINCS sorok 20%-a)

    "NINCS NYITOTT TETEL A FRONTEND FELEN -- ..."      (computress)
    "NINCS NYITOTT TETEL A MUNKABAN. Szallitas: ..."   (computress)
    "NINCS NYITOTT TETEL AZ EN OLDALAMON."             (computress)
    "NINCS NYITOTT TETEL A 'rebase utan is all-e' kerdesben"  (didi)

    OT szerzo, nem egy: computress 14 | friday 5 | jarvis 5 | mandark 2 | didi 1

**ES EZ UGYANAZ AZ ALAK, MINT A REGGELI NULLA UPTAKE.** A *"NINCS NYITOTT TETEL A FRONTEND FELEN"*
a TERMESZETES magyar mondat: a minosito a FONEVI SZERKEZETHEZ tapad, nem egy gondolatjel utan.
Aki igy irja, NEM-KONFORM sort termel **es semmit nem vesz eszre, mert a mondat tokeletesen
olvashato.**

**EZERT A SZABALY NEM AZ, HOGY "TEGYEL BE EGY HATAROLOT". EZ:**

> **A TOKEN PONTOS ES ERINTETLEN, A MINOSITO A PIPE UTAN ALL -- SOHA A FRAZISON BELUL.**

    JO:    VERDIKT: NINCS NYITOTT TETEL | a frontend felen
    ROSSZ: VERDIKT: NINCS NYITOTT TETEL A FRONTEND FELEN | ...     <- a token mar nem token

**ES A FOGYASZTOI OLDALON EGY RESZKARAKTERLANC-CSAPDA, AMI 14/14-ET AD 8/6 HELYETT** (didi merte
magan, 2026-09-05, a konvencio ELSO ra epulo meresen):

    a naiv teszt:  `'NYITOTT' in line`
    es a "NINCS NYITOTT TETEL" **TARTALMAZZA** a "NYITOTT"-at
    -> mind a 14 kartya "NYITOTT"-kent szamolodott. A helyes bontas: **8 / 6 / 0**.

**A PARSER MAR ELO VOLT IRVA ITT, KOZVETLENUL A KONVENCIO MELLETT** (a `VERDIKT:` elotag levagasa,
`|` / `--` / `.` menten vagas, NFD-normalizalas, PONTOS egyenloseg) -- **es a szerzo perceken belul
azutan irta a naiv alakot, hogy epp ezekrol a kartyakrol olvasott.** A sajat mondata: *"annak
ismerete, hogy egy csapda le van irva, nem allitott meg abban, hogy megirjam."*

**EZERT A JAVITAS NEM EGY UJABB IRASKORI ELOIRAS, HANEM EGY OLVASASKORI PROBA -- ES EGY SOR:**

> **HA A VERDIKT-BONTASOD EGYIK REKESZE PONTOSAN NULLA, A PARSER A GYANUSITOTT, NEM A TABLA.**

Egy reszkarakterlanc-hiba SZERKEZETILEG mindent EGY rekeszbe omleszt, tehat a masik pontosan
nullara esik. A 14/14 nem "egyertelmu eredmeny": a hiba **alakja**. Es forditva is all -- ha a
`NINCS`-re szursz reszkarakterlanccal, a NYITOTT oldal esik nullara.

    KONTROLL, ingyen: futtasd le MINDKET iranyt (`NINCS ...` es `NYITOTT ...`), es a ket szam
    OSSZEGE egyezzen a jelolt sorok darabszamaval. Ha nem egyezik, vagy ha barmelyik 0, allj meg.

*(Ez a het masodik esete, ahol egy SAJAT, LEIRT csapdank kapta el a sajat szerzojet -- az elso a
zsh `"$ref:literal"` modifier volt, ugyanaznap, ugyanattol az embertol. Mindketto HANGOS volt, es
kizarolag ezert derult ki. A tanulsag nem az, hogy tobb dokumentacio kell: az, hogy az iraskori
eloiras a gondos embert sem vedi meg, es kell melle egy olcso olvasaskori proba.)*

*(Egy szabaly, ami a termeszetes nyelv ellen dolgozik, nulla uptake-et kap -- ezt ma reggel
megmertuk. Ez a megfogalmazas azert mukodhet, mert NEM tiltja a minositot: helyet ad neki, es
csak azt koti ki, hogy hol.)*

*(mandark kimondott hatarai: csak a 134 NINCS sort bontotta, a NYITOTT oldalt nem; es a 27-et
CSAK ALAKRA olvasta, tartalomra nem -- tehat azt nem allitja, hogy atfogalmazhatok jelentes-vesztes
nelkul. Visszamenoleges soprest egyikunk sem javasol.)*

**ES A SZAMOM POPULACIO-HATARA, amit friday helyesbitett, mert kulonben tobbet allitana:**
a "csupasz alak: 0" az 55 ELO (`in_progress`+`testing`) kartyara all. O a SAJAT 1126 kommentjen
ujramerte, es talalt **KETTOT** -- mindketto `done` kartyan, tehat az en populaciomon KIVUL.
A helyes mondat tehat: **nulla a MEG NYITOTT kartyak kozott, nem nulla valaha.** A diagnozist ez
erositi, nem gyengiti: az o 29 verdikt-sorabol 27 hordozott hatokor-minositot, kerdezetlenul,
NEGYEDIK szerzokent.

**ES EGY NEGYEDIK HASZNALAT, AMIT EN MAGAM INJEKTALTAM ES AMI TILOS:** a `VERDIKT:` sor-eleji alakja
KIZAROLAG ELLENORZESI verdiktre valo. 2026-09-05-en egy KAPU eredmenyet irtam vele (`VERDIKT: MEG
NEM` egy `/events` probara), es azzal a cenzus szamlaloja ala kevertem egy olyan sort, aminek semmi
koze egy kartya nyitottsagahoz. Kapu-eredmenyhez mas szo (`KAPU:`, `PROBA:`), mert a `VERDIKT:` egy
MEROESZKOZ horgonya, nem stilus.

**ES A LEGFONTOSABB, AMIT EZ A KONVENCIO-VALTAS SAJAT MAGAROL TANITOTT: EZ A LAP IS HOOK-SAV, ES
EGY IDE IRT SZABALY MA SENKIT NEM ER EL** (jarvis merte 2026-09-05 12:37-kor, 12 perccel a
valtoztatas utan).

    a `CLAUDE.md` modositva ........ 12:25:06
    mind a KILENC tmux session ..... KORABBAN indult (jarvis 12:07, ot masik 01:48-11:37,
                                     a koordinatore 09-04 es 08-19 -- 17 NAP)
    BIZONYITEK, nem kovetkeztetes:  jarvis SAJAT betoltott kontextusa MEG MINDIG a regi alakot
                                     hordozta; az ujat CSAK azert ismerte, mert GREPELTE a fajlt
    uptake 12 perc alatt ........... 3 sor, ebbol 2 az ove es 1 a sajat peldam -> NULLA fuggetlen

**Ez a lap hosszan irja le, hogy a `~/.claude/settings.json` hookjai agensenkent, a kovetkezo
indulasnal hatnak. UGYANEZ ALL MAGARA A LAPRA** -- a munkamenet elejen toltodik be, tehat egy
konvencio-valtozas annyi kulonbozo idopontban er el, ahany agens van, es az idopontot a
context-guard valasztja, nem mi.

**A GYAKORLATI SZABALY: EGY KONVENCIO-VALTAST KI KELL HIRDETNI, NEM ELEG LEIRNI.** A lap a TARTOS
hordozo (a kovetkezo munkamenet ezt olvassa); az uzenet az EGYETLEN, ami MA elér. A ketto nem
helyettesiti egymast, es a sorrend: eloszor a LAP, aztan a hirdetes -- forditva egy uzenet olyat
allitana, amit a lap meg nem mond ki.

**A CIMZETT NEM MINDENKI, HANEM AKI HASZNALJA.** 2026-09-05-en a verdikt-sorokat negy agens irta;
a hirdetes annak a negynek ment. Egy hatfele kikuldott azonos uzenet ugyanaz a zaj, amit a
tetlen-ornel mar egyszer javitani kellett.

*(Es ez a bekezdes is a sajat targyarol szol: aki ezt olvassa, egy MAR ELAVULT szabalyt is
olvashat, mert a lap a session indulasakor fagyott be. Ha egy itteni allitas ellentmond annak,
amit MOST mersz, a MERES nyer.)*

**ÉS EGY HARMADIK JELENTÉS, AMIT A KONVENCIÓ NEM FED -- A SZÁLLÍTÁS (computress mérte, 2026-09-05,
a marker ELSŐ ütközésén).** A jelölő KÉT dolgot választ szét: kimondott korlát kontra nyitott tétel.
didi egy HARMADIKRA használta:

    "VERDIKT: NYITOTT TETEL -- kizarolag a SZALLITAS"
    es a KOVETKEZO tagmondata:  "A munkaban reszemrol nincs nyitott tetel"

**A szállítás egyik kategóriába sem esik, és a tábla máshol KIMONDOTTAN kizárja blokkolóként:**
*„a `done` = a munka ÉS az ellenőrzése kész, NEM azt jelenti, hogy ki van szállítva"*, és
*„»nincs pusholva« önmagában NEM ok a testingen tartásra"*.

**Ez nem a szerző hibája, hanem a konvenció hézagja** -- a marker jó, a harmadik jelentés nem fér
bele. A feloldás a tábla saját definíciója, nem az ellenőrző ítélete: ha az EGYETLEN nyitott tétel a
merge, az nem nyitott tétel, hanem a `done` definíciójának a kizárt esete.

**A JELÖLŐ HARMADIK ALAKJA EZÉRT NEM KELL. Ami kell: ha a verdikt-sorod a SZÁLLÍTÁSRA hivatkozik,
az `NINCS NYITOTT TETEL` a helyes sor**, és a szállítási állapot fölötte, prózában -- ugyanott,
ahol a kimondott korlátok állnak.

**MIÉRT EZ NEM DETEKTOR, és miért nem esik a ma esti 79/89/93/97%-os hamis pozitív sorba:** egy
detektor PRÓZÁBÓL következtet a jelentésre, és a szavakat mindkét értelemben használjuk. Ez SZERZŐI
JELÖLÉS -- azt írja le, amit a szerző MÁR TUD, ugyanaz az alak, mint a `(card xxxx)` a commit első
sorában, aminek a precizitása mérve 1/1 volt 326 ágon.

**A KIMONDOTT KORLÁTJA, mert enélkül többet ígérne:** a mérő csak azokról a kártyákról tud
jelenteni, amik betartották -- a válasza **PADLÓ, nem halmaz**, ugyanúgy, mint a commit-jelölőnél.
A jelöletlen kártyákat továbbra is el kell olvasni, és a nulla ott „nem mérhető", nem „tiszta".

**VISSZAMENŐLEG NEM SÖPÖRJÜK.** A meglévő kártyákon a verdikt prózában áll; egy minta-alapú
utólagos jelölés pontosan azt a kétértelműséget kódolná be, ami ellen a konvenció szól.

**AMI EBBŐL SZABÁLY: az ellenőrző köre nem a kommenttel ér véget, hanem a STÁTUSSZAL.** Ha a
vizsgálat NEM talált nyitott tételt, a `testing` -> `done` mozgatás UGYANANNAK a mozdulatnak a
része, nem külön lépés. A komment a NYOM, a státusz a MECHANIZMUS -- a dispatcher és a tétlen-őr
a MEZŐT olvassa, nem a prózát.

**ÉS EGY MÁSODIK MOZDULAT, AHOL UGYANEZ INGYEN ELFÉR: AZ ÁTSOROLÁS** (mandark mérte, 2026-09-04;
a koordinátor az egyik elkövető).

Egy kártya NYOLC NAPPAL túlélte a saját javítását (`123becfb`): a fix `08-27`-én landolt a
`main`-en, a kártya nyitva maradt, és **KÉTSZER lett átsorolva a javítás UTÁN** -- marveen ->
friday 09-02, friday -> dexter 09-02. Három ágens ideje egy megoldott tételen.

    a KÁRTYA-STÁTUSZ .... ÁLLAPOT
    a JAVÍTÁS ........... ESEMÉNY
    és az esemény NEM ÍR VISSZA az állapotra

**AZ ÁTSOROLÁS VISZONT EGY PILLANAT, AMIKOR VALAKI ÚGYIS A KÁRTYÁT NÉZI.** Ott egy kérdés ingyen
van: *él-e még ez egyáltalán?* Én kétszer mentem át ezen a ponton és egyszer sem kérdeztem meg.

**ÉS A NAP VÉGÉRE EBBŐL NÉGY LETT, MIND AZ ENYÉM, MIND UGYANAZ (2026-09-04):**

    9ce64b64  Isti valaszolt 08:13, ROGZITETTEM 08:15 „a kartya lezarhato" -> `waiting`-en KILENC ORAT
    fa9f8548  Isti valaszolt 08-31, ROGZITETTEM ugyanaznap -> `waiting`-en NEGY NAPOT, ES kozben
              ISTI ELO DONTESI LISTAJAN allt egy mar megvalaszolt kerdes
    648e492e  a kerdest ELKULDTEM 09-02 10:48 -> es SOHA nem tettem fel a listara
    4a4f118f  a tartast FELOLDOTTAM 09-02 12:35 -> **egy MASIK kartyan** (`5ec57f1d`), es ez a
              kartya azt sosem tudta meg. Harom kartya allt ket napig egy engedelyen, ami megvolt.

**MIND A NÉGYBEN A DÖNTÉS MEGSZÜLETETT ÉS RÖGZÜLT IS -- csak nem ott, ahol a MECHANIZMUS olvassa.**
Kommentben, üzenetben, vagy egy szomszéd kártyán.

**ÉS AMIÉRT EZ SPECIFIKUSAN A KOORDINÁTOR HIBAMÓDJA:** egy kódolónak a döntése COMMITBA kerül --
van egy kihagyhatatlan artefaktum, ami magával viszi. **A koordinátor kimenete MAGA A DÖNTÉS, és
annak nincs természetes artefaktuma.** Egy „igen", egy „ez a tiéd", egy „feloldva" elhangzik, és
attól még sehol nem áll. Ezért kell KIMONDVA mindig megkérdezni: **melyik MEZŐ mozdul ettől, és
melyik kártyán?**

*(A négy nem négy figyelmetlenség. Négy előfordulás egy nap alatt egy embernél nem arány-kérdés,
hanem szerkezet: a szerepnek nincs commitja.)*

**ÉS EGY ÖTÖDIK ALAK, AHOL AZ ARTEFAKTUM LÉTEZETT, ÉS ÉN MÁSIKAT NEVEZTEM MEG** (marveen mérte
magán 2026-09-06; friday találta meg, és hibátlanul dolgozott a rossz mutatóból).

Létrehoztam a marveen-köteg kártyát (`afb2f352`) PONTOSAN azért, mert a másik köteg-kártya
(`3d19e539`) `project=delta-crm`. Aztán egy üzenetben azt írtam a címzettnek, hogy a munkája
*„tomorrow's batch (3d19e539)"*. Ő megmérte, hogy az a kártya nem tud az ágakról (0 és 0,
kontrollal: hét MÁS ágnevet nevez, tehát a mérő lát), és beírta oda -- **a másik repó
köteg-kártyájára.**

    a HIÁNYZÓ mutató ..... KÉRDÉST szül  („hova tegyem?")
    a ROSSZ mutató ....... MUNKÁT szül, JÓ HELYEN VÉGEZVE, ROSSZ HELYRE TÉVE

**A második a drágább, és pontosan a gondos címzettet bünteti:** aki visszakérdez, megmenekül;
aki követi a mutatót, dolgozik, és a munkája máshol landol. A címzett hibátlan volt.

**A PRÓBA, ÉS A MUTATÓ LEÍRÁSAKOR KELL FELTENNI:** amikor egy artefaktumot NEVEZEK MEG (kártya,
fájl, ág, komment), az MELYIK repóhoz/projekthez tartozik -- és ugyanahhoz, mint a munka?
Egy `project` mező lekérdezése két másodperc; a rossz kártyán landolt munka visszavezetése nem az.

**DETEKTORT NE ÉPÍTS RÁ.** mandark kimondta, hogy ez n=1, és egy naiv detektor ide is ott kötne ki,
ahol a mai többi (79/89/93/97% hamis pozitív). A javítás nem mérőeszköz, hanem egy kérdés egy
meglévő mozdulatban -- ugyanaz az alak, mint a köteg-lezárás lépése: nem új ellenőrzés, hanem egy
meglévő pillanat kihasználása.

*(És a lelet mellé mandark a SAJÁT hibáját is kimondta, ami a verdiktet változtatja: először azt
írta, hogy „sosem volt defektus" -- a MAI fát mérte, és a MÚLTRA következtetett belőle. A „nincs
hiba" és a „már javítva" két külön verdikt, és a kártya szerzőjének igaza volt. Két parancs
választja szét: `git log <fájl>` az `origin/main`-en, majd a merge ELŐTTI blob elolvasása.)*

*(didi reggeli alakja egy lépéssel korábbi ugyanerről: egy review-sorbeli CSEND sem ingyenes --
ő korábban megnézte a kártyát, szándékosan nem kommentelt, és a kártya ezért jött vissza újra.
A kettő ugyanaz a törvény két különböző mezőn: a hallgatás és a nem mozdított státusz egyaránt
„van még itt munka"-ként olvasódik.)*

**ÉS EBBŐL KÖVETKEZIK EGY JÓSLAT, AMIT dexter LE IS MÉRT: A ROTHADÁS A TISZTA KIMENETRE SPECIFIKUS.**

    az ellenőrző TALÁL valamit ..... leírja, a lelet MEGSZÜLI a következő lépést -> a kártya MOZDUL
    az ellenőrző NEM talál semmit ... a helyes eredmény az, hogy nincs következő lépés
                                     -> nincs, ami a mezőt magával vinné

Vagyis nem véletlenszerűen ragadnak be kártyák: **pontosan azok, ahol a vizsgálat NEM talált
semmit.** dexter NÉGY kártyán ellenőrizte (a második körében) -- mind a négynek NEM-LELET az utolsó
kommentje, és egyetlen olyan sem volt köztük, ahol a checker talált valamit és mégis ott maradt.

*(A „négy" itt SZÁMÍT, és először HETET írtam ide: összeadtam a két körét, holott a nem-lelet
tulajdonságot csak a MÁSODIK négyen mérte meg. Ugyanaz a minősítő-vesztés, amiről a lap fentebb
szól -- a saját bejegyzésemben, tíz perccel a megírása után. A szám az övé, az összeadás az enyém
volt.)*

**Ez teszi a szabályt DIAGNOSZTIKUSSÁ, nem csak előírássá:** ha egy `testing` kártya utolsó
kommentje egy nem-lelet („nincs nyitott tétel", „minden nulla", „a kifogásom már szállítva"), az a
kártya gyanús -- nem azért, mert valaki hanyag volt, hanem mert épp ott hiányzik a horgony.

**AMIT EZ NEM AD: RÁTÁT.** dexter 24-ből 4-et olvasott el, mind a négy zárható volt -- de ő
VÁLASZTOTTA őket, magas prioritás szerint, tehát torzított merítés. A maradék 20 méretlen, és a
helyes lépés az elolvasásuk, nem a becslésük. Egy gépi „kész-e ez" detektor pedig a sokadik lenne
ma, aminek a találatait a HELYES viselkedés uralja.

**ÉS A SZABÁLY MÁR ITT ÁLLT, BETÖLTVE, AMIKOR EZ TÖRTÉNT.** Nem az ismerete hiányzott: a fenti
mondat („a STÁTUSZ azt mondja meg, VAN-E MÉG ITT MUNKA") minden munkamenet elején betöltődik.
Ezért nem az ismétlése a javítás, hanem a HORGONY megnevezése -- a szerzőnek a commit, az
ellenőrzőnek a nem-lelet.

**ÉS A KÁRTYA CSAK AZT HÚZATJA, AKI MÁR ODANÉZ.** Egy kártya, amin a címzett DOLGOZIK, húzat;
egy kártya, amin épp nem, TÁROL. A pull-mechanizmus nem a kártyában van, hanem az olvasóban --
ha a döntés megváltoztatja, hogy a címzett mit tesz EZUTÁN, a komment a NYOM, és a kézbesítés
továbbra is üzenet.

**A STÁTUSZ-MOZGATÁS SOHA NEM SÖPÖRHETŐ.** Egy kártya-id egy commit-üzenetben NEM azt jelenti,
hogy a commit elvégezte a kártyát -- ugyanaz a NÉV-EGYEZÉS kontra HASZNÁLAT-EGYEZÉS hiba, mint
mindenhol máshol. Kártyánként el kell olvasni, mi történt.
