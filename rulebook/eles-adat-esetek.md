

<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:02 (kartya 2028900e) -->
### ÉLES ÜGYFÉLADAT: OLVASNI SZABAD, HA KELL. ÍRNI CSAK ISTI KÜLÖN SZAVÁVAL
**(Isti kimondott szabálya, 2026-09-17 10:22 CEST. EZ AZ ÉRVÉNYES ALAK.)**

Szó szerint: *„Használhatják az éles adatokat is, de csak ha kell és csak olvasásra ameddig én nem
adok rá külön engedélyt."* és *„Te továbbra is használd az éles adatokat ha kell."*

    MINDEN AGENS ... OLVASHAT eles ugyfeladatot, ha a feladathoz KELL
    IRNI ........... csak Isti KULON, az adott muveletre kimondott engedelyevel
    marveen ........ korlatozas nelkul (olvasas; irasra ra is a fenti all)

*(Ez FELVÁLTJA a 09:17-es, szűkebb alakot -- az „csak deeper, mindenki más teszt fiókkal" volt. A
régi mondat NE maradjon senki fejében: ma már olvasni mindenki olvashat.)*

**AZ ÍRÁS-HATÁR A LÉNYEG, ÉS A KÉRDÉS NEM A CSATORNA, HANEM AZ ADAT:** egy `UPDATE`, egy tömeges
tulajdonos-váltás, egy import és egy „csak egy mezőt javítok" ugyanúgy írás, akár API-n, akár
közvetlen adatbázison megy. **Attól, hogy egy képesség létezik, még nincs engedély a használatára**
(dexter fogalmazta meg 2026-09-17-én, egy kész tömeges végpont előtt, amit nem futtatott le).

**A MIÉRT, MERT EGY SZABÁLY INDOK NÉLKÜL NEM UTAZIK:** mérve 2026-09-17-én, az éles CRM forgalmának
**63,7%-a a saját automatizálásunk** volt (az `isti.marveen@gmail.com` fiók, `node` user-agenttel).
Nem a felhasználók terhelik a rendszert, hanem mi. Kártya: `03995426`.

**AMI EBBŐL KÜLÖN DEFEKTUS, ÉS FÜGGETLENÜL JAVÍTANDÓ:** ugyanez a fiók **211-szer jelentkezett be öt
nap alatt**. Isti szava rá: *„Deeper ne jelentkezzen be negyvenszer, ez valami hiba."*

**ÉS EGY MÉRÉS-CSAPDA, AMI IDE TARTOZIK:** a `detectDuplicates` **ÍR**
(`prisma.duplicatePair.createMany`, `detection.service.ts:1358`). Vagyis a valódi
duplikátum-detektálás **NEM mérőeszköz a production ellen** -- aki azt javasolja, hogy „futtassuk le
és hasonlítsuk össze a számokat", egy ADATVÁLTOZTATÓ műveletet javasol mérésnek öltözve.

**Push és GitHub percek.** Az alapértelmezés: NEM pusholsz. Gyűjtöd a commitokat, és Isti
szól, ha mennie kell. Spórolunk a GitHub Actions percekkel. KIVÉTEL: ha már sok commit
gyűlt össze, rákérdezhetsz, hátha elfelejtett szólni.

**Döntési szabály (kétágú).** Ha Isti érdemben hozzá tud szólni, VÁRD MEG. Ha a kérdés
kódolási vagy technikai megvalósítás, DÖNTSD EL TE a legjobb tudásod vagy az iparági
standard szerint, mert abba nem tud érdemben beleszólni. Utólag mondd el, mit választottál
és miért.

**ÉS A SZABÁLY MÁSIK FELE, AMI EDDIG NEM ÁLLT ITT: AZ ESZKALÁCIÓ CÍMZETTJE TUDJA-E MEGVÁLASZOLNI?**
(dexter mérte magán, 2026-08-28: egy `high` kártya **négy napig** állt két kérdésen, és az első
technikai volt -- „melyik alak nyer" --, tehát olyasmire várt, amire Isti nem tud válaszolni.
A saját szava: *ez az ára annak, ha a rossz felét eszkalálod.*)

**A PRÓBA, MIELŐTT EGY KÁRTYÁT `waiting`-BE TESZEL:** nem az a kérdés, hogy TE el tudod-e dönteni,
hanem hogy A CÍMZETT el tudja-e. Ha a válasz nem, akkor a kártya nem vár, hanem **áll** -- és a
különbség hetekben mérhető.

    technikai / megvalósítási  ->  a szerzőé vagy a koordinátoré, AZONNAL
    termék / üzleti / pénz     ->  Istié
    politika (ki mit tehet)    ->  a koordinátoré
    egy kártyán MINDKETTŐ      ->  bontsd ketté, a technikai fele MEGY

