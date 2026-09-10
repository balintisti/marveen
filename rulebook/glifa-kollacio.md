# A locale-kollácó csapdája: a pipa és a kereszt egyenlőnek számít

Ez 2026-09-10-ig a `CLAUDE.md`-ben állt. A TÁBLÁZAT (mely eszköz törött, melyik biztonságos) és
a javítás a lapon MARADT; itt a mérések, a három megdöntött tengely-jelölt és a homoglif-cenzus
tanulsága áll.

**MIKOR OLVASD EL:** ha teszt-kimenetet parszolsz, ha egy (eszköz, művelet) pár viselkedését
kell tudnod, vagy ha homoglif-cenzust futtatnál magyar szövegen.

*(A szakasz fejléce két soros volt, és az első vágásom csak a fejlécet vitte el -- a törzs a
lapon maradt egy árva folytatás-fejléc alatt. A szerkezet-ellenőrzés fogta meg, nem a
darabszám: a `##` szám stimmelt, a MÉRET nem.)*

---

## (didi talalta, dexter reprodukalta es kiterjesztette, marveen ujramerte -- 2026-09-05)

Ezen a gepen (BSD awk 20200816, `LANG=hu_HU.UTF-8`) a sztring-EGYENLOSEG locale szerint rendez, es
a jest ket allapot-glifaja EGYENLONEK jon ki:

    awk 'BEGIN{print ("✕"=="✓")}'            ->  **1**
    LC_ALL=C awk 'BEGIN{print ("✕"=="✓")}'   ->  0

**ES NEM GLIFA-PROBLEMA: a korulotte allo szoveget is tulei.** Egy teljes `    ✓ my test` sor
EGYENLONEK szamit ugyanannak a tesztnek a BUKO sorával. Vagyis egy ATMENT es egy ELBUKOTT teszt
megkulonboztethetetlen ezeknek az eszkozoknek.

    TOROTT ...  `awk ==`  |  `sort -u` (2 sor -> 1)  |  `uniq` (2 sor -> 1)
                `uniq -c` (1 csoport 2 helyett -- ES **"2"-t ir az ATMENT sor melle**)
                `uniq -d` (a ✓ es a ✕ sort egymas duplikatumakent jelenti)
                `comm -12` (KOZOSNEK mondja oket)  |  `join` (osszejoinolja oket)
                **`comm -3` -- a legcsendesebb: azt mondja, NINCS eltero sor**
    BIZTONSAGOS  `grep` / `grep -E` / `sed` / awk REGEX-illesztes  |  `[ = ]`
                 bash es zsh `[[ == ]]` es `[[ < ]]`  |  `python3`  |  **`diff`**  |  `cmp`
                 `grep -Fxf` (a halmaz-tagsagi idiom -- a legvaloszinubb kivetel, mert
                 EGYENLOSEG-alaku, es MERVE mégis all)

**A `comm` HIANYA A LISTABOL KONKRET ARBA KERULT VOLNA** (dexter fogalmazta meg): aki ket
teszt-kimenetet `comm`-mal vet ossze, elolvassa ezt a szakaszt, NEM talalja a `comm`-ot a torott
listaban, es tovabbmegy. A `comm -3` ezutan azt mondja neki, hogy a ket futas AZONOS.

**A HIBA IRANYA MINDKET ESZKOZBEN A MEGNYUGTATO:** a ternary a BUKOTT tesztet atmentkent olvassa,
a `sort -u` pedig UGYANANNAK a tesztnek a ket allapot-sorat vonja ossze EGY folyamon belul
(2 sor -> 1), **es a `✓` sor az, ami tulel** -- a megnyugtato fele. **Semmi nem nez ki rosszul.**

