# PUSH-CEL ES TITOK-KAPU -- ESET-ARCHIVUM

(a `CLAUDE.md` push-szakaszanak kiszervezett bizonyiteka, kartya `c5fcc2b5`; BETURE az eredeti)

---

## HOVÁ MEGY A PUSH -- a `origin` NEM mindig a miénk (Isti szabálya, 2026-08-23)

Isti feloldotta a push-tilalmat, EGY kikötéssel: *„csak arra figyelj, hogy mindig jó helyre… Mindig
nézd meg, hogy mi hová megy."* Ez nem óvatosság: **mérve, mindkét repóban van egy távoli, ami nem
oda való.**

| repó | távoli | mi ez | mehet-e push |
|---|---|---|---|
| `marveen` | `fork` → `balintisti/marveen` | **Isti forkja** | **IGEN, ez az alapértelmezés** |
| `marveen` | `origin` → `Szotasz/marveen` | **IDEGEN upstream projekt** | **NEM.** Csak PR, és csak ha a Marveen rendszernek magának ér valamit |
| Delta-CRM | `origin` → `balintisti/Delta-CRM` | Isti repója | IGEN |
| Delta-CRM | `old-origin` → `balintisti/sajat-crm` | a **régi név**, halott | NEM. Ide pusholni annyi, mint elszórni a munkát |

**A csapda, amiért ez a táblázat létezik:** a marveen repóban a `git push origin <ág>` a
megszokott, ártalmatlan mozdulat -- és **egy idegen, nyilvános projektbe** írna. A `push` szó
ugyanaz, a célpont nem. Aki fejből dolgozik, `origin`-t gépel.

**A szabály tehát nem „vigyázz", hanem: `git push` előtt nézd meg a távolit.**

```bash
git remote -v                      # MELYIK a miénk, és melyik nem
git rev-parse --abbrev-ref '@{push}'   # HOVA MENNE EZ AZ ÁG -- lásd alább, ez a fontosabb
git push fork <ág>                 # marveen: MINDIG a fork
git push origin <ág>               # Delta-CRM: origin -- de NEM a marveenben
```

**A `git remote -v` ÖNMAGÁBAN VAK, és ezt 2026-08-24-ig nem mondtuk ki** (didi találta a
Delta-CRM checkoutban, marveen újramérte egy másik worktreeben; kártya `2862ad06`). A `remote -v`
azt sorolja fel, MILYEN távoliak vannak -- de nem az `origin` dönti el, hova megy a push, hanem
az **ág saját upstreamje**. Mérve: ott a `develop` upstreamje az `old-origin` (a halott repó),
miközben a `remote -v` kimenete tökéletesen rendben van.

Vagyis a szabályt BETARTÓ ágens kap egy megnyugtató kimenetet, és rossz helyre pushol. A védelem
lefut, zöldet mond, és nem véd -- ugyanaz az alak, mint minden más néma siker ezen a lapon.
A `@{push}` arra válaszol, ami a push előtt a tényleges kérdés.

**ÉS UGYANEZ A DELTA-CRM-BEN IS ÁLL, 11:37 ÓTA** (`git config remote.pushDefault origin`).
Jarvis mérte ki a populációt, én újramértem az éles repóban, kontrollal:

| ág | előtte | utána |
|---|---|---|
| `main` (upstream `origin/main`) | `origin/main` | `origin/main` **változatlan** |
| `develop` (upstream `old-origin/develop`, HALOTT) | **`old-origin/develop`** | **hiba** |

A mechanizmus azonos a marveenével, a KÖVETKEZMÉNY nem: ott egy idegen repóba szivárgás, itt
elszórt munka egy halott repóban, ahol senki nem keresi. Jarvis mérése szerint ma HÁROM ág áll
`old-origin`-on név-egyezéssel, de egyiken sincs olyan commit, ami az `old-origin`-ról hiányozna
-- töltött fegyver üres tárral, ugyanaz az alak, mint a marveenben.

**2026-08-27 11:28 ÓTA A CSUPASZ `git push` A MARVEEN REPÓBAN HIBÁRA MEGY, ÉS EZ SZÁNDÉKOS.**
Beállítva: `git config remote.pushDefault fork`. Mérve, pozitív kontrollal, MIELŐTT beállítottam:

| ág | pushDefault NÉLKÜL | pushDefault=fork |
|---|---|---|
| `fix/node-abi-test-gate` (upstream: `fork/...`) | `fork/...` | `fork/...` **változatlan** |
| `develop` (upstream: `origin/develop`, IDEGEN) | **`origin/develop`** | **hiba** |

Vagyis a helyesen beállított ág ugyanúgy működik, a veszélyes eset viszont hangosan elbukik
(`cannot resolve 'simple' push to a single destination`) ahelyett, hogy csendben egy idegen
nyilvános projektbe menne. A `.git/config` közös a worktreekkel, tehát mindenhol hat (ellenőrizve
egy worktreeből is).

**Ha ezt a hibát kapod: NEM elromlott valami. Azt jelenti, hogy az ág upstreamje nem a `fork`.**
A válasz mindig ugyanaz, és eddig is ez volt a szabály: `git push fork <ág>`, explicit remote-tal.

**Miért egy config-sor és nem négy `--unset-upstream`:** friday öt érintett ágat mért ki (a
`develop` plusz négy, összesen 7 saját committal), és azok MÁS ügynökök ágai. Egy `--unset-upstream`
idegen munkafa állapotát írja át menet közben. Ez a sor egyetlen ág konfigját sem érinti, csak a
push CÉLJÁT teszi kimondottá.

**ÉS A CSAPDÁT A SAJÁT AJÁNLOTT RECEPTÜNK TERMELTE** (friday mérte a saját ágán, 2026-08-27,
push közben). A prod-tree-guard hibaüzenete évekig ezt ajánlotta:

    git worktree add ../marveen-wt-<topic> -b <branch> origin/develop

Ez az alak **EGYÜTT beállítja az `origin` upstreamet** az új ágra -- és ebben a repóban az
`origin` a `Szotasz/marveen`, egy **idegen, nyilvános projekt**. Mérve, friday ágán:

    branch.fix/835384e6-wakeup-ket-ut.remote  ->  origin        (Szotasz/marveen)
    branch.fix/835384e6-wakeup-ket-ut.merge   ->  refs/heads/develop

Vagyis **a dokumentált biztonságos szokás hozta létre a hibás konfigurációt**. Nem hanyagságból
keletkezett: pontosan attól, hogy valaki KÖVETTE a lapot.

**És ami megvédett, az nem a figyelem volt:** a `push.default=simple` tagadta meg a pusht, mert
az ág neve nem egyezett az upstream ág nevével. Ha az ágat `develop`-nak hívták volna, **átment
volna egy idegen nyilvános projektbe**. A védelem egy névegyezésen múlt, nem ellenőrzésen.

A helyes alak **SHA-val**, ami egyáltalán nem állít upstreamet:

```bash
git worktree add ../marveen-wt-<topic> -b <branch> "$(git rev-parse HEAD)"
# ha már létrejött rossz upstreammel:
git branch --unset-upstream <branch>
git push fork <branch>          # marveen: MINDIG explicit `fork`, sosem csupasz `git push`
```

A guard üzenete 2026-08-27-én javítva (`scripts/install-prod-tree-guard-hook.sh`), és a fő
checkout telepített hookja is.

**ITT KORÁBBAN AZ ÁLLT, HOGY „a többi worktree hookja a régi szöveget mutatja, amíg a telepítő ott
le nem fut". EZ SZERKEZETILEG HAMIS, és marveen mérte meg 2026-08-28-án, miközben épp a telepítést
akarta végigfuttatni 76 worktreen.** A git a hookokat a KÖZÖS git-könyvtárban keresi, nem a
worktree sajátjában:

    git -C <worktree> rev-parse --git-dir         -> .git/worktrees/<nev>     <- ITT NINCS hooks/
    git -C <worktree> rev-parse --git-common-dir  -> .git                     <- INNEN olvas
    core.hooksPath a 76 worktree közül:  EGYIKBEN SEM állítva (kontroll: a lekérdezés lefut, üres)

