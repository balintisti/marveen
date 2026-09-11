# Telepitesi savok -- a MERT ESETEK

Ez a fajl a `CLAUDE.md` „A FO CHECKOUT RESZBEN MAGA A FUTO RENDSZER" szakaszabol kiszervezett
BIZONYITEK-anyag: a meresek reszletei, a visszavonasok, a ki-mikor-mit narrativak.

**A TORVENY NEM ITT VAN, HANEM A `CLAUDE.md`-BEN.** Ha ellentmondast latsz, a lap az ervenyes,
es ez a fajl az elavult -- ide nem ir vissza senki, amikor a lapon javit.

Kiszervezve: 2026-09-11, kartya `ed1c9734` (Isti kerte: keret-fajdalom).
A kiszervezes modszere: minden ITT ALLO sor a lapon ALLT, es az assert a torles ELOTT futott le.

---


## A FŐ CHECKOUT RÉSZBEN MAGA A FUTÓ RENDSZER (mérve 2026-08-22)

Nyolc `dist/` modul hívja futásidőben a `scripts/`-et (heartbeat, channel-coordinator,
agent-scaffold, agent-process, channel-monitor, inbound-probe, reauth-healer, vault-bindings).
Amit oda írsz, az **azonnal éles** -- build nélkül, restart nélkül, ellenőrzés nélkül.

azonnal átvált. Aznap este egy ügynök ide csekkolta ki a saját ágát (teljesen jogosan, mert nem volt
leírva), és ezzel a futó heartbeat már az ő félkész szkriptjeit hívta.
Ezért: **minden ügynök a saját git worktreejében fejleszt**, és a `scripts/` szerkesztése ugyanolyan
súlyú, mint egy telepítés. Kártya: `a1c5d6ca`.


## A LÉTEZÉS ÉS AZ ELÉRÉS KÉT KÜLÖN ÁLLÍTÁS -- ÉS MI AZ ELSŐT SZOKTUK MÉRNI

ugyanennek. **A HAT MÉRT ESET TELJES SZÖVEGE: `rulebook/letezes-es-eleres-esetek.md`** -- ide a
törvény és a parancsok kerültek, a bizonyíték ott áll. Ha egy esetre HIVATKOZOL, oda nézz.)*

mindket iranyban, es o dontotte el, hogy ide keruljon es ne egy uj mezobe).

    a range: 18 commit, ebbol **0** erinti a `src/`-t, **0** fajl `src/` alatt

A koordinator mar egy deploy meretet becsulte, mielott megnezte volna, MI van a tartomanyban.

**ES A KIEGESZITES, AMI ERŐSEBBE TESZI, friday merese:** abbol a 18-bol **hat** a `scripts/`-et
erinti (AZONNAL-ELO sav) es **kilenc** a `rulebook/`-ot. Vagyis a tartomany nem csak `src/`-munkatol
ures -- egy harmada a beolvasztas pillanataban HATOTT, a tobbi dokumentacio. Semmi nem vart buildre.

**AMIT EZ NEM MOND: hogy soha nem tartozunk buildel.** Ugyanaznap keszult el egy `src/`-t erinto ag
(`fix/213abf0d-poller-retry`), es attol a beolvasztastol kezdve ugyanez a mero NEM-NULLAT ad. A
recept ertelme epp ez: a valasz naprol napra valtozik, tehat MERNI kell, nem emlekezni ra.


## TÖBB TELEPÍTÉSI SÁV VAN, MINT AHÁNYRA SZÁMÍTASZ -- ÉS A „KÉSZ" MINDEGYIKBEN MÁST JELENT

(kártya `576a4b21`, mérve 2026-08-23; a `web/` sávot friday mérte közvetlenül, a launchd sávot
jarvis találta.)

*A cím szándékosan nem mond számot. A kártya „három sáv"-ról szólt, a mérés négy helyet adott
(`scripts/`, `web/`, `src/`, `*.plist`) három különböző viselkedéssel -- és egy szám a címben
pontosan addig igaz, amíg valaki hozzá nem tesz egy ötödiket. A táblázat a mérvadó.
A táblázat AZÓTA NŐTT, és ez a bekezdés szándékosan nem mondja meg, mennyivel: a fenti négy
név a 2026-08-23-i mérés, nem a mai lista. Számold meg a sorokat.*

