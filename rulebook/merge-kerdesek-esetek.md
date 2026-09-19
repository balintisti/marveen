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


---

# A 2026-09-19-I ROVIDITES ELOTTI TELJES SZAKASZ

*(Isti kimondott kerese, Telegram 3206: a lap az enyem, maradjon ami a munkahoz kell. A MAGBAN
maradt az ot kerdes tablaja, a parancsok (`ls-remote`, `cat-file -e` + `merge-tree`), a seam
elofeltetelei es minden TORVENY, amit alkalmazok. IDE kerult a mert esetek narrativaja.
16 244 -> 7 435 karakter. A teljes eredeti szoveg valtozatlanul all alabb.)*

## EGY MERGE-JAVASLAT TÖBB KÉRDÉST KÍVÁN, MINT EGYET -- ÉS A LISTA NŐTT
*(A mért esetek -- a négy 2026-08-27-i ellenőrzés, a seam két bukása, az RBAC-detektor hamis
leletei és a törlés felé tévedő állítás -- `rulebook/merge-kerdesek-esetek.md`.)*

*A cím szándékosan nem mond számot. Négy kérdéssel indult; ma öt áll itt. Számold meg a sorokat,
ne a címet idézd.*

| # | a kérdés | mivel |
|---|---|---|
| 1 | **ÁLL-E** az állapot? | eldobható worktree, `--detach` a SHA-ra, friss DB, jobonkénti kapuk |
| 2 | **HELYES-E** az érvelés? | nem-szerzőként, MÁS granularitással, mint amivel mérték |
| 3 | **ELÉRHETŐ-E** az állapot ONNAN, ahonnan a merge történik? | `git ls-remote origin` |
| 4 | **MŰKÖDIK-E, AMIVEL MÉREK?** | a saját ellenőrződ is adhat hamis negatívot MINDEN ágra |
| 5 | **LEFUT-E A KÉSZLET A MERGE-ELT FÁN?** | nem a külön-külön zöld ágakon: a SEAM-en |

### A 4. KÉRDÉS KÉT ÚJ ALAKJA, ÉS MINDKETTŐ EGY NAP ALATT PÉNZBE KERÜLT VOLNA
### (dexter mérte magán 2026-09-17, a #154 kötegen)

**(A) EGY MAGYARÁZAT, AMI EGY ISMERT BUKÁST FED, ELNYELI AZ ISMERETLENEKET.**

A PR törzsének tetején ott állt a táblázat: *„a törzs amúgy is 10/2 egy elavult Prisma-kliens
miatt"*. Helyes, hasznos, és pontosan azért van, hogy a review NE gyanakodjon a kötegre. **És egy
VALÓDI hiba (`openapi.json is STALE`) pontosan ugyanúgy nézett ki alóla.**

> **Minél jobb a magyarázat, annál többet nyel el.** Aki ezt írja, ne írjon kevesebbet -- hanem
> mondja meg, MI KÜLÖNBÖZTETNÉ MEG az új pirosat a régitől.

**ÉS A SZIGORÚBB ALAK, UGYANAZNAP, UGYANATTÓL AZ EMBERTŐL: NE MAGYARÁZD -- SZÜNTESD MEG.** dexter
mondata: *„egy előre megmagyarázott piros az a hely, ahová a valódi jel elbújik."* Nem maxima:
aznap délelőtt a SAJÁT táblázata nyelt el egy valódi `openapi.json is STALE` bukást.

    a magyarazott alapvonal ... 10 buko suite / 2 buko teszt / 10797 atment
    egy IZOLALT fan, `prisma generate` utan ... **1 / 0 / 10893**
    a NEVEZO 10815 -> 10896, mert egy suite, ami BE SEM TOLTODIK, nullat ad a nevezohoz

Kilenc suite és MINDKÉT bukó teszt eltűnt. **A lap 7. eltérés-oka élőben** -- és a maradék egy
`Jest worker ... child process exceptions`, **0 bukó teszttel**: worker-összeomlás, nem állítás.

> **Ha egy pirosat minden körben meg kell magyarázni, a magyarázat nem a megoldás, hanem a költség.**

