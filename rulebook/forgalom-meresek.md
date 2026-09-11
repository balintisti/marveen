# Forgalom-meresek -- az ot datumozott ujrameres, teljes tablazatokkal

Ez a fajl a `CLAUDE.md` „Szemelyiseg" szakaszabol kiszervezett BIZONYITEK-anyag: az agens-forgalom
darabszam- es hossz-meresei 2026-08-28 es 2026-09-11 kozott, agensenkenti bontassal, a
visszavonasokkal es a kimondott korlatokkal egyutt.

**A TORVENY NEM ITT VAN, HANEM A `CLAUDE.md`-BEN.** Ha ellentmondast latsz, a lap az ervenyes, es
ez a fajl az elavult -- ide nem ir vissza senki, amikor a lapon javit.

**ES A LEGFONTOSABB, AMIT EZ A FAJL EGYBEN MUTAT: MINDEN EGYES MERES MEGDONTOTTE AZ ELOZOT, ES
VEGUL A DIAGNOZIS MAGA IS MEGDOLT.** A sorrend onmagaban tanulsag -- egy arany-alapu allitas
honapokkal kesobb megfordulhat anelkul, hogy barki hazudott volna.

Kiszervezve: 2026-09-11, kartya `ed1c9734` (Isti kerte: keret-fajdalom).
A kiszervezes modszere: minden ITT ALLO sor a lapon ALLT, es az assert a torles ELOTT futott le.

---


## Személyiség

**AZ INTER-AGENT ÜZENETEK NYELVE ANGOL, ÉS EZ MÉRT DÖNTÉS, NEM STÍLUS.** 24 órás mérés:

    ágensek egymás közti üzenetei .... 1664 db / 3,4 M karakter  (~959 e token)
    kártya-kommentek ................. 1128 db / 3,2 M karakter  (~911 e token)
    amit marveen Istinek küldött ..... 34 db  /  62 e karakter   (~18 e token)

A magyar ~25-33%-kal több tokent használ ugyanarra a tartalomra. Az ágens-forgalmon ez napi

alapértelmezés, nem mérés. Ha kiderül, hogy ritkán, ez újranyitható -- a komment a legnagyobb
egyetlen tétel a listán.)*

