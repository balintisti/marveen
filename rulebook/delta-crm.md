# Project Rules — Delta CRM (sajat-crm)

## Environment Awareness

This project runs in production as a multi-tenant SaaS CRM. Before making changes to infrastructure, Sentry config, server processes, or deployment workflows:
- Always consider production implications first
- Never just kill processes without understanding if they're serving production traffic
- Separate dev and production configurations explicitly
- All queries MUST be scoped to `organizationId` for tenant isolation

## CI/CD Pre-commit Checks

Before committing or pushing, ALWAYS run the following checks locally:
1. `npx tsc -b` (strict TypeScript build — both backend and frontend use full strict mode)
   **DE A TESZT-FÁJLOKRA NEM HAT, és ezt eddig nem mondtuk ki** (mandark mérte 2026-08-27 21:43,
   kontrollal): a `tsconfig` `exclude`-ja kihagyja a spec/test fájlokat -- **418 backend spec és
   397 frontend teszt: NULLA a `tsc` gráfjában** (nulla-kontroll: 1898 nem-spec forrás BENNE van,
   tehát a mérő nem mindenre mond 0-t). Az `eslint no-dupe-keys` = 0, mert a typescript-eslint a
   TS-re bízza; a `ts-jest` `isolatedModules: true`-val transzpilál, típusellenőrzés nélkül.
   Mérve: egy spec-fájl, amiben EGYSZERRE áll egy nyilvánvaló típushiba és egy dupla kulcs,
   **mind a három kapun átmegy** (jest 1 passed, `tsc -b` 0 diagnosztika, eslint üres).
   **Következmény a jelentésekre:** ha egy bizonyíték-sor ÚJ TESZT-FÁJLRÓL szól, a „tsc 0" ne
   álljon ott magyarázat nélkül -- vagy hagyd el, vagy írd oda, hogy a spec-fájlokra nem hat.
   Nem hamis állítás, de többet sugall, mint amennyit mértek.
   *(Az `exclude` nem hiba önmagában -- van rá érvényes indok. A lelet az, hogy MELLÉ nem készült
   másik kapu.)*

   **ÉS A „MÉRETLEN" MOSTANTÓL MÉRVE: 20 esetes minta a 360-ból -> 12 VALÓDI DEFEKTUS (60%)**
   (jarvis mérte 2026-08-28, `integration/2026-08-25-merge @ 3096fd2a`, rétegzett minta 17 fájlból;
   a `filter-query.service.spec.ts` nélkül 11/17 = 65%, tehát a két populáció nem tér el érdemben).

   **A DOMINÁNS ALAK ROSSZABB, MINT A „típus-zaj": a 12-ből 8 `TS2554`, KEVESEBB argumentummal.**
   A hiányzó paraméter futásidőben `undefined`, a `ts-jest` nem típusellenőriz, tehát **a teszt
   ZÖLDEN fut, miközben olyan hívási alakot gyakorol, amit az éles kód soha nem állít elő.** Két
   mért példa: `files.service.spec.ts:518` `UserRole.MEMBER`-t használ, ami NEM LÉTEZIK -- egy
   tagsági jogosultságról elnevezett teszt egy elgépelésre ugyanúgy zöld; és
   `projects.service.spec.ts:1768` szándékos `// No userId` kommenttel olyan állapotot fed le,
   amit a szignatúra ki is zár.

   **ÉS A FENT JAVASOLT `tsconfig.spec.json` NAIV ALAKJA NÉMÁN NULLÁT AD** (ugyanaz a mérés, első
   futás): az `extends` **örökli a szülő `exclude`-ját**, ami épp a `**/*spec.ts`-t dobja ki --
   tehát az `include` felülírása ÖNMAGÁBAN nem elég, és az eredmény 0 diagnosztika, ami
   megkülönböztethetetlen a „nincs hiba" választól. Az `exclude`-ot IS felül kell írni.

   **A KONTROLL, ami ezt azonnal megfogta, és ami nélkül a 0 elhihető lett volna:** a próba-konfig
   FÁJL-GRÁFJÁT kell megnézni, nem a diagnosztika-számot. Némán 715 fájl (bájtra annyi, mint az
   alapé); az `exclude` felülírása után 1179, azaz +464 -- ekkor jött az 1672 diagnosztika.
   **Egy típusellenőrző nulla találata addig nem állítás, amíg nem tudod, hány fájlt nézett meg.**

   **ÉS EZ A FRONTENDRE UGYANÚGY ÁLL -- A SZAKASZ EDDIG CSAK A BACKENDRŐL SZÓLT** (computress mérte
   2026-09-04, marveen a konfigból újramérte). A fenti blokk végig `backend`-et mond, és emiatt
   olvasható úgy, mintha a frontend `tsc -b` LÁTNÁ a teszteket. Nem látja -- sőt, SZÉLESEBB
   kizárással:

       backend/api/tsconfig.json   exclude:  ..., "test", "**/*spec.ts"          <- 2 minta
       frontend/tsconfig.app.json  exclude:  "src/**/*.test.ts", "*.test.tsx",
                                             "*.spec.ts", "*.spec.tsx",
                                             "src/**/__tests__/**", "src/test/**"  <- **6 minta**
       frontend/tsconfig.json      `files: []` + references -> a `tsc -b` a fenti excludon át épít

   computress futás-oldali mérése ugyanez: **821 src fájl a build-gráfban, 0 teszt-fájl**
   (kontroll: a `RelationshipsPanel.tsx` BENNE van, tehát a mérő lát fájlt).

   **A GYAKORLATI KÖVETKEZMÉNY, ÉS MA KONKRÉT ÁRA VOLT:** egy komponensből KIVETT prop ott hagyja a
   teszt-hívási helyeket -- lefordítva ÉS zölden. Két ilyen hívást aznap csak KÉZI GREP talált meg.
   Vagyis a `tsc -b` zöldje egy prop-eltávolítás után a frontenden sem állítás a tesztekről.

