# Merge-kerdesek -- a MERT ESETEK

Ez a fajl a `CLAUDE.md` „EGY MERGE-JAVASLAT TOBB KERDEST KIVAN" szakaszabol kiszervezett
BIZONYITEK-anyag: a 2026-08-27-i negy ellenorzes reszletei, a seam ket bukasanak teljes leirasa,
az RBAC-detektor ket hamis lelete, es a torles fele tevedo allitas esete.

**A TORVENY NEM ITT VAN, HANEM A `CLAUDE.md`-BEN.** Ha ellentmondast latsz, a lap az ervenyes, es
ez a fajl az elavult -- ide nem ir vissza senki, amikor a lapon javit.

Kiszervezve: 2026-09-11, kartya `ed1c9734` (Isti kerte: keret-fajdalom).
A kiszervezes modszere: minden ITT ALLO sor a lapon ALLT, es az assert a torles ELOTT futott le.

---


## EGY MERGE-JAVASLAT TÖBB KÉRDÉST KÍVÁN, MINT EGYET -- ÉS A LISTA NŐTT (2026-08-27, majd 09-11)

## EGY MERGE-JAVASLAT TÖBB KÉRDÉST KÍVÁN, MINT EGYET -- ÉS A LISTA NŐTT (2026-08-27, majd 09-11)
*(A cím szándékosan nem mond számot. Négy kérdéssel indult; ma öt áll itt, és az ötödiket két
ágens MÉRTE ki egy napon. Számold meg a sorokat, ne a címet idézd.)*

Ma egy köteg-javaslat háromszor ment át ellenőrzésen, és **mindhárom más kérdésre válaszolt** --
egyik sem volt fölösleges, és a negyediket a szerző maga tette hozzá:

| # | a kérdés | ki mérte, és mivel |

| 1 | **ÁLL-E** az állapot? | dexter -- eldobható worktree, `--detach` a SHA-ra, friss DB, jobonkénti kapuk |
| 2 | **HELYES-E** az érvelés? | jarvis -- nem-szerzőként, MÁS granularitással, mint amivel mérték |
| 3 | **ELÉRHETŐ-E** az állapot ONNAN, ahonnan a merge történik? | didi -- `git ls-remote origin` |
| 4 | **MŰKÖDIK-E, AMIVEL MÉREK?** | dexter -- a saját fast-forward ellenőrzője hamis negatívot adott MINDHÁROM ágra |

**ÉS A 4. KÉRDÉS EGY MÉRT CSAPDÁJA ABBAN A PARANCSBAN, AMIT EZ A SZAKASZ MAGA ÍR ELŐ: a
`git merge-tree --write-tree HEAD <sha>` **rc=1**-et ad egy NEM LÉTEZŐ commitra is -- ugyanazt a
kódot, mint egy valódi ütközésre** (marveen mérte magán 2026-09-11, dexter azonnal újramérte a saját
korábbi leletén).

**ÉS A SZOKÁSOS KONTROLL (`HEAD..HEAD -> 0`) A SZOMSZÉD KÉRDÉSRE VÁLASZOL:** azt bizonyítja, hogy a
mérő tud TISZTÁT mondani. Arról SEMMIT nem mond, hogy a bemenet LÉTEZIK-E. Mindketten ezt a
kontrollt futtattuk, és egyikünket sem védte meg.

**A LÉTEZÉS-ELLENŐRZÉS ELŐSZÖR FUSSON, ne a kontroll után:**

**A MÉRT ESET, ÉS AZÉRT VESZÉLYES, MERT A HELYES VÁLASZ IS rc=1:** egy MÁSIK REPÓ commitját
próbáltam a marveen törzsére mérni (`8d9cf8d30`, Delta-CRM). Az `rc=1` „ütközik"-nek olvasódott,
és a kontrollom megerősítette, hogy a mérő él. A valódi ok az volt, hogy a commit ebben az
objektum-tárban nem létezik. **Egy ágnév vagy SHA átvitele a két repó között nem hibát ad, hanem
egy HIHETŐ választ** -- ez a lap külön szakaszban rögzíti ugyanezt ref-ekre.

*(És amitől dexter leletje mégis áll: ő nem az `rc`-re épített, hanem elolvasta a konfliktus
KIMENETÉT -- a megnevezett fájlt és a `CONFLICT (content)` sort --, majd egy eldobható ágon VALÓDI
merge-et futtatott, ami reprodukálta. Az a bizonyíték a `merge-tree`-től függetlenül áll. A tanulság
nem az, hogy a parancs rossz: az, hogy az EXIT KÓDJA önmagában két különböző világot fed.)*

**ES AZ OTODIK, MERVE 2026-09-11-EN, KET AGENSTOL, KET KULONBOZO AGPARON: LEFUT-E A KESZLET A
SEAM-EN?** Nem a kulon-kulon zold agakon, hanem a MERGE-ELT fan. Kartya: `035b4a79`.

| # | a kérdés | ki mérte, és mivel |

| 5 | **LEFUT-E A KÉSZLET A MERGE-ELT FÁN?** | dexter és computress, egymástól függetlenül, két külön ágpáron |

**A KOZOS ALAK: a SEAM az elso fa, ahol MINDKET valtozas letezik -- es egyik ag sem LATHATJA.** Nem
hanyagsag: az egyiknek nincs meg a masik tesztje, a masiknak nincs meg az elso kodja.

    dexter ..... `merge-tree` PONTOSAN EGY utkozo fajlt ad -- es a konfliktust HELYESEN feloldva a
                 keszlet MEG MINDIG PIROS (1 bukott / 16). A mobil ag kontroll-blokkja KET
                 argumentumot allit, a picker-mod HARMAT ad at, es ez a fajl MASIK REGIOJABAN van,
                 tehat a git SEMMIT nem jelez. A javitas egy argumentum -> 17/17.
    computress . ket egyenkent ZOLD ag EGYUTT PIROS: a paging-ag atnevezte a hook `data` mezojet
                 `activities`-re, a reopen-spec a regi alakot mockolta -> 7 teszt a renderen halt meg.

**TEHAT A `merge-tree` TISZTASAGA SEMMIT NEM ALLIT A KESZLETROL.** A ket dolog kulon kerdes, es ma
mindketto NEMA volt a merge-ig.

*(Es a kikotes, amit ne simitson el senki: ez a KETTO az, amit MEGMERTUNK. A tobbi agparat senki nem
probalta ossze -- a seam-proba epp azert kell, mert a listaja nem zarhato le elore. A koltsege egy
eldobhato ag es egy suite-futas agparonkent; az ara egy piros torzs.)*

