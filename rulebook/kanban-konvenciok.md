# A kanban-tábla konvenciói: a mért esetek

Ez 2026-09-10-ig a `CLAUDE.md` „Kanban tábla -- a hívások és a KÖTELEZŐ mezők" szakaszának a
második fele volt. Az API-HÍVÁSOK és a KÖTELEZŐ MEZŐK a lapon MARADTAK; itt a konvenciók mért
esetei állnak.

**MIKOR OLVASD EL:** ha egy konvenciót MEG AKARSZ VÁLTOZTATNI, ha egy kártya-címről vagy
fokozatról vitád van, vagy ha nem érted, miért pont az az alak. A napi kártya-kezeléshez a lapon
álló összefoglaló elég.

---

### Mit jelent a `done` (Marveen döntése, 2026-08-19)

**`done` = a munka ÉS az ellenőrzése kész. NEM azt jelenti, hogy ki van szállítva.**

**ÉS EBBŐL KÖVETKEZIK EGY HATÁR, AMIT 2026-08-22-ig nem mondtunk ki: a `done` NEM jelenti, hogy
RÁ LEHET ÉPÍTENI.** Ha egy kártya egy `done` kártya EREDMÉNYÉT HASZNÁLJA (nem csak követi
sorrendben, hanem hívja, importálja, kiterjeszti), akkor neki nem a kész munka kell, hanem a
KISZÁLLÍTOTT munka -- és a kettő között a táblán NINCS MEZŐ.

Mért eset (Dexter, 2026-08-22, függetlenül ellenőrizve): a `b07ae6c9` `done`-on állt, helyesen.
A ráépülő `a576f4f7` viszont elvégezhetetlen volt, mert a cél-forma (a `html`/`raw`/`url` címke
és a szerkezeti őr) CSAK a `b07ae6c9` commitján létezik -- a `main`-en, a `develop`-on és a
kódoló ágens munkaágán nincs ott, és a beolvasztás nem történt meg. Mindkét folytatás rossz lett
volna: vagy egy MÁSODIK másolat ugyanabból a biztonsági primitívből, vagy építés egy be nem
olvasztott kötegre.

**A gyakorlati szabály:** amikor egy kártya egy másik kártya eredményére épül, a függőség
kimondásakor írd oda, hogy MIRE van szükség -- a kész munkára vagy a szállításra. Ha a
szállításra, akkor az a kártya addig `waiting`, és a blokkoló NEM a másik kártya, hanem a MERGE.
A merge Isti döntése, tehát ilyenkor a döntési sorba is bekerül.

**Miért nem elég a `done` átdefiniálása:** a szállítás továbbra is kötegelt esemény, és az
eredeti indok (ne írjuk le ugyanazt a tényt harminchatszor) változatlanul áll. Nem a `done`
rossz -- a FÜGGŐSÉG leírása volt hiányos.

**ÉS EGY HARMADIK RÉTEG, UGYANAZ A HÉZAG (2026-08-22 délután, didi mérte, dexter fogalmazta meg):
a „javítva" nem mondja meg, MELYIK ÁGON.** Egy `testing`-en álló kártya alatt egy ellenőrző
javítatlan fájlt talált: a javítás commitja EGYETLEN külön ágon állt, 84 commit távolságra attól az
ágtól, ahol a csapat aznap minden más munkája volt. A kártya azt a képet adta, hogy kész.

**A megfogalmazás, ami mindhármat összefogja (dexter):** *a kártya-állapot egy IDŐPONTOT ad, a
repó-állapot viszont egy HELYET. A „javítva" két kérdésre kéne válaszoljon -- MIKOR és HOL --, és
eddig csak az elsőre válaszolt.*

**ÉS A „HOL" MAGA IS KÉTFÉLE, MERT A SORSZÁM ÁGFÜGGŐ** (három független eset 2026-08-27-én:
mandark `:102`/`:103`, dexter `:1116`/`:1115`, és egy `db.ts:1822`, ami `getChildCards`-ra
mutatott).

Egy kártyára írt `fájl:sor` hivatkozás **két okból is rossz helyre mutathat**, és a kettő nem
ugyanaz:

    IDŐBEN elavul   -- a fájl azóta változott (a `db.ts:1822` esete, öt nap alatt)
    ÁGANKÉNT ELTÉR  -- UGYANAZ a nap, ugyanaz a kód, MÁS ág, más sorszám

A második az alattomosabb, mert nem kopás: a hivatkozás a szerző ágán PONTOS volt, és az olvasó
ágán mutat máshova -- ott pedig **létező, de más kódra** (mandark esetében egy `.catch()` naplózó
blokkra, ami nem is írás). Az olvasó nem hibát lát, hanem egy értelmes sort, ami nem az.

**A szabály: a horgony legyen ÁGFÜGGETLEN.** A függvénynév, a metódus neve, vagy maga az ALAK (a
három soros `updateMany` blokk) -- a sorszám mellé, nem helyette. A sorszám kényelmes, és jó is
marad addig, amíg valaki ugyanazon az ágon áll.

**ES EGY HARMADIK HORGONY-ALAK, AMI SZALLITASNAK OLVASSA A NEM-SZALLITAST: A FAJL BASENEVE**
(didi merte 2026-09-05, mandark sajat, ERŐSEBBNEK szant horgonyan; marveen ujramerte).

mandark egy be nem olvasztott commit bizonyitekakent ezt adta meg: *"a `locale-parity.guard.test.ts`
NEM LETEZIK a main-en"* -- 09-04-en IGAZ volt. Ma, BASENEVRE keresve **1 talalat**, tehat aki az O
SAJAT horgonyat futtatja ujra, magabiztos "leszallitva"-t kap.

    src/__tests__/locale-parity.guard.test.ts .......... blob e3f60bd0   main **0**  <- a d76e3609-e
    src/styles/__tests__/locale-parity.guard.test.ts ... blob 41318156   main **1**  <- MAS commitbol

