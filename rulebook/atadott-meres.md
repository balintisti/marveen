# Az átadott mérés: a mért esetek

Ez 2026-09-10-ig a `CLAUDE.md` legnagyobb szakasza volt (81 ezer karakter, a betöltött lap 18
százaléka), és minden ágens minden indulásakor elolvasta. A TÖRVÉNYEK a lapon MARADTAK; itt az
esetek állnak, a mérésekkel, a kontrollokkal és a visszavonásokkal együtt.

**MIKOR OLVASD EL:** ha egy mérésed ELLENTMOND valakiének; ha egy detektort vagy cenzust
tervezel; ha egy mutációs próba nem úgy viselkedik, ahogy vártad; vagy ha nem érted, miért kell
egy törvény. A napi méréshez a lapon álló összefoglaló elég.

**AMIT KÜLÖN KERESS BENNE:** a mutációs hibamódok teljes listája (a mutáció odaér és mégsem
mér), a `commit^` lecke, a funnel-állomások, a kategória-elnevezés, és a visszavont mérések --
ezek közül több a szerzője SAJÁT állítását döntötte meg, és a visszavonás a lecke, nem a hiba.

---

## EGY ÁTADOTT MÉRÉS VIGYE MAGÁVAL, MIHEZ KÉPEST IGAZ (Isti kérdésére, 2026-08-22)

Isti kérdezte: *„ha egyik ügynök lemért valamit és szó nélkül elküldi a másiknak, de közben a
mérés elavult, akkor mi van?"*

**Ma este ötször történt meg, és mind az ötször elkapták -- de nem mechanizmus kapta el, hanem
szokás.** Egy kártya premisszája két napja elavult; egy másiknál a TÜNET megszűnt, a hiba nem;
egy mérés a saját másolaton kilenc már javított mezőt jelölt (a javítás másik ágon volt); egy
detektor 13 helyet talált 5 helyett; egy kártyán álló szám 93 volt, újramérve 88, mert közben
mozgott a tábla. Mind az öt azon múlt, hogy a FOGADÓ nem hitte el, amit kapott.

**Ezért minden átadott mérés mellé három dolog jár:**

1. **MIKOR** mérted. (`date` közvetlenül a fejléc előtt -- nem becsülve.)
2. **MILYEN ÁLLAPOTON**: ág + commit, vagy a tábla pillanatfelvétele, vagy a populáció, amiből a
   szám jött. Egy szám a nevezője nélkül nem állítás.