**A `diff` NEM ERINTETT, es ez a mondat 15:0x-ig HIBASAN allt itt** (dexter merte es javitotta,
a sajat megfogalmazasabol eredt): azt irtam, hogy egy ket futast osszevető diff tisztan johet
vissza. **Nem johet.** Merve: nyers diff ket futason, egy teszt `✓`->`✕` -> KULONBOZIK; es
`sort -u` mindket oldalon ELOSZOR, majd diff -> szinten KULONBOZIK. Nem sikerult olyan esetet
epiteni, amiben a diff hamisan tisztat mond.
**A valodi veszely szukebb: ha a diff BEMENETET dedupoltad `sort -u`-val, akkor mar a dedupolt
szemetet hasonlitja ossze.** A `diff` maga biztonsagos; ami elotte all, nem feltetlenul.

*(A hibas mondat eredete dexter uzenetenek egy tagmondata volt -- "a diff of two runs can come
back clean while they differ" --, aminek a MINOSITOJE ("ha eloszor sort -u-val dedupealsz")
nem elte tul az atirast. Ugyanaz az alak, amit ez a lap kulon nevesit, most a lap SAJAT
szovegeben. Es a mondat egy CIRILL `о`-t is tartalmazott (U+043E) -- epp a
karakterkodolasrol szolo szakaszban --, tehat egy `grep osszeveto` SOHA nem talalta volna meg.
Kontroll: ugyanennek a szakasznak a masik `osszevetes` szava tiszta ASCII.)*

**ES A TENGELY, AMI KEZENFEKVO ES HAMIS: NEM az "EGYENLOSEG torott, REGEX jo" a szabaly**
(dexter vonta vissza a sajat megfogalmazasat, 2026-09-05, didi `á`/`b` parjaval cafolva).

**HAROM TENGELY-JELOLT, HAROM CAFOLAT -- ES EGYIK SEM JOSOL. A TABLA A VALASZ, NEM EGY SZABALY.**

    1. "regex jo, EGYENLOSEG es RENDEZES nem"  -> cafolva: a bash `[[ == ]]` egyenloseg, es BAJT
    2. "MINDEN ESZKOZ onmagaban konzisztens"   -> cafolva UGYANAZZAL AZ EGY BINARISSAL:
           awk ("✕"=="✓")            hu_HU **1** | C 0     KOLLACIO
           awk ("á"<"b")             hu_HU **1** | C 0     KOLLACIO
           awk /[a-b]/ az `á` soron  hu_HU **0** | C 0     BAJT
           awk /✓/ a `✕` soron       hu_HU **0** | C 0     BAJT
           KONTROLL: /[a-b]/ az `a` soron 1|1, /✓/ a `✓` soron 1|1, ("a"=="a") 1|1
    3. "a tengely az OPERATOR-OSZTALY"         -> cafolva: a bash es zsh `[[ == ]]` ES `[[ < ]]`
                                                 MINDKETTO osszehasonlito operator, es MINDKET
                                                 locale-ban BAJT

**A HARMAT UGYANAZ A MOZDULAT TERMELTE: a tengelyt arrol nevezni el, amit epp megmertunk.** Es a
masodik cafolatahoz NEM KELLETT UJ MERES -- a lap MAR HORDOZTA mindket felet (`awk ==` a torott,
`awk /regex/` a biztonsagos listan). Csak egyutt kellett elolvasni a ket sort.

**AMI EBBOL SZABALY, ES SZANDEKOSAN KEVESBE KIELEGITO EGY TENGELYNEL:**

> A viselkedes **(ESZKOZ, MUVELET) PARONKENT** ismerendo. A fenti tabla MERT parokat sorol.
> **Egy uj par MERENDO, nem KOVETKEZTETENDO** -- semmilyen eddigi tengely nem josolja meg.

**ES EGY HOMOGLIF-CENZUS TANULSAGA UGYANEBBOL A SZAKASZBOL, KETSZERES ONREFERENCIAVAL**
(didi merte 2026-09-05, marveen sajat scannelese utan).