**Ket KULONBOZO fajl, azonos basenevvel, a masodik egy masik commitbol (`8cfacf7f`).** A `d76e3609`
tovabbra sincs kiszallitva -- amit a TARTALOM-oldali horgony helyesen meg is mond.

    a SORSZAM ..... idoben avul, es agankent elter          (a fenti ket alak)
    a BASENEV ..... **egy azonos nevu, MASIK fajl ugy nez ki, mint a szallitas**

**Es az irany a kenyelmes:** a hamis talalat azt mondja, KESZ -- tehat senki nem keres tovabb.
Egy hiany legalabb munkat general.

**ES A TUKORKEPE, UGYANEZEN A NAPON, MASIK AGENSTOL: A BASENEV HAMIS NEGATIVOT IS AD, ES AZ
NEM TUNIK FEL** (computress merte 2026-09-06, jarvis meresen; marveen ujramerte).

A fenti eset a hamis POZITIV: egy AZONOS NEVU, MASIK fajl ugy nez ki, mint a szallitas. Van egy
ellentetes iranyu alakja, es az DRAGABB.

Egy kartya ezt a fajlt kereste, es a valasz "nem portolhato, ujra kell irni" lett:

    CustomFieldInput.protected.test.tsx ....... `origin/fix/e9292631-protected-field-ui`
      -> `isAdmin` PROPOT allit, a main a HOOK-ot hasznalja -> tenyleg nem portolhato
    **CustomFieldInput.protectedMark.test.tsx**  `origin/test/e9292631-protected-tests-on-011bbc1b`
      -> MAR a `useCanAccess`-re rebase-elve -> **tisztan cherry-pickelheto**
    KONTROLL: a tagabb minta (`CustomFieldInput\.protected.*\.test\.tsx`) MINDKETTOT megtalalja,
      a szuk basenev CSAK az elsot

**Az ujrairas ket fajl / +142 sor lett volna; a valodi ut egy `cherry-pick -x`, ami tisztan
alkalmazodott -- es a ket rogzitett mutacio EZEN a bazison is reprodukalodott.**

    hamis POZITIV .... "mar leszallitva"    -> senki nem keres tovabb, es a hiany megmarad
    hamis NEGATIV .... "nincs meg, ird meg" -> valaki UJRAIRJA azt, ami keszen all

**A masodik azert rosszabb, mert NEM HAGY NYOMOT:** az ujrairas sikerul, a teszt zold, a kartya
lezarul, es semmi nem jelzi, hogy volt egy olcsobb ut. A hamis pozitivot elobb-utobb elarulja a
megmarado hiba; ezt semmi.

**A gyakorlati alak, ha egy kartya egy fajlt NEVEZ MEG:** a kereses TAG mintaval menjen
(`<alap>.*\.test\.tsx`), ne a pontos basenevvel -- itt a tag alak EGY sorral tobbet adott, es az
az egy sor forditotta meg a verdiktet.

**A szabaly: horgonyozz TELJES UTVONALRA vagy BLOB-HASHRE, soha basenevre.**

```bash
git ls-tree -r --name-only <ref> | grep -x '<teljes/ut/a/fajlhoz>'   # UT, nem basenev
git rev-parse <ref>:<teljes/ut>                                      # vagy a BLOB
git ls-tree -r --name-only <ref> | grep -c '<basenev>'               # KONTROLL: ha >1, a
                                                                     # basenev-horgony ertelmetlen
```

*(didi sajat kimenete termelte az elso hamis 1-est, es az ELLENTMONDOTT a tartalom-oldali
bizonyitekanak. Nem kibekitette a kettot, hanem megmerte, MELYIK POPULACIO.)*

**ES A TUKORKEPE EGY IDOBELYEGEN, UGYANAZON AZ ESTEN, RAJTAM** (dexter merte, 2026-09-05):
12 `failed` uzenetet lattam `04:11` es `08:41-08:57` idobelyegekkel, es MAI kudarcnak olvastam --
"a ma reggeli aramszunet ablaka". **Datummal merve: 08-19 (9 db) es 08-29 (3 db). Tizenhet es het
NAPOS.** Flotta-szinten 26 `failed`, kilenc kulonbozo napon; MA: **nulla** (kontroll: 824 uzenet
keletkezett ma, tehat a mero latja a mai napot).

    a RELATIV datum ("ma megmerve") ...... ejfelkor NEMAN elavul   <- ezt a lap mar rogziti
    az ABSZOLUT ORA datum NELKUL ......... **a MAI datumot veszi fel az olvaso fejeben**

**Ugyanaz a javitas mindket iranyra: a DATUMOT vidd, ne az orat.** Es a `04:11` meg a `08:41` epp
azert veszelyes, mert VALODI kimaradas-ablaknak nez ki -- csak nem ennek.

*(A megkülönböztetés gyakorlati haszna: egy ágfüggő eltérésnél NE azt írd, hogy a szerző tévedett.
mandark ezt külön kimondta -- „valószínűleg a saját ágán mért, és ott más a sorszám" -- és ez volt
a helyes olvasat. Egy rossz sorszám először mindig gyanú a másik ember mérésére, és a legtöbbször
nem az.)*

**És amitől ez a fajta rossz hivatkozás NÉMA marad** (mandark tette hozzá): a rossz sorszám
**létező, értelmes kódra** mutatott. Ha üres sorra vagy a fájl végére mutatna, azonnal gyanús
lenne -- a veszélyes eset az, hogy VAN ott valami, és az olvasó AZT fogja értelmezni. Egy
hivatkozás, ami sehova sem mutat, jelez; egy hivatkozás, ami rossz helyre mutat, nem.

**ÉS UGYANEZ EGY GREP-HORGONYON: A RÉSZKARAKTERLÁNC HAMIS ALAPVONALAT AD** (friday mérte magán,
2026-08-27 20:19, egy merge előtti-utáni összevetésnél).

Az első mérése `grep -c "body.warning"` volt, és **a merge ELŐTT 1-et adott.** Nem az ő kódja: a
fájlban már állt egy `body && body.warnings` -- TÖBBES SZÁMBAN --, és a minta részkarakterláncként
illeszkedett rá.