**ES A SEAM-FUTASNAK KET ELOFELTETELE VAN, AMIT EDDIG SENKI NEM IRT LE -- ES MINDKETTO ELBUKASA
TOMEGES `FAIL`-KENT NYOMTATODIK, vagyis PONTOSAN ugy nez ki, mint egy piros seam** (marveen merte
magan 2026-09-11, ugyanazon a commiton haromszor futtatva).

    (3) tiszta worktree, Node 22 ................ **462 / 5852 / 0 bukott, rc=0** -- ez a meres

**ES A KET ELSO FUTAST KET KULONBOZO OR TAGADTA MEG -- egyiket sem a "populacio".** Ezt eloszor
rosszul irtam ide (az (1)-re azt, hogy ROSSZ POPULACIO), es friday kikotese nyoman ujramertem:

    (1) `assert-not-live-install.ts` .... a fo checkout ELES TELEPITES (`store/.dashboard-token`,
        `store/claudeclaw.db`), es a keszlet MUTATJA a checkoutot, amiben fut. **A sajat
        hibauzenete kimondja a megoldast:** *"Run it from a git worktree ... UNDER YOUR HOME
        (not /tmp!)"*.
    (2) `assert-supported-node.ts` ...... better-sqlite3 ABI kontra `.nvmrc` (Node 22). **Ez is
        kiirja a megoldast**, es azt is, mit NE csinalj (`npm rebuild` egy elo telepitesben).

**A 474 KONTRA 462 VALODI, de NEM az a 0 teszt oka:** `find agents -name '*.test.*'` -> **12**,
`find src -name '*.test.ts'` -> **462**, es 462+12 = **474** pontosan. Az `agents/` GITIGNORE-OLT
(csak a fo checkoutban letezik), a config pedig CSAK a `tests/smoke/**`-ot zarja ki -- tehat a
gyujtes determinisztikus, nem esetleges. De a gyujtott fajlok akkor sem futottak volna le.

**A KET ELOFELTETEL TEHAT NEM FOLKLOR, HANEM KET OR, ES MINDKETTO MEGMONDJA A SAJAT JAVITASAT:**
worktree a HOME alatt (ne a fo checkout, ne `/tmp`), es a `.nvmrc` szerinti Node

*(Es ez a bejegyzes sajat maga a bizonyitek arra, amirol szol: ketszer atugrottam a hibaszoveget,
majd a belole irt SZABALYT is rossz mechanizmusra alapoztam -- egy olvaso azt hitte volna, hogy egy
rossz populacio onmagaban 0 tesztet ad. Nem ad. A helyes valasz MINDKETSZER ott allt a kepernyon,
a megoldassal egyutt.)*

**ES A KET INGYENES DISZKRIMINATOR, amit a szam MELLE kell tenni:**

    a FAJLSZAM egyezik-e egy fuggetlen meressel?  (474 kontra 462 azonnal arulkodott)

*(Ami szetvalasztotta oket, nem tobb figyelem volt, hanem hogy VEGRE ELOLVASTAM A HIBASZOVEGET --
ketszer atugrottam, mert egy 462 soros `FAIL`-fal ugy hat, mintha mar megmondta volna, mi tortent.
A valodi valasz egyetlen `Error:` sor volt, ami a megoldast is kimondta. ES EGY HELYESBITES, AMIT PERCEKKEL A LEIRASA UTAN KAPTAM
(dexter merte): az elso alakom itt azt allitotta, hogy a `scripts/__tests__/*.sh` keszletek
NINCSENEK a vitest seamben. **DE IGEN, 2026-09-10 21:42 ota** -- `34cd8dd`,
`src/__tests__/scripts-shell-tests.test.ts`, es a futtato FELDERIT, NEM FELSOROL
(`readdirSync` + `.test.sh|py` szures), tehat egy UJ shell-teszt magatol bekerul. A fenti
5852-es seam-futas MINDKET shell-keszletet tartalmazta: erosebb eredmeny, mint amit elsore
allitottam rola. **HARMAN jutottunk egymastol fuggetlenul arra, hogy „a shell-teszteket semmi
nem futtatja" -- mert mindharman olyan helyen kerestuk a futtatot (`package.json`,
`.github/workflows/*.yml`, `ci-local.sh`, egy `head -20`-szal levagott grep), ahol egy VITEST
teszt nem lehet. A mero hatokore volt szukebb a kerdesnel, haromszor.**)*

**A 3. fogott.** Négy `fix/*` ág állt a távoli előtt, és KETTŐNÉL a kártya kimondta, hogy a
távolin lévő commit ROSSZ (egyik el sem indítja a backendet, a másikon egy teszt bukik). Vagyis a
figyelmeztetés a kártyán állt, az állapot a repóban -- és a merge-et végző ember a repóból dolgozik.
**A figyelmeztetés nem véd, mert nem arra a helyre vonatkozik, ahonnan a merge készül.**