marveen lefuttatott egy kodpont-scannt EBBEN a szakaszban, es TALALT egy cirill `о`-t. **Helyesen
talalta meg** -- csak epp az a SZANDEKOS MINTAPELDANY volt, a rola szolo mondat belsejeben. Torolte,
majd visszaallitotta. **Kozben a VALODI defektus ezer sorral arrebb bent maradt:**

    :1095  `о` (U+043E) -- backtickek kozott, a mondatban, ami NEVESITI  ->  SPECIMEN, marad
    :2878  `növekedési kerетté` -- KET cirill betu EGY magyar szo BELSEJEBEN  ->  DEFEKTUS

    grep -c 'keretté'    -> **0**   a szabaly a SAJAT szavaval nem talalhato meg
    grep -c 'növekedési' -> 1       KONTROLL: a sor maga elerheto

**KET HIBA EGYMAS UTAN, es a masodik a tanulsagos:** (a) a mero HATOKORE egy SZAKASZ volt, tehat a
2878. sort szerkezetileg nem lathatta; (b) **az elso talalat UGY NEZETT KI, MINT A VALASZ, es ezzel
megallitotta a lista elolvasasat.** A scan kimenete LISTA, nem TALALAT.

**A DISZKRIMINATOR, ami mindkettot egyszerre oldja meg, es egy mezo:** a talalat mellett add ki, hogy
LATIN BETU-e a szomszedja. Merve, a teljes lapon (5969 sor, 3 talalat):

    :1095  latin-szomszed = FALSE  -> izolalt, idezojelben  -> SPECIMEN
    :2878  latin-szomszed = TRUE   -> szo belsejeben        -> DEFEKTUS  (2x)
    KONTROLL: 22898 nem-ASCII karakter a fajlban, tehat a mero nem vak

**ES A DISZKRIMINATOR ELSUL A SAJAT DOKUMENTACIOJAN -- 2/11 HAMIS POZITIV EPP EBBEN A SZAKASZBAN**
(didi merte, percekkel a fenti bekezdes megirasa utan).

Ez a szakasz IDEZI a defektust (`növekedési kerетté`), tehat a lapon ALL egy cirill betu egy magyar
szo belsejeben -- SZANDEKOSAN. A fenti szabaly szerint az DEFEKTUS:

    :1095  a specimen (backtickek kozott) ..... latin-szomszed FALSE  -> helyesen osztalyoz
    :1148  didi hat karakteres listaja ........ latin-szomszed FALSE  -> helyesen osztalyoz
    :1132  a SZO SZERINT IDEZETT defektus ..... latin-szomszed TRUE   -> **HAMIS POZITIV**, 2x

**EGY "rossz karakter egy szo belsejeben" DETEKTOR SZERKEZETILEG NEM TUDJA MEGKULONBOZTETNI A
DEFEKTUST ATTOL, HOGY A DEFEKTUST DOKUMENTALJAK** -- es ez a lap KONSTRUKCIOBOL tele lesz a
masodikkal. Aki ilyet futtat, az IDEZETT peldakat vegye ki (kerites, idezojel, vagy nevesitett
sorszam-lista), es a kivetelt MONDJA KI, mert kulonben a kovetkezo kor a sajat magyarazatunkat
jelenti leletnek -- pontosan az az alak, amit ez a lap kulon szakaszban tilt.

**ES A KONTROLL-SZAM IS ELAVULT, MIELOTT A TINTA MEGSZARADT:** a "pontosan EGY cirill maradt"
IGAZ VOLT, amikor lefuttattam. Aztan MEGIRTAM EZT A SZAKASZT, es a szakasz MEGVALTOZTATTA azt a
populaciot, amit a kontroll megmert -- ma 11 talalat, es hetet EZ a szoveg hozott.

    a kontroll a MERES utan futott, de az ARTEFAKTUM megirasa ELOTT
    -> egy kontroll, ami egy MEG NEM KESZ artefaktumot validal, a keszrol nem allit semmit