Vagyis **egy hook-készlet van, 76 worktreere**. Drift a worktreek között nem tud keletkezni; a
telepítő egyszeri futása a fő checkoutban mindenkire hat. A régi mondat egy nem létező kockázatot
állított, és a „javítása" egy 76 elemű, teljesen fölösleges telepítő-kör lett volna.

*(A drift a KLÓNOK között valós marad -- ott tényleg külön `.git/hooks` van. A worktree és a klón
ebben a kérdésben nem ugyanaz, és a lap eddig összemosta őket.)*

**ITT KORÁBBAN AZ ÁLLT, HOGY „a Delta-CRM repóban NULLA telepített hook van" ÉS HOGY A
`.git/hooks` KIZÁRÓLAG A 14 `.sample` FÁJLT TARTALMAZZA. EZ MA HAMIS** (didi mérte 2026-08-29
04:30, marveen függetlenül újramérte ugyanabban az órában, egy másik ügyből kifolyólag):

    .git/hooks nem-sample:  pre-push  +  pre-push.d/{10-no-force-push-protected,
                                                     20-no-dead-remote, 30-no-push-to-main}
    .sample darab:          14                      <- ez a fele IGAZ volt
    git ls-files scripts/hooks/:  0                 <- és EZ a valódi lelet
    KONTROLL: git ls-files scripts/ -> 7 követett fájl, tehát a mérő lát

Vagyis **HÁROM pre-push őr FUT a Delta-CRM fő checkoutjában, és EGYIKET SEM KÖVETI a repó.**
A `commit-msg` valóban nem létezik.

**AMIÉRT AZ EGÉSZ RÉGI BEKEZDÉS ITT MARAD ÁTÍRVA, NEM TÖRÖLVE:** ennek a szakasznak a CÍME
maga is egy korábbi hamis mondat javítása („AMI EBBŐL KIESETT, MERT A HAMIS MONDAT ELFEDTE"),
és azóta a JAVÍTÁS ment hamisba. Ez a lap legdrágább alakja, mert a javított mondat hitelesebb,
mint az eredeti volt.

**ÉS MÉRT ÁRA VAN:** dexter 2026-08-28-án ebből a sorból vette a `7a6bd310` kártya CÍMÉT --
„NULLA telepített git-hook van" --, mérés nélkül, és két órával később maga helyesbítette. A
helyesbítés a kártyán áll; a hamis változat abban a fájlban, amit egy friss ágens BETÖLT.
A kártya-cím a lista-nézetben az egyetlen látható rész.

**A LELET NEM SZŰNT MEG, CSAK MÁS: nem „nincs védelem", hanem HÁROM MŰKÖDŐ VÉDELEM, AMIT A REPÓ
NEM TARTALMAZ.** Egy `git clean -fd`, egy friss klón vagy egy új gép nyomtalanul elviszi mind a
hármat, miközben a repó változatlannak látszik -- ez az ÖTÖDIK ÁLLAPOT, egy szinttel arrébb.
*(A követett készlet a `chore/7a6bd310-commit-msg-hook` ágon áll, 7 fájllal, és NINCS a kötegen:
`git ls-files scripts/hooks/` a kötegen 0. Amíg kint marad, a három futó őr verziózatlan.)*

**ÉS A DELTA-CRM-BEN IS ÁLL, MÉRTÉKKEL EGYÜTT** (mandark mérte 2026-08-27 21:2x, egy push előtti
ellenőrzés melléktermékeként; kártya `c099f018`). A fenti alak eddig a marveen repóra volt leírva.
Megmérve a Delta-CRM checkoutban: **82 ágból 30-nak MÁS NEVŰ ágra mutat az upstreamje** -- 10 az
`origin/main`-re, 9 az `origin/develop`-ra, 11 egyébre.

```bash
git config --get-regexp '^branch\..*\.merge'   # és hasonlítsd az ág SAJÁT nevéhez
```

Aznap ugyanaz védett meg, mint friday-t: a `push.default=simple` megtagadta a csupasz pusht, mert
az ág neve nem egyezett az upstreamével. **A védelem megint egy név-nem-egyezésen múlt.**

**És a csendesebb következmény, ami minden nap hat:** ezeken a 30 ágon minden „ahead/behind" szám
a `main`-hez (vagy a `develop`-hoz) mér, nem a saját távoli ághoz. Egy „3 committal előrébb"
mondat ott MÁS kérdésre válaszol, mint amit az olvasó ért -- és semmi nem jelzi. Aki számot ad,
mérjen EXPLICIT refhez (`git rev-list --count <ág> ^origin/<ág>`), ne `@{upstream}`-hez. **KÉT
argumentumban**, nem egy sztringben (jarvis mérte, én újramértem): egy stringként `fatal` +
ÜRES stdout, és egy `int(x or 0)` olvasás **0**-t csinál belőle -- 198 ágra ugyanazt a hihető
nullát adta.

*(Javítás nincs: a 30 ág konfigját átírni mások munkafáit érintené. A gyakorlati szabály
változatlan és elég: soha csupasz `git push`, mindig explicit `git push <remote> <ág>`.)*

**ÉS AKI PUSH-UTASÍTÁST AD, A REPÓT NEVEZZE MEG, NE A REMOTE NEVÉT** (computress javított ki,
2026-08-28 00:21 -- a koordinátor követte el).

A két repó szabálya **ellentétes**: a marveenben `fork` a jó és `origin` a tiltott; a Delta-CRM-ben
`origin` a jó és `old-origin` a halott. Egy utasításban a remote NEVE ezért repó-függő, és a rossz
irányba hordozható. Mérve: „told fel a forkba" ment egy DELTA-CRM feladatra -- ott a `fork`
**nem is létezik**, tehát vagy hangosan elhasal, vagy (ha valaha létrejön) rossz helyre visz.

    ROSSZ:  „told fel a forkba"  /  „push origin-ra"     <- a remote neve átvihetetlen
    JÓ:     „told fel a Delta-CRM repóba (balintisti/Delta-CRM)"  <- a címzett választ remote-ot

A címzett a saját repójában tudja, melyik remote melyik. A KÜLDŐ az, aki két repó szabályát tartja
fejben egyszerre -- és tévedni is ő fog.

**Delta-CRM munka a Delta-CRM-be, Marveen munka a forkba.** Ha egy marveen-változás az upstream
projektnek is érne valamit, az **PR a Szotasz/marveen felé**, nem push -- és az külön döntés.

**CI-percek: mérd, ne feltételezd -- ÉS AZ ÁG NEVE MINDKÉT REPÓBAN KEVÉS. A DÖNTŐ KÉRDÉS AZ,
HOGY VAN-E AZ ÁGRA NYITOTT PR** (mérve 2026-08-28: dexter találta a Delta-CRM-ben, friday
újramérte itt, marveen ellenőrizte).

Az alábbi `on:`-elemzés IGAZ, és mégis hamis biztonságérzetet ad, mert a `pull_request:` sorról
azt sugallja, hogy csak PR NYITÁSKOR tüzel. Nem: a `secret-gate.yml` és a `test.yml`
**CSUPASZ `pull_request:`-et deklarál `types:` nélkül, és a GitHub alapértelmezése erre
`[opened, synchronize, reopened]`** -- a `synchronize` pedig MINDEN pusholásra tüzel egy olyan
ágra, amire NYITOTT PR van, az ág nevétől függetlenül.

    Delta-CRM   pr-check.yml   explicit [opened, synchronize, reopened]
    marveen     secret/test    CSUPASZ pull_request:  -> UGYANAZ, alapértelmezésből

Mérve ebben a repóban: `gh run list --repo Szotasz/marveen --limit 40` -> 26 futás
`pull_request` eseményre, 14 `push`-ra; a legutolsó **2026-08-28 16:41**, tehát a PR-esemény ma is
aktívan tüzel. Élő eset egy van: **PR #991 `fix/quarantine-reader-runtime-allowlist`** (a mi
fejünk); a többi nyitott PR külső hozzájáruló.

