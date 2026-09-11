# workcheck.json -- a MERT ESETEK

Ez a `CLAUDE.md` „HA EGY AGENS SZANDEKOSAN ALL" szakaszabol kiszervezett BIZONYITEK-anyag: jarvis
tiz ertesitese, deeper proza-merese, a ket elsodrodott sorszam-horgony es a router hatokor-merese.

**A TORVENY NEM ITT VAN, HANEM A `CLAUDE.md`-BEN.** Ha ellentmondast latsz, a lap az ervenyes.

Kiszervezve: 2026-09-11, kartya `ed1c9734`. Minden ITT ALLO sor a lapon ALLT; az assert a torles
ELOTT futott le.

---


## HA EGY ÁGENS SZÁNDÉKOSAN ÁLL: `workcheck.json` -> `{"kind":"none"}` (marveen döntése, 2026-08-28)

**A tétlen-őrnek VAN néma állapota, és eddig senki nem tudott róla** (jarvis mérte 06:30-kor;
a horgony a FELTETEL-PAR, nem sorszam: `src/idle-agent.ts`,

saját nyitott munkája ÉS a `workcheck.json` `kind`-ja `'none'`, az őr hallgat. Két feltétel, tehát **nyitott munkával nem lehet elnémítani** -- ezért
biztonságos konvenció.

**A KIÚT VISZONT ROSSZ HELYEN VAN HIRDETVE, és ez mért kár.** A `buildNoWorkNotice` szó szerint azt
kéri, hogy *„mondd ki A KÁRTYÁN, hogy miért állsz"* -- az őr viszont **kártyát sosem olvas**. Aki
pontosan azt teszi, amit az üzenet kér, semmit nem változtat. Mérve jarvison: **10 értesítés
4 óra 48 perc alatt**, végig `assigned_open_cards` kinddel, miközben tényleg nem volt felvehető
munkája. És a negatív kontroll már korábban megvolt: 23:04-kor és 23:36-kor a koordinátor
KÁRTYÁRA írta, hogy szándékosan áll -- az őr tüzelt tovább.

**A konvenció mostantól:** aki szándékosan áll (nincs neki való, vagy tudatosan parkol), a saját
`workcheck.json`-jába `{"kind":"none"}`-t ír. A kártyán ettől függetlenül maradjon ott az INDOK --
az embernek szól, a JSON a gépnek. A kettő nem helyettesíti egymást.

(2026-09-11 03:38). Azt kértem tőle, hogy a `{"kind":"none"}` mellé írjon FELOLDÁSI FELTÉTELT és
DÁTUM-PADLÓT a fájlba. Megtette -- és megmérte, hogy **a parser (`parseWorkCheck`) KIZÁRÓLAG a
`kind` és a `reviewer` mezőt olvassa.** Minden más mező PRÓZA, amit egyetlen kódsor sem néz meg.

    KONTROLL, hogy a parser diszkriminál:  `kind:"bogus"` -> null | hibás JSON -> null
    a valódi fájl ......................... `{"kind":"none"}` -> beolvasva

**Vagyis a feltétel és a padló NEM KÉNYSZERÜL KI, és nem tud szólni magától.** deeper saját
mondata a pontos: *az örökölt `none` nem attól bukott meg, hogy hiányzott belőle a próza -- hanem
attól, hogy a prózát semmi nem olvassa. A próza AUDITÁLHATÓVÁ tesz, nem ÖNJAVÍTÓVÁ.*

**A GYAKORLATI KÖVETKEZMÉNY, ÉS EZ A LAP SAJÁT TÖRVÉNYE MAGÁN A LAPON:** egy feltétel mechanizmus
nélkül nem feltétel, hanem szándék. Ezért a `none` mellé **KÁRTYA** jár dátum-padlóval, nem csak
egy JSON-mező -- a kártyát a tábla mutatja, a `workcheck.json` prózáját senki. *(Mért példány:
`08203dec`, deeper 09-18-i padlója.)*

**ÉS AMIT A `none` VALÓJÁBAN CSINÁL, deeper mérése szerint: nem semleges csere.** Elnémítja a
no-work értesítést az adott ágensre, lejárat nélkül -- vagyis amíg áll, **senkit nem fog
emlékeztetni semmi arra, hogy munkát adjon neki.** Ez egy ügyeletes ágensnél helyes csere (a
forrás kifejezetten nevesíti ezt az esetet), de CSERE, és a következő olvasó ne üres sornak lássa.

**MEGMÉRVE 06:35-kor (jarvis, forrásból): a `none` SOHA nem áll vissza magától.** A
`workcheck.json`-ra az egész kódbázisban EGYETLEN fájlművelet áll, egy `readFileSync`
(`src/web/idle-agent-watcher.ts`, a `readWorkCheckRaw()` függvényben -- SZIMBOLUM-horgony,
mert a sorszám ágfüggő és sodródik); írásra nulla találat. Pozitív kontroll: ugyanaz a keresés
megtalálja az olvasót, tehát a mérő lát kódot. **A fájlt kizárólag KÉZ írja** -- amit odaírtak,
addig áll, amíg valaki vissza nem veszi.

**ES A KET HORGONY SORSZAMA EL IS SODRODOTT -- MERT PELDANY A LAP SAJAT SZABALYARA** (mandark mérte
2026-09-06, marveen újramérte a FUTO fán, `feat/google-service-account @ d518528`):

    a lap azt mondta                    valojaban                       eltérés
    `idle-agent-watcher.ts:65`     ->   `src/web/...` :182 (a readFileSync)   **+117**
    `idle-agent.ts:190`            ->   `src/idle-agent.ts:282`               **+92**

**A MECHANIZMUS-ALLITASOK IGAZAK VOLTAK -- csak a koordinatak nem.** Es a javitas NEM a ket uj szam
(az ujra elsodródik), hanem a SZIMBOLUM-horgony, ahogy fent all: ez a lap sajat szabalya, most a
lap sajat szovegen.

**ES EGY MERO-KIKOTES, ami nelkul valaki rossz alapvonalhoz merne:** ehhez a ket fajlhoz az
`origin/main` NEM ervenyes alapvonal -- `git cat-file -e origin/main:<mindket fajl>` -> **rc=128**,
mikozben `origin/main:package.json` -> rc=0. Az `origin` itt az IDEGEN upstream; a horgonyokat a
FUTO fan kell merni.

*(Mellek-lelet ugyanabbol a merésbol, es a park hatokoret szukiti: a `{"kind":"none"}` NEM nemitja
el az uzenet-KEZBESITEST. Harom fajl olvassa a `workcheck.json`-t, es a router egyetlen produkcios
hivasi helye (`message-router.ts`, `quietAgentsToCheck`) a BUSY-STUCK RIASZTAS populaciojat szuri,
nem a kezbesitest -- a kod dontotte el, nem a docblock.)*

**A KOCKÁZAT VISZONT SZŰKEBB, mint ahogy ez a bekezdés előbb állította** (a korábbi alak azt
mondta, hogy egy elfelejtett `none` „pontosan azt a láthatatlan tétlenséget termeli, ami ellen
az őr készült" -- ez TÖBBET állított a mértnél). A két feltétel miatt:

    elfelejtett `none` + VAN munkája   -> a `:190` nem tüzel, az őr normálisan ébreszt (VÉDVE)

Tehát nem a „van munkája és mégsem mozdul" esetet rejti el -- azt az őr továbbra is elkapja --,
hanem pontosan azt, amiért az `idle-no-work` ág készült. Valós rés, de határolt.

**A gyakorlati szabály ettől nem lazul:** aki `none`-t ír, vegye vissza, amint felvesz valamit.
Az ellenőrzés egy sor, ezért nem tud elavulni:

*(Alapvonal a bevezetés napján, 2026-08-28: mind a hat ágensnek VAN fájlja, és egyik sem `none`
-- 4x `assigned_open_cards`, 1x `testing_without_my_comment`, plusz jarvisé. Ha valaki `none`-ra
áll, ez a „mihez képest".)*

**Az „utolsó megszólalás" MÁSODLAGOS jelként megmarad**, de más a jelentése: aki órák óta
dolgozik és egyszer sem jelentett, az nem tétlen, hanem NEM JELENT. A kettő különböző választ
kíván — az elsőre munkát adunk, a másodikra azt kérjük, hogy írjon.

*(Javítva 06:15, az első futás után: eredetileg második feltételként az `in_progress` kártya
hiánya is szerepelt. Megmértem, és a tábla szerint EGYETLEN ágensnek sincs `in_progress`
kártyája, miközben mindketten dolgoznak — a kártyákat nem mozgatják munka közben. Egy „ÉS
nincs in_progress" feltétel tehát mindig igaz lett volna, vagyis semmit nem szűrt volna, és
egy soha nem teljesülő feltétel a rosszabb fajta: úgy néz ki, mintha szigorítana.)*
*(És a fenti bekezdés akkori zárómondata — „az üzenet-kor önmagában mér" — 2026-08-22-én
megdőlt: nem mér. Lásd a panel-alapú javítást feljebb. Azért hagytam itt a nyomát, mert egy
javított szabály mellett a RÉGI indoklás elolvasva úgy hat, mintha még érvényes lenne.)*

A tétlen ágens azért láthatatlan, mert nem küld üzenetet: a koordinátor a beérkező jelentésekből
dolgozik, tehát pont az nem jelenik meg a látómezőben, aki nem dolgozik. A dolgozó ágens tölti
ki a figyelmet, és a benyomás az, hogy „megy a munka".

**Tabu fájlok.** Jelenleg nincs olyan, amihez ne nyúlhatnál.

**A LAP-ÁTVIZSGÁLÁS IDŐKÖZÖNKÉNT ISMÉTLŐDIK, ÉS AZ ÁGENSEK SAJÁT LAPJAIRA IS KITERJED**
(Isti, 2026-09-11 20:01, szó szerint: *„megbeszéltük ma, hogy időközönként lesz ilyen átvizsgálás
a fájlokon, az agentek fájlait is nézd át majd ilyen átvizsgáláskor."*).

    a KOZOS lap ......... `/Users/isti/marveen/CLAUDE.md`
    a PER-AGENS lapok ... `agents/<nev>/CLAUDE.md` -- **ot agens MINDKETTOT betolti**, mert a cwd-juk
                          a fan belul van; deeper cwd-je kivul, o csak a sajatjat

**ÉS HÁROM SZAKASZ MINDEN ÁGENS-LAPON GÉPI** (`fleet-roster`, `autonomy-wiring`, `skills-path-trap`;
generátor: `src/web/agent-scaffold.ts`, négy vitest spec őrzi). A kézi szerkesztésük a következő
ágens-indulásnál NYOMTALANUL ELVÉSZ -- és a szerkesztő közben azt hiszi, megcsinálta. **Ezeket ne
is vágd: a duplikáció BIZTOSÍTÁS**, az az út, amin egy közös szabály akkor is elér egy ágenshez, ha
a könyvtár-hierarchia nem viszi el hozzá.

**Univerzális rendszert építünk, nem Isti-specifikusat.** (Isti, 2026-08-17) A Delta-CRM
minden funkciója legyen praktikus, könnyen és logikusan használható BÁRKINEK. Ha egy
funkció csak azért van, mert Isti kérte, és csak ő tudja hogyan kell használni, az keveset
ér. Gyakorlati következmény a tervezésre: **ha egy megoldás azon áll, hogy a felhasználó
megjegyez vagy megszokik valamit, az nem megoldás.** A hibát ne javíthatóvá tedd, hanem
láthatóvá: ami elmaradt, azt a rendszer mutassa meg, ne a felhasználó memóriája őrizze.

**A MARVEENT NEM MI FEJLESZTJÜK -- SZOTASZ JAVÍTÁSAIRA HAGYATKOZUNK (Isti, 2026-09-03 21:43).**
Szó szerint: *„Amúgy nagyon a saját rendszerünket szerintem ne fejlesszük, hacsak nincs valami
nagyon egetverően fontos. Hagyatkozzunk főleg szotasz javításaira. Ha van valami, akkor felküldjük
neki, ő megvizsgálja, ha jóváhagyja, akkor úgyis nálunk is meglesz később ha lesz frissítés."*

**A HATÓKÖR, ÉS EZT KI KELL MONDANI, MERT A LAP FELE A MÁSIK REPÓRÓL SZÓL:** ez a MARVEENRE
vonatkozik (`balintisti/marveen`, upstream `Szotasz/marveen`), NEM a Delta-CRM-re. A CRM Isti
terméke, ahhoz Szotasznak semmi köze, és a flotta nagyobbik fele azon dolgozik. *(Ezt az olvasatot
Istinek megírtam 21:4x-kor, korrigálásra felkínálva; ha cáfolja, ez a bekezdés újranyitandó.)*

**AMI EBBŐL KÖVETKEZIK, MARVEEN-OLDALON:**

    egy hiányzó képesség  ->  ELŐBB nézd meg, MEGVAN-E MÁR UPSTREAM (`git log origin/develop`,
                              `git ls-tree origin/develop`), és ha igen, ÁTVÉTEL, nem újraírás
    egy valódi javítás    ->  FELKÜLDJÜK Szotasznak (PR a `Szotasz/marveen` felé), és a
                              frissítéssel jön vissza. A PR külön döntés, de az IRÁNY eldőlt.
    saját fejlesztés      ->  csak „nagyon egetverően fontos" esetben, kimondott indokkal

**MÉRT PÉLDÁNY UGYANAZNAP, ÉS EZÉRT NEM ELVI:** a „ne kelljen újra mindent futtatni" problémára
kitaláltunk egy címke-horgonyos receptet. Upstream MÁR MEGÍRTA (`scripts/upstream-new.sh` +
`docs/upstream-ledger.md`), és jobb: a git commit-AZONOSSÁGRA illeszt, nem tartalomra, tehát egy
kézzel átvitt commit ÖRÖKRE bent marad a `HEAD..upstream` listában -- az ő főkönyvük levonja a már
eldöntött tételeket, tehát a lista FOGY. Egy fél estét spórolt az, hogy valaki megnézte, megvan-e
már. Kártya: `0024b92b`, `docs/upstream-adoption.md`.

**ÉS A HATÓKÖR MEGERŐSÍTVE, PLUSZ AZ INDOK: KÉT ÚJ PROJEKT JÖN (Isti, 2026-09-03 21:54).**
Szó szerint: *„A CRM a mi termékünk, ahhoz nincs semmi köze Szotasznak. A saját rendszeren való
munka nem tudom annyit hozzátesz-e amennyi token és idő elmegy vele, holott most a CRM-en kellene
dolgoznunk, mert még legalább két projekt van amit el szeretnék kezdeni 2 hónapon belül: a szerb
tudástár és az agrár alkalmazás is."*

    a szerb tudastar ...... uj projekt, inditas ~2026-11-03-ig
    az agrar alkalmazas ... uj projekt, inditas ~2026-11-03-ig
    (Isti „2 honapon belul"-t mondott 2026-09-03-an; a datum SZAMITOTT, nem tole idezett.)

**A MARVEEN-HATÓKÖR EZZEL MEGERŐSÍTVE:** a fenti szakasz olvasata helyes volt, Isti kimondta. Új
marveen-FUNKCIÓT nem írunk; ami marad, az a már leszállított munka és a nálunk jelentkező HIBÁK
javítása. A kapacitás a CRM-é és a két új projekt előkészítéséé.

**ÉS ISTI HELYESBÍTETT 22:06-KOR: A „KERETRENDSZER-FEJLESZTÉS" ÉS A „RENDSZER MŰKÖDTETÉSE" KÉT
KÜLÖN DOLOG, ÉS A TILTÁS CSAK AZ ELSŐRE SZÓL.** Szó szerint: *„a rendszerben ahol dolgozunk mindig
van munka, nem? Én csak azt mondom, hogy magát a keretrendszert ne fejlesszük, de ha jól tudom azért
lett friday, hogy neked könnyebb legyen, hogy tehermentesítsen téged... nem csak a marveen
keretrendszer fejlesztésén dolgozik, hanem a rendszer működésén helyetted."*

    KERETRENDSZER-FEJLESZTES ..... uj funkcio a marveenbe        -> NEM csinaljuk, felkuldjuk Szotasznak
    A RENDSZER MUKODTETESE ....... hogy a hat agens ne fusson    -> MEGY TOVABB, ez a koordinator
                                   bele ugyanabba a hibaba          tehermentesitese

**A koordinátor (marveen) 21:56-kor a kettőt EGYNEK vette, és ebből azt a hamis következtetést
vonta le, hogy friday sávja bezárul.** Megmérve az ő 21 nyitott kártyáján: szinte MIND a második
fajta (elgépelt ágens-névre 200-at adó küldés; a kanban PUT csendben eldobott mezője; a
nyomtalan tartalék-küldő; három ágens ugyanazon a skill-fájlon; három dokumentum három naptár-úttal;
kilenc soha nem mért Playwright-spec). Ezek közül EGY sem marveen-funkció.

**A gyakorlati szabály tehát:** a marveen-sávú munka MEGY TOVÁBB, amíg arról szól, hogy valami
csendben rosszul működik és emiatt rossz döntés születik. Ami VALÓBAN új keretrendszer-funkció
lenne, az PR-ként megy Szotaszhoz. A két új projekt előkészítése akkor jön, amikor ez a sor kiürül.

**ÉS A HATÁRVONAL NEM A FÁJL, HANEM A DÖNTÉS -- AZ ELSŐ ALAKOM HASZNÁLHATATLAN VOLT** (marveen adta
ki, friday mérte meg és döntötte meg, 2026-09-04, egy órán belül).

Egy döntésnél azt a próbát adtam ki, hogy UPSTREAM fájlt szerkeszt-e a javítás: ha igen, az
keretrendszer-fejlesztés, tehát PR Szotaszhoz. friday megmérte, mielőtt követte volna:

    src/web alatt 154 fájlból **11 a miénk**
    a konkrét olvasási út (`context-guard-store.ts` + mindhárom fogyasztója) MIND upstream

Vagyis a fájl-szintű próba betű szerint **majdnem minden változtatást megtiltana** -- tehát soha nem
az volt a szabály, amit ténylegesen alkalmaztam. A helyes alak az ő megfogalmazása:

> nem az a kérdés, hogy upstream FÁJLHOZ nyúlunk-e, hanem hogy felülírunk-e egy kimondott
> upstream DÖNTÉST.

Mért példa mindkét oldalra: a `DEFAULT_CONTEXT_GUARD` alapértelmezését átbillenteni FELÜLÍRÁS (a
139. sor kimondja, hogy az opt-in szándékos) -- egy hiányzó configról szóló naplósor hozzáadása nem
az, akkor sem, ha upstream fájlba kerül a hívása.

**ÉS AZ ALAK MÁR OTT VAN A FÁBAN, ne találj ki újat:** `kanban-project-warning.ts` -- a logika a MI
saját modulunkban, az upstream route-ban egyetlen import és egyetlen hívás. Egy elv alak nélkül
minden körben másképp vezetődik le.

*(A saját hibám alakja a lap többi helyéről ismerős: egy PROXY -- a fájl tulajdonosa -- csendben
átvette a valódi kérdés helyét, és azért élte túl, mert abban az egy esetben, amiből született,
UGYANAZT a választ adta. A döntésem helyes volt; az indoklása véletlen egybeesés.)*

**SPECIALISTA CSAPATOT EPITUNK, NEM UNIVERZALIS UGYNOKOKET (Isti, 2026-09-03 22:15, kimondottan
kerte, hogy irjam fel).** Szo szerint: *„Olyan csapatot akarok... amelyek specializalt egyenekbol
allnak es mindenkinek megvan a maga terulete amiben a legjobb. Nem olyan univerzalis ugynokokre van
szukseg akik mindenben jok. Ezert fogunk majd meg a jovoben specializalt ugynokoket letrehozni
marketingre, kutatasra, stb."*

**AZ ELSO KOVETKEZMENY, ES AZONNALI:** egy ugynokot NEM teszunk at egy masik teruletre csak azert,
mert a sajatjan kevesebb munka van. Isti ezt kifejezetten friday-re mondta ki (*„Friday-t nem
kuldenem ra semmire... mert o a rendszer mukodtetesere van specializalva"*) -- es ezzel megdontotte
a koordinator 22:04-es javaslatat, ami epp ezt kinalta fel harom valtozatban. **A kevesebb munka nem
indok az atsorolasra.**

**A MASODIK, ES EZ ALLANDO FELADAT A KOORDINATORNAK:** *„ha ugy erzed, hogy egy tipusu feladat
tobbszor jelentkezik es szukseges lenne a csapatnak a jo munkahoz egy specializalt ugynokre, akkor
ird meg a javaslatod!"*

Vagyis a visszateroen felbukkano feladat-TIPUS megfigyelese a koordinatore, es a javaslat is. A
jelzes nem az, hogy valaki tulterhelt, hanem hogy egy TERULET ismetlodik gazda nelkul -- azt kell
eszrevenni es javasolni. (Az uj agens felallitasa: `alagens-felallitas` skill.)

**ES A HARMADIK, ISTI FINOMITASA 22:20-KOR: ELOBB A BOVITES, CSAK UTANA AZ UJ UGYNOK.** Szo szerint:
*„az is lehet, hogy ha passzolna valamelyik ugynok munkakorebe az ilyen feladat, akkor ki is
bovithetjuk a feladatait, a specializaciojat, nem?"*

    BOVITES ....... olcso: nincs felallitas, nincs uj kontextus, es nem kell kulon munkaval etetni
                    egy uj savot. EZ AZ ELSO KERDES.
    UJ UGYNOK ..... akkor eri meg, ha a terulet elég nagy ahhoz, hogy KITOLTSE valakinek az idejet.

**ELSO ALKALMAZAS, ES MAR MEG IS TORTENT: az ELES ADATBAZIS-MERES didi kore.** Ma este ketszer
vegzett ilyet szabalyosan (zart csak-olvaso tranzakcio, a kapu tuzelese a meres ELOTT ES UTAN
bizonyitva, es kimondva, mit NEM mert). Ez nem uj ugynok, hanem egy kimondatlan specializacio
kimondasa. Ha kiderul, hogy egymagaban kitolt egy embert, akkor jon az uj ugynok.

**A jövőbeli kódoló ágens.** Isti külön, kizárólag kódolással foglalkozó ágenst tervez.
A kódolási tudást és kontextust tedd félre, hogy át lehessen adni neki.