**ÉS A ROUTING-KÖVETKEZTETÉS NEM KÉZBESÍTÉS -- „ez Isti döntése" HÁROM EMBER KOMMENTJÉBEN ÁLLHAT
ÚGY, HOGY SENKI NEM VITTE ELÉ** (didi mérte 2026-09-11, egy `urgent` kártyán, ötnapos élő vaksággal).

    harom ellenorzo, harom HELYES routing-kovetkeztetes ..... „ez termek/penz, tehat Istie"
    aki TENYLEG elvitte ..................................... **senki**, napokig

**Mindhárman helyesen gondolkodtak, és épp ezért állt meg.** A „kié ez a döntés" megválaszolása úgy
érződik, mint a feladat befejezése -- a kérdés meg van válaszolva, a komment megírva, a kör lezárul.
**A KÉZBESÍTÉS viszont egy KÜLÖN mozdulat, és nincs hozzá horgony:** az ellenőrzőnek nincs commitja,
a kártya nem mozdul tőle, és a `waiting` oszlop közben fegyelemnek látszik.

> **Ha egy kommentben leírod, hogy „ez X döntése", ugyanabban a mozdulatban NEVEZD MEG, KI VISZI EL
> HOZZÁ -- vagy vidd el te.** Egy címzett nélküli routing-következtetés nem eszkaláció, hanem egy
> feljegyzés arról, hogy valakinek majd eszkalálnia kellene.

*(A koordinátorra ez élesebb: az eszkaláció Isti felé az ő útja, tehát egy kártyán álló „ez Istié"
gyakorlatilag MINDIG rá mutat -- és pont ezért olvassa át fölötte. A mért eset: nem tudta, mert
soha nem küldte el senki.)*

**ES A BONTAS MASODIK KRITERIUMA NEM A TARGY, HANEM AZ IDOZITES -- HAROM KARTYAT DONTOTT EL EGY
EJSZAKA, HAROM KULONBOZO EMBERNEL** (marveen merte, 2026-09-10/11; mandark, friday es computress
eseteiben egymastol fuggetlenul).

A fenti sor a TARGY szerint bont (technikai kontra Isti dontese). Van egy masodik, es ezt eddig
egyikunk sem mondta ki:

> **Ha egy kartya KET UGYET hordoz, es azoknak KULONBOZO a hataridejuk, akkor az OLCSOBBIK OROKLI
> A LASSABBIK DATUMAT -- es ettol egy egysoros javitas hetekig all egy tole fuggetlen esemenyre
> varva.**

    mandark `1c2ff0a7` .... egy CORS-alapertelmezes csapdaja (olcso, ismetlodo) EGY KARTYAN egy
                            10-06-i trial-lejarattal. A csapda harmadszor harapott, mikozben
                            a kartya „parkolva 10-06-ig" allapotban helyesnek latszott.
    friday `02ba43e7` ..... egy KESZ, inert kod + egy kesobbi jelolo-allitas: kulon kartya,
                            kulon padlo, es a kesz fele tudott landolni.
    computress `5c9aac65` . a 2. lepes KESZ es igazolhato; a 3. lepes Isti identitas-dontesen all,
                            aminek NINCS datuma. Kulon kartya -> a kesz fele LE TUD ZARULNI.

**A PROBA, ES OLVASASKOR TUZEL, nem iraskor:** amikor egy kartyat `waiting`-be teszel VAGY
parkolsz, kerdezd meg, hogy MINDEN rajta allo tetel UGYANARRA VAR-E. Ha nem, akkor nem parkolsz,
hanem **egy gyorsabb tetelt tullaltatsz egy lassabb esemenyen** -- es a `waiting` oszlop kozben
fegyelemnek latszik.

**ES AZ ARULKODO JEL, AMI INGYEN VAN:** ha a kartya cimeben VAGY a parkolasi indoklasban KET
kulonbozo esemeny szerepel („amig a trial le nem jar" ES „a repo alapertelmezese"), az mar a bontas
felteteli. Egy kartya EGY feltetelre var, vagy nem egy kartya.

*(Es amit ez NEM mond: hogy minden tobb-tetelu kartyat bontani kell. Ha a ket tetel UGYANARRA a
pillanatra var, az EGY kartya -- a bontas akkor csak ket helyen tartana ugyanazt a datumot.)*

**ES A HARMADIK ROUTING-HIBA NEM AZ ESZKALACIO IRANYA, HANEM A HIANYZO NEV: HA EGY GYANUS SZAMOT
KETTONEK ADSZ AT, MONDD MEG, KI MERI** (mandark merte a koordinatoron, 2026-09-10).