A fenti szakasz a `scripts/`-ről szól. Nem egyedül áll:

| `scripts/` | a beolvasztással **AZONNAL** | **18** `dist/` modul futásidőben a munkafát hívja (mérve 2026-08-24 00:27, friday jelzésére; a korábbi „nyolc" elavult volt, és a nyolc névvel felsoroltból ötnek MA nincs találata) |
| `web/` | a beolvasztással **AZONNAL** | `src/web.ts:111`: `WEB_DIR = join(PROJECT_ROOT, 'web')` |

| `*.plist` / launchd | csak KÜLÖN telepítéssel (`launchctl`) | a repó `scripts/*.plist.template` fájlokat követ (8 db), a TELEPÍTETT példány a `~/Library/LaunchAgents/` alatt él; 2026-08-27 18:1x-kor mind a 8 telepítve ÉS betöltve (`launchctl list`). **A korábbi példa -- `com.marveen.idle-reporter` mint sehol-nem-futó -- ELAVULT: fut.** |
| `.claude/settings.json` hookjai | **ÁGENSENKÉNTI MÁSOLÁSSAL, a következő provisioningkor** (nem rétegződés, és nem is „sehogy") | jarvis mérte 2026-08-27 16:12, marveen függetlenül újramérte: **minden ágens SAJÁT `CLAUDE_CONFIG_DIR`-rel fut**, és a `~/.claude/settings.json` egy hookkal többet tartalmaz, mint bármelyik ágens-konfig -- pontosan a ma bekötött skills-snapshot hookot. Egyetlen ágens konfigjában SINCS. Ha a két fájl NEM rétegződik, a hook SOHA nem hat. **FELOLDVA 16:20-kor (friday), restart NÉLKÜL, a FUTÓ `dist/web/agent-process.js:438`-ból** (nem a forrásból -- az nem a futó rendszer): a `provisionIsolatedConfigDir` a MEGOSZTOTT settingset olvassa BE ALAPNAK, és az ágens régi settingséből csak azokat a kulcsokat húzza át, amik MÉG NINCSENEK benne (`!(key in settings)`). A `hooks` kulcs a megosztottban VAN, tehát az ágens régi blokkja NEM írja felül. **MÉG NEM MÉRT: lefut-e a provisioning MINDEN ágens-indulásnál, vagy csak bizonyos utakon.** A végső bizonyíték továbbra is a bélyeg mtime-ja egy valódi restart után -- és a negatívja NEM bizonyít (lásd a passzív mérés szakaszt) |
| `.git/hooks/` | csak `bash scripts/sync-hooks.sh` után | mérve 2026-08-27 16:0x (friday): a nyom-mechanizmus BEOLVADT, és a `prepare-commit-msg` sem a hookban, sem a `.d/` alatt NEM LÉTEZETT; a futó guard nulla naplósort írt. A `sync-hooks.sh` után a hook-fa pontosan három tétellel változott, és a viselkedés negatív kontrollal igazolt (override nélkül a fájl VÁLTOZATLAN) |

**EZ A SOR MA HÁROMSZOR ÁLLT MÁSKÉPP, ÉS EGYIK ÁLLÍTÁS SEM VOLT HAMIS** (marveen: „a következő

**A ZÁRÓ MÉRÉS** (friday, 16:27): a másolat mtime-ja MÁSODPERCRE egyezik a panel indulásával, 6/6,
három napot átfogva -- és a hook-aláírásokból pontosan EGY bejegyzés hiányzik minden másolatból (a
ma bekötött), többlet egyikben sincs. Egy egyezés lehet véletlen; hat, különböző napokon,
másodpercre nem az. *(A `marveen` sor nem egyezik, és ez magyarázat, nem kivétel: a fő ágenst az
`agent-scaffold.ts:120` közvetlenül a megosztott fájlra képezi, tehát nincs izolált másolata.)*
**Amit ez NEM állít:** hat INDULÁST figyelt meg, nem hat INDULÁSI UTAT.
**A „TELEPÍTVE VAN-E" KÉRDÉS CSAK AZ EGYIK HOOK-SÁVRA ÉRTELMES** (mandark mérte 2026-08-27 16:30,
eldobható klónon, tartalom-hash-sel; 8 azonos / 0 eltér / 0 hiányzik / 0 árva):

| hook-fajta | hogyan jut el | mi a kockázat |

| **git-hook** (`.git/hooks/`) | a telepítő MÁSOLJA a tartalmat | **DRIFT** -- a telepített példány eltávolodhat, és egy régi, telepített hook ugyanolyan néma, mint egy hiányzó, csak megtévesztőbb |
| **Claude Code hook** (`scripts/hooks/`) | a settings ÚTVONALLAL hivatkozik a munkafa fájljára | **nem tud driftelni, DE minden szerkesztés AZONNAL éles** -- ugyanaz a `scripts/` sáv |

Vagyis a két sáv nem ugyanaz a rendszer, és a rájuk vonatkozó kérdés sem ugyanaz.

WORKTREE-KKEL** (friday merte 2026-09-10 20:1x, VALODI pusholassal -- scratch repo, HELYI bare
remote, halozat nelkul, csak-kiiro hook). Egy worktree-bol inditott push a FO CHECKOUT hookjat
futtatta le.

A fo worktree aga barhonnan igy jon: `cat "$(git rev-parse --git-common-dir)/HEAD"`.
*(A `--git-common-dir` a fo checkoutbol RELATIV utat ad, worktree-bol ABSZOLUTAT.)*

**ES AZ A MONDAT, AMI ITT 2026-09-10-IG ALLT, ROSSZ KIFEJEZEST IRT ELO -- MERVE UGYANAZNAP**
(friday merte a `33b40c03`-on, marveen ismetelte a kartyan; a MERES igaz volt, a belole levezetett
ELOIRAS nem). Az allt itt, hogy a relativ utat a repo GYOKEREHEZ oldd fel (`--show-toplevel`),
"ne a cwd-hez". **Forditva igaz: a git MAGA szamol a cwd-vel, tehat a cwd a helyes horgony.**

    a repo GYOKEREBOL ..... common = `.git`      mindket horgony jo -- EBBEN mertuk, ezert nem tunt fel
    egy ALKONYVTARBOL ..... common = `../.git`   <- a git mar a cwd-hez adta
      toplevel-horgony .... `<gyoker>/../.git`   **NEM LETEZIK**
      cwd-horgony ......... `<gyoker>/scripts/../.git`   letezik

**A HELYES ALAK HORGONY NELKULI**, es a `install-no-force-push-hook.sh` mar ezt hasznalja:

*(Ez ugyanaz az alak, amit ez a lap mashol is rogzit: a MECHANIZMUS lett leirva a SZANDEK helyett,
es a mechanizmus pontosan abban az esetben volt helyes, amiben megfogalmaztuk. Amiert surgos volt
javitani: a `2b07f542` kartya EPP errol a kifejezesrol szol harom telepitoben, tehat aki azt a lap
regi szovege szerint javitja, egy nem letezo utat epit be.)*

ELORE MEGJOSOLHATO** (friday fogalmazta meg 2026-09-10, ot identitas-szivargas utan, amibol egy
a sajatja volt aznap delutanrol).

Harom identitas-or futott, mind HELYES, mind ZOLD -- es ot szivargas allt a fabol. Az ok nem az
egyik or hibaja: **mindharom PER-FELADAT, es mindegyiket a SAJAT feladataval EGYUTT irtak.**

*(A mert ellenorzes: egy osztaly-szintu ellenorzes az ELSO futasan negy tovabbi szivargast talalt
ugyanabban a faban, amit a harom per-feladat or evek ota zoldnek latott.)*

parancs). A `__tests__` KIMARAD -- egy lefordított teszt nem futó kód, és bevéve 46-ot ad,
két és félszeresét:

grep -rlE "scripts/[a-z0-9_-]+\.(sh|py|ts|mjs)" dist/ | grep -v '__tests__' | wc -l   # 18
grep -rl  "scripts/" dist/ | grep -v '__tests__' | wc -l                              # 23 (bármilyen említés)

A két szám KÉT KÉRDÉSRE válaszol: az első arra, hány modul hív egy KONKRÉT szkriptet; a második
arra, hány modul EMLÍTI a könyvtárat egyáltalán. A különbség nem hiba, hanem a populáció.

**ÉS A `scripts/` FEJLÉCEI DÖNTÉSEKET HORDOZNAK -- a kereshető listájuk GENERÁLT: `docs/scripts-decisions.md` (ma 52 döntés-fejléc, 42 amit egyik lap sem nevez); újragenerálás `python3 scripts/decision-index.py`, elavulás-ellenőrzés `--check` (exit 3, és a vitest is futtatja), a „lapon nevezik-e" oszlop pedig ÉLŐ lekérdezés (`--unnamed`), mert a bemenete a repón kívüli, követetlen fájl. Kártya: `72edf070`.**

**A `web/` sáv mérése, mert ez volt az, ami hiányzott:** egyedi jelölőt írtunk a `web/app.js`
végére, a `GET /app.js` visszaadta, majd visszaállítottuk. Nem a kódból következtettünk rá.

**Az ára már meg is volt.** 2026-08-23-án egy ügynök (friday) többször leírta a kártyáira és a
gazdának, hogy „nincs telepítve" -- olyan munkára, ami a `web/` sávon **már élesben futott**.
Nem hanyagság volt: két sávval számolt, mert csak kettő volt leírva. Egy hiányzó sor a
dokumentációban ugyanúgy hamis állítást termel, mint egy hibás mérés.

bizonyítja, hogy a futó folyamat betöltötte.

# a kérdés nem az, hogy ott van-e a fájl, hanem hogy HAT-e:
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  'http://localhost:3420/api/kanban?archived=1'      # 400 = az őr él; 200 = még nem
launchctl list | grep -c com.marveen.<unit>          # 0 = a plist beolvadt, de sehol nem fut

**ÉS EZ A SOR HAMIS ZÖLDET AD EGY ELFOGLALT LABELRE -- MÉRVE 2026-09-05 00:2x** (didi találta,
marveen újramérte kontrollal). A `grep -c` a label JELENLÉTÉT számolja, és a label ott van akkor is,
ha egy TÖRÖLT temp-könyvtárból származó plist foglalja el:

    launchctl list | grep -c com.marveen.telegram-progress-watchdog   ->  **1**  (= "egészséges")
    launchctl print gui/501/com.marveen.telegram-progress-watchdog
        path = /private/var/folders/.../T/tmp.tsuDNUA4Hn/case-g/home/Library/LaunchAgents/...plist
        runs = 12   <- és NŐ (didi 5-nél mérte, én 12-nél; 60 másodpercenként újraindul)

**A MECHANIZMUS:** az `install-telegram-progress-hook.test.sh` (g) esete a VALÓDI installert
futtatja `HOME` felülírással, az pedig `launchctl unload/load`-ot hív. **A `HOME` a PLIST HELYÉT
állítja át, a launchd DOMAINT nem** -- tehát a load a valódi `gui/501`-be regisztrál. A teszt saját
kommentje az ellenkezőjét feltételezi (*"on macOS launchctl is a no-op here"*).

**A HÁROM MÉRŐ, ÉS CSAK A HARMADIK DISZKRIMINÁL:**

    grep -c <label> .............. csak JELENLÉT -> egy elfoglalt labelre EGÉSZSÉGESET mond
    a `launchctl list` STATUSZ oszlopa ... a két elfoglalt unit `2`-t mutat, a hat egészséges `0`-t
                                  -> JEL, de nem diszkriminátor: egy bukó LEGITIM unit is `2`
    launchctl print ... | grep 'path =' ... **EZ dönt**: ha nem a /Users/<user>/Library/LaunchAgents/
                                  alá mutat, a label FOGLALT


## AZ ÖTÖDIK ÁLLAPOT: ÉL ÉS FUT, DE NINCS VERZIÓZVA (friday mérte, 2026-08-27)

mandark követetlen bizonyítéka, plusz friday 99 soros mérése -- `rulebook/otodik-allapot-esetek.md`.)*