Ha ezt veszi alapvonalnak, a merge utáni „1" **változatlanságnak látszott volna**, és azt írja
le, hogy a `web/` sáv nem változott. A pontos horgony (`showToast(body.warning, 12000)`) adta a
valódi `0 -> 1` különbséget.

**Az irány itt a fontos:** a legtöbb rossz minta HAMIS TALÁLATOT ad, és azt valaki megnézi. Ez
fordítva működött volna -- egy valódi változást rejtett volna el egy megnyugtató „nem változott
semmi" mögé. Egy elő-utó összevetésnél a horgony pontossága nem stílus: **a különbség maga a
mérés**, és egy tág horgony pont a különbséget nullázza ki.

**A gyakorlati szabály:** amikor egy kártyára „javítva" kerül, álljon ott az ÁG is, amin érvényes.
Egy commit, ami nincs azon az ágon, ahol a munka folyik, minél tovább marad ott, annál
valószínűbben vész el egy merge-nél vagy ág-eldobásnál -- **némán**, miközben a kártya továbbra is
késznek látszik.

**A feloldás cherry-pick, ÉS A VÉDELMET NEM A PATCH-ID ADJA (javítva 2026-08-23, Dexter mérése
után -- az itt korábban álló mondat hamis volt).** Eredetileg az állt itt, hogy „a patch-id azonos
maradt, tehát a merge nem fog duplikálni". Ez EGY mért esetre igaz volt, és általános garanciaként
lett leírva. Dexter újramérte egy másik cherry-picken:

    eredeti  a14f99da: b69130cde7c76460ea9e2bc0f27fa20eba6c2928
    cherry   cf08c73b: a960755ad936433c2ad274e039cc95244b32c728

Nem egyezik. Az ok a 92 commitnyi sodródás: a cherry-pick AUTO-MERGE-elt, tehát a diff nem
bájt-azonos, tehát a patch-id sem. **És pontosan akkor tér el, amikor a legnagyobb a baj:** egy
régi, magában álló ágnál. Egy garancia, ami a könnyű esetben áll és a nehézben nem, rosszabb, mint
a semmi.

Amire épp ezért NEM szabad építeni: hogy „úgyis ütközni fog". Egy MÓDOSÍTÁS újra-alkalmazása
tipikusan ütközik, egy tiszta HOZZÁADÁS viszont némán duplikálhat -- és a cherry-pickelt javítások
között mindkét alak előfordul.

**ÉS AMI VISZONT TÚLÉLI A CHERRY-PICKET: A TARTALOM** (didi mérte, 2026-08-28). Ez a szakasz eddig
csak azt mondta ki, mi NEM működik -- patch-id, hash, commit-ősvizsgálat. A POZITÍV alak:

    **létezik-e MÉG a merge-jelölten az az ALAK, amit a javítás eltávolított?**

Ez a kérdés nem érdekli, HOGYAN utazott a commit. Mért példány ugyanaznap: `d856e972` szerint az
`a969c678` HIÁNYZIK a kötegről, miközben a munka ott van `e546b6b6` néven -- **hash nincs, tartalom
van**. És fordítva: a `becd6728`-at az döntötte el, hogy a kötegen MÉG OTT ÁLLT a törött sor, míg a
javított ágon ugyanaz a szöveg már csak a magyarázó kommentben él.

*(Ugyanez zárja ki a DÁTUM-alapú szűrést is: didi kontrollja szerint a `5aa6ed95` -- egy ismerten
valódi kimaradás -- a „későbbi, tehát nem kimaradt" oldalra esik. Egy mérő, ami az egyetlen
ismerten igaz esetet nem-leletnek osztályozza, nem gyenge: MÁS kérdésre válaszol, és eldobni jobb,
mint hangolni.)*

**ÉS A RÉSZLEGES SZÁLLÍTÁS OKA TIPIKUSAN IDŐZÍTÉSI, NEM VÁLOGATÁSI** (jarvis mérte órára pontosan,
2026-08-28): hat a hét hiányzó commitból KÉSŐBBI, mint a saját ágának a merge-e. Egy ág 09:13-kor
bement, a kártyán a munka folytatódott, és a 11:54-es meg a 12:43-as commit soha nem kapott
második merge-et.

**Ezt SEMMILYEN válogatási módszer nem fogja meg** -- ágnév, kártya-id, kézi lista mind azt kérdezi,
hogy az ág BENT VAN-E, és a merge pillanatában a válasz IGAZ volt. **A merge egy IDŐPONTBAN igaz
állítás, a kártya viszont utána is nő.**
Amit megfog: egy őr, ami észreveszi, ha egy MÁR BEOLVASZTOTT ág újabb commitot kap -- vagy a
tartalom-ellenőrzés a szállítás előtt.

**ÉS EGY ELLENŐRZÉS, AMI A HORDOZÓT NÉZI A SZÁLLÍTMÁNY HELYETT, ÁTENGEDI A RÉSZLEGES SZÁLLÍTÁST**
(jarvis mérte, 2026-08-28).

Egy köteget ÁGNÉV alapján állítottak össze (43 merge-ből 40 nevez meg `type/<kártyaid>-slug` alakú
ágat). Két bukási módja lett, és a második a rosszabb:

    (A) az ág SOSEM lett beolvasztva      -> egy ágnév-összevetés MEGTALÁLJA
    (B) az ág BE LETT olvasztva, és egy javító commit MÉGIS hiányzik -> **a review ZÖLDET ad**

A (B)-nél a munka TÖBB ágon oszlott el, és egyet vittek el. Aki azt ellenőrzi, hogy *„ennek a
kártyának az ága be lett-e olvasztva?"*, helyes kérdést tesz fel a HORDOZÓRÓL, és semmit nem tud
meg a SZÁLLÍTMÁNYRÓL.