amíg újra nem indul. Egy hosszú komment nem egyszer kerül pénzbe, hanem húszszor.
Amit össze lehet nyomni veszteség nélkül: a NYUGTÁZÁS (elismerés, megerősítés, "jól csináltad, és

Három gyakorlati következmény, mindegyik mérhető:

3. **A kártya-komment ne ismételje meg az üzenetet.** Ma mindkettőbe ugyanaz került; a komment
   a NYOM (mérés, parancs, határ), az üzenet a DÖNTÉS. Két különböző dolog, két különböző hossz.

*(A nevező, amiért ez megéri: a kártya-komment átlaga ~800 token és minden későbbi fordulóban
újraolvasódik. A koordinátor 2026-08-28 hajnalban 3 óra alatt 127 081 karaktert küldött 7
címzettnek -- ennek jelentős része nyugtázás volt.)*

### ÉS A DIAGNÓZIS ROSSZ VOLT: NEM A HOSSZ, A DARABSZÁM (Isti kérése, marveen mérte, 2026-08-28)

Isti kérte, hogy ez törvény legyen. Előtte megmértem magamon, és a saját állításom dőlt meg:
azt mondtam neki, hogy „ma én küldtem a leghosszabb leveleket a flottában".

    küldő        darab   összes karakter   átlag
    marveen        227           460 617    2 029
    computress      75           175 941    2 345
    dexter          76           175 565    2 310
    mandark         30            68 938    2 297
    jarvis          57            76 087    1 334
    ÖSSZESEN       561         1 085 902     (~271 e token, EGY napon, csak üzenetre)

**Az ÁTLAGOM a mezőny alsó felében van. Amiben kiugrok, az a DARABSZÁM: háromszor annyi üzenet,
mint bárkié, a teljes forgalom 42%-a.** (Kártya-kommentben ugyanez: 86 komment, és ott az átlagom
a LEGKISEBB, 1 899.)

**Ez megváltoztatja a javítást.** „Írj rövidebben" keveset ér, mert nem a hossz a kiugró.
„Írj kevesebbszer" sokat ér.

**A HÁROM MECHANIKUS SZABÁLY, nem szándék** (Isti kikötésével: csak amíg a munka minősége nem romlik):

1. **Nyugtázó üzenet nem megy.** Ha nincs eldöntendő, a válasz a csend. *(Ez fent is áll; itt
   azért ismétlem, mert a mérés szerint ez a legnagyobb tétel.)*
2. **Ami nem változtat azon, hogy a címzett MIT TESZ, az kártyára megy, nem levélbe.** A kártya
   nem áll sorba, és nem olvasódik újra minden fordulóban.
3. **Amit egyszer leírtam egy kártyára, azt nem ismétlem meg üzenetben.** Hivatkozás elég.

**ES A SZABALY UJRAMERVE, EGY HET MULVA, MAGAMON: NEM HATOTT** (marveen merte 2026-09-03 08:35).

    2026-08-28 (a szabaly szuletesekor)  marveen 227 db,  a forgalom 42%-a
    2026-09-03 06:00-08:35               marveen  93 db,  a forgalom 45%-a

**A sajat lezarasom szerint ilyenkor A SZABALY a hibas, nem az igyekezet** -- ez itt all fentebb, es
most a sajat merese dontotte meg. Az "irj kevesebbszer" ALAK-szabaly, mechanizmus nelkul, es egy
ilyet a dontes pillanataban nem olvas senki.

**AMI VISZONT HATOTT, ES MECHANIKUS: a SOR-KAPU.** A 3+ pending eseten a helper MEGTAGADJA a kuldest,
es ma otszor tuzelt -- mind az otszor kartya-komment lett belole, pontosan ugy, ahogy a szabaly
kivanja. Nem emlekezni kellett ra: a parancs nem ment el.

    "irj kevesebbszer" (szandek) ......... nem valtoztatott a darabszamon, ket meres kozott

**A KOVETKEZTETES NEM AZ, HOGY SZIGORUBB SZANDEK KELL.** Az, hogy a darabszam-szabalynak is
mechanizmus kell, vagy nem szabaly. A sor-kapu ma csak akkor tuzel, ha a CIMZETT torlodik -- a
kuldo sajat darabszamara nincs kapu. Egy ilyen (pl. "ugyanannak az agensnek a harmadik uzenet egy
oran belul kartyara terul") meg nem letezik, es amig nem letezik, ez a szakasz egy szandekot ir le.

*(Kimondva, mert a szam onmagaban tobbet allitana: a 93-bol a tulnyomó tobbseg DONTES, ROUTING vagy
HELYESBITES volt -- olyan tartalom, amit a lap kifejezetten NEM nyirbal. A 45% tehat nem
bizonyitottan felesleges forgalom. Amit bizonyit: a szabaly, ahogy meg van fogalmazva, NEM MERHETO
-- nincs benne olyan kuszob, ami mellett meg lehetne mondani, hogy betartottam-e.)*

**ES 2026-09-06, TELJES NAPRA: AZ ARANY JAVULT, A KONCENTRACIO NEM -- ES A KETTOT KULON KELL MERNI**
(marveen merte magan, este):

    marveen 185 uzenet / 466 361 karakter   -- a flotta 903 uzenetebol **20,5%**
    (08-28: 42% | 09-03: 45% | 09-04: 14% egy szuk ablakon | ma: 20,5% EGESZ NAPRA)
    DE: ebbol **48 uzenet / 126 773 karakter EGYETLEN cimzettnek** (friday)

**A darabszam-arany tehat feleződött a 08-28-as alapvonalhoz kepest, a KONCENTRACIO viszont uj
tengely, amit egyik korabbi meres sem nezett.** Negyvennyolc uzenet EGY embernek egy nap alatt
akkor is sok, ha mindegyik dontes volt -- es ma tulnyomoreszt az volt (rulingot kert, en adtam).

**AMI BEHATAROLTA, ES NEM A SZANDEK: A SOR-KAPU. Ma OTSZOR tuzelt ugyanarra a cimzettre**, es
mind az otszor KARTYA-KOMMENT lett a levelbol -- ugyanaz a mechanizmus, ami 09-03-an is az egyetlen
mukodo fek volt. **A kapu a CIMZETT torlodasat nezi; a kuldo sajat darabszamara tovabbra sincs kapu**,
tehat az elso ket uzenetet semmi nem allitja meg.

*(Es amit ez a szam NEM bizonyit: hogy a 48-bol barmelyik felesleges lett volna. A tobbsege kert
ruling vagy hatokor-dontes. Amit bizonyit: hogy egy cimzettre iranyulo koncentraciot egyik eddigi
meresunk sem nezte, es a kapu az egyetlen, ami hat ra.)*

**ES 2026-09-04-EN A SZAM ELOSZOR MOZDULT -- AZONOS ABLAKON MERVE, MERT KULONBEN NEM ALLITAS**
(marveen merte magan; a ket korabbi meres ablaka 06:00-08:35 volt, tehat ugyanazt hasznaltam):

    08-28 06:00-08:35   marveen  75 / 167 osszes = **44%**
    09-03 06:00-08:35   marveen  92 / 207 osszes = **44%**
    09-04 06:00-08:35   marveen  20 / 136 osszes = **14%**

Abszolutban 75 es 92 helyett **20** -- nem csak az arany esett, a DARABSZAM is, harmadara.

**ES A KIMONDOTT KORLAT, ami nelkul ez tobbet allitana, mint amennyit mer: az AZONOS ABLAK NEM
AZONOS MUNKA.** 09-04 delelott egy koteg osszeallitasa es szallitasa ment, ami termeszetenel fogva
keves uzenetet kivan (merj, olvassz, pusholj); a masik ket reggel koordinacio-nehez volt. A szam
tehat MOZDULT, de hogy a SZABALY mozditotta-e vagy a MUNKA JELLEGE, azt ez a meres nem donti el.

A helyes ujramerese egy koordinacio-nehez reggel ugyanezen az ablakon. Amig az nincs meg, ez
BIZTATO ADAT, nem bizonyitek -- es pont az a kulonbseg, amit a lap mindenhol maskor is ker.

**AZ ELLENŐRZÉS, mert enélkül ez is szándék marad:** a fenti lekérdezés bármikor újrafuttatható
(`agent_messages`, `LENGTH(content)`, `from_agent` szerint). Ha a darabszámom holnap nem esik,
a szabály nem hatott -- és akkor a szabály a hibás, nem az igyekezet.

### ES 2026-09-11-EN A DIAGNOZIS MAGA DOLT MEG: MA MAR MINDKET TENGELY NO (friday merte, marveen kerte)

A fenti szakasz cime azt allitja, hogy **nem a hossz, a darabszam** -- es ez a mondat azota JELEN
IDOBEN all itt. friday ugyanazzal a meroval ujramerte, 24 oras ablakon:

    fleet-atlag uzenetenkent ... 1935 -> **2515** karakter   **+30%**
    uzenet-darabszam ........... 561  -> **833**             **+48%**
    ossz-karakter .............. 1,086 M -> **2,095 M**      **+93%**

    marveen 2029 -> 2739 (+35%) | computress 2345 -> 2816 (+20%)
    mandark 2297 -> 2610 (+14%) | dexter 2310 -> 2468 (+7%)
    jarvis  1334 -> 604 (-55%)  <- az EGYETLEN, aki lefele mozdult
    friday  2700 (a felso felben, es o maga mondta ki, hogy nem kivulallo ebben a szamban)

**Vagyis a „darabszam-szabalynak mechanizmus kell" kovetkeztetes tovabbra is all, de az INDOKA
elavult: ma egy CSAK a darabszamra epitett kapu nem is a teljes dologra celozna.**

**ES A KAPU, AMIT EBBOL LEVEZETTUNK, MERVE FAL LETT VOLNA.** A koordinator kerte a kuldo-oldali
sor-kaput (3. uzenet ugyanannak egy oran belul -> kartyara). friday a VALODI forgalmon szimulalta,
mielott megepitette volna:

**ES NINCS OLYAN N, AMI SZETVALASZT, mert NINCS TAIL:** hanyadik uzenet ugyanannak egy oran belul
-- 1: 102, 2: 123, 3: 120, 4: 119, 5: 125, 6: 92, 7: 52, 8: 40. **Egytol hatig LAPOS.** Nincs
kuszob, ami folott pazarlas es alatta munka; barmelyik N aranyosan vag bele mindenbe, a
dontesekbe is.

A hossz-korlat ugyanigy hal meg: a leghosszabb 5% a karakterek 8,5%-at viszi, egy 4000-es korlat a
levelek 4,8%-at erinti es a mennyiseg **0,7%-at** sporolja; egy 2000-es a 76,5%-ot -- megint fal.

**AMI EBBOL A DONTES LETT (marveen, 2026-09-11): N=7 / 1 ora MEGEPUL, de NEM waste-szurokent,
hanem KEZBESITESI PLAFONKENT.** Az indoklas tulel a laposságon: a 8. level egy oran belul nem
azert rossz, mert gyenge, hanem mert oda mar nem fer be figyelem. **Es a kapu melle ki van mondva,
hogy ez NEM a keret-kerdes valasza** -- ~62 e token a ~524 e-bol.

**ES A VALODI OK VALOSZINULEG EGYIK TENGELY SEM, hanem a FORMA** (friday megfigyelese, kimondottan
NEM meres, es o maga nem oltoztette annak): 834 uzenet mind ~2,5 e karakteren nem szoras, hanem
**HAZI STILUS**. Ha egy haromsoros ruling 2,5 e karakterbe kerul, akkor nem azert, mert annyi kell
hozza. Erre semmilyen kuszob nem cel -- es a javasolt mechanikus proba nem osztalyozo, hanem
strukturalis jelolo (`DONTES:` az elso soron, ahogy a `VERDIKT:` konvencio mukodik). Meg NINCS
bevezetve: eloszor a koordinator probalja ki magan, mert a mai meres szerint o a legnagyobb tetel.

*(Es amiert ez a bekezdes itt all, nem egy kartyan: a fenti szakasz egy MEROT ir elo, es a mero
INDOKA avult el. Aki csak a cimet olvassa -- „nem a hossz, a darabszam" --, ma egy 08-28-i allitasra
epitene. Pontosan az az alak, amit ez a lap mashol otször rogzit.)*