*(A KIKÖTÉS a műveletre, mert enélkül a javítás nagyobb kárt tesz: egy `prisma generate` SYMLINKELT
`node_modules`-ban 65 MÁSIK worktree kliensét írja át. dexter `islink=False`-t mért, MIELŐTT
futtatta. Aki ezt flotta-szinten csinálja, csendes ponton tegye -- egy futó suite közben a kár egy
MÁSIK ember teszt-bukásának látszik.)*

**A VÁLASZ EGY KONTROLL, AMI TUD IGENT MONDANI, és ingyen volt:** a `#155` ugyanarról a mainről ágazik,
CSAK egy spec-fájlt érint, és ott a Backend Type Check **SUCCESS**. Ezzel a „piros, valószínűleg az
alapvonal" átfordul arra, hogy „piros, és a kapu máshol bizonyítottan átenged, tehát ez a MIÉNK".

**(B) EGY HELYI KAPU, AMI KIHAGY, NEM EGY HELYI KAPU, AMI ÁTENGED.**

    `check-generated.sh` KIIRJA:  „mobile dependencies are not installed; skipped the client check"
    es VISSZAAD:                  **rc=0**

**A szkript a KIMENETÉBEN őszinte és az EXIT KÓDJÁBAN hamis -- és az automatizálás az exit kódot
olvassa.** Élesebb alak, mint a szokásos fail-open: nem rejt el semmit, bejelenti a kihagyást, és
mégis „pass"-t mond.

**AZ ÁRA MÉRVE:** a mobil sáv az 1. futáson KIHAGYVA, és a 2.-on ELBUKOTT volna, mert a
`mobile/src/api/schema.ts` a specből GENERÁLÓDIK, és a `ci.yml` útvonal-szűrője behúzza a sávot,
amint az `openapi.json` mozdul. **Egy második ~70 perces SZÁMLÁZOTT futás**, privát repón.

> **Ha egy kapu `rc=0`-t ad, keresd meg a SKIPPED sorokat a kimenetében, mielőtt zöldnek veszed.**

*(És a mechanizmus, nem a hiba: a mérő SZŰKEBB volt a MUNKÁNÁL. `tsc --noEmit` kontra a job, ami
`tsc`-t ÉS `check-generated.sh --openapi`-t futtat. A mérő igazat mondott arról a félről, amit
lefedett -- ez a lap leggyakoribb alakja, most egy CI-jobon.)*

**A 3. FOGOTT, ÉS ÍGY NÉZETT KI:** négy `fix/*` ág állt a távoli előtt, és KETTŐNÉL a kártya
kimondta, hogy a távolin lévő commit ROSSZ. A figyelmeztetés a kártyán állt, az állapot a repóban
-- és a merge-et végző ember a repóból dolgozik. **A figyelmeztetés nem véd, mert nem arra a helyre
vonatkozik, ahonnan a merge készül.**

    git ls-remote origin | grep -c <TELJES sha>     # 0 = csak helyben létezik
    # a `git branch -a` NEM elég: a helyi `remotes/origin/...` ref elavulhat

**A merge-javaslatban a SHA mellé egy szó: `helyi` / `origin` / `mindkettő`.** Nem új szabály és
nem push -- pont azt a kérdést válaszolja meg, amit a merge-et végző ember ténylegesen feltesz.

### ÉS A SEAM HARMADIK FAJTÁJA NEM TARTALMI ÉS NEM SZEMANTIKAI, HANEM IDŐZÍTÉSI
### (dexter mérte magán 2026-09-12, két ágon, amik KÜLÖN-KÜLÖN zöldek voltak)

A fenti két mért seam-eset egy ÜTKÖZŐ FÁJLRÓL és egy ÁTNEVEZETT MEZŐRŐL szól. Ez a harmadik nem
nyúl egyik ág kódjához sem:

    origin/main, ket regex .......... 1,78 s
    a megosztott szkennerrel ........ **5,01 s**   <- a per-teszt korlat 5,00 s
    a SEAM-en ....................... 5,27 s  -> `Test timed out in 5000ms`, 2/2 reprodukalva