**Ugyanaz a törvény, mint a `jelenlet-vagy-megfeleltetes` skillben: a jó dolog OTT VAN, csak nem a
jó TARTALOMMAL.** És ugyanaz a kérdés oldja meg, ami cherry-pick esetén is: létezik-e MÉG a
cél-ágon az az alak, amit a javítás eltávolított?

**A védelem tehát nem tulajdonság, hanem CSELEKVÉS:** amikor egy commitot cherry-pickelsz a mai
ágra, a forrás-ágat JELÖLD FELSZÍVOTTNAK, és mondd ki, hogy külön nem olvad be. Ez a kártyára megy,
nem az emlékezetbe. Az elvesztés néma és visszafordíthatatlan; a duplikáció zajos és olcsó -- de
csak akkor zajos, ha valaki tényleg ütközést kap, és ezt előre nem tudod.

### A MERGE IDŐPONTJÁT A KOORDINÁTOR VÁLASZTJA -- ÉS HA NEM MONDJA KI, A MÁSIK FÉL EGY MÁR NEM
### LÉTEZŐ FÁRA DOLGOZIK (marveen okozta, 2026-08-29, visszafordíthatatlan)

Egy ügynök konfliktus-feloldáson dolgozott, a 09:52-es törzs-állapotra. A koordinátor 10:19-ig
**kétszer** mozdította a törzset (13 ág, majd 17 ág), **egyszer sem szólt**, és a második
blokkban az ÁGCSÚCSOKAT vette -- épp amikor a másik még dolgozott rajtuk.

**Amit ez behozott, és ami nem szedhető ki:**

    `t` üzenetű commit a törzs történetében ....... 4     (`git commit-tree -m t` állványzat)
    egy leszármazási vonal, amit ez az ág nem tervezett felvenni

A KÓD rendben volt: unióként mérve, `tsc` tiszta, a fa bájtra azonos a mért célállapottal.
**A TÖRTÉNET hordoz négy commitot, ami semmit nem mond** -- és force-push nálunk tiltott alak,
tehát ez marad.

**A két dolog KÜLÖN-KÜLÖN helyes volt:** a feloldás jó, az unió-mérés jó. A koordináció hiányzott.

**AMI EBBŐL SZABÁLY:**

1. **Ha valaki AKTÍVAN dolgozik egy ágon, ami a kötegben van, a merge ELŐTT szólj.** Nem
   engedélykérés: értesítés, hogy a fa mozdul.
2. **Egy ág csúcsát csak akkor vedd, ha a gazdája FELAJÁNLOTTA.** Az „ott van és tiszta" NEM
   ajánlat -- a szerző lehet, hogy épp azon dolgozik.
3. Aki állványzat-commitot készít (`commit-tree -m t`, `wip`, `.`), az **eldobható ágon** csinálja,
   ne azon, amit a köteg a nevéről vesz fel.

*(A lap már kimondja, hogy „a merge egy IDŐPONTBAN igaz állítás". Amit ez az eset hozzátesz: az
IDŐPONTOT a koordinátor választja, és a másik fél ezt nem látja. A hiba nem a mérésben volt --
mindkét mérés helyes maradt --, hanem abban, hogy két ember két különböző fát hitt a törzsnek,
és csak az egyikük tudta megváltoztatni.)*

A szállítás külön, kötegelt esemény, és a saját kártyáin látszik (deploy-kártyák),
nem 36 kártyán külön-külön. Egy telepítés 130+ commitot visz egyszerre; ha minden
kártya a saját szállítását is nyilvántartaná, ugyanazt a tényt írnánk le
harminchatszor, és a harminchatból néhány mindig elavulna.

**Miért kellett kimondani.** 2026-08-19-én 42 kártya állt `testing`-en, ebből 36-ot
az ellenőrző ágens már átnézett. Nem kapacitáshiány volt: több kártyát szándékosan
hagyott ott azzal, hogy "az ág nincs pusholva és a merge Isti döntése, a done azt
sugallná, hogy ki van szállítva". Az óvatossága helyes volt egy ki nem mondott
definíció mellett -- csakhogy szándékosan NEM pusholunk (GitHub-percek), tehát ebből
az következett, hogy **semmi nem tud lezárulni**. A tábla így nem tudta
megkülönböztetni a készt a folyamatbantól, én pedig ebből osztottam feladatot:
ugyanazt a kész kártyát négyszer adtam ki újra.

**A lezárás egyetlen akadálya**: nyitott lelet a kártya alatt. Azt előbb javítani
kell, vagy saját kártyát kap -- különben a lezárással a lelet is archiválódik.
"Nincs pusholva" önmagában NEM ok a testing-en tartásra.

### A KARTYA-CIMBEN NINCS RELATIV DATUM (mandark javaslata, marveen dontese 2026-09-03)

    ROSSZ:  "MA MEGMERVE: ..."          -> a kartya 09-02-n mozdult utoljara; a „ma" azota tegnap,
                                           es MINDEN kesobbi olvaso mainak olvassa
    JO:     "merve 09-02, origin/main 8562eebc"   -> ugyanannyiba kerul leirni, es SOHA nem avul

**Egy relativ datum ejfelkor romlik el, NEMAN.** Nem hibas a mondat es nem hianyzik belole semmi --
csak mast jelent, mint amikor leirtak. A cim-sodrodas tobbi fajtajat egy cenzus megtalalja (a szam
nem stimmel, a lelet megszunt); ezt nem, mert a szoveg valtozatlan.

*(mandark mindket alakot ugyanabban az oszlopban merte: a `57d6d202` a rossz, a `684ef232` a jo.
Ugyanaz a nap, ugyanaz a tabla, ugyanaz a koltseg leirni.)*

Prioritások: low, normal, high, urgent

### A SÚLYOSSÁG A KÓDOT MÉRI, A SÜRGŐSSÉGHEZ A HASZNÁLAT IS KELL (mandark javaslata, 2026-08-28)

