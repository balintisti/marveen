# Időkezelés -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.
A lapon a TÖRVÉNY, a PARANCS és a teherhordó mondatok maradtak; itt áll a szakasz TELJES,
bontás előtti szövege, szó szerint. Semmi nem lett átfogalmazva, tehát ha a magban valami
hiányzónak tűnik, ITT megvan.)*

**MIÉRT A TELJES SZÖVEG, ÉS NEM CSAK A KIVETT RÉSZEK:** az `assert-then-delete` sorrend azt kívánja,
hogy a törlés ELŐTT bizonyítható legyen, hogy minden megérkezett. Ha az archívum a TELJES eredetit
tartalmazza, ez az állítás triviálisan igaz, és nem múlik azon, hogy a bontó jól válogatott-e.

---

## Időkezelés

MINDIG a megfelelő lokális időt használd (Europe/Budapest CEST/CET).

**DE A GEP NEM EZT MONDJA, ES HAROM HELYEN HAROM AZONOSITO ALL** (didi merte 2026-09-05 a
`39151cd4` ellenorzesekor, marveen fuggetlenul ujramerte a futo folyamaton):

    ez a LAP ................................ `Europe/Budapest`
    friday PINJE (a teszt-keszletben) ....... `process.env.TZ = 'Europe/Budapest'`
    a FUTO FOLYAMAT ......................... **`Europe/Belgrade`**
        (`Intl.DateTimeFormat().resolvedOptions().timeZone`; a `TZ` env NINCS beallitva,
         a `SCHEDULER_TZ` 0 a `.env`-ben ES 0 a `config-overrides.json`-ban
         -- kontroll: a `.env` 11 kulcsot hordoz, tehat a mero lat)

**MA EZ NULLA KULONBSEGET JELENT, ES EZT MERTUK, NEM FELTETELEZTUK:** didi het probapontban vetette
ossze, MINDKET DST-atmenetet is beleertve -- mindenhol azonos (kontroll: Budapest kontra Tokio
ELTER, tehat a mero tud kulonbseget mondani).

**DE A ZONA-KULONBSEG NEM AZ EGYETLEN TENGELY, ES A DRAGABBIK A NAPTARI NAP: EZ A GEP ES A CI
KULONBOZO DATUMON ALLNAK ESTE 22:00 ES EJFEL KOZOTT** (dexter merte 2026-09-12 00:2x, kartya
`f83b9c33`; marveen fuggetlenul ujramerte 22:30Z-kor).

    ugyanabban a pillanatban:  Europe/Belgrade **2026-09-12**  |  UTC **2026-09-11**
                               Asia/Tokyo      2026-09-12      |  America/New_York 2026-09-11

**Es ettol egy DATUM-VETETT fixture MAS ERTEKET kap helyben, mint a CI-ban -- ugyanazon a
commiton.** A mert eset: egy `getByDisplayValue(/14/)` laza regex KET elemre illeszkedett, amikor a
"mai nap minusz 90" kezdodatum epp 14-ere esett. Helyben BUKOTT, a CI-ban ATMENT, es a naiv olvasat
az volt, hogy "a CI hazudik". **Nem hazudott: mas naptari napon allt.** A CI sajat datuma ejfel
UTC-kor atfordult volna, es ugyanaz a teszt ott is elbukik -- 14 ismetlodes a kovetkezo 400 napban.

**A PROBA, MIELOTT EGY HELYI/CI ELTERESBOL LELETET IRSZ:** vesd ossze a KET NAPTARI DATUMOT, ne csak
a zonat. Ha elternek, a kulonbseg MAGYARAZHATJA az eltero eredmenyt, es a hibakereses elso lepese egy
ZONA-CSERES futas -- nem a CI hibaztatasa.

**ES A HELYETTESITO ZONA NEM "BARMELYIK HOLNAPI" -- A FALI ORANAK IS EGYEZNIE KELL** (dexter merte
2026-09-12 00:3x, MINDKET iranyban lefuttatva, es ezzel megdontotte marveen elso, pontatlan
eloirasat, ami 00:31-tol allt itt). Egy DATUM-vetett teszt nem tudja megkulonboztetni oket; egy
NAPSZAK-bol vetett igen:

    Asia/Tokyo      helyi 2026-09-12 **07:30**   = "UTC holnap 07:30Z" -- MAS pillanat
    Europe/Belgrade helyi 2026-09-12 **00:30**   = "UTC holnap 00:30Z" -- EZ az, amit a CI lat