percen belül -- akit a szerszáma `modified-since-read`-del megvédett, és aki flock nélkül írt.)*

    egy `git clean -fd` ........... mindkettőt nyomtalanul elviszi, és a kártya továbbra is
                                    azt állítja, hogy a bizonyíték megvan

`git ls-files` a fájlra. Egy commit-hash a kártyán ezt magától megoldja -- ami hash nélkül áll, azt
meg kell nézni.

EGYETLEN PÉLDÁNY** (friday mérte 2026-09-10, 99 soron; marveen ítélet-alakú kérdést adott át, és
friday MECHANIKUS PRÓBÁT adott vissza helyette):


## A HOOK-SÁV: NEM „AZONNAL" ÉS NEM IS „TELEPÍTÉSKOR" HAT, HANEM ÁGENSENKÉNT MÁSKOR

*(friday találta, marveen mérte, jarvis újramérte függetlenül, 2026-08-27. A teljes eset -- a
három egymást váltó állítás, a hook-készletek összevetése és a passzív mérés aszimmetriája --
`rulebook/letezes-es-eleres-esetek.md`.)*

**ágensenként külön időpont**. Ez nem a többi sáv „még nem ért oda" állapota: itt a változás KÉSZ,
és a kézbesítésének **nincs EGY időpontja**.