*(didi kimondott hatara ehhez: hat script-csaladra scannelt unicodedata nev-elotag alapjan;
a LATIN-blokkon BELULI osszetevesztheto karakterek kivul maradnak, tehat a 11 is PADLO --
csak sokkal kevesbe lyukas, mint a hat karakteres lista.)*

*(didi kimondott hatara: o HAT cirill homoglifra scannelt (о а е с р х); gorog es egyeb
osszetevesztheto karakterek nem fedettek, tehat a ketto PADLO, nem a szam. A fenti teljes-lapos
alak `unicodedata.name`-bol dolgozik, tehat a CIRILL/GOROG/ARMENIAN/FULLWIDTH csaladot egyben fedi --
de az sem teljes.)*

*(Kimondott hatar, didi-e: a "nincs josolo tengely" HAROM ELLENPELDAN all, nem bizonyitason.
Meretlen a collation-tabla, a hu_HU es C-n kivuli locale-ok, es a gawk -- nincs telepitve.)*

*(A mechanizmus, amiert mindharom tengely idaig eljutott, es ez a hordozhato resz: a szerzo a
tengelyt azokrol a MUVELETEKROL nevezte el, amiket veletlenul kiprobalt, nem a MECHANIZMUSROL --
es minden adatpontjara illett. Harom helyesbites erkezett ehhez a szakaszhoz, mindharom UGYANATTOL
a szerzotol, es mindharom a sajat OSSZEFOGLALOJARA vonatkozott, nem a meresere: a `diff`-mondat, ez
a tengely, es a lenti orvossag. A meres vegig jo volt; a rola szolo mondat volt egy lepessel tul tag.)*

**A JAVITAS, KET SZINTEN:**

    azonnali ....... `LC_ALL=C` -- **DE A CSOVEZETEK EGESZE ELE, NEM EGY PARANCS ELE**

                     A `VAR=ertek parancs` elotag EGY parancsra hat. Egy csoben a tobbi tag
                     az OROKOLT locale-ban marad -- es a csaladbol epp az `uniq` az, amelyik
                     INFORMACIOT SEMMISIT MEG. Merve (didi, 2026-09-05, kartya `dd2c1b2b`):

                         LC_ALL=C sort f | uniq            ->  **1 sor**  a buko sor MEG MINDIG elvesz
                         LC_ALL=C bash -c "sort f | uniq"  ->  2 sor      helyes
                         KONTROLL: ket valoban kulonbozo ASCII sor -> 2 MINDKET alakkal

                     **A fel-javitas KESZ javitasnak nez ki**, es pontosan azt a megnyugtato
                     iranyt tartja meg, amirol ez a szakasz szol.

                     **MIKOR ELEG MEGIS a prefix, hogy a javitas ne tulcelozzon** (dexter merte):

                         EGY parancs ...  `LC_ALL=C sort -u f`  ->  2   **ELEG**
                         CSOVEZETEK ....  minden kollacio-hasznalo fokozatra kell,
                                          VAGY `export`, VAGY az egeszet
                                          `LC_ALL=C bash -c "..."`-be zarva
                             `LC_ALL=C sort f | LC_ALL=C uniq`      -> 2  helyes
                             `bash -c "export LC_ALL=C; sort|uniq"` -> 2  helyes

                     **ES A `sort f | LC_ALL=C uniq` ALAK NEM CSAK GYENGE -- ROSSZABB VALASZT
                     AD, MINT A JAVITATLAN** (didi merte, 2026-09-05). Bemenet:
                     `✓ test one` / `✕ test one` / `✓ test one`, a helyes valasz **2**:

                         teljesen hu_HU  sort | uniq ........ 1   (a defektus)
                         sort | LC_ALL=C uniq ............... **3**  ROSSZ, es MASFELE rossz
                         LC_ALL=C bash -c "sort | uniq" ..... 2   helyes

                     **A MECHANIZMUS, ES EZ AZ, AMI A "TELJES CSOVEZETEK" SZABALYT INDOKKA TESZI:**
                     a kollacio nem csak az OSSZEHASONLITAST rontja el, hanem a `sort` CSOPORTOSITASAT
                     is. hu_HU alatt a harom sor kollacio-szerint EGYENLO, tehat a sort megtartja a
                     bemeneti sorrendet: `✓ | ✕ | ✓` -- a kereszt BEEKELODIK a ket azonos pipa koze.
                     A `uniq` csak SZOMSZEDOS sorokat von ossze, tehat ha a rendezes mar szetvalasztotta
                     a ket bajt-azonos sort, egy lentebbi C-locale `uniq` MAR NEM TUDJA helyrehozni.

                     Enelkul a "tedd az egesz csovezetek ele" babonanak olvasodik, es a kovetkezo
                     olvaso visszarovidíti az olcso alakra.

    helyes ......... `jest --json`, es a parser ALLITSA, hogy a vart szamu eredmenyt megtalalta --
                     enelkul egy torott olvaso SEMMIT ad vissza, es a semmi ugy olvasodik,
                     hogy "nincs bukas" (didi alakja)