Isti egy allitasat ("csak ketten jelentkeztek be valaha") atadtam mandarknak es dexternek is,
mindkettonek ugyanabban az alakban: *ez allitas, mérd meg, ne epits ra*. Mindketto helyes
utasitas volt. **Es mindketten LE IS MERTEK, hat percen belul** -- dexter 16:27, mandark 16:29,
kulon proxykkal.

    a HASZON ..... valodi fuggetlen egyetertes, ket kulonbozo merovel. Ez nem semmi.
    az AR ........ egy teljes kor, amit a masodik agens masra kolthetett volna -- epp arra,
                   amit az elso NEM lat

**A javitas egy szo a routingban: NEVEZD MEG, KI MERI.** A masodik cimzett ettol nem lesz
kevesbe fuggetlen; azt kapja meg, hogy MI MARADT nyitva. Es ha a fuggetlen ujrameres KIFEJEZETTEN
a cel (mert a szam draga es egy meronek nem hiszunk), akkor azt MONDD KI -- kulonben az veletlen,
nem terv.

*(mandark sajat hozzatette, es ez a nagyobbik fele: o a meres UTAN olvasta el a kartyat, nem
elotte -- a sajat felvetel-sorrendjet szegte meg, ami elso lepesnek a lefoglalast es a VEGIGOLVASAST
irja elo. A koordinator hibaja a hianyzo nev; az ove a sorrend. A ketto EGYUTT termelte a duplikatumot,
es barmelyik egyedul megfogta volna.)*

**ÉS A MÉRT KÖVETKEZMÉNY, hogy ez ne elvi legyen** (marveen mérte, ugyanaznap 14:0x): a `waiting`
oszlop 91 kártya, ebből **51 nem mozdult 2+ napja**, és a legutolsó kommentjében **67-nek (73%)**
van döntés-jelzője. Gazda szerint: **39 áll MARVEENEN**, abból **20 négy napnál régebben**.

Vagyis a `waiting` oszlop nem várakozó munka, hanem **egy ember döntési sora** -- és a legrégebbi
nyolcból hat az enyém. Ez nem a csapat kapacitás-problémája; a koordinátoré.

**ES EZ AZ UTOLSO MONDAT MA MAR HAMIS -- UGYANAZ A MERO, NAGYOBB POPULACIO** (marveen merte
2026-09-10 20:0x, jarvis 20:00-as auditjanak szamara; a ket mero FUGGETLEN es ugyanazt adta: 152).

    08-28:  91 waiting, ebbol marveen 39  = **43%**
    09-10: 152 waiting (>48h), ebbol      dexter 47 | **marveen 45 (30%)** | mandark 22 |
           Isti 12 | computress 10 | jarvis 8 | friday 5 | didi 3

**A total 67%-kal nott, az EN aranyom viszont ESETT.** A novekedes tehat NEM a koordinator sora,
es aki a fenti mondatot idezi, a rossz harmadra celoz. A sajat 45-om kor szerint: 2-4 nap **0**,
4-7 nap 26, 7+ nap 19.

**A KIMONDOTT MERO-KORLAT, ami a nullat is megmagyarazza: a `>48h` az `updated_at`-et nezi, es azt
egy KOMMENT is mozditja.** Amire ma ratettem egy kommentet, az kiesett az ablakbol -- tehat a
`2-4 nap 0` NEM azt jelenti, hogy nem erkezik uj dontes. A `waiting>48h` az ERINTETLENT meri, nem
a BLOKKOLTAT, es a ketto nem ugyanaz a kerdes.

**ES A 12 ISTIN MAS KATEGORIA: azokat nem lehet "leduplazni"** -- termek- es uzleti dontesek, az
eszkalacios szabaly szerint az ove. Egy flotta-backlog szamba beleszamolva rosszabbnak mutatja a
csapatot, es felhivja valakit, hogy "segitsen".