ideje futó példány esik ki belőle. Aki a koordinátort is méri, `tmux list-sessions`-ből induljon,
ne a névminta-tippből.

mechanizmus fontos, legyen mellette egy munkamenettől FÜGGETLEN út. *(A skills-pillanatfelvételnél
ez a 30 perces poll -- ezért NEM védelmi rés a fenti, és ezért maradt a poll a hook mellett.)*


## ÉS VAN EGY NEGYEDIK BEKÖTÉSI HELY, AMIT EZ A SZAKASZ SOHA NEM EMLÍTETT -- ÉS ÉPP AZ AZ

### ÉS VAN EGY NEGYEDIK BEKÖTÉSI HELY, AMIT EZ A SZAKASZ SOHA NEM EMLÍTETT -- ÉS ÉPP AZ AZ
### EGYETLEN, AMI KÖVETETT (friday mellékleletéből, marveen mérte, 2026-09-06)

A fenti egész szakasz KÉT helyről beszél: a megosztott `~/.claude/settings.json`-ről és az ágensek

friday jelezte, hogy az `outgoing-copy-gate` mind a HÁROM általa nézett helyen **0** -- miközben
aznap KÉTSZER elsült marveenen (ékezet-ellenőrzés egy Telegram-üzeneten). Megmérve:

**A PROJEKT-SZINTŰ fájl volt a hiányzó, KILENC repo-hookot hordoz** (db-destructive, egress,
inbox-drain, ledger-capture/outbound/replay, outgoing-copy, telegram-reply-directive/-guard,
tool-log-capture), **és KÖVETETT: `git ls-files .claude/settings.json` -> 1.**
KONTROLL: `package.json` -> 1, `CLAUDE.md` -> 0, tehát a mérő mindkét választ tudja adni.

(`~/.claude/projects/-Users-isti-marveen-agents-<név>`), tehát ez a fájl rájuk NEM hat -- pontosan
ezért 0 náluk az `outgoing-copy`. **Követett, és nem elég.**

    a KÖVETETT hely ....... csak engem ér el

**AMI EBBŐL A BEKÖTÉSI DÖNTÉSRE KÖVETKEZIK, ÉS MEGFORDÍTJA A KÉZENFEKVŐ ANALÓGIÁT:** a
`db-destructive-gate.py` alakra a legjobb minta (repo `scripts/hooks/` python kapu, exit 2 = deny,
fail-open) -- **de a `src/` alatt EGYETLEN hivatkozás van rá, és az egy TESZT.** Azt is kézzel
kötötték be, verziózatlan fájlokba: társ a bajban, nem precedens.

**A valódi precedens az `ensureEgressGate`** (`src/web/agent-scaffold.ts:562`), ami minden ágens
configjába ABSZOLÚT úton írja be a kapuját, KÓDBÓL. Az `ensure*` család a bekötés verziózott
forrása: `ensureAgentHooks`, `ensureAgentStalenessHook`, `ensureEgressGate`,
`ensureGovernanceGateCommands`, `ensureQuarantineReader`, ...

**KIMONDOTT HATÁR, ami ezt gyengíti, és a fenti táblázat is hordozza:** MÉRETLEN, hogy az `ensure*`
család MINDEN ágens-induláskor lefut-e, vagy csak bizonyos utakon. Ha csak provisioningkor, a
kézbesítés ugyanolyan kiszámíthatatlan, mint a megosztott fájlé -- a különbség akkor is megmarad,
hogy a FORRÁS verziózott. Aki bekötést csinál, mondja meg, MI hívja meg, és MIKOR.