3. **MI TENNÉ ÉRVÉNYTELENNÉ** -- ez a legerősebb, mert a fogadó egy pillanat alatt ellenőrzi.
   („Ha a `formatAsHtmlTable` második fogyasztót kap, ez a mérés újramérendő.")

**A fogadó oldalán ebből egy lépés lesz:** ha a 3. pont feltétele megváltozott, a mérés
ÚJRAMÉRENDŐ, nem vitatandó. Ha nincs 3. pont, kérdezz vissza, ne építs rá.

**Amit ez NEM old meg, és ezt is mondjuk ki:** nem szűnik meg az elavult mérés. Attól lesz
kevesebb, hogy az elavulás LÁTHATÓ, nem attól, hogy nem történik meg. A különbség az, hogy a
fogadó tudni fogja, MIT kell újramérnie, ahelyett hogy az egészet elölről kezdené.

### ÉS EGY NEGYEDIK, AMI CSAK HALMAZOKNÁL LÉTEZIK: A SZŰRŐ DEFINÍCIÓJA
### (mandark, majd didi ugyanazon az éjszakán, KÉT FÜGGETLEN esetben -- 2026-09-04)

    egy SZÁM a parancsa nélkül ....... nem ÁLLÍTÁS        <- a fenti 2. pont
    egy HALMAZ a szűrője nélkül ...... nem REKONSTRUÁLHATÓ <- ez más, és rosszabb

**Egy szám újramérhető. Egy „melyeket hagytam ki" halmaz nem.** Egy újralevezetett szűrő MÁSIK 67-et
jelöl meg, tehát MÁSIK 32-t hagy ki -- és a két halmaz különbsége láthatatlan. mandark mondata:
**a 32 nem elavult, hanem MEGSZŰNT LÉTEZNI, mert a definíciója sosem létezett.**

**A MÉRT ESET, ÉS AMIÉRT NEM EGY ROSSZ ESTE TANULSÁGA:** mandark egy step-4-es pásztázáshoz négy
példa-megfogalmazásból ~17-re bővítette a mintát munka közben, és egyet sem írt le. Két órán belül
didi UGYANEBBE futott -- a saját, TÍZ alternatívás mintáját három példával és egy „..."-tal
publikálta, **abban a kommentben, amelyikben mandarkot mérte ugyanezért.**

**Két független eset, két különböző tengelyen, egy éjszakán, az egyik a szabály szerzőjétől, menet
közben.** Ez bázisrátára utal, nem véletlenre -- és ezért áll itt mindkettő, nem csak az, amelyik
kiváltotta.

**ÉS didi ÉLESÍTÉSE, AMI MEGVÁLTOZTATJA A SÚLYÁT:** a `65523aaf`-nél a tényleges kihagyást a
SZÓKINCS okozta, nem a pozíció -- a tétel BENNE volt a záró kommentben ÉS a 900 karakteres ablakban
is. Vagyis a szűrő megfogalmazása nem részlete volt annak, hogyan vágtuk a halmazt: **maga volt a
bukási mód.** Egy szókincs-alapú pásztázásnál a szűrő definíciója nem kísérő adat, hanem az EGYETLEN
dolog, ami utólag meg tudja mondani, mire nem néztünk rá.

**A GYAKORLATI ALAK: a szűrőt FUTÁS KÖZBEN írd le, ne utána.** Utólag már csak azt tudod
rekonstruálni, amit megtaláltál -- azt nem, amit sosem néztél meg.

**ÉS A KORLÁT, AMIT didi TETT HOZZÁ, KÜLÖNBEN TÚLBECSÜLNÉNK:** a minta publikálása
REPRODUKÁLHATÓVÁ teszi a halmazt, JÓVÁ nem. Ő a 37-ből hármat elolvasott, és mind a három kimondott
határ volt -- tehát a precizitás továbbra is rossz, és a szám továbbra sem verdikt.
**A rekonstruálhatóság a padló, nem az erény.**

A kártyáknál ezt már használjuk, csak más néven: ott **újranyitási feltétel**. Ugyanaz kerül a
mérésekre is.

**ES A LEGROSSZABB FAJTA SZURO: AMI KORRELAL AZZAL A TULAJDONSAGGAL, AMIT MERSZ -- OTT A HIBANAK
IRANYA VAN, NEM SZORASA** (didi merte magan, dexter reprodukalta, 2026-09-06).

A fenti szakasz azt mondja, hogy a szuro definiciojat le kell irni. Van egy alosztaly, ahol a
publikalatlan szuro nem csak rekonstrualhatatlanna tesz egy halmazt, hanem **szisztematikusan
elmozditja a szamot, egy iranyba.**

A kerdes az volt, hany `:NNN` sorszam-hivatkozas all HORGONY NELKUL. A szuro egy lookbehind volt
(`(?<![\w/.-])`), ami minden olyan hivatkozast eldobott, amit szo-karakter elozott meg --
vagyis PONTOSAN a `main.ts:226` alakot.

    eldobott hivatkozas ......... 9122
    ebbol FAJLNEVET hordoz ...... **83%**  -> vagyis a JOL HORGONYZOTTAKAT vette ki a NEVEZOBOL
    a szam eloszor .............. 26% csupasz
    a szuro javitasa utan ....... **16%**

**A szuro azt a tulajdonsagot hasznalta kizarasra, aminek a HIANYAT merte.** Egy ilyen szuro nem
zajt ad: 10 pontnyi torzitast ad, mindig ugyanabba az iranyba, es a szam kozben tokeletesen
hiheto marad.

**A PROBA, es a szuro megirasakor kell feltenni:** *az a tulajdonsag, ami alapjan kizarok, osszefugg
azzal, amit MEROK?* Ha igen, a szuro a mereseben van, nem elotte -- es akkor vagy a szuro esik ki,
vagy a szamnak vele kell utaznia.

**ES A MASODIK FELE UGYANEBBOL A KORBOL: KET EMBER CSAK BEKERITENI TUDJA EGYMAST, AMIG A SZABALY
NINCS KIIRVA.** Mindketten hordoztak egy publikalatlan parametert (egyik a hivatkozas-szurot, masik
a horgony-szabalyt), es ezert csak INTERVALLUMOT tudtak mondani a masikra (7278..49789, illetve
21-25%). dexter az "az en bekeritesemen kivul" olvasatot egy HARMADIK definicionak vette -- holott
EGY parameter volt a kulonbseg, egy 3 soros kontextus-ablak, 7 pont erteku.

**Mindket feloldas a REGEX PUBLIKALASA volt, nem az, hogy barmelyikuk jobban gondolkodott** -- es a
rossz olvasat mindket oldalon PONTOSAN azert elt tul, mert a masik szama HIHETO volt. Egy bekerites
nem konvergal: ket ember ket ismeretlennel a vegtelensegig tud egymasra ertelmes intervallumot
mondani.

*(Es a harmadik hiba ugyanitt egy MERTEKEGYSEG-teveszes volt -- 13537 "hivatkozas" valojaban
hivatkozast HORDOZO SOR, arany 1.21 --, **a RANGSOR megis tulelte, mert a szamlalo es a nevezo
UGYANAZT az egyseget hasznalta.** Ez a lap "a mertekegyseg" szakaszahoz a hianyzo minosito: egy
rossz CIMKE nem mindig mergezi meg az eredmenyt, es a megkulonbozteto az, hogy a hibas egyseg
KIUTIK-e magat egy hanyadosban. Ami NEM eli tul: minden abszolut szam ugyanabbol a merésbol.)*

**AMI EBBOL SZANDEKOSAN NEM KERULT IDE: MAGA A SZAM.** A megfelelesi alapráta (16400 hivatkozas,
het szerzo, 18% horgony nelkul, szoras 12-21, **NINCS kiugro**) egy pillanatfelvetel a sajat
szokasainkrol, es semmilyen teendot nem ir elo -- a lap a horgonyt amugy is megkoveteli. Es a
LEGROSSZABB szerzo IDENTITASA a horgony-szabalytol fuggoen NEGY ember kozott mozog, tehat nincs kit
megnevezni. Egy szam, ami senkinek nem valtoztatja meg, mit tesz ezutan, nem lap-anyag: elavul, es
kozben ugy olvasodik, mintha rangsor lenne.

**ES EGY OSSZEHASONLITO ALLITAS AZ ALAPVONALA NELKUL UGYANIGY NEM ALLITAS -- ES ROSSZABB, MERT
UGYANAZ A MONDAT IGAZ AZ EGYIK ALAPVONALHOZ ES HAMIS A MASIKHOZ** (computress merte magan es
javitotta, 2026-09-06; marveen olvasata volt a helyes).

Egy javitas ket lehetseges alakjat hasonlitotta, es azt irta, hogy a hibas valtozat kimenete
**„MEGHIHETOBB"**, mint a mai hiba. Merve, a komponens SAJAT locale-helperevel:

    a MAI hiba .................... „Frissitve 1 perccel ezelott"
    a ket soros valtozat .......... „Frissitve tobb mint 56 evvel ezelott"

**Az 56 ev RIASZTAS -- egy felhasznalo bejelenti. Az „1 perccel ezelott" az, amit senki nem
kerdojelez meg.** A mondat tehat pont azt a tengelyt forditotta meg, ami a kettot megkulonbozteti.

**ES A HIBA ALAKJA A JEGYZENDO, nem a tevedes:** KET KULONBOZO OSSZEHASONLITAST csusztatott egybe.

    a DOBO aghoz kepest (`undefined` -> „Invalid time value") .... az epoch VALOBAN a csendesebb
    a MAI HIBAHOZ kepest ......................................... **forditva**

A „meghihetobb" az ELSO osszevetesbol szuletett, es a MASODIKHOZ lett hozzacsatolva. **Egy relativ
allitas, kimondott alapvonal nelkul, ket egymassal ellentetes iranyu igazsag kozott.**

**A PROBA, es az osszehasonlito mondat leirasakor kell feltenni:** *MIHEZ KEPEST?* Ha a valasz nem
all ott a mondatban, a mondat nem allitas -- es nem „gyenge", hanem KETERTELMU: az olvaso a sajat
alapvonalat teszi ala.

*(Es a megoldas nem jobb rangsor volt, hanem a rangsor ELHAGYASA. A vegleges erv nem hasonlit:
**a ket soros valtozat SEMMIT nem javit -- tovabbra is frissesseg-belyeget mutat egy soha ujra nem
szamolt celra, csak egy masik hamis erteket.** Egy allitas, aminek nincs szuksege alapvonalra,
nem tud rossz alapvonalat kapni.)*

*(A masodik fele mert kar, es a lap mar rogziti a mechanizmust: a hibas mondat egy COMMIT-UZENETBE
is bekerult (`f1c9fb4eb`), a force-push pedig tiltott alak -- tehat a helyesbites a KARTYAN el, es
a szerzo KIMONDTA, hogy aki a commitot olvassa, olvassa mellette. Ugyanaz az append-only
helyreallitas, amit mindenhol hasznalunk, most a sajat commit-uzeneten.)*

### A HARMADIK OK, AMIÉRT KÉT SZÁM ELTÉR -- ÉS A NEGYEDIK, AMIÉRT EGYEZIK
(mandark mérte 2026-08-27 19:26, dexterrel egyeztetve.)

**A HARMADIK OK: azonos definíció, azonos egység, MÁS COMMIT.** dexter 163 szolgáltatás-fájlt
mért, mandark 162-t. Mielőtt bármit magyarázni kezdtek volna, mandark UGYANABBAN A HÍVÁSBAN
lefuttatta mindkettőjük parancsát a SAJÁT fáján:

    find src -name '*.service.ts' -not -name '*.spec.ts'   ->  162
    python rglob, ugyanaz a szűrés                          ->  162
    csak a find-ban: []   csak a rglob-ban: []   -> a két halmaz BÁJTRA azonos

Tehát a definíciók azonosak, és a 163 dexter ÁGÁRÓL jön. Eddig két okot választottunk szét
(„más a nevező", „más a mérő"); ez egyik sem. **A fa maga a nevező része**, és ez a
legkönnyebben átsikló változó, mert semmi nem hívja fel rá a figyelmet: mindkét szám a saját
fáján helyes.

A `leirt-meres-reprodukalhatosaga` ma a PARANCSOT követeli meg egy szám mellé -- a FÁT nem.
**Egy szám mellé a commit is jár**, nem csak a parancs.

**ÉS UGYANEZ A LÉTEZÉS-ÁLLÍTÁSOKRA IS ÁLL -- ott még csábítóbb elhagyni** (marveen, 2026-08-28,
öt előfordulás egy napon). Egy „X MÁR OTT VAN a repóban" mondat binárisnak érződik, tehát senki nem
kérdezi meg, MELYIK FÁN. Ma ötször dőlt meg emiatt egy állítás: dexter guard-fájlja (az ő ágán van,
a `main`-en nincs), három küszöb-szám három fáról, a `timeout-minutes: 25` (commitolva, a törzsön
nincs), és a saját hibám -- **kiadtam egy „terjeszd ki a meglévő precedenst" utasítást, miközben a
precedens a `main`-en nem létezett**, egy órával azután, hogy a létezés/elérés keretet ide írtam.
A helyes alak ugyanaz, mint a számnál: `X létezik @ <ref>`. Fa nélkül a létezés nem állítás, hanem
egy fél mondat.

**A NEGYEDIK, ÉS EZ AZ ELŐZŐ TÜKÖRKÉPE: két szám VÉLETLENÜL EGYEZIK.** Ugyanaznap:

    dexter:  163 fájl -> 140 említés -> 104 ír -> **98** metszet      (egység: FÁJL)
    mandark: 191 tömeges írás -> **98** literal where+org -> ...      (egység: HÍVÁSI HELY)

A két 98-ban semmi közös nincs. Az egész lap arról szól, hogy két eltérő szám vitát szül és a
vitából mérés lesz -- **egy véletlen egyezés viszont NEM szül semmit.** Elsimul, megerősítésnek
látszik, és utána ketten hivatkoznak rá egy állítás mögött, amiből egyik sem az.

*(A gyakorlati válasz nem közös halmaz, hanem közös SZERZŐDÉS: minden szám mellé EGYSÉG + COMMIT +
minta, és a szeletek diszjunktságát MÉRJÜK, ne állítsuk. mandark meg is mérte: a 2. kör 191 és a
3. kör 458 hívási helye között az átfedés pozíció-szinten 0 -- mert a `\.update\s*\(` nem
illeszkedik az `updateMany(`-ra. Ez a mondat egy MÉRÉS, nem egy megnyugtatás.)*

**ÉS AZ ÖTÖDIK, AMI EGYETLEN MÉRÉSEN BELÜL TÖRTÉNIK: A TÖLCSÉR ÁLLOMÁSAIT VÉGEREDMÉNYNEK OLVASSUK**
(a koordinátor követte el, 2026-08-27 19:43, és mandark fogta meg).

Egy tölcsér így néz ki: `191 jelölt -> 47 gyanús -> 0 élő`. Három szám, és **csak az utolsó
végeredmény** -- a 47 egy SZŰRÉSI ÁLLOMÁS a 191-en belül. Én a három kör számait adtam össze
(`191 + 47 + 416`), és ezzel a 47-et kétszer számoltam: a helyes összeg 607, nem 654. A hibás
szám a gazdának szóló összefoglalóba is bekerült.

**Miért nem figyelmetlenség:** a köztes számok KOMMUNIKÁCIÓS célra készülnek -- azért írjuk ki
őket, hogy látsszon, hol szűrünk --, és épp ettől néznek ki önálló eredménynek. A tölcsér formája
maga csábít az összeadásra.

**A szabály:** aki tölcsért közöl, jelölje meg, melyik szám VÉGEREDMÉNY és melyik ÁLLOMÁS. Egy
állomás soha nem adódik hozzá semmihez -- benne van az előtte álló számban.

### EGY KATEGÓRIA NEVE A MECHANIZMUS LÉNYEGÉT NEVEZZE MEG, NE EGY PÉLDÁNYÁT
(két ellentétes irányú hiba UGYANAZON a katalóguson, 2026-08-27 este.)

Amikor egy felmérés „helyes alakok" katalógusát építi, a kategória-nevek később önálló életet
élnek: **a következő mérő a katalógust a BETŰJE szerint fogja használni.** Két hiba fenyeget, és
ma este mindkettő megtörtént ugyanazon a listán:

    TÚL TÁG   a (D) gyűjtőkategória lett („a kapu máshol van") -- mindent felszívott, ami nem fért
              máshova, és egy idő után nem mondott semmit. Két alkategória leválasztása tette
              használhatóvá.
    TÚL SZŰK  a (D) és az (F) egy-egy PÉLDÁNYT nevezett meg (`olvasás`, `JWT-munkamenet`), nem a
              mechanizmust -- így két ÉRVÉNYES, ugyanolyan erős védelem betű szerint kimaradt
              volna, és a következő mérő leletként jelentette volna őket.

A két hiba nem ellentmond egymásnak: **mindkettő abból jön, hogy a név egy MEGFIGYELT ESETET ír le,
nem azt, MITŐL VÉDETT az eset.** Ha a név a lényeget mondja ki, mindkét irány magától rendeződik --
a variánsok beleférnek, a nem-odavalók pedig kilógnak belőle.

**A gyakorlati alak:** minden kategória mellett álljon egy mondat arról, MITŐL VÉD az adott alak.
Az a mondat az, amit a következő mérő olvasni fog -- a kategória betűjele csak egy címke rajta.

### EGY SZABÁLY, AMI ÍRÁSKOR TÜZEL, CSAK A HANYAGON SEGÍT -- AMI OLVASÁSKOR, AZ A GONDOSAT IS MEGFOGJA
(jarvis fogalmazta meg, 2026-09-03, három ágens ugyanazon csapdája után)

Ugyanabba a zsh-csapdába három ágens futott bele egy éjszakán (`$B:path` -- a kettőspont
paraméter-modifikátor, tehát a `git show` a COMMITOT írja ki, nem a fájlt, és a diffre számolva a
szám FELFELÉ torzul). **És a memória-bejegyzés róla MÁR LÉTEZETT, névvel, helperrel együtt.**

    jarvis, kétszer ..... egy szkript egy ágról; a MEMORY.md története a snapshotról
    computress, egyszer . 61 a valós 34 helyett a useForms.ts-en
    a szabály ........... `git-at-sh-hasznald`, és egyikünket sem állította meg

**A megfogalmazás, ami ebből marad, és ami az egész éjszaka alá betehető:**

> egy szabály, ami ÍRÁSKOR tüzel, csak azt fogja meg, aki nem figyel.
> **Egy ellenőrzés, ami OLVASÁSKOR tüzel, azt is megfogja, aki figyelt.**
> És mindhárman figyeltünk -- írás közben egyikünk sem hibázott.

    ÍRÁSKORI szabály .... „ne írj `$B:path`-t"          -> tudtuk, és mégis leírtuk
    OLVASÁSKORI próba ... `... | head -1` a számolás ELŐTT
                          forrás-fájl kezdete: maga a forrás
                          diff kezdete: `commit <sha>`

**Ugyanez az alak a lap más helyein is, ha visszafelé olvasod:** az atomi `capture-pane | grep -q
&& send-keys` azért működik, mert az OLVASÁS és az ÍRÁS egy hívásban van -- nem attól, hogy valaki
emlékszik a versenyre. A `date` külön tool-hívása a fejléc előtt ugyanez. A mutációnál a
`git diff` assert ugyanez.

**A gyakorlati következmény, amikor egy leletből szabályt írsz:** kérdezd meg, hogy a szabályod
MIKOR tüzel. Ha csak írás közben, akkor egy figyelmes ember mellett néma marad -- és a figyelmes
emberek is elrontják. Keress hozzá egy olcsó, olvasáskori próbát, még ha az redundánsnak is látszik.

**ÉS UGYANEZ A `:` TRAP EGY HELLYEL FELJEBB HARAP: AZ ÉRTÉKADÁSON, MIELŐTT BÁRMILYEN `git` FUTNA**
(computress mérte a `60a6e43f` mag-kiemelésekor, 2026-09-04 -- egy kiemelés, ami két fájlt vitt volna
és MINDKETTŐT BÁJT-AZONOSAN adta ki). A read-idői `| head -1` próba a `git show`-ra köt; ez elé kerül:

    REF="$B:path"     # zsh: a `:` paraméter-modifikátor AZ ÉRTÉKADÁSON -> a változó a CSUPASZ refet
                      # tartja. git rev-parse HIBÁTLANUL ad vissza egy COMMITOT, git show annak a
                      # patchét írja ki -- és két "kiemelt" fájl UGYANAZ a patch kétszer.
    tsc -b ÁTMEGY, mert a teszt-fájlok a build-gráfon KÍVÜL vannak.

A `git-at-sh-hasznald` szabály ezt sem fogja meg, mert a hiba az, hogy a refet EGY VÁLTOZÓBA építed,
mielőtt a helpert hívnád. A read-idői próba sem: a kimenet egy VALÓDI commit valódi patche, nem
hibaüzenet és nem üres. **Az egyetlen mérő, ami elkapja: a BLOB-HASH.**

    git ls-tree <rev> <út>            # -> a blob sha
    git cat-file -p <blob>            # -> a fájl tartalma
    git hash-object <a kiírt fájl>    # -> vissza; egyeznie kell a ls-tree blobjával
    # két külön fájl kiemelésekor a KÉT blob-hash KÜLÖNBÖZŐ kell legyen -- ha azonos, `:`-trapbe futottál

A tágabb alak: ha egy `git show`/`rev-parse` eredményből több KÜLÖNBÖZŐ artefaktumot állítasz elő, és
azok gyanúsan egyformák, ne a diffet olvasd -- hasheld a blobokat. (Az én oldalamon ugyanez a session
a `git show "$B:sajat-crm/..."` alakon fogott meg, ahol a `sajat`/`frontend` út MODIFIER-betűvel
kezdődik; a `git-at.sh` azt megoldja, de az ÉRTÉKADÁS-alakot nem -- azt csak a blob-hash.)

**ÉS EGY KIKÖTÉS A `git-at.sh`-HOZ, MERT EZ A LELET A DELTA-CRM-BEN SZÜLETETT** (computress mérte
ugyanabban a körben): a helper a MARVEEN repóban van követve, a Delta-CRM-ben **NULLA** találat --
`git ls-files | grep -c 'git-at\.sh'` -> marveen **1**, Delta-CRM **0**.

**A KIKÖTÉS KIKÖTÉSE, mérve (mandark, 2026-09-04): a RELATÍV alak hiányzik a CRM-ből, az ABSZOLÚT
NEM.** Egy CRM cwd-ből `bash scripts/git-at.sh ...` tényleg nem létező szkriptet hív (nincs követve
a CRM-ben). De a mandark-persona az ABSZOLÚT úton hívja -- `bash /Users/isti/marveen/scripts/git-at.sh`
--, és az a marveen checkout létezéséből működik: mérve egy Delta-CRM cwd-ből, `exists origin/main
<út>` -> exit 0. Vagyis a helper ELÉRHETŐ a CRM-olvasónak is, csak abszolút úton kell hívni; a
relatív alak az, ami a másik repóban üres. **A blob-hash marad az a próba, ami SEMMILYEN külső
szkriptet nem igényel** -- ezért az a valódi hordozható fallback, nem azért, mintha a git-at.sh
elérhetetlen lenne CRM-ből. Ugyanaz az alak, amit ez a lap nevesít, egy fokkal élesebben: nem
"a recept a másik repóban nem létezik", hanem "a recept RELATÍV alakja nem hordozható; az abszolút
igen, a külső-szkript-mentes próba pedig mindenhol".

**ÉS A CSAPDA NEM EGYFORMA -- KÉT KIMENETE VAN, ÉS CSAK AZ EGYIK NÉMA** (computress mérte
2026-09-04, ugyanabban a körben, két valódi úton):

    B=origin/main
    REF="$B:sajat-crm/frontend/package.json"        -> **origin/mainckage.json**
        git rev-parse -> `fatal: ambiguous argument` .......... HANGOS, azonnal látod

    B=origin/feat/bcfaee01-test-i18n-provider
    REF="$B:sajat-crm/frontend/src/test/render-with-i18n.tsx" -> **a CSUPASZ ref**
        git rev-parse -> `078fa4ad...` egy COMMIT, hibátlanul ......... NÉMA, és ez a veszélyes

Mindkettő ugyanaz a `:s` modifier ugyanazon az `:sajat-crm/frontend/` előtagon -- a különbséget az
út HÁTRALÉVŐ karakterei döntik el, nem az, hogy vigyáztál-e. **Gyakorlati következmény: ha valaki
kipróbálta és hibát kapott, az NEM bizonyíték arra, hogy az alak biztonságos** -- egy másik úton
ugyanaz a sor csendben egy commitot ad vissza. Ezért nem elég a hibaüzenetre hagyatkozni; a
blob-hash az, ami mindkét kimenetet megkülönbözteti a helyestől.

**ÉS EGY KONTROLL, AMI EZT SZERKEZETILEG NEM FOGJA MEG: AMELYIK LITERÁL REFET HASZNÁL**
(marveen mérte magán, 2026-09-04, egy függőség-verzió összevetésén).

A ciklusom `git show "$c:sajat-crm/backend/api/package.json"` alakot használt -> **0 bájt MINDKÉT
végén**, és két üres string „a verzió nem változott"-ként olvasódik. A kontrollom viszont így nézett
ki, és ÁTMENT:

    git show 89d93f04:sajat-crm/backend/api/package.json | ...   -> 71 dependency

**Mert LITERÁL refet használt, ahol nincs változó, tehát nincs mit modifiernek értelmezni.** A
kontroll a MÉRŐ létezését igazolta, nem azt az ALAKOT, amivel a mérés futott.

    a mérés alakja ..... `"$c:LITERÁL"`      -> a modifier tüzel, 0 bájt
    a kontroll alakja .. `LITERÁL:LITERÁL`   -> nincs behelyettesítés, működik
    igazolva: ugyanaz a commit, ugyanaz a fájl -> 0 bájt kontra **6984 bájt**

**A szabály: a kontroll UGYANAZT AZ ALAKOT használja, amivel a mérés fut** -- változóval, ha a mérés
változóval megy. Különben pontosan azt a hibát nem látja, amiért létezik. Ugyanaz a törvény, mint a
„a kontroll ne tartalmazza azt, amiben bizonytalan vagy", egy szinttel arrébb: itt nem a MINTA a
kétes, hanem a BEHELYETTESÍTÉS.

*(És az irány a megnyugtató: két üres string „változatlan"-nak olvasódik. Egy hibaüzenet azonnal
feltűnt volna -- a néma nulla nem.)*

**ÉS A POZITÍV ALAK, AMIVEL A CSAPDA ELKERÜLHETO HELPER NÉLKÜL IS: A `:` UTÁN VÁLTOZÓ ÁLLJON, NE
LITERÁL** (mandark mérte 2026-09-04, computress kimenetét reprodukálva -- a reprodukcióm azért volt
NÉMÁN helyes, mert véletlenül a biztonságos alakot írtam). A modifier CSAK akkor tüzel, ha a `:` után
KÖZVETLENÜL egy literál modifier-betu áll (`s`/`h`/`t`/`r`/`e`/`a`/`l`/`u`/`g`). Ha ott egy `$` van,
nem:

    P="sajat-crm/frontend/package.json"
    REF="$B:$P"     -> origin/main:sajat-crm/frontend/package.json   (VÁLTOZATLAN, minden úton)
    REF="$B:sajat-crm/..."  (literál, `:s`)  -> mangol; `$B:head/...` (`:h`) -> `originead/...`

Mérve mind a négy útkezdő betűre (s/h/t + kontroll): a `$` sigil a `:` után KONSTRUKCIÓBÓL kizárja a
modifier-értelmezést, a literál modifier-betu kiváltja. Vagyis három biztonságos alak van, növekvő
hordozhatóság szerint: **(1) `"$B:$path"` inline (a `$` véd), (2) git-at.sh abszolút úton, (3) a
blob-hash, ami semmilyen külső szkriptet nem igényel.** A csapda kizárólag a `$B:LITERÁL` alak.

**ES A KIMENET HAROM-FELE, NEM KET-FELE -- A HARMADIK AZ, AMI A CSAPDAT ELETBEN TARTJA**
(friday merte 2026-09-06, marveen ujramerte; ugyanaz a valtozo, harom kulonbozo ut, mind a haromhoz
a biztonsagos alak kontrollkent):

    "$R:src/pane-state.ts"  ->  **(eval):1: bad substitution**   <- a HEJ tagadja meg, git EL SEM INDUL
    "$R:head/x"             ->  `originead/x`                    <- NEMAN mangol, a git utana hibazik
    "$R:package.json"       ->  `origin/main:package.json`       <- **VALTOZATLAN, veletlenul jo**
    KONTROLL: `"$R:$P"` mind a haromra HELYES

**A harmadik sor a veszelyes.** Aki a literal alakot egy NEM modifier-betuvel kezdodo uton probalja
ki (`p`, `d`, `c`...), HELYES valaszt kap, es azt a kovetkeztetest vonja le, hogy az alak biztonsagos.
**Pontosan igy felejtodik el egy szabaly azok kozott, akik megirtak** -- nem azert, mert senki nem
probalta ki, hanem mert valaki kiprobalta es ATMENT.

*(Es a szam: 2026-09-06-an OT elofordulas, NEGY agensnel, es az otodik percekkel azutan, hogy a
szerzoje elolvasta a negyedikrol szolo uzenetet. Mindannyiunknak le volt irva. Ez RATA, nem
balszerencse-sorozat -- es amiert megis elkapjuk: minden alkalommal KET SAJAT SZAM mondott
ellent egymasnak, nem a leirt szabaly szolt.)*

### EGY DISZKRIMINÁLÓ KONTROLL IS VÁLASZOLHAT A SZOMSZÉD KÉRDÉSRE -- ÉS EZ NEM HANYAGSÁG, HANEM
### A NORMÁLIS BUKÁSMÓD (három ágens, három eset, egy éjszaka: 2026-09-03)

A lap eddig azt kéri a kontrolltól, hogy DISZKRIMINÁLJON: tudjon igent is, nemet is mondani.
**Ez szükséges, és tegnap éjjel háromszor nem volt elég** -- mert mindhárom kontroll VALÓDI volt,
mindhárom diszkriminált, és mindhárom a SZOMSZÉD kérdésre válaszolt.

    marveen   „mind a 25 worktree TISZTA, nulla commitolatlan"
              -> a tisztaság egy KÉSZ, COMMITOLT, PUSHOLATLAN ág képe is
              -> a kérdés „elkezdte-e?" volt, a válasz „van-e piszkos fájl?"

    marveen   „420 teszt-fájl a fán" -- a mérő tényleg látta a készletet
              -> de a fa RÉGEBBI volt a keresett fájloknál
              -> a kontroll a MÉRŐT igazolta, nem a POPULÁCIÓT

    jarvis    négy ág „IS IN", négy „NOT IN" -- a merge-mérő tényleg diszkriminál
              -> csakhogy az `origin/main` arra válaszol, hogy KI VAN-E SZÁLLÍTVA
              -> a kérdés az volt, hogy KÉSZ-E

**A közös alak: a kontroll a MŰSZERT hitelesíti, és a műszer egy MÁSIK kérdésre van beállítva.**
Egy hibás kontroll felismerhető (nem tüzel); egy JÓ kontroll a rossz kérdésen nem az -- épp azért,
mert működik.

**ÉS EGY ERŐS KORRELÁCIÓ ELÉG AHHOZ, HOGY VISSZAVONJ EGY IGAZ LELETET -- A MEGKÜLÖNBÖZTETŐ NEM
STATISZTIKAI, HANEM SZEMANTIKAI** (jarvis mérte magán, 2026-09-03).

Egy zár-túlfutási leletnél megmérte, hogy a 238 esetből **156 egy másodpercen belül esik egy
`fetch failed`-hez** (kontroll: 7 perccel eltolt időbélyegekkel 10/238 -- tizenötszörös). Ebből
majdnem azt írta le, hogy *„tehát ez nem TTL-tünet, hanem transzport-műtermék"*, és ezzel egy valódi
leletet vont volna vissza.

**A KÓD állította meg, nem egy jobb statisztika:** egy acquire-bukás `NO_REDIS_TOKEN`-t ad vissza,
annak a release-e néma no-op, és egy release-idejű transzport-hiba MÁS üzenetet naplóz. Tehát a
naplósor tényleg azt jelenti, amit mond: a zár eltűnt. **Közös ok, nem okozati lánc.**

    a korreláció ......... megmondja, hogy EGYÜTT JÁRNAK
    a napló-sor JELENTÉSE  megmondja, hogy MIT ÁLLÍT az egyik -- és ezt csak a kód dönti el

**A gyakorlati próba, mielőtt egy korrelációra hivatkozva visszavonsz valamit:** olvasd el, MIKOR
íródik az a sor, és mi az ALTERNATÍVÁJA. Ha a rendszer a másik esetre MÁS üzenetet ad, akkor a
korreláció közös okot jelent, nem magyarázatot.

**A PRÓBA, ami megfogja, és a kontroll UTÁN kell feltenni:** *a kontrollom azt igazolja, hogy a
mérőm MŰKÖDIK, vagy azt, hogy a mérőm AZT MÉRI, AMIT KÉRDEZTEM?* A kettő nem ugyanaz, és a
diszkrimináció csak az elsőt bizonyítja.

**ES A LEGROSSZABB VALTOZATA: EGY ERVENYES KONTROLL A ROSSZ OBJEKTUMON NEM HALLGAT, HANEM
HITELESITI A HAMIS ALLITAST** (marveen merte magan, 2026-09-06; friday dontotte meg, egy oran belul).

Egy biztonsagi hook konfiguraciojarol allitottam, hogy hat agensbol hatnal hianyzik, es hogy egy
provisioning-lepes felulirja. **A kontrollom bajtra pontos volt es IGAZAT mondott:**

    a MEGOSZTOTT settings `hooks` blokkjanak sha ... 18f392cbf220
    az AGENS `.claude-config` fajljanak sha ........ 18f392cbf220   -> BAJT-AZONOS, valoban masolat

**Csak epp az a fajl nem volt az alanya annak, amit allitottam.** A scaffold a PROJEKT-szintu
`agents/<nev>/.claude/settings.json`-ba ir (`agentSettingsPath`, ot soros fuggveny) -- ott a hook
**1/1** es a tool-nev deny **5/5 token, mind a hat agensnel.** Nincs defektus.

    egy TOROTT kontroll ...................... nem tuzel, es ezt eszreveszed
    egy ERVENYES kontroll a ROSSZ OBJEKTUMON . TUZEL, es minel PONTOSABB, annal meggyozobb

**A hash-egyezes epp azert volt hitelesito, mert bajtra egyezett.** Egy gyenge kontroll gyanut
kelt; egy erős kontroll a rossz objektumon lezarja a kerdest.

**A MECHANIZMUS, ES EZ AZ ATVIHETO RESZ: az IRAS CELJAT az OLVASO configjanak helyerol
kovetkeztettem ki.** A `CLAUDE_CONFIG_DIR` a `.claude-config`-ra mutat, tehat „nyilvan a hookok is
ott vannak". Kozben a hivo fuggvenyt reszletesen olvastam (`atomicWriteFileSync(settingsPath, ...)`)
anelkul, hogy egyszer megkerdeztem volna, MI az a `settingsPath`.

**A PROBA: mielott egy fajl HIANYARA allitast epitesz, keresd meg, hova IR a kod -- ne abbol
kovetkeztess, hova OLVAS a futtato.** Egy ut-eloallito fuggveny nevet (`*Path`, `*Dir`) egy sor
elolvasni; egy ra epitett hamis lelet egy `high` kartya.

*(Es a kulonbseg a ket ember kozott nem a gondossag volt: friday ELOSZOR ugyanebbe a fajlba mert, es
KIMONDTA, hogy ellentmondast lat, amit nem tud feloldani. En erre kiterjesztettem egy kartyat. **O a
sajat merese HATOKORET kerdojelezte meg, en a VILAGOT.** Ez a lap sajat torvenye -- „ha az allitasod
ellentmond valaminek, ami mar a kepernyoden van, akkor az allitas a rossz" --, es rajtam bukott el.)*

*(computress fogalmazta meg, miután mindhármunkat elkapta ugyanazon az éjszakán -- és kimondta,
hogy a lap meglévő alakja ezt szerkezetileg nem tudja megfogni, mert MINDEGYIK kontroll
diszkriminált. Ez nem a szabály cáfolata, hanem egy réteg alatta.)*

**ÉS EGY HARMADIK RÉTEG, AHOL A KONTROLL JÓ KÉRDÉSRE VÁLASZOL ÉS MÉGSEM BIZONYÍT: HA AZ ALANY
INGADOZÓ, EGY n=1 KONTROLL NEM KONTROLL** (computress mérte magán, 2026-09-03).

Egy teljes futása 1 bukást adott egy fájlban, amihez nem nyúlt. Kivette a saját fájlját, újrafuttatta
-- **zöld**. Ebből azt olvasta ki, hogy az ő fájlja okozza. A harmadik futás megdöntötte:

    1. a fájlommal ....... 1 BUKÁS
    2. a fájlom NÉLKÜL ... ZÖLD          <- ebből lett a (hamis) attribúció
    3. a fájlommal ÚJRA .. ZÖLD          <- és a 3. fa BÁJTRA azonos az 1.-vel

**A saját mondata: a „nem történt meg" és a „nem történik meg" ugyanúgy néz ki, és ő az elsőből a
másodikat olvasta.** Egy ingadozó teszten egy zöld futás nem cáfolat, csak egy minta n=1-gyel.

**Az irány itt is a kényelmes felé megy:** egy sikeres kontroll-futás LEZÁRJA a kérdést, tehát senki
nem futtatja harmadszor. És ugyanez a hiba ül a testvér-kártya CÍMÉBEN is (*„6 további kísérletre
NEM reprodukálható"*): hat zöld futás nem azt bizonyítja, hogy a hiba megszűnt, csak azt, hogy
hatszor nem tüzelt.

**A gyakorlati alak: ingadozó alanyon a kontroll SZÁM, nem állapot.** Ha attribúciót írsz le
(„az én változtatásom okozza" / „megszűnt"), járjon vele az arány és a nevező -- hány futásból hány --,
és a nevezőt VALAKINEK számolnia kell. Egy „nem reprodukálható" nevező nélkül nem mérés.

**ÉS UGYANEZ EGY SZINTTEL FELJEBB, UGYANAZON AZ ÉJSZAKÁN: PÁRONKÉNT TISZTA NEM JELENT HÁRMASBAN
TISZTÁT.** Három ág külön-külön tisztán ment a törzsre, és mind a három PÁR is tisztán ment
egymásra -- a köteg viszont MIND A HÁRMAT egy fára alkalmazza, és a `merge-tree`-nek arra sincs
kérdése. computress megmérte úgy, hogy TÉNYLEG beolvasztotta mind a hármat egy eldobható ágra.

**És a legfontosabb: egy TISZTA szöveges JSON-merge nem JÓ merge.** A git szövegként fésüli a
`locales/*.json`-t, a szerkezetről semmit nem tud -- itt tűnnek el kulcsok némán. Ezért nem a
merge-et kell ellenőrizni, hanem az EREDMÉNYT:

    egyesített kulcs 3568 = unió 3568 | alap 3501 | ELVESZETT 0
    KONTROLL: egy kulcsot kitörölve az egyesített fából -> ÉSZLELVE

*(És egy melléklelet, ami magától adódott: a három nyelv LÉPÉSBEN mozdult, 3501 -> 3568 mindegyiken.
Egy részleges merge deszinkronizálta volna őket.)*

### KÉT ŐR ELTÉRÉSE NEM DEFEKTUS, AMÍG MEG NEM MÉRTED, MIT CSINÁL EGY TALÁLATTAL
### (didi mérte, marveen döntött, 2026-09-06 -- és a mérésben SEMMI nem volt hibás)

didi mintaszerűen mérte ki, hogy két levél-kapu ELLENTÉTES fallbackot használ ugyanarra a
parszolhatatlan parancsra: az `.mjs` a teljes régi mintakészletre esik vissza (a saját kommentje
szerint *„never weaker"*), a `.py` egy szűk literál-listára. Mindkét kapu SAJÁT belépési
függvényét hívta (nem mintát másolt), a próba FÁJLBAN állt, és mindkét irányban futott kontroll.
**Nem javasolt orvosságot, és külön kártyát kért a döntésre.** Ez az eljárás helyes fele.

**A frame mégis megdőlt, egyetlen meg nem mért dolgon: MIT CSINÁL A KÉT KAPU EGY TALÁLATTAL.**

    email-send-gate.mjs :243 ..... `deny: true` -- SUB-AGENSEKRE, governance-tiltás
    outgoing-copy-gate.py :690 ... a FŐ agens kimenő szövegén, magyar kopi-QA

**Ugyanaz a függvénynév (`isSendInvocation` / `is_send_invocation`), két populáció, két kár.**
Az eltérés tehát nem KÉT ELLENTÉTES SZÁNDÉK EGY útra, hanem KÉT HELYES szándék KÉT útra, amik
történetesen osztoznak egy függvénynéven. Összeigazítva az egyik oldalon szükségszerűen
biztonsági szűkítés lett volna -- egy VALÓDI védelmen, egy nem létező defektus miatt.

**A PRÓBA, ÉS A DIVERGENCIA-LELET LEÍRÁSA ELŐTT KELL FELTENNI:**

> **Mit csinál a két oldal EGY TALÁLATTAL, és mibe kerül egy HAMIS POZITÍV mindkettőn?**
> Ha a válasz különbözik, akkor nem egy kontroll két példánya, és az eltérésük nem lelet.

*(Ez egy réteggel a „diszkrimináló kontroll a szomszéd kérdésre válaszol" alatt van: ott a
KONTROLL mért mást, mint a kérdés. Itt a kontroll is, a mérés is pontosan azt mérte, amit
kérdeztek -- és a KÉRDÉS feltételezte, hogy a két dolog összehasonlítható. A mérés nem tudja
megcáfolni a saját premisszáját.)*

**ÉS A KONKRÉT DÖNTÉST NEM AZ ÉRVELÉS ZÁRTA LE, HANEM EGY HARMADIK MÉRÉS:** a szűk lista által
elejtett alakok (`sendEmail`, `mail.send` csupaszon) ebben a repóban CENZUS-GREP alakok, nem
küldők -- az egyetlen Bash-úton elérhető küldőt (`scripts/support-mail/send.py`) a lista KÉTSZER
fogja meg. Plusz: a fő agens VALÓDI küldései (`telegram __reply`, `send_email` MCP) az entrypoint
MÁSIK ágain mennek, és soha nem érik el a parszolót (mérve: 1 előfordulás, a Bash ágon). Vagyis
az a kockázat, amiért a kapu létezik, nem ezen a fallbacken utazik.

**A DÖNTÉS ARTEFAKTUMA A KÓDBA MENT, nem egy kártya-kommentbe** (`fe418df`, komment-csak, AST-tel
bizonyítva): a fallback mellett most ott áll, hogy aki cenzusban ezt eltérésnek találja, NE
igazítsa össze, a három mért indokkal. **Egy koordinátori döntésnek nincs természetes
artefaktuma** -- ezt a lap külön rögzíti --, és egy cenzus-találat helye a KÓD, nem a tábla.

**ÉS AMI EBBŐL FÉL ÓRÁVAL KÉSŐBB KIDERÜLT, ÉS A DÖNTÉSNÉL FONTOSABB: A DÖNTÉS HÁROM HELYEN ÁLL
PRÓZÁBAN ÉS NULLA HELYEN PINBEN** (didi mérte mutációval, marveen újramérte a döntő felét).

didi mutálta a fát PONTOSAN abba, amit a ruling tilt -- MINDKÉT irányban --, és a teljes készlet
**5459 teszt, ZÖLD** volt így is, úgy is. Vagyis egy „tegyük konzisztenssé a két kaput" refaktor
akadálytalanul átmegy, akármelyik oldalt igazítja a másikhoz.

**A MECHANIZMUS, ÉS EZ AZ, AMI ÁTVIHETŐ: A KÉT PIN A KÖZÖSET PINELTE, NEM AZ ELTÉRÉST.**

    a konformitási teszt docblockja ..... „each pins its own fallback in its scope test"
    outgoing-copy-gate-scope.test.ts ....  sendmail 10  |  sendEmail 0  |  mail.send 0
    email-send-gate-scope.test.ts .......  sendmail 13  |  sendEmail 0  |  mail.send 0
    KONTROLL: a mérő 2 scope-teszt fájlt lát, tehát nem vak

**A `sendmail` MINDKÉT készletben benne van.** Egy pin, aminek a pozitív esete olyan token, amiben
a két oldal EGYETÉRT, szerkezetileg nem tud eltérést észlelni -- akkor sem, ha a docblockja azt
állítja, hogy pineli. Ez a Delta-CRM lapján álló FIXTURE-törvény („a fixture-t ott válaszd, ahol a
helyes és a helytelen megvalósítás eltér"), most nem egy unit-teszt fixture-jén, hanem egy KÉT
IMPLEMENTÁCIÓ KÖZTI konformitási pinen -- és ott a kézenfekvő pozitív eset MINDIG a közös token,
mert az a legolvashatóbb példa.

**A gyakorlati próba, konformitási teszt írásakor:** a pozitív esetem olyan bemenet, amin a két
oldal MA MÁST ad? Ha nem, a pin a megegyezést rögzíti, és a divergencia szabadon bevezethető.

### EGY GENERÁLT BLOKKBA ÍRT LECKE ÜTEMEZETTEN TÖRLŐDIK -- ÉS A FIGYELMEZTETÉS TIZENKÉT SORRAL
### FELETTE MÁR OTT ÁLLT (computress mérte 2026-09-06, marveen újramérte; MÁSODIK előfordulás)

A `suite-size-guard.ts` racsni-alapvonala egy GENERÁLT blokkban él (`SUITE-BASELINE:BEGIN/END`),
és a `npm run test:baseline` **tervezetten felülírja az egészet**. Valaki egy mért leckét írt a
blokkba (*„egy racsni-alapvonalat SOHA nem választunk két ág értéke közül: azon a fán mérjük, amit
védeni fog"*, az 5445/5450 esettel). A következő ratchet-futás elvitte:

    HEAD (élő)   `5445` 1  |  a tanulság-mondat 1
    az ágon      `5445` 0  |                    0
    KONTROLL: a `SUITE-BASELINE:BEGIN` horgony az ágon MEGVAN -> a mérő nem vak

**ÉS AMITŐL EZ ALAK, NEM BALESET: UGYANEZ MÁR MEGTÖRTÉNT EGYSZER, ÉS A FÁJL LE IS ÍRJA** --
tizenkét sorral a blokk FÖLÖTT, egy MÁSIK, ugyanígy elveszett mondatról: *„Ez a mondat SZÁNDÉKOSAN
a generált blokkon KÍVÜL áll: egyszer már bennállt, és a következő `npm run test:baseline`
felülírta -- egy generált blokk csak a SZÁMOT tudja megőrizni, a MÉRÉS MÓDJÁT nem."*

Valaki megírta a figyelmeztetést, és a következő lecke MÉGIS a blokkba került.

    **EGY FIGYELMEZTETÉS A CSAPDA MELLETT NEM ZÁRJA BE A CSAPDÁT. Csak a SZERKEZET zárja be.**

**ÉS EZ NEM AZ „ÉL ÉS FUT, DE NINCS VERZIÓZVA" ÖTÖDIK ÁLLAPOT:** ez VERZIÓZVA VAN, commitolva van,
átment a review-n -- és egy ESZKÖZ törli, ÜTEMEZETTEN, minden ratchet-frissítésnél. Nem elveszik:
elvész, ismételten, és a törlés a normális működés része.

**A GYAKORLATI PRÓBA, egy sor, és a leírás pillanatában kell feltenni:** *ezt a mondatot melyik
parancs írja felül?* Ha van ilyen parancs, a mondat egy régióval feljebb való. A generált blokk
csak azt őrizheti meg, amit ő maga állít elő -- a SZÁMOT; a MÉRÉS MÓDJA, az INDOK és a TANULSÁG
konstrukcióból nem fér bele.

*(A megtalálás oka is a szokásé, nem a figyelemé: computress a saját ágán FUTTATTA a ratchetet, és
utána elolvasta a diffet, ahelyett hogy a parancs sikerét vette volna eredménynek. A diff volt az
egyetlen hely, ahol a törlés látszott.)*

### EGY `|`-VEL ÖSSZEFŰZÖTT ALTERNATÍVA MEGHALHAT, ÉS AZ NEM MÉRHETŐ -- MERT EGY CSOPORTON
### BELÜLI ÁGAT NEM LEHET MEGSZÁMOLNI (dexter mérte 2026-09-06, marveen újramérte)

Egy biztonsági őr hét alternatívát fűzött egy regexbe. **Kettő közülük SOHA nem illeszkedhetett** --
a `callsIn()` szelet a hívási helyek ELŐTT kezdődött, tehát a `htmlBody = this` és a `subject = this`
ág kívül esett. Az őr 6/6 ZÖLD volt, miközben az öt élő ág vitte az egészet.

**A MECHANIZMUS, EGY SORBAN IGAZOLVA:**

    egy összefűzött `(A|B|C)` regex TALÁLATSZÁMA nem bontható ágakra
    -> mérve: 2 találat; a KÉT holt ág (B, C) LÁTHATATLAN, a szám ugyanaz nélkülük is
    LISTAKÉNT, alternatívánként: {A: 2, B: 0, C: 0}  -> a holt ágak KIESNEK
    KONTROLL: egy LÉTEZŐ alternatíva 2-t ad, tehát a mérő nem vak

**A TÖRVÉNY, dexter megfogalmazásában, és ez az, ami átvihető:**

> **Egy minta, ami NEM TUD illeszkedni, megkülönböztethetetlen attól, ami nem talál semmit.
> Mindkettő zöld.**

**AZ ORVOSSÁG NEM JOBB REGEX, HANEM MÁS ADATSZERKEZET:** az alternatívák LISTÁBAN álljanak, ne egy
`|`-vel összefűzött csoportban -- és egy KONTROLL állítsa, hogy MINDEN alternatíva illeszkedik még
legalább egy hívásra. Ez a próba fogta volna meg az eredeti defektust is, és nulla plusz munkába
kerül a mérés pillanatában.

*(Az ára mérve, ugyanabban a körben: a szelet javítása után a két holt ág 0 -> 3 találat, a másik öt
VÁLTOZATLAN, a vizsgált hívások 4 -> 6, és a tiszta fán NULLA offender -- tehát a szélesítés
PONTOS volt, nem lazább háló. És a harmadik mutáció megmutatta, hogy egy NAIV szélesítés hamis
leletet gyártott volna egy HELYES hívási hely ellen -- ezért kellett a sink-mérésnek elöl állnia.)*

### EGY REGRESSZIÓS TESZT EGY RÉGI, NEM REBASE-ELT ÁGON NEM A TÖRZSRŐL ÁLLÍT -- A SAJÁT
### BÁZISÁNAK AZ ÉLETKORÁT MÉRI (mandark mérte magán, 2026-09-06; marveen újramérte)

Hét regressziós tesztet írt egy ágon, mindegyik docblockjában azzal, hogy *„These tests FAIL
today"*. Igaz volt -- **az ő fáján.** A törzsön hármuk közül kettő MÁR JAVÍTVA VOLT, mire
megírta őket:

    javitas `b27dbc00`  08-23 10:35   |   a hozza irt teszt `225711ab`  08-27 20:32   -> NEGY NAP
    javitas `001f6b3f`  08-24 21:45   |   a hozza irt teszt `c3bfccab`  08-27 20:37   -> HAROM NAP
    mindket javitas az `origin/main`-en: is-ancestor rc=0
    KONTROLL: origin/main onmagara rc=0
    es TARTALOMRA, nem osoodesre: a mondat, amit a teszt kovetel, a main-en OTT VAN, a
    merge-base-en NINCS

**A piros nem a defektusról szólt, hanem arról, hogy a bázis régi.** És a docblock jelen idejű
mondata ezt elrejti: *„ma buknak"* -- kimondatlanul *„ezen a fán"*.

    egy ELAVULT bázison írt piros teszt  ->  ugyanúgy néz ki, mint egy ÉLŐ defektus pinje
    a megkülönböztető NEM a szín, hanem hogy a TÖRZSÖN is piros-e

**ÉS A MÁSODIK FELE MÉG DRÁGÁBB, MERT A LEZÁRÁS IRÁNYÁBA VISZ: EGY ZÖLD TESZT GYAKRAN EGY
TESTVÉR-KÁRTYÁT IGAZOL, VAGY EGY TÖBBRÉSZES KÁRTYA EGYETLEN ASPEKTUSÁT.** Ugyanabban a körben,
három kártyán mérve:

    `ad83aff7`  mar `done` -- a teszt csak HIVATKOZIK ra
    `de1fc3fc`  a cime NEGY helyzetet nevez meg; harom javitva a main-en, a NEGYEDIK NEM
    `ffd2f1a3`  a teszt az `f4c6386d`-t igazolja (mar `done`); a SAJAT blokkoloja backend, ES MA IS NYITOTT

**„A teszt zöld, tehát a kártya lezárható" alapján háromból KÉTSZER egy ÉLŐ defektust archiváltunk
volna.** A teszt és a kártya viszonya nem 1:1, és a zöld szín ezt nem árulja el.

*(A koordinátori része az enyém: én adtam ki, hogy „a hét zöld defektus lezárható, mindegyik a
méréssel". A mérés jó volt; a KÖVETKEZTETÉS, amit ráépítettem, két kártyán hamis lett volna --
és a felvevő mérte meg helyettem, ahelyett hogy végrehajtotta volna.)*

### EGY BUKÓ POZITÍV KONTROLL NEM HIBA, HANEM A LELET MAGA (dexter, 2026-08-29)

A kontroll szokásos szerepe ezen a lapon a VERIFIKÁCIÓ: azt bizonyítja, hogy a mérő nem vak. Van
egy másik, ritkábban kimondott szerepe: **a bukása FELFEDEZÉS.**

Mért eset. dexter második mérőjéhez a pozitív kontroll az volt, hogy a `findMyTasks` biztosan
önmagára kötött -- egy eset, aminek a válaszát előre tudta. **A kontroll ELBUKOTT**, és a bukás
oka nem a mérő hibája volt, hanem egy olyan érvényesítési ALAK, amiről nem tudott: a
`SCOPE_OWNERSHIP.tasks.own()` predikátum, amit a `where`-be fűznek.

    a kontroll ÁTMEGY -> a mérő lát, és mehetsz tovább
    a kontroll BUKIK  -> vagy a mérő rossz, VAGY a világ gazdagabb, mint a modelled

A második eset az, amit a legkönnyebb elrontani: a kézenfekvő reakció a kontroll „megjavítása"
addig, amíg zöld nem lesz -- és akkor pont azt az alakot dobod el, amit épp felfedeztél.

**dexter szavai: „A control that fails is the only reason this round produced anything."**

*(Ugyanabban a körben a MÁSIK mérője is elromlott, és megint a KÉNYELMES irányba: a
`^\s*name\(` minta az `if (`-re is illeszkedik, tehát egy olvasás „befoglaló metódusa" a
legközelebbi if-re oldódott fel, aminek a „paraméterei" a feltétel. A `projects.findAll`, ami
PEDIG kap `userId`-t, rendszer-kontextusúnak jött ki. A törött mérő 40 felhasználói-kontextusú
olvasást mondott, a javított 86 -- **több mint a felét vesztette el, abba az irányba, ami
kevesebb munkát jelent.** És nem a szám fogta meg, hanem hogy lefuttatta egy olyan esetre,
aminek tudta a válaszát.)*

**A gyakorlati alak: minden mérőhöz legyen legalább egy eset, aminek TUDOD a válaszát -- és ha a
mérő mást mond, előbb kérdezd meg, hogy a VILÁG-e a bővebb, mielőtt a kontrollt igazítod.**

### AMIKOR A MÉRŐ HIBÁJA UGYANOLYAN ALAKÚ, MINT A KERESETT DEFEKTUS (mandark, 2026-08-27 20:06)

Egy elbukó regressziós teszthez mandark írt egy KONTROLLT is: egy normál mező ugyanazon a határon,
ahol a gombnak ENGEDÉLYEZVE kell lennie. Elsőre a kontroll is piros lett -- és az ok a saját
harness-e volt: a react-hook-form ASZINKRON validál, tehát a gomb egy microtaskkal a `fireEvent`
UTÁN áll be.

    szinkron állítással:  „a gomb tiltva marad"   <- PONTOSAN úgy néz ki, mint a valódi defektus
    `await`-tel:          a kontroll ZÖLD, a másik kettő PIROS -- ez a valódi lelet

**A mérőeszköz hibája és a keresett hiba TÜNETE azonos volt.** Kontroll nélkül három piros tesztet
jelentett volna, és a harmadik oka ő maga.

**Ez a legveszélyesebb osztály, és megvan a saját ismertetőjegye:** ha a mérőd elhasalása
ugyanazt a kimenetet adja, mint a keresett defektus, akkor a találat SOHA nem különbözteti meg a
kettőt -- semmilyen mennyiségű újraolvasás nem segít, mert nincs mit észrevenni. Csak egy
KONTROLL választja szét őket: egy eset, aminek a mérő szerint ZÖLDNEK kell lennie.

**A felismerés kérdése, amit érdemes feltenni a mérő megírása közben:** *ha az eszközöm elromlik,
az úgy fog kinézni, mint egy találat, vagy mint egy hiba?* Ha találatnak, a kontroll nem
szorgalmi feladat, hanem a mérés fele.

**ÉS A KONTROLL MAGA IS LEHET ROSSZ -- AKKOR A MÉRŐ LÁTSZIK VAKNAK** (computress mérte magán,
2026-08-27 20:53, egy push előtti titok-ellenőrzésnél).

Pozitív kontrollnak egy fájlt választott azon az alapon, hogy *„ezt én írtam"*. A mérő AZONOSNAK
mondta az `origin/main`-hez képest -- vagyis **a mérő vaknak látszott.** Nem magyarázta el:
újrafuttatta más fájlokkal, és kiderült, hogy **a KONTROLL volt rossz** -- ahhoz a fájlhoz csak
TESZTET írt, magát a komponenst nem módosította, tehát helyesen jött ki azonosnak.

    a mérő rossz     -> a kontroll nem jelez, és a mérés semmit nem ér
    a KONTROLL rossz -> a kontroll nem jelez, és UGYANÚGY néz ki

**Egy elrontott kontroll pontosan azt a képet adja, mint egy elhasalt mérő** -- és a kézenfekvő
következtetés a rosszabb: eldobni a mérőt, ami valójában működik. Ez a nap fő alakja, egy szinttel
beljebb: már nem a mérő hazudik, hanem az, amivel a mérőt ellenőrizzük.

**ÉS EGY KONTROLL-ALAK, AMI ÁTMEGY EGY FÉLIG VAK MÉRŐN: A KÜSZÖB-ALAPÚ POZITÍV KONTROLL**
(friday mérte magán, 2026-09-04 -- a saját kontrollját egy mutáció leplezte le).

Egy fa-bejáró cenzus pozitív kontrollja `files.length > 50` volt. **Ez ÁTMEGY kikapcsolt
könyvtár-rekurzióval is**, mert a `src/` gyökere egymaga több mint 50 fájl. Vagyis a cenzus a fa
nagy részét nem nézte volna meg, és a kontroll erről HALLGAT.

    egy DARABSZÁM megmondja, hogy a mérő TALÁLT valamit
    azt NEM, hogy a BEJÁRÁS eljutott-e oda, ahol a keresett dolog lakhat

**A javítás nem nagyobb küszöb, hanem MÁS PREDIKÁTUM:** a kontroll állítson egy KONKRÉT,
ALKÖNYVTÁRBAN lakó fájl jelenlétére. Utána a rekurziót kikapcsoló mutáció pirosra ment.

**A felismerési jegy:** ha a kontrollod egy MENNYISÉGRŐL szól (`> N`, „nem üres", „több mint egy"),
kérdezd meg, hogy a mérő egy SZŰKEBB bejárással is teljesítené-e. Ha igen, a kontroll a mérő
LÉTEZÉSÉT igazolja, nem a HATÓKÖRÉT -- és a hatókör az, ami némán szokott elveszni.

**ÉS A HASZNÁLHATÓ ALAK EGY KÉRDÉS, NEM EGY LÉPÉS** (friday fogalmazta meg, 2026-09-04, és tágabb
a fenti mennyiség-esetnél, amit magába foglal):

> **Van-e olyan bemenet, amin EZ a kontroll MA elbukna?** Ha nincs, akkor díszlet.

**ÉS EGY HARMADIK, AMIT EZ A KÉRDÉS SEM FOG MEG: A NEGATÍV KONTROLL EGYEDÜL** (marveen mérte
magán, 2026-09-04, egy órával a fenti sor leírása után).

Egy kaput mértem két esettel: egy POZITÍV (blokkolnia kell) és egy NEGATÍV (nem szabad blokkolnia).
**Rosszul hívtam a mérőt** -- `find_hits(command, cwd=None)`, és csak a parancsot adtam át, mert az
ELŐZŐ javításnál még egy paramétere volt. Cwd nélkül a fájl-olvasás néma, tehát **MINDEN False**.

    a NEGATÍV kontroll (`grep -f ...`)   várt: False   kapott: False   -> **ÁTMENT**
    a POZITÍV eset (`psql -f ...`)       várt: True    kapott: False   -> ez árulta el

**A negatív kontroll egy MŰKÖDŐ és egy KIKAPCSOLT mérőtől ugyanazt kapja.** És friday fenti kérdése
sem fogja meg: van olyan bemenet, amin elbukna (ha a kapu tévesen blokkolná a grepet) -- tehát nem
díszlet, csak épp erre a hibára vak.

**A szabály: egy kapu-méréshez a POZITÍV eset a kontroll, nem a negatív.** A negatív a TÚL-BLOKKOLÁST
zárja ki; azt, hogy a mérő egyáltalán FUT, csak egy olyan eset bizonyítja, aminek IGENT kell adnia.
Ha mindkettő NEM-et vár, a mérés nem tud különbséget tenni önmaga és a semmi között.

*(A mechanizmus külön megjegyzendő: ugyanaz a függvénynév, ÚJ paraméterrel -- a régi hívási alak
csendben az alapértelmezéssel megy tovább, és HIHETŐ választ ad. Egy `tsc` ezt nem fogja meg egy
opcionális paraméternél, és a Python semmit sem mond.)*

A mennyiség-eset ennek csak egy PÉLDÁNYA: egy `> 50` küszöb azért díszlet, mert nincs az a szűkebb
bejárás, amin elbukna. De ugyanez fog egy olyan kontrollon is, ami nem számol semmit -- egy létezés-
állításon, egy „nem dobott kivételt" ellenőrzésen, egy `rc=0`-n.

**ÉS AMIÉRT KÉRDÉS ÉS NEM LÉPÉS:** egy lépést be lehet tartani üresen (lefuttatom, zöld, kész); egy
kérdésre válaszolni kell. Ez a lap többször rögzíti, hogy egy ALAK-szabály a döntés pillanatában nem
olvasódik el -- egy kérdés viszont pontosan akkor tüzel, amikor a kontrollt MEGÍRJÁK.

*(A három bizonyíték szétválasztása ugyanebből: a `git diff --stat` és a mentett másolat elleni `cmp`
azt bizonyítja, hogy a változás MEGÉRKEZETT; egyedül a harmadik azt, hogy a mérő MÉG MINDIG tud
nemet mondani. Az első kettő a MUTÁCIÓRÓL szól, a harmadik a MÉRŐRŐL -- és csak a harmadik hiányzott.)*

*(Ugyanaz a törvény, mint a `.ts`-only glob esete: ott a vakfolt a FÁJLOK 66%-a volt, és a SZÁMON
csak 4,5% látszott. Egy küszöb-kontroll pontosan az ilyet engedi át.)*

**ÉS EGY ESZKÖZ-KORLÁT UGYANEBBŐL A KÖRBŐL, mert egy HELYES megtagadás elromlott mérésnek látszik:**
a `mutate-probe.py`-val egy HOZZÁFŰZŐ mutáció szerkezetileg lehetetlen -- a csere szükségszerűen
tartalmazza a horgonyt, amit a no-op kapu elutasít. friday három próbája bukott el
`ERVENYTELEN PROBA`-val, mielőtt teljes SOR-cserére váltott. **A megtagadás az eszköz helyes
működése volt**; aki ezt nem tudja, azt hiszi, a mérése romlott el, és a rossz dolgot kezdi javítani.

**ÉS AMI A KETTŐT SZÉTVÁLASZTJA -- EZ A MONDAT EDDIG HIÁNYZOTT A LAPRÓL** (dexter fogalmazta meg,
2026-08-29, két saját elbukott kontroll után egy éjszaka).

Mindkét kontrollja elbukott, és MINDKÉTSZER a KONTROLL volt rossz, nem a kód. Az egyik a
záradék saját értékeit hasonlította önmagához, tehát minden lekérdezés illeszkedett -- egy
pillanatra úgy nézett ki, hogy a láthatósági szűrő EGYÁLTALÁN nem működik, ami sokkal nagyobb és
teljesen hamis lelet lett volna. A másik dublőrből hiányzott egy `groupBy`, tehát mindkét eset
eldobott, mielőtt az állításig ért.

    egy TÖRÖTT kontroll  és  egy VAK mérő  UGYANAZT A KÉPET adja
    és a kimenetből egyik sem különböztethető meg

**A szétválasztó nem a gondosság, hanem hogy a kontrollnak van-e olyan válasza, amit a MŰSZERTŐL
FÜGGETLENÜL is tudsz.** dexternél ez volt: „az olvasási útnak EL KELL REJTENIE ezt a célt" -- egy
tény, amit a saját dublőrje nélkül is ellenőrizhetett. **Ez a különbség egy KONTROLL és egy MÁSODIK
MÉRÉS között:** a második mérés ugyanazt a bizonytalanságot ismétli meg, a kontroll egy ismert
válaszhoz méri a műszert.

*(A tükörképe ugyanezen a napon, marveen: a kontrollja 14 kapuzatlan útvonalat adott vissza, és az
első reflexe az volt, hogy elbukott. Nem bukott el -- arra a kérdésre, amire épült (alias-feloldás),
23 feloldott követelménnyel válaszolt. **Egy kontroll akkor bukik el, ha az ISMERT válaszát nem
adja vissza -- nem akkor, ha MELLETTE valami váratlant is mutat.** Az a váratlan külön kérdés,
és a kontroll eldobása pont azt viszi el, ami épp működik.)*

### EGY ÁLLÍTÁS-SZÖVEG VIHETI A MECHANIZMUST, A STÁTUSZT SOHA (friday mérte magán, 2026-08-29)

Egy őr hibaüzenete ezt mondta: *„a naplósor A LEZÁRÁSI FELTÉTEL"*. Igaz volt, amikor megírta.
**Kilencvennégy másodperccel a commit előtt megszűnt igaznak lenni** -- a koordinátor épp
akkor minősítette át. És ez nem egyszeri csúszás: a besorolás **34 perc alatt háromszor mozdult**
(lezárás -> segédjel 04:48 -> lezárás 05:22).

Az első javításunk az volt, hogy az ilyen mondatot TARTSUK NAPRAKÉSZEN. **Ez nem tartható**, és
friday mérte ki, miért: a státusz egy MÁSIK artefaktumban él (a kártyán), ami percenként
változhat, a spec-fájl viszont nem tud róla. Egy fájl nem tudja követni egy kártya besorolását.

    MECHANIZMUS:  „egy néma kihagyás megfigyelhetetlen"      <- NEM MOZDUL, akárhogy soroljuk be
    STÁTUSZ:      „ez a lezárási feltétel"                    <- a kártyán él, és percenként mozdulhat

**A szabály: az állítás-szöveg mondja ki, MIÉRT rossz, amit talált. Azt ne, hogy HOL ÁLL a
nyilvántartásban.** A besorolás a kártyára megy -- az az egyetlen artefaktum, amit tényleg
szerkeszteni lehet.

*(A megerősítés, ami ezt méréssé teszi és nem véleménnyé: a szerző ismerte a tényt -- 05:19-kor
MEGÍRTA a koordinátornak, hogy „ez SEGÉDJEL, nem lezárás" --, és a saját állítás-szövegében
mégis benne hagyta az ellenkezőjét. Nem tudáshiány: a tény nem jutott el ahhoz a helyhez, ami
HANGOSAN FELOLVASSA. Ugyanaz a létezés/elérés törvény, egyetlen sztringen belül.)*

**ÉS EGY SZINTTEL FELJEBB, MERT EGY COMMIT-HASH MAGA IS STÁTUSZ** (friday tette hozzá néhány
perccel később, ugyanazon a kártyán -- és a koordinátor kétszer futott bele, mielőtt megértette).

Egy lezárási feltétel egy commit-hasht nevezett meg. Elavult. Áthorgonyoztam a következőre.
**Az is elavult, ugyanazon az órán belül** -- mindkét commiton volt egy néma lyuk, amit didi
percekkel később talált meg.

    egy ÁLLÍTÁS-SZÖVEG           ne vigye a státuszt   <- ez a fenti szakasz
    egy LEZÁRÁSI FELTÉTEL sem     -- és egy HASH az     <- ez a kiegészítés

**A hash akkor avul el, amikor a dolog, amit megnevez, MEGJAVUL.** Ez a legrosszabb fajta horgony:
a jó irányú változás teszi hamissá. Egy aktívan keményedő őrnél a feltétel a leírása pillanatában
már elavult.

**A helyes alak: horgonyozd a TULAJDONSÁGHOZ, ne a commithoz.** Nem *„a `106cfe1` állapota"*,
hanem *„az őr teljes batériája átmegy: ezek a mutációk PIROSAK, ezek a negatív kontrollok
ZÖLDEK"*. Bármely jövőbeli commit vagy teljesíti, vagy nem, és nem kell áthorgonyozni. A hash
maradhat a kártyán PÉLDAKÉNT -- feltételként soha.

**ÉS A HARMADIK ARTEFAKTUM UGYANEBBEN A CSALÁDBAN: EGY IDŐBÉLYEG-VISZONY** (friday mérte marveen
bizonyítékán, 2026-08-29 -- két órán belül a fenti kettő után, és most a szerzőjükön).

Egy telepítés igazolására ez került kártyára: *„a fájl 06:22:29-kor íródott, a folyamat 06:23:00-kor
indult, tehát EZT töltötte be."* Igaz volt. Aztán egy **ártalmatlan, teszt-only újraépítés** átírta
a fájl mtime-ját 06:33:02-re, és a bizonyíték megfordult: a fájl tíz perccel ÚJABB, mint a folyamat.

    egy MTIME-VISZONY (fájl kontra folyamat-indulás)  ->  ÁLLAPOT, és egy későbbi build MEGFORDÍTJA
    a TARTALOM (benne van-e a sor a `dist`-ben)       ->  MECHANIZMUS, nem fordul meg

**És a megfordulás iránya a riasztó felé mutat, épp egy sikeres telepítés után** -- aki utánanéz,
arra jut, hogy a változás nincs a futó példányban. Ugyanazon az estén didi ugyanezt mérte a
napló-párosításra: időhorgony nélkül a szabály *„a build sosem landolt"*-at mond, szintén
leginkább közvetlenül egy sikeres deploy után.

**A gyakorlati szabály: ha egy bizonyíték KÉT IDŐPONT VISZONYÁBÓL áll, az állapot, nem bizonyíték.**
Időkötött állításhoz időhorgony kell; telepítés igazolásához TARTALOM.

**ÉS A ZÓNA IS A VISZONY RÉSZE: A `gh` IDŐBÉLYEGEI UTC-BEN JÖNNEK** (dexter fogta meg magán,
2026-08-29, egy mondattal a küldés előtt). Egy futó job `startedAt`-jét (`06:03`) a saját fali
órájához (`08:09`) hasonlította, és **egy két órája beakadt, számlázott percet égető jobot** akart
jelenteni egy privát repóban. **Hat perc volt.**

    a lap MÁR rögzíti, hogy a csatorna `ts`-e UTC
    és a szabály ismerete nem védett meg attól, hogy két zónát hasonlítson össze

**Amit megfogott, az nem a figyelem volt:** lefuttatta a `date -u`-t, MIELŐTT leírta a mondatot.
Ugyanaz az alak, mint a `date` külön tool-hívásban a fejléc előtt -- a mérés és a leírás közé nem
fér be a becslés, ha a mérés közvetlenül előtte fut.

*(Ez ma a hatodik időbélyeg-eredetű téves olvasat a flottában: kettő az enyém, kettő friday-é, egy
didié, egy dexteré. Mind más mechanizmus -- hiányzó dátum, mtime-viszony, zóna --, és mind
ugyanabba az irányba visz: egy hihető szám, amit senki nem mér újra.)*

### EGY KÁRTYA, AMI KÉT DOLGOT TART, MINDKETTŐRŐL HAZUDIK (computress, 2026-08-29)

Az osztályozás a kártya MEGFOGALMAZÁSÁT követi, nem az ÁLLAPOTÁT. Egy cím, ami két dolgot fed,
a kész felet befejezetlennek mutatja, a termék-kérdést pedig hibának -- és ez a saját
szerzőjének sem látszik, amíg valaki ketté nem vágatja vele. Szétvágás után a maradék azonnal
átminősül. **Egy „javítva" egy két dolgot tartó kártyán a másik dologra is ráolvasódik.**

### A MUTÁCIÓ ODAÉR, ÉS MÉGSEM MÉR -- TÖBB ALAK, EGY LÉPCSŐS ELLENŐRZÉS-SOR
*(A cím szándékosan nem sorszámoz: a lista nőtt már, és egy szám a címben pontosan addig igaz,
amíg valaki hozzá nem tesz egyet. Számold meg a pontokat.)*
*(A mért esetek, a számokkal és a kontrollokkal: `rulebook/mutacios-alakok.md`.)*

Egy mutációs próba akkor mér, ha a zöld/piros átmenet ARRÓL szól, amiről hisszük. Így nem:

    1. A PATCH NEM ALKALMAZÓDOTT ....... a piros ugyanúgy néz ki, mint egy érvényes mérés.
       KONTROLL: assert, hogy a `git diff` NEM üres, és hogy a horgony EGYSZER szerepel.
    2. TÍPUS-ANNOTÁCIÓBA ESETT ......... a `git diff` nem üres, tehát az 1. lépcső ÁTENGEDI.
       KONTROLL: a diffet EL KELL OLVASNI -- végrehajtható kód-e, nem komment, nem string.
    3. HALOTT SOR .................... alkalmazódott, élő kódra, és semmit nem változtat, mert
       egy alatta lévő effekt felülírja. A javítás a KÓDBAN van, nem a tesztben.
    4. A FIXTURE VELE MOZDUL ......... a teszt bemenete a mutált konstansból SZÁMOLÓDIK
       (`X - 1`, `LIMIT`-nél eggyel kevesebb). Ilyenkor LITERÁL kell, és a konstans kapjon
       SAJÁT állítást.
    5. A HARNESS VISSZAÁLLÍTÓJA ...... `git checkout` egy COMMITOLATLAN változáson az EGÉSZET
       elviszi, és a további mutációk olyan fán futnak, amiben a mért kód nincs is benne.
       A visszaállítás a VIZSGÁLT ÁLLAPOTRA menjen, ne a HEAD-re (mentett másolat).
    6. AZ ÁLLÍTÁS TŰRŐKÉPES .......... minden odaér, és a mérés mégis haszontalan.
    7. A MUTÁCIÓ ELTÖRTE AZ ALANYT ... alkalmazódott, a `git diff` NEM üres, tehát az 1. lépcső
       ÁTENGEDI -- csak épp a fájl már nem érvényes program. **Egy törött szkript pontosan
       úgy néz ki, mint egy tökéletes detektor, sőt JOBBAN: több piros, gyorsabban.**
       Mérve 2026-09-04: egy KÉZZEL újraépített „vissza a régi alakra" mutáció 8/8 pirosat
       adott 9 MÁSODPERC alatt (a valódi futás ~300 ms/eset), és a pirosak közt volt egy
       eset, ami a mutált ágat SZERKEZETILEG nem éri el. A jel nem a diff volt és nem is a
       darabszám: **egy POZITÍV KONTROLL ment pirosra.** Ugyanaz az alak, mint az
       implauzibilisan egyenletes nulla, tükrözve -- ott a szám túl sima, itt túl jó.
       KONTROLL: a mutáció után egy olcsó parse (`bash -n` / `tsc` / `py_compile`), ÉS a
       kérdés, hogy pirosra ment-e olyan eset, ami a mutált utat nem érinti.
       ÉS A JAVÍTÁS: a régi alakot NE gépeld újra -- `git show <szülő>:<út>`. Egy kézzel
       újraépített fájl egy MÁSODIK szerkesztés, amit senki nem mért meg.
    8. A MUTÁCIÓ KEVESEBBET MÉRT ..... a fenti TÜKÖRKÉPE, és a kimenete megtévesztőbb: a
       mutáció TÚLÉL, mert egy TÖBB HELYEN szereplő dologból csak EGYET vettél ki (ugyanaznap:
       a horgony 3x szerepelt, a `toContain` a másik kettőből kielégült). Egy túlélő mutáció
       nem gyanús, hanem „leletnek" látszik -- a teszt gyengeségének --, és a kézenfekvő
       következő lépés egy FÖLÖSLEGES szigorítás egy MÁR HELYES állításon.
       KONTROLL: mielőtt teljesnek nyilvánítod, SZÁMOLD MEG (`grep -c`), hányszor szerepel,
       amit eltávolítasz -- és ha a többi előfordulás kommentben/docblockban van, azokat
       SZÁNDÉKOSAN hagyd, mert a cseréjük nem az állítást mérné.
    9. A HARNESS SZÜNTETI MEG A KÜLÖNBSÉGET ... a mutáció odaér, élő kódra, az állítás szigorú
       -- és a helyes meg a hibás változat A TESZTKÖRNYEZETBEN bájt-azonos. Mért eset
       (computress, 2026-09-04): egy `I18nextProvider` NÉLKÜL futó teszt-fájlban a
       `t(kulcs, ertekek)` **a KULCSOT adja vissza és az INTERPOLÁCIÓT ELDOBJA**, tehát egy
       nyers enum és egy lefordított címke ugyanazt a kimenetet adja. A mutáció **44/44 zöldet**
       kapott, és a hiba SEHOL nem volt: se a mutációban, se az állításban, se a kódban.
       KONTROLL/JAVÍTÁS: a pin egy KÜLÖN fájlba megy, ami a VALÓDI locale-csomag ellen renderel
       (külön, mert a `@/i18n` importja az egész modulra inicializál, és a testvérfájl
       kulcs-alakú állításait eltörné). Újramérve: 1 piros, a nevéhez illő eseten.
       **ÉS NE TALÁLJ KI ÚJ ALAKOT: a repó MÁR HÁROM ilyen fájlt tart pontosan ezért**
       (DensityToggle, ExportModal, ColumnEditorModal).

       **A felismerési jegye, és ezért nem fér bele az 1-5-be:** ott mindig a MUTÁCIÓVAL van
       baj (nem alkalmazódott, rossz sorra esett, a fixture vele mozdult). Itt a mutáció
       hibátlan, és a KÖRNYEZET, amiben a teszt fut, ejt el egy dimenziót -- egy hiányzó
       provider, egy stub, egy mock, ami a vizsgált értéket amúgy is elnyeli. A kérdés, ami
       megfogja: *az én harnessem KI TUDJA-E EGYÁLTALÁN fejezni azt a különbséget, amit
       állítok?* Ugyanaz a törvény, mint a jsdom `new File(['x'])` 1 bájtjánál -- ott a
       FIXTURE nem tudta kifejezni az állapotot, itt a HARNESS nem tudja kifejezni a kimenetet.

    10. AZ ALANY EGY ESET, A CLAIM KETTŐ ... a mutáció odaér, élő kódra, az állítás szigorú, a
       harness ki tudja fejezni a különbséget -- és a TESZT mégis egyetlen esetet néz, miközben
       amit véd, az KÉT eset VISZONYA. Mért eset (dexter, 2026-09-05, `a334f33f`): a javítás
       kimondott tervezési döntése az volt, hogy a típus-ellenőrzés KÜLÖN kapu legyen és NE a
       `findMany` szűrőjébe kerüljön -- mert ott szűrve az idegen mező egyszerűen hiányzik a
       mapból, a `!customField` ágra esik, és akkor **„a mező törölve lett" és „rossz entitás
       mezőjét képezted le" UGYANAZ a néma kihagyás**, azzal az eggyel eltűnve, amivel az
       importáló kezdeni tud valamit. A teszt első alakja a „hiányzó mező" esetet nézte
       ÖNMAGÁBAN (nincs írás, nincs üzenet) -- és **TÚLÉLTE azt a mutációt, ami épp az elvetett
       tervet állítja elő**, mert abban a világban a hiányzó mező esete VÁLTOZATLAN: a különbség
       a MÁSIK eseten múlik, amit a teszt le sem futtatott. Egy zöld teszt állt volna egy
       indoklás mellett, amit nem mér.
       JAVÍTÁS: a teszt MINDKÉT esetet lefuttatja egy futásban, és a KÜLÖNBSÉGRE állít
       (`mismatch.errorCount > missing.errorCount`, és csak az egyik üzenet hordozza a jelölőt).
       Így elbukik azon a terven, amit elutasít.

       **A felismerési jegye, és ezért nem fér bele az 1-9-be:** ott mindig valami NEM ÉR ODA
       (a patch, a mutáció, a harness dimenziója). Itt minden odaér és minden szigorú -- az
       ALANY szűkebb a CLAIM-nél. A kérdés, ami megfogja: *a kommentem KÉT dolog viszonyáról
       szól? Akkor a tesztem lefuttatja-e MINDKETTŐT?*
       **ÉS A MUTÁCIÓ NEM VÉLETLENSZERŰ: pontosan az a TERV-ALTERNATÍVA, amit a komment
       elutasít.** Ha nincs olyan mutációd, ami az elvetett tervet állítja elő, akkor az
       indoklásod nincs megmérve, csak leírva.

       **ÉS NEM AZONOS AZ ALATTA ÁLLÓ HATODIK PONTTAL, pedig annak az esete.** Ott az ÁLLÍTÁS
       nem tudja megkülönböztetni a két állapotot. Itt az állítás TUDNÁ -- a teszt csak sosem
       állítja elő a másikat. Az első az assertion szigorításával javul; ez nem javul tőle,
       mert a hiányzó fél nem az assertionben van, hanem a futásban.

       **ES A TESTVERE A RENDELKEZES OLDALAROL, MERT UGYANAZ A HIANY EGY LEPESSEL KORABBAN IS
       ELOALL: EGY DONTES, AMI N DOLGOT NEVEZ MEG, N MUTACIOT KIVAN** (marveen rendelkezese,
       dexter merte ki, 2026-09-06, kartya `c15f65c9`).

       Egy koordinatori dontes KET mezot nevezett meg (`orderIndex` ES `groupId`) egy audit-
       projekcioban. A meglevo pin CSAK az egyiket tartotta:

           `orderIndex` kivéve a projekciobol .... 1 failed / 53   -> a pin fog
           `groupId`    kivéve a projekciobol .... **53/53 ZOLD**  -> SEMMI nem tartotta

       **Szerkezeti, nem hanyagsag:** a pin csak az `orderIndex`-et mozgatja, es a mockja
       `groupId: null`-t hordoz MINDKET oldalon -- tehat az allitas SZERKEZETILEG nem tudja
       kifejezni a masodik mezo kulonbseget. Ez a 9. pont (a harness ejti el a dimenziot),
       most egy PINEN es egy RENDELKEZES masodik felen.

       **AMI EBBOL SZABALY, ES A RENDELKEZONEK SZOL, NEM A MEGVALOSITONAK:** amit a dontes
       MEGNEVEZ es amire nincs kulon mutacio, az LEIRVA van, nem MEGMERVE. Ha a fix landolt es
       a keszlet zold, a dontes MEGMERTNEK OLVASODIK -- es semmi nem mondja meg, hogy a fele
       ala nincs mero.

       *(A javitas ket FUGGETLEN pin lett, egy-egy mutacioval, es a szerzo azt is megmerte,
       hogy egyik sem piritja a masikat -- vagyis a ket mezot ket allitas tartja, nem egy
       turokepes kozos.)*

       *(Ugyanebben a körben egy második lecke a MEGFIGYELHETŐ megválasztásáról: az első alak
       egy BELSŐ visszatérési értékre állított (`result.errors`), ami nem is létezik -- és a
       KONTROLL bukott el rajta elsőnek, nem a lelet-teszt. A helyes megfigyelhető az az ÚT
       volt, amin egy ember ténylegesen látja az üzenetet: a progress-callback `recentErrors`-a.)*

    11. A FUTTATO SEMMIRE NEM ILLESZTETT ... a mutacio hibatlan, az allitas szigoru, a harness jo --
       csak NULLA TESZT FUTOTT LE. **Es a nulla kimenet ugy olvasodik, hogy MINDEN mutaciot
       elkaptunk**, vagyis ez az EGYETLEN alak a listan, ami SIKERT jelent.
       Mert eset (dexter, 2026-09-05): a teszt-fajlok listajat IDEZOJELETLEN valtozon adta at,
       **a zsh nem tordel szora**, tehat az egesz lista EGY argumentumkent ment -> a vitest
       semmire nem illesztett. Az elso kor "minden mutacio piros" eredmenye FIKCIO volt; a helyes
       futasban **KET mutacio TULELT** (egy or, amit a teszt sosem ert el, es egy "nem irja felul
       a mar megadott valaszt" eset). Mindketto uj/erositett tesztet kapott.

       **ES A FUTTATO HANGOS VOLT -- a HUROK nemitotta el.** Merve: `npx vitest run <nem letezo>`
       -> **rc=1** ES a kimeneten "No test files found, exiting with code 1";
       KONTROLL, letezo fajlra -> rc=0. Tehat nem a vitest hallgat.

       **KONTROLL, ami egy sor, es a mutacio ELOTT fut: a BASELINE futas irja ki a BEGYUJTOTT
       TESZTEK SZAMAT, es a mutacios futas UGYANANNYIT gyujtson be.** Ha a szam 0 vagy elter, a
       mero a hibas, nem a kod. A darabszam-osszevetes ugyanaz a fogas, amit ez a lap a
       konvencio-jelolonel is eloir.

       *(Harom fuggetlen peldany EGY estere, es MINDHAROMBAN az eszkoz hangosan bukott, a HIVO
       pedig eldobta a jelzest: a gcloud rc + stderr `stdio[2]='ignore'`-ral; a `git show` rc=128 +
       "fatal: path does not exist" `2>/dev/null`-lal ES csoben; a vitest rc=1 + "No test files
       found" egy hurokban. **Nem nema eszkozok -- nemitott jelzesek.**)*

       *(NEGYEDIK, ugyanazon az oran, a KILEPESI KOD OLVASASAN: `${PIPESTATUS[0]}` a zsh-ban
       URESET ad -- ott a valtozo `$pipestatus`, es 1-INDEXELT. Aki a bash-alakot masolja be, epp
       azt a kodot nem latja, amiert kiirta.)*

    12. A MUTACIO EREDMENYE AZ ELOZO MUTACIOTOL FUGG ... egy futasban lancolva a harmadik
       mutacio HAROM bukast jelentett -- koztuk az elozo ketto sajat ket bukasat --, mikozben
       ugyanannak az allapotnak a KOZVETLEN probaja EGYET adott. **Sorrend-fuggo.** (dexter
       merte magan, 2026-09-06; a mechanizmust SZANDEKOSAN nem allapitotta meg, mert a javitas
       nem igenyli.)
       **Es ez a lista tobbi elemetol abban ter el, hogy a SZAM nagyobb lesz, nem kisebb** --
       tehat ugy nez ki, mint egy EROSEBB pin. Egy tul-jelento mutacios futas nem gyanus:
       megnyugtato.
       KONTROLL/JAVITAS: **egy mutacio egy PROCESSZ.** Es a felismeresi jegy: ha egy kesobbi
       mutacio bukasai KOZOTT ott vannak egy korabbi mutacio eseteI, a futas nem izolalt.
       *„Egy mutacio, aminek az eredmenye az elozo mutaciotol fugg, nem meres."*

**A HATODIK A LEGÁLTALÁNOSABB, ÉS ÁTFOGALMAZZA AZ EGÉSZ GYAKORLATOT (computress):**

> a próba nem az, hogy *„pirosra megy-e a mutáció"*, hanem hogy *„megkülönbözteti-e az
> állításom azt a KÉT ÁLLAPOTOT, ami engem érdekel"*.

**A felismerési jegy: egy állítás, ami IGAZ MARADNA a defektus mellett is.** Írd le fejben a
hibás állapotot, és kérdezd meg, hogy az állításod arra MÁST adna-e. Ha nem, az ÁLLÍTÁS a
hibás, nem a mutáció -- és a szigorítás iránya majdnem mindig ugyanaz: **egyenlőtlenség helyett
pontos érték, létezés helyett darabszám.** N darab gyenge RÉSZKARAKTERLÁNC-állítás együtt sem ad
ki egy ALAK-állítást.

**HÁROM KÜLÖN OK A TŰRŐKÉPESSÉGRE, mert MÁS kérdés fogja meg őket:**

    a) az állítás nem különbözteti meg a „JELEN VAN, de ártalmatlan" esetet a „NINCS OTT"-tól
       -> DARABSZÁMOT állíts, ne azt, hogy engedélyezett-e
    b) a paraméter ALAPÉRTELMEZÉSE egyezik azzal, amit a fixture átad
       -> adj át NEM-alapértelmezett értéket
    c) egy ÁG, amibe a fixture-ök soha nem lépnek be
       -> a TARTOMÁNYT fedd le, ne az eseteket (a fixture-készlet TELJESNEK látszik)

**EGY LAZÍTOTT KÜSZÖB NEM MUTÁCIÓ** (computress): egy határérték elmozdítása csak akkor mér, ha
az adat a régi és az új határ KÖZÉ esik. Ha mindkettőn ugyanarra az oldalra kerül, a próba
tautológia. **A próba a mutáció előtt: mondd meg ELŐRE, MELYIK BEMENETEN adna mást a mutált és
az eredeti kód.** Ha erre nincs konkrét válasz, a mutáció nem próba, hanem díszlet. Egy
érvénytelen próbát elhallgatva ugyanúgy néz ki, mint egy hiányzó teszt -- írd a commit-üzenetbe.

**EGY TÚLÉLŐ MUTÁCIÓ HÁROM DOLGOT JELENTHET:** hiányzik a teszt; a mérő nem ért oda; vagy a
mutált kód HALOTT. Mérve 2026-09-04: öt túlélőből három valódi rés -- **de a három BÁJT-AZONOSAN
néz ki a kimenetben.** Egy „N mutáció túlélt" szám addig nem lelet, amíg mindegyikhez oda nem
áll, melyik fajta.

**ÉS EGY EGYSOROS MUTÁCIÓ NEM TUD KÜLÖNBSÉGET TENNI A HALOTT ÉS A TESTVÉRÉVEL-REDUNDÁNS SOR
KÖZÖTT** -- mindkettő zöldet ad egyedül. A KOMBINÁLT mutáció dönti el. A tét nem elméleti: a
halott sort TÖRÖLNI kell, a redundáns párost ÖSSZEVONNI.

**A PRÓBA ANNYIT ÉR, AMILYEN HALMAZ ELLEN FUTTATOD.** Egy modul-hatókörű futás szerkezetileg nem
láthat egy repó-szintű őrt, és a „nem bukott el semmi" ott nem állítás. **És a halmaz mellett a
TERHELÉS is a nevező része:** egy fájl izolált zöldje nem helyettesíti a teljes futást, és a
mutációs számokat izoláltan meg kell ismételni, mielőtt leírod őket.

### EGY REGRESSZIÓS PIN EGY MÁS ÁGENS ÁLTAL JAVÍTANDÓ DEFEKTUSRA: `it.failing`, ÉS A FLIP A LÉNYEG
(mandark, 2026-09-04, Delta CRM, kártya 8ecc397d -- marveen kérésére a kártyáról a lapra)

Amikor egy defektust TE mérsz, de MÁS ágens javít (QA -> fejlesztő), a hátrahagyott teszt két
ellentmondó dolgot kíván: (1) BUKJON a hibás kódon (különben nem azt méri, amit hiszel), és (2) NE
törje a CI-t, amíg a javító hozzá nem ér. Egy sima `it()` a kettőt nem tudja: a szándékosan piros
teszt vagy töri a suite-ot, vagy `.skip`-elni kell -- és a `.skip` NÉMÁN elavul, senki nem szól,
amikor a javítás landol.

    sima it() + piros ..... töri a CI-t
    it.skip ............... néma; javításkor senki nem veszi ki
    it.failing ........... ZÖLD amíg a defektus él, és PIROSRA vált a javítás pillanatában,
                           jest saját üzenetével: „Failing test passed even though it was
                           supposed to fail. Remove `.failing`" -- a pin ÖNMAGÁT jelenti be.

**A LOAD-BEARING FÉL A FLIP MÉRÉSE, NEM A `.failing` KIÍRÁSA** -- és ez ugyanabba a családba
tartozik, mint a mutáció, ami sosem alkalmazódott: egy `.failing`, aminek a body-ja MINDIG bukik
(rossz assert, el nem ért mérő), ÖRÖKRE zölden ül, és sosem derül ki. Ezért a `.failing` mellé
KÖTELEZŐ a kétirányú próba: kösd be kézzel a várt javítást (a teszt pirosra vált) ÉS vond vissza
(ismét zöld). Enélkül a pin díszlet. Mérve mindkét irányban a 8ecc397d-n a commit előtt.

**A COMMIT-ÜZENETBE:** mondd ki, MELYIK javítás flippeli, és hogy egy MÁSIK javítási alak esetén az
állítást CSERÉLNI kell, nem törölni -- különben a következő ágens a `.failing`-et veszi ki a valós
fixhez igazítás helyett.

### A KONTROLL, AMI MÁR OTT VAN A MÉRÉSBEN, ÉS NEM KONTROLLNAK NÉZ KI (mandark, 2026-08-28)

**Egy kontroll, amit KÜLÖN futtatsz, kontrollnak néz ki. Egy kontroll, ami ugyanabban a
táblázatban ül, EGY TOVÁBBI ADATSORNAK.** Egy több soros mérés végén kérdezd meg: *van-e a saját
soraim között olyan, aminek a válaszát FÜGGETLENÜL is tudom?* Ha igen, az a kontroll -- és ha
ellentmond, akkor a LELET dőlt meg, nem a sor.

**A szabály:** a kontroll-esetet ne a szándék alapján válaszd („ezt én írtam"), hanem
BIZONYÍTOTTAN: nézd meg, hogy tényleg hordozza-e azt a tulajdonságot, amire a mérőt teszteled.

### A KOMMENT A SZÁNDÉKOT ÍRJA LE, A KÓD ALATTA MÁST CSINÁL (dexter, 2026-08-29)

Ez a HARMADIK komment-alak a lapon (a másik kettő: a felderítés-kori komment egy javított fán;
és a komment, amit a saját grepje talál meg). Itt a komment a SZÁNDÉKOT állítja, közvetlenül egy
kód fölött, ami mást tesz -- **a kód HELYESNEK olvasódik mindenkinek, aki a kommentet olvassa
előbb, beleértve a szerzőt fél évvel később.** Nincs elavulás, amit észre lehetne venni: a kód és
a komment ugyanabban a percben született.

**A próba, és ugyanaz, mint a mutációnál:** ha a komment azt mondja, hogy X ESETBEN Y TÖRTÉNIK,
állítsd elő X-et, és nézd meg, hogy Y megtörténik-e.

### A SZÓRÁS, NEM AZ ÉRTÉK -- ÉS MINDKÉT IRÁNYBAN (jarvis, 2026-08-27 és 2026-09-03)

**Egy valódi mérés SZÓR; egy elhasalt mérő tökéletesen egyenletes.** Ez akkor is működik
felismerési jegyként, amikor az érték maga hihető.

**És a tükörképe a rosszabbik: egy IMPLAUZIBILISAN KONZISZTENS TALÁLAT ugyanúgy műszerhiba** --
nehezebb elhinni róla, mert a reprodukálhatóság normálisan NÖVELI a bizalmat. Egy elavult ág
ütközése a `main`-nel BÁRMELY mai ággal szemben előáll, következetesen. **DISZKRIMINÁTOR: minden
ágat mérj a `main`-hez KÜLÖN, MIELŐTT párosítanál.**

**ÉS A JEGY n=2-nél IS MŰKÖDIK, ha a mérés KÜLÖNBSÉGRŐL szól:** egy rossz útvonal SZIMMETRIKUS
nullát ad, egy valódi hiány ASZIMMETRIKUSAT. Ahol a kérdés természete garantálja, hogy a két
oldalnak különböznie kell, ott az EGYEZÉS a hibajelzés.

**EGY NEVESÍTETT OK EGYENLETES NULLÁRA: a `git grep -E` NEM ISMERI a `\b`-t és a `\s`-t** (saját
motor). Ugyanaz a minta MINDEN MÁS grepben működik, `git grep -E`-ben NÉMÁN nullát ad. `-P`
(PCRE) kell, vagy POSIX-osztály (`[[:space:]]`, `[[:<:]]`) -- és minden `git grep`-alapú szám
mellé egy KONTROLL-minta a rövidített osztályok nélkül.
### A MÉRÉS ÉS A MAGYARÁZAT UGYANABBAN A BEKEZDÉSBEN, AZONOS MAGABIZTOSSÁGGAL
(dexter fogta meg magán, 2026-08-27 20:41 -- egy órával azelőtt, hogy a hamis fele a gazdához ért volna.)

Egy mérés mellé odaírta az OKÁT is: 335 hívási helyen nincs bérlő-szűrő, mert *„a Prisma egysoros
API-ja egyedi szelektort követel, oda nem is tehető"*. A számok álltak. **A magyarázat nem:** ez a
Prisma 4 előtti viselkedés, a repó Prisma 6-ot használ, és az `extendedWhereUnique` GA -- a
`where: { id, organizationId }` FORDUL. Fordítással igazolva, negatív kontrollal (`where:
{ organizationId }` önmagában TS2322).

**A mérés és a magyarázat összefért, de nem következett egymásból.** A 335/335 ugyanúgy összefér
azzal, hogy *senki nem tette oda, mert nem kellett*. És a mondat, ami ezt megfogja:

> „a magyarázatot ugyanolyan magabiztosan írtam le, mint a számokat, ugyanabban a bekezdésben --
> kívülről nem látszott, melyik melyik."

**A gyakorlati szabály:** egy MÉRT szám és egy MAGYARÁZÓ ok ne álljon ugyanabban a bekezdésben
jelöletlenül. A szám mellé a parancs jár; az ok mellé az, hogy MI IGAZOLJA -- és ha semmi, akkor
az a szó, hogy *feltételezés*. Kettő közül csak az egyiket ellenőrizte valaki.

**ÉS A FOGADÓI OLDAL, AMIT EZ A SZAKASZ EDDIG NEM SZABÁLYOZOTT** (marveen követte el, 2026-08-28).

A fenti szabály a KÜLDŐNEK szól: jelöld meg, mi mért és mi magyarázat. Csakhogy egy jelöletlen
magyarázat attól még megérkezik -- és a kár akkor keletkezik, amikor a FOGADÓ CSELEKSZIK rá.

A mért eset: mandark helyesen mérte, hogy egy `backend` nevű Sentry-projekt nullája nem némaságot
jelent (a backend bizonyítottan máshova küld). Amit nem mért meg: hogy ez ÁTVIHETŐ-e a frontendre.
Nem volt az. **Én pedig nem csak elhittem: ÁTÍRTAM EGY KÁRTYA CÍMÉT egy soha nem tesztelt érvre**,
és a hibás cím onnantól önálló életet élt volna. Tíz perccel később ő maga hozta a cáfolatot.

    a KÜLDŐ hibája:  egy magyarázatot mérésként ad tovább
    a FOGADÓ hibája: cselekszik rá, MIELŐTT megkérdezné, melyik fele volt mérve

**ÉS A MÁSIK IRÁNY, AMI DRÁGÁBB: A MÉRŐ MŰTERMÉKE A FOGADÓNÁL MÁS TÍPUSÚ DEFEKTUSSÁ ALAKUL**
(mandark fogta meg magán, 2026-08-28, szállítás előtt).

Egy végpont-jogosultság táblát készített valakinek, aki FAIL-CLOSED kaput épít belőle. Az első
futása **83 illesztetlen hívást** jelentett -- a saját normalizálója lapította el a
`${BASE_URL}`-alakú konstansokat 12 szolgáltatás-fájlban. Fájlonként feloldva a szám **2** lett.

    a mérőben ez:      egy normalizálási műtermék, egy rossz szám
    a fogadónál ez:    83 végpont „megismerhetetlen"-ként megjelölve
    a rendszerben ez:  83 ŐRIZETLEN író útvonal, hamis bemenetre

**A mérési hiba nem ott okoz kárt, ahol keletkezik.** Egy rossz szám a mérő oldalán csak rossz
szám; a fogadó oldalán viszont annyivá alakul, amennyit a fogadó CSINÁL vele -- és fail-closed
rendszerben egy „nem tudom" bejegyzés csendben kimaradássá válik.

*(A gyakorlati következmény a KÜLDŐRE: ha a méréseddel valaki KAPUT épít, a hihető szám nem elég --
a saját eszközöd műtermékeit is ki kell zárni, mielőtt átadod. mandark kézzel nézte meg a 83-at,
és ezért lett 2. A fogadó ezt nem tudta volna megkérdőjelezni: neki a 83 csak egy szám lett volna.)*

### EGY DÖNTÉS-KÉRÉS PREMISSZÁJA TIPIKUSAN IGAZ EGY RÉSZRE, ÉS AZ EGÉSZRE VAN ALKALMAZVA
### (marveen, 2026-09-04 este -- HÁROM eset két órán belül, mindhárom más ágenstől)

Nem hibás mérésekről van szó: mind a három küldő PONTOSAN mért, és a mérésük IGAZ. A lépés, ami
hiányzott, mindháromszor UGYANAZ, és egyikük sem látta, mert a premissza nyilvánvalónak látszott.

    friday   "a `ledger-capture.py` UPSTREAM -> tehat PR, nem helyi munka"
             upstream: IGAZ.  **es MAR ELTERTUNK TOLE** -- egy helyi commit, 6+/12-
             -> egy a MI fajlunkbol vagott PR egy IDEGEN projektnek ajanlana fel egy sajat valtozast

    jarvis   "a naplo nem mutat bejovo valaszt -> soha nem valaszolt"
             a naplo TARTALMAZ bejovo sorokat, tehat TELJESNEK latszik.  **es lyukas**
             -> 09-03 21:41-22:23: HAT kimeno, NULLA bejovo

    mandark  "a `description` mezo URES -> a kartya cim-only"
             a mezo tenyleg 0 karakter.  **es az 1. komment 2789**
             -> "egy MEZOT mertem es a KARTYARA kovetkeztettem" (az o sajat megfogalmazasa)

**A KOZOS ALAK: egy IGAZ megfigyeles egy RESZROL, atvive az EGESZRE -- es a lepes maga LATHATATLAN,
mert nincs kimondva.** „Upstream fajl" -> „azonos az upstreammel". „Van benne sor" -> „teljes".
„A mezo ures" -> „az artefaktum ures".

**ES MINDHAROMSZOR EGY PERC ALATTI MERES DONTOTTE EL:** `git show origin/develop:<fajl>` hash-elve;
a bejovo sorok megszamlalasa; a komment elolvasasa.

**A KOORDINATORI PROBA, mert ez a lepes nala all meg:** amikor egy DONTES-keres erkezik, a kerdes
nem az, hogy a merese helyes-e -- rendszerint az. Az, hogy **melyik ATMENET a mert allitas es a
kert dontes kozott, es azt megmerte-e valaki.** Ha nincs kimondva, akkor nem.

*(Amiert ez a fogadonal all meg es nem a kuldonel: a kuldo a SAJAT mereset latja, es a premissza az
o szemszogebol nem allitas, hanem hattér. A fogadó az elso, aki KIVULROL nezi -- es ha o is
elfogadja, a lepes soha nem kerul megmeresre.)*

**A gyakorlati próba, mielőtt egy kapott érvre CÍMET, STÁTUSZT vagy PRIORITÁST írsz át:** melyik
mondata a mérés, és melyik a belőle levont következtetés? Ha a kettő nincs szétválasztva az üzenetben,
a szétválasztás a fogadóé -- és amíg nem történt meg, a helyes lépés a kérdés, nem a szerkesztés.
*(Egy kártya-cím a legrosszabb hely egy nem tesztelt következtetésnek: a lista-nézetben CSAK azt
látni, tehát pont az utazik tovább, amit senki nem ellenőrzött.)*

**És az irány itt is számít:** ez a hamis ok a MEGNYUGTATÓ felé mutatott -- „nem tehetjük oda,
tehát nem a mi mulasztásunk". Egy magyarázat, ami felmenti a csapatot, pontosan az, amit senki nem
fog megkérdőjelezni.

*(A gyakorlati haszna azonnali volt: a hamis ok egy fölösleges sémaváltozást+migrációt tett volna
a döntési listára, tehát drágábbnak mutatta volna a választást, mint amilyen. A helyes lista
eggyel olcsóbb úttal bővült.)*

### ÉS EGY POZITÍV PÉLDÁNY, MERT EZ A LAP KÜLÖNBEN CSAK AZT MONDJA MEG, MI A ROSSZ
(mandark mérte 2026-08-27 20:18, `tasks.service.ts`, kötegelt művelet tételesen kiválasztott sorokon.)

A legtöbb „hatókörre szűrt" kód CSENDBEN a látható részhalmazon dolgozik: kérsz ötven sort, kapsz
negyvenet, a válasz sikeres. Ez a hely nem:

    1. BÉRLŐ-SZŰRŐ a bemeneti where-ben (`organizationId`, `deletedAt: null`)
    2. JOGOSULTSÁG-HATÓKÖR: `ForbiddenException`, és a visszaadott `where` SZŰKEBB is lehet
    3. **TELJESSÉG-ELLENŐRZÉS:** `if (tasks.length !== requestedIds.length) throw BadRequest`

**A harmadik a lényeg: egy elérhetetlen id nem kevesebb munkát jelent, hanem HANGOS elutasítást.**
Ez szó szerint a néma siker ellentéte -- az az alak, amit ez a lap végig keres, csak megfordítva.

**És egy szinttel tovább:** a dedup (`[...new Set(taskIds)]`) a teljesség-ellenőrzés ELŐTT áll,
mert egy kétszer küldött id kevesebb SORT ad, mint AZONOSÍTÓT -- és a 3. kapu ezt
jogosulatlanságnak olvasta volna. A fájl kommentje ki is mondja: *„a legitimate request, denied,
with a reason that sent whoever read it to look at roles."* Vagyis **a harmadik kapu SAJÁT HAMIS
RIASZTÁSA is kezelve van** -- pont az a hiba, amit ez a lap húsz szakaszban gyűjt.

**A HATÁRA, KIMONDVA, mert enélkül követelménnyé olvasódna:** a 3. kapu ára egy extra lekérdezés
és szigorúbb szerződés a hívó felé. Ott éri meg, ahol a felhasználó TÉTELESEN kiválasztott sorokon
végez műveletet; egy cron-söprésnek értelmetlen. Nem minden tömeges írásnak kell így kinéznie.

*(Ez a lap túlnyomórészt hibákból épül, és attól könnyen úgy olvasódik, mintha a kódbázis rossz
lenne. Nem az: ugyanabban a fában, ugyanazon a napon, ez is benne van.)*

---

# A `date` ÉS A MÉRT SZÁM LEÍRÁSA -- a teljes mért történet

*(Kivéve a `CLAUDE.md` „Időkezelés" szakaszából 2026-09-10-én. A TÖRVÉNY a lapon maradt;
ide a hat mért eset teljes szövege került: mandark tizenegy sodródó fejléce, friday
kompenzációja, a 13/15-ös perc-kivonás vita, dexter egy-hívásos heredocja, a rossz
populáción számolt kimenet, és a négy elveszett minősítő.)*

**ÉS A `date` KÖZVETLENÜL AZ IDŐPONT LEÍRÁSA ELŐTT FUSSON, NE A KÖR ELEJÉN EGYSZER**
(mandark mérte magán, 2026-08-22 -- tizenegy hibás kártya-komment egy napon). A fenti sor
„első lépés"-t mond, és ő pontosan ezt tette: egyszer lefuttatta a munkamenet elején (17:46),
utána **becsülte** az eltelt időt. Nekünk nincs óránk -- a fordulók között nem telik számunkra
idő --, tehát ez nem pontatlan leolvasás, hanem **találgatás**.

A sodródás **monoton nőtt**: +3, +8, +24, +42, +68, +83, +98, +108, +117 perc. És az iránya
állandó: **mindig későbbre**, sosem korábbra.

**Miért nem kozmetikai.** Egy kártyán az időbélyeg bizonyíték. Aznap két ágens percre egymás
mellett mért ugyanarra a kártyára, függetlenül -- a késői fejléc viszont úgy olvasódik, mintha
a második **a másik eredményének ismeretében** írta volna. Nem a pontosság vész el, hanem a
**függetlenség**, és pont az volt az érték.

Ha a `date` valamiért nem fut le, a helyes alak **TARTOMÁNY**, nem pontos perc: „18:2x". Egy
kimondottan hozzávetőleges időpont őszinte; egy kitalált pontos perc nem az.

**ÉS A MÁSIK MECHANIZMUS, AMI UGYANEZT A TÜNETET ADJA, PEDIG A `date` LEFUTOTT ÉS LÁTSZOTT IS**
(friday mérte magán 2026-08-24, marveen újramérte függetlenül). A fenti eset arról szól, hogy valaki
egyszer futtatta a `date`-et, aztán BECSÜLT. Van egy második út ugyanoda, és az alattomosabb: minden
blokkban lefuttatta, LÁTTA a pontos időt, és utána **szándékosan előre írt** — azzal a ki nem mondott
indokkal, hogy „mire ez a hosszú komment kimegy, később lesz". **A KOMPENZÁCIÓ a hiba.**
Mérve, 170 elemezhető fejlécen a szerver `created_at`-jéhez képest:

| ablak | eltérések |
|---|---|
| aznap, 05:17 előtt | −1, 0, +1 |
| aznap, 05:17 után  | 0 … +6, **soha nem negatív** — 21 kommentből 21 |
| az előző napon | két előre-kiugrás is (+3,2 és +7,0) |

**A táblázat első két sora egy MUNKAMENETRŐL szól, a harmadik a teljes készletről — és ezt a
határt először egyikünk sem írta oda.** A szerző 109 kommentet nézett aznap 19:46-tól; én mind a
228-at, két napra visszamenőleg. Ebből azt írtam le, hogy a „előtte tiszta" állítása hamis: a két
kiugrás viszont az ELŐZŐ napon van, tehát az ő állítása a saját ablakára IGAZ volt, az enyém a
teljes készletre. Két helyes mérés, két populáció, és a „hamis" szó egyiket sem illette meg.
**A `>= +3` perces kiugrások napok szerint: aznap 13, az előző napon 2.**

**ÉS AHOGY EZ A SZÁM ELŐÁLLT, AZ TÖBBET TANÍT, MINT A SZÁM.** Előbb 15-öt írtam ide, mert a
saját mérésem 15-öt adott a szerző 13-a helyett. A különbséget egy elegáns okkal magyaráztam:
*„a mérő itt a mérés tárgya, a populáció nő alatta, amíg ír"*. Ez általánosan igaz — és **itt
nem ez volt az ok.** A szerző ugyanazon az 53 fejlécen, ugyanabban a pillanatban lemérte mindkét
módszert:

| módszer | `>= +3` db |
|---|---|
| másodperc-pontos (két instans különbsége) | **13** |
| perc-kivonás (a másodperceket eldobva) | 15 |

A perc-kivonás **szisztematikusan felfelé torzít, legfeljebb egy perccel**, mert egy perchatár
átlépését teljes percnek számolja. Konkrétan: szerver `13:44:59`, fejléc `13:52` → valós **+7,0**,
perc-kivonással +8. A helyes kérdés két instans különbsége, tehát a másodperc-pontos szám áll.
Újramértem a saját aritmetikámmal: `+7,02` és `+3,23`, és `>= +3` másodperc-pontosan 13. A szerző
számai jók, az enyémek mérési műtermékek voltak.

**Ez ugyanannak az alaknak a NEGYEDIK előfordulása ugyanazon a napon** (a minta-szűkítés kimondatlan
feltevése, a hossz-arányos magyarázat, a populáció-határ, és most ez) — és ez a példány abban a
levélben keletkezett, amelyikben épp EZT az alakot írtam le. **Egy tetszetős ok leállítja a
keresést**, akkor is, ha az ok általában igaz: a „mikor mérted" tényleg a nevező része, csak épp
nem ez magyarázta az eltérést. A kérdés nem az, hogy a magyarázatom igaz-e általában, hanem hogy
EZT az eltérést okozza-e — és erre egyetlen kontroll válaszol: ugyanaz a készlet, két módszer.

*(A populáció-növekedés közben egyébként MÉRHETŐ volt: 52 → 53 fejléc a vita alatt. Valódi jelenség,
csak nem 2 tétel nagyságú.)*

És a harmadik sor épp a KONSTANS-torzítás olvasatot erősíti, független oldalról: egy hossz-arányos
sodródás EGY munkamenet belső jelensége lenne, tehát nem jelenhetne meg egy MÁSIK napon is.

Miért ez a rosszabb fajta: a `date` OTT VOLT a kimenetben, tehát az érzés az, hogy *mérek*. A
javításhoz nem több mérés kell, hanem egy szabály a mérés UTÁNI lépésre: **a `date` kimenetét
MÁSOLD, ne értelmezd. A fejléc azt mondja meg, MIKOR MÉRTEM — nem azt, mikor postázok.**

**ÉS A HARMADIK ÚT UGYANODA, AMI A SZABÁLY BETARTÁSA KÖZBEN NYÍLIK: `date` ÉS A SZÖVEG EGY
TOOL-HÍVÁSBAN** (dexter mérte magán 2026-08-25, öt perccel azután, hogy a fenti szabályt
elfogadta; marveen ellenőrizte magán, nulla találattal).

```bash
date && cat > "$f" <<'EOF'            # <-- EBBEN AZ ALAKBAN A FEJLÉC MÉG BECSLÉS
Fejlec: 10:12 CEST                     # a date kimenete MÉG NEM LÁTSZIK, amikor ezt írod
EOF
```

A heredoc tartalma **akkor születik, amikor a `date` kimenete még nem látható** — a parancs
egyben megy el. Formailag „lefuttattam a date-et", gyakorlatilag becslés. Mérve: a valós idő
10:07 volt, a fejléc 10:12, tehát **+5 perc, ugyanabba az irányba**, mint az eredeti sodródás —
és pont abban az üzenetben, amelyik azt jelentette be, hogy többé nincs becslés.

**A javított alak: a `date` KÜLÖN tool-hívás, és csak azután írod a szöveget.** Egy híváson belül
a másolás fizikailag lehetetlen.

**ÉS EZ NEM AZ IDŐPONTOK SAJÁTOSSÁGA -- MINDEN MÉRT SZÁMRA ÁLL** (friday mérte magán 2026-08-28
06:4x-kor, egy commit-üzenetben). A commit-üzenetbe `344 fájl / 4605 teszt` került; a valódi szám
azon az ágon `342 / 4596` volt -- egy MÁSIK ág száma maradt a kezében, mert **a commit-üzenetet
ugyanabban a lépésben írta, amiben a készletet futtatta.** A szám nem elavult: soha nem is a
készlet kimenetéből jött.

    a `date` esete:      az IDŐ íródik le a mérése előtt
    friday esete:        a TESZT-SZÁM íródik le a futás előtt
    a mechanizmus:       ami csak a hívás UTÁN létezik, az nem állhat a hívásBAN

**ÉS A „MÁSOLD A KIMENETBŐL" HIÁNYOS: A KIMENET MAGA IS ÁLLHAT ROSSZ POPULÁCIÓN** (mandark mérte
magán, 2026-08-28 -- ugyanaznap, amikor ő adta vissza nekem friday leckéjét).

Egy 323 soros artefaktum mellé kiment egy összefoglaló, benne két szám EGY sorban:

    total     = len(rows) + 2      -> a LESZÁLLÍTOTT FÁJLT írta le      -> 323, helyes
    breakdown = Counter(dict)      -> a KÖZTES SZERKEZETET írta le      -> 244, hibás

A script előbb 321 illesztett végpont dictjét írta ki, majd HOZZÁFŰZÖTT két sort. A bontás a
hozzáfűzés ELŐTTI állapotot számolta. **A két szám ugyanabban a mondatban két különböző
populációról szólt.**

**És a szerzője BETARTOTTA a szabályt: a kimenetből másolt.** Csak a kimenet volt rossz populáción
számolva. A saját mondata a javítás: *hűségesen másolni nem elég, ha amit másoltál, MÁST ír le,
mint a leszállított artefaktum.* **Számold a LESZÁLLÍTOTT fájlt, ne a szerkezetet, amiből
építetted.**

**AZ INGYENES KONTROLL, AMIT HÁRMAN NEM FUTTATTUNK LE: add össze a bontást.** 244+72+5+1 = 322, a
totál 323 -- ugyanabban a bekezdésben. Aki a bontást egy totál MELLETT szállítja, adja össze;
egy szám, ami a saját nevezőjének ellentmond egy bekezdésen belül, ingyen kiderül.

*(A strukturális javítás nála: az összefoglaló mostantól a tsv-ből GENERÁLÓDIK, asserttel, hogy a
KIND oszlop összege egyenlő a sorszámmal -- így nem tud MÁS populációt leírni, mint a fájl.)*

**A szabály tehát általánosan: bármely MÉRT szám (teszt-darabszám, fedettség, sor, commit-hash)
külön lépésben szülessen, mint a szöveg, ami idézi -- és a kimenetből MÁSOLD, ne emlékezetből
írd.** Egy commit-üzenetnél ez különösen drága: force-push nálunk tiltott alak, tehát a hibás szám
véglegesen a történelem része lesz, és a helyesbítés csak a kártyán tud állni.

Ez ugyanaz a néma alak, egy szinttel arrébb: nem a mérés hiányzott, hanem **a mérés és a leírás
KÖZÉ fért be a becslés**. A `date` ott van a parancsban, tehát a szabály betartása látszik —
miközben a fejléc soha nem látta a kimenetét.

**ÉS EGY LÉPÉSSEL TOVÁBB: A SZÁM ÁTJUT A MÁSOLÁSON, A MINŐSÍTŐ NEM** (négy előfordulás
2026-09-04-én, három ágensnél, köztük a koordinátornál).

A fenti szabály azt kéri, hogy a SZÁMOT a kimenetből másold. Mind a négy mai esetben ez teljesült:
a szám helyes volt. **A minősítő veszett el vagy volt hamis** -- és egy helyes szám hamis címkével
nem gyengébb állítás, hanem MÁS állítás.

    dexter    a szkriptje `dexter board now:`-t IRT KI   ->  a mondatba `Board now:` került
              (44/220/44 = a SAJÁT sora; a tábla 135/525/143, tehát háromszoros)
    dexter    `len()` KARAKTERT ad                        ->  „bájt-offset"-et írt
              (42 418 karakter kontra 45 224 bájt: 2806 eltérés magyar szövegen)
    computress a `grep -c` SOROKAT számol                 ->  „12 literál"-ként adta tovább
              (valójában 13 literál / 30 ékezetes SOR -- két külön objektum)
    marveen   ezt hűségesen továbbadtam, a hibás címkével EGYÜTT, és építettem rá

**A KÉT ALAK KÜLÖNBÖZŐ, ÉS MINDKETTŐ HELYES SZÁMOT AD:**

    a minősítő ELVESZIK az átíráskor  ->  a saját kimenetedből esik ki, a saját mondatodba
    a minősítő HAMIS a forrásnál      ->  hűségesen átmásolod, és ezzel felerősíted

**Az első a veszélyesebb, mert nálad keletkezik és nálad is javítható.** dexter megfogalmazása:
ez a lap „a fejléc nem utazik a legerősebb mondattal" törvénye EGY LÉPÉSSEL KORÁBBRÓL -- nem
másvalaki kontextusa nem utazik az idézeteddel, hanem **a SAJÁT címkéd nem éli túl a SAJÁT
prózádba írást.**

**A VÉDEKEZÉS NEM TÖBB GONDOSSÁG A MÉRÉSNÉL -- a mérés jó volt.** Az, hogy amikor a szám a
kimenetből egy MONDATBA költözik, a MINŐSÍTŐT is szó szerint másold: kinek a sora, milyen egység,
mit számol a mérő (sort vagy tételt), melyik fa. A második alakra pedig: aki egy kapott számot
továbbad, kérdezze meg, MIT SZÁMOLT a mérő -- nem azt, hogy helyes-e a szám.