**Az ág, ami a költséget behozta, a SAJÁT teljes készletén ZÖLD volt** -- 5,01 állt egy 5,00-s
kerettel szemben, ami érmefeldobás, és aznap megnyerte. A seam annyi versengést tett hozzá, hogy
elveszítse.

> **Egy per-teszt időkorlát a TELJESÍTMÉNY-változást PASS/FAIL-lé alakítja, és a kimenet attól
> függ, mi FUT MÉG mellette.** Ezért a „az én készletem zöld" itt nem állítás a merge-elt fáról --
> még akkor sem, ha a teljes készletet futtattad a saját ágadon.

**ÉS AZ ÁLTALÁNOS ALAK, amit a szerző maga mondott ki: egy megosztott helper, ami egy REGEXET
SZKENNERRE cserél, TELJESÍTMÉNY-változás is, nem csak helyességi** -- és ott landol, ahol a
legtöbbet olvas: az egész fát átnéző őrökön. A javítás (`split('')` helyett szeletelés) ugyanazt a
kimenetet adja 3,18 s-ért.

*(Ez azért nő ki a fenti kettőből, mert a MECHANIZMUSA más: ott a git nem jelzett, mert a
konfliktus a fájl másik régiójában volt; itt NINCS konfliktus, és a git helyesen hallgat. A seam
nem a tartalmat, hanem az ERŐFORRÁST osztja meg.)*

### A 4. KÉRDÉS CSAPDÁJA ABBAN A PARANCSBAN VAN, AMIT EZ A SZAKASZ MAGA ÍR ELŐ

A `git merge-tree --write-tree HEAD <sha>` **rc=1**-et ad egy NEM LÉTEZŐ commitra is -- ugyanazt a
kódot, mint egy valódi ütközésre (marveen mérte magán 2026-09-11, dexter azonnal újramérte).

    git merge-tree --write-tree HEAD 000...0   ->  **rc=1**        <- nem létező commit
    git merge-tree --write-tree HEAD <ütköző>  ->  rc=1            <- valódi ütközés
    git merge-tree --write-tree HEAD HEAD      ->  0               <- a szokásos kontroll

**ÉS A SZOKÁSOS KONTROLL A SZOMSZÉD KÉRDÉSRE VÁLASZOL:** azt bizonyítja, hogy a mérő tud TISZTÁT
mondani. Arról SEMMIT nem mond, hogy a bemenet LÉTEZIK-E. Mindketten ezt futtattuk, és egyikünket
sem védte meg. A mért eset: egy MÁSIK REPÓ commitját mértem a marveen törzsére -- az `rc=1`
„ütközik"-nek olvasódott, a valódi ok az volt, hogy a commit ebben az objektum-tárban nem létezik.

```bash
git cat-file -e <sha>^{commit} || { echo "NINCS ilyen commit EBBEN a repoban"; exit 1; }
git merge-tree --write-tree HEAD <sha> >/dev/null 2>&1; echo "rc=$?"
```

*(dexter leletje ettől függetlenül áll: ő nem az `rc`-re épített, hanem elolvasta a konfliktus
KIMENETÉT, majd egy eldobható ágon VALÓDI merge-et futtatott. A tanulság nem az, hogy a parancs
rossz: az, hogy az EXIT KÓDJA két különböző világot fed.)*

### AZ 5. KÉRDÉS: A SEAM AZ ELSŐ FA, AHOL MINDKÉT VÁLTOZÁS LÉTEZIK -- ÉS EGYIK ÁG SEM LÁTHATJA

**A `merge-tree` TISZTASÁGA SEMMIT NEM ÁLLÍT A KÉSZLETRŐL.** Két mért alak: (1) a `merge-tree`
PONTOSAN egy ütköző fájlt adott, a konfliktust HELYESEN feloldva a készlet MÉG MINDIG piros volt,
mert az eltérés a fájl MÁSIK régiójában állt (egy kontroll-blokk KÉT argumentumot állít, a hívó
HÁRMAT ad át) -- a git semmit nem jelez; (2) két egyenként ZÖLD ág EGYÜTT piros: az egyik átnevezte
a hook `data` mezőjét, a másik spec-je a régi alakot mockolta. **Mindkettő NÉMA a merge-ig.**
*(És a lista nem zárható le előre: ezért kell a seam-próba, nem egy ellenőrző-lista.)*