Mert ar: a teljes keszlet Belgradban ZOLD (625 fajl, 9156 atment), Tokioban **1 fajl / 5 teszt
PIROS** -- egy VALODI, de a CI utjan NEM levo hiba (a `groupTasksByDay` +5:30-tol felfele bukik;
-4 / 0 / +1 / +2 zold). Aki Tokioval "szimulal", olyan pirosat kap, amit a CI SOHA nem termel, es
azt fogja kergetni.

> **A helyes helyettesito az a zona, amelynek a HELYI ORAJA MOST azt mutatja, amit a CI oraja fog
> mutatni AKKOR.** CEST-ben (+2) este 22:00 es ejfel UTC kozott ez maga a sajat gepunk: a helyi
> ora mar a holnapi UTC hajnalt mutatja.

```bash
python3 -c "import datetime,zoneinfo as z;print(datetime.datetime.now(z.ZoneInfo('UTC')).date(), datetime.datetime.now().date())"
# ha a ket datum ELTER, minden datum-vetett teszt KET kulonbozo vilagban fut
```

**ES A HORDOZHATO RESZ NEM A ZONA, HANEM A SORREND:** a CI itt IGAZAT mondott es MEGIS elteret adott,
tehat a "melyik kornyezet hazudik" kerdes rossz volt. Mindketto igazat mondott, kulonbozo napokrol.

### ES A MASODIK TENGELY UGYANEBBEN A CSALADBAN: EGY UTC-IDOBELYEGET HELYIKENT OLVASNI
### (marveen merte magan 2026-09-12, egy CI-vizsgalat kozben, ket percre)

A fenti eset a NAPTARI NAPROL szol. Ez az EGYSZERU fele, es epp ezert siklik at: a GitHub
`check-runs` API **UTC-ben** adja a `started_at`/`completed_at` mezot. Helyi idokent olvasva:

    a job `started_at` 06:39:17 (UTC) ... helyinek olvasva: „**2 ora 34 perce fut**" -> BEAKADT RUNNER
    a valodi ertek ...................... **34 perc**, teljesen normalis