0-t mutatott mindenhol, ahol néztük, és közben bizonyítottan tüzelt. Ez a lap „ha az állításod
ellentmond valaminek, ami már a képernyődön van" törvénye, most a hook-térképre alkalmazva: nem
hiányzó adat volt, hanem egy hely, amit senki nem kérdezett meg.)*


## (mandark lelete, friday döntötte meg a premisszát, marveen újramérte, 2026-09-05)

### (mandark lelete, friday döntötte meg a premisszát, marveen újramérte, 2026-09-05)

    scripts/kanban-write-gate.mjs        docblock :10-11  "Wired ONLY for the heartbeat worker
                                                           (agentGetsKanbanWriteGate in agent-scaffold.ts)"
    scripts/digest-provenance-gate.mjs   docblock :13-14  ugyanez
    a valóság a MI fánkon:               agentGetsKanbanWriteGate  ->  **0 előfordulás**

**A DOCBLOCK NEM HAZUDIK -- UPSTREAM IGAZ.** Mindkét fájl BÁJT-AZONOS az `origin/develop`-pal
(90e84882 / 478358e4), és ott a bekötés létezik.

**A HORDOZÓ COMMIT `929fb40`, NEM a `49af469` -- és ezt először rosszul írtam ide** (friday mérte,
marveen újramérte; a javítás azért sürgős volt, mert ez a szakasz ÁTVÉTELT ír elő és commitot nevez
meg):

    929fb40  2026-08-24  "kanban-write hard-gate for the heartbeat worker (HBFUTTATOIR824)"
             -> scripts/kanban-write-gate.mjs +120 | src/config.ts +4
                **src/web/agent-scaffold.ts +36**  | heartbeat-agent-scaffold.ts +3
             is-ancestor: origin/develop rc=0 | HEAD rc=1   (KONTROLL: gyökér-commit HEAD-en rc=0)
    49af469  2026-08-26  a KÉSŐBBI boot-túlélési javítás RÁ -- az `agent-scaffold.ts`-t **0**-szor érinti

**Aki a `49af469`-et veszi át, semmit nem állít helyre** -- megméri, `agentGetsKanbanWriteGate`
továbbra is 0, és a józan következtetés az, hogy az átvételi út nem működik. **Egy rossz hordozó
rosszabb, mint a hordozó hiánya: a helyes eljárásból ad magabiztos negatív eredményt.** A sáv
egyébként 14 commit, tehát egyik commit sem a munka egysége.

(didi gyűjtötte össze 2026-09-11, miután mindhármat külön-külön megmérték; a fenti `929fb40` eset
ÁTVÉTELI csapdaként van megfogalmazva, és pont ez rejtette el, hogy ugyanaz az alak a saját fánkon
is működik).

    computress .. cherry-pickelt commitok -> a NEVEZETT SHA nincs a fán, a TARTALOM igen
    didi ........ a saját `0ab8a829` hordozó-sora félig igaz volt
    friday ...... `f7ab1a4`-et nevezett meg; is-ancestor rc=1 -- a hordozó a `759eee6` volt

**Mindhárom esetben a HELYES eljárás (`is-ancestor` a megnevezett SHA-ra) adott magabiztos
NEGATÍVAT olyan munkára, ami VALÓJÁBAN KÉSZ.** A mérő nem romlott el: a kérdés az, hogy „ez a SHA
a fán van-e", és a válasza igaz. Csak nem az a kérdés, amit az ember feltesz -- az úgy hangzik,
hogy „leszállt-e a MUNKA".

(`LANDED_UNDER_ANOTHER_SHA` külön rekesz, 5 kártya a 343-ból), és a kimenete ezért használható --
de aki KÉZZEL mér, annak ez a második lépés nem jut eszébe, mert az első helyes választ adott.

**ÉS AMIT MI ÁTVETTÜNK, AZ ÉPP A DOKUMENTÁCIÓ VOLT, A DOKUMENTÁLT DOLOG NÉLKÜL.** A saját
`fc3c170`-ünk (08-29, a törzsön) újraépítette a gate SZKRIPTET -- és a szimbólum abban a commitban
EGYETLEN helyen szerepel: a szkript **docblockjában**. Ezért találja meg a `git log -S`, és ezért
nézett ki úgy, mintha nálunk valaha lett volna bekötés.

    ma, fájlonként:  agent-scaffold.ts 0  |  config.ts 0 (HEARTBEAT_AGENT_ID is 0)
                     kanban-write-gate.mjs 1  <- KIZÁRÓLAG a docblock-említés

    is-ancestor(49af469, HEAD) rc=1   |   origin/develop rc=0, origin/main rc=0
    fork/develop rc=1, fork/main rc=1
    KONTROLL: a saját HEAD~1-ünk origin/develop-on rc=1, HEAD-en rc=0 -> a mérő szétválaszt