Aznap NÉGY `high` kártyáról derült ki, hogy az éles használata NULLA -- **négy különböző okból**:

    f1a93387  semmi nem írja az oszlopot
    4a4f118f  a `FormField` tábla üres        (0 sor)
    f4950f84  soha nem generálódott dokumentum (0 GeneratedDocument, 0/8 sablon hivatkozik rá)
    b665ec50  egyetlen soron sincs `customCss` (0 / 1 Form, 0 / 8 DocumentTemplate)

Egy közös szerkezet: **a fokozat a KÓD súlyát mérte, és senki nem kérdezte meg a HASZNÁLATOT.**
Két `high` kártya ugyanazon a napon így két teljesen különböző sürgősséget jelenthet, és a
táblán semmi nem mondja meg, melyiket.

**A KONVENCIÓ, ÉS SZÁNDÉKOSAN ASZIMMETRIKUS:** ha egy kártya éles használata MÉRVE NULLA, a mért
tény a **CÍM ELEJÉRE** kerül -- `MÉRVE MM-DD: <a szám és a nevezője> -- <az eredeti cím>`.
Ha nem nulla, nem kell jelölés.
A cím azért, mert a sorrend-döntés pillanatában a lista-nézet CSAK a címet mutatja -- egy szám a
leírásban vagy egy kommentben ott nincs jelen. *(Ugyanaz a mechanizmus, mint a lefedettségi
válogatásnál: a szabály egy másik dokumentumban nem hat a döntés lépésére.)*

**A HELY 2026-09-02-ÁN A VÉGÉRŐL AZ ELEJÉRE VÁLTOZOTT -- ÉS AZ INDOK VÁLTOZATLAN: nem az indok volt
rossz, hanem a HELY.** Két ágens, egy órán belül, egymástól függetlenül, KÉT KÜLÖNBÖZŐ csonkoló
mechanizmusból jutott ugyanide:

    computress  a LISTA-NÉZETBŐL: az `f57810c5` címe 145 karakter volt, a kért append a 146.
                karakteren kezdődött volna. A csonkolt nézetben a bizonyítatlan OK utazott
                EGYEDÜL, a mért tény levágva -- a szabály BETŰJE teljesült, a CÉLJA elveszett.
    mandark     az UPSTREAM CÍM-KAPUBÓL: az a 300 karakter feletti címet A VÉGÉRŐL csonkolja.
                4 cím már most 300 fölött, további 13 átlépné egy appenddel -> **17 ÉLŐ KÁRTYA**,
                ahol a két konvenciónk egymással harcol, és a vesztes a SZÁM.
                KONTROLL: 1310 kártya 200 karakter alatt van, tehát a 17 nem mérő-zaj.

**Mindkét csonkoló a VÉGET viszi el, tehát ami elöl áll, az MINDEN nézetben ott van.** És ha
választani lehet, hogy egy bizonyítatlan OK vagy egy MÉRT SZÁM lássék először, a szám lássék.

**VISSZAMENŐLEG NEM SÖPÖRJÜK.** A 17 érintett kártyát kártyánként kell elolvasni; egy minta-alapú
átírás pontosan az a hiba, ami ellen ez a mező van.

*(Két eset ugyanarra az alakra, két KÜLÖN mechanizmusból, nem két lelet, hanem egy szabály -- ezért
lett belőle konvenció-váltás és nem egy kártya-komment.)*

### ÉS A CÍM-JELÖLŐNEK KÉT FOGYASZTÓJA VAN, KÜLÖNBÖZŐ SZÉLESSÉGGEL -- A JELÖLŐ HELYE ATTÓL FÜGG,
### MELYIK OLVASSA (mandark mérte 2026-09-04, marveen HÁROM PERCCEL a saját hibás javítása után)

A fenti szakasz kimondja, hogy a jelölő a cím ELEJÉRE megy, mert a lista-nézet csonkol. **Amit nem
mondott ki: MELYIK lista, és HÁNY karakternél.** marveen tett egy `-- PARKOLVA` jelölőt egy cím
VÉGÉRE (~150. karakter), és a helyes törvényre hivatkozott közben.

    idle-agent.ts:858 és :929 ....... `${(c.title ?? '').slice(0, 60)}`   -> **60 KARAKTER**
    a jelölő a ~150. karakteren ..... az őr listájában BÁJT-AZONOS a javítás előttivel

**A KÉT FOGYASZTÓ, MÉRVE (a CSS-oldal marveené -- mandark greppelt, nem renderelt, és ezt kimondta):**

    a DASHBOARD ....... `.kanban-card-title { font-size; font-weight; margin-bottom; line-height }`
                        NINCS text-overflow, NINCS line-clamp, NINCS overflow:hidden, NINCS nowrap
                        -> a cím TÖRDELŐDIK, TELJES EGÉSZÉBEN látszik
                        KONTROLL: `.agent-desc` VALÓBAN clampel (`-webkit-line-clamp: 2`)
                        -> a mérő LÁTJA a csonkolást, amikor van
    a TÉTLEN-ŐR ....... 60 karakter, kivétel nélkül

**A SZABÁLY EBBŐL EGY SZÉTVÁGÁS, NEM EGY ÚJ HELY MINDENNEK:**

    ÁLLAPOT-jelölő (`PARKOLVA`, `BLOKKOLVA`)  -> **ELÖL, a 60 karakteren BELÜL** -- de CSAK azért,
                                              hogy egy EMBER lássa az őr kimenetében. NEM kapuz.
    MÉRT-TÉNY utótag (`0 ÉLES HASZNÁLAT ...`) a FOKOZATOT informálja -> a DASHBOARDON olvassák,
                                              teljes címmel -> **MARAD a végén**

**ÉS A „KAPUZ" SZÓ 2026-09-06-ÁN MEGDŐLT -- A JELÖLŐ DEKORATÍV A MECHANIZMUSNAK** (friday mérte
23:52-kor élesben, marveen a forrásból újramérte). A fenti sor eredetileg azt mondta, hogy egy
`PARKOLVA` előtag a 60 karakteren belül **kapuzza a felvételt**. Nem kapuz:

    friday élesben: az őr KIÍRTA a `PARKOLVA HOLNAPRA` szöveget a SAJÁT felvehető-listájában,
    és a kártyát FELVEHETŐNEK számolta ugyanabban a kimenetben