**A SEAM-FUTÁSNAK ELŐFELTÉTELEI VANNAK, ÉS MINDEGYIK ELBUKÁSA TÖMEGES `FAIL`-KÉNT NYOMTATÓDIK** --
vagyis pontosan úgy néz ki, mint egy piros seam. Két őr tagadja meg, és MINDKETTŐ kiírja a
megoldását (`assert-not-live-install.ts`, `assert-supported-node.ts`):

    worktree a HOME alatt (a fo checkout ELES TELEPITES, nem futtatokornyezet)
    a `.nvmrc` szerinti Node:  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"

**⚠ ÉS A HARMADIK ELŐFELTÉTEL MÁSIK REPÓBAN MÁS FAJTA, ÉS ITT A SZABÁLY BIZTONSÁGI: A
DELTA-CRM `.env`-JE GITIGNORE-OLT, TEHÁT EGY FRISS WORKTREE SOHA NEM KAP EGYET -- DE AZ ÉLESET
SOHA NE MÁSOLD BE.** Mérve: a másolás nem csak egy éles adatbázis-hitelesítőt terjeszt (146
munkafából 35 tart `.env`-et, 24 az ÉLES poolert), hanem **MAGA GYÁRTJA** azt a két piros
`.integration` suite-ot, amit utána mindenki hiányzó adatbázissal magyaráz:

    ELES `.env` .... 551 atment | 2 buko suite / 20 buko teszt
    DUMMY `.env` ... 553 atment | **0 buko**   (10 910 / 10 913)

Sablon: `~/dummy-env-template.txt` (42 kulcs, titok-alakra 0 találat). A jelenlét nem elég, az
ÉRTÉKEK ALAKJA is számít (`JWT_SECRET` >= 64, `CALENDAR_ENCRYPTION_KEY` pontosan 32, valid email/uri),
és kettőnek EGYEZNIE kell a kód helyi alapértelmezésével: `APP_URL=http://localhost:5173`, a
`DATABASE_URL` pedig a `crm_e2e_test`-re.

**ÉS A `node_modules`-T KLÓNOZD, NE SYMLINKELD (`cp -Rc`, ~8 mp, valódi lemez-delta 0,02 GB).**
Ugyanaz az EGY mozdulat zárja be a `prisma generate` kliens-felülírását (70 fából 66 ugyanarra a
generált kliensre mutat) ÉS a `.env`-szivárgást: a Node FELOLDJA a symlinket, tehát egy symlinkelt
`node_modules` a FŐ CHECKOUT `.env`-jét olvassa (61/61 kitett, ebből 56 a fő checkoutba; klónozva
0/33). **A `@prisma/client` az IMPORT pillanatában betölti a `.env`-et** -- ezért lát egy csupasz
spec `undefined`-et, egy Prismát importáló pedig az ÉLES url-t.

**A KÉT INGYENES DISZKRIMINÁTOR, amit a szám MELLÉ kell tenni:**

    a FAJLSZAM egyezik-e egy FUGGETLEN meressel? (474 kontra 462 azonnal arulkodott: az
      `agents/` GITIGNORE-OLT, tehat csak a fo checkoutban letezik)
    **`0 teszt` melletti `FAIL` SOHA nem teszt-bukas** -- gyujtes-ideju vagy megtagadasi hiba

> **Egy eldobható worktree-ben mért piros esetén a törzset hibáztatni CSAK azután szabad, hogy
> ELOLVASTAD a hibaüzenetet.** Egy sor megadta volna a hiányzó env-kulcsok nevét. A szabály a
> bukás FAJTÁJÁT mondja meg, nem azt, hogy KIÉ -- a „tehát a törzs alapvonala" mondat MÉRETLEN
> hozzátoldás, és pont az az idézhető fele.