COMMIT-AZONOSSÁGRA illeszt, örökre át-nem-vettként mutatná őket. A javítás az ÁTVÉTEL
(Isti 09-03-i szabálya), és addig ez a bekezdés a figyelmeztetés.

amit a repó tartalmaz -- beleértve egy IDEGEN upstreamről fetchelt commitot is.** Három ágens
épített rá állítást, és egyikünk sem kérdezte meg az ősködést. A tévedés iránya a legrosszabb:
"nálunk volt és elveszett" (=> keressük meg, állítsuk vissza) ahelyett, hogy "soha nem volt nálunk"


## ÉS A REPO-BELI KERESÉS VAK A LAUNCHD-FOGYASZTÓRA (két mért eset egy napon)

**ÉS A `git ls-files | grep '\.plist$'` ITT ÜRESET AD, PEDIG MIND A NYOLC KÖVETVE VAN**
(marveen mérte magán 2026-08-27 18:1x-kor, miközben épp a fenti sort frissítette).

A követett fájlok neve `scripts/com.marveen.<unit>.plist.template` -- a `$` horgony tehát
SZERKEZETILEG kizárja őket. Az üres találatból egy fél percig azt olvastam ki, hogy **egyetlen
plist sincs verziózva**, vagyis nyolc futó launchd egység áll fedezet nélkül. Nem ez volt igaz:
a mérőm horgonya szűkebb volt a kérdésnél.

fogta meg -- épp ellenkezőleg, a kényelmetlen válasz hitelesebbnek érződött. Ami megfogta, az egy
mechanikus kontroll volt: ugyanaz a kérdés, MÁSIK mérővel.


## TESZTEKET" HEURISZTIKA SZERKEZETILEG NEM LÁTJA (friday mérte magán ÉS rajtam, 2026-09-11)

### TESZTEKET" HEURISZTIKA SZERKEZETILEG NEM LÁTJA (friday mérte magán ÉS rajtam, 2026-09-11)

Két `scripts/`-et érintő merge után (`b24f6ae`, `c50552d`) lefuttattam a KÉT érintett shell-tesztet
-- 41/41, 13/13, plusz egy 16/16-os regressziós kontroll. **Mind a három helyes volt, és a törzs
közben PIROS volt.** A `decision-index --check` `rc=3`-at adott, és semmi nem szólt: az őr csak
akkor tüzelt, amikor valaki lefuttatta a teljes készletet.

**ÉS EZ NEM ALAPOSSÁG KÉRDÉSE, HANEM SZERKEZET** (friday mérése):

    b24f6ae érinti a `src/__tests__/decision-index.test.ts`-t ....... **0** fájl
    c50552d érinti ................................................. **0**
    bármelyik érinti a `docs/scripts-decisions.md`-t ................ **0**

**Az „érintett tesztek" heurisztika tehát KONSTRUKCIÓBÓL zárja ki.** Az őr egy olyan fájlt olvas,
amit egyik ág sem érint, és pontosan AZOKTÓL a fájloktól avul el, amiket érintenek -- az új
`scripts/` döntés-fejlécektől. **A heurisztika és a bukás diszjunkt, tervezésből.**

> máshol a fában.** Egy parancs, és pont azt a kérdést válaszolja meg, ami a diffhez képest
> odanemtartozónak látszik:

*(A javítás `6d74ec8`. És a mért irány itt is a megnyugtató: a merge sikeres, a két futtatott teszt
zöld, a commit létrejön -- a piros törzs pedig addig áll, amíg valaki más rá nem fut.)*


## HA EGY KÁRTYA COMMITOT TERMEL, A LEZÁRÁSI FELTÉTELE NEVEZZE MEG A SÁVOT

**Nem kérünk visszamenőleges javítást** a tizenegy kártyán: a nagy részük a build után úgyis
lezárul. A konvenció a KÖVETKEZŐ kötegnél számít.
