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