**A `scripts/__tests__/*.sh` KÉSZLETEK BENNE VANNAK A SEAMBEN** (2026-09-10 óta, `34cd8dd`), és a
futtató FELDERÍT, nem felsorol -- egy új shell-teszt magától bekerül. 46 fájl, 45 nevezi magát
`.test.`-nek, mind a 45 illeszkedik, kezeletlen 0. **NÉGYEN jutottunk egymástól függetlenül arra,
hogy „semmi nem futtatja" -- mind a négyen olyan helyen kerestük a futtatót (`package.json`,
workflow-fájlok), ahol egy VITEST teszt nem lehet.** Ha megint felmerül, ez a bekezdés a válasz,
nem egy ötödik mérés.

*(A mért esetek TELJES szövege -- a két seam-bukás, a `.env` öt visszavont alakja, a 56/5/7/26
kliens-bontás és a dummy-env mérése -- `rulebook/merge-kerdesek-esetek.md`.)*

### ÉS A MÉRŐ HIBÁJÁNAK IRÁNYA SZÁMÍT, NEM CSAK AZ, HOGY HIBÁS

**A 4. kérdés hamis negatívja a TÉTLENSÉG felé mutatott** („nem lehet pusholni, várjunk") -- abba
az irányba, amit kényelmes elhinni. Egy hamis negatív a mérőeszközből megkülönböztethetetlen egy
valódi akadálytól, és ha ráadásul munkát is spórol, senki nem fogja megkérdőjelezni.

**DE A MÁSIK IRÁNY SEM INGYENES.** Ugyanaz az ágens ugyanazon a napon kétszer mondott hamisat a
RIASZTÓ irányba („18 végpontból 18 kapuzatlan", majd „7-ből 7"); helyes módszerrel mindkét fájlon
**0 kapuzatlan**. Ha bármelyiket leletként küldi, egy MŰKÖDŐ biztonsági kapuzásról állítja, hogy
nincs.

    a TÉTLENSÉG felé tévedő hiba  ->  rejtve marad, mert kényelmes elhinni
    a RIASZTÓ felé tévedő hiba    ->  MUNKÁT gyárt, és a következő kör bizalmát viszi el

Nem szimmetrikusak, de egyik sem olcsó. És a riasztó irányúnak van egy külön kamatja: a hibás
detektor nem egyszer kerül pénzbe, hanem MINDEN körben, amíg ki nem javítják. **Ezért a helyes
sorrend egy vak detektornál mindig ugyanaz: előbb a detektor, csak utána a következő adag.**

**ÉS VAN EGY HARMADIK IRÁNY, AMI MINDKETTŐNÉL DRÁGÁBB: A TÖRLÉS FELÉ.** Egy saját, három nappal
korábbi jegyzet azt mondta, hogy két tábla „sehol nincs olvasva" -- megmérve HAMIS volt: van
szolgáltatás, négy kontroller-útvonal, modul-bekötés és spec. **Ha elhiszi, egy ÉLŐ, BEKÖTÖTT,
TESZTELT modult nevez halott kódnak.** A szerző saját szava: *„a hamis változat KÖNNYEBB VOLT
ELHINNI, mint megmérni."*

> **Ha egy állítás TÖRLÉS felé mutat -- „halott kód", „nincs fogyasztója", „sehol nem hívják" --,
> azt akkor is mérd meg, ha te magad írtad korábban.** A kényelmes irányú tévedés időt visz el, a
> riasztó irányú bizalmat; ez a harmadik működő kódot.

**ÉS EGY NEGYEDIK TENGELY, AMI NEM AZ IRÁNY, HANEM A KÖZÖNSÉG: UGYANAZ A VESZTESÉG LEHET HANGOS
FUTÁSIDŐBEN ÉS NÉMA A REVIEW-BAN.** Egy őr alapvonalának elvesztése (422 -> 415) futásidőben
HANGOS -- minden út elfelé `rc=3`-at ad. A REVIEW-ban viszont egy `422 -> 415` diff SZORÍTÁSNAK
látszik, és azt senki nem kérdőjelezi meg. **Aki elhiszi, hogy a veszteség néma, nem SZÁMÍT rá,
hogy a kapu utána ordítani kezd -- és akkor fennáll a veszély, hogy a KAPUT javítja meg a diff
helyett.** Amikor egy változás irányáról állítasz valamit, mondd meg, KINEK néma.

### ÉS AMI EBBŐL ÁLTALÁNOS: AZ ELLENŐRZŐ ÉRTÉKE NEM AZ ÚJRAMÉRÉS, HANEM A MÁSIK KÉRDÉS
(didi mérte magán, 2026-08-27, populáció 5 kártya / 3 lelet.)

Ötből **négynél nem új mérésből** jött az érték -- a szerző mérése mindenhol jó volt. Onnan jött,
hogy **másik kérdést tett fel**:

    áll-e az ÁLLAPOT?  ·  helyes-e az ÉRVELÉS?  ·  ELÉRHETŐ-e onnan, ahonnan használják?
    mit ENGEDNE ÁT az őr?  ·  melyik fájl az ÉLŐ?

**Az ellenőrzés nem a mérés megismétlése.** Aki ugyanazt a kérdést teszi fel újra, a szerző
mérésének a PONTOSSÁGÁT ellenőrzi -- azt, ami a legritkábban rossz. A lelet szinte mindig a kérdés
és a valóság közti résben van, nem a mérésben. És a saját mondata a legpontosabb összefoglalója
mindennek, ami ezen a lapon áll:

> **a MÉRŐ hatóköre szűkebb volt a KÉRDÉSNÉL, és a hiánya nem hibának látszott.**

### ÉS A HATÁRESET: EGY KIVÉTEL, AMI IGAZ, ÉPP EZÉRT ÉLI TÚL A TÁMADÁST
### (dexter mérte 2026-09-18, egy MÁR ellenőrzött kivételen; a `dc6da9f0` másik fele)

A `dc6da9f0` azt mondta ki, hogy **egy kivétel ÁLLÍTÁS, tehát lehet HAMIS** -- és egy hamisat egy
támadás megtalál. Ez a csendesebb fele:

    egy kivetel, ami HAMIS ..... egy tamadas MEGTALALJA
    egy kivetel, ami IGAZ ...... egy tamadas MEGEROSITI -- es a MELLETTE allo res tulel

**A mért eset:** egy `search` végpont kivétel-szövege azzal érvelt, hogy a `phone`, a `notes` és a
`customFields` SZÁNDÉKOSAN hiányzik. Igaz volt. Az `email`-ről **egy szót sem mondott.** didi
megtámadta a `dc6da9f0` alatt, és a kivétel **ÁLLTA** -- mert a támadás azt vizsgálja, amit a
mentség KIMOND, nem azt, ami mellette áll. A rés négy útból kettőn ott maradt.

**Ez ugyanaz a törvény, ami fent áll -- a mérő hatóköre szűkebb a kérdésnél --, csak PRÓZÁRA
alkalmazva, ÉS egy olyan prózára, amin MÁR átment egy ellenőrzés.** Ettől erősebb egy sosem
vizsgált kivételnél: a zöld pipa mögötte igazi.

> **Egy megerősített kivétel bizonyíték a SAJÁT SZÖVEGÉRŐL, soha nem a populációról.**
> A próba, és olvasáskor tüzel: *mit NEM NEVEZ MEG ez a kivétel?*

*(Miért kerül a lapra egy olyan éjszakán, amikor a lap épp fogyókúrán van: mert MÉRT ÚJ ALAK, nem
átfogalmazás -- a lap saját racsni-szabálya pontosan ezt az egy okot engedi meg. És a mérés, ami
enélkül néma maradt volna: a 09-17-i bontás 242 966 -> 206 545-re vitte a lapot, MA HAJNALBAN
245 325-ön áll. A bontás teljes nyeresége visszanőtt egy éjszaka alatt, és semmi nem szólt --
ugyanaz az alak, mint az alapvonal-racsni a skilleknél. Kártya kell rá, nem egy újabb bekezdés.)*