**AMI MA ESTE SZANDEKOSAN NEM TORTENT MEG: senki nem olvasta el mind a 152 kartyat egyenkent.**
Az valodi munka, nem egy heartbeat-kor melleklete, es rosszul elvegezve pontosan azt a
kulcsszo-cenzus-verdiktet termelne, amit ez a flotta mar nyolcszor eldobott (lasd „A MERO ES A
SZANDEK KOZTI RES" 7. torvenye fentebb). Ha ez megtortenik, sajat kartyat kapjon, gazdaval --
nem egy audit-kor mellektermeke.

**EGY MERT PELDANY A MECHANIZMUSBOL, AMI A 152 EGY RESZET MAGYARAZHATJA** (marveen, ugyanabban a
korben): a `6c55d676` `waiting` volt EGY SAJAT, datum nelkuli feltetelen ("amig a jelolo-munka
nem landol"). A lap sajat torvenye szerint egy datum nelkuli feltetel SOHA nem valik hamissa, ha
az esemeny nem kovetkezik be -- es az oszlop eközben fegyelemnek latszik. Most `PICKABLE WHEN` +
09-17-es padlot kapott. Egy kartya, de ez a MINTA: ha a 152 erdemi resze padlo nelkuli feltetel,
nem triazs kell, hanem KONVENCIO (minden `waiting`-be tett kartya kapjon padlot is, ne csak
feltetelt).

*(A regi mondat -- „a waiting oszlop egy ember dontesi sora, a koordinatore" -- a MAGA
pillanataban igaz volt, mert adaton. Nem torolve: a tanulsag, hogy egy arany-alapu allitas
honapokkal kesobb megfordulhat anelkul, hogy barki hazudott volna, onmagaban is idetartozik.)*

**Minőség hosszú távra.** Isti NEM a legegyszerűbb megoldást kéri, hanem amelyik hosszú
távon a legjobb. Ha egy feladat emiatt tovább tart, az rendben van, csak szólj.

**Teszt = az egyetlen védvonal.** Nincs monitoring és nincs riasztás. Ha elrontasz valamit
és nem veszed észre, és nincs rá teszt, Isti CSAK AKKOR szerez róla tudomást, amikor már
nem működik. Ezért a teszt nem szorgalmi feladat.

**Részletesség.** Rövidebben, mint egy hosszú jelentés, de Isti tudni akarja mi történik.
Ne csak "kész" legyen, de ne is minden lépés.

**Időzítés.** Nincs tiltott napszak, bármikor írhatsz. Ha nem alkalmas, egyszerűen nem
nézi meg.

**Éjszakai munka: NEM kell rá engedélyt kérni (Isti, 2026-08-18).** Szó szerint: „az éjjeli
munkára ne kelljen engedélyt adnom. Nyugodtan dolgozzatok mindig éjjel is. Főleg Dexter és
Didi, nekik nagyon sok feladatuk van és éjjel dolgozhatnak nyugodtan, nem zavarom őket."
Ez ÁLLANDÓ felhatalmazás, nem egyszeri. Amit viszont **nem** old fel: a felügyelet nélküli
rendszerműveletek szabályait (`felugyelet-nelkuli-rendszermuvelet` skill), és azt a
mérlegelést, hogy egy több napos munkát félbehagyva rosszabb-e, mint el sem kezdve. Az
éjszakai engedély a MUNKÁRA szól, nem a kockázatvállalásra.

**A keret kihasználása kötelezettség, nem lehetőség (Isti, 2026-08-20 reggel).** Szó szerint:
„ha van limit, főleg ennyi, akkor ilyen nem fordulhat elő. Dolgozni kell, főleg ilyen kapacitás
mellett." Az eset, amiből jött: az 5 órás keret 22%-on állt, mert az egyik ágens **három órája
tétlen volt** — a session futott, a sora üres volt, és nem vettem észre, mert egész éjjel a
másik ágenssel dolgoztam.

Ez nem jószándék-kérdés, mert egyszer már felírtam és mégis megismétlődött. Ezért mérés:
**minden heartbeat-körben ellenőrizni kell, melyik ágens PANELJE áll üresen.**
Aki üres prompton áll (nincs futó jelző, nincs várakozó üzenet a sorában), az tétlen — annak
azonnal munkát kell adni, nem a következő körben. A parancsok a `claude-limit-monitoring`
skillben állnak.

*(Javítva 2026-08-22, Isti engedélyével, két mért eset után. Eredetileg az „utolsó megszólalás
60 percnél régebben" volt a feltétel. Az a JELENTÉST méri, nem a MUNKÁT: egy ágens, aki
végigcsinál egy 22 perces fordulót kártya-kommentekkel és commitokkal, de nem küld inter-agent
üzenetet, órákig „némának" látszik. Mérve 08-22-én kétszer — 06:02-kor és 08:38-kor is dolgozó
ágenst mutatott tétlennek, és a hiba iránya állandó. Az ára nem nulla: egy ébresztő egy dolgozó
ágensnek megszakítja azt a fordulót, amiért felébresztettük volna. A panel-alapú mérés viszont
már megvolt — a tétlen-őr ezt használja (`paneIsIdle()` + 12 perces küszöb), és aznap reggel
hatszor ébresztett, mindegyik valódi tétlenség. A szabály nem rossz volt, hanem KORÁBBI: akkor
született, amikor még nem volt panel-alapú őrünk. Kártya: 5c40b225.)*
