# Inter-agent kommunikáció -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.
A lapon a TÖRVÉNY, mind a 10 PARANCS, a zsh-táblázat és a teljes default-deny eljárás maradt.)*

---

## Inter-agent kommunikáció

Az ágensek közvetlenül tudnak egymásnak üzenni egy közös SQLite üzenetsoron keresztül.

### Üzenet küldése másik ágensnek
*(A mért esetek -- ki, mikor, milyen szöveggel, mi lett belőle: `rulebook/uzenetkuldes-esetek.md`.)*

```bash
bash scripts/agent-msg.sh marveen TARGET_AGENT "Feladat leírása."
# -> OK id=<n> queue=<hányan várnak> (~<perc> késés)   vagy   FAIL
```

**EGY ÜZENET CSAK AKKOR SZÁMÍT ELKÜLDÖTTNEK, HA VISSZAJÖTT EGY `id`.** A gyakori
`curl -s ... >/dev/null && echo sent` minta NÉMA küldés-hibát ad: a curl `0`-val tér vissza egy
401/400/5xx-re is, a címzett sosem kapja meg, és két ágens végtelenül várhat egymásra. Nyers
curl-nél KÖTELEZŐ a HTTP-kód ÉS az `id` ellenőrzése, és újraküldés, ha nincs.

### A HÉJ NEM ELHARAPJA A SZÖVEGET, HANEM LEFUTTATJA -- ÉS AZ `OK id=` UTÁNA IS KIÍRÓDIK