**DE A KÖLTSÉG NEM UGYANAZ, ÉS EZ SZŰKÍTI A SZABÁLYT, NEM TÁGÍTJA** (jarvis mérte 2026-08-28
20:38, marveen `gh repo view`-val ellenőrizte):

    Szotasz/marveen        isPrivate: false   <- PUBLIKUS
    balintisti/marveen     isPrivate: false   <- PUBLIKUS (a fork)
    balintisti/Delta-CRM   isPrivate: TRUE    <- ITT VAN A SZÁMLA

**A GitHub Actions a PUBLIKUS repókban standard runneren INGYENES és mérőóra nélküli.** A 3000
perc egy PRIVÁT-repó keret. Mindkét marveen workflow `runs-on: ubuntu-latest`, tehát a marveen
repóban egy PR-futás **nem kerül pénzbe** -- a Delta-CRM `ci.yml` 15 ubuntu jobja viszont igen,
és ott landol a ~70 perc.

**Amit ez jelent a gyakorlatban: a „ne pusholj elsejéig" a DELTA-CRM-re szól.** A marveen
repóban a PR-munka blokkolása három napig semmit nem takarít meg, csak munkát állít le. A
TRIGGER-lelet (a csupasz `pull_request:` alapértelmezése) változatlanul áll -- a KÖLTSÉG-
következtetés nem vihető át.

*(A megkülönböztetés azért került ide külön bekezdésbe, mert az irányt könnyű elrontani: az
első alakom MINDKÉT repóra kiterjesztette a tiltást, „ugyanaz a mechanizmus" alapon. A
mechanizmus tényleg ugyanaz; a SZÁMLA nem. Egy szabály indoka -- itt: „nem kvóta, hanem
számla" -- ugyanúgy hatókörös, mint egy szám, és ugyanúgy hamis lesz, ha a hatókör lemarad
róla.)*

**A PUSH ELŐTTI ELLENŐRZÉS, MINDKÉT REPÓBAN UGYANAZ, csak a repó változik** (a marveenben ez
percet nem véd, csak zajt és futásidőt -- ott a `--head` szűrés inkább higiénia):

```bash
gh pr list --state open --head <ág>                          # Delta-CRM
gh pr list --state open --repo Szotasz/marveen --head <ág>   # marveen UPSTREAM
gh pr list --state open --repo balintisti/marveen --head <ág>   # marveen FORK -- ide pusholunk
# ÜRES kimenet = ingyenes. A `--head` szűrjön, NE a `--limit`!
```

**A FORK-SOR AZÉRT KELL, MERT A MI PUSHUNK ODA MEGY** (didi mérte 2026-08-28 20:28). A fenti
ellenőrzés első alakja csak az UPSTREAM-et nézte, holott a repó saját szabálya szerint minden
marveen-munka a `fork`-ba megy. Egy a forkban nyitott PR a FORK workflow-it futtatná, Isti
számláján, és a dokumentált parancs nem látta volna.

Mérve, mielőtt leletnek nevezné: `gh pr list --state open --repo balintisti/marveen --limit 100`
-> **0 sor**, kontrollal (ugyanaz a parancs az upstreamre sorokat ad, 1099, 1095, 1090 ...), tehát
a nulla VALÓDI nemleges válasz, nem néma mérő. **Ma tehát nincs élő eset a forkban.**
Épp ezért került ide a sor és nem egy „a forkban úgysincs PR" állandósult tényként: egy nulla
állapot-állítás, és egyetlen `gh pr create` megszünteti -- csendben.

**A `--limit` CSAPDA MÉRT, ÉS A MEGNYUGTATÓ IRÁNYBA TÉVED:** friday először `--limit 20`-szal
nézte, 12 sort kapott, köztük egy sem a miénk -- és majdnem azt jelentette, hogy nincs élő
esetünk. **51 nyitott PR van.** A limit nem hibát ad, hanem egy szűkebb igazságot, ami teljes
nemleges válasznak olvasódik. Ugyanaz az alak, mint a `git ls-tree` alkönyvtár-csapdája: a
találat valódi, a populáció nem.