1/b. **`npm run typecheck:tests` -- MINDKET CSOMAGBAN, ES EZ A LAP EDDIG EGYSZER SEM EMLITETTE**
   (marveen merte magan 2026-09-06, egy CI-kor araban). A fenti blokk hosszan levezeti, hogy a
   `tsc -b` NEM LATJA a spec-fajlokat, es a `tsconfig.spec.json`-t JAVASLATKENT targyalja. **Mar
   letezik, mindket csomagban, es a CI ERVENYESITI** -- kulon jobkent (`Backend Type Check` es
   `Frontend Type Check`, az utobbi lepese: "Type-check the test files against the budget").

       backend/api   scripts/spec-typecheck-budget.mjs  + spec-typecheck-budget.json
       frontend      scripts/test-typecheck-budget.mjs  + spec-typecheck-budget.json

   **KET PELDANY, ES AZ EGYIK LEFUTTATASA NEM A MASIKE.** 2026-09-06-an egy koteg-verifikacional
   lefutott a backende (1638/1638, rc=0) es a frontende NEM -- "a racsni backend-dolog", fejbol,
   meres nelkul. A CI talalta meg: **OVER BUDGET by 4**, negy tipushiba ket UJ teszt-fajlban.
   Az alapvonal ugyanaz a mero az `origin/main`-en: 1140/177, rc=0, pontosan a kereten.

   **ES A NEGYBOL HAROM NEM KOZMETIKAI VOLT:** egy teszt `{ goal }`-lal renderelt egy komponenst,
   aminek HAROM tovabbi kotelezo propja van (TS2739) -- vagyis olyan hivasi alakot rogzitett,
   amit az eles kod soha nem allit elo. Pontosan az a csalad, amit ez a szakasz feljebb `TS2554`
   neven mar rogzit. **A vitest nem tipusellenoriz, a `tsc -b` kizarja a specet: ez a racsni az
   EGYETLEN kapu, ami ezt latja.**

   Az attribucio SORSZAM NELKUL keszuljon (a pozicionalis diff tulmond), es a KONTROLL a forditott
   irany: ha a "csak a main-en" halmaz nem ures, a koteg javit is, nem csak ront.

       npx tsc -p tsconfig.spec.json --noEmit --pretty false   # mindket fan, aztan sed-del a
       # sorszamokat kivagva `comm`-mal osszevetve -- FIGYELEM: a `comm` ekezetes/glifas soron
       # hu_HU alatt osszeejt, lasd a locale-szakaszt; itt a bemenet csupa ASCII, ezert all

   **A racsni CSAK SZORULHAT.** A szkript sajat uzenete felajanlja a plafon emeleset ("or say in
   the commit message why the ceiling has to rise") -- az UJ MERESHEZ jar, nem sodrodashoz. Egy
   elkerulheto tipushiba uj teszt-kodban javitando, nem beszamolando.

2. `npx eslint . --ext .ts,.tsx` (catch unused imports, `any` types, unused variables)
3. Verify no unused imports, `any` types, or non-existent component props remain in changed files
4. Run the relevant test suite for changed files — fix any failures
5. Only after ALL checks pass, create the commit

Never assume local compilation passing means CI will pass — CI uses stricter checks.

## File Discovery

Do NOT guess file paths. Always use Glob or Grep to find files before reading or editing them. When a filter or feature touches query locations, exhaustively search for ALL relevant locations — not just the obvious ones.

### ÚJ KÖZÖS FÁJL ELŐTT: KÉRDEZD MEG, LÉTREHOZTA-E MÁR VALAKI EGY MÁSIK ÁGON

Három duplikáció nyolc nap alatt (kártya `d1259d7e`): ketten definiálták a `LogoutReason`-t,
ketten a `customFieldsToMappings`-t, és ketten LÉTREHOZTÁK a `hooks/useOrgPhoneRegion.ts`-t,
MÁS TARTALOMMAL. Egyik szerző sem tudott a másikról, és semmi nem jelzett -- se írás közben, se a
pushnál, se a review-nál. A jelzés az volt, hogy valaki HETEKKEL később függőségi gráfot mért.

Új fájl létrehozása előtt a megosztott könyvtárakban (`hooks/`, `lib/`, `types/`, `utils/`,
`common/`):

```bash
git log --all --diff-filter=A --format='%h %an %ad %s' --date=short -- '*<fájlnév>'
```

**ÉS UGYANEZ A RECEPT A MÁSIK IRÁNYBAN: EGY CENZUS, AMI AZ `origin/main`-T NÉZI, SOHA NEM
KÉRDEZI MEG, HOGY MEGÉPÜLT-E MÁR EGY ÁGON** (didi mérte, 2026-09-04 -- KÉT előfordulás EGY estén).

    `b778c528` ..... dangerous-html guard, ÁGON 08-23 óta -> dexter 09-04-én épített egy FRISSET
    `d996934a` ..... a kártya SAJÁT orvossága (i18n-scan.py), HÁROM ágon 08-24 óta, `main`-en 0

**Mindkét „hiányzik" MÉRÉS HELYES VOLT: az `origin/main`-t mérték, és onnan tényleg hiányzott.**
Amit egyik sem kérdezett meg: megépült-e már valahol.

    „hiányzik a `main`-ről?"      -> a válaszból **ÍRJUK MEG** következik
    „megépült már egy ÁGON?"      -> a válaszból **VEGYÜK ÁT** következik

**A két kérdés annyira hasonlít, hogy a másodikat senki nem teszi fel** -- és a különbség egy este
alatt két újraépítés volt. Mindkettő EGY sorral megtalálható, ugyanazzal a recepttel, csak `--all`-lal:

```bash
git log --all --oneline --diff-filter=A -- '<útvonal>'
# KONTROLL: egy biztosan nem létező útra 0 sor -- különben a nulla a mérőről szól, nem a fáról
```

*(A fenti szakasz ezt a receptet ÜTKÖZÉS-megelőzésre írja elő -- „hozta-e létre már valaki". Ez a
bekezdés ugyanazt a parancsot MUNKA-megelőzésre: „megírták-e már". Ugyanaz a sor, két különböző
pillanatban -- az első ÍRÁS előtt, a második akkor, amikor egy cenzus azt mondja, hogy valami
hiányzik.)*

**GLOBBAL, ne fejből írt relatív úttal.** Egy mellé írt út ÜRES választ ad -- és az üres válasz
pontosan úgy néz ki, mint a „senki nem hozta még létre".

**ÉS A DUPLÁZÁS TENGELYFÜGGŐ -- EZ A SOR EDDIG TENGELY NÉLKÜL ÁLLT, ÉS ÉPP A FENTI RECEPTBEN ADOTT
NÉMA NULLÁT** (mandark mérte 2026-09-05, dexter `508dfd86`-os méréséből; marveen újramérte a szakasz
SAJÁT kontroll-példáján):

    git pathspec (ls-tree / log / grep, a repó GYÖKERÉHEZ képest) ...  `sajat-crm/<csomag>/`  EGYSZERES
    fájlrendszeri ABSZOLÚT út (a szülő könyvtárból) .. `.../sajat-crm/sajat-crm/<csomag>/`  DUPLÁZOTT

**Mérve, ennek a szakasznak a saját, „kontrollal igazolva" példáján (`useOrgPhoneRegion.ts`):**

    -- 'sajat-crm/sajat-crm/hooks/useOrgPhoneRegion.ts'      ->  **0 sor**   (a lap által írt alak)
    -- 'sajat-crm/frontend/src/hooks/useOrgPhoneRegion.ts'   ->  2 sor
    -- '*useOrgPhoneRegion.ts'                               ->  2 sor
    KONTROLL: egy biztosan nem létező útra -> 0, tehát a nulla a MÉRŐRŐL is szólhatna

**A duplikáció-megelőző recept, betű szerint követve, ÁTENGEDTE PONTOSAN AZT A DUPLIKÁCIÓT, AMIÉRT
LÉTEZIK** -- és épp azon a fájlon, amit ez a szakasz a saját bizonyítékaként hoz fel.

**A DUPLÁZÁST NE TÖRÖLD KI:** a fájlrendszeren VALÓBAN duplázott, mert maga a checkout könyvtár is
`sajat-crm` nevű -- aki abszolút utat ír, annak kell. Csak a TENGELY hiányzott.

*(A git-oldali alak NEM ágfüggő: mandark mérte, 537/537 origin ref hordoz gyökér-`sajat-crm/`-t.
A lenti „DE EZ ÁGFÜGGŐ" megjegyzés a FÁJLRENDSZER/worktree tengelyre vonatkozhat -- azt egyikünk sem
mérte, ezért nem nyúltunk hozzá.)*

**A HATÁRA, KIMONDVA: ez FÁJL-szintű, és a szimbólum-szintre NEM terjed ki.** A fenti háromból
egyet fog meg (`useOrgPhoneRegion.ts`); a másik kettő meglévő fájlba tett új export, azt ez a
lekérdezés szerkezetileg nem látja. A szimbólum-szintű változat drága és zajos (a név-egyezés nem
használat-egyezés), ezért nem azt írjuk elő.

Kontrollal igazolva: a `useOrgPhoneRegion.ts`-re ma kiírja MINDKÉT létrehozást, egy biztosan nem
létező útra pedig ÜRESET ad.

**ÉS EGY NEGYEDIK PÁR 2026-09-05-ÉN HATVANHÉT MÁSODPERC ALATT KELETKEZETT -- AMI MINDEN EDDIGI
ORVOSSÁGUNK PREMISSZÁJÁT MEGSZÜNTETI** (friday mérte; marveen volt a második szerző).

    4befae32  friday   17:23:08   a teljes méréssel
    b5c4b22a  marveen  17:24:15   üres leírással
    **ugyanaz a lelet, UGYANABBÓL az EGY üzenetből, 67 MÁSODPERC**

A fenti három pár 56 perc, 3 óra és 9 óra 42 volt, és minden receptünk -- a `--diff-filter=A`, a
`git log --all` -- azt feltételezi, hogy **az első szerző MÁR LANDOLT valamit.** Hatvanhét
másodpercnél senki nem landolt semmit, és mindkét szerzőnek a HELYES reflexe volt, hogy kártyázza.

**ÉS A CÍM-HASONLÓSÁG NEM FOGTA VOLNA MEG: egyetlen közös szó volt a két címben.** Ami megfogta
volna: az AZONOSÍTÓ-METSZET -- mindkét kártya UGYANAZT a két szkriptet és UGYANAZT a két
elutasítást nevezi meg.

    IDŐ-alapú ellenőrzés .... szerkezetileg vak 67 másodpercnél
    CÍM-hasonlóság .......... 1 közös szó -> nem jelöl
    **TARTALOM-metszet** .... a megnevezett fájlok/szimbólumok halmaza -> EZ az egyetlen, ami mér

*(A gyakorlati alak: ha egy kártyát EGY konkrét üzenetből vagy leletből nyitsz, a duplikátum-próba
ne az legyen, hogy „ki írta már meg", hanem hogy „melyik nyitott kártya nevezi meg UGYANEZT a
fájlt vagy szimbólumot". Az első kérdés IDŐT feltételez; a második nem. És a jelen esetben a
második szerző a koordinátor volt, aki épp az első szerző üzenetét olvasta -- tehát a forrás
KÖZÖS volta maga a kockázat, nem a véletlen egybeesés.)*

**ÉS AMIT EZ SEM OLD MEG -- ÉS EZ NEM A KIVÉTEL, HANEM AZ ALAPESET** (jarvis mérte mind a három
páron, 2026-08-29; az első alakom csak egyet nevezett meg, és ezzel többet ígért, mint amennyit ad):

    LogoutReason ............ 08-20 20:07 -> 21:03      56 PERC
    customFieldsToMappings .. 08-21 19:11 -> 22:12      3 óra 01
    useOrgPhoneRegion ....... 08-24 12:19 -> 22:01      9 óra 42

**Mind a három pár UGYANAZON a napon keletkezett.** Vagyis amikor a második szerző elkezdte, a
történet a legtöbb esetben MÉG NEM tartalmazta az elsőt -- a fenti lekérdezés tehát nagyjából
háromból egyet fog meg, és épp azt, amit egy fájl-szintű horgony amúgy is lát.

**A KIMONDOTT KORLÁT, ami nélkül a fenti számok többet állítanának:** a commit-távolság a
felderítési ablak FELSŐ KORLÁTJA, nem az ablak. Azt nem mértük, mikor KEZDTE a második szerző, és
hogy a másik ágat lehúzta-e egyáltalán.

**ÉS EGY NEGYEDIK ESET MEGADTA AZ EGYETLEN OLCSÓ JELET, AMI EZT A HÁROMBÓL-KETTŐT IS ELKAPJA -- ÉS
MÉRT PRECIZITÁSSAL, AMI ELLENTÉTE A MA ESTI TÖBBI DETEKTORNAK** (mandark és computress építette
ugyanazt a funkciót, marveen mérte, 2026-09-04).

Két ág, ugyanaz a funkció, ugyanaz a négy fájl, két szerző, egyik sem tudott a másikról:

    fix/011bbc1b-protected-field-ui     mandark, done
    fix/e9292631-protected-field-ui     computress, testing
    -> beolvasztva egymásra: **rc=1, NÉGY ütközés**

**A fájl-szintű `--diff-filter=A` recept ezt SZERKEZETILEG nem látja: mindketten MEGLÉVŐ fájlokat
szerkesztettek, tehát nincs add-esemény, amit meg lehetne találni.** Ez a lap saját, kimondott
korlátja -- most egy mért példánnyal.

**A JEL VISZONT OTT VAN AZ ÁGNÉVBEN: AZONOS SLUG, KÜLÖNBÖZŐ KÁRTYA-ID.**

```bash
git branch -r --format='%(refname:short)' | sed 's|^origin/||' \
  | grep -E '^[a-z]+/[0-9a-f]{8}-' | sed -E 's|^[a-z]+/[0-9a-f]{8}-||' \
  | sort | uniq -c | sort -rn | awk '$1>1'
```

    326 kártya-id nevű ág | 325 különböző slug | **EGYETLEN ütközés, és az a valódi pár**
    KONTROLL: 705 távoli ág összesen, tehát 379 nem viseli a konvenciót -- a mérő egy RÉSZHALMAZON
      dolgozik, és ezt ki kell mondani
    KONTROLL 2: ugyanez a kártya-id KÖVETELMÉNYE NÉLKÜL, mind a 705 ágon -> több találat, és azok
      HAMISAK (`main`, `didi-pair`, ... = ugyanaz az ág KÉT TÁVOLIN). A szűkebb alak az, ami mér.

**A precizitása mért 1/1 a teljes populáción; a RECALL-ja viszont ismeretlen és valószínűleg alacsony**
-- csak azt fogja meg, ahol a két szerző véletlenül ugyanazt a slugot választotta. Vagyis nem
helyettesíti a feladat-kiosztást, de EGY SOR, és nulla hamis riasztást adott 326 ágon. Egy köteg
összeállítása előtt megéri lefuttatni.

*(A kontraszt szándékos: ugyanezen az éjszakán négy javasolt detektor futott 79%, 89%, 93% és 97%
hamis pozitívval, és mind a négyet a mérésük állította le. Ez az egy azért került be, mert MÉRVE
nem termel zajt -- nem azért, mert jól hangzik.)*

**Ebből következik, hogy a valódi védelem nem a git, hanem a FELADAT-KIOSZTÁS** -- két kártya, ami
ugyanahhoz a fájlhoz nyúl, ne menjen ki két embernek. Az a koordinátoré, és nem ez a recept
váltja ki.

## Pre-Implementation Rules

Before implementing any changes, ALWAYS:
1. Use Grep and Glob to find ALL files and locations that need to change
2. Create a complete list with file paths and line numbers
3. Show the list to the user for approval before making any edits

### Codebase Audit for Larger Changes

For any feature or function that touches multiple files, use a Task agent (Explore) to audit the entire codebase BEFORE starting implementation:
1. Spawn an Explore agent to find every file, function, and line number that references the target feature/function
2. The agent must return a complete manifest of all locations that need to change
3. Do NOT begin implementation until the audit is complete and the manifest is reviewed by the user

## Project Structure

Monorepo with **four** packages (measured 2026-08-22 -- the earlier "two packages" line was wrong,
and it cost a false conclusion: see below):
- **Backend**: `sajat-crm/backend/api/` — NestJS 11, TypeScript 5.7, **112** Prisma models
  (`grep -c '^model ' backend/api/prisma/schema.prisma`, mérve 2026-08-22; a korábbi 92 elavult)
- **Frontend**: `sajat-crm/frontend/` — React 19, Vite 7, TailwindCSS, TypeScript 5.9
- **Mobile**: `sajat-crm/mobile/` — Expo/React Native, 356 .ts/.tsx **plus 8 Kotlin files** in one
  native module (`modules/delta-caller-id/android/`: CallStateMonitor, DeltaCallScreeningService,
  CallLogReader, OverlayCardController, …). A `find -name '*.kt'` without excluding `node_modules`
  reports **1683** — that count is react-native/expo library source, not ours.
- **Shared**: `sajat-crm/shared/`

**A „58 modules" és az „1233 .ts/.tsx" számot KIVETTEM, nem frissítettem** (didi mérte 2026-08-22,
kártya `22511ff4`). Egyik sem jött ki újramérve, és a valódi ok nem az elavulás: **egyik sem
mondta meg, MIT számol.**

| amit kérdezhettél | parancs | 2026-08-22 |
|---|---|---|
| backend modulok, fájl szerint | `find backend/api/src -name '*.module.ts' \| wc -l` | 66 |
| backend modulok, dekorátor szerint | `grep -rl '@Module(' backend/api/src --include='*.ts' \| wc -l` | 68 |
| backend al-könyvtárak | `find backend/api/src -maxdepth 1 -type d \| tail -n +2 \| wc -l` | 62 |
| frontend forrás | `find frontend/src -name '*.ts' -o -name '*.tsx' \| wc -l` | 1202 |
| frontend a csomag egészében | ugyanez `frontend/` alatt, `node_modules` nélkül | 1251 |

Három helyes válasz ugyanarra a szóra („modul"), és 49 fájl különbség aszerint, hol húzod meg a
csomag határát. **Egy szám populáció nélkül nem elavul: eleve nem állít semmit** -- és pont azt a
biztonságérzetet adja, ami miatt senki nem méri újra. Ha ide szám kerül, jöjjön vele a parancs.

Note the doubled directory name: the packages live under `sajat-crm/sajat-crm/<package>/`.

**ÉS EGY NÉV, AMIT A SZOMSZÉDJÁBÓL TALÁLTUNK KI A DEFINÍCIÓJA HELYETT, NÉMA NULLÁT AD -- KÉT
ELŐFORDULÁS EGY ÓRÁN BELÜL, KÉT ÁGENSNÉL** (marveen és dexter, 2026-08-29).

    marveen:  a scope-ot a KÖNYVTÁRNÉVBŐL tippelte      `@sajat-crm/shared`   -> 0 / 0 / 0
              a valódi név a package.json-ből            `@delta-crm/shared`   -> 0 backend
                                                                                  1 frontend
                                                                                 79 mobile
    dexter:   a dekorátor nevét a METAADAT-KULCSBÓL      `ImportBatchActions`  -> 0 találat
              (`IMPORT_BATCH_ACTIONS_KEY`)
              a valódi név                       `RequireBatchEntityPermission` -> 3 útvonalon,
              pontosan az execute / rollback / rollback-records hármason

**A repó át lett nevezve: a könyvtárszerkezet a RÉGI nevet őrzi (`sajat-crm/`), a package.json az
ÚJAT (`@delta-crm/*`).** Aki a scope-ot az útvonalból vezeti le, tökéletesen hihető nullát kap.

**dexter SZABÁLYA, MECHANIKUS, ÉS INGYEN VAN:**

> **HA EGY CENZUS NULLA HASZNÁLATOT JELENT EGY SZIMBÓLUMRA, AMIT A FÁJL IMPORTÁL, AKKOR A CENZUS
> A ROSSZ, NEM A KÓD.**

**ÉS A GENERÁLIS ALAKJA, EGY MÁSODIK MÉRT PÉLDÁNNYAL** (didi fogalmazta meg magán, 2026-09-04):

> **HA AZ ÁLLÍTÁSOD ELLENTMOND VALAMINEK, AMI MÁR A KÉPERNYŐDÖN VAN, AKKOR AZ ÁLLÍTÁS A ROSSZ,
> NEM A VILÁG.**

didi egy guard viselkedését „hamis pozitív"-ként jelentette. A cáfolat a fájl SAJÁT docblockjában
állt (*„the expression must be WHOLLY a sanitiser call"*, a bezárt lyukkal együtt nevesítve) --
**és ő kinyomtatta azokat a sorokat UGYANEBBEN a munkamenetben**, a trimmer vizsgálata közben.

    dexter alakja ..... a CENZUS mond nullát arra, amit a fájl IMPORTÁL
    didi alakja ....... az ÁLLÍTÁSOD mond ellent annak, ami a SAJÁT eszköz-kimenetedben áll

**Egyik sem hiányzó információ volt: OLVASATLAN információ a saját kimenetben.** Ez a
megkülönböztetés teszi használhatóvá -- egy hiányzó adatot be kell szerezni, egy olvasatlant csak
el kell olvasni, és épp ezért nem keresi senki.

*(A mechanizmus, amiért kicsúszik, és ez a hordozható rész: didi a SZABÁLYT hasonlította össze a
KIVÉTEL INDOKLÁSÁVAL -- „wholly a sanitiser call" kontra „a literál nem hordozhat felhasználói
bemenetet" -- és a kettő közti rést nevezte inkonzisztenciának. Két KÜLÖNBÖZŐ kritérium: a szerző
SZÁNDÉKOSAN választott egy SZINTAKTIKAI szabályt, ami eldönthető, egy szűken indokolt kivétellel,
egy SZEMANTIKAI helyett, ami nem az. Aki a szabályt az indoklásához méri, mindig talál rést.)* Egy nem használt import fordítói figyelmeztetés lenne. Ha nincs
> figyelmeztetés, rossz nevet kerestél.

Nála a cáfolat végig a képernyőn volt: a kontroller a 30. sorban IMPORTÁLJA a szimbólumot, miközben
a cenzusa nulla használatot mondott. Két állítás, ami nem lehet egyszerre igaz.

**ÉS A KÉT HIBACSALÁD JELE KÜLÖNBÖZŐ, ezért érdemes külön néven tartani:**

    HATÓKÖR-hiba (szűk ablak, soronkénti mérő)  ->  IMPLAUZIBILISAN EGYENLETES eredmény
    NÉV-hiba (kitalált szimbólum)               ->  ELLENTMONDÁS valamivel, ami már a képernyőn van

**A KONTROLL, AMI EGYIKET SEM FOGJA MEG, ÉS PONT EZÉRT VESZÉLYES:** marveen lefuttatta, hogy a grep
talál-e egyáltalán importot (1098 fájl). Talált. **Csakhogy az a MÉRŐRŐL szól, nem a MINTÁRÓL** --
azt bizonyítja, hogy az eszköz működik, arról semmit nem mond, hogy a keresett név létezik-e.
Név-alapú mérésnél a nevet a FORRÁSÁBÓL kell venni:

```bash
python3 -c "import json;print(json.load(open('sajat-crm/shared/package.json'))['name'])"
grep -n 'export const Require\|export function Require' <a dekorátor fájlja>
```

*(A tét egyik esetben sem elméleti. marveen majdnem egy „a backend is a shared csomagból importál"
premisszára épített döntést -- a helyes szám, backend 0, az ellenkezőjét mondja. dexter majdnem egy
HIGH leletet küldött ki egy HELYES modul ellen: „a per-entitás import-jog soha nem érvényesül, tehát
az `activities:import` végre tud hajtani ÉS vissza tud görgetni egy cég-importot, a rollback pedig
hard delete".)*

**ÉS EGY POZITÍV MINTA UGYANEBBŐL A FÁJLBÓL, amit érdemes másolni:** az `import.controller.ts` saját
kommentje kimondja, miért OSZTÁLY-szintű az OR és nem útvonalankénti -- és az egyik indok az, hogy
egy futásidőben feloldó guard **statikusan nem olvasható, tehát a csak úgy védett modul MINDEN
lefedettségi specben kapuzatlannak látszik**. Vagyis a szerzők nem csak a helyességre terveztek,
hanem arra is, hogy a védelem LÁTHATÓ legyen a mérőeszközöknek.
Listing from the wrong level makes the mobile package invisible.

**DE EZ ÁGFÜGGŐ, ÉS A LAP EDDIG TÉNYKÉNT MONDTA** (didi mérte magán 2026-08-29 05:0x). Van ág,
ahol a csomagok EGY SZINTTEL FELJEBB ülnek. Aki ezt a sort fejből követi, ÜRES választ kap --
és az üres válasz pontosan úgy néz ki, mint a „nincs mobil kliens": az az EGY hamis állítás,
amiről ez a szakasz szól. didi ebbe futott bele, épp e sor alapján.

**A helyes alak: ne az utat írd le, hanem KERESD MEG.**

```bash
cd "$(git rev-parse --show-toplevel)"
git ls-tree -r --name-only HEAD | grep -m1 'mobile/package.json'   # a valós út EZEN az ágon
```

**ÉS A KONTROLL, ami az üres választ elválasztja a valódi nemlegestől:** számold meg a fájlokat,
ne csak a létezést nézd -- `git ls-tree -r --name-only HEAD -- '*mobile/*' | wc -l`. didi 400-at
kapott ott, ahol az út-alapú kérdés nullát adott.

**ÉS A GYÖKÉR ABSZOLÚT ÚTJA, MERT EDDIG EGYETLEN SOR SEM ADTA MEG** (marveen mérte 2026-08-28
05:47-kor, miután beleszaladt; mandark adta meg a valós utakat):

    /Users/isti/Projektek/sajat-crm      <- a KÖZÖS checkout (mérve: létezik)
    /Users/isti/mandark-test             <- mandark munkafája (mérve: létezik)

**ÉS EZ A KÖZÖS CHECKOUT NINCS A `main`-EN, ÉS SOHA NEM IS MONDTA MEG** (didi mérte 2026-09-03,
marveen újramérte; a lelet az, hogy a lap ide küld, és a fa csendben elavult):

    a `git worktree list` ELSŐ sora, 73 csatolt worktree-vel  ->  ez a PRIMARY worktree
    az ága aznap: `fix/fef870bb-network-branch-in-error-messages` @ 86e2f2de
    HEAD ^origin/main = 0   |   origin/main ^HEAD = **534**
    KONTROLL: origin/main ^origin/main = 0, tehát a mérő tud nullát mondani

Vagyis szigorúan ŐSE az `origin/main`-nek, nem divergens -- **de aki ide `cd`-zik és egy fájlt
egyszerű útvonalon olvas el, egy 534 committal régebbi fát olvas, és semmi nem szól.**

**A SZÁM ELAVUL, AZ ALAK NEM.** Ne ezt az 534-et idézd: a checkout ága bármikor változhat, és a
lemaradás nőhet vagy nullázódhat. Amit meg kell tartani: ez a fa NEM azonos a `main`-nel, és az
egyszerű `cat`/`grep <út>` alak ezt nem mutatja meg.

**A KÉT HELYES ALAK, ha `main`-re vonatkozó állítást teszel:**

```bash
R=/Users/isti/Projektek/sajat-crm
git -C "$R" rev-list --count origin/main ^HEAD    # mekkora a RÉS most  (ma: 534)
git -C "$R" show origin/main:<út>                 # olvasás a main-ről
git -C "$R" grep <minta> origin/main -- <út>      # keresés a main-en
```

**AZ ELSŐ SOR IRÁNYA NEM MINDEGY, ÉS ELŐSZÖR FORDÍTVA ÍRTAM IDE** (didi mérte ki 2026-09-03,
percekkel a bejegyzés megírása után; a javítás az ő leletéből van):

    rev-list --count HEAD ^origin/main   ->  **0**    <- amit először ideírtam
    rev-list --count origin/main ^HEAD   ->  **534**  <- a rés
    KONTROLL: origin/main ^origin/main = 0, tehát a mérő tud mindkét irányban válaszolni

A fa ŐSE a `main`-nek, tehát az első alak **konstrukcióból nulla** -- és az is marad, akármilyen
messze csúszik hátra a checkout. **A kiírt szám 0, ami „nincs rés, a fa naprakész"-nek olvasódik:
pontosan az a hit, amit ez a szakasz megelőzni hivatott.** Nem hibaüzenet, nem üres válasz, hanem
egy magabiztos nulla a megnyugtató irányba, egy figyelmeztetés belsejében.

*(És a fenti prózában végig a HELYES pár állt -- `HEAD ^origin/main = 0 | origin/main ^HEAD = 534`
--, tehát a szöveg és az alatta álló parancs mondott ellent egymásnak. Ilyenkor a PARANCS nyer,
mert azt másolják ki.)*

**A `-C` MINDHÁROM SORON KELL.** Először csak az elsőn állt; egy scratchpadből futtatva -- ahol
mindenki dolgozik -- a másik kettő `fatal: not a git repository`-t ad. Az hangosan bukik, tehát ez
a csapda olcsóbb fele; a fenti nulla az, ami csendben téved.

*(Mért ára ugyanaznap: marveen NÉGY állítást mért ebben a fában, és "a mai main"-ként adta tovább.
Mind a négy TÚLÉLTE az újramérést az `origin/main` ellen -- de két horgony elavult, az egyik egy
`high` kártyán. A következtetések helyben maradása 534 committon át szerencse volt, nem módszer.)*

A lap eddig `sajat-crm/backend/api/` alakban hivatkozott mindenre, tehát **relatív úton -- és soha
nem mondta meg, mihez képest.** Aki abszolút utat keresett hozzá, tippelt, és a kézenfekvő tipp
(`/Users/isti/sajat-crm`) NEM LÉTEZIK. Nekem egy két perces `find`-időtúllépésbe került, aztán egy
mérés maradt el miatta.

Ez ugyanaz az alak, amiről a fenti bekezdés szól, csak egy szinttel feljebb: ott a rossz SZINTRŐL
listázás rejt el egy csomagot, itt a hiányzó gyökér miatt a keresés el sem indul. A különbség
annyi, hogy a rossz szint csendben hiányos választ ad, a hiányzó gyökér pedig hangosan elhasal --
**és épp ezért ez a kevésbé veszélyes fele.** A veszélyes az, ha valaki a rossz tippre épít egy
„nincs ilyen fájl" állítást.

*(Ami MÉRETLEN: a többi ágens munkafája. Ez a két út mérve van, a lista nem teljes -- ne
következtess belőle arra, hogy másnak nincs sajátja.)*

**Why this matters, and why it is not a documentation detail.** On 2026-08-22 an agent tightened a
backend path parameter and verified that "there is no mobile client in this repo". The listing was
taken from the wrong level, and *this file confirmed it* — two seemingly independent sources
agreeing on the same false statement. The result happened to be safe (mobile does not call those
endpoints, and sends uppercase where it sends the type at all), but **the reasoning was false**.

The mobile package carries its **own generated API types**, so a backend contract change does not
surface there as a compile error — it surfaces at runtime, at the user. A "two packages" sentence
hides exactly the third one that would be loudest but cannot speak.

**ÉS UTÓLAG NEM JAVÍTHATÓ -- KÉT FÜGGETLEN HIÁNYZÓ MECHANIZMUS** (jarvis mérte a store-oldalt,
didi az OTA-t, 2026-09-03, `origin/main` = 9f1be1d0):

    nincs `eas submit` / fastlane / store-feltöltés ... 0 találat a repóban
    nincs `expo-updates` a mobil fában ................ 0 -- KONTROLL: ugyanaz a mérő LÁT más
        expo csomagot ugyanott (app.json 1, delta-caller-id 1, package-lock 16)
    `app.json`: nincs `updates` kulcs, nincs `runtimeVersion`

Az `eas.json` `channel: preview` / `channel: production` kulcsa **NEM OTA**: a channel CÍMKÉZ egy
buildet, és `expo-updates` runtime nélkül nincs mihez kézbesíteni. Aki a channelnél megáll, „van
OTA"-t olvas ki. A csomagot ÉS a configot kell megnézni.

**A repó tehát nem tud új verziót a store-ba tenni, és nem tud hozzányúlni egy már telepítetthez.**
Ezért a „nem tudjuk, mi van a telefonokon" nem egy mérés hiányossága, hanem a rendszer
tulajdonsága -- nem fogja később valaki egy jobb lekérdezéssel bezárni.

**A gyakorlati következmény: egy hibás válasz-alak a mobilon NEM HOTFIXELHETŐ**, se kiadással, se
OTA-val. Egy mobilt érintő szerződés-változásnál az óvatosság ezért arányos, nem túlzó -- a
visszafordíthatatlanság az ár, nem a valószínűség.

## HOVÁ MEGY A PUSH, ÉS MIKOR KÉRDEZZ DEPLOY-RÓL (Isti, 2026-08-23)

**Push mehet.** Isti feloldotta a tilalmat. Egy kikötéssel: *„csak arra figyelj, hogy mindig jó
helyre… Mindig nézd meg, hogy mi hová megy."*

| repó | távoli | mi ez | mehet-e |
|---|---|---|---|
| Delta-CRM | `origin` → `balintisti/Delta-CRM` | Isti repója | **IGEN** |
| Delta-CRM | `old-origin` → `balintisti/sajat-crm` | a **régi név**, halott | **NEM** |
| marveen | `fork` → `balintisti/marveen` | Isti forkja | igen (ott ez az alapértelmezés) |
| marveen | `origin` → `Szotasz/marveen` | **idegen upstream** | **NEM**, csak PR |

**Delta-CRM munka a Delta-CRM-be, marveen munka a forkba.** A két repó `origin`-ja NEM ugyanolyan
természetű: itt a miénk, ott egy idegen projekt. `git push` előtt `git remote -v`.

Az `old-origin` azért veszélyes, mert **működik**: elfogadja a pusht, és a munka egy halott repóban
landol, ahol senki nem keresi. Nem hibaüzenetet kapsz, hanem `Everything up-to-date`-et egy rossz
helyen.

**ÉS A `git remote -v` EZT NEM FOGJA MEG -- a szabály fenti alakja VAK** (didi találta, marveen
újramérte függetlenül egy másik worktreeben, 2026-08-24; kártya `2862ad06`). A `remote -v` a repó
távolijait sorolja fel, és HELYESEN mutatja, hogy az `origin` a Delta-CRM. Csakhogy **nem az
`origin` dönti el, hova megy a push, hanem az ÁG SAJÁT upstreamje.** Mérve, ebben a checkoutban:

```
git config --get branch.develop.remote   ->  old-origin      <- A HALOTT REPÓ
git log -1 --date=short develop          ->  2025-11-26, 1665 committal lemaradva
git ls-tree --name-only develop          ->  .bash_history .bashrc .docker ... (NINCS sajat-crm/)
```

Vagyis a `develop`-on állva a szabályt BETARTÓ ágens a megnyugtató kimenetet látja, és a halott
repóba pushol. A hiba iránya a legrosszabb: a védelem lefut, zöldet mond, és nem véd.

**A helyes ellenőrzés a `remote -v` MELLÉ, nem helyette:**

```bash
git rev-parse --abbrev-ref '@{push}'                              # ide menne EZ az ág
git config --get branch.$(git branch --show-current).remote       # ugyanez, nyersen
```

A `remote -v` arra válaszol, MILYEN távoliak vannak. A `@{push}` arra, HOVA MEGY EZ A PUSH. A push
előtt a második a kérdés.

**És a másik, csendesebb kár ugyanebből:** a `develop` egy 2025 novemberi fa, tehát minden
`git diff/log/merge-base develop` **választ ad** rá -- nem hibát. Egy „a develophoz képest" mért
szám ebben a checkoutban kilenc hónapos alapvonalon áll, és ez sehol nem látszik.

**DEPLOY: HA KELL, KÉRDEZZ RÁ.** Isti szó szerint: *„ha úgy érzed szükséges a deploy, akkor
kérdezz rá nyugodtan, biztos meg fogom engedni. Tesztelés szempontjából is fontos lehet, hogy a
kijavított dolgok felmenjenek."*

Vagyis a deploy nem tiltott, hanem **kérdéshez kötött** -- és a kérdés nem formalitás: a
`deploy.yml` futtatja a `prisma migrate deploy`-t, tehát a deploy az, ami az élesen ténylegesen
átírja a sémát. Amit a kérdés mellé oda kell tenni:

1. **MI megy fel** -- a commitok, és köztük van-e migráció.
2. **MIÉRT most** -- tipikusan: egy javítást csak élesen lehet ellenőrizni.
3. **MI TÖRIK EL, ha rossz** -- és hogy visszafordítható-e.

A „biztos meg fogom engedni" nem azt jelenti, hogy nem kell kérdezni. Azt jelenti, hogy a kérdés
olcsó -- a meg nem kérdezett deploy nem az.

## A KERET ELFOGYOTT, ES 2026-10-01-EN NULLAZODIK (Isti, 2026-09-06 12:44)
## -- ES A HELYES SZABALY SOKKAL SZUKEBB, MINT A "NE PUSHOLJ"

Isti kimondta: *"Elhasznaltuk a github perceket. Jo lenne sporolni vele. Oktober elsejen
nullazodik."* ~~A SZAMOT NEM TUDJUK MERNI: a billing vegpont `404`-et ad, mert a tokenunkbol
hianyzik a `user` scope.~~

**EZ 2026-09-06 17:2x OTA HAMIS, MINDKET FELEN -- ES A DIAGNOZIS VOLT A ROSSZ, NEM A KORLAT**
(marveen szerezte meg a scope-ot Isti engedelyevel, jarvis merte ujra fuggetlenul, delta 0,0):

    a REGI vegpont (`/settings/billing/actions`) .... **410 MOVED**, nem 404 -- es a 410 TORZSE
                                                       megnevezi az utodot
    a token `user` scope-ja ......................... **MEGVAN**
    a MERES, egy hivas:

        gh api "/users/<user>/settings/billing/usage?year=2026&month=9"
        # sum(quantity) ahol sku == "Actions Linux"

    2026-09-06: **2912,0 perc / 3000** -> marad 88,0
    KONTROLL: ugyanez a hivas ev-szintre 27072,3-at ad, tehat a honap-szuro tenylegesen szur

**ES A PERCDIJ IS MERT, A SAJAT SZAMLANKROL, nem listaar:** brutto 17,472 USD, kedvezmeny
17,472, **netto 0,000** -> **0,006 USD/perc**. A netto nulla azt is megmondja, hogy MEG a
kereten BELUL vagyunk, tehat a 88 valodi maradek -- es az elso perc utana mar penz, nem
kvota-figyelmeztetes. Egy ~110 perces futas tullepeskent ~0,66 USD.

*(A tanulsag nem a szam: a lap KET EVIG azt mondta, hogy ez nem merheto, es ebbol
"Isti allitasa az EGYETLEN forras" kovetkezett. A korlat nem letezett -- egy ROSSZ DIAGNOZIS
allitotta meg a merest. Egy "nem merheto" mondat pontosan addig igaz, amig valaki meg nem
probalja ujra.)*

**A TRIGGEREK A MAI `main`-rol, MERVE -- es ebbol kovetkezik, hogy MI INGYENES:**

    ci.yml      push: [main, develop]  +  pull_request: [main, develop]
    deploy.yml  workflow_run (a CI utan, main)  +  workflow_dispatch

    egy FEATURE-AG pusholasa, amire NINCS nyitott PR ....... **INGYENES**, nem indul CI
    egy PR MEGNYITASA a main/develop fele ................. ~100 perc
    push egy agra, amire VAN nyitott PR (`synchronize`) .... ~100 perc
    push a `main`-re ...................................... ~100 perc + a deploy

**A "ne pusholj" tehat TUL TAG es feleslegesen allitana meg a munkat.** A szuk, helyes alak:

> **Pusholj nyugodtan feature-agat. NE nyiss PR-t, es ne pushold azt az agat, amire van nyitott
> PR.** A koteg-merge a koordinatore, es 10-01-ig Isti kulon szavahoz kotott.

```bash
gh pr list --repo balintisti/Delta-CRM --state open --head <ag>   # URES = ingyenes
```

**A LEGNAGYOBB EGYETLEN TETEL, ES NEM MI TERMELJUK: a dependabot.** 2026-09-06-an het nyitott
PR-bol **hat** dependabot volt, es a 09-01..09-04-es meres szerint a dependabot 12 futasbol
**372 percet** vitt el -- a szamla 23%-at. Egy PR BEZARASA nem indit CI-t, tehat nulla percbe
kerul; a dependabot kesobb ujra megnyitja. Ez Isti dontese, felajanlva 12:4x-kor.

**ES AMI CSAK NULLA KERETNEL LATSZIK -- a lap mar rogziti lentebb, most elesben szamit:** a
`deploy.yml`, a `rollback.yml` es a `migrate.yml` MIND Actions job. Ha a keret elfogy, nem csak
szallitani nem lehet: **visszagorgetni sem, a dokumentalt uton.** A veszkijarat a Cloud Run
oldalan van, GitHub nelkul -- `gcloud run services update-traffic --to-revisions=<regi>` --, es a
`gcloud` 2026-09-06-an ellenorizve MUKODIK (`auth print-access-token` rc=0). Eles muvelet, tehat
Isti dontese, de LETEZIK es a keret nem erinti.

**A MARVEEN REPOK PUBLIKUSAK, ott az Actions INGYENES.** A `synchronize`-csapda ott is tuzel, de
nem kerul penzbe. Ez a szakasz KIZAROLAG a Delta-CRM-re szol.

## MI INDÍT ACTIONS-FUTÁST EBBEN A REPÓBAN -- AZ ÁG NEVE NEM A VÁLASZ (mérve 2026-08-28 20:19)

**Ez a szakasz azért létezik, mert a marveen lapján áll egy HELYES mérés, ami ERRE a repóra
olvasva hamis rendszabályt ad.** Ott a `secret-gate.yml` és a `test.yml` `on:` blokkja van
megmérve, kimondottan a marveen repóra és a forkba pusholásra. **Ez a két fájl a Delta-CRM
`main`-jén NEM LÉTEZIK: itt nyolc MÁSIK workflow van.** A mérés jó, a populáció más.

**ÉS AZ ELSŐ JAVÍTÁSOM IS SZŰK VOLT: A CSAPDA A MARVEEN REPÓBAN IS ÉL** (friday mérte
2026-08-28 20:24-kor, egy órán belül a fenti sor megírása után). Ott a `secret-gate.yml` és a
`test.yml` **CSUPASZ `pull_request:`-et deklarál `types:` nélkül**, a GitHub alapértelmezése
pedig épp `[opened, synchronize, reopened]`. Vagyis nem az a különbség, hogy az egyik repóban
van `synchronize` és a másikban nincs -- **mindkettőben van, csak az egyikben KI VAN ÍRVA, a
másikban ALAPÉRTELMEZÉSBŐL jön, és így a fájlból nem olvasható ki.** A lenti szabály tehát nem
Delta-CRM-specifikus: a push előtti PR-ellenőrzés MINDKÉT repóban kell.

    ci.yml       push: [main, develop] + pull_request: [main, develop]
    pr-check.yml pull_request: [opened, synchronize, reopened]      <- EZ A CSAPDA
    deploy.yml   workflow_run (CI után, main) + workflow_dispatch
    migrate.yml / rollback.yml / maintenance.yml / mobile-eas-*     workflow_dispatch (kézi)

**A `synchronize` MINDEN pusholásra tüzel egy olyan ágra, AMIRE NYITOTT PR VAN -- az ág nevétől
teljesen függetlenül.** Három job indul (`pr-size-check`, `conventional-commits`,
`prisma-migration-check`), mind `ubuntu-latest`, tehát valódi percek.

**ÉS A SZÁM NAGYSÁGRENDDEL NAGYOBB, MINT AMIT ELŐSZÖR ÍRTAM IDE** (jarvis mérte 2026-08-28
20:28-kor, egy MÁR LEFUTOTT futás számlázott job-perceiből -- nem indított újat). A csapda nem
csak a `pr-check.yml` három jobja: **mind a négy nyitott PR a `main`-re megy, tehát a `ci.yml`
`pull_request: [main, develop]` szűrője IS illeszkedik rájuk.**

    Backend Unit 35,8 | Frontend Unit 12,0 | Backend E2E 9,9 | Type Check 2,1
    Mobile 2,2 | Lint 1,9 + 0,9 | Security 1,5 | Setup 1,5
    ÖSSZESEN 69,5 SZÁMLÁZOTT PERC futásonként, PLUSZ a pr-check három jobja

**ÉS 2026-09-04-EN ÚJRAMÉRVE 103 PERC, ÉS A MERGE NEM AZ, AMI FIZET** (marveen mérte; a 69,5 nem
volt hibás, MÁS módszerrel készült -- ez a szám a job `started_at`/`completed_at` különbségéből
jön, jobonként FELFELÉ kerekítve, ahogy a GitHub számláz):

    09-04 köteg (6 ág) ....... 15 job, 103 perc
    09-03 EGYETLEN fix ....... 15 job, 103 perc
    08-21 PR #124 (150 commit) 15 job,  82 perc

**A költség FUTÁSONKÉNT állandó, nem ág- vagy commit-arányos.** Egy egysoros javítás annyiba
kerül, mint egy hatágas köteg.

**A `/timing` VÉGPONTOT NE HASZNÁLD:** mind a négy megkérdezett futásra `total_ms: 0`-t adott
`jobs: 15` mellett -- két állítás, ami nem lehet egyszerre igaz. A nyers válasz megnézése fogta
meg; a kiszedett mező elhitte volna. A job-időbélyegek a mérőeszköz.

**ÉS A BONTÁS MEGFORDÍTJA A KÉZENFEKVŐ TANÁCSOT** (szeptember 1-4, 72 futás megmérve, 0 nem
elérhető):

    egyéb ág / PR (pull_request) .... 12 futás   981 perc   60%
    dependabot (pull_request) ....... 12 futás   372 perc   23%
    main-push (push) ................  3 futás   273 perc   17%
    minden workflow ................. 72 futás  1776 perc

**A merge a számla 17%-a.** A 981-ből pedig 845 perc HÁROM `integration/*` ágról jön, vagyis
magából a KÖTEGELÉSBŐL: nyitunk egy PR-t a köteg-ágra, és minden további push újra elsüti a
teljes ~100 perces CI-t. A `2026-09-02-specs` NÉGY futást fizetett EGY kötegért.

**A gyakorlati szabály tehát NEM az, hogy „várjunk, gyűljön a munka":** a várakozás akkor spórol,
ha közben NEM nyúlunk a köteghez. Ha a köteg-PR nyitva áll és nő, a várakozás TÖBBE kerül.
A köteg helyben álljon össze, és EGY push menjen a végén.

*(~~A maradék keret innen NEM mérhető~~ -- **DE IGEN, 2026-09-06 óta: lásd a keret-szakaszt
feljebb, `settings/billing/usage?year=&month=`, egy hívás.** A 3000 perc a privát-repó keret
FELTÉTELEZÉSE; az 1776 elhasznált perc MÉRT.)*

Vagyis egyetlen push a `test/846305c8-cache-reachable` vagy a `chore/2a331322-main-push-full-ci`
ágra **nagyjából hetven percbe kerül**, nem néhányba. Ugyanaz az irány, egy nagyságrenddel
élesebben -- és pont azokon az ágakon, amiket a névminta biztonságosnak mondott.

Vagyis a „feature-ágra pusholni ingyenes" szabály itt **pontosan a betartásával termeli a hibát**:
2026-08-28-án négy nyitott PR közül kettő épp a „biztonságos" névmintát viselte
(`test/846305c8-cache-reachable` #125, `chore/2a331322-main-push-full-ci` #121). Aki a szabályt
követve rájuk pushol, számlát csinál -- és semmi nem jelez.

**A PUSH ELŐTTI ELLENŐRZÉS, EGY SOR:**

```bash
gh pr list --state open --head <ág>     # ÜRES kimenet = ingyenes; bármely sor = tüzelni fog
```

**A `gh` OLVASÁSOK NEM ÉGETNEK PERCET, és ez mérve van, nem a dokumentációból jön:** a perc
RUNNER-IDŐ, egy API-olvasás nem job. A kontroll: `gh run list` -> a legutolsó futás
`2026-08-27T07:30:04Z`, miközben aznap többen olvastak `gh run view`-val. Ha az olvasás indítana
bármit, lenne mai dátumú futás.

**ÉS AMIÉRT ÉPP EZ A REPÓ: A `balintisti/Delta-CRM` PRIVÁT** (`gh repo view --json isPrivate`
-> `true`, mérve 2026-08-28). A GitHub Actions publikus repóban, standard runneren INGYENES; a
3000 perc privát-repó keret. A marveen repók publikusak, tehát ott ugyanez a `synchronize`-csapda
TÜZEL, de nem kerül pénzbe. **A „ne pusholj" szabály ezért ERRE a repóra szól** -- a mechanizmus
közös, a számla nem.

**~~AMI NEM MÉRHETŐ INNEN: a maradék keret.~~ EZ 2026-09-06 ÓTA MÉRHETŐ, ÉS EGY HÍVÁS.**
A régi `/users/<user>/settings/billing/actions` végpont **410 MOVED**-ot ad (nem 404-et), és a
törzse megnevezi az utódot: `settings/billing/usage?year=&month=`. A `user` scope megvan.
Mérve 2026-09-06: 2912,0 / 3000 Actions Linux perc, 0,006 USD/perc a saját számlánkról.
A teljes mérés és a kontrollja a keret-szakaszban áll, feljebb.

**ÉS EGY KÖVETKEZMÉNY, AMI CSAK NULLA KERETNÉL LÁTSZIK: a VISSZAGÖRGETÉS IS ACTIONS.** A
`deploy.yml`, a `rollback.yml` és a `migrate.yml` mind Actions job. Ha a keret elfogy, nem csak
szállítani nem lehet: **visszagörgetni sem, a dokumentált úton.** A vész-kijárat a Cloud Run
oldalán van, GitHub nélkül (mérve 2026-08-28: `gcloud` hitelesítve, `gcloud run revisions list`
látja az élő korábbi revíziókat), és `gcloud run services update-traffic --to-revisions=<régi>`
alakú. Ez éles művelet, tehát Isti döntése -- de LÉTEZIK, és a keret nem érinti.

*(didi találta meg, hogy a szabály eddig csak egy üzenetben élt: a marveen lapján a szakasz CÍME
általános („CI-percek: mérd, ne feltételezd"), a tartalma repó-hatókörű, és az újramérési
feltételei közt a „másik repó" nem szerepelt. Egy helyesen hatókörözött mérés általános címmel
pontosan így válik hamis szabállyá -- és a javítása nem a mérés, hanem a TESTVÉR-BEJEGYZÉS a
másik repó lapján. Ez az.)*

## EGY AHEAD/BEHIND SZÁM A REFJE NÉLKÜL NEM GYENGE MÉRÉS, HANEM NEM MÉRÉS (mérve 2026-08-28)

**A szó `main` KÉTÉRTELMŰ ebben a checkoutban, és ma két ügynök mért vele ugyanabban a percben,
ellentétes eredménnyel.** Egyik sem tévedett; egyik sem mondta meg, mihez képest mért.

    origin/main  69fd89c5  (2026-08-21)   <- a TÁVOLI, ls-remote-tal ellenőrizve, nem a cache-ből
    helyi main   3096fd2a  (2026-08-25)   <- 254 committal előrébb, 0-val hátrébb

Ugyanarra az ágra (`integration/2026-08-27-batch`): a helyi mainhez képest **0 behind / 60 ahead**,
az `origin/main`-hez képest **0 behind / 314 ahead**. Az egyik mérésből didi „166 behind"-ot olvasott
ki egy MÁSIK ágon, és az elavult ágnak látszik -- miközben a távolihoz képest szigorúan előrébb van.

**A KÖVETELMÉNY NEM AZ EXPLICITSÉG, HANEM AZ EGYÉRTELMŰSÉG.** A marveen lapja ezt eddig úgy mondta
ki, hogy „mérj EXPLICIT refhez, ne `@{upstream}`-hez" -- az egy IMPLICIT ref ellen véd. Ma mindketten
EXPLICIT refet használtak: a `main` szót. Csak épp arra a szóra `refs/heads/main` és
`refs/remotes/origin/main` is hallgat.

```bash
# EGYÉRTELMŰ, mindkét oldalon kiírva:
git rev-list --count <ág> ^origin/main      # a TÁVOLI mainhez
git rev-list --count <ág> ^main             # a HELYI mainhez
git rev-parse main origin/main              # és ha a kettő eltér, a szám ONNAN jön
```

**Miért ez a rosszabbik fajta:** egy elgépelt ref HIBÁT ad. Itt mindkét olvasat ÉRTELMES MONDATOT
ad, és a kettő ellentétes irányba mutat. Semmi nem jelez.

**ÉS A MÁSIK KÉRDÉS, AMIT AZ AHEAD/BEHIND SZERKEZETILEG NEM TUD MEGVÁLASZOLNI: hol létezik a munka.**
A „nincs az `origin/main`-en" és a „nincs a távolin" két külön állítás. Ma az elsőből majdnem a
második lett egy jelentésben (*„öt nap összefésült munka, ami soha nem ért el a távolira"*), és
hamis volt: a 314 commitból **nulla** létezik csak helyben.

```bash
# mi létezik KIZÁRÓLAG itt:
git rev-list <csúcs> --not $(git for-each-ref --format='%(refname)' refs/remotes/origin/)
```

Mérve: a köteg csúcsa a távolin `refs/heads/integration/2026-08-27-batch` ÉS `refs/pull/128/head`
alatt is ott van, a merge előtti main-csúcs pedig `refs/heads/backup/main-2026-08-27` alatt. Vagyis
nem elakadt munka, hanem egy szándékosan nyitva tartott PR -- a `refs/heads/main` lemaradása a
SZÁNDÉK.

**A gyakorlati szabály:** aki ahead/behind számot ír le kártyára, üzenetbe vagy jelentésbe, írja
mellé a refet teljes alakban (`origin/main`, nem `main`), és a parancsot. Ha a szám arról szól, hogy
valami HIÁNYZIK, akkor a fenti `--not` alak a mérés, nem az ahead/behind.

**ÉS UGYANEZ A GIT-KONFIGBAN, EGY SZINTTEL LEJJEBB: AZ UPSTREAMET KÉT MEZŐ ADJA, EGYIK SEM ÖNMAGÁBAN**
(marveen tévedett rajta, jarvis mérte ki, 2026-08-28).

    branch.<ág>.merge   ->  csak a ref NEVE:  refs/heads/develop
    branch.<ág>.remote  ->  a távoli:         origin
    az upstream a KETTŐ EGYÜTT:               origin/develop

Egy `git config --get-regexp '.merge' | grep 'refs/heads/develop'` tehát **11 ágat** adott, és én
ebből azt olvastam ki, hogy tizenegy ág a HELYI `develop`-ot követi. Nem: mind a tizenegyen
`remote=origin` állt, tehát az upstreamjük az `origin/develop`, az ÉLŐ fa. **Egy döntést építettem
rá** (force-update helyi ág átnevezése helyett), és az egyetlen érv alatta hamis volt.

**A KONTROLL, ami eldönti, és egy sor:** `git rev-parse --abbrev-ref <ág>@{upstream}` -- ez a
KÉT mezőt együtt oldja fel. Ha upstreamről állítasz valamit, ezt futtasd, ne a `.merge`-öt grepeld.

*(Ugyanaz a törvény, mint a fenti szakasz `main`-je: egy ref-hivatkozás, ami RÉSZBEN van kimondva,
nem hivatkozás. Ott a ref neve volt kétértelmű, itt a mező önmagában hiányos.)*

**ÉS EGY TESZT-FÁJL SZÁMNÁL A GLOB IS A NEVEZŐ RÉSZE** (ugyanaznap, ugyanabban a mérésben). Ez a repó
KÉT teszt-konvenciót használ: a backend Jest `*.spec.ts`, a frontend Vitest `*.test.ts` /
`*.test.tsx`. Egy frontend ágon `*.spec.ts`-sel mérve a válasz **1 fájl** volt; a helyes globbal
**68**. Nem hibát ad, hanem egy hihető kis számot -- és a megnyugtató irányba. Aki teszt-fájlt
számol, mondja meg, MELYIK kiterjesztéseket számolta.

## ITT A `main` TÉNYLEG A TELEPÍTÉS FORRÁSA -- ÉS EZ A MARVEEN REPÓBAN NEM IGAZ
## (didi mérte 2026-09-03, miután ugyanazon az éjszakán a marveen lapjára az ELLENKEZŐJE került)

**Ez a bejegyzés azért van itt, mert a testvér-lapra ma éjjel egy HELYES mérés került, ami ERRE a
repóra olvasva hamis rendszabályt ad.** A marveen `CLAUDE.md`-ben most ez áll: a `develop` NEM az
igazság forrása, a build a fő checkout ágából készül, egy őr ezt aktívan védi, és egy "nincs a
törzsön" állításból NEM következik, hogy a hiba él.

**A DELTA-CRM-BEN EZ FORDÍTVA VAN, ÉS MÉRVE:**

    a futó revízió `00315-7zl` képcímkéje ... `backend:9f1be1d032d8...`
    az `origin/main` feje ................... `9f1be1d032d8...`   -- betűre ugyanaz
    `deploy.yml` ............................ `workflow_run`, a `main` CI-ja után

**Nincs olyan út, amin kód eljut egy felhasználóhoz úgy, hogy a `main` ne tudna róla.**

**DE A KÉPCÍMKE NEM MINDIG HORDOZZA A COMMITOT -- A MAI REVÍZIÓ DIGEST-TEL VAN RÖGZÍTVE** (dexter
mérte 2026-09-04, és egy kitérőbe került neki, mert a fenti sor módszerként olvasódik):

    `00315-7zl` (a fenti példa) .... a képcímke `backend:9f1be1d0...`  -> a `describe` VÁLASZOL
    `00319-8dg` (ma futó) ......... a kép DIGEST-tel van pinelve       -> a `describe` NEM válaszol
                                    (a `labels` és az `annotations` is ÜRES erre)

**Amikor a kép digesttel van pinelve, a commit SEHOL nincs a Cloud Run leírásában.** Ami válaszol,
az az Artifact Registry:

```bash
gcloud artifacts docker images list <repo>/backend --include-tags \
  --filter='version:sha256:<digest>' --format='value(tags, createTime)'
```

Mérve: `sha256:ae83d599...` -> tag `89d93f0401187792f55d84f9701c63ad54516bd3`, és a
`git rev-parse origin/main` BETŰRE ugyanaz.

**AMI ENÉLKÜL MARAD, ÉS AMIÉRT VESZÉLYES: a revízió `creationTimestamp`-je.** Az csak ALSÓ KORLÁT
(„a merge ÓTA épült"), és nagyon könnyű belőle azt olvasni, hogy „tehát tartalmazza a javítást".
**Nem mondja meg, MELYIK main-commitból épült.**

*(A háromrétegű ellenőrzés tehát: MERGED -- `is-ancestor` az `origin/main`-re, kontrollal a
határ alatti commitra; BUILT -- a digest feloldása tagra a registryben; RUNNING -- `is-ancestor` a
futó revízió commitjára, kontrollal egy MOST pusholt commitra, ami NEM lehet benne.)*

**ÉS A `RUNNING` RÉTEG KÉT KÜLÖNBÖZŐ MEZŐBŐL OLVASHATÓ, AMIKBŐL AZ EGYIK NEM A FUTÓ KÓDRÓL SZÓL**
(friday mérte és javította magán 2026-09-05, marveen ellentmondásából; MINDKETTEN helyesen mértünk,
csak MÁS OBJEKTUMOT).

    a SZOLGÁLTATÁS-SABLON  `run services describe <svc> ... spec.template...image`
                           -> `backend:33f710d6...`            **CÍMKÉVEL** pinelve
    a KISZOLGÁLÓ REVÍZIÓ   `run revisions describe <rev> ... spec.containers[0].image`
                           -> `backend@sha256:2f7488a4...`     **DIGESTTEL** pinelve
    a revízió `labels` + `annotations`, ami commitot hordozna: **EGYIK SEM** (mérve)

**A SABLON AZT MONDJA MEG, MIT HASZNÁLNA A KÖVETKEZŐ REVÍZIÓ. A REVÍZIÓ AZT, AMI MOST KISZOLGÁL.**
Amíg a kettő egyezik, mindkettő ugyanazt a választ adja -- és amikor eltérnek, a SABLON a frissebb
SZÁNDÉK, tehát a hibás válasz a MEGNYUGTATÓ irányba érkezik.

**MÉRT ESET, ÉS A VERDIKT VÉLETLENÜL LETT HELYES:** friday a `RUNNING` réteg commitját a SABLON
címkéjéből vette. Vagyis a 3. rétege a SABLONT igazolta, nem a futó revíziót -- és a válasz csak
azért jött ki jól, mert a digest történetesen ugyanarra a commitra oldódik fel. Ezen a kérdésen
AZ ÚT MAGA A TERMÉK: a „mi fut most" kérdésre egy sablon-alapú válasz nem válasz, akkor sem, ha
ma egyezik.

**A SZABÁLY: a `RUNNING` réteghez MINDIG a REVÍZIÓT olvasd, SOHA a szolgáltatás-sablont** -- és ha
a revízió digesttel van pinelve, a commit KIZÁRÓLAG az Artifact Registry feloldásából jön, mert a
`describe` néma rá, a `labels` és az `annotations` is.

```bash
REV=$(gcloud run services describe <svc> --region=<r> --format='value(status.traffic[0].revisionName)')
IMG=$(gcloud run revisions describe "$REV" --region=<r> --format='value(spec.containers[0].image)')
case "$IMG" in *@sha256:*) echo "DIGEST -- a registryben kell feloldani";; *:*) echo "CIMKE";; esac
# es a feloldas KONTROLLJA: egy csupa-nulla digestre URES valasz -> a szuro diszkriminal
```

*(A legélesebb rész friday saját mondata: a kártyán ott állt, hogy „nézd meg, HOGYAN van pinelve a
kép, mielőtt eldöntöd, melyik út kell" -- és ő ezt FELTÉTELEZTE, a rossz objektumról. **A szabály
ismerete nem védett meg; a helyes mező elolvasása védett volna meg.** Ugyanaz az alak, mint egy
órával korábban az `rc=128`-as álkontrollnál: ott is a saját szabálya volt kéznél, és nem az
alkalmazása.)*

    Delta-CRM   "nincs a `main`-en"    ->  SZÁLLÍTÁSI RÉS. Mérd, listázd, tedd kötegbe.
    marveen     "nincs a törzsön"      ->  ÖNMAGÁBAN NEM LELET. Előbb kérdezd meg, hogy a FUTÓ
                                           fán rajta van-e (`build.status` + `builtCommit`).

**EGY SZÁM, AMI KÖNNYEN UTAZNA ROSSZUL:** 369 megvizsgált `origin` ágból **151** hordoz olyan
commitot, ami nincs a `main`-en (kontroll: `origin/main ^origin/main` = 0). **Ez NEM 151
kiszállítatlan kész munka** -- benne van minden elhagyott, felülírt és kísérleti ág. A `1fde3aed`
kártya 40-es száma SZŰRT halmaz (kártyához kötött, `done`-ra jelölt ágak); a 151 csak azt mondja
meg, mekkora volt a merítés. **Ezt a számot ne add tovább csupaszon.**

**AMI MÉRETLEN:** hogy futott-e valaha kézi `workflow_dispatch` deploy NEM-`main` ágról. Ha igen, a
"csak a `main`-en át" állítás a TÖRTÉNETRE nem szigorú -- a MAI revízióra igazolva van, a múltra nem.

## A `commit^` A FEATURE ÁGON VAN -- EZÉRT A „CÉL TÖRÖLTE" ÉS A „SOHA NEM ÉRT ODA" EGY MÉRŐVEL
## NEM KÜLÖNBÖZTETHETŐ MEG (jarvis mérte és VONTA VISSZA, 2026-08-28)

Egy be nem olvasztott commitról azt akartuk eldönteni, hogy a benne módosított spec-fájlt a
merge-köteg **törölte-e**. A mérés így nézett ki, és ésszerűnek látszik:

    a fájl LÉTEZIK a `commit^`-nál   ÉS   NINCS a kötegen   ->  „a köteg törölte"

**Hamis.** A `commit^` a FEATURE ÁGON van. Ha a fájlt egy KORÁBBI commit hozta létre UGYANAZON az
ágon, akkor a szülőnél természetesen ott van, a kötegen pedig soha nem is volt. A két eset ehhez a
mérőhöz **bájt-azonos** -- és az egyikből „lefedettség-vesztés" következik, a másikból „még nem
érkezett meg", ami ellentétes teendő.

Mérve, hét fájlon: mind a hét SOHA nem létezett a kötegen.

```bash
# A HELYES KÉRDÉS: szerepel-e az útvonal a CÉL történetében?
git log <cél-ág> -- <útvonal> | head -1      # üres = soha nem volt ott
# KONTROLL, ugyanazzal a mérővel, egy biztosan létező fájlra:
git log <cél-ág> -- src/hooks/useAuth.tsx | wc -l    # 28 -> a mérő lát történetet
```

**ÉS AMI EBBŐL KIJÖTT, ÉS TÖBBET ÉR A HIBÁNÁL: A KIMARADT COMMITOK NEM FÜGGETLENEK.** Mind a hét
specet EGY MÁSIK kimaradt commit hozta létre. Egy konkrét pár: a `442fdfb2` tíz komponense
importálja a `@/lib/clipboard`-ot, amit az `aa4156a2` hoz létre -- és mindkettő a kimaradtak közt
van. **A `442fdfb2` önmagában beolvasztva NEM FORDULNA LE.**

    `git merge-tree --write-tree` azt kérdezi: EZ AZ EGY commit ráalkalmazható-e a célra?
    Arról, hogy KÉT commit VISZONYBAN áll-e, nincs kérdése -- tehát szerkezetileg nem látja.

Két commit, ami külön-külön „tisztán alkalmazható", együtt is jó; de az egyik ÖNMAGÁBAN törött fát
adhat. A hiány nem a mérésben volt, hanem a KÉRDÉSBEN.

**A gyakorlati szabály:** ha commitokat egyenként válogatsz egy célra (cherry-pick, részleges
merge, review-alapú elfogadás), a „tisztán alkalmazható" NEM jelenti azt, hogy „önmagában fordul".
A függőségi éleket külön kell mérni: **melyik commit hoz létre olyan fájlt vagy szimbólumot, amire
egy másik hivatkozik.** És a legélesebb következmény nem a sorrend, hanem az elutasítás: **egy
ELUTASÍTOTT commit el tudja törni egy ELFOGADOTTAT**, és a törés fordítási hibaként jelenik meg a
célon, a következő pushnál -- nem a review alatt.

*(Ez a bejegyzés azért áll itt teljes egészében, mert a visszavonás a mérőé volt, nem a mérésé: a
szerző a saját, MÁR SZABÁLLYÁ VÁLT állítását mérte újra két órával később, és ő maga döntötte meg.
A koordinátor addigra KÁRTYA-CÍMBE írta -- a lista-nézetben csak a cím látszik, tehát épp az
utazott volna tovább, amit senki nem próbált ki.)*

## EGY MÉRŐ, AMI EGY SORT OLVAS EGY TÖBB SOROS SZERKEZETBŐL, NÉMÁN HAMIS NEGATÍVOT AD -- ÉS A
## RIASZTÓ IRÁNYBA (három eset, két ágens, egy este: 2026-08-28)

Ugyanaz az alak háromszor, néhány órán belül, és mindháromszor **egy védelemről állította volna,
hogy nincs**:

    mandark  a parser `signature` mezője CSAK AZ ELSŐ SORT tartalmazza -> egy tördelt
             paraméterlistából kiesik a `@GetUser()`, tehát minden tördelt handlerre azt mondta
             volna, hogy nincs self-scope. **Nem szállította: a kontroll megbukott.**
    dexter   a hívóhelyi literálokból gyűjtött (erőforrás, művelet) párokból hiányzott a
             `tasks:update`, `:complete`, `:reopen` -- mert a `tasks.service` TIPIZÁLT VÁLTOZÓVAL
             adja át a műveletet: `action: 'read'|'update'|'complete'|'reopen'|'delete'`.
             Majdnem azt írta le, hogy három OWN-jog érvényesítetlen.
    dexter   utána a helper hívóhelyeit greppelte, `'complete'` nem volt köztük -> majdnem azt
             írta le, hogy az egy-feladatos complete út szűretlen. A `markComplete` HÍVJA, csak
             a hívás TÖBBSOROS, és a `grep -A1` nem látta.

**A közös ok nem a minta pontatlansága, hanem hogy a MÉRŐ EGYSORÁS ALAKRA van kötve, a KÓD meg
nem az.** Egy tördelt paraméterlista, egy típus-unió, egy több soros hívás -- mindhárom teljesen
szokásos, és mindhárom láthatatlan egy soronkénti mérőnek.

**AZ IRÁNY MINDHÁROMSZOR AZONOS, ÉS EZ NEM VÉLETLEN:** a hiányzó találat „nincs védelem"-nek
olvasódik, sosem „van védelem"-nek.

**DE AZ IRÁNY A FELADATTÓL FÜGG, ÉS EGY KÁRTYA-ÜRÍTŐ KÖRBEN MEGFORDUL** (dexter mérte magán,
2026-08-29).

Egy `-A6` grep-ablak nem ért át egy TIZENHÉT SOROS docblockon két dekorátor között, és nullát adott
egy interceptorra, ami az `origin/main`-en ott van és helyes. Eddig a szokásos alak. **Az irány
viszont nem:**

    egy CENZUSBAN a nulla = „nincs védelem"      -> RIASZTÓ: munkát gyárt, feltűnik
    egy ÜRÍTŐ körben a nulla = „nincs megjavítva" -> „hagyd nyitva", ami ÓVATOSNAK LÁTSZIK,
                                                     és csendben megtart egy lezárható kártyát

**A „ne zárd le korán" reflex ilyenkor épp a rossz választ védi.** Egy nyitva hagyott, valójában kész
kártya nem hibának néz ki, hanem fegyelemnek.

*(Ugyanaz a mérőhiba, ellentétes költséggel. Ezért nem elég tudni, hogy a hibás mérő „a riasztó
irányba téved": meg kell kérdezni, hogy EBBEN A KÖRBEN melyik a kényelmes válasz -- mert azt nem
fogja senki megkérdőjelezni.)*

**ÉS EGY NEGYEDIK ESET MEGFORDÍTOTTA A MECHANIZMUST, MIKÖZBEN AZ IRÁNY UGYANAZ MARADT** (dexter
mérte magán, 2026-08-29 -- aznap negyedszer ugyanebbe az alakba).

Cenzus: melyik szerepkör-ellenőrzés enged be ADMIN-t, de OWNER-t nem.
`grep UserRole.ADMIN | grep -v UserRole.OWNER` -> megjelölte a `reports`-ot (6) **ÉS a
`dashboards`-ot (2)**. A dashboards helyeken viszont **a KÖVETKEZŐ SORBAN** ott az OWNER-ág:
`userRole !== UserRole.ADMIN &&` / `userRole !== UserRole.OWNER`.

    a HIÁNYZÓ találat ....... „nincs védelem"            <- amit a lap eddig rögzített
    a RÉSZLEGES találat ..... „ITT hiányzik a védelem"    <- ez az új

**A második rosszabb, és nem fokozatban:** az első nem talál meg valamit; a második **LELETET GYÁRT
EGY HELYESEN MŰKÖDŐ MODUL ELLEN**, cenzussal a háta mögött. Vagyis pontosan az a hamis kritikus
lelet, aminek az árát ez a lap már kimondja -- csak most nem a minta szűkségéből, hanem abból, hogy
a szerkezet nem fér el egy sorban.

A javítás mindkét irányban ugyanaz: **add meg a mérőnek azt az ablakot, amit a szerkezet ténylegesen
elfoglal.** ±3 soros ablakkal a valódi populáció: reports 6/6 hiányzik, dashboards 2/2 megvan,
goals 2/2 megvan.

*(És a legjobb hozadék: az a két modul, ami majdnem hamis lelet lett, EZUTÁN a KONTROLL -- ők
bizonyítják, hogy a mérő tud igent is mondani. Egy hamis pozitív, amit elkapsz és átfordítasz a
mérőd kontrolljává, többet ér, mint egy mérő, ami sosem sült el rosszul: a másodikban sem bízik
senki.)* Egy ilyen mérő tehát **hamis KRITIKUS leletet gyárt**, a
saját szerzője nevével -- és a következő kör bizalmát viszi el, amikor kiderül.

**A HELYES HORGONY: ne a HÍVÁST mérd, hanem a TÍPUST.** dexter megfogalmazása: a cenzus ne a
hívóhelyi literálra kössön, hanem a tipizált helperek MŰVELET-UNIÓJÁRA (`assertRowInScope`,
`loadBulkTasksInScope`) -- ott a lehetőségek a TÍPUSBAN állnak, nem a hívásban, és a típus egy
helyen van, nem huszonnyolcban.

**ÉS A KONTROLL AZ, AMI MEGFOGJA -- mérve, nem elvben:** dexter mindkét mérése PONTOSAN a pozitív
kontrollon bukott volna el (mindkettő „nincs érvényesítés"-t mondott olyan utakra, amik
érvényesítenek). Kontroll nélkül három hamis kritikus lelet ment volna ki. Ez az a hely, ahol a
„futtasd le a jó esetre is" kikötés nem formalitás: **ez maga a mérés fele.**

## Git Conventions

Commit messages follow conventional commits format:
- `feat:` — New features
- `fix:` — Bug fixes
- `style:` — Code formatting/refactoring
- `test:` — Test additions/fixes
- `chore:` — Maintenance

Pattern: `{type}: {concise description in English}`

### ÉS EGY KÁRTYA-AZONOSÍTÓ A COMMIT-ÜZENETBEN: A HELYE MONDJA MEG, MIT ÁLLÍT
(marveen döntése 2026-08-29, computress és jarvis mérése után)

    az ELSŐ SORBAN, zárójelben ..... `merge: fix/30e04d76-... (card 30e04d76)`   -> EZT JAVÍTJA
    a törzsben bárhol .............. „a `92e3c22f` tanulsága szerint..."          -> KONTEXTUS
    több javított kártya ........... `(cards a, b)` -- egy zárójelben, vesszővel

**A megkülönböztető a HELY, nem a szöveg.** Egy sor eleji, zárójeles alak gépileg is olvasható, és
egy ember is látja első ránézésre; egy törzsben szétszórt azonosító nem állít semmit.

**ÉS A KONVENCIÓ MÉRT HATÁRA, AMI EDDIG NEM ÁLLT ITT: A KÁRTYA-ID NEM A MUNKA EGYSÉGE**
(mandark mérte 2026-09-05, a `34e333d7` kártyán, 95 ütköző ág 10 elemű kézzel olvasott mintáján).

A fenti szabály azt mondja ki, hogy egy első sori `(card xxxx)` azt állítja: EZT JAVÍTJA. Igaz.
Amit NEM állít, és amit a kötegelésnél mindenki beleolvas:

    „a KÁRTYA benne van a kötegben"   !=   „a MUNKA benne van a kötegben"

Mérve: a tízből **ÖTBEN** ugyanaz a kártya-id KÉT OLDALON NEM ROKON munkát jelöl -- a `847569f1`
login-képernyő tesztek az ágon és dokumentum-szerkesztő + témázás a kötegben; az `e2310809` négy
audit-trail teszt kontra egy másolás-gomb javítás. Egy kártya idővel több, egymással nem rokon
szálat gyűjt be, és a jelölő mindegyikre ugyanazt mondja.

**A GYAKORLATI KÖVETKEZMÉNY: egy „ez az ág már felülírt, mert a kártyája bent van" állítás
NEM következik a jelölőből.** A naiv kártya-id-alapú felülírtság-detektor mérve **80% hamis
pozitív** (10 jelölt -> 2 valódi) -- ugyanaz a család, mint a hét 79/89/93/97%-os sorozata.

**AMI VISZONT PRECÍZ VOLT A MINTÁN (2/2): nem a kártya-id, hanem a commit TÁRGYA.** Ha a köteg
tartalmaz olyan commitot, aminek a tárgysora az adott kártya REBASE-ét vagy KÖTEGELÉSÉT nevezi meg
(`batch: fix/<id>-rebased-on-<sha>`, `batch: rebase/<id>-onto-<sha>`), akkor az az ág a rebase
ELŐTTI eredeti -- azt LEZÁRNI kell, nem újrarebase-elni.

*(A különbség nem finomság: a kártya-id azt mondja meg, melyik kártyát IDÉZI egy commit; a
rebase-tárgy azt, hogy ugyanannak a MUNKÁNAK egy másik példánya már bent van.)*

**ÉS A MÁSIK IRÁNY UGYANEBBEN A REPÓBAN: A `refs/evidence/*` A SZERVEREN VAN, ÉS MINDEN HELYI
REMOTE-TRACKING PÁSZTÁZÁS ELŐL LÁTHATATLAN** (mandark és computress mérte, marveen pusholta,
2026-09-05; kártya `b4527e65`).

Ez a repó **13 refet** tart `refs/evidence/<slug>` alatt -- valaki bizonyíték-commitokat rögzített,
hogy túléljenek egy ág-törlést vagy rebase-t.

    remote.origin.fetch ....................... `+refs/heads/*:refs/remotes/origin/*`
    evidence-ref a `refs/remotes/origin/` alatt  **0**
    a TÁVOLIN (`git ls-remote origin 'refs/evidence/*'`)  **13**   KONTROLL: old-origin -> 0

**Vagyis ott vannak, és `git branch -r`, `for-each-ref refs/remotes/`, meg minden cenzus, amit
írunk, NEM LÁTJA ŐKET.** És mivel az alapértelmezett push-refspec (`refs/heads/*` + tagek)
szerkezetileg kizárja őket, csak EXPLICIT pushsal kerülhettek fel -- tehát a névtér szándékosan
karbantartott, nem elhagyott.

    a NAIV olvasat ..... „megőrzöttnek látszik, valójában helyi"
    a MÉRT valóság ..... **„megőrzött, HELYINEK látszik"**

**A helyi jel MINDKÉT irányban félrevezet.** Aki bizonyíték-veszteséget mér, ne a
remote-tracking refekből dolgozzon: `git ls-remote origin 'refs/evidence/*'` a mérő.

**ÉS EZ A KÖZÖS CHECKOUTBAN 2026-09-05 ÓTA MÁS -- a fenti mondat ott már nem áll:** beállítottunk
egy MÁSODIK fetch-refspecet, hogy a szerver-oldali evidence-refek helyileg is enumerálhatók
legyenek, KÜLÖN névtérbe, hogy a „mi van a szerveren" és a „mi van itt" megkülönböztetés megmaradjon:

    +refs/evidence/*:refs/remotes/origin-evidence/*

    refs/remotes/origin-evidence/ .... 13   (a távolin 13)
    refs/evidence/ (helyi) ........... 13   ÉRINTETLEN
    KONTROLL refs/remotes/origin/ .... 554

**ÉS EZ EGY KICSIT RONTJA A FENTI HATÓKÖR-SZABÁLYT, kimondva:** a `refs/remotes/*` alatti nem-`origin/`
maradék ezzel 241-ről **254**-re nőtt. A helyes hatókör változatlanul `refs/remotes/origin/` -- most
eggyel több okból.

**ÉS AMIT ERRŐL A NÉVTÉRRŐL 2026-09-05-ÉN ÍRÁSBAN ÁLLÍTOTTAM, ANNAK A FELE HAMIS VOLT -- ÉS A HAMIS
FELE PONTOSAN AZ, AMIT EGY KÖVETKEZŐ CENZUS-TERVEZÉSBE IDÉZNÉNEK** (marveen állította, mandark mérte
meg és javította, marveen újramérte).

Két bizonyíték-commit elhelyezéséről döntöttem, és az indokba ezt írtam: a `refs/evidence/*`
*„láthatatlan azoknak a cenzusoknak KONSTRUKCIÓBÓL"* -- és megneveztem a `git branch -r`-t ÉS a
`refs/remotes/origin/`-t. **A kettő nem ugyanaz, és a `git branch -r` LÁTJA őket:**

    git branch -r ....................................  828  ebből origin-evidence/: **15**  <- LÁTJA
    for-each-ref refs/remotes/         (ELŐTAG) ......  828
    for-each-ref refs/remotes/origin/  (ELŐTAG) ......  566  ebből evidence: **0**  <- vak, szándék szerint

**A `git branch -r` MINDENT felsorol a `refs/remotes/` alatt, nem csak az `origin/`-t.** Tehát egy
`git branch -r`-re írt cenzus a bizonyíték-refeket PONTOSAN ÚGY felszívja, mint a 241 `dexterwt/`
árvát -- ez ennek a lapnak a saját nevező-szabálya, most magára a bizonyíték-névtérre alkalmazva.

**A DÖNTÉS ÁLL, de a SZŰKEBB indokkal: láthatatlan egy HELYESEN HATÓKÖRÖZÖTT cenzusnak, nem minden
listázó parancsnak.** A különbség azért nem szőrszálhasogatás, mert a „konstrukcióból láthatatlan"
az a fajta mondat, amit valaki egy jövőbeli cenzus tervezésekor idéz -- és akkor a cenzusa
tartalmazni fogja azt, amiről a mondat azt ígérte, hogy nem fogja.

**ÉS A MÉRŐHIBA, AMI EZT MAJDNEM HAMISAN IGAZOLTA -- mandark saját, ugyanabban a lépésben:**

    for-each-ref 'refs/remotes/*'   (GLOB)  ->  **0**     <- a glob EGY útvonal-szintre illeszt,
    for-each-ref  refs/remotes/     (ELŐTAG) -> 828          a refjeink pedig BEÁGYAZOTTAK

A `0` úgy olvasódott volna, hogy „láthatatlan", vagyis **MEGERŐSÍTETTE volna a hamis állításomat.**
Ami elkapta: a `git branch -r` 828-cal EGYEZŐ előtag-alak -- két független mérő, azonos szám.
*(A `git branch -r` és a `for-each-ref` EGYEZÉSE itt kontroll; a glob-alak nullája az egyetlen, ami
kilóg. Ha csak a globot futtatod, a nulla nem lóg ki semmiből.)*

*(A mai eset a mérés-időzítés miatt is tanulságos: mandark 16:44-kor 0-t mért három próbával és
működő hálózati kontrollal -- helyesen; marveen 16:46-kor kitolta mind a 13-at; computress 16:50-kor
13-at mért. Egyik mérés sem volt hibás, és computress helyesen NEM választott a két magyarázat
között, hanem kimondta, hogy nem tudja datálni. Az egyetlen dolog, ami eldöntötte: a PUSHOLÓ
kimondta, hogy ő volt.)*

**EGY ÁG-CENZUS NEVEZŐJE: `refs/remotes/origin/`, NEM `refs/remotes/` -- ITT 44% A KÜLÖNBSÉG**
(mandark mérte 2026-09-05).

Ez a checkout **241 ÁRVA remote-tracking refet** hordoz `dexterwt/` alatt, és **olyan távoli
NINCS konfigurálva**:

    git config --get remote.dexterwt.url   ->  semmi
    refs/remotes összesen 801  |  origin/ 554  |  **dexterwt/ 241**  |  old-origin/ 6

**A `git fetch --prune` SOHA nem fogja eltakarítani őket**, mert nincs mihez viszonyítania. Tehát
egy `refs/remotes/*`-ra írt cenzus mind a 241-et FELSZÍVJA úgy, mintha ágak lennének: **44%-os
felfújás, minden bejegyzés hihető ágnév, és a kimeneten semmi nem néz ki rosszul.**

**ÉS AMIÉRT A MÉRÉS, AMI TÚLÉLTE, TÚLÉLTE -- a szerző saját megfogalmazása, és ez a hordozható
rész:** *„azért, mert a szűrő LE VOLT ÍRVA, nem azért, mert jól választottam. A `refs/remotes/*`
ugyanolyan természetes lett volna begépelni."*

**DE A SZABÁLY NEM ÁLTALÁNOS, ÉS A SZERZŐJE SZŰKÍTETTE: ATTÓL FÜGG, MIT SZÁMOLSZ**
(mandark, computress mérése után, ugyanaznap):

    REFEKET számolsz (ág-cenzus) ....... a HATÓKÖR teherhordó. 241 többlet-ref, és NINCS az a
                                         dedup, ami segítene -- mind különböző ref, különböző név.
    TARTALMAT számolsz (fájl-verziók) .. a DEDUP a teherhordó. computress BLOBOKAT vetett össze,
                                         és a bájt-azonos `dexterwt` másolat a dedupon összeesett
                                         -> a rossz hatókör csak FÖLÖSLEGES MUNKÁBA került,
                                         nem rossz válaszba.

Vagyis ugyanaz a hiba az egyik mérésben HAMIS SZÁMOT ad, a másikban csak lassabb. A megkülönböztető
nem a parancs, hanem hogy a kérdésed EGYEDI OBJEKTUMOKRA vagy EGYEDI TARTALMAKRA vonatkozik.

*(Ugyanaz a törvény, mint a `sajat-crm/` pathspec-duplázásnál: nem a mérő pontatlan, hanem a
NEVEZŐ tartalmaz olyat, amiről a kérdés nem szólt. És ugyanaz az orvosság: a szűrőt FUTÁS KÖZBEN
írd le, mert utólag csak azt tudod rekonstruálni, amit megtaláltál.)*

**ÉS UGYANEZ EGY ÓRÁVAL KÉSŐBB A MÉRŐJÉN CSATTANT, EGY MÁSODIK TENGELYEN: HÉT ÁG VISELI AZ
`e5f46eb1` NEVET AZ `origin` ALATT (KILENC minden távolin együtt).** Két ágens ugyanarról az azonosítóról mért, ELLENTÉTES eredménnyel -- és
egyiküknek sem volt hibás a mérője:

    mandark:    201 x `@IsSanitized()` TÖRÖLVE, 59 fájlban (`fix/e5f46eb1-drop-input-sanitizer`)
    computress: **0** törölt sor a sanitizer-mintára -- KONTROLLAL (24 találat a bázison,
                19 magában a diffben) -- egy MÁSIK e5f46eb1 ágon, ami a `copyToClipboard`-ot
                mozgatja a `lib/clipboard.ts`-be

**A két halmaznak NINCS közös fájlja.** A kártya-id ugyanaz, a munka nem.

**ÉS A KÉT SZÁM KIBÉKÍTÉSE ROSSZABB VOLT, MINT A TÉVEDÉS: EGY GYÁRTOTT EGYETÉRTÉS ELTÜNTET EGY
JELET** (computress vonta vissza magát, 2026-09-05, néhány perccel azután, hogy leírta).

Két ágens két számot mondott ugyanarra (7 és 8). computress talált egy POPULÁCIÓT, amitől
mindkettő igaz lett (`refs/evidence/` névtér, 13 ref), leírta, hogy „mindkettőtöknek igaza van",
és megállt. **A 8 nem abból jött: egyszerű elszámolás volt egy kilenc soros listán.**

    a tévedés ........ egy rossz szám, amit valaki megmér és javít
    a GYÁRTOTT EGYETÉRTÉS ... **eltünteti a NÉZETELTÉRÉST**, ami épp a hibát fogta volna meg

**És a nézeteltérés ma bizonyítottan mérőeszköz volt:** ugyanaznap egy `merge-tree` parser-hibát --
ami minden 1-fájlos ütközést 3-nak olvasott, és a „1-2 fájl" rekeszt 58-ról 0-ra vitte -- NEM egy
kontroll fogta meg, hanem hogy a szám ELLENTMONDOTT valaki máséval. Kontroll nélkül a 25/70
tökéletesen hihető lett volna.

**A gyakorlati szabály: ha két mérés eltér, a nézeteltérés MARADJON NYITVA, amíg valaki meg nem
méri, MELYIK populáció.** Egy magyarázat, ami mindkét számot igazzá teszi, nem feloldás -- addig
hipotézis, amíg a másik fél meg nem erősíti, hogy TÉNYLEG azt mérte.

*(A saját szava a legpontosabb: „kerestem egy populációt, amitől mindkét szám igaz, találtam
egyet, és megálltam." Ez a lap „a tetszetős magyarázat leállítja a keresést" alakja -- csak most
nem egy MECHANIZMUSRA, hanem egy KIBÉKÍTÉSRE alkalmazva, és a kára nagyobb, mert a hiba nem
marad látható.)*

*(A „nyolc" szám mindkét irányban rossz volt, és a szerzője javította: `origin` alatt **7**,
minden távolin együtt **9** -- egy kilenc soros listát számolt el. A `201` kontra `202` sem
vita volt: 202 SOR tartalmazza a dekorátort, 201 a DEKORÁTOR-HELY, a különbség egy docblock-sor.
Mértékegység-eltérés, nem szám-eltérés.)*

**ÉS A LEGROSSZABB VÁLTOZATA: AMIKOR A SZÁMOK EGYEZNEK, ÉS ÉPP EZÉRT NEM NÉZI MEG SENKI A
MÉRTÉKEGYSÉGET** (mandark mérte magán 2026-09-05, marveen újramérte; HÁRMAN reprodukáltuk
függetlenül ugyanazt a számot).

Egy kártya CÍME azt mondta: **„33 magas entrópiájú titok-ÉRTÉK"**. Megmérve, ugyanazon a fájlon:

    SOR, ami >=1 eros parat hordoz .......... **33**   <- ez volt a szam
    ERTEKADAS azokon a sorokon .............. 66
    EGYEDI nagy-entropiaju ERTEK ............ **5**    (hosszak: 38, 64, 119, 128, 128)

**A cím tehát ~6,6-szoros túlállítás volt, a RIASZTÓ irányba** -- és épp az a mondat, amit
idézni szoktak.

**ÉS AMIÉRT EZ ÚJ ALAK A FENTI 201/202 MELLETT:** ott a két szám KÜLÖNBÖZÖTT, tehát valaki
utánanézett. **Itt mind a hárman UGYANAZT a 33-at kaptuk, egymástól függetlenül -- és egyikünk sem
mondta meg, MIT SZÁMOL.**

    a FÜGGETLEN reprodukció igazolta a SZÁMOT
    és semmit nem mondott a MÉRTÉKEGYSÉGRŐL
    mert mindhárman ugyanazért a kézenfekvő mérőért nyúltunk (soronkénti regex),
    és ugyanazt a KI NEM MONDOTT egységet örököltük

**Az egyetértés itt közös vakfolt volt, nem bizonyíték.** Ez a lap „gyártott egyetértés"
bejegyzésének a tükörképe: ott egy MAGYARÁZAT tüntetett el egy nézeteltérést; itt a nézeteltérés
LÉTRE SEM JÖTT, mert a mérő közös volt.

**A gyakorlati próba, és a szám leírásakor kell feltenni:** *ha valaki más ugyanezt a számot kapja,
abból következik-e, hogy ugyanazt MÉRTE?* Ha a mérő kézenfekvő és mindenki ahhoz nyúl, a válasz
NEM -- és akkor az egyezés nem erősíti a számot.

*(A mechanizmus a mérőben: a naiv `(\w+)=(\S+)` a `--set-env-vars K1=V1,K2=V2` alakon ÁTSZALAD a
vesszőn. Mérve: a naiv alak EGYETLEN „értéket" ad, 207 karakterrel, és abban benne van egy vessző
ÉS egy további `=`. A helyes alak vesszővel is határol: `([^,\s"']+)`.)*

**ÉS A DRÁGÁBB FELE EGY MÁSIK MONDAT, ami ebből született (mandark fogalmazta meg, a saját
visszavonásában):**

> **Egy commit TÁRGYSORA megmondja, mit CSINÁL a commit. Azt NEM mondja meg, mitől FÜGG.**

Egy sorrend-kényszert vezetett le két tárgysorból -- az ágnév (`drop-input-sanitizer`) és a
köteg tesztjének a tárgya (`nothing reaches dangerouslySetInnerHTML unsanitised`) összeállt egy
KOHERENS TÖRTÉNETTÉ, aminek a fele igaz volt. A FÜGGŐSÉGET csak a két oldal TARTALMÁNAK
összevetése dönti el, és az sosem futott le.

**Megmérve a történet megdőlt:** a `dangerouslySetInnerHTML`-t hordozó 9 frontend fájl MÁR A
MERGE-BÁZISON (`3096fd2a`) átmegy a `sanitizeHtml`-en, 9/9, a köteg ELŐTT -- és a köteg
`dangerous-html.guard.test.ts`-e REGRESSZIÓS TESZT, nem futásidejű védelem. Tehát nincs sorrend.

*(A gyakorlati alak: egy sorrend-kényszer akkor állítás, ha valaki a KÉT OLDAL TARTALMÁT
összevetette. Amíg csak tárgysorokat olvastunk, az egy hipotézis -- és a koherens történet épp
attól veszélyes, hogy nem érződik annak.)*

**MIÉRT KELL:** computress megmérte, mi történik enélkül -- 14 `planned` kártyájából 4-re volt
commit, ami NEVEZI őket, és **mind a négyet elolvasva NULLA volt kész**. A commitok a kártyát
kontextusként vagy részesetként említették. **Egy kártya-id egy commit-üzenetben nem azt jelenti,
hogy a commit elvégezte a kártyát** -- és a konvenció nélkül ezt csak elolvasással lehet eldönteni,
kártyánként.

*(A meglévő 300 commitot nem írjuk át: arra jarvis SHA-szűrője való, ami a rövid hasheket kiszűri
a kártya-azonosítók közül -- 34/34 SHA kiesik, a kártya-id-k bent maradnak, kontrollal igazolva.
A konvenció a JÖVŐRE szól.)*

**ÉS AMIÉRT MEGÉRI BETARTANI, MÉRVE: EGY `(card xxxx)`-ET VISELŐ ÁG GÉPILEG AUDITÁLHATÓ EGY
KÖTEG ELŐTT -- AMELYIK NEM, AZT KÉZZEL KELL ÁTNÉZNI, MINDEN ALKALOMMAL**
(friday mérte 2026-09-03-án, didi leletéből: egy ág HÁROM kártya munkáját szállította, és a
kártya erről nem szólt.)

A kérdés a köteg-összeállításnál: **ez az ág CSAK annak a kártyának a munkáját viszi, amiről
elnevezték?** A hordozó nem a szállítmány -- egy ágnév egy kártya-id-vel csak annyit állít,
hogy annak a nevére hozták létre.

```
SZŰK mérő (a fenti konvenció: ELSŐ SOR + zárójeles (card xxxx))
  a `fix/011bbc1b-protected-field-ui` 7 commitján ->  011bbc1b  3d3ea10d  7ccd1e20
  PONTOSAN a három, amit egy kézi átolvasás is ad; negyediket NEM talál ki

LAZA mérő (bármely 8-hex a commit-üzenetben, ami nem oldódik fel commitként)
  ugyanott -> + egy negyedik, ami KONTEXTUS-hivatkozás a törzsben
  és kilenc köteg-jelöltből HATOT jelölt meg többkártyásként -- mind hamis
```

**A szűk mérő azért állítás, mert egy ISMERT válaszú esethez mérték.** A laza azért nem, mert a
törzsbeli hivatkozást szállításnak olvassa -- épp az a különbségtétel, amit ez a szakasz kimond.

**A KORLÁT, ÉS EZ AZ ÉRV MAGA:** a mérő csak ott tud válaszolni, ahol a konvenciót betartották.
A kilenc jelöltből **négyen** volt első-sori `(card xxxx)`; a maradék **öt** ágon a mérő NÉMA --
ott az egyetlen eszköz a commit-címek kézi elolvasása volt (mind az öt egy témájú lett, de ezt
csak olvasással lehetett megállapítani).

```bash
# a köteg-összeállító ellenőrzése, ágonként:
git log --format='%s' origin/main..<ág> | grep -oiE '\((card|kartya)s? [0-9a-f]{8}[^)]*\)'
# EGYNÉL több különböző kártya-id  ->  az ág több kártyát szállít, a kártya erről nem szól
# NULLA találat                    ->  a mérő NEM tud válaszolni; olvasd el a commit-címeket
# EGYETLEN kártya-id               ->  **NEM bizonyítja, hogy egykártyás az ág.** Lásd alább.
#
# A MINTA 2026-09-04-EN JAVÍTVA -- ÉS A HIBA NEM A MINTÁBAN VOLT, HANEM ABBAN, MIRE HASZNÁLTAM
# (computress megfogalmazása, és élesebb, mint az enyém volt): a régi minta a SAJÁT kérdésére
# HELYESEN válaszol. „Egynél több különböző kártya-id?" -- arra a szigorú és a tág alak PONTOSAN
# ugyanazt adja (3 id, mindkettővel). Amit alulmond, az a PER-COMMIT LEFEDETTSÉG -- és én azzal a
# számmal áraztam be egy review-t. **Egy mérő, két kérdés, és a SZOMSZÉDOSRA magabiztos rossz
# választ ad.** Ugyanaz a törvény, amit ez a lap már hordoz, most a lap SAJÁT parancsán.
#
# A KONKRÉT VAKFOLT: a régi `[0-9a-f, ]+` osztály kizárta a MINŐSÍTŐT a zárójelen
# belül, tehát egy `(card 011bbc1b, half 2a)` alakú -- a konvenciónál TÖBBET mondó -- jelölő
# LÁTHATATLAN volt. didi mérte, marveen újramérte: ezen az ágon 5/7 -> 7/7; a teljes korpuszon
# (3178 tárgysor, minden ref) 184 -> 186, tehát a régi minta REPÓ-SZINTEN pontosan KETTŐT vesztett,
# és mindkettő ez a pár. A tág alak nem kezd prózát vagy SHA-t enni: a `(card |kartya )` előtag
# kötelező marad.
#
# a jelölt commitok száma:  git log --format='%s' origin/main..<ág> | grep -ciE '\((card|kartya)s?'
# az ÖSSZES commit:         git rev-list --count origin/main..<ág>
# ha a kettő ELTÉR, a mérő a maradékról NÉMA -- olvasd el azokat a commit-címeket
```

**ÉS EGY KÖTEG-ÖSSZEÁLLÍTÁSI LÉPÉS, AMI NÉLKÜL FÖLÖSLEGES ÜTKÖZÉST GYÁRTASZ: KÉRDEZD MEG, HOGY EGY
ÁG TARTALMAZ-E EGY MÁSIKAT** (két független előfordulás EGY napon, 2026-09-05: didi az
`ea428cce`/`a8c35a2c` páron, dexter az `590a057b`/`48f8037f` páron).

Két ág, amit külön-külön akarsz beolvasztani, LEHET, HOGY EGYMÁSRA VAN ÉPÍTVE (stacked). Ha igen:

    KÜLÖN beolvasztva  ->  ugyanazt a régiót érintik, tehát ÜTKÖZNEK, és kézzel kell feloldani
    EGY merge-el       ->  a tartalmazó ág MINDKÉT kártyát leszállítja, konfliktus nélkül

**Mérve mindkét páron: `rc=0` az egyik irányban, `rc=1` a másikban, tehát valódi tartalmazás.**
A marveen oldalán ugyanez ma este megspórolt egy merge-et: a `fix/71349fe1-uptime-to-fleet`
tartalmazza a `fix/cb062949-parked-pane-remedy`-t, tehát EGY merge vitte mindkettőt.

```bash
git merge-base --is-ancestor <A> <B>; echo "A a B-ben? rc=$?"   # 0 = igen, EGY merge eleg (B)
git merge-base --is-ancestor <B> <A>; echo "forditva?   rc=$?"  # 1 kell -> a mero szetvalaszt
# KONTROLL, mert a rc=128 „nem tudom" es nem „nem": eloszor gyozodj meg rola, hogy letezik
git cat-file -e <A>^{commit} && git cat-file -e <B>^{commit} && echo "mindketto letezik"
```

**A SORREND NEM STÍLUS, HANEM FELTÉTEL:** ha A-ra van építve B, akkor **A-nak ELŐBB kell landolnia**
-- vagy egyszerűen csak B-t olvaszd be. Aki B-t olvasztja be először és utána A-t, ugyanazt a
munkát kétszer viszi be, és a második ütközik.

*(A `rc=128` kontroll nem formalitás: friday ma este pontosan ezen bukott el egy negatív kontrollon
-- egy nyitott PR fejét használta, ami helyben NEM LÉTEZIK, tehát a válasz „nem tudom" volt, és
„nem"-ként olvasta. Ugyanaz a három kimenet, mint mindenhol: 0 / 1 / **128**.)*

**ÉS EGY HARMADIK KIMENET, AMI EDDIG NEM ÁLLT ITT, ÉS A KETTŐNÉL ROSSZABB: A RÉSZLEGES JELÖLÉS**
(jarvis mérte 2026-09-04, marveen újramérte ugyanazon az ágon).

    fix/6d082d91-workflow-webhooksecret-omit, NÉGY commit az origin/main felett:
      b629461e (card 6d082d91) | a88eca1c (card 6d082d91) | 0e7eafd0 (card 6d082d91)
      4633053c  fix(saved-views): the data-feed token joins the global omit   <- **NULLA JELÖLŐ**
    a recept kimenete: „(card 6d082d91)" x3  ->  magabiztos EGYKÁRTYÁS válasz egy KÉTKÁRTYÁS ágra
    (a negyedik commit az `eca19cb6` teljes javítása)

**A nulla kimenet BECSÜLETES: kimondja a saját némaságát.** Ez nem: válaszol, szűkebben, és semmi
nem jelzi, hogy egy commitot kihagyott. **Egy konvenció-alapú mérő szerkezetileg csak azokról a
commitokról tud jelenteni, amik BETARTOTTÁK a konvenciót -- tehát a válasza PADLÓ, nem halmaz.**
Ezért áll fent a darabszám-összevetés: az az egyetlen jel, ami a részleges jelölést elárulja.

*(A nulla itt nem „tiszta", hanem „nem mérhető" -- ugyanaz a különbség, mint mindenhol ezen a
lapon. És ez az az eset, ahol egy konvenció betartása nem stílus: az különbözteti meg a
gépileg ellenőrizhető ágat attól, amit minden köteg előtt újra el kell olvasni.)*

## TypeScript Conventions

- Both backend and frontend use **full strict mode** (`strict: true`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`)
- Never change `any` to `Record<string, unknown>` or other types without verifying all downstream usage compiles
- Use `npx tsc -b` (not just `tsc`) to match CI strictness
- When working with component props, verify prop names exist on the actual component API before using them
- Backend target: ES2023, module: nodenext
- Frontend path alias: `@/*` maps to `./src/*`
- **`as` ASSZERCIO, NEM ELLENORZES -- egy teljessegi allitashoz `satisfies` kell** (dexter merte
  magan, 2026-09-04, kartya `2bcb6da1`). Egy cimke-tablara irt `as Record<Enum, string>` melle
  odairta kommentben, hogy egy hianyzo cimke mostantol FORDITASI HIBA. Megmerte, mielott szallitotta:

      a DEFAULT kulcsot torolve, `as`-szel ......... `tsc -b --force` exit **0**
      ugyanaz `satisfies`-szal ..................... **KET hiba**: TS1360 a tablan, es
                                                     TS7053 a HIVASI HELYEN -- az utobbi csak azert
                                                     jelent, mert ott is eltunt a cast

  **Az `as` elhallgattatja a fordítot; a `satisfies` megkerdezi.** Egy `as`-szal irt lookup-tabla
  melle tehat NEM szabad teljesseget allito kommentet tenni -- a komment a SZANDEKOT irna le,
  mikozben a kod mast csinal, es epp egy olyan javitasban, aminek a TARGYA egy tipusellenorizetlen
  lookup volt.

## Testing

### Backend (Jest)
- Test files: `*.spec.ts`
- Uses `@nestjs/testing` with `Test.createTestingModule()`
- Run: `npm run test` (unit), `npm run test:e2e` (E2E)
- Coverage: `npm run test:cov` (v8 provider)

### EGY ÚJ TESZT-FÁJL NYOLCSZOR ANNYIBA KERÜL, MINT A BENNE LÉVŐ TESZTEK (mérve 2026-08-28)

computress mérte a teljes helyi készleten (488 fájl / 7795 teszt), miután a saját hajnali
következtetését helyesbítette:

    fájlonkénti overhead ... 451 s = **71%** az összes munkából   (0,93 s/fájl)
    teszt-végrehajtás ...... 171 s = 27%                          (0,022 s/teszt)
    18 új fájl ~ 16,6 s   |   90 új teszt ~ 2,0 s

**A növekedést a FÁJLOK SZÁMA hajtja, nem a teszteké.** Húsz új teszt egy MEGLÉVŐ fájlban
gyakorlatilag ingyen van; két apró új fájl fejenként ~0,93 s.

**AMI EBBŐL KÖVETKEZIK, ÉS AMI NEM.** Nem az, hogy kevesebb tesztet írj -- a lefedettség és a
mutációs fegyelem változatlan. Az, hogy **egy új alakot tegyél MEGLÉVŐ fájlba, ha odaillik**, és
csak akkor nyiss újat, ha a fixture-készlet tényleg más.
*(Mellékhaszon, külön mérve: egy megosztott harness bővítése olcsóbb, mint 150 sor mock
duplikálása -- és két másolat elsodródik. A költség-érv és a helyesség-érv ugyanarra mutat.)*

**Egy hipotézis, amit MEGMÉRT ÉS ELVETETT:** hogy a barrel-importok hajtanák. Hamis -- 486
teszt-fájlból 7 importál barrelből. A költség a vitest fájlonkénti izolációja maga.

### A FIXTURE-T OTT VÁLASZD, AHOL A HELYES ÉS A HELYTELEN MEGVALÓSÍTÁS ELTÉR
(computress, 2026-08-29)

Egy `nextMonday` helpernek két hihető megvalósítása van: az egyik átugorja a mai napot, ha ma
HÉTFŐ, a másik mindig hozzáad hetet. **Szombatról nézve a kettő UGYANAZT adja** -- tehát egy
szombati fixture-rel írt teszt zöld mindkettőn, és semmit nem bizonyít.

Ezért az ő tesztje **HÉTFŐRŐL** állít, a vasárnapi ágat pedig külön -- mert nélküle a hétfői eset
átmegy egy olyan helperen is, ami mindig hetet ad hozzá.

    rossz fixture: a helyes és a hibás implementáció EGYBEESIK -> a teszt zöld, és nem mér
    jó fixture:    a kettő SZÉTVÁLIK                          -> a teszt diszkriminál

**Ez a kontroll-szabály egy lépéssel korábbra tolva:** a lap sokat mond arról, hogy a kontrollnak
meg kell különböztetnie -- de a fixture MEGVÁLASZTÁSA az, ami ezt lehetővé teszi vagy elveszi.
Egy dátum-, sorrend- vagy határérték-teszthez a kérdés nem az, hogy „reális-e a példa", hanem
hogy **ezen a példán MÁST ADNA-E a hibás változat.**

*(A gyakorlati próba: írd le fejben a legvalószínűbb HIBÁS implementációt, és nézd meg, hogy a
fixture-öd megkülönböztetné-e. Ha nem, a fixture a hibás, nem a teszt.)*

**ÉS A FIXTURE-NEK EGY MÁSODIK FELTÉTELT IS TELJESÍTENIE KELL, AMIRŐL EDDIG NEM VOLT SZÓ: EGYEZNIE
KELL AZZAL, AMIT A BACKEND VALÓBAN KÜLD** (computress mérte magán 2026-09-02 éjjel, marveen mérte
hozzá az éles oldalt).

A fenti szabály azt kéri, hogy a fixture VÁLASSZA SZÉT a helyes és a hibás implementációt. Van egy
második, független követelmény: **a fixture ne állítson elő olyan egybeesést, ami élesben nem
létezik.** Az első a mutációt teszi lehetővé, a második azt, hogy amit mérsz, létező alakra
vonatkozzon -- és egy fixture mindkettőt elbukhatja ugyanattól a sortól.

A mért eset: egy `PermissionMatrix` keresőmezőnek három OR-ága van (`resource`, `action`, `name`).
A testvér-teszttől átvett helper a `Permission.name`-t `resource:action` alakban töltötte ki.
**Ezzel minden `resource` és minden `action` részkarakterlánca a `name`-nek is része lett**, tehát a
három ág redundáns, és bármelyiket törölve semmi nem változik. Két mutáció ZÖLDEN maradt egy fájlon,
ami olvasva pontosan úgy néz ki, mintha a keresőt tesztelné.

**AZ ÉLES ADAT, ami eldönti, hogy a fixture volt a hibás és nem a teszt** (csak-olvasó kapu,
mindkét oldalon tüzelt, 2026-09-03):

    Permission sorok ..................................... 95
    `resource:action` alakú `name` ....................... 0
    magyar megjelenítési név ............................. 95   (`activities/create`
                                                                 -> "Tevekenyseg-bejegyzes rogzitese")
    a `name` tartalmazza a `resource` sztringet .......... 0 / 95
    a `name` tartalmazza az `action` sztringet ........... 9 / 95   (nyelvi véletlen:
                                                                 `import` az "importalasa"-ban)

Vagyis az átvett fixture **nulla százalékban** hasonlított a valóságra azon a tengelyen, ami a
tesztet érvényessé teszi. A `schema.prisma` ki is mondja, hogy ez megjelenítési név -- a fixture-t
mégis a szomszéd tesztből másolták, nem a sémából.

*(A 9/95 külön megjegyzendő, és a javított fixture-t nem érvényteleníti: élesben az action-sztring
kilenc soron VÉLETLENÜL benne van a névben. Egy teljes függetlenséget feltételező fixture ezért
TISZTÁBB a valóságnál -- mutációhoz ez a helyes irány, mert teljesen izolálja az ágakat, de egy
kereső-viselkedésről szóló állításnál ezt a kilenc sort tudni kell.)*

**HÉT MECHANIZMUS EGY ÉJSZAKÁN, HÁROM ÁGENSNÉL, ÉS A KÖZÖS KERET computressé:**

> **az ÁLLÍTÁS IGAZ VOLT, csak nem azért, amiért a neve mondja.**

**ÉS A MÓDSZER, AMI MEGTALÁLJA ŐKET -- EZ A HASZNÁLHATÓ FELE, ÉS SZINTÉN AZ Ő MONDATA:**

> **mutáld azt, amit az ÁLLÍTÁS véd, ne azt, amit a JAVÍTÁS megváltoztatott.**

A hét eset mind úgy jött elő, hogy valaki a saját tesztje ÁLLÍTÁSÁRA irányította a mutációt, nem a
javított kódra. A javításra irányított mutáció azt méri, hogy a fix odaért; az állításra irányított
azt, hogy a teszt TUDNA-E bukni, ha a védett dolog eltűnik. A kettő közül csak a második talál
hamis zöldet.

**ÉS EZ NEM EGY EMBER SZOKÁSA: HÁROM ÁGENS, HÁROM ALRENDSZER, EGY ÉJSZAKA.** A hetedik dexteré, és
egy tesztben volt, amit percekkel korábban ő maga írt egy MÁSIK dolog bizonyítására: az állítása a
`commandTimeout NONE`-t nézte, csakhogy azt a GYÁR amúgy is leszedi -- tehát igaz maradt akkor is,
amikor a LEÍRÓ már nem osztályozta blokkolónak. **A gyár viselkedését mérte, miközben úgy olvasódott,
mintha a leíróét.** Ha a saját, imént írt tesztedben is előfordul, akkor nem figyelem kérdése.

    magyar i18n fixture, ahol a literál és a fordítás BÁJT-AZONOS  -> a t() megléte nem mérhető
    egy `role+name` lekérdezés, ami MÁSIK vezérlőt talált meg      -> a teszt zölden mást mér
    egy mező ÁTMÁSOLVA egy másikba                                 -> redundáns ágak, néma mutáció
    egy LETILTOTT vezérlő, ami elnyeli a kattintást                -> a kód el sem indul

**ÉS EGY ÖTÖDIK, UGYANEBBŐL A CSALÁDBÓL, DE ÉLESEBB MECHANIZMUSSAL: AZ ÁLLÍTÁST PONTOSAN AZ A
FELTÉTEL ŐRZI, AMIT ÉSZRE KELLENE VENNIE** (computress mérte, 2026-09-04).

Egy teszt állítása egy `if (clearBtn) { ... expect(...) }` blokkon BELÜL ült. Ha a gomb hiányzik --
ami az EGYETLEN bukás, amiért a teszt létezik --, a blokk nem fut, a callback tisztán visszatér, és
a teszt ÁTMEGY.

    a LoginScreen-eset (lentebb) ... KÉT védelem van, és a tesztek a MÁSIKAT tartják
    ez ............................. EGY védelem van, és az állítás A HIÁNYÁRA van kikapcsolva
    -> **a teszt csak ÁTMENNI tud.** Nincs az a bemenet, amin piros lenne.

**ÉS A KÁRA TÚLMUTAT A SAJÁT FÁJLJÁN:** ez a teszt keltette a lefedettség LÁTSZATÁT egy út fölött,
aminek nem volt lefedettsége -- emiatt maradt egy MÁSIK kód-út kibelezése is 78/78 zölden. Egy ilyen
teszt nem csak nem mér: **elfedi, hogy nem mérünk.**

**A POPULÁCIÓ MÉRVE, ÉS SZÁNDÉKOSAN JELÖLTKÉNT:** 420 frontend teszt-fájlból 12-ben, összesen 63
előfordulás (kontroll: a mérő mind a 420 fájlt látja). **Ez NEM 63 defektus** -- egy `if`-en belüli
`expect` a legtöbbször helyes (tábla-vezérelt teszt, séma-ágak). Aki kört indít rá, ELŐBB futtassa a
hamis-pozitív kaput: olvasson el kézzel egy mintát, és csak 50% alatti FP mellett folytassa. Ez a
fegyelem 2026-09-04-én ötször állított meg egy kört (79 / 89 / 93 / 97 / 84% hamis pozitív).

*(A mérő első alakja EGYSORÁS volt -> **0 találat**. A szerkezet többsoros, tehát a nulla nem
állítás volt, hanem néma mérőhiba -- ugyanaz, amit ez a lap külön szakaszban rögzít.)*

**A negyedik nem fixture-hiba, és ezért érdemes külön:** a `LoginScreen`-en a
`if (!validateForm()) return;` őr TÖRLÉSE mind a 14 tesztet zölden hagyta -- mert a submit gomb
érvénytelen űrlapon TILTOTT, tehát egy kattintás sosem küld submitot. **Két védelem van ott, és a
tesztek a MÁSIKAT tartották**, miközben úgy olvasódtak, mintha mindkettőt. A javítás: a
kattintásos esetek arra állítanak, amit ténylegesen tartanak, az őr pedig kap egy esetet, ami
KÖZVETLENÜL diszpatcheli a form submit eseményét -- plusz egy érvényes-adatos kontroll, hogy a
diszpatch ne egy sosem futó út hiányát bizonyítsa.

Mind a négy **zöld tesztet** termelt, ami **semmit nem mért**, és mind a négy a lefedettségi
számban NÖVEKEDÉSKÉNT jelent meg.

**ÉS AZ i18n-ESET SAJÁT SZABÁLYT ÉRDEMEL, MERT MINDKÉT IRÁNYBAN MÉRVE VAN** (computress
megfogalmazása, 2026-09-03, két ellentétes incumbenssel):

> Egy állítás, ami azon a NYELVEN íródott, amiben a fájl MÁR VOLT, soha nem tudja megkülönböztetni
> a commitot a nem-commitól -- ott a literál és a fordítás bájt-azonos. **Az i18n-teszt első
> kérdése ezért az, hogy MILYEN NYELVEN íródott ez a fájl, és a munkát bizonyító állítások a
> MÁSIKBA kerülnek.**

    ExportModal, ColumnEditorModal ... incumbens MAGYAR  -> a magyar véd, az ANGOL diszkriminál
    AdminPermissionsPage ............. incumbens ANGOL   -> a MAGYAR diszkriminál

**Az ár, amikor nem alkalmazták:** egy `aria-label` visszaállítva beégetett magyar literálra --
mind a 18 teszt ZÖLD maradt.

**A GYAKORLATI PRÓBA, ami mindhármat megfogja, és nem igényel éles hozzáférést:** nézd meg, hogy a
fixture-ödben KÉT MEZŐ ÉRTÉKE származik-e egymásból (másolás, sablon, `${a}:${b}`, ugyanaz a
konstans). Ha igen, minden állítás, ami a kettőt megkülönbözteti, hamisan zöld. A séma
(`schema.prisma` kommentje) olcsóbb forrás a valósághoz, mint a szomszéd teszt -- és a szomszéd
teszt az, amit másolni fogsz.

### ÉS EGY HARMADIK CÍM-ALAK, AHOL A KOMMENT VÉGIG HELYES VOLT: A TÖMÖRÍTÉS KATEGÓRIÁT VÁLTOTT
(jarvis fogalmazta meg a saját visszavonása után, 2026-09-03 -- és az ő alakja élesebb, mint az enyém)

Egy kártya címe azt állította: *„mind az ÖT init `release: unknown`-t ír."* Megdőlt. **A
kommentjeiben viszont az „öt" végig ÖT KONTÉNER-INDULÁST jelentett, időbélyegekkel és pozitív
kontrollal -- és az helyes volt.**

    a KOMMENT ..... öt LOG-SOR, mérve, kontrollal          -> IGAZ
    a CÍM ......... öt INIT, ami `unknown`-t ír            -> HAMIS
    és az `unknown` a NAPLÓ `??` fallbackje (:487), nem az init értéke

**A hamisságot nem egy elszámolás termelte, hanem a TÖMÖRÍTÉS: egy KIMENETRŐL szóló mérésből egy
KÓDRÓL szóló állítás lett.** Nem a szám volt rossz, hanem az, hogy mit mond a szám -- log-sorokból
init-viselkedés, fallback-szóból init-érték.

**A GYANÚS ALAK TEHÁT SZŰKEBB, MINT AHOGY ELŐSZÖR IDEÍRTAM** (én azt mondtam, „egy nevesített ok,
ami három mechanizmust fed"): **egy cím, ami egy KIMENET mérését egy KÓDRA vonatkozó állítássá
tömöríti.** A kommentben semmi nem volt hibás, és a címben semmi nem volt mérve.

**A PRÓBA, ami megfogja, és a cím megírásakor kell feltenni:** amit a címbe írok, azt MÉRTEM, vagy
abból KÖVETKEZTETEM, amit mértem? Ha a mérés naplósorokról szól és a cím kódról, akkor a cím egy
NEM MÉRT lépéssel arrébb van -- és a lista-nézetben az a lépés lesz az egyetlen, amit bárki lát.

*(Ez a harmadik cím-alak ezen a lapon, és a három MÁS mechanizmus: az egyik IDŐBEN avul, a másik
MÚLT IDŐBEN állít egy meg nem történt műveletet, ez pedig KATEGÓRIÁT vált a tömörítés közben. A
közös bennük annyi, hogy a cím az egyetlen látható rész -- a különbségük az, hogy mit kell
megnézni ahhoz, hogy elkapd.)*

### ÉS A TÜKÖRKÉPE EGY NYILVÁNTARTÁSBAN: A MÚLT IDEJŰ KOMMENT EGY MEG NEM TÖRTÉNT MŰVELETRŐL
(dexter mérte, részben a SAJÁT két hetes kártyáján, 2026-09-03)

Az alábbi szakasz arról szól, hogy egy JELEN idejű komment egy már javított fán élő állításnak
olvasódik. Van egy tükörképe, és egy kártyán még alattomosabb: **egy MÚLT idejű komment egy
művelettről, ami soha nem történt meg.**

    "ARCHIVALVA, OSSZEVONVA a 659b421f-be"   <- múlt idő, és NEM volt archiválva
    "ez a kártya archiválandó"               <- szándék, két hétig `planned/high`-on

**A múlt idejű alak a veszélyesebb, és a mechanizmus kimondható:** az „archiválva", „lezárva" egy
BEFEJEZETT MŰVELET NAPLÓJAKÉNT olvasódik, nem szándékként -- tehát senki nem ellenőrzi újra. Egy
jövő idejű vagy felszólító alak („archiválandó") legalább nyitva hagyja magát; a múlt idejű becsukja.

**A MÉRT ÁR:** a tétlen-őr aznap este KÉTSZER ajánlotta fel ugyanazt a kártyát, a felvehető lista
TETEJÉN, és a szerzője hat kommentet olvasott el, mire a SAJÁT, két héttel korábbi archiválási
utasításáig ért.

**ÉS AMIT EBBŐL NEM SZABAD LEVONNI: hogy egy detektor megoldja.** Ugyanaz mérte meg, aki belefutott:
279 nyitott kártyából 37 jelölt, **1 igaz** (~3%). A szavakat MINDKÉT jelentésre használjuk, tehát
nincs az a minta, ami szétválasztja őket. A megoldás a már meglévő konvenció: **ha egy döntés
megváltoztatja, hogy egy kártyát fel kell-e venni, a STÁTUSZ ugyanabban a mozdulatban mozdul.** Egy
komment, ami azt mondja „archiválandó", egy jövőbeli olvasónak szól, aki lehet, hogy soha nem jön.

### A FELDERÍTÉS-KORI KOMMENT A JAVÍTÁS UTÁN IS OTT MARAD -- ÉS ÉLŐ ÁLLÍTÁSKÉNT OLVASÓDIK
(jarvis mérte és VONTA VISSZA a saját leletét, 2026-08-29)

Egy spec fejléce és egy sor-kommentje azt mondta, hogy az elvárás BUKIK, *„és ez maga a lelet"*.
Ebből az következett volna, hogy a spec **szándékosan piros**, tehát a készlet soha nem lehet
zöld -- és erre már szabály is született (`.todo`/`.skip`, sose élő piros állítás).

**Hamis volt. A javítás UGYANABBAN A COMMITBAN van** (`427cef4a`: spec +250, processzor +58). A
komment a FELDERÍTÉS szakaszából maradt ott, és a mai fán már nem igaz.

    a felderítés-kori komment:  „ez az elvárás bukik -- ez a lelet"
    a commit valósága:          a lelet ÉS a javítása egyszerre ment be
    a következő olvasó:         a KOMMENTET hiszi el, mert az beszél, a kód nem

**Az igazi ok más volt, és jobb lelet:** a `368fdd2b` szándékosan írta át a
`documentGenerationJob.update`-et `updateMany`-re, a spec viszont `.update`-re állít. **Két jó
javítás találkozása** -- és pontosan az az `update` / `updateMany` vakfolt, amit ez a lap már
rögzít (a `\.update\s*\(` minta nem illeszkedik az `updateMany(`-ra), csak most nem egy
cenzus-mintában, hanem egy TESZT-ÁLLÍTÁSBAN.

**A gyakorlati szabály:** ha egy commit a leletet ÉS a javítását együtt viszi, a felderítés-kori
megfogalmazás nem maradhat benne jelen időben. Vagy át kell írni arra, amit a kód MOST csinál,
vagy meg kell jelölni, hogy melyik állapotra vonatkozott. Egy jelen idejű mondat egy javított
fáról a legolcsóbb módja annak, hogy valaki egy nem létező defektusra építsen.

*(A visszavonás a szerzőé, perceken belül, azután hogy a leletéből már szabály lett. A szabály áll
-- csak ma este nincs rá példa. Ez a különbség aközött, hogy egy szabályt egy eset SZÜL, és aközött,
hogy egy eset IGAZOL.)*

### NULLA BEGYŰJTÖTT TESZT: EGY TÖRÖTT MOCK UGYANÚGY NÉZ KI, MINT EGY MEG NEM ÍRT FÁJL
(computress mérte 2026-08-28, két fájlon)

Egy `vi.mock('@tanstack/react-query', ...)`, ami NAGYBAN mockol -- felsorolva azt a két-három
hookot, amit a komponens AKKOR használt --, elavul, amint a komponens új modult ér el. A mért
esetben a komponens elkezdte használni a `PermissionContext`-et, aminek `focusManager` kell.

**A spec nem BUKOTT, hanem NULLA TESZTET GYŰJTÖTT BE.**

    egy bukó teszt         ->  piros, névvel, sorral   -> valaki megnézi
    nulla begyűjtött teszt ->  egy SOR HIÁNYA az összesítőben -- és az pontosan úgy néz ki,
                               mint egy fájl, amit még senki nem írt meg

A `Test Files 350 passed` sor nem mondja meg, hogy tegnap 352 volt. **A hiány a megnyugtató
irányba néma:** a készlet zöld, a szám hihető, és a fájl, ami épp a védelmet hordozná, nem fut.

**A JAVÍTÁS IRÁNYA KÖTELEZŐ: a MOCKOT kell kiegészíteni, SOHA nem a kódot lazítani.** Egy mock,
amiből hiányzik, amit a modul MA igényel, HELYESEN törik el -- a törés a jelzés, hogy a mock
elavult. Aki a komponensből veszi ki a függést, hogy a mock megint elég legyen, a TESZTET írja át
a kód helyett, és utána a zöld semmit nem jelent.

**A felismerési jegy, ami egy összesítőből is látszik:** a teszt-FÁJLOK számát nézd, ne csak a
teszteket. Egy eltűnt fájl a fájl-számban látszik; a teszt-számban elvész a zajban -- egy 12
tesztes fájl kiesése egy 8000-es készletben 0,15%.

*(Ez a szakasz a `commit^`-lecke tükörképe a teszt-oldalon: ott egy MÉRŐ hallgatott el, itt egy
VÉDELEM -- és mindkettő a „nincs itt semmi" alakban.)*

### ÉS A KÉSZLET-HATÁR UGYANEZ EGY SZINTTEL FELJEBB: A VITEST KIZÁRJA AZ `e2e`-T, TEHÁT EGY
### PLAYWRIGHT SPEC ÉS EGY ÁTMENŐ SPEC BÁJT-AZONOS A VITEST ÖSSZESÍTŐJÉBEN
(friday mérte magán 2026-09-02-én, egy már „mért zöld"-nek nevezett kötegen, harmadszor
ugyanabban az alakban egy este.)

Húsz átvett specet neveztem „mért zöld"-nek. **Kilenc közülük Playwright e2e**, és a
`vitest.config.ts` `exclude` listája tartalmazza a `'**/e2e/**'`-ot -- vagyis a vitest **soha
nem futtatta őket.** Nem pirosak voltak és nem zöldek: **nem voltak megmérve.**

**A DISZKRIMINÁTOR EGY PARANCS, ÉS EZ AZ ÚJ RÉSZ:**

```bash
npx vitest list <a gyanús spec>     # SEMMI  -> a vitest ki sem gyűjti
npx vitest list <egy valódi unit teszt>   # KONTROLL: sorokat ad -> a mérő lát
```

A kontroll nélkül az üres kimenet megkülönböztethetetlen attól, hogy „nincs benne teszt".

**A KÖLTSÉGE MÉRVE, mert enélkül elméleti maradna:** a kilenc spec a Playwright-készletet
271-ről 288 tesztre vitte, és a job 11,7 percről a **30 perces lépés-korlátra** futott. A
kivételük után `271 tests in 29 files` -- bájtra a sikeres futás mérete.
**És a különbség NEM a tizenhét teszt:** 2,6 s/teszt mellett az ~44 másodperc. A maradék
attribuálatlan (kártya: `f8a2f3c4`).

**A GYAKORLATI SZABÁLY:** ha egy köteg VEGYES spec-halmazt visz (unit + e2e), a „zöld"
szó a KÉSZLETRE vonatkozik, amelyik lefuttatta -- és a vitest-készlet szerkezetileg nem
tartalmazza az e2e-t. Aki e2e specet vesz át, a **Playwright** készletet futtassa, vagy mondja
ki, hogy az a rész MÉRETLEN.

*(Ugyanaz a törvény, mint a fenti szakaszban -- a nulla begyűjtött teszt néma --, csak ott egy
törött mock ejtett ki egy fájlt, itt a konfiguráció zárja ki egy egész könyvtárat. A második
alattomosabb: nem elromlik, hanem MINDIG így működik, és ezért soha nem tűnik fel.)*

### HA A DEFEKTUS A HÍVÓBAN VAN, A KOMPONENS MUTÁLÁSA AZT A FELÉT BIZONYÍTJA, AMI MÁR JÓ VOLT
(computress mérte magán, kétszer egy napon: 2026-09-02, kártyák `318f8f68` és `481fe91c`)

A mutációs hibamódok, amiket a marveen-lap külön gyűjt, MIND arról szólnak, hogy a mutáció nem ÉR
ODA: nem alkalmazódott, típus-annotációba esett, halott soron ült, a fixture vele mozdult, a
harness visszaállította. **Ez más: a mutáció tökéletesen odaér, csak a teszt ALANYA túl szűk.**

    481fe91c  a panelen HÁROM mutáció azonnal piros
              a propot a HÍVÓBÓL kivéve ............................ 48/48 ZÖLD
    318f8f68  a szekció-teszt a CÍMET és a GOMBOT állította
              a listát a szekcióból kivéve ......................... 22/22 ZÖLD

Mindkettőben **a komponens HELYES volt, és a hívó nem adott át semmit** -- ami a `481fe91c`-nél
maga az eredeti defektus: a lap `data`/`isLoading`-ot destrukturált és az `isError`-t eldobta,
tehát egy hibátlan panel kapott hiányos bemenetet.

**HÁROM KÉSZ ELLENŐRZÉS, nem tanács:**

1. **Mutálj a HÍVÁSI HELYEN**, ne csak az alanyon: vedd ki a propot ott, ahol ÁTADJÁK.
2. **Ha több render-hely van, vedd ki CSAK AZ EGYIKRŐL is.** A részleges bekötés önálló eset, és
   egy teszt, ami csak a „mindkettőről eltávolítva" esetet fogja meg, vak a valószínűbb hibára.
   (A `481fe91c`-n két render-helye van ugyanannak a panelnek.)
3. **A hívó tesztjében a komponens STUBJA írja ki a propot** (`data-*`), és állíts rá -- PLUSZ egy
   SIKER-utas kontroll, különben egy a hibaállapotra drótozott stub is kielégítené a bukás-tesztet.

**ÉS UGYANEZ A CSALÁD A PATCH-ÍRÁSBAN: egy szöveg-részletre horgonyzott csere ELOLVASHATJA A SAJÁT
KIMENETÉT.** A `481fe91c` első patch-próbája az `isLoadingRelated={...}` sorra illesztett: a 16
szóközös helyre illett, majd a 14 szóközös minta MÁR A BESZÚRT sorra is -- 1 + 2 = 3 találat két
valódi helyre. Egy mérő, ami önmagát méri. A javítás a SOR-EGÉSZRE horgonyzás; ami viszont
LÁTHATÓVÁ tette, az a várt darabszám assertálása.

**EGY MOCK, AMI TULELI A SAJAT TESZTJET, MASOK TESZTJEIT TORI EL -- ES A `clearAllMocks` NEM VEDI**
(dexter merte magan, 2026-09-04, kartya `ea670f11`).

Egy fazis-tesztben ket agat vitt egy esetben, `clearAllMocks`-szal reset-elve, MELLETTE egy
PERSZISZTENS `updateMany.mockResolvedValue({count: 0})`-val. **A mock kiszivargott a `describe`-bol es
HAROM nem rokon teszt bukott el tole** -- olyanok, amiknek semmi kozuk a modulhoz.

    a `clearAllMocks` a HIVASOKAT torli ......... mock.calls, mock.instances
    az IMPLEMENTACIOT nem ...................... a `mockResolvedValue` tulel
    (dexter diagnozisa; a kovetkezmenyt MERTE -- harom bukott idegen teszt)

**A javitas nem a reset erositese volt, hanem a KETTEVAGAS: ket eset, egy-egy fazissal.** Egy teszt,
aminek a beallitasa tuleli a sajat esetét, mar nem izolalt -- es a kar MASHOL jelenik meg, ahol
senki nem keresi az okot.

*(Ugyanaz az ALLAPOT-kontra-ESEMENY torveny, mint mindenhol ezen a lapon: egy mock-beallitas
ALLAPOT, es az allapotot valakinek vissza kell allitania. A `clearAllMocks` neve tobbet iger, mint
amit tesz.)*

**ES A MASIK, AMIT UGYANOTT TALALT:** a Sentry namespace-import spy-olasa `Cannot redefine property`-t
dob. A repoban MAR VAN helyes alak erre (`emails.service.spec.ts:12`) -- azt vette at, nem talalt ki
ujat. Ugyanaz a szokas, ami ma este tobbszor sporolt meg duplikatumot: **mielott mock-alakot talalsz
ki, keresd meg, hol oldottak meg mar.**

### Frontend (Vitest + Playwright)
- Unit tests: `*.test.ts` / `*.test.tsx` (Vitest, jsdom environment)
- E2E tests: `*.spec.ts` in `e2e/` directory (Playwright, Chromium, serial execution)
- Run: `npm run test` (Vitest), Playwright for E2E
- E2E runs serial (1 worker) due to signup rate limit (5/hour/IP)

**MERET-HATART TESZTELSZ? A `new File(['x'], ...)` MERETE 1 BAJT jsdom-ban** (merve 2026-08-27 es
ujra 2026-09-03, vitest 4.1.10). Egy TARTALOMBOL epitett "tul nagy fajl" fixture ezert SOHA nem eri
el a kuszobot: minden eset messze alatta ul, a teszt zold, es a `>` -> `>=` mutacio TULELI. A
fixture nem tudja kifejezni azt az allapotot, amirol az allitas szol.
A megoldas `Object.defineProperty(f, 'size', { value: ... })`, es fixture kell a hatar MINDKET
oldalara (a limiten ES egy bajttal folotte).
**A KORABBAN ITT ALLO MERT PELDA (`LogoUpload.validation.test.tsx`) NEM LETEZIK AZ
`origin/main`-EN** -- merve 2026-09-05 (didi talalta, marveen ujramerte: 0 talalat;
KONTROLL: maga a `settings/LogoUpload.tsx` komponens 1, es a `settings/__tests__` alatt 20
fajl van, tehat a mero lat). A fajl egy be nem olvasztott agon el. **Aki a peldat kereste,
ures kezzel tert vissza** -- es a szakasz tobbi resze (a `new File(['x'])` 1 bajtja, a
`defineProperty` orvossag, a ket-oldali fixture) VALTOZATLANUL MERT es ervenyes; csak a
MUTATO volt halott.
*(Ezert nem uj peldat neveztem meg helyette: egy masodik, ellenorizetlen mutato ugyanezt a
hibat termelne. A kartya `847569f1`; a teljes eset a `writing-tests-for-existing-code`
skillben all -- ott van a tobbi jsdom-csapda is, es SZANDEKOSAN nem masoljuk ide ketszer.)*

## ESLint & Formatting

- Both backend and frontend use ESLint 9 flat config (`eslint.config.mjs` / `eslint.config.js`)
- `@typescript-eslint/no-explicit-any`: warn (backend), not error
- `@typescript-eslint/no-unused-vars`: warn with `argsIgnorePattern: '^_'`
- Backend Prettier: single quotes, trailing commas (`singleQuote: true, trailingComma: 'all'`)
- Backend lint: `npm run lint` (auto-fix), `npm run lint:check` (CI)

## API Conventions (Backend)

- Global prefix: `/api/v1`
- All controllers use `@UseGuards(JwtAuthGuard)` and `@ApiBearerAuth()`
- Validation: `class-validator` decorators on DTOs with `whitelist: true, forbidNonWhitelisted: true`
- Custom validators in `src/common/validators/` (phone, password, tax number, sanitization)
- Swagger auto-generated from decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiProperty`)
- Error responses: `{ statusCode, message, timestamp, path }`

## Error Handling

- Global exception filter: `src/common/filters/http-exception.filter.ts`
- Prisma errors mapped to HTTP codes (P2002→409, P2025→404, etc.)
- Production: sanitized error messages (no stack traces, no file paths)
- Development: full error details with stack traces
- Sentry integration for all exceptions (with graceful shutdown flush)
- Custom exceptions in `src/common/exceptions/`

## Security

- Helmet with strict CSP, HSTS, frameguard
- CSRF: double-submit cookie pattern (`CsrfGuard`)
- Rate limiting -- **MERT ERTEKEK, es a korabbi harom szam MINDEGYIKE HAMIS VOLT** (mandark merte
  2026-09-05, kartya `a672ad2d`; marveen fuggetlenul ujramerte az `origin/main`-en,
  `app.module.ts:123-146`). A lapon `150/sec, 1500/min, 10000/hour` allt.

  **AZ IRANY VISZONT NEM EGYSEGES, ES ELOSZOR AZT IRTAM IDE, HOGY MINDHAROM A MEGNYUGTATO IRANYBA
  TEVEDT** (didi merte es javitotta, 2026-09-06; kozos egysegre hozva):

      short   lapon 150/sec  |  valodi 500/10s = **50/sec**   -> a lap 3x TOBBET igert
                                                                 = a RIASZTO irany
      medium  lapon 1500/min |  valodi 3000/min               -> 2x szigorubb = megnyugtato
      long    lapon 10000/h  |  valodi 50000/h                -> 5x szigorubb = megnyugtato

  **KETTO a haromból, nem harom** -- es a `short` sor eppen forditva. KONTROLL: minden tier
  masodpercre atszamitott erteke <= 50/s, tehat nincs olyan olvasat, amiben a 150/sec a
  megnyugtato iranyba tevedne.

  *(A javitas ugyanaz a szukites, amit ez a lap a komment/ertek sodrodasnal mar egyszer megtett:
  „egy tier, nem altalanos sodrodas". Egy „mindharom, egy iranyba" mondat MINTAT allit, es a
  minta az, amit idezni fognak.)*

  | tier | ablak | **eles** | fejlesztoi (`NODE_ENV !== 'production'`) |
  |---|---|---|---|
  | short  | 10 s | **500**   | 10 000    |
  | medium | 60 s | **3 000** | 100 000   |
  | long   |  1 h | **50 000**| 1 000 000 |

  **A KORNYEZET-FUGGES EDDIG SEHOL NEM ALLT, es ez a nagyobbik hianyzo fel:** fejlesztoi modban a
  rovid ablak HUSZSZOROSA az elesnek. Egy helyi meres, ami "a rate limit nem tuzelt"-et mond, tehat
  semmit nem allit az elesrol.

  **ES A KONFIG SAJAT KOMMENTJE IS MAST MOND, MINT AZ ERTEKE:** a `short` tier folott
  *"We allow 250 req/10s = ~25 req/sec"* all, kozvetlenul egy `limit: ... : 500` felett.
  A `medium` es a `long` kommentje EGYEZIK az ertekevel (3000, 50000) -- tehat nem altalanos
  sodrodas, hanem egy tier. **Ezt SZANDEKOSAN nem "javitottuk ki" egyik iranyba sem:** hogy a
  komment koveti-e az erteket vagy az ertek szorul a kommenthez, az biztonsagi dontes, nem
  elgepeles. A kartya nyitva.

  **AMI EBBOL A MERESEKRE KOVETKEZIK: a throttler KERESEKET szamol, nem MUNKAT.** Egy kerés, ami
  5000 vegrehajtast indit, 0,2%-a a 10 masodperces keretnek. Aki a throttlerre mutat mint korlatra,
  mondja meg, MELYIK tengelyen korlatoz.
- Input sanitization: `sanitize-html` + custom XSS validators
- Auth: JWT access + refresh tokens, optional 2FA (otplib)
- RBAC: `@UseGuards(JwtAuthGuard, RbacGuard)` + `@RequirePermission('resource', 'action')`

### EGY JOGOSULTSÁGI KÖVETELMÉNY BEKÖTÉSÉNEK VAN EGY MÁSODIK FELE, ÉS AZ A UNIT-TESZTEK ELŐL
### LÁTHATATLAN: A MODUL IMPORT (dexter mérte magán, 2026-08-29)

Aki egy kontrollerre `@RequirePermission`-t (vagy alias-dekorátort) tesz, annak a modulnak
**importálnia kell az `RbacModule`-t is**. A Nest a guardot a KONTROLLER SAJÁT MODULJA számára
látható providerekből építi -- import nélkül **a teljes PROCESS nem indul el**, nem csak a kapuzott
útvonal hibázik.

    a hiányzó import ára ....... a folyamat EL SEM INDUL
    amit a unit-tesztek látnak .. SEMMIT: minden spec zöld marad

Mért eset: dexter első változata a `0742558e`-hez kihagyta az importot. A teljes készlet **19
bukást** adott, és köztük az az EGY, ami megmagyarázza a többit -- a
`guard-module-wiring.spec.ts` állítása: *„every module registering a gated controller imports
RbacModule"*. **Ez a spec azért létezik, mert 2026-08-18-án ez már megtörtént, ~7500 zöld teszt
mellett.**

**A GYAKORLATI SORREND, ha jogosultságot adsz egy kontrollerhez:**

1. a route kap `@RequirePermission`-t (vagy alias-t),
2. az OSZTÁLY kap `PermissionGuard`-ot -- **enélkül a dekorátor nem hat, csak ott van**,
3. a MODUL importálja az `RbacModule`-t,
4. és a tesztek közt fusson a **teljes** készlet, ne csak a modulé: a wiring-spec repó-szintű.

**ÉS A TESZT-OLDALON UGYANEZ A KETTŐSSÉG:** egy teszt, ami CSAK a követelmény meglétét állítja,
ZÖLD MARAD, miközben a védelem eltűnik -- pontosan az a defektus, amit ez a kártya javított
(követelmény guard nélkül semmit nem véd). A spec ezért **mindkettőt** állítsa, és a mutáció
mindkét irányban piros legyen: követelmény elvéve -> piros; guard elvéve, követelmény MEGTARTVA ->
piros.
- Never commit `.env` files — use `.env.example` for reference

### EGY KREDENCIA KIVÉTELE EGY OLVASÁSI ÚTBÓL: NÉGY KÖVETELMÉNY, NEM NÉGY LÉPÉS

**AKI AZ ELSŐ HÁROMBÓL CSAK EGY RÉSZT VALÓSÍT MEG, ADATROMBOLÓT ÉPÍTETT, NEM JAVÍTÁST.**

    K1  OLVASÁS-OLDALI ELTÁVOLÍTÁS ... MINDIG. A kredencia ne jelenjen meg olyan válaszban, aminek
                                       a jogosultsága GYENGÉBB, mint amit a LÉTREHOZÁSA kíván.
                                       (A horgony a kódbázis saját politikája -- olvasd, ne döntsd el.)
    K2  ÍRÁS-OLDALI MEGŐRZÉS ......... HA a tároló EGÉSZBEN íródik. Minden írási út őrizze meg, amit
                                       nem lát. Kihagyva EZ AZ ADATROMBOLÓ: a kliens beolvassa a
                                       megcsonkított szerkezetet, módosítja, visszaküldi -- a nem
                                       látott kulcsok NÉMÁN eltűnnek.
    K3  KIMONDOTT TÖRLÉSI ÚT ......... HA K2 él. K2 miatt a HIÁNY azt jelenti, „hagyd" -- a kliens
                                       elveszti a törlés képességét. A bent rekedés a szivárgás
                                       tükörképe, és ugyanaz a szabály sérül.
    K4  LÁTHATÓSÁGI ÚT ............... HA van legitim UI-fogyasztó. Szűk, nevesített olvasás, aminek
                                       a jogosultsága MEGEGYEZIK a mintézésével. Kihagyva K1 némán
                                       elvesz egy működő funkciót.

**A KÉT MÉRÉS, AMI ELDÖNTI, MELYIK KÖVETELMÉNY ÉL -- EGYIK SEM FELTÉTELEZHETŐ:**

    1. HOGYAN ÍRÓDIK A TÁROLÓ?
       SKALÁR oszlop + Prisma mezőnkénti írás -> K2 NEM kell (a mező nincs a `data`-ban, nem íródik
       felül; ellenőrizve a `saved-views.service.ts` `update()`-jén).
       JSON oszlop + egészben csere (`config: dto.config`) -> K2 KELL. A Prisma nem merge-el JSON-t.
    2. VAN-E LEGITIM UI-FOGYASZTÓ? **ÉS NEM A MEZŐNÉV KERESÉSÉVEL** -- egy generikus szerkesztő sosem
       nevezi meg a mezőt. A horgony az ÍRÁSI VÉGPONT és a payload alakja.

**MINDKETTŐT AZÉRT KELL MÉRNI, MERT MINDKETTŐT ELRONTOTTAM EGY ESTE** (dexter, 2026-09-02): a
`Dashboard.publicToken`-nél nem néztem meg a UI-fogyasztót (a `DashboardViewPage` a kapuzatlan
válaszból rendereli a megosztási linket -> majdnem néma funkció-vesztés, zöld készlet mellett); az
öt kimenő webhook-hitelesítőnél nem néztem meg az írási utat (a step-config 500 ms-os auto-mentéssel
teljes JSON-t ír vissza -> majdnem visszaállíthatatlan adatvesztés az ügyfél API-kulcsán). Mindkettőt
MÁS mérte ki helyettem.

A teljes keret, a négy eddigi eset besorolásával: kártya `471d8d25`, komment 16.

## Éles adatbázis MÉRÉSE (nem írás) -- a csak-olvasó kapu, és két alak, ami NEM az

Amikor éles adaton mérsz (darabszám, eloszlás, egy lelet ellenőrzése), a kapu **szerver-oldali
tranzakció** legyen, és a kapu tüzelését **a mérés előtt ÉS után** bizonyítsd, ugyanabban a
tranzakcióban. Fájlból futtasd (`psql -f`), ne `-c`-vel.

**ÉS A HOOK-LEFEDETTSÉGET NE OLVASD BELE EBBE A SORBA: a `-f` alak a DB-KAPU VAKFOLTJA VOLT, ÉS
RÉSZBEN AZ IS MARAD** (friday mérte és javította 2026-09-04, marveen döntése; kártya `2e08a7e1`.
Testvér-bejegyzés: a mechanizmus a marveen repóban, `scripts/hooks/db-destructive-gate.py`
docblockja).

A `db-destructive-gate.py` hook a PARANCS SZÖVEGÉT nézi. Ha az SQL egy FÁJLBÓL érkezik, az utasítás
nincs a szövegben -- tehát ugyanaz a `DROP TABLE` `-c`-vel BLOKKOLT, `-f`-fel ÁTMENT.

    psql -f ./x.sql   /   psql < ./x.sql     ->  FEDVE, A BEOLVASZTÁSTÓL (literál út)
    psql -f "$f"      /   futásidőben épített SQL  ->  **NINCS FEDVE, és nem is lehet:**
        a hook parancs-sztringet lát, nem folyamatot. Ez az ESZKÖZ HATÁRA, nem elmulasztott javítás.

**A „BEOLVASZTÁSTÓL" NEM UDVARIASSÁG: a `scripts/` az AZONNAL-ÉLŐ sáv, tehát a merge pillanatában
hat -- de amíg a `fix/2e08a7e1-dbgate-literal-file` nincs beolvasztva, MINDKÉT alak fedetlen.**
Aki ezt a sort olvassa és tudni akarja, melyik állapot él: `git log --oneline -1
scripts/hooks/db-destructive-gate.py` a marveen fő checkoutban, vagy egyszerűbben, a hook
docblockja megnevezi-e a `2e08a7e1`-et. **A dátumot szándékosan nem írom ide: az elavul, az
ellenőrzés nem.**

**ÉS EZ A SOR ÉPP A NEM FEDETT ALAKOT ÍRJA ELŐ.** A recept megvalósítása
(`scripts/readonly-measure.sh:122`) `psql "$URL" -f "$WRAPPED"` -- VÁLTOZÓ --, tehát a fájl-alakú
kézbesítés egyetlen mért használója szerkezetileg kívül marad a hookon.

**AMIT EZ NEM MOND: hogy a recept kockázatos volna.** Nem az, és nem is a hooktól biztonságos: a
védelmét SAJÁT MAGA hozza -- `BEGIN TRANSACTION READ ONLY`, plusz a kapu tüzelésének bizonyítása a
mérés ELŐTT ÉS UTÁN. Ez a szakasz pontosan ezt írja elő fentebb, és ez a helyes védelem.
**A megjegyzés egyetlen állítása az, hogy a hook itt NÉMA -- tehát ha valaha lecserélnéd a
read-only tranzakciót valami olcsóbbra, nincs mögötte második háló.**

*(Miért a CRM lapon: ezt a mondatot itt olvassa valaki, és itt merül fel benne, hogy akkor a hook
figyeli. Sehol máshol. A mechanizmus a másik lapon van, mert a hook ott él -- ez ugyanaz a
testvér-bejegyzés alak, amit ez a lap már kétszer rögzít.)*

```sql
\set ON_ERROR_STOP off
BEGIN TRANSACTION READ ONLY;
SAVEPOINT gate_before;
UPDATE "<tabla>" SET "<oszlop>" = "<oszlop>" WHERE false;     -- HIBÁT kell adnia
ROLLBACK TO SAVEPOINT gate_before;

-- ... a mérés, UGYANEBBEN a tranzakcióban ...
-- ÉS MINDEN SPEKULATÍV LEKÉRDEZÉS SAJÁT SAVEPOINTOT KAP -- lásd a blokk alatt:
--   \set ON_ERROR_ROLLBACK on   <- EZ, es NEM kezi SAVEPOINT/RELEASE par (lasd lentebb:
--   a kezi alak MERVE 1/2 kapu-tuzelest ad egy elgepelt nev utan, es a helper MEGTAGADJA)

SAVEPOINT gate_after;
UPDATE "<tabla>" SET "<oszlop>" = "<oszlop>" WHERE false;     -- ennek is HIBÁT kell adnia
ROLLBACK TO SAVEPOINT gate_after;
ROLLBACK;
```

**A `WHERE false` 2026-08-29-ÓTA AZ ALAK, ÉS NEM A `WHERE id = -1`** -- nincs benne literál,
tehát nincs mit eltéveszteni, és nem kell ismerni a kulcs típusát. A négy irányban mért
bizonyíték és a régi alak csapdája lentebb, a „MEGSZŰNT A FELTÉTEL" bekezdésben; a lenti
szakaszok a történetét magyarázzák, nem másik követelményt írnak elő.
*(A `gate_after` is UPDATE lett, nem `CREATE TEMP TABLE`: az SQLite-on ÁTMEGY egy read-only
kapcsolaton, tehát ott vak -- ezt a lap lentebb külön méri. Egy alak, két motor.)*

**ÉS EGY ELGÉPELT AZONOSÍTÓ NEM A MÉRÉST TÖRI EL, HANEM A KAPU BIZONYÍTÉKÁT -- ÉS EZ A RECEPTBŐL
EDDIG HIÁNYZOTT** (didi mérte magán, 2026-09-05, KÉT érvénytelen futás ugyanabban az alakban).

Postgresben egy hibás utasítás **ABORTÁLJA a tranzakciót**, és onnantól MINDEN további utasítás
`current transaction is aborted`-tal hal el -- **beleértve a `gate_after`-t.** A `\set ON_ERROR_STOP
off` miatt a szkript FUT TOVÁBB, tehát:

    a SZÁM kijön, és hihetőnek látszik
    a `gate_after` NEM tüzel a READ ONLY miatt, hanem AZÉRT, MERT A TRANZAKCIÓ MÁR HALOTT
    és a két hiba KIMENETE KÜLÖNBÖZIK, csak épp senki nem olvassa el a szövegét

**Vagyis egy tábla- vagy oszlopnév-tipp nem a mérést rontja el, hanem azt a bizonyítékot, hogy a
mérés végig a zárt tranzakcióban maradt** -- pontosan azt, amiért a `gate_after` létezik. És nem
jelenti be magát: a recept minden látható eleme a helyén marad.

**A JAVÍTÁS: minden SPEKULATÍV lekérdezés kapjon SAJÁT savepointot, ne csak a két kapu.**

**ÉS A KÉZI ALAK PONTOSAN AZON BUKIK EL, AMIT MEGELŐZNI HIVATOTT -- marveen mérte magán
2026-09-05 20:0x, KÉT ÓRÁVAL azután, hogy ezt a bekezdést ideírta.** A kézzel írt pár így néz ki:

```sql
-- ⚠ EZ A ROSSZ ALAK. NE MASOLD KI INNEN -- ez a DEFEKTUS bemutatasa, nem recept.
-- A helyes alak harom bekezdessel lentebb all: \set ON_ERROR_ROLLBACK on
SAVEPOINT p1;
SELECT count(*) FROM "<amiben nem vagy biztos>";
RELEASE SAVEPOINT p1;        -- siker esetén; HIBA esetén: ROLLBACK TO SAVEPOINT p1;
```

**A kommentben ott a helyes ág, és egy szkriptben SENKI nem tudja lefuttatni** -- a `psql` nem
elágazik. Aki ezt bemásolja, minden lekérdezés után `RELEASE`-t ír, ami egy MÁR ABORTÁLT
tranzakcióban **nem csinál semmit**: az első elgépelt oszlopnév után minden további utasítás
`current transaction is aborted`, a `gate_after` is, és a savepointok pontosan annyit érnek,
mintha ott sem lennének.

*(Mért eset: egy `is_called` oszlop a `pg_sequences`-en, ami nem létezik. A savepointok ott
voltak, a `RELEASE`-ek ott voltak, és a záró kapu mégsem futott le.)*

**A MECHANIKUS ALAK, AMI VALÓBAN ELÁGAZIK -- EZ HASZNÁLANDÓ:**

```sql
\set ON_ERROR_ROLLBACK on
-- innentől a psql MINDEN utasítás köré maga tesz savepointot, és hiba esetén
-- MAGA gurít vissza rá. Nem kell kézzel párosítani, és nincs mit elrontani.
SELECT count(*) FROM "<amiben nem vagy biztos>";
```

**Mérve, ugyanaz a mérés, ugyanaz az elgépelés:** kézi savepointokkal `kapu-tüzelések: 1/2` és a
`readonly-measure.sh` MEGTAGADTA az eredményt; `ON_ERROR_ROLLBACK on`-nal `2/2`, és a mérés
lefutott. **A megtagadás mentette meg** -- a szám (0 naptár-kapcsolat) mindkét futásban ugyanaz
volt, tehát a hibás futás egy HELYES számot adott volna bizonyíték nélkül.

*(A `readonly-measure.sh` egyetlen siker-feltétele ezért PONTOSAN két kapu-tüzelés, és ezért
`exit != 0`, nem figyelmeztetés. Ez a különbség egy jelző, ami hazudik, és egy kapu, ami megtagad.)*

Így egy elgépelt név a saját savepointjáig gurul vissza, a tranzakció ÉL, és a `gate_after`
továbbra is arról szól, amiről szólnia kell.

**ÉS A MÁSODIK SAJÁT HIBÁJA UGYANEBBŐL A FUTÁSBÓL, mert a kettő együtt adja a leckét:** a
kontrollja egy `count(*) FILTER (WHERE length(...) > 0)` volt UGYANAZON az ÜRES táblán, amit mért
-- egy üres halmazon ez triviálisan teljesül. **A kontroll a MÉRT HALMAZON KÍVÜLRŐL jöjjön.** Az,
ami végül döntött, két MÁSIK tábla volt (`Permission` 95, `Organization` 29 -- mindkettő egyezik a
lapon már álló számokkal), plusz a `pg_stat_user_tables`: 0 valaha beszúrt sor a mért táblákon,
99 beszúrt / 4 törölt / 95 élő a kontrollon. **Így a nulla nem állapot-nulla, hanem soha-nem-volt.**
*(Kimondott határ, didié: a `pg_stat_user_tables` számlálói az utolsó statisztika-nullázástól
futnak, nem a tábla létrehozásától.)*

**KÉT ALAK, AMI VÉDELEMNEK LÁTSZIK ÉS NEM AZ -- mindkettő mérve 2026-08-22:**

1. **`PGOPTIONS='-c default_transaction_read_only=on'` a Supabase pooleren NEM ér el a szerverig**
   (jarvis mérte, marveen ellen: kétszer állt kártyán, hogy „kényszerített read-only munkamenet",
   és nem volt az). A bizonyíték, amit egy tippelés nem adott volna meg: UGYANABBAN a hívásban a
   `SHOW statement_timeout` visszaadta az általunk adott értéket, miközben a
   `SHOW default_transaction_read_only` -> `off`. A PGOPTIONS tehát **átmegy**, csak ezt az egy
   GUC-ot nyeli el. Részleges kézbesítés: a mechanizmus működőnek látszik.

2. **`psql -c 'BEGIN ...; UPDATE ...; SELECT ...'` EGYETLEN kötegként megy** (mandark mérte, helyi
   Postgresen, MIELŐTT élest futtatott volna -- a receptet ő maga írta korábban, és a saját
   receptjét mérte meg). A kontroll hibája **megszakítja a köteget**, tehát a SELECT -- vagyis maga
   a mérés -- **el sem indul**. A „pozitív kontroll a mérés előtt, ugyanabban a hívásban" kikötés
   ebben a formában kivitelezhetetlen volt, és élesben derült volna ki, első próbálkozásra.

**ÉS A `gate_after` ALAKJA MOTOR-FÜGGŐ: SQLITE-ON A `CREATE TEMP TABLE` VAK** (marveen mérte
2026-08-28, kártya `5a2d56f8`). A fenti recept Postgresre készült és ott érvényes. A marveen
`store/claudeclaw.db` viszont ugyanúgy ÉLES adat, és ott ez a kontroll semmit nem mér:

    UPDATE valódi táblára, read-only kapcsolaton  ->  attempt to write a readonly database
    CREATE TEMP TABLE, UGYANAZON a kapcsolaton    ->  ÁTMEGY, hibátlanul

Az ok: az SQLite temp store külön él a fő adatbázistól, tehát a read-only nyitás nem tiltja.
**A hiba iránya a jobbik** -- a kontroll „nem tüzelt"-et mond egy VÉDETT kapcsolatra, tehát
újramérsz --, de a bizonyíték, amit a recept kér (hogy a mérés végig a zárt tranzakcióban
maradt), nem áll elő. SQLite-on tehát a gate_after IS valódi-tábla-írás legyen, ugyanaz az
`UPDATE`, mint a gate_before.

**ÉS AZ SQLITE-KAPUNAK VAN EGY MÁSODIK, KÜLÖN CSAPDÁJA: EGY NEM LÉTEZŐ OSZLOPNÉV UGYANAZT A
KIVÉTELT ADJA, MINT A TÜZELŐ KAPU** (friday mérte magán, 2026-09-04). A kapuja `OperationalError`-t
dobott egy `task_name` oszlopra, ami nem létezik (a valódi neve `name`), és ezt „a kapu tüzelt"-nek
olvasta. **Egy KIKAPCSOLT kapcsolat PONTOSAN UGYANAZT dobta volna** -- a hiba oka a séma, nem az
írásvédelem.

Ez betűre a Postgres-oldali `WHERE id = -1` csapda SQLite-alakja, más mechanizmussal: ott a LITERÁL
típusa téved, itt az OSZLOP NEVE. A közös törvény változatlan, és dexter fogalmazásában áll fentebb:
**az `ERROR` önmagában NEM bizonyít, csak akkor, ha tudod, MI okozta.**

A gyakorlati javítás egy sor: **írasd ki a kivétel SZÖVEGÉT**, ne csak azt, hogy volt kivétel. Az
`attempt to write a readonly database` állítás; egy `no such column: task_name` nem az.

**A tágabb alak, mert nem az SQLite a lényeg:** a kontroll a VÉDETT ERŐFORRÁST írja, ne egy
mellette lévőt. Temp tábla, memória-tábla, session-változó mind kieshet a védelem hatóköréből
-- és a kiesés bájt-azonos egy nem tüzelő kapuval.

**Miért kell az UTÁNA is:** minden `psql -c` saját kapcsolatot nyit, tehát egy külön hívásban
igazolt kapu **más tranzakciót** bizonyít, mint amiben a mérés fut. A `gate_after` az, ami kimondja,
hogy a mérés végig a zárt tranzakcióban maradt.

**A `WHERE id = -1` és az `oszlop = oszlop` szándékos:** az id `serial`, tehát -1 sosem létezik, és
az értékadás identitás -- nulla sor mozdul akkor is, ha a kapu NEM tüzel. A kontroll így nem tud
kárt okozni azzal, hogy működik.

**HARMADIK ALAK, AMI VÉDELEMNEK LÁTSZIK ÉS NEM AZ: `SET default_transaction_read_only = on` EGY
`-c` KÖTEGBEN** (mandark és didi mérte egymástól függetlenül, marveen újramérte, 2026-08-24;
psql/PG 15.19, eldobható helyi adatbázison).

```
psql -c "SET default_transaction_read_only = on; UPDATE t SET v='X' WHERE id > 0; SHOW default_transaction_read_only;"
  SET | UPDATE 1 | on          <- ÉS AZ ÍRÁS TÉNYLEGESEN MEGTÖRTÉNT
```

Nem gyenge védelem: NINCS védelem, miközben a `SHOW` `on`-t mond. Az ok nem a `SET`: a GUC az
UTÁNA INDULÓ tranzakciókra hat, egy `-c` string viszont EGY implicit tranzakció, ami a `SET`
pillanatában már elindult. Bizonyíték: egy `COMMIT` beszúrása a `SET` után, UGYANABBAN a kötegben,
már VÉDETTÉ teszi az UPDATE-et; és ugyanez a `SET` KÜLÖN `-c`-ben szintén véd.

    ALAPÉRTELMEZÉS:  BEGIN TRANSACTION READ ONLY   (minden formában véd, `-c` kötegben is)
    FELMINŐSÍTÉS:    SET ... = on, KÜLÖN `-c` utasításként
    SOHA:            SET és a mérés EGY `-c` kötegben

**A `SHOW default_transaction_read_only` NEM válaszol a "védve vagyok-e" kérdésre:** `on`-t mond a
nem védett esetben is. Az egyetlen válasz az, hogy INDULT-E ÚJ TRANZAKCIÓ a `SET` óta.

**ÉS AMI EBBŐL A KONTROLLRA KÖVETKEZIK.** Az `UPDATE 0` válasz SOHA nem jelenti azt, hogy a kapu
tüzelt: egy read-only tranzakcióban az UPDATE MINDIG `ERROR`-t ad, akkor is, ha nulla sor
illeszkedne -- a kapu az executor indulásakor tüzel, nem a sorokon. Mérve, ugyanazon a fán:

| forma | `WHERE id = -1` | illeszkedő `WHERE` |
|---|---|---|
| `BEGIN TRANSACTION READ ONLY` | **ERROR** | **ERROR** |
| `SET` külön `-c`-ben | **ERROR** | **ERROR** |
| `SET` egy `-c` kötegben | `UPDATE 0` | `UPDATE 1` **+ az írás megtörtént** |
| semmilyen védelem | `UPDATE 0` | az írás megtörténik |

Tehát a `WHERE id = -1` **nem teszi vakká a kontrollt**: a sorok illeszkedése nem számít. Az
`UPDATE 0` egyetlen jelentése az, hogy A KAPU NEM TÜZELT -- és ebben megkülönböztethetetlen a
"nincs védelem" a "van védelem, csak nem hat" esettől. Mindkettő védtelen. Ezért **nem kell**
illeszkedő sorral lefuttatni a kontrollt: az `ERROR` / `UPDATE 0` különbség mindent megmond,
kockázat nélkül.

*(A recept `gate_after` fele is mérve, ugyanitt: `CREATE TEMP TABLE` READ ONLY tranzakcióban
`ERROR: cannot execute CREATE TABLE in a read-only transaction`, ellenkontrollként read-only
NÉLKÜL `CREATE TABLE` -- tehát a hiba oka tényleg az írásvédelem, nem valami más.)*

**ÚJRANYITÁSI FELTÉTEL:** más Postgres fő verzión újramérendő -- a köteg-viselkedés kliens-oldali
kötegelésen múlik. A poolert ez NEM méri; azt didi és jarvis mérte külön.

**DE A `WHERE id = -1` CSAK OTT JÓ, AHOL AZ `id` SZÁM -- ÉS EZ A REPÓBAN NEM ÁLTALÁNOS**
(dexter mérte élesen, 2026-08-23). Ahol az `id` `String`/uuid, ott a `-1` **típushibát** ad. Az is
hiba, tehát a recept „HIBÁT kell adnia" feltétele **teljesül** -- csakhogy nem a read-only miatt.
Vagyis a kontroll pontosan akkor mond igazat véletlenül, amikor semmit nem bizonyít: egy kikapcsolt
kapu mellett is ugyanezt a hibát kapnád.
Uuid-oszlopnál **uuid-literál kell** (egy biztosan nem létező, pl. csupa nulla), hogy a hiba oka a
tranzakció írásvédelme legyen, ne a típuskonverzió. A táblát ismerni kell hozzá -- ez nem
formalitás, ez maga a kontroll érvényessége.

**A KETTŐ EGYÜTT TESZI A KONTROLLT ÉRVÉNYESSÉ -- egy mondatban** (dexter fogalmazta meg
2026-08-24, a fenti két bekezdés összeolvasásából; mindkét fele külön mérve):

- **`UPDATE 0` MINDIG cáfol:** azt jelenti, hogy a kapu NEM tüzelt. A sorok illeszkedése nem
  számít, mert a read-only kapu az executor indulásakor tüzel, nem a sorokon.
- **`ERROR` önmagában NEM bizonyít:** csak akkor, ha a literál TÍPUSA helyes. Uuid-oszlopon a `-1`
  típushibát ad, és az is „hiba" -- egy kikapcsolt kapu mellett is ugyanazt kapnád.

Vagyis a cáfolat olcsó és egyértelmű, a bizonyítás viszont feltételes. Ezért kell a táblát ismerni
a kontroll megírásához: nem a recept betartása a kérdés, hanem hogy a hibát MI okozta.

**ÉS 2026-08-29-EN MEGSZŰNT A FELTÉTEL: A LITERÁLT KI LEHET HAGYNI EGÉSZEN** (jarvis
javasolta a `readonly-measure.sh` írása közben, marveen újramérte négy esetben).

    UPDATE "<tabla>" SET "<oszlop>" = "<oszlop>" WHERE false;

Nincs benne literál, tehát nincs mit eltéveszteni, és nem kell ismerni a tábla kulcsának a
típusát. Mérve, helyi Postgresen, mind a négy irányban:

| eset | eredmény |
|---|---|
| `WHERE false`, READ ONLY tranzakcióban | **ERROR: cannot execute UPDATE in a read-only transaction** |
| `WHERE false`, read-only NÉLKÜL | `UPDATE 0` -- semmi nem mozdul |
| a régi alak TÍPUSHELYES literállal (`'-1'` egy TEXT kulcson), READ ONLY | ERROR, helyesen |
| a régi alak `-1`-gyel egy TEXT kulcson, READ ONLY | **ERROR: operator does not exist: text = integer** |

Az utolsó sor a fenti bekezdés csapdája, reprodukálva -- és **tágabb, mint ahogy addig állt:
nem csak uuid-on, hanem MINDEN nem-egész kulcson** típushibát ad. A dexteri megfogalmazás
(„az `ERROR` csak akkor bizonyít, ha a literál típusa helyes") változatlanul IGAZ; a
`WHERE false` egyszerűen megszünteti azt a kérdést, hogy helyes-e.

A biztonsági érv is megmarad: read-only NÉLKÜL `UPDATE 0`, tehát ha a kapu bármikor nem
tüzel, a kontroll akkor sem tud kárt okozni -- ugyanaz a tulajdonság, amiért a `WHERE id = -1`
szándékos volt, csak tábla-ismeret nélkül.

*(A fenti két bekezdést azért NEM töröltük: azok magyarázzák meg, MIÉRT volt a literál
probléma. Egy javított recept mellett a régi indoklás elolvasva úgy hat, mintha még
érvényes követelmény lenne -- ezért áll itt kimondva, hogy az ÚJ alak a használandó, és a
régi a története.)*

**ÉS A PSQL EL SEM INDUL A `.env` DATABASE_URL-jével, VÁLTOZTATÁS NÉLKÜL** (ugyanaz a mérés).
A Prisma URL-je **Prisma-specifikus query-paramétert** hordoz (`connection_limit`), amit a libpq
elutasít: `invalid URI query parameter`. A query-részt le kell vágni, és `?sslmode=require`-t tenni
a helyére. Enélkül a fenti recept egyetlen sora sem fut le -- és a hibaüzenet az URL-ről szól, nem
a receptről, tehát elsőre úgy néz ki, mintha a hitelesítő adat lenne rossz.

## EGY VÁLTOZTATHATÓ MEZŐ NEM ESEMÉNYNAPLÓ -- ÉS A BELŐLE OLVASOTT NULLA MÁST ÁLLÍT, MINT AMIT
## KÉRDEZTÉL (didi mérte élesen, 2026-08-28)

A kérdés az volt: *generált-e valaha bárki könyvelői adatfolyam-tokent?* A mérés helyes volt, a
kapu tüzelt mindkét oldalon, a kontroll nem-nullát adott. **A válasz mégsem arra a kérdésre
vonatkozott.**

    accountantFeedToken NOT NULL ....... 0
    a visszavonás NULLÁZZA mindkét oszlopot (accountant-export.service.ts:576-577)
    sem a generálás, sem a visszavonás nincs auditálva -- csak egy logger.log sor

    0  =  MA NINCS ÉLŐ TOKEN
    0  ≠  soha senki nem generált

Egy generálás-majd-visszavonás **nyomtalan**. Az oszlop a JELEN ÁLLAPOTOT tárolja, nem a
történetet -- és a kettő ugyanabban a `NULL`-ban néz ki egyformán.

**ÉS A POZITÍV VÁLASZ, AMI EDDIG HIÁNYZOTT: KERESS MONOTON ARTEFAKTUMOT** (didi mérte, 2026-09-04).

Ez a szakasz eddig csak azt mondta meg, mikor NEM lehet válaszolni. Van pozitív alakja is, és
ugyanabban a csak-olvasó tranzakcióban elfér:

    `count(*) = 0` ............ ÁLLAPOT. „ma nincs sor" -- a törölt és a sosem-volt EGYFORMA.
    az IDENTITY SZEKVENCIA .... MONOTON. `last_value=1, is_called=f` -> **soha nem volt INSERT**,
                                nem „volt, aztán törölték". (Kiegészítő jel: `reltuples = -1`.)

**Egy monoton artefaktum akkor is válaszol a MÚLTRÓL, amikor az állapot-oszlop nem tud.**

**DE A CSALÁD KETTÉVÁLIK, ÉS ELSŐRE EGYBEN ÍRTAM IDE -- didi javította, a MI SAJÁT ellenpéldánkkal**
(2026-09-04). A megkülönböztető az, hogy az artefaktum MIKORTÓL létezik:

    az ALANY KELETKEZÉSÉTŐL ......... identity/`SERIAL` szekvencia
                                      -> a tábla TELJES élettartamát fedi. Visszafelé korlátlan.
    a MECHANIZMUS TELEPÍTÉSÉTŐL ..... audit-tábla, esemény-napló, később hozzáadott számláló
                                      -> CSAK AZÓTA válaszol, és **a határ a lekérdezés
                                      eredményéből NEM LÁTSZIK**
    (`_prisma_migrations` a MÁSODIKBA tartozik: egy `migrate reset` kiüríti.)

**AZ ELLENPÉLDA A SAJÁT TÁBLÁNKON VAN** (`d75a1426`, dexter 08-29, marveen mérésével):

    AuditLog entityType='CustomField' ..... 0
    KONTROLL: létező entityType-ok élnek ... Project, Task -> a napló ÍRÓDIK
    DE: a CustomField-audit `310212e8`-cal landolt (08-20), a futó revízió 08-21 óta áll
    -> tehát a nulla azt jelentette: „nyolc napja semmi", NEM azt, hogy „soha"

**És ez ROSSZABB a retenciónál, nem enyhébb:** egy retenciós ablak KIMONDOTT politika, utána lehet
nézni. Egy naplózás KEZDŐ DÁTUMÁT a git történetéből kell kiásni, és **semmi nem utal rá az
eredményben.** Aki a családot betű szerint veszi, egy audit-nullát „soha nem történt meg"-nek olvas.

*(A javítás didié, és a megtalálás oka is tanulságos: nem gyanú vezette, hanem hogy a TÁGÍTÁS az
enyém volt, a MÉRÉS pedig az övé -- **egy koordinátori általánosítás a mérő nevében utazik.**)*

**A MÉRT ESET:** a kérdés az volt, hány ütemezett email veszett el egy hónap alatt. A válasz NULLA,
és nem „innen nem mérhető" nulla: a tábla SOHA nem tartalmazott egyetlen sort sem.

**A KIMONDOTT HATÁR, ami nélkül ez többet állítana:** egy `TRUNCATE ... RESTART IDENTITY` vagy egy
kézi `ALTER SEQUENCE` ugyanígy nézne ki. A szekvenciából ez nem zárható ki -- de a kódban NINCS
törlési út (a `remove()` `CANCELLED`-et ír), tehát kézi beavatkozás kellett volna hozzá.

*(És a mérés ELŐTT feltett kérdés döntötte el, hogy egy szám egyáltalán becsületes-e: mi ÍRJA az
oszlopot. Itt a `scheduledAt` csak `PENDING` állapotban és csak JÖVŐBELI időre módosítható, törlés
nincs -- tehát egy kimaradt email PENDING marad múltbeli időponttal. **Az állapot MEGŐRZI a rést
ahelyett, hogy felülírná**, ami az `accountantFeedToken` alak FORDÍTOTTJA -- és ezért volt itt szám.)*

**A gyakorlati szabály: mielőtt egy oszlopra HASZNÁLAT-TÖRTÉNETI kérdést teszel fel, nézd meg, mi
ÍRJA azt az oszlopot.** Ha bármi vissza tudja állítani `NULL`-ra vagy felül tudja írni, akkor a
kérdésedre nem tud válaszolni, akármilyen tiszta a mérés. A történethez audit-tábla vagy
esemény-napló kell; ha nincs, a helyes válasz nem egy szám, hanem az, hogy **ez innen nem
mérhető**.

**ÉS AZ IRÁNY, AMI EZT VESZÉLYESSÉ TESZI:** a nulla a KÉNYELMES választ támasztja alá („senki nem
használja, kivehetjük"), és pont az az állítás, amit a mérés nem tud alátámasztani. didi
megfogalmazása: *a legerősebb kiveteli érv az, amit ez a mérés nem tud alátámasztani, mert a
bizonyítékát törölhetőnek tervezték.*

*(A mérés attól jó, hogy ezt a korlátot a FUTTATÁS ELŐTT mondta ki, nem utólagos mentségként. Egy
mérés, ami megmondja, mire NEM jó, többet ér, mint egy, ami többet állít.)*

**ÉS A MÁSODIK SZÁM, AMIT NEM KÉRTEM, DÖNTÖTTE EL A KÉRDÉST:** ugyanabban a tranzakcióban
`SavedView.dataFeedToken` -> **12 élő token**. Ugyanaz a képesség, másik entitáson, teljesen
bekötve. Vagyis nem az volt igaz, hogy „senki nem akar adatfolyamot", hanem hogy „az egyik alakot
használják, a másikat nem" -- és ez ellentétes döntéshez vezet. **Egy nulla melletti kontroll ne
csak azt igazolja, hogy a számlálás működik: mérje meg a TESTVÉR-esetet is, ha van.**

## EGY KONZOLBAN BEALLITOTT ENV-VALTOZO SZERKEZETILEG ATMENETI -- A KOVETKEZO DEPLOY ELDOBJA
## (didi merte 2026-09-03, `deploy.yml` @ a62ba2c1; kartya `6da18d22`)

    :311      `--env-vars-file=/tmp/backend-env.yaml`        <- a TELJES sima env-keszletet CSERELI
    :312-319  8 x `--update-secrets=NEV=secret:latest`       <- ezek MERGE-elnek

**A sima valtozok halmaza a FAJL, nem a delta.** Amit valaki a Cloud Console-ban allit be, azt a
kovetkezo pipeline-deploy eldobja -- es a lejarat esemenye egy SIKERES TELEPITES, nem hiba. A
secret-hivatkozasok TULELIK; a sima valtozok nem.

**A MERT PELDANY:** a Gmail-integracio harom valtozoja (`EMAIL_TOKEN_ENCRYPTION_KEY`,
`GOOGLE_EMAIL_CLIENT_ID`, `_SECRET`) PONTOSAN KET revizion letezett -- mindketto kezzel inditott
konzol-telepites 2026-01-24-en --, es a kovetkezo pipeline-futas kivette. Cenzus mind a 317
reviziora; kontroll: `DATABASE_URL` 315/317. **Es a „csak a gcloud-revizion" halmaz URES**, tehat a
pipeline env-keszlete SZIGORU RESZHALMAZ: ez a bizonyitek a mechanizmusra.

**ES A HAROM SOSEM VOLT A PIPELINE-BAN:** az env-fajl egy HARDCODED heredoc (:213-222), es a
workflow SAJAT kommentje (:223-226) mondja ki, hogy titok oda NEM valo -- a helyuk a Secret Manager
+ `--update-secrets`. A Secret Managerben tiz titok van, es egyik sem ez a harom (kontroll: a
`deploy.yml` altal hivatkozott 8-bol 4 ellenorizve, mind jelen).

**A gyakorlati szabaly ket iranyba:**

    ha egy valtozo ELTUNT elesbol .... ne a konzolban „allitsd vissza" -- ugyanugy el fog tunni.
                                       A pipeline env-fajljaba VAGY a Secret Managerbe valo, es a
                                       `CANDIDATE_VARS` or-listat (:124-145) is szinkronban kell tartani.
    ha egy funkcio SOSEM mukodott .... nezd meg, be volt-e egyaltalan kotve a SZALLITASBA.
                                       A „elromlott" es a „sosem lett kesz" kivulrol AZONOS.

**ES EGY KOVETKEZMENY, AMI NEM VISSZAFORDITHATO:** a regi titkositasi kulcs SEHOL nincs meg (sem a
forrasban, sem egyetlen revizio envjeben, sem a Secret Managerben). Egy uj kulcs beallitasa ezert
ROTACIO, nem helyreallitas -- a januari kapcsolat nem fejtheto vissza, az ut az UJRAKOTES. A ket
OAuth-ertek viszont ujra kiadhato a Google-nal.

*(Ugyanaz az alak, mint a marveen-lap OTODIK ALLAPOTA -- el es fut, de nincs verziozva --, csak a
kornyezeti valtozokon, es ott rosszabb: nem `git clean` viszi el, hanem egy normalis telepites.)*

### ES A KAPU, AMI EZT NYOLC HONAPIG NEM VETTE ESZRE, NEM ELROMLOTT: A MASIK IRANYBA NEZ
### (didi merte 2026-09-03, ugyanaz a kartya)

A `deploy.yml` `CANDIDATE_VARS` ore igy mukodik:

    SENSITIVE_REGEX='(_SECRET|_PASSWORD|_TOKEN|_PRIVATE_KEY|DATABASE_URL|...)'
    minden CANDIDATE_VARS elemre: ha a NEVE illeszkedik -> serules, exit 1

**A populacioja az, AMI MAR BENNE VAN az env-fajlban.** Azt kerdezi, hogy „titok-alaku nevet
adunk-e at nyiltan", es arra HELYESEN blokkol. Azt SZERKEZETILEG nem tudja kerdezni, hogy „hianyzik-e
egy szukseges valtozo".

**A legelesebb resz:** az `EMAIL_TOKEN_ENCRYPTION_KEY` illeszkedik a `_TOKEN`-re, a
`GOOGLE_EMAIL_CLIENT_SECRET` a `_SECRET`-re. **Ha barki BETETTE VOLNA oket az env-fajlba, az or
MEGALLITOTTA VOLNA a deployt.** Mivel senki nem tette be sehova, az or nema.

    egy titok ROSSZ HELYEN ... az or blokkol
    egy titok, ami HIANYZIK .. az or nem latja, KONSTRUKCIOBOL

**A tagabb alak, es ez az, ami atviheto:** egy or, ami a ROSSZ HELYEN levo dolgot blokkolja, nem
mond semmit a HIANYZO dologrol -- es a ket kerdes annyira hasonlit, hogy a kapu megletet konnyu
lefedettsegnek olvasni. Aki azt kerdezi, „van-e or a titkokra?", IGENT kap. Aki azt, „szolna-e, ha
egy titok hianyzik?", NEM-et -- de ezt a masodik kerdest senki nem teszi fel.

**HAROM FUGGETLEN JELZO-UT VOLT, ES MIND A HAROM SZERKEZETILEG NEMA erre az esetre:**

    a pipeline-kapu ..... a masik iranyba nez (fent)
    a boot-naplo ........ mind a 317 induláson tuzelt, es nem valtoztatott semmin
    a beallitasi panel .. rossz csatornara van kotve (`lastError` kontra `lastSyncError`),
                          es amugy sem lett volna mit mutatnia

Nem balszerencse: harom kulon mechanizmus, mindharom a MEGLEVO dolgokrol kerdez.

*(didi kimondott hatara: a `rollback.yml` „orokli a konfiguraciot" allitas a gcloud dokumentalt
viselkedesen es a HIANYZO kapcsolokon all, nem egy megfigyelt rollback-futason -- es azt sem merte,
hogy futott-e valaha.)*

## EGY JAVITAS, AMI EGY BUKAST ATSOROL ERROR-ROL WARN-RA, MINDEN SEVERITY-SZURESU RIASZTAST
## MEGVAKIT -- ES A JAVITAS KOZBEN EZ SIKERNEK LATSZIK (jarvis merte 2026-09-03, kartya afdd2bd7)

    a javitas elott ... SET NX hiba, ERROR szinten .............. 255 / ora
    a javitas utan .... ugyanaz ................................... **0**   <- a javitas MUKODIK
    ES UGYANOTT ....... `fetch failed`, WARN szinten ............ ~235 / ora, VALTOZATLAN

**Ugyanaz a bukas, uj osztalyban.** A Redis-reteg tovabbra is oranként tobb szazszor bukik -- csak
mostantol WARN-kent. **Egy `severity>=ERROR` szuro NULLAT olvas egy retegen, ami 200+ alkalommal
bukik oranként.**

**AZ IRANY AZ, AMIERT EZ VESZELYES:** a javitas merese HELYES es a szam VALODI (255 -> 0). Aki a
javitast ellenorzi, pontosan azt latja, amit vart -- es a MASIK szam, ami valtozatlan maradt, egy
MASIK szuroben all, amit senki nem nez ugyanabban a korben.

**A GYAKORLATI SZABALY, es a javitas oldalarol szol, nem a monitorozaseról:** ha egy javitas egy
hiba SULYOSSAGAT vagy OSZTALYAT valtoztatja meg (ERROR -> WARN, dobas -> visszateresi ertek,
kivetel -> naplosor), akkor **a javitas resze annak kimondasa, hogy MELYIK RIASZTAS VAKUL MEG TOLE**.
Egy „a hibak szama nullara esett" mondat sulyossag-atsorolas utan nem allitas.

*(Ugyanaz a csalad, mint a nema siker: ott egy muvelet nem csinal semmit es sikert jelent; itt egy
muvelet ELVEGZI a dolgat, es kozben elnemit egy jelzot, ami MAS dologrol szolt volna.)*

## EGY MUSZER, AMI CSAK A BUKASNAL NAPLOZ, SOHA NEM TUDJA MEGMONDANI, HOL A KUSZOB
## (dexter tervezesi dontese, 2026-09-03, kartya e9c48aab)

Egy zar-TTL-t kellett megvalasztani, es a hianyzo bemenet a FUTAS-IDOTARTAM volt. A kezenfekvo
muszer: naplozd az idotartamot, AMIKOR tullepi a TTL-t.

**Ez CENZURALT MINTA, es szerkezetileg hasznalhatatlan a feladatra.** Pontosan azokat a futasokat
mintavetelezi, amik MAR meghaladtak a jelenlegi kuszobot -- vagyis soha nem mutatja meg, hol ul a
futasok TOMEGE, es epp abbol kellene a kuszoböt szarmaztatni.

    csak tullepeskor naplozva ... a minta a kuszob FOLOTT kezdodik -> a mediant nem lathatod
    FELTETEL NELKUL naplozva .... a teljes eloszlas -> a maximum ES a median is kiolvashato

**A mutacio, ami ezt rogziti:** allitsd at a naplozast `runMs > ttl` feltetelesre -> ket teszt PIROS.
Plusz egy KONTROLL: egy KIHAGYOTT tick NEM ir idotartamot -- a nullak azokra a tickekre, ahol a
fuggveny le sem futott, lefele huznak az eloszlast, tehat epp a rossz iranyba.

**A tagabb alak, es ez az, ami atviheto:** ha egy muszert azert epitesz, hogy egy KUSZOBOT valassz
belole, akkor a muszer nem szurhet a kuszobre. Ugyanez all a lassu lekerdezesek naplozasara
(`slow query log`), a hiba-aranyokra es minden olyan mereszre, ahol a kerdes az, hogy HOL huzzuk meg
a hatart.

**ES A SZINT IS MERESI DONTES, NEM STILUS:** a sor `debug`, mert a TESTVER sora (`already held`) is
az, es azt a Cloud Run naplokban mar szamoltak -- tehat konfiguracio-valtoztatas nelkul lekerdezheto.
A volumen kimondva: ~600 sor/ora az EVERY_MINUTE keszletbol. Ha ez sok, az DONTES, nem hiba -- de a
szam ismereteben kell meghozni.

**ES EGY SORREND-CSAPDA, AMI EZT AZ EGESZET ELNEMITANA:** a `LOG_LEVEL` deklaralva van az
`env.validation`-ben es dokumentalva a `.env.example`-ben, de **NULLA fogyasztoja van** -- a
`NestFactory.create` nem kap logger-opciot (kontroll: a `SENTRY_DSN` deklaralva ES fogyasztva, tehat
a mero latja a fogyasztast, amikor van). Ma ez KEDVEZ nekunk: ezert er el a `debug` a naplokba.
**Ha barki bekoti a `LOG_LEVEL`-t, mikozben az alapertelmezes `info` marad, a debug sorok eltunnek --
koztuk EZ a muszer ES az `already held` sor, amire egy mai meres tamaszkodik.** Kartya: `b7c38ec5`.

## Database Migrations

When writing database migrations:
- Always make migrations idempotent (use IF NOT EXISTS for enums/tables, handle pre-existing data)
- Check for orphaned FK references before adding constraints
- Clean up orphaned data as part of the migration when necessary
- Test migrations against a database that already has production-like data, not just empty schemas
- Production deploy: `npx prisma migrate deploy` (not `prisma migrate dev`) -- **run by the deploy
  pipeline, NOT by hand.** An agent writing a migration writes the SQL file and commits it; the
  `migrate deploy` runs in `deploy.yml`. This matters twice over: the backend reads the LIVE `.env`
  by default (card 4a5509c7), so a hand-run `migrate` would hit production; and the real control
  point is therefore the MERGE, not the commit -- which is where the review has to happen.
  `npx prisma generate` is safe to run locally and does not touch any database.
  **DE EZ EGY TENGELYRE IGAZ, ÉS TENGELY NÉLKÜL OLVASÓDIK** (dexter mérte 2026-08-28): az
  ADATBÁZIS-tengelyen teljes, a FÁJLRENDSZER-tengelyen nem. Mérve: **41 worktree, 29 symlinkelt
  `node_modules`, ebből 28 UGYANARRA a célra** -- tehát a generált kliens KÖZÖS. Egy `generate`
  egy be nem olvasztott ágon MINDENKI kliensét átírja, és a kár néma: a `tsc` átengedi azt a
  mezőt, amit a kliens ismer és a te sémád nem.
  A megosztás SZÁNDÉKOS (28 azonos symlink nem véletlen), és nem javasoljuk a megszüntetését --
  a hiány az volt, hogy a kockázata sehol nem állt leírva. Aki séma-függő állítást tesz, előbb
  nézze meg, MELYIK fából generálódott a kliens (`node_modules/.prisma/client/schema.prisma`
  mtime + normalizált összevetés a saját sémájával -- NYERS HASH-t ne használjon, az a
  formázáson is eltér). Kártya: `51856a6a`.

  **ÉS A KIÚT, AMI EDDIG NEM ÁLLT ITT: A LAP A VESZÉLYT ÍRTA LE, A MEGKERÜLÉSÉT NEM** -- egy
  tiltás kiút nélkül addig tart, amíg valakinek tényleg generálnia kell. dexter csinálta meg
  élesben (2026-09-04, `fedd2d7f`: séma-mező hozzáadása egy worktreeből):

      NE a megosztott `node_modules`-ba generálj. Építs a worktreenek SAJÁT `.prisma` +
      `@prisma` másolatot, generálj oda, és a munka végén takarítsd el.

  **ÉS A BIZONYÍTÉK NEM AZ, HOGY ÓVATOS VOLTÁL, HANEM EGY ELŐTTE-UTÁNA MÉRÉS:** a MEGOSZTOTT
  kliens séma-hasht ellenőrizd a generálás ELŐTT és UTÁN, majd a takarítás után MÉG EGYSZER.
  Mind a háromnak azonosnak kell lennie. Enélkül a „nem nyúltam hozzá" állítás, nem mérés --
  és pont ez az a kár, ami NÉMA: huszonhat ágens kliense íródik át, és semmi nem szól.

  *(A `tsc` ezt szerkezetileg nem fogja meg: átengedi azt a mezőt, amit a kliens ismer és a
  te sémád nem. Tehát a hibás állapot ZÖLD fordítást ad -- a felfedezése egy MÁSIK ágens
  értelmetlen hibájából jön, órákkal később.)*
- Prisma schema: **112** models (mérve 2026-08-22 -- `grep -c '^model ' schema.prisma`; a korábbi 92-es szám két helyen is elavult volt), all multi-tenant with `organizationId`

### A migrációs checklist grepjei ELŐBB csupaszítsák a kommenteket (mérve, 2026-08-22)

Az alábbi checklistek mind `grep`-elik a migrációs SQL-t (`DROP COLUMN`, `CREATE TYPE`,
`SET NOT NULL`, `ADD CONSTRAINT ... FOREIGN KEY`, `INSERT INTO`). Egy dolgot egyik sem mond ki,
és 2026-08-22-én meg is fogott valakit: **a grep a KOMMENTBEN is talál.**

A mért eset: egy egysoros, additív migráció (`ADD COLUMN "retryCount" INTEGER DEFAULT 0`) mellé a
szerző odaírta kommentben, hogy a migráció *nem* csinál `DROP COLUMN`-t és *nem* tesz
`SET NOT NULL`-t. A checklist mindkettőre 1-1 találatot adott — **a saját dokumentációjára**.
Kommentek nélkül újramérve mind az öt minta nulla.

A helyes forma bármelyik ellenőrzéshez:

```bash
# csupaszítsd a kommenteket ELŐSZÖR, aztán grepelj -- SORTARTÓ módon
sed -E 's/--.*$//' prisma/migrations/<latest>/migration.sql \
  | perl -0777 -pe 's{/\*.*?\*/}{ $x = $&; $x =~ s/[^\n]//g; $x }gse' \
  | grep -nE 'DROP COLUMN|SET NOT NULL'
```

**A `perl` kifejezés SZÁNDÉKOSAN bonyolultabb a kézenfekvőnél, és ez mért defektus-javítás
(2026-08-23).** Korábban `s{/\*.*?\*/}{}gs` állt itt -- az a blokk-kommentet ÜRESRE cseréli, tehát
**megeszi a benne lévő sortöréseket**. A parancs vége viszont `grep -n`, ami épp SORSZÁMOT ad:
minden blokk-komment után a kiírt sorszám ELCSÚSZIK, annyival, ahány sor a kommentben volt.

Minimális reprodukció (mérve, nem levezetve):

```bash
t=$(mktemp)   # NE /tmp/t.txt: a /tmp kozos, es ezt a nevet EPP EZ A SOR terjeszti
printf 'a\n/* x\n y */\nb\n' > "$t"
grep -n 'b' "$t"                                   # 4:b      <- az igazság
... | perl -0777 -pe 's{/\*.*?\*/}{}gs'    | grep -n 'b'  # 3:b      <- a RÉGI recept
... | perl -0777 -pe 's{...}{ ... }gse'      | grep -n 'b'  # 4:b      <- a mostani
```

A javított alak a komment helyére UGYANANNYI sortörést tesz vissza, tehát a szöveg eltűnik, a
sorszámozás marad.

**Miért itt a legdrágább:** ez a szakasz pont arról szól, hogy egy ellenőrzés ne a saját
magyarázatára riadjon -- és a hozzá adott recept közben egy MÁSIK néma hibát vezetett be, egy
olyat, ami nem hamis riasztást ad, hanem HELYES találatot ROSSZ helyre mutat. Az első fajtát
észreveszi az ember (megnézi, és nincs ott semmi); a másodikat nem, mert a találat valódi, csak
két sorral arrébb.
(Dexter mérte magán, ma másodszor ugyanazzal a hibával -- ezért került ide a recept mellé.)

A repó ezt a csapdát **már ismeri**: a controller-permissions parser `codeOnly()` függvénye
pontosan ezért csupaszít kommentet, mielőtt mintát keres. A migrációs checklist ugyanezt kívánja.

**ÉS UGYANEZ A PARSER KÉT TOVÁBBI CSAPDÁT REJT, MINDKETTŐ A RIASZTÓ IRÁNYBA -- aki jogosultsági
cenzust ír, ezt olvassa el előbb** (dexter mérte magán 2026-08-29, marveen függetlenül
újramérte).

**1. A `grep "@RequirePermission"` TISZTA NULLÁT ADHAT EGY TELJESEN KAPUZOTT KONTROLLERRE.**
Mérve: `workflows.controller.ts` -> `@RequirePermission` **0**, `@CanManageWorkflows` **23**.
A modul ALIAS-DEKORÁTORON keresztül kapuz, amit a névre kereső minta szerkezetileg nem lát --
és az osztály-szintű padlót sem, amit a `PermissionGuard` ténylegesen olvas. A helyes mérő a
repó saját parsere: `common/testing/controller-permissions.ts`, `controllerRoutes(file)` --
az feloldja az aliasokat és az osztály-szintű fallbacket is.

**2/b. ÉS A `requirements` MEZŐ MAGA IS ALULMÉRT 2026-09-04-IG -- AKI EZZEL CENZUST FUTTATOTT,
OLVASSA EL** (dexter mérte és javította; marveen újramérte a guardon).

A mező MINDEN jogosultsági dekorátort EGY listába lapított, és EGYETLEN, ÚTVONALANKÉNTI felülírást
alkalmazott. **A guard nem így működik** -- a `permission.guard.ts` KÉTSZER old fel, KÉT kulcsra,
és MINDKETTŐT megköveteli, két külön `if`-ben:

    :43  `requiredAny = reflector.getAllAndOverride(...)`   PERMISSIONS_KEY      (ANY)
    :47  `requiredAll = reflector.getAllAndOverride(...)`   PERMISSIONS_ALL_KEY  (ALL)

**A felülírás KULCSONKÉNTI, nem útvonalankénti.** Egy saját ANY-jogosultsággal rendelkező útvonal
felülírja az osztály ANY-ját, és KÖZBEN ÖRÖKLI az osztály ALL-ját.

**AZ IRÁNY ALULMONDÁS VOLT, ÉS EZÉRT NEM FOGTA MEG SEMMI:** a mező soha nem adott egy útvonalnak
TÖBBET, mint amije van -- KEVESEBB kaput mutatott, mint amennyit a guard érvényesít. **És egy
fogyasztónak, aki azt kérdezi „van-e követelmény", a „nincs kapu" és a „kevesebb kapu" UGYANAZ AZ
ÉRTÉK.**

    útvonal, aminek a MODELLJE változik ..... 5
    ebből csak SORREND ..................... 3
    **ÉRDEMI ............................... 2**  (reports POST `:id/export/csv` és `/pdf`)
        RÉGI `[data:export]` -> ÚJ `[reports:read, reports:manage, data:export]`

**ÉS EZ A RÖGZÍTETT MAGYARÁZATA EGY ADDIG ELSZÁMOLATLAN MÉRÉSNEK:** a reports export-követelményt
egyszer eltávolítva **469 teszt maradt zöld**. Az útvonalnak így is, úgy is „volt követelménye".

**A MÁSODIK EREDMÉNY A FONTOSABB: EGYETLEN függő specet sem kellett igazítani** -- mind a 16, ami a
mezőt olvassa, változatlanul átment (251 teszt). Mindegyik azt kérdezi, hogy LÉTEZIK-e követelmény,
vagy hogy egy KONKRÉT pár jelen van-e; **egyik sem kéri a PONTOS HALMAZT.** Vagyis egy megosztott
mérő tévedhet tizennégy dekorátor-előforduláson, és elrejtőzhet kilenc lefedettségi állítás mögött,
mert egyik állítás sincs úgy alakítva, hogy észrevegye.

**AMIT EGY MEGLÉVŐ CENZUSSAL TENNI KELL:**

    „hány útvonalnak NINCS követelménye"  ->  a számod ÁLL (az alulmondás sosem adott üres listát)
    PONTOS halmazok összevetése           ->  ÚJRA
    bármi a `requirements`-ből a clients / forms / saved-views / accountant-export / reports
      kontrollereken                      ->  ÚJRA

Az `anyRequirements` és az `allRequirements` ÚJ mezők, és külön viszik a két felet; az
`ownRequirements` / `classRequirements` megtartja a régi, lapos jelentését.

**2. ÉS A PARSER MEZŐNEVE `requirements`, NEM `permissions` -- a rossz olvasat NÉMÁN ÜRESET AD.**
Mérve: a fájlban a `permissions` szó **nulla**szor fordul elő; a mezők `requirements`,
`ownRequirements`, `classRequirements`. Egy `.permissions` olvasás tehát `undefined`, az pedig
„nincs követelmény"-ként olvasódik.

**EZ ROSSZABB, MINT A GREP, ÉS EZÉRT ÁLL ITT KÜLÖN:** a hibás grep legalább egy kézi mintáról
szól. A rossz mezőnév a REPÓ SAJÁT ESZKÖZÉNEK a tekintélyével ad hamis nullát -- dexter „4/4
nincs követelmény"-t kapott egy kontrollerre, amit egy korábbi kör TELJESEN KAPUZOTTKÉNT mért,
és a célon egyedül futtatva 37/37 kapuzatlant jelentett volna.

**A KONTROLL, AMI MINDKETTŐT MEGFOGJA, ÉS EGY SOR:** tegyél egy ISMERTEN KAPUZOTT kontrollert
UGYANABBA a futásba. Ha arra is „nincs követelmény" jön, a mérőd rossz -- nem a kód.
*(Ez fogta meg dextert; nem a figyelem. És friday ugyanezen a napon SZÁNDÉKOSAN visszatartott egy
„703-ból 481 kapuzatlan" rangsort, mert ugyanezt az alakot gyanította benne -- helyesen.)*

**Miért nem kozmetikai:** egy hamis pozitív itt arra tanít, hogy a checklist zaj — és a következő
igazi találatot is annak fogja nézni valaki. Egy ellenőrzés, ami a saját magyarázatára riaszt,
pontosan azt a bizalmat éli fel, amiért létezik.

### Destructive column changes (MANDATORY pre-commit review)

**Never** commit a migration that contains `DROP COLUMN "x"` followed by `ADD COLUMN "x" <type> NOT NULL` on the same column. Postgres does not cast — existing data is permanently discarded. This happened once (D-204, `20251030205654_change_value_to_json`, `CustomFieldValue.value`) and went unnoticed at review.

When Prisma auto-generates this pattern (typically from a `@db.Text` → `@db.Json` or similar type change on a required column), hand-edit the SQL to the safe conversion pattern:

```sql
-- 1. Add new column as NULLABLE (so the ALTER doesn't fail on existing rows):
ALTER TABLE "<table>" ADD COLUMN "<col>_new" <new_type>;
-- 2. Backfill with an explicit cast (custom logic if types are not directly castable):
UPDATE "<table>" SET "<col>_new" = "<col>"::<new_type>;
-- 3. Drop old, rename new:
ALTER TABLE "<table>" DROP COLUMN "<col>";
ALTER TABLE "<table>" RENAME COLUMN "<col>_new" TO "<col>";
-- 4. Enforce NOT NULL only after data is migrated:
ALTER TABLE "<table>" ALTER COLUMN "<col>" SET NOT NULL;
```

Pre-commit checklist for any migration SQL file:
1. `grep -n "DROP COLUMN" prisma/migrations/<latest>/migration.sql` — must be zero hits, OR every hit must be accompanied by a preceding rename/backfill block, OR the column is being removed on purpose.
2. If Prisma inserts a "Warnings:" comment at the top of the file mentioning the column would be dropped and recreated → **rewrite the migration by hand** before committing.

### `CREATE TYPE` enum idempotency (MANDATORY pre-commit review)

**Never** commit a new migration with a bare `CREATE TYPE "X" AS ENUM (...)` statement. Bare `CREATE TYPE` is non-idempotent — re-running the migration on an already-applied database (Supabase preview branch, CI fresh-DB initialization, dev reset, disaster-recovery replay) errors with `type "X" already exists` and aborts the entire migration mid-way, leaving the schema in a partial state. This pattern exists in **72 historic migration statements across 32 files** (audit-2026-04 D-200/D-201). Those are not retroactively edited because (a) they already applied successfully to prod and (b) editing them changes the Prisma `_prisma_migrations.checksum` and triggers drift on `migrate deploy`.

Going forward, every new `CREATE TYPE` must be wrapped in a `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$` block:

```sql
-- BAD — bare CREATE TYPE (Prisma's default output):
CREATE TYPE "MyEnum" AS ENUM ('A', 'B', 'C');

-- GOOD — idempotent on replay:
DO $$ BEGIN
    CREATE TYPE "MyEnum" AS ENUM ('A', 'B', 'C');
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

The same wrapper applies to `ALTER TYPE ... ADD VALUE` (use `IF NOT EXISTS` from PG12+ instead, e.g. `ALTER TYPE "MyEnum" ADD VALUE IF NOT EXISTS 'D';`). Use `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` for the same reason — Prisma already does this correctly for tables/indexes; the `CREATE TYPE` case is the systemic gap.

Pre-commit checklist for any new migration SQL file:
1. `grep -nE '^[[:space:]]*CREATE TYPE' prisma/migrations/<latest>/migration.sql` — every hit must be inside a `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object` block. Bare `CREATE TYPE` outside such a wrapper is a blocker.
2. `grep -nE '^[[:space:]]*ALTER TYPE.*ADD VALUE' prisma/migrations/<latest>/migration.sql` — every hit must use `ADD VALUE IF NOT EXISTS '...'` (PG12+ syntax).

### FK constraint addition with orphan cleanup (MANDATORY pre-commit review)

**Never** commit a migration that adds an `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` to an existing column on a table with pre-existing rows without first deleting/repointing orphaned references. If any row in the child table has a foreign-key value that doesn't exist in the parent table, the `ADD CONSTRAINT` aborts the entire migration with `violates foreign key constraint`, and the row remains visible to application code in the meantime. This pattern exists in audit-2026-04 D-206 (`20260102211100_add_logo_and_email_signature_fields/migration.sql`, `UserRoleAssignment_organizationId_fkey`) — that migration ran successfully on prod by luck (no orphans existed), but the pattern is unsafe.

The same applies to `ALTER COLUMN ... SET NOT NULL` on a previously-nullable column: if any row still has `NULL` after the backfill `UPDATE`, the `SET NOT NULL` aborts. Always populate first, then **explicitly** delete or default-fill the residual nulls before tightening the constraint.

Going forward, every new FK addition or NOT NULL tightening on existing data must include an explicit cleanup step:

```sql
-- 1. Backfill from related table (idempotent — only touches rows that need it):
UPDATE "Child" c
SET "parentId" = p.id
FROM "Parent" p
WHERE c."someJoinKey" = p."someJoinKey" AND c."parentId" IS NULL;

-- 2. Explicit orphan cleanup — choose one based on business rules:
DELETE FROM "Child" WHERE "parentId" IS NULL;
-- OR pick a sentinel parent row:
-- UPDATE "Child" SET "parentId" = (SELECT id FROM "Parent" WHERE "isSystem" = true LIMIT 1) WHERE "parentId" IS NULL;

-- 3. Now safe to tighten:
ALTER TABLE "Child" ALTER COLUMN "parentId" SET NOT NULL;

-- 4. FK constraint guarded against re-runs:
DO $$ BEGIN
    ALTER TABLE "Child"
      ADD CONSTRAINT "Child_parentId_fkey"
      FOREIGN KEY ("parentId") REFERENCES "Parent"(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

Pre-commit checklist for any new migration SQL file:
1. `grep -nE 'ADD CONSTRAINT.*FOREIGN KEY' prisma/migrations/<latest>/migration.sql` — for every hit on an FK added to a column on an existing table, verify a preceding `DELETE FROM "<child>" WHERE "<fk>" IS NULL` (or repoint UPDATE) is present, OR the column was added in this migration as fresh-empty (no rows can be orphaned), OR the FK is on a brand-new table created in this migration.
2. `grep -nE 'ALTER COLUMN.*SET NOT NULL' prisma/migrations/<latest>/migration.sql` — for every hit on a previously-nullable column, verify the residual nulls are explicitly handled (deleted, defaulted, or backfilled to completion) directly above the `SET NOT NULL`.

### Seed `INSERT` idempotency (MANDATORY pre-commit review)

**Never** commit a migration that contains a seed `INSERT INTO ...` without an `ON CONFLICT DO NOTHING` (or `ON CONFLICT ... DO UPDATE ...` when an upsert is the intent) clause. Seed INSERTs without conflict handling fail with `duplicate key value violates unique constraint` on every replay scenario: Supabase preview branches, Cloud SQL clone-restores, dev `prisma migrate reset`, CI fresh-DB initialization, or a disaster-recovery replay against a partially-restored database. The failure aborts the entire migration, leaving the schema in a partial state. This pattern exists in audit-2026-04 D-208 (`20251216_add_status_group_config/migration.sql:43`, four `INSERT INTO "StatusGroupConfig" ... SELECT FROM "Product"` blocks against a `(name, productId)` unique index). That migration ran successfully on prod by luck (the `_prisma_migrations` lock prevented a second run, and the unique constraint was effective), but the pattern is unsafe on any non-tracked replay.

Going forward, every new seed INSERT must declare its conflict policy:

```sql
-- BAD — bare INSERT, fails on replay against a partially-seeded DB:
INSERT INTO "StatusGroupConfig" ("name", "productId", ...)
SELECT 'LEAD', p.id, ... FROM "Product" p WHERE p."deletedAt" IS NULL;

-- GOOD — explicit no-op on conflict (use when the seed is "create if missing"):
INSERT INTO "StatusGroupConfig" ("name", "productId", ...)
SELECT 'LEAD', p.id, ... FROM "Product" p WHERE p."deletedAt" IS NULL
ON CONFLICT ("name", "productId") DO NOTHING;

-- ALSO GOOD — explicit upsert (use when the seed must rewrite stale defaults):
INSERT INTO "StatusGroupConfig" ("name", "productId", "label", ...)
SELECT 'LEAD', p.id, 'Lead', ... FROM "Product" p WHERE p."deletedAt" IS NULL
ON CONFLICT ("name", "productId") DO UPDATE SET "label" = EXCLUDED."label";
```

Pre-commit checklist for any new migration SQL file:
1. `grep -nE '^\s*INSERT INTO' prisma/migrations/<latest>/migration.sql` — every hit must have a matching `ON CONFLICT` clause within the same statement (look ahead up to ~15 lines for multi-line `SELECT` blocks). Bare `INSERT INTO` outside such a clause is a blocker. Exception: an INSERT into a table that was `CREATE TABLE`'d **in the same migration file** with a DEFAULT-empty starting state is acceptable (no rows can pre-exist), but prefer `ON CONFLICT DO NOTHING` anyway for replay-safety.
2. If the destination table has no unique constraint to target, either add one in the same migration (preferred — gives the seed an idempotency anchor) or wrap the INSERT in a `WHERE NOT EXISTS (SELECT 1 FROM "<table>" WHERE ...)` guard. Do not commit a seed INSERT that has no idempotency story at all.

### `CREATE TABLE` idempotency (MANDATORY pre-commit review)

**Never** commit a new migration with a bare `CREATE TABLE "X" (...)` statement. Bare `CREATE TABLE` is non-idempotent — re-running the migration on an already-applied database (Supabase preview branch, CI fresh-DB initialization, dev `prisma migrate reset` race, disaster-recovery replay) errors with `relation "X" already exists` and aborts the entire migration mid-way, leaving the schema in a partial state. Modern Prisma (5+) **still emits bare `CREATE TABLE`** as of Prisma 6 — verified empirically against 2026-* migration files in this repo. The audit-2026-04 D-207 finding catalogued **82 historic instances across 32 files**; those are not retroactively edited because (a) they already applied successfully to prod, (b) editing them changes the Prisma `_prisma_migrations.checksum` and triggers drift on `migrate deploy`, and (c) the per-migration row in `_prisma_migrations` prevents replay on the same DB. The replay-risk is real on **fresh-DB targets** (preview branches, CI, DR).

Going forward, every new `CREATE TABLE` must use `IF NOT EXISTS`:

```sql
-- BAD — bare CREATE TABLE (Prisma's default output):
CREATE TABLE "MyTable" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    ...
    CONSTRAINT "MyTable_pkey" PRIMARY KEY ("id")
);

-- GOOD — idempotent on replay:
CREATE TABLE IF NOT EXISTS "MyTable" (
    "id" SERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    ...
    CONSTRAINT "MyTable_pkey" PRIMARY KEY ("id")
);
```

Use `CREATE INDEX IF NOT EXISTS` for the same reason — Prisma 5+ **does** emit this correctly for indexes; the `CREATE TABLE` case is the systemic gap. (`ADD CONSTRAINT` is wrapped in the `DO $$ ... EXCEPTION WHEN duplicate_object` block per the FK-addition rule above.)

Pre-commit checklist for any new migration SQL file:
1. `grep -nE '^[[:space:]]*CREATE TABLE [^I]' prisma/migrations/<latest>/migration.sql` — any hit on a `CREATE TABLE` without `IF NOT EXISTS` immediately after the `TABLE` keyword is a blocker. Hand-edit Prisma's auto-generated SQL to insert `IF NOT EXISTS` before commit.
2. `grep -nE '^[[:space:]]*CREATE (UNIQUE )?INDEX' prisma/migrations/<latest>/migration.sql | grep -v 'IF NOT EXISTS'` — any hit is a blocker; it covers both `CREATE INDEX` and `CREATE UNIQUE INDEX`. Prisma normally emits `IF NOT EXISTS` correctly, but verify.
3. **Why this shape and not `CREATE INDEX [^I]`** (the earlier version of this check, corrected 2026-08-19): matching the character after `INDEX` flags `CREATE INDEX CONCURRENTLY IF NOT EXISTS` as a violation, because `C` is not `I` — even though that line is correct and IS the safe form on a large table. Verified: the old pattern reported the new ownership-anchor migration AND two already-shipped CONCURRENTLY migrations (`20260117100000`, `20260218000000`) as blockers. The danger is not the false alarm itself: the obvious way to "fix" a file the checklist rejects is to delete `CONCURRENTLY`, which is exactly what takes a write lock on the table in production. **A checker that marks the correct solution as an error is worse than no checker.** Filter on the missing `IF NOT EXISTS` instead of on the letter after the keyword.