**ÉS A MECHANIZMUS A FORRÁSBÓL, hogy ne viselkedésnek látsszon, ami szerkezet:** a `src/idle-agent.ts`
felvehető-predikátuma a `:869`-en `c.status === 'planned' && ...` -- a `title` az EGÉSZ fájlban
KIZÁRÓLAG a két MEGJELENÍTŐ sorban szerepel (`:988` és `:1133`, mindkettő `slice(0, 60)`).
**A 60 karakter tehát OSZLOPSZÉLESSÉG, nem szűrő.** A cím nem is éri el a szűrést.

Vagyis a jelölő ATTÓL van elöl, hogy egy EMBER elolvassa az őr listájában -- és ez ér valamit --,
de a mechanizmusra nulla hatása van, konstrukcióból.

**AMI VISZONT KAPUZ, ÉS EZ A LAP SAJÁT SZABÁLYA MÁSHOL: A STÁTUSZ.** A helyes alak `waiting` +
`PICKABLE WHEN` + dátum-padló (friday három parkolt kártyáján alkalmazva). Ugyanaz a törvény, amit
ez a lap a kártya-kommentnél már kimond: *ha egy döntés megváltoztatja, hogy egy kártyát fel
kell-e venni, a STÁTUSZ mozdul ugyanabban a mozdulatban* -- egy cím-előtag nem státusz.

*(A nyom, amiért ez itt marad és nem törlöm: egy előírt orvosság, ami nem hat, rosszabb, mint a
hiánya -- aki betartja, azt hiszi, megoldotta, és a kártyát tovább ajánlja az őr. Ez a lap
„a mérő és a szándék közti rés" alakja, most magán a lapon: a jelölő HELYE jó volt, a
FUNKCIÓJÁRÓL szóló mondat nem.)*

**ÉS A 78 ÉRINTETT KÁRTYÁT NEM SÖPÖRJÜK VÉGIG.** mandark mérte: 78 nyitott kártya visel jelölőt a
60. karakter után, köztük a lap saját `-- 0 ÉLES HASZNÁLAT (mérve MM-DD)` alakja (`613c790f` a 317.
karakteren, `ffd2f1a3` a 143.-on). **Ezek GRADING-bemenetek, és pontosan ott láthatók, ahol
olvassák őket** -- a szétvágás után mindkét alak helyes, ki-ki a saját fogyasztójában.

**AZ ŐR 60-ÁNAK MEGEMELÉSE NEM A JAVÍTÁS**, és a saját száma mondja meg, miért: 794 nyitott
kártyából **793** címe hosszabb 60 karakternél. A megemelés a listát prózafallá teszi, és a jelölő
pont azt a kiugrást veszti el, amiért létezik.