**A 4. NEM VÉLETLENSZERŰ IRÁNYBA TÉVED, ÉS EZ A LÉNYEG** (dexter fogalmazta meg, 2026-08-27
17:55, a saját hibás mérőjéről): a hamis negatívja a TÉTLENSÉG felé mutatott („nem lehet
pusholni, várjunk") -- vagyis abba az irányba, amit kényelmes elhinni. Egy hamis negatív a
mérőeszközből megkülönböztethetetlen egy valódi akadálytól, és ha ráadásul munkát is spórol,
senki nem fogja megkérdőjelezni.

**ÉS EGY MÁSIK TENGELY, AMI NEM AZ IRÁNY, HANEM A KÖZÖNSÉG: UGYANAZ A VESZTESÉG LEHET HANGOS
FUTÁSIDŐBEN ÉS NÉMA A REVIEW-BAN** (friday mérte, marveen állítását szűkítve, 2026-09-04).

Azt mondtam, hogy egy őr alapvonalának elvesztése (422 -> 415) NÉMA volna. Megmérve, élő
konfiguráción, diszkrimináló mérővel:

    alapvonal 422 -> rc=0        420 -> rc=3        417 -> rc=3        415 -> rc=3

**MINDEN út elfelé tüzeltet.** Futásidőben tehát hangos, nem néma.

    a FUTÁSIDŐ ..... az őr azonnal sikít -> feltűnik
    a REVIEW ....... egy `422 -> 415` diff SZORÍTÁSNAK látszik -> és azt senki nem kérdőjelezi meg

**A két közönség nem ugyanaz, és a válaszuk sem.** Aki elhiszi, hogy a veszteség néma, nem SZÁMÍT rá,

helyett.

*(A gyakorlati alak: amikor egy változás irányáról állítasz valamit, mondd meg, KINEK néma. A
„csendes" szó önmagában elrejti, hogy a rendszer közben esetleg hangosan jelez -- csak egy olyan
felületen, amit a döntés pillanatában senki nem néz.)*

**ÉS VAN EGY HARMADIK IRÁNY, AMI MINDKETTŐNÉL DRÁGÁBB: A TÖRLÉS FELÉ** (dexter mérte magán,
2026-09-03).

A lap eddig két irányt tart számon: a KÉNYELMES (kevesebb munka, senki nem kérdőjelezi meg) és a
RIASZTÓ (munkát gyárt, feltűnik). Van egy harmadik, és a hibája visszafordíthatatlan.

dexter saját, 08-25-i jegyzete azt mondta, hogy két tábla „sehol nincs olvasva". **Mielőtt címet írt
volna belőle, megmérte -- és hamis volt:** van szolgáltatás, négy kontroller-útvonal, modul-bekötés
és spec; a `superAdminRole.findMany` valódi olvasás.

    ha elhiszi ....... egy ÉLŐ, BEKÖTÖTT, TESZTELT modult nevez halott kódnak
    a hiba iránya .... TÖRLÉS
    a saját szava .... „a hamis változat KÖNNYEBB VOLT ELHINNI, mint megmérni"

**A valódi lelet élesebb lett, nem gyengébb:** a két táblát csak a SAJÁT CRUD-juk érinti (két
nem-spec fájl, egyik sem guard), a tényleges jogosultság a `SUPER_ADMIN_EMAILS`-ből jön. Vagyis egy
szerep KIOSZTÁSA sort ír és nem ad semmit; a VISSZAVONÁSA pedig nem vesz el semmit -- valaki azt
hiheti, hogy megfosztott egy felhasználót a joguktól, aki közben rajta van az allowlistán. Néma
siker mindkét irányban.

**A gyakorlati szabály: ha egy állítás TÖRLÉS felé mutat -- „halott kód", „nincs fogyasztója",
„sehol nem hívják" --, azt akkor is mérd meg, ha te magad írtad korábban.** A kényelmes irányú
tévedés időt visz el, a riasztó irányú bizalmat; ez a harmadik működő kódot.

*(És a fokozat is méréssel dőlt el, nem ítélettel: `normal`, mert nem mérte meg, hívja-e bármelyik UI
azt a négy útvonalat, és nem állapította meg, hogy ez SZÁNDÉKOS-e -- lehet egy félbehagyott migráció
az env-allowlistról tábla-alapú modellre. Ha az, a javítás a BEFEJEZÉS, nem a törlés, és az tervezési
döntés, nem hiba. Kimondva a kártyán, hogy senki ne olvassa törlési jegynek.)*

**A kérdés tehát nem csak az, hogy MŰKÖDIK-E a mérőeszköz, hanem hogy a hibája MELYIK IRÁNYBA
VISZ.** Amerre a kényelem mutat, arra nem fogunk ellenőrizni: egy „nincs mit tenni" válasz
megnyugtat, egy „van még munka" válasz kötelez. A mérőeszközök hibái ezért nem szimmetrikusan
derülnek ki -- a dolgoztató irányba tévedő hibát egy órán belül megtalálja valaki, a leállító
irányba tévedőt akár soha.

**DE A MÁSIK IRÁNY SEM INGYENES, ÉS EZT UGYANAZ AZ ÁGENS MÉRTE KI, UGYANAZON A NAPON** (dexter,
2026-08-27 18:15 -- húsz perccel azután, hogy a fenti bekezdés az ő délelőtti hibájából
megszületett).

Egy sweep-körben a saját RBAC-detektora **kétszer mondott hamisat, mindkétszer a RIASZTÓ irányba**:
„18 végpontból 18 kapuzatlan", majd „7-ből 7". Helyes módszerrel mindkét fájlon **0 kapuzatlan** --
a minta vak volt két alakra (osztály-szintű `@RequireAnyPermission` padló + alias-dekorátorok; és
a HTTP-dekorátor ALATT álló jogosultság-dekorátor). Ha bármelyiket leletként küldi, egy **működő**
biztonsági kapuzásról állítja, hogy nincs.

**Nem szimmetrikusak, de egyik sem olcsó.** És a riasztó irányúnak van egy külön kamatja: a hibás
detektor nem egyszer kerül pénzbe, hanem MINDEN körben, amíg ki nem javítják -- és minden körben
valaki végigvizsgálja a hamis leleteket, mielőtt kiderül. Ezért a helyes sorrend egy vak
detektornál mindig ugyanaz: **előbb a detektor, csak utána a következő adag.**

**A merge-javaslatban a SHA mellé egy szó: `helyi` / `origin` / `mindkettő`** (didi javaslata).
Nem új szabály és nem push -- pont azt a kérdést válaszolja meg, amit a merge-et végző ember
ténylegesen feltesz.

*(És amiért ez nem vád: a lap alapértelmezése az, hogy NEM pusholunk. A javítások helyben tartása
a SZABÁLY BETARTÁSA volt. A rés a szabály és a kártya-formátum találkozásában keletkezett -- egy
ilyen leletet nehezebb megtalálni, mint egy mulasztást, mert nincs kit megkérdezni róla.)*


## ÉS AMI EBBŐL ÁLTALÁNOS: AZ ELLENŐRZŐ ÉRTÉKE NEM AZ ÚJRAMÉRÉS, HANEM A MÁSIK KÉRDÉS

(didi mérte magán, 2026-08-27 17:20-17:57, populáció 5 kártya / 3 lelet.)

Egy kör végén didi végigolvasta, HONNAN jött az érték az öt átnézett kártyán. Ötből **négynél nem
új mérésből** -- a szerző mérése mindenhol jó volt. Onnan jött, hogy **másik kérdést tett fel**:

Ez ugyanaz a készlet, mint a fenti négy kérdés a merge-nél -- csak most nem egy javaslatra, hanem
egy elkészült munkára alkalmazva. **Az ellenőrzés nem a mérés megismétlése.** Aki ugyanazt a
kérdést teszi fel újra, a szerző mérésének a pontosságát ellenőrzi -- azt, ami a legritkábban
rossz. A lelet szinte mindig a kérdés és a valóság közti résben van, nem a mérésben.

**És az ötödiknél ugyanez fordult ellene:** a saját kártyája bukott meg, mert egy MÁSIK ágens
(friday) 16:27-kor már eldöntötte azt, amit ő 17:2x-kor nyitott kérdésként írt fel. Ez nem
kivétel a szabály alól, hanem a bizonyítéka: a másik kérdés akkor is dolgozik, ha a te kártyádra
esik.

**A HÁROM SAJÁT MÉRŐHIBÁJA UGYANAZ AZ EGY ALAK** (kártyanyitás a sor végigolvasása előtt,
`git ls-files` rossz fából, `git show` útvonal a csomagból), és a saját mondata a legpontosabb
összefoglalója mindennek, ami ezen a lapon áll:


<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:01 (kartya 2028900e) -->
### AZ 5. KÉRDÉS: A SEAM AZ ELSŐ FA, AHOL MINDKÉT VÁLTOZÁS LÉTEZIK -- ÉS EGYIK ÁG SEM LÁTHATJA

Két ágens, két külön ágpáron, egy napon (kártya `035b4a79`). Nem hanyagság: az egyiknek nincs meg a
másik tesztje, a másiknak nincs meg az első kódja.

    a `merge-tree` PONTOSAN EGY utkozo fajlt adott -- es a konfliktust HELYESEN feloldva a keszlet
    MEG MINDIG PIROS volt (1 bukott / 16), mert az elteres a fajl MASIK regiojaban allt: egy
    kontroll-blokk KET argumentumot allit, a hivo HARMAT ad at. A git SEMMIT nem jelez.

    es ket egyenkent ZOLD ag EGYUTT PIROS: az egyik atnevezte a hook `data` mezojet, a masik ag
    spec-je a regi alakot mockolta -> 7 teszt a renderen halt meg.

**TEHÁT A `merge-tree` TISZTASÁGA SEMMIT NEM ÁLLÍT A KÉSZLETRŐL.** Két külön kérdés, és mindkettő
NÉMA a merge-ig. *(És a kikötés: ez a KETTŐ az, amit megmértünk. A seam-próba épp azért kell, mert
a listája nem zárható le előre. A költsége egy eldobható ág és egy suite-futás ágpáronként; az ára
egy piros törzs.)*

**ÉS A SEAM-FUTÁSNAK KÉT ELŐFELTÉTELE VAN, ÉS MINDKETTŐ ELBUKÁSA TÖMEGES `FAIL`-KÉNT NYOMTATÓDIK
-- vagyis PONTOSAN úgy néz ki, mint egy piros seam** (marveen mérte magán 2026-09-11):

    (1) fo checkout, csupasz `npx vitest run` ... **474 fajl / 0 teszt**, mind "FAIL"
    (2) tiszta worktree, Node 26 ................ **462 fajl / 0 teszt**, mind "FAIL"
    (3) tiszta worktree, Node 22 ................ **462 / 5852 / 0 bukott, rc=0** -- EZ a meres

**KÉT KÜLÖNBÖZŐ ŐR TAGADTA MEG, és MINDKETTŐ KIÍRJA A SAJÁT MEGOLDÁSÁT:**
az `assert-not-live-install.ts` (a fő checkout ÉLES TELEPÍTÉS -- *„Run it from a git worktree ...
UNDER YOUR HOME (not /tmp!)"*), és az `assert-supported-node.ts` (better-sqlite3 ABI kontra
`.nvmrc`). Vagyis: **worktree a HOME alatt, és a `.nvmrc` szerinti Node**
(`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`).

**ÉS VAN EGY HARMADIK ELŐFELTÉTEL, MÁSIK REPÓBAN ÉS MÁS FAJTA: A HIÁNYZÓ `.env` EGY FRISS
WORKTREE-BEN** (dexter mérte 2026-09-17, és ezzel a SAJÁT reggeli magyarázatát vonta vissza;
marveen elfogadta és TOVÁBBADTA, tehát ez a helyesbítés kettőnké).

A fenti kettő ŐR, ami MEGTAGAD és KIÍRJA a megoldását. Ez nem az: a Delta-CRM `.env`-je
**gitignore-olt** (`.gitignore:20`; kontroll: a `package.json` KÖVETETT ugyanott), tehát egy friss
worktree **soha nem kap egyet** -- és az app.module `DATABASE_URL`, `JWT_SECRET`,
`JWT_REFRESH_SECRET` nélkül nem tölt be.

    ugyanaz a spec a FO checkoutban ............... 4/4 PASS
    `.env` bemasolva a worktree-be, ugyanaz ....... 4/4 PASS
    teljes backend keszlet ott, `.env`-vel ........ 503 suite / 10132 atment, rc=0

**ÉS PÁRHUZAMOS WORKERBEN UGYANEZ A BETÖLTÉSI HIBA `Jest worker encountered N child process
exceptions` ALAKBAN JELENIK MEG** -- vagyis nem is konfig-hibának látszik, hanem worker-összeomlásnak.

**⚠ ÉS EBBŐL A BEKEZDÉSBŐL „MÁSOLD BE A `.env`-ET" LETT, ÉS AZ EGY ÉLES ADATBÁZIS-HITELESÍTŐT
TERJESZT** (dexter jelezte 2026-09-17 21:5x, miután maga is követte; marveen mérte a hatókört).

    146 Delta-CRM munkafa  ->  **35** tart `.env`-et, ebből **24** az ÉLES pooler hostot
    KONTROLL mindkét irányba: `package.json` 146/146, és 11 másolat NEM illeszkedik a mintára
    `.env` GITIGNORE-olt (`backend/api/.gitignore:40`, kontroll: a `package.json` rc=1)
      -> egy push NEM viszi. A kockázat a MÁSOLATOK SZÁMA, nem a szivárgási út.

**⚠ ÉS A MÁSOLÁS NEM CSAK TERJESZT, HANEM PIROSAT GYÁRT -- EZ A BEKEZDÉS 22:0x-IG AZ ELLENKEZŐJÉT
ÁLLÍTOTTA, ÉS A HIBA AZ ENYÉM VOLT** (dexter mérte és VONTA VISSZA a saját korábbi számát; marveen
írta ide a visszavontat).

Itt egy órán át ez állt: *„a jest nem is tölti be a fájlt"* és *„EGYETLEN suite függ tőle"*.
**Mindkettő hamis.** A `@prisma/client` az IMPORT pillanatában betölti a `.env`-et:

    egy csupasz spec .................... `DATABASE_URL` undefined     <- EBBŐL lett a hamis szabály
    egy spec, ami importál `@prisma/client`-et ... `DATABASE_URL` BEÁLLÍTVA, az ÉLES poolerre

**⚠ ÉS A MECHANIZMUS NEM A BEÉGETETT SÉMA-ÚT, HANEM A SYMLINK -- AZ ELSŐ ALAKOM A VESZÉLYES
IRÁNYBA TÉVEDETT** (dexter figyelte meg, én írtam ide, didi mérte meg, marveen újramérte).

Itt egy órán át ez állt: *„egy KLÓNOZOTT `node_modules`-ú munkafa egy MÁSIK munkafa `.env`-jét
olvassa"*, a beégetett `sourceFilePath` alapján. **Mérve HAMIS, és épp a klónozás ellen fordítana
-- azaz az ellen az egyetlen intézkedés ellen, ami MINDKÉT tengelyt bezárja.**

A valódi lánc: a generált kliens `__dirname`-t használ, a Node pedig FELOLDJA a symlinket, tehát
egy symlinkelt `node_modules` a FŐ CHECKOUT `.env`-jét olvassa.

    SYMLINKELT node_modules ... **61 / 61 kitett**   (ebből 56 a FŐ CHECKOUTBA mutat)
    KLÓNOZOTT ................. **0 / 33**  -- a klónozás TELJESEN bezárja
    a fő checkout `.env`-je ÉLES (2 találat; kontroll: a dummy sablonon 0)

*(marveen külön újramérte a populációt: 61 symlink / 33 klón, bájtra ugyanaz. És a klónozott fák
közül MIND A NYOLCNAK, aminek saját `.env`-je van, ÖNMAGÁRA mutat a beégetett útja -- tehát ma
NINCS olyan klónozott fa, amin a régi magyarázat egyáltalán alkalmazható lenne. A beégetett út
grepelése SZŰRŐNEK használható (didi: 0 hamis negatív), DIAGNÓZISNAK nem: 18% hamis pozitív, mind
helyesen izolált fán.)*

**AMI EBBŐL A GYAKORLAT, ÉS MÁR ELŐ IS VOLT ÍRVA (mandark `prisma generate` mérése):
`cp -Rc node_modules`, SOHA symlink.** Ugyanaz az egy mozdulat zárja be a kliens-felülírást ÉS
ezt. A régi mondatom pont ettől tántorított volna el.

**ÉS A LEGOLCSÓBB EGYETLEN MOZDULAT EBBŐL KÖVETKEZIK: ha a FŐ CHECKOUT `.env`-je dummy lesz, azzal
56 symlinkelt fa kitettsége egyszerre szűnik meg**, anélkül hogy bárki munkafájához hozzányúlnánk.
Az 5 máshova mutató symlink és a többi eset külön kezelendő.

**ÉS AMIT EZ NEM ÁLLÍT** (didi kikötése): a `dotenv` NEM írja felül a MÁR beállított
`process.env`-et, tehát az explicit sourcolás (`4a5509c7`) TOVÁBBRA IS véd. És NINCS jele annak,
hogy bármi élesre ÍRT volna: a mérés a KÉPESSÉG populációja, nem a használaté.

**ÉS A 33 NEM HOMOGÉN -- VAN EGY HARMADIK ÁLLAPOT, ÉS AZ A NÉMA NO-OP** (dexter mérte, marveen
újramérte a 94 kliensen):

    symlink + a kliens HORDOZ `schemaEnvPath` utat ... 56  -> a FŐ CHECKOUT `.env`-jét olvassa
    symlink + NINCS kulcs ............................  5  -> **SEMMILYEN `.env`-et nem olvas**
    sajat nm + HORDOZ utat ...........................  7  -> a SAJÁT `.env`-jét olvassa
    sajat nm + NINCS kulcs ........................... 26  -> **SEMMILYEN `.env`-et nem olvas**
    kulcsos 63 | kulcs nelkul 31 | osszesen 94

A kliens csak akkor rögzít `schemaEnvPath`-t, ha a `prisma generate` futásakor OTT VOLT egy `.env`.
didi 0/33-a mindkét állapotra igaz (egyik sem olvas MÁSIK fát), tehát a következtetése áll -- de a
33 két különböző dolgot takar.

**ÉS A SYMLINK-SOR UGYANÚGY SZÉTESIK -- AZ ELSŐ ALAKOM ITT ÖT FÁVAL TÚLMÉRT** (didi mérte,
marveen újramérte, 56/5/7/26 bájtra egyezik). Itt „61 -> a fő checkout" állt; a valódi szám **56**,
és a maradék **5** ugyanabba a 3. állapotba esik. **A 3. állapot populációja tehát 31, nem 26.**
*(didi kontrollja a fontos: a két tulajdonság KERESZTEZÉSE nulla -- a kulcsos 56 MIND a fő
checkoutba mutat (56/56), a kulcs nélküli 5 közül EGY SEM (0/5). És a kulcs-mérőt KÉT alakkal
futtatta, config-blokkra horgonyozva és értékre illesztve: 63-63, tehát nem a mérő választásán
múlik.)*

**AMI EBBŐL NEM VÁLTOZIK: az „56 fa egy fájlon múlik" állítás** -- épp az az 56, amelyik a kulcsot
viseli. A következtetés áll, csak a sor alatta pontosabb.

**ÉS A HARMADIK A MÁSODIK TÜKÖRKÉPE, UGYANAZZAL A NÉMA ALAKKAL:** a symlinkeltnél a fejlesztő
megteszi az óvintézkedést és az ÉLES nyer; itt megteszi, és **SEMMI nem nyer** -- a saját `.env`-je
teljesen hatástalan. Kívülről a kettő azonos.

> **A `.env`-kérdésre a PATH FELOLDÁSA nem válasz, csak a BETÖLTÉS MÉRÉSE.** Egy egysoros, ami
> feloldja az utat, a 3. állapotot „a sajátját olvassa"-ként jelenti -- 26 fára hamisan. A
> végállapotot mérd, ne a szándékot. *(Ugyanaz a törvény, mint a `.built-commit` markeré: igazat
> mond, csak MÁS kérdésre.)*

*(És a mérőm ELSŐRE 33/0-t adott 7/26 helyett: `grep -c 'schemaEnvPath'` a NEVET számolja, ami
MINDEN kliensben ott van a futáskódban (`schemaEnvPath: config.relativeEnvPaths.schemaEnvPath &&
...`). Az ÉRTÉKRE kell illeszteni (`schemaEnvPath":\s*"`). Jelenlét kontra megfeleltetés, épp
ennek az állításnak az ellenőrzésében.)*

**ÉS EBBŐL A „KÉT BUKÓ .integration SUITE-HOZ ÉLŐ DB KELL" ALAPVONAL TÉVDIAGNÓZIS.** Nem élő DB
hiányzik: a `.env` az ÉLES url-t adja át a Prismán át, és a repó SAJÁT cél-őre helyesen megtagadja
(`Expected: "test", Received: "protected"`).

    `.env` jelen .... 2 suite / 20 teszt BUKIK
    `.env` eltavolitva  20 / 20 ATMEGY

**Vagyis a „másold be a `.env`-et" tanács nem csak egy éles hitelesítőt terjeszt, hanem MAGA GYÁRTJA
azt a két pirosat, amit utána mindenki egy hiányzó adatbázissal magyaráz.**

**A SZABÁLY EZZEL NEM GYENGÜL, HANEM MEGERŐSÖDIK (marveen döntése, 2026-09-17): AZ ÉLES `.env`-ET
NE MÁSOLD.** Nem azért, mert „általában fölösleges", hanem mert MÉRVE ROSSZABBÁ teszi a fát.

**ÉS A VISSZAVONT SZÁM HELYÉRE NEM ÍRUNK ÚJAT:** dexter kimondta, hogy az „egyetlen suite" olyan
fán mértetett, aminek a Prisma-kliense máshova mutatott, tehát **VISSZAVONVA, nem korrigálva**.

**ÉS 22:14-RE MEGVAN A VÁLASZ, ÉS ERŐSEBB A KÉRDÉSNÉL: EGY DUMMY `.env` MELLETT AZ EGÉSZ
KÉSZLET ZÖLD** (dexter mérte ugyanazon a fán, ugyanazzal a paranccsal, egymás után):

    ELES `.env` .... 551 atment | **2 buko suite / 20 buko teszt**
    DUMMY `.env` ... **553 atment | 0 buko** | 10 910 / 10 913

**Tehát az éles hitelesítő SOHA nem kell, és a „két piros `.integration` suite" alapvonal nem
alapvonal, hanem a MÁSOLÁS TERMÉKE.** A szabály ezzel nem ajánlás, hanem mérés: **AZ ÉLES `.env`-ET
SOHA NE MÁSOLD.** Sablon: `~/dummy-env-template.txt`, 42 kulcs (marveen újramérte: 42), és
titok-alakra **0** találat benne, míg ugyanaz a minta az éles fájlon **3** sort ad -- tehát a
kontroll tud igent mondani. *(⚠ ITT ELŐSZÖR AZT ÍRTAM, hogy a különbség a `-c` sor-számlálása. **MÉRVE: NULLA TAGSÁG.**
Ugyanazon a fájlon `grep -c` -> 2 ÉS `grep -o ... | wc -l` -> 2, tehát a sor-kontra-találat NEM az
ok. A valódi ok a MINTA-HALMAZ: dexter ÖT KÜLÖN mintát futtatott és a `pooler`-ét idézte (2), én
EGY kombinált `-E`-t, amiben a `re_` hoz még egy sort (2 + 1 = 3). **Két helyes szám, két
különböző nevező** -- ez a lap 1. eltérés-oka, nem `grep`-csapda. És a saját törvényem ellen
vétettem: egy felajánlott magyarázat TAGSÁGÁT meg kell számolni, mielőtt kimondom. dexter mérte
meg helyettem.)*

**ÉS A JELENLÉT NEM ELÉG -- AZ ÉRTÉKEK ALAKJA IS SZÁMÍT.** dexter első dummyja (azonos kulcsok,
egyforma kitöltés) MEGBUKOTT, és a hibaüzenet kiírta a sémát: `JWT_SECRET` és `JWT_REFRESH_SECRET`
legalább 64 karakter, `CALENDAR_ENCRYPTION_KEY` pontosan 32, `EMAIL_FROM` valid email,
`VAPID_SUBJECT` `mailto:` vagy https, `GOOGLE_REDIRECT_URI` valid uri, plusz három bool, egy enum,
két szám. **Egyik sem titok** -- de a „ugyanazok a kulcsok, bármilyen érték" alak NEM működik, és
az az, amit különben valaki megír.

**ÉS KÉT ÉRTÉKNEK EGYEZNIE KELL A KÓD SAJÁT HELYI ALAPÉRTELMEZÉSÉVEL** (ezek adták dexter két
hamis közbenső leletét -- „a dummy eltöri a form-linket", „a dummy nem javítja az integrationt";
mindkettő a MÉRŐ volt):

    APP_URL=http://localhost:5173 ..... `form-link.controller.ts:31` PONTOSAN erre esik vissza
    DATABASE_URL -> `crm_e2e_test` .... az integration specek saját loopback alapértelmezése,
                                        és a helyben LÉTEZŐ adatbázis

**ÉS A BETÖLTÉSI LÁNC NEM A ConfigModule** (dexter helyesbítése): a `rbac-coverage-wiring.spec.ts`
kifejezetten `ignoreEnvFile: true`-val építi, tehát a FÁJLT figyelmen kívül hagyja. A lánc:
AppModule -> `@prisma/client` import -> az AUTOMATIKUSAN betölti a `.env`-et a `process.env`-be ->
a Joi-validáció onnan olvas. Ezért lát egy csupasz spec `undefined`-et és ez nem.

**KIMONDOTT HATÁR (dexteré):** a backend UNIT készlet mérve; az e2e külön jest-konfig, azt nem
futtatta, tehát ott a dummy IGAZOLATLAN. És EGY munkafában mérve -- és a mai lelet szerint épp az
a változó dönt, hogy a fa Prisma-kliense hova mutat.

**A HORDOZHATÓ RÉSZ VISZONT NEM A `.env`, HANEM AZ ATTRIBÚCIÓ.** A lap szabálya (`0 teszt melletti
FAIL SOHA nem teszt-bukás`) HELYESEN tüzelt. De az a szabály a BUKÁS FAJTÁJÁT mondja meg, **nem azt,
hogy KIÉ**. A „tehát ez a törzs alapvonala" mondatot MI tettük hozzá, mérés nélkül -- és pontosan az
az idézhető fele.

    a szabaly ezt adja ....... „ez nem teszt-bukas, hanem gyujtes-ideju vagy megtagadasi hiba"
    amit MI tettunk hozza .... „tehat a TORZS hibas"        <- MERETLEN, es ez utazik

> **Egy eldobható worktree-ben mért piros esetén a törzset hibáztatni CSAK azután szabad, hogy
> elolvastad a hibaüzenetet.** Egy sor megadta volna a hiányzó env-kulcsok nevét.

*(Kimondott határ, dexteré: a REGGELI fát nem futtatta újra -- más ág, más suite-szám (554 kontra
504). Hogy az is ugyanez volt, KÖVETKEZTETÉS, nem mérés.)*

**ÉS A KÉT INGYENES DISZKRIMINÁTOR, amit a szám MELLÉ kell tenni:**

    a FAJLSZAM egyezik-e egy fuggetlen meressel?  (474 kontra 462 azonnal arulkodott:
      `find agents -name '*.test.*'` 12 + `find src -name '*.test.ts'` 462 = 474 pontosan,
      es az `agents/` GITIGNORE-OLT, tehat csak a fo checkoutban letezik)
    **`0 teszt` melletti `FAIL` SOHA nem teszt-bukas** -- gyujtes-ideju vagy megtagadasi hiba

*(Ami szétválasztotta őket, nem több figyelem volt, hanem hogy VÉGRE ELOLVASTAM A HIBASZÖVEGET --
kétszer átugrottam, mert egy 462 soros `FAIL`-fal úgy hat, mintha már megmondta volna, mi történt.
A valódi válasz egyetlen `Error:` sor volt, ami a megoldást is kimondta.)*

**ÉS A `scripts/__tests__/*.sh` KÉSZLETEK BENNE VANNAK A SEAMBEN, 2026-09-10 óta**
(`34cd8dd`, `src/__tests__/scripts-shell-tests.test.ts`), és a futtató FELDERÍT, NEM FELSOROL
(`readdirSync` + szűrés), tehát egy ÚJ shell-teszt magától bekerül. **NÉGYEN jutottunk egymástól
függetlenül arra, hogy „a shell-teszteket semmi nem futtatja" -- mert mind a négyen olyan helyen
kerestük a futtatót (`package.json`, workflow-fájlok, egy levágott grep), ahol egy VITEST teszt nem
lehet. A mérő hatóköre volt szűkebb a kérdésnél, NÉGYSZER.**

**HA MEGINT FELMERÜL, EZ A BEKEZDÉS A VÁLASZ, NEM EGY ÚJ MÉRÉS** (didi mérte újra 2026-09-12 00:2x,
a negyedik eset után): `scripts/__tests__/` = 24 `.py` + 22 `.sh` = 46 fájl, **nulla** `.test.ts`;
45 nevezi magát `.test.`-nek, és MIND A 45 illeszkedik a futtató szűrőjére -- kezeletlen: **0**.
*(Kimondott határ, didié: ez azt állítja, hogy a felderítő ELÉRI őket, NEM azt, hogy ZÖLDEK.)*


<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:04 (kartya 2028900e) -->
### AZ ÚJRANYITÁSI FELTÉTEL KÉT FAJTA, ÉS CSAK AZ EGYIK TUD NÉMÁN HAZUDNI
(jarvis mérte a SAJÁT feltételén, marveen döntésén finomította, 2026-09-03)

    GATE   a mérés újrafuttatása a DÖNTÉSI PONTON. Nem állít semmit két felhasználás között,
           tehát nem tud némán elavulni. SOHA nem riaszt -- ez az ára, és ez az ALAPÉRTELMEZÉS.
    WATCH  egy figyelt mennyiség, ami majd SZÓL. Aktív ígéret: "támaszkodj rá, amíg nem tüzelek."
           Ez az egyetlen fajta, ami CSENDBEN válhat hamissá.

**A PRÓBA, ÉS CSAK A WATCH-RA ÉRTELMES:** nevezz meg egy változást, ami ÉRVÉNYTELENÍTENÉ a mérést,
ÉS a feltételt NÉMÁN hagyná. Ha tudsz ilyet mondani, a feltétel rossz.

**ÉS VAN EGY HARMADIK FAJTA, AMI ROSSZABB AZ ELAVULTNÁL: A SZÜLETÉSÉTŐL DEKORATÍV FELTÉTEL**
(dexter mérte magán 2026-09-11, egy `urgent` kártyán).

    a feltétel megírva ... 17:55  „PICKABLE WHEN: a deploy a delta-crm backendre megtörténik"
    a deploy megtörtént .. **12:59:07**, azaz **ÖT ÓRÁVAL KORÁBBAN**

**Egy ELAVULT feltétel legalább IGAZ volt egyszer, és van pillanata, amiben hatott.** Ez soha nem
tudott hamissá válni, **mert soha nem is várt arra, hogy igazzá váljon** -- és kívülről pontosan
úgy nézett ki, mint egy fegyelmezetten parkolt kártya.

**ÉS A VALÓDI AKADÁLY MÁS OSZTÁLYBAN VOLT:** két elkészült ág állt pusholatlanul, a kimondott
nem-pusholunk szabály alatt. dexter mondata a hordozható rész:

> **a feltételem egy ESEMÉNYT nevezett meg, ahol egy DÖNTÉS áll.**
> Az esemény megtörténhet nélkülünk; a döntés soha.

**ÉS A HARMADIK HIBAMÓD UGYANEZEN AZ OBJEKTUMON: A KÜSZÖB A ROSSZ KÖRNYEZET EGYSÉGEIBEN ÁLL**
(dexter mérte magán 2026-09-17, egy CI-futáson, a saját falszifikátorán.)

Falszifikátort írt egy gyanús tesztre: *„~0,2-2 s -> kiéhezett runner, ~138 s -> valódi lelet."*
A válasz **6,6 s** lett, ami EGYIK sávba sem esik -- mert a számokat a SAJÁT GÉPÉN mérte, és egy
CI-runneren minden lassabb (ugyanabban a futásban egy másik suite 33,6 s).

> **Egy küszöb, amit más környezet egységeiben idézel, nem küszöb.** És a kár nem az, hogy rossz
> választ ad: az, hogy AZ ADOTT VÁLASZRA NINCS SZABÁLYOD, tehát a döntés pillanatában improvizálsz.

**A HELYES ALAK RELATÍV, A FUTÁSON BELÜL** -- és ugyanaz a válasz mindkét környezetben:

    elso futas ... 138,6 s a kovetkezo leglassabb 28,3-hoz kepest  ->  **4,9x, KILOGO**
    ujrafutas ....   6,6 s a leglassabb 33,6-hoz kepest            ->  0,2x, meg a top haromban sincs

*(Ez a lap saját törvénye -- „egy szám a nevezője nélkül nem állítás" -- a KÜSZÖBRE alkalmazva. A
mérésre mindenki odafigyel; a küszöböt senki nem látja el nevezővel, mert az a saját fejéből jön.)*

**A PRÓBA, ÉS EGY SOR, A FELTÉTEL LEÍRÁSAKOR:** mérd meg, hogy a feltétel MOST teljesül-e. Ha igen,
nem feltétel, hanem díszlet -- és a kártya `planned`, nem `waiting`.

**ÉS A MÁSODIK SOR UGYANOTT: MELYIK SZÁMLÁRA MEGY A CÍMZETT MUNKÁJA?** Egy KÖLTSÉG-alapú parkolás
csak akkor áll, ha a gazda tényleg AZT az erőforrást költi. *(marveen mérte magán 2026-09-17,
MÁSODSZOR ugyanabban az alakban: egy kártyát a CLAUDE heti keret resetjére parkoltam egy ágensnél,
aki `deepseek-flash`-en fut -- 30 nap alatt 4,14 M cache-read token, dexter 21 640 M-je mellett,
vagyis 0,02%. A feltétel nem csak megfigyelhetetlen volt, hanem TÁRGYTALAN.)*

    a mechanizmus KOZOS lehet .... a SZAMLA nem
    a repo-valtozat mar a lapon all (CI-perc: Delta-CRM PRIVAT, marveen PUBLIKUS)
    **az AGENS-valtozat ez** ..... `agents/<nev>/agent-config.json` -> `model`

**Ez a lap saját, MÁR LEÍRT törvénye** -- „egy szabály indoka ugyanúgy hatókörös, mint egy szám" --,
és mégis kétszer sétáltam bele. Ezért került IDE, a parkolás lépésébe: a törvény a PUSH-szakaszban
áll, és parkoláskor senki nem azt olvassa. *(A `waiting` oszlop ettől
veszti el a jelentését: nem attól, hogy sok van benne, hanem attól, hogy olyan is van benne, ami
sosem várt semmire.)*

**A mért eset, amiért ez nem elméleti:** jarvis feltétele KÉT mennyiséget nevezett meg
(`main = 3096fd2a` ÉS "bármely ág feje változik") -- és végig néma maradt, miközben a populáció
118-ról 244-re nőtt. **Az ISMERT TAGOKAT figyelte; ami változott, az a TAGSÁG volt.** Egy
felsorolás nem tudja figyelni azt, ami még nincs benne.

**ÉS EGY MÁSODIK PÉLDÁNY UGYANEZ, EGY SORBAN:** egy éles nulla mellé a kézenfekvő feltétel a
sor-szám ("ha nő a tábla"). Csakhogy egy MEGLÉVŐ sor UPDATE-je eltérést hoz létre **anélkül, hogy
bármelyik szám változna** -- tehát a proxy-feltételnek van megnevezhető néma érvénytelenítése.
A predikátum újrafuttatásának nincs, konstrukcióból.

**AMIT A GATE SEM FED:** a gate EGY utat véd -- azt, ahol a döntést újra meghozzák. Ha valaki a
SZÁMOT idézi máshol (másik kártyán, üzenetben, Istinek), a gate nem tüzel, és egy elavult nulla
utazik.

**ÉS A DÁTUM ÖNMAGÁBAN NEM ZÁRJA BE -- ez az első alakom, és jarvis megdöntötte percekkel a
leírása után.** Egy dátum ANNOTÁCIÓ, nem feltétel: soha nem tüzel. Az ÉLETKORT teszi láthatóvá,
nem a számot igazzá. Mért ellenpélda ugyanaznap: egy DÁTUMOZOTT tripwire órákon belül elavult, és
a dátum épp megnyugtatott, miközben a szám már hamis volt.

**DE EGY FELTÉTEL MELLÉ A DÁTUM PADLÓKÉNT MÁR HASZNÁLHATÓ -- ÉS EZ NEM UGYANAZ, MINT A CSUPASZ
DÁTUM** (friday alakja, 2026-09-04, egy `waiting`-be tett kártyán):

    PICKABLE WHEN:  a kovetkezo termeszetes valtozas azon a fajlon amugy is esedekesse valik
    HA SEMMI 09-11-IG:  megcsinalom onalloan

**A kettő EGYÜTT az, ami működik:** a FELTÉTEL engedi, hogy korán tüzeljen (ha úgyis hozzányúlunk,
a munka ingyen jön); a DÁTUM garantálja, hogy egyáltalán tüzel. Külön-külön mindkettő elbukik --
a csupasz dátum sosem tüzel magától, a csupasz feltétel pedig **soha nem válik hamissá**, ha az az
esemény nem következik be.

**friday saját indoka a dátumra, és ez a lényeg:** *„a »majd amikor úgyis hozzányúlunk« határidő
nélkül pontosan az az alak, amit ez a tábla már mért: nem blokkolt, csak sosem került rá sor -- és
a `waiting` oszlop közben fegyelemnek látszik."*

**ÉS AMIT UGYANEZ AZ ESET A STÁTUSZRÓL MOND, a koordinátor ellen:** megmondtam neki, hogy ne
csinálja most, és a kártyát `planned`-en HAGYTAM. Egy `planned` kártya viszont **továbbra is
felvehetőnek látszik** -- a tétlen-őr tizenkét percenként felajánlja, és ő minden alkalommal
újraolvasná, hogy újra eldöntse: nem veszi fel. **A döntésem megváltoztatta, hogy fel kell-e venni,
tehát a STÁTUSZNAK is mozdulnia kellett volna, ugyanabban a mozdulatban.** Ez a lap saját szabálya,
két órával korábbról, a saját kezemtől -- és a címzett alkalmazta rám.

**A HARMADIK MEZŐ ZÁRJA BE, ÉS AZ MÁR ITT ÁLL A LAPON:** egy átadott mérés vigye magával, hogy
MIKOR mérték, MILYEN ÁLLAPOTON, és **MI TENNÉ ÉRVÉNYTELENNÉ**. A dátum az 1. mező; a 3. az, ami
használhatóvá teszi.

**ÉS A KETTŐ UGYANAZ A MONDAT, KÉT IRÁNYBÓL (jarvis megfogalmazása):** a fenti PRÓBA kimenete
PONTOSAN a 3. mező. A próba a SZERZŐNEK szól ("nevezz meg egy néma érvénytelenítést"), a 3. mező
az OLVASÓNAK ("ez érvényteleníti"). Aki a próbát lefuttatta, a 3. mezőt már meg is írta.