Idézőjeles argumentumban a visszaperjel (`` ` ``) és a `$` **parancshelyettesítés**. Két kimenet,
és a második nem fokozat, hanem kategóriakülönbség:

    a héj ELHARAPJA  -> egy szó kiesik, az `OK id=` megjön, a küldés SIKERESNEK látszik
    a héj VÉGREHAJTJA -> egy PARANCS fut le, ott, ahol állsz (egy közös checkoutban másvalaki fáján)

**A PONTOS MEGKÜLÖNBÖZTETŐ: DUPLA IDÉZŐJEL kontra APOSZTRÓF, nem `printf` kontra heredoc.**

```bash
printf '%s\n' "dupla:     egy `status` szuro"    # -> `command not found: status`, a szó KIESIK
printf '%s\n' 'aposztrof: egy `status` szuro'    # -> ép marad
```

**A SZABÁLY NEM A HOSSZRA VONATKOZIK, HANEM A TARTALOMRA.** Ha van benne visszaperjel, `$`,
idézőjel, vagy bármi, amit nem te írtál szó szerint, STDIN-en megy:

```bash
f=$(mktemp)          # NE fix nevet: a /tmp KÖZÖS
cat > "$f" <<'EOF'
Ide jöhet bármi: `backtick`, $valtozo, "idezojel".
EOF
bash scripts/agent-msg.sh marveen TARGET_AGENT - < "$f"
```

A `<<'EOF'` **aposztrófos** alakja kötelező: aposztróf nélkül a heredoc IS behelyettesít.

**ÉS A `git commit -m` ESETE NEM „CSENDESEBB": a héj HANGOSAN panaszkodik
(`command not found: in`), DE A COMMIT LÉTREJÖN** -- a hibaüzenet egy SIKERES művelet mellett áll,
és a siker elnyomja. A `secret-gate` PASS-t ad, a `git log --oneline -1` a várt sort mutatja.

    a NÉMA hiba ....... nincs jelzés                   -> nincs mit észrevenni
    EZ ................ VAN jelzés, egy SIKER mellett  -> van mit észrevenni, és nem nézed meg

```bash
git log -1 --format=%B | grep -F '<amit beleírtál>'     # a `-F`: a backtick ne mintaként menjen
```

**A MÉRŐT IS EL LEHET RONTANI UGYANOTT:** egy soronkénti minta nem látja, ha a törölt szó helyén a
maradék KÉT SORRA tördelődött. Több soros ellenőrzéshez `python3` + `re.search(..., DOTALL)`, vagy
egyszerűen olvasd el a `%B` kimenetét. **És a következmény, amiért érdemes elsőre elkerülni: a
force-push nálunk tiltott alak, tehát egy megcsonkított commit-üzenet VÉGLEGES** -- ellentétben az
üzenetküldéssel, ahol újra lehet küldeni.

**ÉS A MUNKAFÁJL A SESSION-SCRATCHPADBE MENJEN, NE A `/tmp`-BE.** A `/tmp` közös névtér: egy ott
hagyott, órákkal korábbi fájl beolvasható, és MÁS ÁGENS szövegét postázza a te neveden, `OK id=`-vel.
**És ha egy összetett parancs ELHAL, a benne lévő fájl-írásokat tekintsd MEG NEM TÖRTÉNTNEK** --
írd újra a fájlt; ne csak a küldést ismételd meg.

**A helper a HTTP-kódot és az `id`-t ellenőrzi; a TÖRZSET nem tudja.** Egy sikeres küldés semmit
nem állít a tartalomról.

**ÉS HA EGY SZÖVEG KÉT CÍMZETTNEK MEGY, NEVEZD MEG AZ EMBERT -- SOHA NE „TE"** (dexter fogta meg
marveenen, 2026-09-10): *„igazad volt, amikor kimondtad..."* a leletet TÉNYLEG találó ágensnek
helyes attribúció, a másiknak MÁSVALAKI munkájáért járó elismerés.

    egy masodik szemelyu nevmas ket cimzettes uzenetben AHHOZ rendel, AKI EPP OLVASSA

Ez az ALAK hibája, nem a tartalomé, és minden broadcastnál újra előfordul. *(A megtalálás iránya a
ritka: a címzett azt jelezte, hogy hozzá NEM járó elismerést kapott. A hízelgő irány az, amit senki
nem ellenőriz.)*

### AZ "ELKÜLDVE" NEM "MEGÉRKEZETT" -- A SOR ÁLLAPOTA

A router csak a címzett paneljének IDLE réseibe tud injektálni, tehát egy dolgozó ágens sora
annyira ürül, amennyire a fordulói véget érnek. Egy hosszú forduló alatt nulla kézbesítés
lehetséges, és ez nem hiba.

    0-2 queue ... mehet
    3+ queue .... a helper FIGYELMEZTET, és igaza van. NE küldj újabbat -- írd a kártyára.
                  A `pending` azt jelenti, hogy az előzőt EL SEM OLVASTA.

**Az üzenet TOL, a kártya HÚZAT. De a kártya csak azt húzatja, aki MÁR ODANÉZ:** ha a címzett
épp nem azon a kártyán dolgozik, a komment TÁROL, nem kézbesít. Ilyenkor a komment a NYOM, és a
levél továbbra is tartozás -- küldd el, amint a sor ürül.

**RESTART UTÁN A KÉT ÁLLAPOT ELLENTÉTES TEENDŐT KÍVÁN:**

    `pending`   -> a SORBAN van (adatbázisban, nem a panelben), TÚLÉLI a restartot -> NE küldd újra
    `delivered` -> a panelbe MÁR beinjektálódott -> EZT viheti el a restart
    `failed`    -> a munkamenet HIÁNYZOTT a teljes újrapróba-ablakban -> ELVESZETT, KÜLDD ÚJRA
                   (`[handoff-failure]` értesítés megy a küldőnek)

**DE A `failed` -> KÜLDD ÚJRA NEM MECHANIKUS** (didi mérte magán 2026-09-10): hat `failed` üzenete
közül öt egy RÉGEN LEZÁRT munkáról szóló beszélgetős válasz volt, egy pedig próba egy NEM LÉTEZŐ
ágensnek. Mechanikusan újraküldve ez öt zavarba ejtő levelet termelne lezárt munkáról.

> **A `failed` azt mondja meg, hogy a KÉZBESÍTÉS nem történt meg. Azt NEM, hogy a TARTALOM ma is
> érvényes.** Mielőtt újraküldesz, nézd meg, MIKOR keletkezett és MIRŐL szól.

**A SOR MÉLYSÉGÉT NE AZ API-BÓL MÉRD: 50 SOROS ABLAKA VAN, ÉS HAMIS NULLÁT AD.**

```bash
# A SOR MELYSEGE: `pending` CSAK. A `failed` MAS KERDES -- lasd alatta.
python3 -c "
import sqlite3
c=sqlite3.connect('file:/Users/isti/marveen/store/claudeclaw.db?mode=ro',uri=True)
print(list(c.execute(\"select id from agent_messages where to_agent=? and status='pending'\", ('<agens>',))))"
```

**A `status in ('pending','failed')` ALAK HIBÁS, ÉS HALOTT ÜZENETEKET SZÁMOL** (mérve dexteren
2026-09-06: a régi recept **12**-t adott, ebből `pending` **0**, `failed` 12, a legrégebbi napokkal
korábbról; a helper saját száma `queue=0`. KONTROLL: minden ágensre lefuttatva csak dexter volt
érintett). **A szabály (3+ vár -> ne küldj) ezzel dexterre ÖRÖKRE tiltana**, miközben SENKI nem vár
-- és a kár a csendes fele: aki követi a lapot, KÁRTYÁT ír egy DÖNTÉS helyett.

**A `failed` tehát SEMMIT nem mond a címzett terheléséről**, és soha nem avul el. A MÁSODIK kérdés
(„van-e mit újraküldenem") külön soron: ugyanez a lekérdezés `from_agent=<sajat>` és
`status='failed'` szűrővel.

*(A SZERSZÁM MÁR HELYESEN CSINÁLTA -- a lap volt a hibás: az `agent-msg.sh` `status='pending'`-gel
kérdez, és a kommentje ki is mondja, miért. Aki a két számot eltérőnek látja, a LAPOT javítsa.)*

**ÉS A MEZŐNEVEK `from_agent` / `to_agent`, NEM `from` / `to`.** Egy `?to=...` szűrésű lekérdezés
HTTP 200-at és ÜRES listát ad -- bájt-azonos egy valódi „nincs várakozó üzenet" válasszal.
KONTROLL, ami azonnal megfogja: keresd meg a SAJÁT, épp elküldött üzenetedet a válaszban.

### EGY BURKOLÓ VISSZACSINÁLHATJA A HELPER EGYETLEN ÉRTELMÉT -- MINDKÉT IRÁNYBAN

A helper az `OK id=`-t a **stdout**-ra, az indoklást és a figyelmeztetést a **stderr**-re írja.

    a stderr ELDOBVA .......... egy `exit 2` megtagadás NÉMA lesz -> „elküldöttként" jelented
    a jel KISZORÍTVA (`tail`) . a figyelmeztetés kitolja az `OK id=` sort -> ÚJRAKÜLDESZ, és a
                                címzett sorába KÉT azonos üzenet kerül

```bash
bash scripts/agent-msg.sh ... 2>&1 | grep -E 'OK id|FAIL|NEM KULDTEM'
```

Ez általánosabb az üzenetküldésnél: **valahányszor egy őrzött parancsot burkolsz, a burkoló
eldobhatja azt a csatornát, amin az őr beszél.** A parancs lefut, a kimenet üres, és az üresség
pontosan úgy néz ki, mint a siker csendje. És az aszimmetria: egy elnyelt HIBA néma veszteséget
ad, egy elnyelt SIKER duplikátumot -- és üzenet-törlő végpont nincs.

### A ZSH NEM TÖRDEL SZÓRA -- ÉS A HIÁNYZÓ ITERÁCIÓ ÜRES KIMENETET AD

`for x in $LISTA` a zsh-ban **EGYSZER** fut le, az egész listával egy argumentumként; bash-ban
N-szer. A kár iránya: a hiányzó iterációk kimenete ÜRES, és az üres kimenet „nincs találat"-nak
olvasódik.

| alak | zsh szóköz | bash szóköz | zsh sortörés | bash sortörés |
|---|---|---|---|---|
| `for x in $VAR` | **1** | 3 | **1** | 3 |
| `while IFS= read -r x ... <<< "$VAR"` | **1** | **1** | 3 | 3 |
| `for x in $(echo "$VAR")` | 3 | 3 | 3 | 3 |

**Mindhárom alak MÁS dologtól függ** (szeparátor, héj, tartalom -- a `$(echo)` egy `*`-ot
GLOBBÁ terjeszt), tehát nincs biztonságos forma. **Ezért a szabály nem az ALAKRA szól:**

> **Írasd ki a ciklussal, HÁNY elemet fog bejárni -- ÉS AZ ELSŐ ELEMET.** `db=1 elso=[a b c]`

Az első elem azért kell, mert egy mérésben tipikusan NEM tudod az elvárt N-et; ha az egész lista
egy elemként érkezik, az első elem MAGA A LISTA, láthatóan.

**ÉS A `2>/dev/null` EGY HANGOS BUKÁST NÉMA NULLÁVÁ ALAKÍT.** Egy mérőben a stderr elnyelése nem
zajszűrés, hanem a jelzés eldobása -- a zajszűrés a KIMENET szűrése (`| grep`).

*(A repó saját scriptjeit ez nem érinti: 96 követett `.sh`, mind bash shebanggel. A csapda az
AD-HOC mérő parancsokban él, mert a Bash tool zsh-t futtat.)*

**ÉS A CIKLUS NEM AZ EGYETLEN ALAK -- DE A MEGKÜLÖNBÖZTETŐ NEM A ZSH, HANEM HOGY VÁLTOZÓN ÁT
MEGY-E.** Mérve, ugyanabban a héjban, ugyanazon a 155 refen:

    git rev-list --count HEAD --not $(git for-each-ref ...)   ->  680        <- KOZVETLEN `$(...)`: tordel
    R=$(git for-each-ref ...); git rev-list --count HEAD --not $R
        -> `fatal: failed to stat` -- a 155 ref EGY argumentumkent, es a kiirt darabszam URES

A zsh a PARANCS-BEHELYETTESÍTÉST (`$(...)`) szóra tördeli, a PARAMÉTER-BEHELYETTESÍTÉST (`$VAR`)
nem. **Ezért a „mi létezik KIZÁRÓLAG itt" recept a Delta-CRM lapján KÖZVETLEN `$(...)` alakban
HELYES, és NE „javítsd ki".** A csapda a hoistolás: amint valaki változóba emeli, elnémul.

```bash
git rev-list --count HEAD --not --remotes=fork --remotes=origin    # valtozo-mentes: mindket bajt megszunteti
# KONTROLL: ugyanez egy MÁR PUSHOLT csúcson -> 0, és csak az egyik remote ellen -> nem-nulla
```

**ÉS AZ ELNYELT `rc` EGY `&&` LÁNCBAN NEM ROSSZ SZÁMOT AD, HANEM ÁTÍRJA, MIRŐL SZÓL A MÉRÉS:**

    git worktree add ... 2>&1 | tail -1 && <a meres>
    a `worktree add` ELHASALT (`already exists`)  ->  de az `rc` a `tail`-e: **0**
    -> a lánc TOVÁBBMENT, és a mérés egy MÁR LÉTEZŐ scratch worktree-ben futott le

**Ez nem fokozat, hanem osztály.** Egy elnyelt `rc` a szám HELYÉN hibás számot ad, amit utólag meg
lehet kérdőjelezni. Egy `&&` LÁNCBAN a KÖVETKEZŐ parancsot futtatja le rossz helyen -- és az egy
**tökéletesen hihető mérést** ad egy MÁSIK alanyról. Nincs mit megkérdőjelezni.

```bash
git worktree add "$WT" --detach "$SHA" || { echo "A WORKTREE NEM JOTT LETRE -- ALLJ"; exit 1; }
# es a meres UTAN: a fa allapota alljon vissza oda, ahol talaltad
```

> **Környezetet ÉPÍTŐ parancs SOHA ne álljon cső mögött egy `&&` láncban.** Ha rövid kimenet kell,
> a kimenetet szűrd, az `rc`-t ne add el.

### Fontos szabályok
- Csak futó ágensnek lehet üzenni (tmux session kell hozzá)
- Az elérhető ágensek listája: `curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/agents`

### ÉS UGYANEZ A HÉJ EGY MÁSODIK MÉRŐT IS ELRONT: `echo "$S" | wc -l` NEM SORSZÁMLÁLÓ
(dexter mérte és javította magán, 2026-09-05; marveen újramérte kontrollal.)

A Bash tool zsh-t futtat, és a zsh BEÉPÍTETT `echo`-ja **kibontja a `\n` literálokat valódi
sortörésre**. Egy fájl hosszát négy mérővel mérve, UGYANAZON a fán:

    git show ... | wc -l ....................... 872   <- helyes
    S=$(git show ...); echo "$S" | wc -l ....... **876**   <- amit hasznalt
    a mert fajlban `\n` literal: **4**   |   a SZOMSZED fajlban 0, es ott 540 = 540

**ÉS AMIÉRT NEM LÁTSZOTT ROSSZNAK -- EZ A HORDOZHATÓ RÉSZ: A TORZÍTÁS FÁJL-FÜGGŐ.** Ugyanaz a
parancs a SZOMSZÉD fájlon HELYES számot adott, tehát a mérő pontosan abban a körben látszott
működni, amelyikben használták -- **és a két fájl ÖSSZEVETÉSE volt maga a mérés.**

    egy mérő, ami MINDENHOL téved ...... a kontroll megfogja
    egy mérő, ami az EGYIK alanyon pontos és a MÁSIKON felfúj, miközben épp a KETTŐ KÜLÖNBSÉGE
    a lelet ............................ **rosszabb, mint a mindenhol téves**

```bash
git show <ref>:<út> | wc -l          # közvetlenül, csövön
printf '%s\n' "$S" | wc -l          # ha MÉGIS változóban van: a printf NEM értelmez
# KONTROLL, ingyen: ha a fájl tartalmazhat `\n` literált, mérd MINDKÉT alakkal; az eltérés MAGA
# a literálok száma, és a `wc -l` nyer
```

*(A megtalálás oka nem a gondosság volt: valaki NYITVA HAGYTA a 872/876 eltérést ahelyett, hogy
kibékítette volna. A TIPPELT oka HAMIS volt. **A tipp nem számított; az számított, hogy nem
simította el.** A nézeteltérés mérőeszköz.)*

### Sub-ágens ismeretlen-sender ping kezelése (auto-approval, default-deny)

Amikor egy sub-ágens inter-agent üzenetet küld neked ilyen formában:
`Ismeretlen sender [ID] jelezett első üzenettel: '...'. Ki ez, mit válaszoljak?`
(ez a sub-ágens ARANYSZABÁLYA: minden új senderId első üzeneténél hozzád fordul), NE kérdezd reflexből Isti-t. Helyette:

1. **Allowlist-összevetés (a te SAJÁT párosított allowlistád):** nézd meg, hogy az `[ID]` szerepel-e a saját csatornád `allowFrom`-jában:
   ```bash
   python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('IGEN' if sys.argv[2] in d.get('allowFrom',[]) else 'NEM')" "$HOME/.claude/channels/telegram/access.json" "[ID]"
   ```
   (Slack/Discord install esetén a megfelelő `~/.claude/channels/<provider>/access.json`.) Az `allowFrom` azokat a sendereket tartalmazza, akiket Isti MÁR explicit párosított/jóváhagyott a csatornán.

2. **Ha az `[ID]` BENNE van az allowFrom-ban** → AUTO-ENGEDÉLYEZD (NE kérdezd Isti-t): küldj inter-agent választ a sub-ágensnek, hogy a sender jóváhagyott párosított kontakt, és add át amit tudsz róla (memóriából). **Auditáld:** jegyezd fel (napi napló / memória) MELYIK allowlist-match alapján engedélyezted, pl. `auto-approve sender [ID] -- allowFrom match`.

3. **Ha az `[ID]` NINCS az allowFrom-ban** → **DEFAULT-DENY**: NE találj ki identitást, NE engedélyezd magadtól. Eszkaláld Isti-hez Telegramon (reply tool, a chat_id-t lásd lentebb): `Egy sub-ágenshez ismeretlen, NEM párosított sender [ID] írt: '...'. Jóváhagyod?` — a sub-ágens addig a generikus "egy pillanat, ellenőrzöm" választ adja.

Lényeg: KIZÁRÓLAG az `allowFrom`-on szereplő (általad már párosított) sendert engedélyezd auto; minden más Isti-döntés. Ez az ARANYSZABÁLY szellemének (default-deny) betartása, csak a már-párosított esetekre gyorsítva — a senderId a végső azonosító, NEM a self-claimed név.


---

## A LAPRÓL IDEKÖLTÖZTETETT BIZONYÍTÉK (marveen, 2026-09-19 -- lap-rövidítés)

*Ezek a mért esetek a `CLAUDE.md` „AZ »ELKÜLDVE« NEM »MEGÉRKEZETT«" szakaszában álltak. A
SZABÁLYOK ott maradtak; ide a bizonyíték került. A költöztetés ELŐTT mérve: ebből a hat tételből
egyik sem volt ebben a fájlban (kontroll: `hat \`failed\``, `50 soros` és `kuldve` VOLT).*

### 1. Az időkritikus engedély, amit a sor-kapu tartott vissza -- 36 perc

A „3+ vár -> írd a kártyára" szabály HELYES egy INFORMÁCIÓRA, és ELÉGTELEN egy IDŐKRITIKUS
ENGEDÉLYRE. Mért eset: egy jóváhagyás **36 percig** nem ért el a címzetthez, miközben egy éles
adatvesztés-csapda állt.

    INFORMACIO / NYOM ....... a kartya a helyes hely, es ha kesve olvassak, nem tortent semmi
    IDOKRITIKUS ENGEDELY .... a kartya NEM kezbesit, es a keses MAGA a kar

A harmadik lehetőség: **ellenőrizd vissza.** Ha egy ENGEDÉLYT vagy MEGÁLLÍTÁST kellett kártyára
írnod, mert a sor tele volt, nézd meg pár perc múlva, ürült-e, és akkor küldd el EGY SOROSAN is.

### 2. A hat `failed`, amiből öt halott volt

Hat `failed` üzenetből **öt** egy RÉGEN LEZÁRT munkáról szóló beszélgetős válasz volt, egy pedig
próba egy **NEM LÉTEZŐ ágensnek**. A `failed` azt mondja meg, hogy a KÉZBESÍTÉS nem történt meg.
Azt NEM, hogy a TARTALOM ma is érvényes.

### 3. A sorban álló üzenet FÉNYKÉP, nem kérdés

Mért eset: egy „még mindig nem tud beolvadni" kérdés a válasz LÉTEZÉSE ELŐTT íródott, és a plafon
tartotta vissza; a fogadó élő kérdést látott, és egy MEGAKADÁSRA küldött üzenetet, **ami nem
létezett**. Olvasáskor ingyen eldönthető: minden üzenet viseli a `[KULDVE: <ido>]` sort.

*(A plafon és a sor-kapu ezt SÚLYOSBÍTJA, nem okozza: minél jobban lassítja a kézbesítést egy
védelem, annál öregebb a levél, amikor megérkezik.)*

### 4. A 98 perces `pending` -- a kor is mérendő, nem csak a mélység

Mért eset: **98 perces** `pending` egy élő, termelő ágensnél. Egy helyesbítés értéke időfüggő:
a késés nem gyengíti, hanem **MEGFORDÍTJA**.

### 5. A végpont FAIL-CLOSED -- és a lap ennek az ellenkezőjét állította 2026-09-19-ig

didi mérte, marveen újramérte:

    ?from= / ?to= / barmilyen KITALALT parameter ... **HTTP 400**, es a torzs MEGNEVEZI
                                                     a tamogatottakat (agent, status, limit, before)
    ?agent= / ?limit= ............................. 200

Valaki MEGÉPÍTETTE azt a kaput, aminek a hiányát a régi szöveg feltételezte, és az indokot bele is
írta. A régi lap-szöveg (HTTP 200 + üres lista) egy MÁR JAVÍTOTT fán állt jelen időben.

KONTROLL, ami ingyen van: kérdezz le egy TÁMOGATOTT paramétert is (`?agent=`) ugyanabban a
futásban. Ha az 200-at ad és a tiéd 400-at, a paraméter-NÉV a hibás, nem a hozzáférés.

### 6. EGY KIVÁLTÓ OK, NÉGY OLVASÓ, HÁROM KIMENET -- és csak EGY hangos

marveen először úgy írta a lapra, hogy a státusz-ellenőrzés nélküli olvasó „némán kis számmá
alakít" egy 400-at. Az EGY példány, nem a mechanizmus. didi mérte, marveen újramérte, ugyanazon a
törzsön, UGYANARRA a 400-as válaszra:

    len(d) ........................................ 1
    [m for m in d] ................................ 1
    [m for m in d if isinstance(m, dict)] ......... 0
    [m for m in d if m.get('from_agent')==X] ...... **AttributeError -- HANGOSAN bukik**
    KONTROLL egy VALODI 200-on: lista, len 3, az isinstance-forma is 3

**És előre nem tudod, melyiket kapod.** Ezért a szabály nem „vigyázz a lista-bejárással", hanem a
szigorúbb: **NÉZD MEG A STÁTUSZT, mert a TÖRZS ÉRTELMEZÉSÉNEK kimenete nem jelzi megbízhatóan,
hogy hiba történt.**

*(Hogy a skillben szereplő `0` PONTOSAN melyik olvasóból jött, az MÉRETLEN -- a skillben nyomtatott
alak épp a hangosan bukó. didi ezt kimondta a kártyán ahelyett, hogy visszafelé levezetett volna
egy illeszkedő történetet.)*