**A HIBA ALAKJA, KIMONDVA, MERT NEM ELÍRÁS VOLT:** marveen a HELYES törvényt hívta segítségül
(„a lista-nézet CSAK a címet mutatja"), és soha nem mérte meg a SZÉLESSÉGET. A fogyasztó jó volt,
a dimenzió méretlen -- **egy szabályt alkalmazott ahelyett, hogy megmérte volna azt, amiről a
szabály szól.** Egy konvenció, ami egy csonkolásra hivatkozik, addig nem konvenció, amíg a
csonkolás mérete nem áll mellette.

*(És mandark SZÁNDÉKOSAN nem javított egyetlen kártyát sem, két indokkal, amiből a második a valódi:
a jelölő HELYE konvenció, tehát a koordinátoré; és EGY kártya egyoldalú átírása rosszabb mindkét
alternatívánál, mert 78 kártyát hagy a régi helyen és egyet az újon -- utána sem az olvasó, sem egy
jövőbeli mérő nem bízhat egyikben sem. A mérés az övé, a konvenció-döntés nem.)*

**AMIT EZ NEM JELENT: a nulla NEM automatikus leminősítés.** Egy nulla PILLANATFELVETEL, és az
első valódi használatnál megfordul. A `b665ec50` `high` MARADT nulla mellett is, kimondott
indokkal: a javítás kicsi, biztonsági megkerülést zár, és most a legolcsóbb a pillanat (nincs
adat, amit migrálni kell, és nincs felhasználó, akit értesíteni). A szám a döntés BEMENETE, nem
maga a döntés.

**ES EGY KIVETEL, AMIKOR A NULLA EGYALTALAN NEM KERUL A CIMBE -- MERT A CIMBEN AZ ELLENKEZOJET
JELENTI** (didi hozta fel a `fbe7d854`-en, marveen dontese, 2026-09-05).

didi megmerte a `0 elo viselo`-t, es MIND A HAROM feltetel teljesult nala (o merte, datum
mellette, a gazdanak jelezte). **A szam megis kimaradt, szandekosan.**

    a lista-nezetben `0 elo viselo` ................ "NEM SURGOS"-nek olvasodik
    amit a meres VALOJABAN mond ..................... a kapu bevezetese MA SENKINEK nem kerul
                                                      semmibe -- ES a nevezett szerep mind a 29
                                                      tenantban le van seedelve, tehat a defektus
                                                      abban a pillanatban ELO, amikor kiosztjak
    -> **a szam a MOSTANI szallitas mellett ervel, nem a leminosites mellett**

**A PROBA, AMI EZT MEGFOGJA, ES A CIM MEGIRASAKOR KELL FELTENNI:** *a szamom ugyanabba az iranyba
mutat a CIMBEN, mint a MERESBEN?* Ha nem, a szam a kommentbe megy es az ERV a cimbe -- vagy semmi.

**ES NE ATFOGALMAZVA TEDD BE:** egy cim, aminek meg kell magyaraznia, MELYIK IRANYBA mutat a sajat
szama, mar tul hosszu ahhoz a helyhez, ahol el (60 karakter a tetlen-ornek). A kivetel nem a
konvencio gyengitese: a konvencio CELJA az, hogy ne szulessen fokozat hasznalati adat nelkul --
itt a BETUJE dolgozna a CELJA ellen.

*(Ez az elso rogzitett kivetel a szabaly alol, es azert all itt, hogy a kovetkezo olvaso ne
"elmulasztott jelolesnek" olvassa a hianyt. A dontes a koordinatore, az erv a merone.)*

**KI FŰZHETI HOZZÁ, MÁS EMBER KÁRTYÁJÁN IS: AKI MÉRTE.** Nem a tulajdon jogosít, hanem a
mérés. A cím általában a szerzőé -- egy ÁLLÍTÁSÁT átírni tőle elvenné a szembesülést a saját
mondatával --, de egy MÉRT TÉNY hozzáfűzése házszabály alapján más művelet: nem cáfol, hanem
hozzátesz, és épp abban az egy helyen, ahol a sorrend-döntés látja. **Az ELÖL álló alak ezen
nem változtat:** a hozzáfűzés MEGELŐZI a szerző mondatát, nem írja át -- a szembesülés a saját
mondatával megmarad. A feltétel három dolog
együtt: a szám a hozzáfűzőé (ő mérte), a dátum mellette áll, és a hozzáfűzést KIMONDJA a
gazdának -- egy PUT visszavonja, ha az nem ért egyet.
*(Mérve 2026-08-28: mandark két idegen kártyán fűzte hozzá és jelezte; egy harmadikat
szándékosan NEM érintett, mert ott csak a kódutat mérte, használatot nem. Szám nélkül nincs
utótag.)*

**ÉS AMIT A SZÁM MELLÉ ODA KELL ÍRNI: a mérés dátumát.** Egy nulla használat állapot-állítás,
nem esemény -- egyetlen felhasználói művelet megszünteti, és attól kezdve a cím hazudik.
Ha Isti ad feladatot Telegramon, vedd fel a kanban táblára is.

### AZ ÁGENS MAGÁTÓL VESZ FEL MUNKÁT -- ez az ALAPÉRTELMEZÉS, nem a kivétel
(Isti kérdezte 2026-08-28 13:09-kor, marveen mérte meg: a szabály eddig CSAK egy értesítés
szövegében létezett.)

**A MÉRT HIÁNY:** a „Vedd fel a legfelső FELVEHETŐ tételt" mondat egyetlen helyen áll a rendszerben,
az `idle-agent.ts:531`-ben -- vagyis a tétlen-őr ÜZENETÉBEN. A szabálykönyvben nulla találat.
Következmény: a szabály **reaktív** (12+ perc tétlenség után tüzel), és senki nem olvassa
szokásként. Az ágensek várnak, a koordinátor tol, és a rés a kettő között áll.

**A SZABÁLY, MOSTANTÓL ÁLLANDÓAN:**

1. **Ha van felvehető kártyád (`planned` vagy `in_progress`, a te neveden) és nincs ellentétes
   utasítás, VEDD FEL. Ne várj irányra.** A prioritás és a sorrend a tiéd.
2. **Ha egyik sem a tiéd vagy mind blokkolt, írd meg EGY SORBAN, miért** -- és akkor a
   `workcheck.json`-od hazudik, azt kell javítani, nem téged ébreszteni.
3. **Ha nincs semmi a neveden, a GAZDÁTLAN `planned` kártyák a pull-listád.** Vedd fel a
   legmagasabb prioritásút, és írd rá magad.
4. **ELŐBB FOGLALD LE, AZTÁN OLVASD EL, ÉS CSAK UTÁNA MÉRJ.** A felvétel ELSŐ művelete: írd magad
   `assignee`-nek ÉS tedd `in_progress`-be. **A MÁSODIK: OLVASD EL A KÁRTYÁT VÉGIG -- a leírást ÉS
   a kommenteket.** Csak ezután kezdj mérni.

   **A MÁSODIK LÉPÉS 2026-09-04-EN KERÜLT IDE, mert a foglalás NEM pótolja** (mandark mérte magán,
   és ő vezette le a mechanizmust): *„a foglalás ÜTKÖZÉST előz meg, nem KONTEXTUST szállít."*
   Ő szabályosan lefoglalta az `ed39a9fd`-t, aztán egyenesen a kódnak ment, és **újra levezette a
   teljes leletet -- a saját, 08-23-i kártyáján**, aminek a 3. kommentje szó szerint azt mondja:
   *„A FELVEVŐNEK: NE mérd újra a leletet."*

   **ÉS A SAJÁT KONTROLLJA ÖLTE MEG A MENTSÉGET:** épp azt akarta jelenteni, hogy egy gazdátlan
   kártya túl keveset ad a felvevőnek. Mérve, mielőtt állította: 49 gazdátlan `planned`-ből
   **45-nek van kommentje vagy leírása, és csak NÉGYNEK nincs egyik sem** -- az övé nem a négy
   között volt. **A kártya mindent megadott. A nyilvántartással semmi baj nem volt.**

   *(Az ár mérve, és nem az övé egyedül: ugyanaz a defektus KÉTSZER ült a táblán, tíz nap
   különbséggel -- `ed39a9fd` 08-23, gazdátlan, `low`; `814a5e98` 09-02, `high`, és a másodikat
   HÁROM ágens fedezte fel újra egy teljes körben. A párosításuk gépileg nem volt lehetséges: a
   cím nem nevezi meg a szimbólumot, a cím-Jaccard ~0. Detektor tehát NEM a válasz -- a válasz az
   olvasás, ami egy lépés, és ingyen van.)*
   **ÉS AZ OLVASÁS UTÁN AZ ELSŐ MOZDULAT NEM ÚJRAMÉRÉS, HANEM A KÁRTYA SAJÁT KONTROLLJÁNAK A
   LEFUTTATÁSA** (dexter mérte, 2026-09-05, **HÁROM kártyán egy estén**):

       3798795f  a kártya OSZTÁLYOZÁSÁT sosem mérték újra   -> az INDOK hamis volt
       038cea30  a kártya POZITÍV KONTROLLJÁT sosem futtatták -> lefuttatta, az ágak fedve voltak
       b36c0713  a kártya POZITÍV KONTROLLJÁT sosem futtatták -> **ELBUKOTT**

   **A harmadik ára mérve: a készlet 47/47 ZÖLD volt a teljes grace-ág TÖRLÉSÉVEL.** Egy biztonsági
   tulajdonság volt kipányvázatlan, és a kártya kritériuma SZÓ SZERINT ezt akarta megelőzni
   (*„különben a teszt csak azt rögzíti, hogy MINDIG visszavonunk"*). **A kontroll MEG VOLT ÍRVA és
   SOHA NEM FUTOTT LE.**

   *(A mechanizmus a lap `update`/`updateMany` vakfoltja, most TESZT-ÁLLÍTÁSBAN: a teszt a
   `session.update`-re és a `cacheService.del`-re állított, a visszavonás viszont
   `revokeSessionsWhere` -> `session.updateMany` + `delMany` (mérve az `origin/main`
   `session.service.ts:701/707`-en, míg a nem-visszavonó út a `:642/648`). Az állítások IGAZAK
   maradtak, miközben az ártatlan munkamenetet visszavonták -- és a kivétel TÍPUSA sem
   diszkriminál, mert mindkét ág `UnauthorizedException`-t dob.)*

   **A HORDOZHATÓ MONDAT, dexteré:** *ami rothad, az nem a lelet és nem a javítás -- hanem a kártya
   SAJÁT, KIMONDOTT KONTROLLJA, mert a LEÍRÁSA úgy érződik, mintha a MEGTÉTELE lenne.*

       egy régi kártya felvételekor a legolcsóbb első lépés NEM a lelet újramérése
       hanem **A KÁRTYA SAJÁT KONTROLLJÁNAK A LEFUTTATÁSA**

   Ez a 4. pont folytatása, nem a cáfolata: ott a lecke az volt, hogy OLVASD EL a kártyát a mérés
   helyett; itt az, hogy amit elolvastál, annak a KONTROLL-részét FUTTASD LE, mielőtt bármi mást
   mérnél. Három a háromból, egy estén, nevesített mechanizmusokkal.

5. **Ha nem a te területed: NE csináld rosszul, SOROLD ÁT** ahhoz, akié, egy soros indoklással.
   Az is haladás, és sokkal olcsóbb, mint egy rossz javítás.

**A 4. PONT MÉRT DEFEKTUS-JAVÍTÁS, nem óvatosság** -- a szabály bevezetése után HAT PERCCEL:
a `b795e249`-et **mandark ÉS jarvis is felvette, egy percen belül**, egymástól függetlenül, és
mindketten ugyanazt a repó-oldali mérést végezték el, majd ugyanabba a blokkolóba futottak.
Nem katasztrófa (két független mérés ugyanarra), de **két forduló ment el egy helyett** -- és a
szabály elsőre pont ezt akarta megszüntetni. A hiányzó lépés nem a figyelem volt: a szabály nem
mondta meg, hogy a FOGLALÁS előbb van, mint a munka.

**AMI FELÜLÍRJA, és csak ez:** a koordinátor KIMONDOTT megállítása (pl. keret-szűkösség,
merge-ablak, ütköző munka). Az ilyen mindig NEVEZI az okot és az időtartamot. Utasítás hiánya
NEM megállítás.

**MIÉRT SZÁMÍT:** a tétlen-őr a legdrágább állapotot csak 12 perc múlva veszi észre, és akkor is
egy üzenetbe kerül, ami sorba áll. Egy ágens, aki magától húz, nem termel tétlen percet -- és a
koordinátor kapacitása felszabadul arra, amit tényleg csak ő tud: döntés, sorrend, merge.

*(Mérve ugyanakkor, hogy ne elvi legyen: dexter 205 felvehető kártya, computress 18, didi 2,
friday 1, mandark 0, jarvis 0, plusz 37 gazdátlan `planned`. Aki állt, nem munka híján állt.)*

### EGY BECSLÉS LEFELÉ SOSEM ÍRÓDIK ÚJRA -- ÉS A ZSUGORODÓ KÁRTYA UGYANÚGY NÉZ KI, MINT AZ EL NEM
### KEZDETT (computress mérte magán, 2026-09-03)

Egy kártya azzal a premisszával nyílt, hogy „döntsük el a kulcs-szerkezetet, aztán alkalmazzuk
tizenegy oldalra". Felvéve kiderült, hogy **a szerkezet MÁR EL VAN DÖNTVE** -- öt lefordított oldal
megállapította, és a JSON mutatja --, tehát a maradék tíznek nem DÖNTÉS kell, hanem hogy KÖVESSEN
egyet. A szelet ezzel nem kisebb lett, hanem MÁS: egy kidolgozott példa, nem egy választás.

    a BECSLÉS az EREDETI megfogalmazáshoz tapad
    és **lefelé senki nem ellenőrzi újra**

A „nem egy délután" becslés HELYES volt arra, amire adták. Arra, amivé a kártya kiderült, annyival
téves, amennyit a döntés ért -- és **az egyetlen ok, amiért ez kiderült, az, hogy valaki felvette.**

**A gyakorlati következmény, és ez a rosszabbik fele:** egy kártya, ami FELVÉTELKOR összemegy,
a táblán megkülönböztethetetlen egy olyantól, amit senki nem kezdett el. Mindkettő ott ül a
becsült méretével, és a becslés az, ami a sorrendet vezérli. Vagyis a drága kártyák közt ülhet egy
olcsó, és pont azért nem kerül sorra, mert drágának LÁTSZIK.

*(Amit ez NEM jelent: hogy becsülni felesleges. Azt, hogy a becslés a kártya megfogalmazásának a
függvénye, tehát ha a MEGFOGALMAZÁS megdől -- „ezt el kell dönteni" -> „ez már el van döntve" --,
akkor a becslés is megdőlt, és a felvevő az egyetlen, aki ezt látja. Az ő dolga kimondani, nem a
következő olvasóé kitalálni.)*