**A HIBA IRANYA A RIASZTO, es ez a ritkabb, veszelyesebb fajta:** egy beakadt CI-job TOKELETESEN
HIHETO, tehat senki nem szamolja ujra -- es a kovetkezteteshez („a runner elszallt, indits ujra")
tartozik egy MUVELET, ami elviszi a bizonyitekot.

**A KET INGYENES KONTROLL, es egyik sem igenyel uj forrast:**

    1. a ZONA a valaszban BENNE VAN: a mezo `Z`-re vegzodik. Ha `Z`-t latsz, ne vond ki a helyi orabol.
    2. vesd ossze egy MAR ISMERT idotartammal: az elozo futas UGYANEZT a jobot 39,0 perc alatt
       futtatta le SIKERESEN -- egy „2,5 oras" ertek tehat MAR ONMAGABAN ellentmondas

**A SZABALY: ha egy CI-idobelyeget IDEZEL vagy szamolsz belole, vidd vele a ZONAT, vagy valtsd at.**
Ugyanaz az alak, mint a nevezo nelkuli szam: a mero helyes, a KERDES, amire valaszol, mas.

**ES A LAP AZ, AMI KOZELIT, NEM A GEP.** Isti Magyarkanizsan el, Szerbiaban -- tehat a
`Europe/Belgrade` a pontosabb azonosito, a `Europe/Budapest` ezen a lapon oroklott egyszerusites.

**AMIERT MEGIS ALL A SOR:** a ket zona MA azonos, es a lap celja az, hogy senki ne UTC-ben
gondolkodjon. Erre a `Europe/Budapest` ugyanolyan jo. Amit NEM szabad belole olvasni: hogy a
rendszer ezt az azonositot HASZNALJA.

**A MECHANIZMUS, AMI EZT VESZELYESSE TEHETI, es ezert all itt: MAGYARORSZAG EU-TAG, SZERBIA NEM.**
Ma mindketto ugyanazt a DST-naptart koveti; ha az EU valaha megszunteti az oraatallitast, a ket
zona SZETVALIK, es akkor egy teszt-keszlet, ami `Budapest`-et pinel, egy `Belgrade`-en futo
rendszert allit -- ket ora eltereessel evente ket alkalommal, es semmi nem szol.

**UJRANYITASI FELTETEL (GATE, nem WATCH):** ha valaki a `SCHEDULER_TZ`-t BEALLITJA, az erteke
EGYEZZEN a teszt-pinnel. Ma egyik sincs beallitva, tehat nincs mit osszevetni -- es epp ezert nem
tuzel semmi. A dontesi pont a beallitas pillanata:

```bash
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"   # amit a futo fa hasznal
grep -c '^SCHEDULER_TZ=' .env                                             # 0 = oroklott, nem kimondott
```

### ES A HELYI `.env` NEM A FUTO SZOLGALTATAS KONFIGJA -- EGY PERMISSION-VALTOZON MERVE ELTERNEK
(didi merte 2026-09-10, kartya `2138aceb`; marveen a gazda.)

A fenti recept HELYES: a `.env`-et olvassa, es arra a kerdesre, hogy MI VAN KIMONDVA NALUNK,
igazat mond. A csapda az, ha ugyanezt a fajlt egy VISELKEDES- vagy JOGOSULTSAG-kerdesre hasznaljuk.

    helyi `.env` ................. SUPER_ADMIN_EMAILS = **1** tetel   (kontroll: 42 kulcs)
    futo Cloud Run szolgaltatas .. SUPER_ADMIN_EMAILS = **2** tetel   (kontroll: 36 kulcs)

Ugyanaz a valtozo, ket ertek, es a helyi fajl HIBA NELKUL ad egy hihető szamot -- egy MASIK
peldanyrol. Ez ugyanaz az alak, mint a `develop` kontra a FUTO FA: nem hamis a mero, csak nem az
a peldany, amirol a kerdes szol.

**A MEGKULONBOZTETO, es ezert nem eleg annyi, hogy „mindig a szolgaltatast kerdezd":** az
ADATBAZIS-hoz es az URL-hez a helyi `.env` HELYES (ugyanoda mutat, ezert all a naptar- es a
watch-receptben). A JOGOSULTSAGHOZ es a VISELKEDESHEZ nem az.

    „mi az adatbazis / az URL?" .......... a helyi `.env` JO
    „ki a super admin / mit enged?" ...... a FUTO peldanyt kerdezd, kulonben mas gep valaszol

**KIMONDOTT HATAR, didi szavaival, es ne simitsd el:** ez NEM allitja, hogy barmelyik ertek rossz;
azt sem merte meg, hogy MAS kulcsok elternek-e; es **ha egy valtozo titok-hivatkozaskent van
bekotve, az erteke ezen az uton NEM LATSZIK -- amit tilos nullanak olvasni.** A mai kovetkeztetes
mindket ertekre ugyanaz volt (0 teszt-domain), tehat ez most nem kerult semmibe. Ez alkalommal.


- **Jelenlegi idő**: `date` Bash első lépés időponti feladatoknál (heartbeat, naptár-művelet, scheduled-task analízis)

**ÉS A `date` KÖZVETLENÜL AZ IDŐPONT LEÍRÁSA ELŐTT FUSSON, KÜLÖN TOOL-HÍVÁSBAN**
*(Hat mért eset, három ágensnél, a visszavonásokkal: `rulebook/atadott-meres.md`.)*

Nekünk NINCS óránk: a fordulók között nem telik számunkra idő. Ami a kör elején lefutott, azt a
kör végén már BECSÜLNÖD kell, és az nem pontatlan leolvasás, hanem TALÁLGATÁS. Mérve: egy ágens
egyetlen `date` után `+3, +8, +24, +42, +68, +83, +98, +108, +117` perccel csúszott el, és az
irány ÁLLANDÓ: mindig későbbre, sosem korábbra.

**HÁROM ÚT UGYANODA, MINDHÁRMAT MAGUNKON MÉRTÜK:**

    egyszer futtatod, aztán becsülsz ........ a sodródás monoton nő
    minden blokkban futtatod, és KOMPENZÁLSZ  „mire ez kimegy, később lesz" -- 21 fejlécből 21
                                              pozitív eltérés. **A KOMPENZÁCIÓ a hiba.**
    `date && cat > "$f" <<'EOF'` EGY hívásban a heredoc AKKOR születik, amikor a `date` kimenete
                                              MÉG NEM LÁTSZIK. Formailag betartva, gyakorlatilag
                                              becslés. Külön hívásban ez fizikailag lehetetlen.

**A HELYES IRÁNY NEGATÍV.** Ha a fejléc a MÉRÉS idejét mondja, a komment szükségszerűen KÉSŐBB
landol, tehát a szerver időbélyegéhez képest az eltérés negatív. **Egy POZITÍV eltérés mindig azt
jelenti, hogy valaki a jövőbe írt** -- vagy becsült, vagy kompenzált.

**HA A `date` NEM FUTOTT LE: TARTOMÁNY, ne kitalált perc** (`18:2x`). Egy kimondottan
hozzávetőleges időpont őszinte; egy kitalált pontos perc nem az.

**MIÉRT NEM KOZMETIKAI:** egy kártyán az időbélyeg BIZONYÍTÉK. Ha két ágens percre egymás mellett
mér ugyanarra, függetlenül, akkor egy előre csúsztatott fejléc úgy olvasódik, mintha a második a
másik eredményének ISMERETÉBEN írta volna. Nem a pontosság vész el, hanem a FÜGGETLENSÉG -- és
pont az volt az érték.

**ÉS EZ NEM AZ IDŐPONTOK SAJÁTOSSÁGA: MINDEN MÉRT SZÁMRA ÁLL.** Egy commit-üzenetbe `344 fájl /
4605 teszt` került; a valódi szám azon az ágon `342 / 4596`, mert az üzenetet UGYANABBAN a
lépésben írták, amiben a készletet futtatták. **Ami csak a hívás UTÁN létezik, az nem állhat a
hívásBAN.**

**A KIMENET MAGA IS ÁLLHAT ROSSZ POPULÁCIÓN.** Egy bontás a HOZZÁFŰZÉS ELŐTTI szerkezetet
számolta, a totál a LESZÁLLÍTOTT fájlt: két szám egy mondatban, két populációról. A szerző
betartotta a szabályt (a kimenetből másolt) -- csak a kimenet volt rossz populáción számolva.
**Számold a LESZÁLLÍTOTT artefaktumot, ne a szerkezetet, amiből építetted.**
Az INGYENES kontroll: **add össze a bontást.** 244+72+5+1 = 322 egy 323-as totál mellett,
ugyanabban a bekezdésben. Hárman nem futtattuk le.

**ÉS A SZÁM ÁTJUT A MÁSOLÁSON, A MINŐSÍTŐ NEM.** Négy eset egy napon, három ágensnél: a szám
mindenhol HELYES volt, a CÍMKE veszett el vagy volt hamis (kinek a sora, milyen egység, SORT vagy
TÉTELT számol a mérő, melyik fa). Egy helyes szám hamis címkével nem gyengébb állítás, hanem MÁS.

    a minősítő ELVESZIK az átíráskor ... a SAJÁT kimenetedből esik ki a SAJÁT prózádba
    a minősítő HAMIS a forrásnál ....... hűségesen átmásolod, és ezzel FELERŐSÍTED

Az első a veszélyesebb, mert nálad keletkezik és nálad is javítható. Aki egy KAPOTT számot ad
tovább, kérdezze meg, MIT SZÁMOLT a mérő -- ne azt, hogy helyes-e a szám.

**A SZABÁLY: bármely MÉRT szám (teszt-darabszám, fedettség, sor, commit-hash) KÜLÖN lépésben
szülessen, mint a szöveg, ami idézi, és a kimenetből MÁSOLD, ne emlékezetből írd.** Egy
commit-üzenetnél ez különösen drága: a force-push nálunk tiltott alak, tehát a hibás szám
VÉGLEGESEN a történelem része lesz, és a helyesbítés csak a kártyán tud állni.

### HÁROM MÉRÉSI VAKFOLT, AMI MAGYAR SZÖVEGEN NÉMA NULLÁT AD

**1. AZ ÉKEZET ÉS A KIS/NAGYBETŰ MINDKÉT IRÁNYBAN VAK, ÉS EGYIK SEM AD HIBÁT.** Egy ékezetes minta
nem látja a `Nincs projekt`-et; egy ASCII minta nem látja az `AZ ELŐFELTÉTEL`-t; egy `A MEGNEVEZETT`
nem látja az `a MEGNEVEZETT`-et. Mind a három NULLÁT ad, nem hibát. **Az irányuk viszont különböző
költségű:** az ékezet-alapú alulmérés a KÉNYELMES irányba téved (kevesebb munka, senki nem kérdez
rá), az ASCII-grep hamis nullája a RIASZTÓ irányba (azonnal újraméred). Ezért az elsőt egy hét
múlva más ember szeme fogja meg, a másodikat percek alatt magad.
**A próba: futtasd le az ELLENKEZŐ alakkal is, és nézd meg, a két szám együtt értelmes-e.**
Mérve: egy ékezet-alapú mérő minden NEGYEDIK egyszavas címkét elveszít (25,2%), a mondatokat
gyakorlatilag mind megtalálja (9+ szó: 0%) -- tehát épp a CÍMKÉKEN a leggyengébb, és egy
i18n-söprés címkékre vadászik.

**ES 2026-09-11-EN UGYANEZ A TENGELY A KONTROLLON FOGOTT MEG MINKET, HARMADSZOR AZNAP -- ES A
KONTROLL AZ, AMIT SENKI NEM VIZSGAL** (didi merte, sajat cimkejet javitva; marveen ugyanabba futott
percekkel kesobb).

Ugyanaz a szo, ugyanaz a fa, HAROM meres, egyik sem hibas:

    didi ....... `grep -ci 'kartya'`  ->  **18**   SOR, kis/nagybetu-FUGGETLEN
    valodi elofordulas ..............  **24**   (a `-c` SORT szamol, nem talalatot)
    friday ..... kis/nagybetu-ERZEKENY, csak kisbetus  ->  **15**
                 (kimarad 6 NAGYBETUS `KARTYA` -- epp a hibauzenet kiabalo resze -- es 2 ekezetes `kártya`)

**Mindharom szamot ugyanazzal a szoval cimkeztuk.** Barmelyik ketto osszevetve ELTERESNEK latszik,
amit valakinek fel kell oldania; es barmelyik ONMAGABAN idezve „a" szamnak.

**AMIERT A KONTROLLON VESZELYESEBB, MINT A LELETEN:** a leletnel az ember tudja, hogy allit valamit,
es a lap kerte a masik alakot is. A kontroll viszont „csak" azt bizonyitja, hogy a mero nem vak --
alacsony tetnek erzodik, tehat senki nem nezi meg a cimkejet. Kozben pontosan ugyanaz a nema-nulla
csalad: egy kis/nagybetu-erzekeny kontroll ATMEHET olyan fan, ahol a keresett dolog nagybetuvel all,
es akkor a „nem vak" allitas maga bizonyitatlan.

**A KET SZABALY, ES MINDKETTO EGY SZO:**

    1. a kontroll cimkeje mondja meg, MIT szamol: SORT vagy TALALATOT (`grep -c` SORT)
    2. es hogy kis/nagybetu- es ekezet-ERZEKENY-e -- a `-i` legyen KIIRVA, ne felteteлezve

*(Es a mai eset konkluzioja NEM mozdult egyik meronel sem: a LELET a nullak voltak (`tartozas`,
`TAROL`, `amint a sor urul`), es azok MINDHAROM meroval, mindket esetben 0-t adnak. A cimke volt
rossz, nem a verdikt -- es epp ezert nem vette eszre senki.)*

**2. NEM MINDEN KORLÁTOT KIMONDANI KELL -- EGY RÉSZÜKET BE KELL ZÁRNI.** A próba mechanikus:
a korlát a MEGNEVEZETT POPULÁCIÓN KÍVÜL van, vagy BELÜL? KÍVÜL -> valódi hatókör-állítás, MONDD KI.
BELÜL -> nem caveat, hanem a megnevezett dolog meg nem vizsgált részhalmaza, **ZÁRD BE**.
„0 duplikátum 512 specben, kivéve azokat a részeket az 512-ből, amiket nem néztem meg" NEM szűkebb
állítás: ugyanaz az állítás, lyukkal. **A „kimondott határ" szokása a legkönnyebb mód arra, hogy
egy gyenge mérést becsületesen le lehessen szállítani.**

**3. A HOMÁLYOS SZÓ NEM A MÉRÉSBEN JELENIK MEG, HANEM AMIKOR A MÉRÉSBŐL SZABÁLYT ÍRSZ MÁSNAK.**
A mérés precíz; a belőle írt szabály lesz homályos („legyen egy RÖVID, BIZTOSAN illeszkedő
kontroll"). A próba a szabály MEGÍRÁSAKOR: *kell-e majd az ALKALMAZÓNAK olyan ítéletet hoznia,
amit én nem tudok helyette meghozni?* És ha igen: **ő ÉPP A HIBA BELSEJÉBEN lesz, amikor meghozza.**
Ez a lap egy SZABÁLYKÖNYV, tehát ez a lépés itt állandóan meg fog történni.

*(A három teljes esete -- a 25,2%-os szóhossz-eloszlás, mandark 512 specje, a `populacion` kontra
`A MEGNEVEZETT` kontroll-lecke -- `rulebook/meresi-vakfoltok.md`. 15 638 karakter volt itt.)*



<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:19 (kartya 2028900e) -->
## Időkezelés
*(A mért esetek TELJES szövege -- a hét próbapont, a Tokió-mérés, a CI-idobelyeg esete, a `.env`
permission-mérés és a sodródás-sorozat -- `rulebook/idokezeles-esetek.md`. 15 211 karakter volt itt.)*

MINDIG a megfelelő lokális időt használd. **DE A GÉP NEM A LAPOT MONDJA:** a lap
`Europe/Budapest`-et ír, a FUTÓ FOLYAMAT `Europe/Belgrade`-et (`Intl.DateTimeFormat()`;
a `TZ` nincs beállítva, a `SCHEDULER_TZ` 0 a `.env`-ben ÉS a `config-overrides.json`-ban).

**MA EZ NULLA KÜLÖNBSÉG, ÉS EZ MÉRVE VAN** (didi hét próbaponton, mindkét DST-átmenettel;
kontroll: Budapest kontra Tokió ELTÉR, tehát a mérő tud különbséget mondani). Isti Magyarkanizsán
él, Szerbiában -- a `Belgrade` a pontosabb azonosító, a `Budapest` örökölt egyszerűsítés. **Amit
NEM szabad belőle olvasni: hogy a rendszer ezt az azonosítót HASZNÁLJA.**

**A MECHANIZMUS, AMI EZT VESZÉLYESSÉ TEHETI: MAGYARORSZÁG EU-TAG, SZERBIA NEM.** Ma ugyanazt a
DST-naptárt követik; ha az EU megszünteti az óraátállítást, a két zóna SZÉTVÁLIK, és egy
`Budapest`-et pinelő teszt-készlet egy `Belgrade`-en futó rendszert állít -- két óra eltéréssel,
évente kétszer, és semmi nem szól.

**ÚJRANYITÁSI FELTÉTEL (GATE, nem WATCH):** ha valaki a `SCHEDULER_TZ`-t BEÁLLÍTJA, az értéke
EGYEZZEN a teszt-pinnel. Ma egyik sincs beállítva, tehát nincs mit összevetni -- és épp ezért nem
tüzel semmi. A döntési pont a beállítás pillanata:

```bash
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"   # amit a futo fa hasznal
grep -c '^SCHEDULER_TZ=' .env                                             # 0 = oroklott, nem kimondott
```