A Delta-CRM saját szakasza (`/Users/isti/CLAUDE.md`, „MI INDÍT ACTIONS-FUTÁST EBBEN A REPÓBAN")
ugyanezt mondja a másik oldalról, a nyolc ottani workflow-val.

*(didi találta meg, hogy a szabály eddig csak egy üzenetben élt, és hogy ennek a szakasznak a
CÍME általános, a MÉRÉSE viszont repó-hatókörű -- így lesz egy helyes mérésből hamis flotta-
szabály. Az újramérési feltételek közt eddig nem szerepelt a „másik repó"; most igen. friday
pedig kimutatta, hogy a testvér-bejegyzés önmagában sem lett volna elég: a csapda ITT IS él,
csak nem az explicit `types:`-ban, hanem az alapértelmezésben, amit a fájl NEM mond ki.)*

Az alábbi mérés (a workflow-fájlok jelenléte ágankénti bontásban) 2026-08-27-én készült.
Újramérve 2026-08-27-én (jarvis mérte, marveen újramérte
függetlenül): a marveen repóban **64 helyi ágból 23-on** van `.github/workflows`, és azok
**21-én KÉT fájl** (`secret-gate.yml` és `test.yml`). Mindkettő `on:` blokkja ugyanaz:
`pull_request:` és `push: branches: [develop, main]`. Tehát egy feature-ág pusholása a forkba
**továbbra is nulla Actions percet** éget.

*(A korábbi szám -- „tizenhét ágból egyetlenegyen", 2026-08-23 -- elavult: a workflow azóta a
legtöbb ágra átkerült. A KÖVETKEZTETÉS viszont változatlan, és ez a lényeg: nem az számít, HÁNY
ágon van workflow, hanem hogy MIRE tüzel. A szám elavult, a szabály nem.)*

Ez a mérés ágfüggő -- ha új workflow kerül be, vagy ha `develop`/`main`-re pusholsz, újramérendő:

```bash
# FIGYELEM: `|| echo 0` NÉLKÜL. A grep 0 találatnál exit 1-et ad, tehát az `|| echo 0` lefut,
# és az `n` értéke "0\n0" lesz -- amire a `[ "$n" != "0" ]` IGAZ, és a workflow NÉLKÜLI ágakat
# is beszámolja. Marveen ezt 2026-08-27-én elkövette: 23 helyett 64-et kapott, azaz MINDET.
for b in $(git for-each-ref --format='%(refname:short)' refs/heads/); do
  n=$(git ls-tree -r --name-only "$b" | grep -c '^\.github/workflows/')
  [ "${n:-0}" -gt 0 ] && echo "$b: $n"
done | wc -l
```

**ELŐSZÖR A MEGLÉVŐ KAPUT HÍVD, NE EZT A RECEPTET** (friday találta 2026-08-28 05:57-kor,
marveen újramérte függetlenül 06:0x-kor). Ez a szakasz évekig kézzel írt `git ls-tree` + `grep`
receptet tanított, és közben a repóban **ott áll egy fail-closed kapu, amit a pre-commit hook ÉS a
CI is hív**: `scripts/secret-gate.ts` (telepítő: `scripts/install-secret-gate-hook.sh`, workflow:
`.github/workflows/secret-gate.yml` -- mindhárom UGYANAZT a szkennert hívja).

```bash
npx tsx scripts/secret-gate.ts --range origin/main..<ág>
```

**ÉS A HATÓKÖR, MERT EZ A SZAKASZ MA MÁR ÁTVÁNDOROLT A MÁSIK REPÓBA** (mandark jelezte
2026-08-29, miután a saját lapján Delta-CRM push-ellenőrzésként hivatkozott rá):

    `scripts/secret-gate.ts` .... **MARVEEN-repo szkript**
    Delta-CRM `origin/main` ..... `git ls-files | grep secret-gate` -> **0**
                                  `git cat-file -e origin/main:scripts/secret-gate.ts` -> ABSENT
    KONTROLL: `package.json` ugyanott JELEN van, tehát a mérő lát

**A Delta-CRM-ben ez a parancs nem létezik**, tehát egy oda írt push-recept vagy hangosan elhasal,
vagy -- rosszabb -- valaki „nincs kapu"-ként olvassa. Ugyanaz a repók közti átvitel, amit ez a lap
már négyszer rögzít (ágnév, workflow-fájl, batch-döntés, most egy szkript-név).

Mérve, két alakban: létező ágra `exit 1`-et ad és kimondja, hogy **„NOT SCANNED, therefore NOT
CLEARED"**; NEM létező ágra `exit 2`-t, a git hibájával, és a saját indoklásával:
*„an undeterminable set is a failure, not a pass."* Vagyis pontosan az a megkülönböztetés, ami a
kézi ciklusból hiányzik -- a „nem vizsgáltam" nem olvad össze a „tisztá"-val.

**A KORLÁTJA IS MÉRVE, mert enélkül ez az ajánlás hamis lenne:** a `--range` a fájlNEVEKET a
diffből veszi, a TARTALMAT viszont a MUNKAFÁBÓL olvassa. Egy ki nem csekkolt ág fájljára ezért
`NOT SCANNED`-et ad. Push előtt tehát checkout vagy worktree kell mellé, vagy `git show`-alapú
olvasás.

**JAVÍTÁS 06:15-KOR, EGY ÓRÁVAL A FENTI BEKEZDÉS UTÁN -- AZ ELSŐ ALAKJA HAMIS VOLT, ÉS VESZÉLYES
IRÁNYBA.** Ide az került, hogy a kézi recept „egy MÁSODIK, gyengébb igazság ugyanarról", tehát a
kapu alá szorul. Megmérve (`src/security/secret-gate.ts`, a saját fejléce mondja ki) a kapunak
**három detektora** van, és egyik sem fájlnév-alapú a titkokra:

    1. PATH      -- KIZÁRÓLAG evidence/artifact könyvtárak: `.pre-ship-evidence`, `evidence`,
                    `transcripts`, `.session-capture`.  A `.env` / `.pem` / `id_rsa` NINCS benne.
    2. CONTENT   -- ismert titok-ALAKOK (`sk_live_`, privát kulcsok, JWT-k, ...), fájlnévtől
                    függetlenül.
    3. TRANSCRIPT-- csatorna-anyag (`message_id NNN: "..."`), függetlenül attól, mit idéz.

**A kettő tehát MÁSIK TENGELY, nem erősebb és gyengébb változat ugyanabból.** A kapu a TARTALMAT
fogja meg, a kézi recept a FÁJLNEVET. Egy `.env`, aminek a tartalma nem illeszkedik egyik ismert
alakra sem (például egy sima jelszó egy kapcsolat-stringben), a kapun ÁTMEGY -- és pontosan ez az
a fájl, amit a kézi minta keres. Fordítva ugyanígy: egy privát kulcs egy ártatlan nevű fájlban a
kézi mintán megy át, és a CONTENT fogja meg.

**Ezért MINDKETTŐ fut, és a sorrend csak kényelem:** előbb a kapu (gyorsabb, fail-closed, és a CI
is ezt futtatja), utána a fájlnév-különbség mérése. Egyik sem váltja ki a másikat.

*(Hogy ez a bekezdés egy órán belül kétszer áll itt: az első alakot friday helyes leletéből írtam,
de a KÖVETKEZTETÉST én tettem hozzá -- „tehát a kézi recept fölösleges" --, mérés nélkül. A lelet
igaz volt, a belőle levont következtetés nem. Ugyanaz az alak, mint a lap többi helyén: a mérés és
a rá épített magyarázat azonos magabiztossággal állt egymás mellett, és csak az egyiket mérte meg
valaki.)*

*(A kézi recept indoklása -- a jelenlét helyett a KÜLÖNBSÉG mérése, és a pozitív kontroll --
változatlanul érvényes.)*

**És a push előtti titok-ellenőrzés is mérés, nem bizalom:**

```bash
# A REPO GYÖKERÉBŐL futtasd, vagy adj `-- .` -t: a `git ls-tree` az AKTUÁLIS KÖNYVTÁRRA szűkít,
# és egy alkönyvtárból nézve a gyökér dotfile-jai EGYSZERŰEN KIMARADNAK a találatból.
cd "$(git rev-parse --show-toplevel)"
git ls-tree -r --name-only <ág> | grep -iE \
  '(^|/)\.env($|\.)|service-account\.json|tokens\.json|\.pem$|id_rsa|(^|/)\.(bash|zsh|psql)_history$|docker/config\.json|(^|/)\.netrc$|(^|/)\.npmrc$'
```

**A `.env` HORGONY 2026-08-28-ÁN BŐVÜLT, ÉS A RÉGI ALAKJA HÉT ENV-FÁJLBÓL ÖTÖT NEM LÁTOTT.**
A minta NEVE „env-fájl" volt, a KÓDJA `(^|/)\.env$` -- vagyis PONTOSAN a `.env` nevű fájl. Egy
`.env.test` 2026-08-27-én át is ment rajta (ártalmatlan volt, megmérve). Mérve, ugyanazon a
tizenkét elemű névlistán:

    régi `(^|/)\.env$`      ->  2 találat  (`.env`, `backend/api/.env`)
    új   `(^|/)\.env($|\.)` ->  7 találat  (+ `.env.test`, `.env.local`, `.env.production`,
                                             `.env.development`, `.env.staging`)
    NEGATÍV KONTROLL: `docs/environment.md` és `src/env.ts` EGYIKRE SEM illeszkedik -- tehát az
    új minta nem egyszerűen bővebb, hanem a helyes halmazt fogja meg.

**A `.env.example` VISZONT LEGITIM ÉS KÖVETETT** (a Delta-CRM lapja kifejezetten erre hivatkozik),
tehát az új minta önmagában hamis riasztást adna rá. A kivétel KÜLÖN lépés, mert `grep -E`-ben
nincs negatív lookahead, és egy `-P`-re épített minta gépfüggő lenne:

```bash
... | grep -vE '\.env\.(example|sample|template)$'
```

*(Ugyanaz az alak, mint a `CREATE INDEX CONCURRENTLY` esetnél: egy őr, ami a HELYES állapotot --
egy verziózott `.env.example`-t -- jelöli hibának, pár kör után zaj. A bővítés és a kivétel egy
csomag; a kettő közül csak az egyiket bevezetni rosszabb, mint egyiket sem.)*

**A FELTÉTEL NEM AZ ÜRES KIMENET, HANEM A NULLA KÜLÖNBSÉG AZ `origin/main`-HEZ KÉPEST**
(computress mérte 2026-08-27 17:5x-kor, a saját ágán, push előtt -- és megállt vele, ahelyett
hogy puhának minősítette volna a szabályt).

Ez a repó három dotfile-t KÖVET az Initial commit óta (`.bash_history`, `.docker/config.json`,
`.psql_history`), tehát a fenti minta **MINDIG ad találatot** -- minden ágon, mindenkinek,
örökre. Egy őr, ami minden alkalommal riaszt, pár kör után zaj, és pontosan azt a bizalmat éli
fel, amiért létezik. Ugyanaz az alak, mint a `CREATE INDEX CONCURRENTLY` hamis riasztása a másik
lapon: a checklist a HELYES állapotot jelöli hibának.

A helyes kérdés nem az, hogy OTT VAN-E a fájl, hanem hogy **AZ ÉN ÁGAM HOZZÁTESZ-E**:

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main -q
for f in $(git ls-tree -r --name-only <ág> | grep -iE \
  '(^|/)\.env($|\.)|service-account\.json|tokens\.json|\.pem$|id_rsa|(^|/)\.(bash|zsh|psql)_history$|docker/config\.json|(^|/)\.netrc$|(^|/)\.npmrc$'); do
  a=$(git rev-parse "<ág>:$f" 2>/dev/null); b=$(git rev-parse "origin/main:$f" 2>/dev/null)
  [ "$a" = "$b" ] && [ -n "$b" ] && echo "AZONOS  $f" || echo "BLOKKOLO  $f"
done
```

**Blokkoló minden `BLOKKOLO` sor: új fájl, vagy MEGVÁLTOZOTT tartalom.** Az `AZONOS` sorok
kitettsége pontosan nulla -- az objektum már fent van az originon, a `main`-ről elérhetően.

**ÉS A POZITÍV KONTROLL NÉLKÜL EZ SEM ÉR SEMMIT** (computress ezt is lefuttatta): egy fájl, amit
TÉNYLEG átírtál az ágon, adjon `BLOKKOLO`-t. Enélkül egy elrontott hash-összevetés csupa
`AZONOS`-t mondana, és a csend megint jelentene mindent és semmit.

*(A puszta jelenlét-ellenőrzés maradhat gyors előszűrőnek. Amit NEM szabad: a találatot indoklás
nélkül átlépni. Ha a régi alakot futtatod és találsz valamit, a következő olvasó két dolog közül
választhat -- hogy a szabály puha, vagy hogy hanyag voltál. Egyik sem igaz, tehát írd oda, melyik
hash egyezett.)*

**A minta 2026-08-23-án BŐVÜLT, és a bővítés oka fontosabb a mintánál** (computress mérte a
Delta-CRM-en). A régi, szűkebb minta ÜRESET adott az ágára, tehát „mehet" -- közben a repó
gyökere `.bash_history`, `.psql_history`, `.docker/config.json` és `.gitconfig` fájlokat követ, az
Initial commit óta. Egy egész HOME-könyvtár dotfile-jai.
Megmérve nem incidens (a repó privát, a `.docker/config.json`-ben nulla `auths`, a `.psql_history`
egy sor kapcsolat-string nélkül, és mindegyik MÁR fent volt az `origin/main`-en). **De a checklist
nem azért engedte át, mert tiszták voltak, hanem mert NEM IS KERESTE.** Ez ugyanaz az alak, mint
minden más néma siker: az üres találat és a nem-mért megkülönböztethetetlen.

**ÉS A NAGYOBBIK FÁJLT AZ A MÉRÉS NEM NYITOTTA KI** (computress találta meg magán, 2026-08-24;
marveen mérte hozzá a negyediket). A fenti „megmérve nem incidens" mondat a `.docker/config.json`-ról
és a `.psql_history`-ról szól, és rájuk ma is igaz. A `.bash_history` TARTALMÁT viszont nem nézte meg
senki: 567 sorból **33 sor `jwt_secret=` valódi értékkel** (hossz 15-206 karakter, placeholder nulla)
és **28 jelszavas `postgresql://` kapcsolat-string** (mind localhost). Kártya: `7a4cdded`; a titkokat
2026-08-24-én megforgattuk, mindkét tárolóban.

A negyedik felsorolt fájl, a `.gitconfig`, **aznapig szintén nem volt megmérve** -- a minta nem is
keresi. Most igen: 3 sor, `[user]` + email + név, nulla találat a `password|token|ghp_|github_pat|
oauth|helper=|url=…@|AKIA|secret` mintákra. Tehát tiszta -- de **mostantól mérésből tudjuk, nem
feltevésből.**

**A tanulság nem az, hogy a 08-23-i mérés rossz volt** -- IGAZAT mondott arról, AMIT MEGNÉZETT. Az,
hogy egy „megmérve nem incidens" mondat a NEM NÉZETT részre is rátelepszik, és utána senki nem méri
újra. **Ha egy mérés egy halmaz EGY RÉSZÉT nézte meg, a mondat nevezze meg a részt.** Ugyanaz az
alak, mint a `git ls-tree` alkönyvtár-csapdája két bekezdéssel lejjebb: nem hibát kapsz, hanem egy
szűkebb igazságot, ami teljesnek olvasódik.

**És a másik fele, amit ugyanaz a mérés hozott:** computress először azt mérte, hogy az ágán nincs
`.github/workflows`, és ebből azt akarta levonni, hogy semmi CI nem tüzel. Hamis volt -- a
`git ls-tree -r --name-only HEAD` az aktuális könyvtárra szűkít, ő pedig a duplázott
`sajat-crm/` alkönyvtárból futtatta, tehát a `.github` kívül esett a lekérdezésen.
Nem hibát kapott, hanem **üres találatot, ami pontosan úgy néz ki, mint egy valódi nemleges
válasz** -- és a megnyugtató irányba tévedt volna. Ezért áll a `cd "$(git rev-parse --show-toplevel)"`
a recept első soraként. A `store/` gitignore-ban van, de egy `git add -f` vagy egy másik útvonal
ezt megkerülheti, és **egy nyilvános forkból nem lehet visszavenni semmit.**


---
*(kikoltoztetve 2026-10-06, marveen)*

### ÉS EGY SZINTTEL ARRÉBB: A `develop` NEM AZ IGAZSÁG FORRÁSA EBBEN A REPÓBAN -- A FUTÓ FA AZ
(didi mérte 2026-09-02 23:48, marveen egy hamis leletén, amit ugyanaz a nap termelt.)

A fenti szakasz arról szól, hogy a `develop` szó három SHA-n áll. **Ez eggyel arrébb van: nem a
három `develop` közül kell választani, hanem a `develop` és A FUTÓ FA között -- és a kettő elvált.**

    HEAD (a futó fa) = a fő checkout ága, ma `feat/google-service-account` @ 72b5654
    HEAD ^fork/develop .... 526        fork/develop ^HEAD .... 0
    HEAD ^fork/main ....... 549        fork/main    ^HEAD .... 0
    fork/develop utolsó commitja: 2026-08-16
    KONTROLL: HEAD ^HEAD = 0, tehát a mérő tud nullát mondani

**A futó rendszer 526 committal áll az előtt az ág előtt, amit bárki törzsnek nevezne, és
semmi nem folyik visszafelé.**

**A GYAKORLATI KÖVETKEZMÉNY, ÉS EZ FOGOTT MEG ENGEM:** aki azt kérdezi, hogy „ki van-e szállítva"
vagy „él-e ez a hiba", és a `develop`-hoz méri, **egy tizenhét napos fához méri.** A mérés tiszta
lehet, a kontroll tüzelhet, és a válasz mégis hamis. Ma este pontosan ez történt: tartalommal
mértem (helyesen, ancestry helyett), kontrollal, és azt írtam, hogy egy javítás nincs kiszállítva
és a hiba ÉL a futó dashboardban. A javítás a `dist/`-ben volt, futott, és a `develop` volt, ami
nem tudott róla.

**ÉS NEM IS ÉRVÉNYES ALAPVONAL TARTALMI ELLENŐRZÉSHEZ** (didi mérte 2026-09-19): egy szemantikai
ellenőrzés a `develop`-on 0-t és 0-t adott, DE A KONTROLL IS 0-t -- a fájl ott egy olyan időből
való, amikor a keresett szimbólumok még nem léteztek. **Egy nulla onnan nem cáfolat, hanem
CSEND**, és a kettőt csak a kontroll választja szét.

**A HELYES HORGONY: amiből az fut, ami fut.**

```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/overview | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; print(b['status'], b.get('builtCommit'))"
git rev-parse --abbrev-ref HEAD        # és a fő checkout ága, mert a build ABBÓL készül
```

**ÉS EGY MÁSODIK CSAPDA UGYANEBBEN A MÉRÉSBEN** (didi fogta meg magán, mielőtt lelet lett volna):
az `origin/develop`-hoz mérve 85 commit hiányzik a futó fából. **Ez nem szállítási rés: az `origin`
itt az IDEGEN upstream (`Szotasz/marveen`), a miénk a `fork`.** A 85 az ő munkájuk. A lap ezt
kimondja; a `develop` szót könnyebb elolvasni, mint a remote-ot.

**ÉS EZ SZÁNDÉKOS, NEM SODRÓDÁS -- MÉRVE, HÁROM RÉTEGBEN** (didi, 2026-09-02 23:52; a válasz
NÉGY NAPJA le volt írva, és egyikünk sem olvasta el):

    a BUILD nem ismer ágat ..... `package.json`: `tsc && git rev-parse HEAD > .built-commit`
                                 a MUNKAFÁT fordítja; nem is tudna ágat választani
    az ŐR VÉDI .................. a `post-checkout` a tiszta fát ARRA az ágra állítja vissza,
                                 amiről jött, és a `develop`-ra visszaállítás SZÁNDÉKOSAN KI LETT
                                 VÉVE, mint káros
    és TELEPÍTVE van ............ `.git/hooks/pre-commit.d/05-prod-tree-guard` + `post-checkout`,
                                 a `10-secret-gate` mellett mint kontroll

Az `install-prod-tree-guard-hook.sh` fejléce szó szerint kimondja, 2026-08-29-ről: *„a `develop`
510 committal a telepített fa mögött volt és nem tartalmazta sem a `secret-gate.ts`-t, sem a
`card-comment.sh`-t, tehát a »visszaállítás« MAGA VOLT a csonkítás."*

**TEHÁT A RENDSZER 08-29 ÓTA A CHECKOUT ÁGÁT TEKINTI A TELEPÍTÉS FORRÁSÁNAK, és a `develop`-ra
visszaállítást KÁRNAK minősíti.** A rés nem állandó, hanem NŐ: 510 az őr fejlécében, ma 526.

**AMI A `develop`-BÓL MEGMARADT, KÉT FUNKCIÓ, EGYIK SEM SZÁLLÍTÁS:** egy CI-trigger, ami soha nem
tüzel (`test.yml` / `secret-gate.yml` a `[develop, main]` pusholásra, és a `fork/develop` utolsó
commitja 08-16); és **öt ág, ami magát hozzá méri -- ráadásul nem a MIÉNKHEZ: mind az öt upstreamje
az `origin/develop`, vagyis a Szotasz/marveen.** Azok az ágak egy MÁSIK PROJEKT ágához hasonlítják
magukat, és a „rajta van-e a törzsön" kérdésre nálunk semmit nem válaszolnak.

**AMI TOVÁBBRA IS ISTI DÖNTÉSE:** hogy ez így MARADJON-e. Az őr szerzője a saját hatókörében
döntött; hogy ez KIMONDOTT politika-e, nincs mérve.

*(A szám határa kimondva: az 526 COMMIT, nem MUNKA -- merge-commitok benne, a tartalom olvasatlan.
Az IRÁNY az állítás, nem a mennyiség.)*




<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 527-571, szó szerint -->
## A SZÓ `develop` HÁROM KÜLÖNBÖZŐ SHA-N ÁLL EBBEN A REPÓBAN -- ÉS MINDHÁROM ÉRTELMES VÁLASZT AD
## (friday mérte 2026-08-28, marveen rossz refet adott neki egy másik repóból)

    develop (helyi) f82a98b -> 275 commit | fork/develop 6b59dc4 -> 270
    origin/develop  29a1bd9 -> 222        | origin/main   1f13ff1 -> 222

Ugyanaz a kérdés (`git rev-list --count <ref>..<tip>`), négy ref, három különböző szám. **Egyik sem
hibás; egyik sem mondja meg magától, melyikre gondoltál.** És a marveenben rosszabb, mint máshol: a
`fork` Istié, az `origin` IDEGEN upstream -- a rossz választás nem csak rossz számot ad, hanem **rossz
repóról szól**.

**ÉS EGY MÁSIK REPÓ REFJE ÜRES VÁLASZT AD, NEM HIBÁT.** Egy `integration/2026-08-27-batch` ref egy
Delta-CRM ágnév; a marveenben nem létezik. Vakon lemérve **az üres eredmény nullának olvasódik** --
vagyis „nincs különbség a köteghez képest", ami épp az ellenkezője az igazságnak.

```bash
git ls-remote <remote> 'refs/heads/<minta>'   # LETEZIK-E a ref, MIELOTT mernel vele
git rev-list --count <TELJES ref>..<tip>      # es ird ki MINDKET oldalt a szammal egyutt
```

**ÉS AZ `ls-remote` ÁTMENETI ÜRESET AD EZEN A GÉPEN, A RIASZTÓ IRÁNYBA TÉVEDVE.** Az üres válasz és
a valódi „nincs ilyen ref" BÁJT-AZONOS, és az üresből az következik, hogy a munka EGY LEMEZEN áll --
vagyis **egy átmeneti hálózati hiba pontosan azt a vészjelzést hamisítja, amit a legkomolyabban
veszünk.** Mérve két ágensnél egy éjszaka; egy hét ágas ellenőrzésben egyszer elsült.

    egy PUSH hangosan bukik ......... `fatal:`, exit != 0, azonnal latod
    egy `ls-remote` NEMAN bukik ..... ures kimenet, exit 0, es ugy nez ki, mint egy valasz

**A SZABÁLY: egy `ls-remote` ÜRES válaszára SOHA ne építs állítást első futásra.** Futtasd újra
(3-4x), és csak akkor mondd ki, hogy a ref nem létezik, ha MINDEN próba üres. Egy NEM-üres válasz
egyszer is elég a létezéshez -- az aszimmetria a mi javunkra dolgozik.

**A KONTROLL, ami ingyen van:** ugyanabban a futásban kérdezz le egy BIZTOSAN létező refet is.

```bash
git ls-remote <remote> 'refs/heads/main' 'refs/heads/<a keresett>'   # a main a KONTROLL
```

**ÉS A KONTROLL AZ ELSŐ HASZNÁLATÁN TÜZELT, PERCEKKEL A MEGÍRÁSA UTÁN:** egy ellenőrzés ÜRESET adott
MINDKÉT refre, a kontrollra is. Kontroll nélkül az a sor azt mondta volna, hogy az aznapi munkát
vivő ág nincs a távolin. A verdikt helyesen ÚJRAPRÓBÁLÁS lett, nem lelet -- egy újrapróba egyezett.

*(A mért esetek -- a három `develop`, a négy remote, a két éjszakai üres `ls-remote` és a
költség-aszimmetria -- `rulebook/push-cel-esetek.md`.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 572-591, szó szerint -->
### ÉS EGY SZINTTEL ARRÉBB: A `develop` NEM AZ IGAZSÁG FORRÁSA EBBEN A REPÓBAN -- A FUTÓ FA AZ
(didi mérte 2026-09-02, marveen egy hamis leletén.)

**A futó rendszer a fő checkout ÁGÁBÓL épül, és több száz committal a `fork/develop` előtt áll;
semmi nem folyik visszafelé.** Aki a `develop`-hoz méri, hogy „ki van-e szállítva" vagy „él-e a
hiba", egy hetekkel régebbi fához mér: a mérés lehet tiszta és kontrollos, a válasz mégis hamis.
Tartalmi ellenőrzéshez sem alapvonal: egy nulla onnan CSEND, nem cáfolat. Ez SZÁNDÉKOS (a
`prod-tree-guard` a `develop`-ra visszaállítást kárnak minősíti, 08-29 óta); hogy így maradjon-e,
Isti döntése. Az `origin/develop` ráadásul az IDEGEN upstream (Szotasz), nem a miénk.

**A HELYES HORGONY: amiből az fut, ami fut.**

```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/overview | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; print(b['status'], b.get('builtCommit'))"
git rev-parse --abbrev-ref HEAD        # és a fő checkout ága, mert a build ABBÓL készül
```

*(A mért számok, a három réteg bizonyítéka és az őr-fejléc idézete: `rulebook/push-cel-esetek.md`.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 739-762, szó szerint -->
### A `git remote -v` ÖNMAGÁBAN VAK

Nem az `origin` dönti el, hova megy a push, hanem az **ág SAJÁT upstreamje**. A `remote -v`
azt sorolja fel, MILYEN távoliak vannak, és HELYESEN mutatja őket, miközben az ág máshova megy.
Mérve: a Delta-CRM `develop`-ján az upstream az `old-origin` (a halott repó), a `remote -v`
kimenete tökéletesen rendben. **A védelem lefut, zöldet mond, és nem véd.**

```bash
git rev-parse --abbrev-ref '@{push}'                        # ide menne EZ az ág
git config --get branch.$(git branch --show-current).remote  # ugyanez, nyersen
git push fork <ág>      # marveen: MINDIG explicit `fork`, sosem csupasz `git push`
git push origin <ág>    # Delta-CRM: origin -- de NEM a marveenben
```

**Az upstreamet KÉT mező adja, egyik sem önmagában:** `branch.<ág>.merge` csak a ref NEVE,
`branch.<ág>.remote` a távoli. Egy `.merge`-re szűrt grep tehát HAMIS képet ad; a `@{push}` a
kettőt EGYÜTT oldja fel.

**`remote.pushDefault=fork` be van állítva** (marveen, 2026-08-27 11:28), tehát a csupasz
`git push` egy rosszul beállított ágon HANGOSAN elhasal
(`cannot resolve 'simple' push to a single destination`) ahelyett, hogy csendben egy idegen
nyilvános projektbe menne. **Ha ezt a hibát kapod: nem elromlott semmi. Az ág upstreamje nem a
`fork`.** A válasz mindig `git push fork <ág>`.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 763-818, szó szerint -->
### ÉS A CSAPDÁT A SAJÁT AJÁNLOTT RECEPTÜNK TERMELTE

A prod-tree-guard hibaüzenete évekig ezt ajánlotta:

    git worktree add ../marveen-wt-<topic> -b <branch> origin/develop

Ez EGYÜTT beállítja az `origin` upstreamet -- és itt az `origin` a `Szotasz/marveen`. **A
dokumentált biztonságos szokás hozta létre a hibás konfigurációt**, nem hanyagság: pontosan attól,
hogy valaki KÖVETTE a lapot. És ami megvédett, nem a figyelem volt: a `push.default=simple`
azért tagadta meg, mert az ág NEVE nem egyezett az upstream ág nevével. **Ha az ágat
`develop`-nak hívták volna, átment volna.** A védelem egy névegyezésen múlt.

```bash
git worktree add ../marveen-wt-<topic> -b <branch> "$(git rev-parse HEAD)"   # SHA: nem allit upstreamet
git branch --unset-upstream <branch>    # ha mar letrejott rosszul

# ES UGYANEZ EGY MASIK PARANCSBOL, MASIK REPOBAN (dexter merte 2026-09-11, Delta-CRM):
git checkout -b <uj> origin/main        # <- EZ IS UPSTREAMET ALLIT, es a VEDETT main-re
# -> egy csupasz `git push` a PROTECTED main-re menne, ami ott ELO DEPLOY. Ugyanaz az alak, mint a
#    worktree-recept fent: nem hanyagsag, hanem hogy a KEZENFEKVO parancs allitja be a rosszat.
git checkout -b <uj> "$(git rev-parse origin/main)"   # SHA-val: nem allit upstreamet
cp -Rc node_modules ../marveen-wt-<topic>/     # NE SYMLINKELD -- lasd alább
# ES A FORRAS NEM A main: a Delta-CRM fo checkout 10-05-en 09-17-i agon allt (tiptap 3.22.3 vs
#   origin/main lock 3.31.3, kartya 5d9347ea). FUGGOSEGET ERINTO valtozasnal: `npm ci` a sajat faban.
# ES A CEL LETEZESET ELOBB KERDEZD MEG: ha `<wt>/node_modules` MAR VAN, a `cp -Rc` NEM bukik,
# hanem BELE masol -> `node_modules/node_modules`. Egy MAS AGENS fajaba igy irtam bele ma
# (2026-09-24), es a `git status --porcelain` 0-t adott ra, mert a node_modules gitignore-olt:
# a szennyezes a szokasos halon SZERKEZETILEG nem latszik. A `git worktree add` elotte
# HANGOSAN bukott (`fatal: ... already exists`) -- a masolas volt a nema fele, es a lanc
# tovabbment rajta. Az alak: `[ -e "$WT/node_modules" ] && echo 'MAR VAN -- NE MASOLJ' || cp -Rc ...`
```

**A `node_modules`-t NE SYMLINKELD, KLONOZD -- es ez a sor azert all ITT, a parancs MELLETT, mert
maskepp nem er el senkihez** (mandark merte 2026-09-11; a szabaly EDDIG IS le volt irva, es epp ez
a lelet).

    a szabaly leirva: `koteg-celallapot-merese/SKILL.md:31`, szo szerint, mert szammal
    `cp -Rc` a skill-faban .......... **1** fajl   |   worktree-t emlito skill: **18**
    es az az egy skill a KOTEG-CELALLAPOT MERESEROL szol

**Vagyis aki FEJLESZTESI worktree-t hoz letre, meg akkor sem talalna meg, ha atnezne a skilleket:
nem abban a skillben van, amit ehhez hivna.** A szabaly helyes, mert van, megnevezi a mechanizmust
-- es egy olyan ajto mogott ul, amit senki nem nyit ki a megfelelo pillanatban.

**A KAR, AMIT A SYMLINK OKOZ, MERVE:** 108 worktree-bol **70 symlinkeli** a `node_modules`-t, es 66
ut UGYANARRA a generalt Prisma-kliensre mutat. **Egy `prisma generate` barmelyikben a TOBBI 65
klienset is atirja** -- masok futo munkaja kozben. Es a hiba iranya a megnyugtato: a kliens
SZELESEBB lehet a fanal, tehat a `tsc` ZOLDEN atenged olyan mezot, ami az adott ag semajaban nincs.

**A KLON ARA GYAKORLATILAG NULLA, harom fuggetlen meressel:** 1,0 GB latszolagos meret,
`cp -Rc` **7,3 / 7,6 / 7,8 masodperc** (mandark, dexter, computress), es a VALODI lemez-delta
**0,02 GB** -- az APFS blokkokat oszt. Mind a 70 fa izolalasa igy ~8,5 perc es ~1,4 GB, nem 70 GB.

*(Mérve: a Delta-CRM 82 ágából 30-nak MÁS NEVŰ ágra mutat az upstreamje. Ott minden
„ahead/behind" szám a `main`-hez mér, nem a saját távoli ághoz, és ez sehol nem látszik.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 829-926, szó szerint -->
### PUSH ELŐTT: CI-PERC ÉS TITOK -- KÉT KÜLÖN TENGELY

**A CI-t nem az ág NEVE indítja, és KÉT út van -- az üres `gh pr list` SZÜKSÉGES, DE NEM ELÉGSÉGES:**

    `pull_request:` .... kell hozza NYITOTT PR (a default `[opened, synchronize, reopened]`, es a
                         `synchronize` MINDEN pusholasra tuzel egy ilyen agra)
    **`push:`** ........ NEM kell hozza PR, csak hogy az AGNEV illeszkedjen a listajara

```bash
gh pr list --state open --head <ág>                             # Delta-CRM
gh pr list --state open --repo balintisti/marveen --head <ág>   # marveen FORK -- ide pusholunk
# a `--head` SZURJON, NE a `--limit` (51 nyitott PR volt; egy `--limit 20` HAMIS nemlegest adott)
gh api "repos/<owner>/<repo>/contents/.github/workflows?ref=main" --jq '.[].name'   # a masodik ut
gh run list --repo <owner>/<repo> --branch <ág> --limit 5       # push UTAN: a JOSLAT nem meres
```

**A KÉT MÉRÉS NEM EGYENRANGÚ: a push ELŐTTI egy JÓSLAT, a push UTÁNI egy MEGFIGYELÉS** -- az utóbbi
az erősebb, és az dönti el, tényleg ingyenes volt-e. Kontroll, hogy a lekérdezés tud NEM-nullát
mondani: ugyanez `main`-re.

**⚠ ÉS A `gh pr list` NÉMÁN ÜRESET AD HÁLÓZATI HIBÁRA** (a hiba a stderr-en, a stdout üres, és az
üres „nincs nyitott PR"-nak olvasódik, azaz a MEGNYUGTATÓ irányba). Ezért `2>&1`, és nézd meg a
kimenetet. **A `gh api` NEM ilyen: az HANGOSAN bukik** (rc=1, hibatörzs a stdouton) -- a rituálét
NE terjeszd rá.

**A WORKFLOW `on:` BLOKKJÁT OLVASD EL, NE REGEXELD.** Mért eset: egy regexes kinyerő ÜRES
branch-listát adott két push-triggeres fájlra, és **egy üres branch-lista úgy olvasódik, hogy
„nincs korlátozás, tehát MINDEN ágon tüzel"** -- hamis ~70 perces riasztás egy privát repón.
*Egy ÜRES kinyert érték, aminek van HIHETŐ JELENTÉSE, veszélyesebb annál, amelyik törtnek látszik.*

**⚠ ÉS A ~70 PERC NEM EGY PUSH ÁRA -- EGY FEATURE-ÁGRA VALÓ PUSH NYITOTT PR NÉLKÜL NULLA**
(dexter mérte 2026-09-19, marveen függetlenül újramérte, 17 valódi ág feltöltésével):

    ci.yml ................ push: [main, develop]  +  pull_request: [main, develop]
    deploy.yml ............ workflow_run a CI-ra, branches: [main]
    pr-check.yml .......... CSAK pull_request
    ci-timing-probe.yml ... VAN push-triggere, de EGYETLEN meresi agra szukitve (a sajat
                            docblockja mondja ki, hogy szandekosan)
    a tobbi ot ............ workflow_dispatch, azaz kezi

**ÉS A MEGFIGYELÉS, NEM A JÓSLAT:** dexter 17 ágat tolt fel, és a repó legutolsó workflow-futása
azóta is az ELŐZŐ NAPI. Semmi nem indult el. *(A jóslat a konfig olvasása; a megfigyelés az,
hogy `gh run list` nem mozdult.)*

> **Hónapokig egy lemezen tartottuk a munkát egy költség miatt, ami erre a műveletre SOHA nem
> állt fenn.** A szabály nem volt hamis, a HATÓKÖRE hiányzott -- és épp ez a bekezdés mondja ki
> két sorral lejjebb, hogy egy szabály indoka ugyanúgy hatókörös, mint egy szám.

**AMI VALÓDI KIKÖTÉS MARAD:** ha az ágnak van NYITOTT PR-je, a `synchronize` MINDEN odatolásra
tüzel. Tehát a próba nem az, hogy „ág-e", hanem hogy **van-e rajta nyitott PR** -- és arra a
`gh pr list --head <ág>` a mérő, nem a `--limit`.

**A KÖLTSÉG CSAK AZ EGYIK REPÓBAN VAN:** `balintisti/Delta-CRM` **PRIVÁT** (~70 számlázott perc
futásonként, ÉS CSAK A FENTI UTAKON), a két marveen repó **PUBLIKUS**, ott ingyenes. A mechanizmus közös, a SZÁMLA nem --
a „ne pusholj" szabály a Delta-CRM-re szól. **Egy szabály indoka ugyanúgy hatókörös, mint egy szám,
és ugyanúgy hamissá válik, ha a hatókör lemarad róla.** *(Mért eset: marveen pontosan így
terjesztette ki a tiltást MINDKÉT repóra „ugyanaz a mechanizmus" alapon, és tévedett.)*

**A TITOK-ELLENŐRZÉS KÉT TENGELY, ÉS EGYIK SEM VÁLTJA KI A MÁSIKAT.** A kapuk repónként MÁSOK:

```bash
# marveen -- TS. A neveket a DIFFBOL, a TARTALMAT a MUNKAFABOL veszi:
#   egy ki nem csekkolt agra `NOT SCANNED, therefore NOT CLEARED` (fail-closed).
npx tsx scripts/secret-gate.ts --range origin/main..<ág>
# Delta-CRM -- PYTHON, 2026-09-11 ota (`aa1643e6f`). BLOBOT olvas (`git show {rev}:{path}`),
#   tehat BARMELY refet szkennel, kicsekkolva vagy sem -- a marveen korlatja ide NEM ervenyes.
git cat-file -e origin/main:scripts/secret-gate.py; echo $?   # 0 = van kapu (a TORZSET kerdezd,
                                                              # ne a munkafa indexet)
python3 scripts/secret-gate.py --range <base>..<head>
python3 scripts/secret-gate.py --self-test        # 72 ellenorzes, PASS = a kapu maga mukodik
```

**ÉS A HOOK MÁS MENNYISÉGET OLD FEL, MINT AMIT PUSHOLSZ:** a `pre-push.d/50-secret-gate`
`ROOT="$(git rev-parse --show-toplevel)"` alakban dolgozik -- AHONNAN ÁLLSZ, nem AMIT KÜLDESZ.
A fő checkoutból pusholva átmegy akkor is, ha az ÁGON nincs ott a kapu-fájl; az ág saját
worktree-jéből `NOT SCANNED`. **Aki a fő checkoutból dolgozik, sosem találkozik vele.**

A második tengely a FÁJLNÉV, és a kapu egyik detektora sem fájlnév-alapú a titkokra:

```bash
# A `cd` GYENGE ELOFELTETEL: a git minden pathspec-es parancsa a CWD-hez old fel, es ha semmire
# nem illeszkedik, URES kimenetet ad rc=0-val -- a CSEND olvasodik valasznak (ket agensnel, ket
# parancson, egy napon, MINDKETTO fail-open). A MECHANIKUS alak HANGOS:
git ls-files --error-unmatch <pathspec> >/dev/null || { echo "ROSSZ UT -- ALLJ"; exit 1; }
git ls-tree -r --name-only <ág> | grep -iE \
  '(^|/)\.env($|\.)|service-account\.json|tokens\.json|\.pem$|id_rsa|(^|/)\.(bash|zsh|psql)_history$|docker/config\.json|(^|/)\.netrc$|(^|/)\.npmrc$' \
  | grep -vE '\.env\.(example|sample|template)$'
```

**A FELTÉTEL NEM AZ ÜRES KIMENET, HANEM A NULLA KÜLÖNBSÉG AZ `origin/main`-HEZ KÉPEST.** A repó
három dotfile-t KÖVET az Initial commit óta, tehát a minta MINDIG ad találatot -- egy őr, ami
minden alkalommal riaszt, pár kör után zaj. Fájlonként vesd össze a blob-hasht az `origin/main`-ével;
`AZONOS` = nulla kitettség. **Pozitív kontroll nélkül ez sem ér semmit:** egy fájl, amit TÉNYLEG
átírtál, adjon `BLOKKOLO`-t.

*(A `.env` horgony `($|\.)`-re bővült: a szűkebb `\.env$` hét env-fájlból ötöt nem látott. A
bővítés és a `.example` kivétel EGY CSOMAG -- csak az egyiket bevezetni rosszabb, mint egyiket sem.)*