**ES EZ MIERT KERULT A LAPRA, NEM EGY EMLEKBE:** eddig ket agens memoriajaban elt, es a kovetkezo
ember, aki teszt-kimenetet parszol, egyiket sem fogja elolvasni. Ez a lap minden munkamenet elejen
betoltodik -- egy meresi higienia-szabaly ide valo.

*(A koordinator sajat, epp futo allitasa ATMENT az ujrameresen, es ezt dexter kifejezetten kerte:
a "3 buko suite / 15 teszt = az origin/main alapvonala" osszevetes `grep`-bol es `diff`-bol keszult,
nem `awk`-bol vagy `sort -u`-bol. **A modszer donti el, hogy az allitas ellenorizheto-e**, nem az,
hogy igaz-e -- es a kulonbseg ket perc volt.)*

**ES A SZABALY A KOVETETT SZKRIPTEKRE MERVE FELESLEGES -- A KITETTSEG A ELDOBHATO EGYSOROSBAN VAN**
(didi merte, 2026-09-05, kartya `dd2c1b2b`; a hatokor-dontes marveene).

    kovetett kod ....... 88 fajl, 9 jelolt, 5 hamis pozitiv (a magyar "sort" szo), **4 valodi**
                         -- ketto numerikus kulcson, ketto csak-ASCII bemeneten -> NULLA kitettseg
                         KONTROLL: a mero 25 fajlban lat `echo`-t parancs-pozicioban
    bemeneti oldal ..... 0 nem-ASCII utnev 1023-bol (marveen) es 3746-bol (Delta-CRM), a kontroll tuzel
                         7 csupa-ASCII par (irasjel, szokoz, kis/nagybetu) NEM esik ossze hu_HU alatt,
                         a pipa/kereszt par IGEN -- pozitiv kontroll UGYANAZON a merőn

**Vagyis a kovetett fa tiszta, es egy kovetett szkriptekre celzott szabaly a populacio URES felere
celozna.** Ahol a hiba tenylegesen tortent -- es ahol ujra fog --, az az ELDOBHATO egysoros, amit
barmelyikunk begepel egy Bash-hivasba egy fordulon belul. Azt egy cenzus SZERKEZETILEG nem latja.

**Ezert nem detektor es nem lint-szabaly a valasz, hanem ez a bekezdes:** a szabaly a MERES
pillanataban kell hasson, es a meres nem fajlban el.

*(Rendezes, amit dexter kifejezetten nyitva hagyott, szinten eldolt: a `sort` KOLLACIO szerint
rendez, a bash `[[ < ]]` BAJT szerint MINDKET locale-ban -- merve egy paron, aminek a bajt- es a
kollacio-sorrendje eltér, plusz egy kontroll-paron, ahol egyezik.)*

*(NEM MERVE: a collation-tabla bejegyzese; mas locale-ok a hu_HU es a C mellett; a gawk viselkedese
-- nincs telepitve.)*
