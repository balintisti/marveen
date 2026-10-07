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


<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1450-1455, szó szerint -->
*(A mért esetek TELJES szövege -- a héj-esetek, a sor-mérések, a 872/876-os wc-eltérés, a
`failed`-újraküldés hat esete és a saját forgalom-mérésem -- `rulebook/inter-agent-esetek.md`.
14 683 karakter volt itt. A `rulebook/uzenetkuldes-esetek.md` továbbra is érvényes.)*

Az ágensek közvetlenül tudnak egymásnak üzenni egy közös SQLite üzenetsoron keresztül.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1473-1504, szó szerint -->
### A HÉJ NEM ELHARAPJA A SZÖVEGET, HANEM LEFUTTATJA
*(A teljes eljárás, a mért esetek és az auditálás: a `hej-elharapja-a-szoveget` SKILL, ami magától
felbukkan, amikor szabad szöveget adsz át héj-argumentumként. 2 693 karakter volt itt.)*

Idézőjeles argumentumban a visszaperjel és a `$` **parancshelyettesítés**, és a két kimenet nem
fokozat, hanem kategóriakülönbség:

    a hej ELHARAPJA  -> egy szo kiesik, az `OK id=` megjon, a kuldes SIKERESNEK latszik
    a hej VEGREHAJTJA -> egy PARANCS fut le, ott, ahol allsz (masvalaki fajan)

**A SZABÁLY NEM A HOSSZRA VONATKOZIK, HANEM A TARTALOMRA.** Ha van benne visszaperjel, `$`,
idézőjel, vagy bármi, amit nem te írtál szó szerint: APOSZTRÓFOS heredoc vagy FÁJL -- és a
munkafájl a session-scratchpadbe menjen, ne a `/tmp`-be (közös névtér).

**ÉS A TERMINÁTOR LEGYEN EGYEDI, HA A TARTALOM MAGA IS HEREDOCOT EMLÍT.** Mérve magamon
2026-09-19, épp ennek a bekezdésnek az írásakor: a tartalomban álló `EOF` sor LEZÁRTA a külső
heredocot, és a parancs `unmatched` hibával elhasalt. Itt hangos volt; egy `cat`-nél néma
csonkolás lett volna.

**ÉS A „STDIN" ÖNMAGÁBAN NEM VÉDELEM** (didi mérte magán, ugyanaznap): egy `printf`-ből csövezett
STDIN ugyanúgy veszít, ha a `printf` argumentumai dupla idézőjelesek -- a héj már behelyettesített,
mielőtt bármi a csőig ért. **Bármely dupla idézőjeles argumentum BÁRHOL a csővezetékben újranyitja.**

**ÉS EGY ELNYELT MUTÁCIÓ ROSSZABB EGY ELNYELT ÜZENETNÉL** (dexter, ugyanaznap): egy üzenet szavakat
veszít, amit VISSZA lehet olvasni; egy mutáció, ami nem alkalmazódott, **bizonyítékot gyárt a
megnyugtató irányba** -- a készlet zöld marad, és feljegyzel egy túlélő mutációt, ami meg sem
történt. A precedens a repóban: `mechanism-proof.mjs` a horgony-találatokat SZÁMOLJA, és
`hits !== 1` esetén `exit 2`.

> **Minden mutáció ÁLLÍTSA, hogy ALKALMAZÓDOTT, mielőtt az eredményt elolvasod** -- és az ÁLLÍTÁS
> se menjen át dupla idézőjelen, különben az őr és az őrzött együtt hal meg.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1505-1584, szó szerint -->
### AZ "ELKÜLDVE" NEM "MEGÉRKEZETT" -- A SOR ÁLLAPOTA

A router csak a címzett paneljének IDLE réseibe tud injektálni. **Egy hosszú forduló alatt nulla
kézbesítés lehetséges, és ez nem hiba.**

    0-2 queue ... mehet
    3+ queue .... a helper FIGYELMEZTET. NE kuldj ujabbat -- ird a kartyara.
                  A `pending` azt jelenti, hogy az elozot EL SEM OLVASTA.

**Az üzenet TOL, a kártya HÚZAT. De a kártya csak azt húzatja, aki MÁR ODANÉZ.**

**A SZABÁLY RÉSE: a „3+ vár -> írd a kártyára" HELYES egy INFORMÁCIÓRA, és ELÉGTELEN egy
IDŐKRITIKUS ENGEDÉLYRE** (mért eset: 36 perc késés élő adatvesztés-csapda mellett). Ilyenkor
**ellenőrizd vissza**: pár perc múlva nézd meg, ürült-e a sor, és küldd el EGY SOROSAN is. A kártya
a nyom, az üzenet a kézbesítés; időkritikusnál mindkettő kell.

**RESTART UTÁN A HÁROM ÁLLAPOT ELLENTÉTES TEENDŐT KÍVÁN:**

    `pending`   -> a SORBAN van (adatbazisban), TULELI a restartot   -> NE kuldd ujra
    `delivered` -> a panelbe MAR beinjektalodott                      -> EZT viheti el a restart
    `failed`    -> a munkamenet HIANYZOTT a teljes ujraproba-ablakban -> ELVESZETT, kuldd ujra

**DE A `failed` -> ÚJRAKÜLDÉS NEM MECHANIKUS:** a `failed` a KÉZBESÍTÉSRŐL szól, nem arról, hogy a
TARTALOM ma is érvényes. Mielőtt újraküldesz, nézd meg, MIKOR keletkezett és MIRŐL szól.

**ÉS A FOGADÓ OLDALÁN: EGY SORBAN ÁLLÓ ÜZENET FÉNYKÉP, NEM KÉRDÉS.** Ha úgy érkezik, hogy te már
megválaszoltad, NEM a küldő vár, hanem a LEVÉL. Olvasáskor ingyen eldönthető: minden üzenet viseli
a `[KULDVE: <ido>]` sort.

**ÉS A KÜLDŐ OLDALÁN UGYANEZ, ÉS EZ EDDIG NEM ÁLLT ITT: AZ ÜZENET A MEGÍRÁSAKOR FÉNYKÉP, A
KÉZBESÍTÉS VISZONT KÉSŐBB TÖRTÉNIK -- TEHÁT EGY SÜRGŐS KIOSZTÁS LANDOLHAT AZUTÁN, HOGY A MUNKA
ELKÉSZÜLT** (deeper fogalmazta meg 2026-09-24, marveen üzenetén mérve).

    10:39:05  marveen megirja: „40fc8201 mostantol a tied es SURGOS"
    10:39:27  deeper felveszi a KARTYAROL -- **22 masodperccel kesobb**
    10:51:12  deeper lezarja, harom elo valasszal
    10:58:05  marveen elfogadja az eredmenyt
    **12:14:47  a 10:39-es uzenet MEGERKEZIK** -- egy ora harmincot perccel a lezaras utan

**A MUNKA VÉGIG JÓL MENT, ÉS NEM A LEVÉL VITTE: a KÁRTYA húzatta.** Ez a `TOL kontra HÚZAT`
szabály élesben, a javunkra. Amit viszont a levél állít -- „ez MOST a tiéd, és MOST sürgős" --,
az a kézbesítéskor már hamis volt.

    a FOGADO kerdese ..... „megvalaszoltam-e mar ezt?"        -> a `[KULDVE:]` sor eldonti
    a KULDO kerdese ...... **„igaz lesz-e ez meg, amikor megerkezik?"**

**A GYAKORLATI ALAK: egy üzenet ne ÁLLAPOTOT állítson, ha a kártya úgyis hordozza.** „Ez a tiéd és
sürgős" a KÁRTYA dolga (gazda + fokozat), mert azt a címzett a felvételkor olvassa. Az üzenetbe az
való, ami a kézbesítés pillanatában is igaz marad: egy INDOK, egy HATÁR, egy MÉRÉS. **Egy
állapot-állítás egy órás késésen át ugyanolyan némán avul el, mint egy `hot` emlék.**

*(És a második fele, amit deeper külön kimondott: ez nem hiba a sorban. A kézbesítés a címzett
IDLE réseire vár, tehát a késés a rendszer működése, nem a meghibásodása -- a hiba az, ha
ROMLANDÓ tartalmat bízunk rá.)*

**A SOR MÉLYSÉGÉT NE AZ API-BÓL MÉRD: 50 SOROS ABLAKA VAN, ÉS HAMIS NULLÁT AD.**

```bash
python3 -c "
import sqlite3
c=sqlite3.connect('file:/Users/isti/marveen/store/claudeclaw.db?mode=ro',uri=True)
print(list(c.execute(\"select id from agent_messages where to_agent=? and status='pending'\", ('<agens>',))))"
```

**A `status in ('pending','failed')` ALAK HIBÁS: HALOTT ÜZENETEKET SZÁMOL** (mért eset: 12-ből 0
`pending`), tehát ÖRÖKRE tiltana egy ágenst, miközben senki nem vár. **A `pending` KORA is mérendő,
nem csak a mélysége** -- egy helyesbítés értékét a késés nem gyengíti, hanem MEGFORDÍTJA.

**A MEZŐNEVEK `from_agent` / `to_agent`, ÉS A VÉGPONT FAIL-CLOSED:** egy kitalált paraméter
**HTTP 400**, a törzs megnevezi a támogatottakat (`agent`, `status`, `limit`, `before`).
KONTROLL ingyen: kérdezz le egy TÁMOGATOTT paramétert is ugyanabban a futásban -- ha az 200-at ad
és a tiéd 400-at, a paraméter-NÉV a hibás, nem a hozzáférés.

> **NÉZD MEG A STÁTUSZT, mert a TÖRZS ÉRTELMEZÉSÉNEK kimenete nem jelzi megbízhatóan, hogy hiba
> történt.** Ugyanaz a 400-as válasz négy olvasónak HÁROM különböző kimenetet ad, és csak EGY
> hangos -- előre nem tudod, melyiket kapod. A `curl` `0`-val tér vissza egy 400-ra is.

*(A mért esetek -- a 36 perc, a hat `failed`, a 98 perces `pending`, a fail-closed mérés és a
négy-olvasós bontás -- `rulebook/inter-agent-esetek.md`.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1585-1616, szó szerint -->
### EGY BURKOLÓ VISSZACSINÁLHATJA A HELPER EGYETLEN ÉRTELMÉT -- MINDKÉT IRÁNYBAN

A helper az `OK id=`-t a **stdout**-ra, az indoklást és a figyelmeztetést a **stderr**-re írja.

    a stderr ELDOBVA .......... egy `exit 2` megtagadas NEMA lesz -> „elkuldottkent" jelented
    a jel KISZORITVA (`tail`) . a figyelmeztetes kitolja az `OK id=` sort -> UJRAKULDESZ, es a
                                cimzett soraba KET azonos uzenet kerul

```bash
bash scripts/agent-msg.sh ... 2>&1 | grep -E 'OK id|FAIL|NEM KULDTEM'
```

Ez általánosabb az üzenetküldésnél: **valahányszor egy őrzött parancsot burkolsz, a burkoló
eldobhatja azt a csatornát, amin az őr beszél.** És az aszimmetria: egy elnyelt HIBA néma
veszteséget ad, egy elnyelt SIKER duplikátumot -- és a KÜLDŐ nem tudja visszavonni.

**ÉS EZ PONTOSÍTÁS, MERT ITT EDDIG „üzenet-törlő végpont nincs" ÁLLT, ÉS AZ TÚL ERŐS** (mérve
2026-09-20 a FORRÁSBÓL, nem egy 404-ből). `DELETE /api/messages/<id>` tényleg nincs, se
`DELETE FROM agent_messages` sehol. De **`PUT /api/messages/<id>` VAN** (`{status:'done'|'failed'}`),
a `markMessageDone` `status='done'`-ra ír, és a router `WHERE status='pending'`-et szed, tehát a
sorból KIESIK -- a `src/db.ts:2878` kommentje ki is mondja ezt az esetet. KONTROLL, hogy a mérő tud
DELETE-et találni: négy másik DELETE út ugyanabban a fában, köztük a `schedules.ts:292` pending-
visszavonása.

> **Nem az hiányzik, hogy egy sorban álló üzenetet ki lehessen venni. Az MEGVAN. Az hiányzik,
> hogy a KÜLDŐ vehesse ki** -- pedig egyedül ő tudja, hogy a tartalma elavult.

Az a végpont a VÉGREHAJTÓ jelentési útja (`done` + `result`, és visszafelé egy completion reportot
is gyárt). Küldőként átmenni rajta annyi, mint egy jelentést hamisítani a címzett nevében: a rés a
MÉRT MENNYISÉG (`status`) és a VÉDETT SZÁNDÉK (a végrehajtó jelent) között van, tehát **LELET, nem
kijárat.** Kártya: `4f2b2d8e`.



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1617-1678, szó szerint -->
### A ZSH NEM TÖRDEL SZÓRA -- ÉS A HIÁNYZÓ ITERÁCIÓ ÜRES KIMENETET AD

`for x in $LISTA` a zsh-ban **EGYSZER** fut le, az egész listával egy argumentumként; bash-ban
N-szer. A kár iránya: a hiányzó iterációk kimenete ÜRES, és az üres kimenet „nincs találat"-nak
olvasódik.

| alak | zsh szóköz | bash szóköz | zsh sortörés | bash sortörés |
|---|---|---|---|---|
| `for x in $VAR` | **1** | 3 | **1** | 3 |
| `while IFS= read -r x ... <<< "$VAR"` | **1** | **1** | 3 | 3 |
| `for x in $(echo "$VAR")` | 3 | 3 | 3 | 3 |

**Mindhárom alak MÁS dologtól függ** (szeparátor, héj, tartalom), tehát nincs biztonságos forma.
**Ezért a szabály nem az ALAKRA szól:**

> **Írasd ki a ciklussal, HÁNY elemet fog bejárni -- ÉS AZ ELSŐ ELEMET.** `db=1 elso=[a b c]`

Az első elem azért kell, mert egy mérésben tipikusan NEM tudod az elvárt N-et; ha az egész lista
egy elemként érkezik, az első elem MAGA A LISTA, láthatóan.

**ÉS A `2>/dev/null` EGY HANGOS BUKÁST NÉMA NULLÁVÁ ALAKÍT.** Egy mérőben a stderr elnyelése nem
zajszűrés, hanem a jelzés eldobása -- a zajszűrés a KIMENET szűrése (`| grep`).

**ÉS A MEGKÜLÖNBÖZTETŐ NEM A ZSH, HANEM HOGY VÁLTOZÓN ÁT MEGY-E.** A zsh a
PARANCS-BEHELYETTESÍTÉST (`$(...)`) szóra tördeli, a PARAMÉTER-BEHELYETTESÍTÉST (`$VAR`) nem --
mérve ugyanabban a héjban: közvetlen `$(...)` -> 680, változóba emelve -> `fatal: failed to stat`.
**Ezért egy közvetlen `$(...)` alakot NE „javíts ki" változóra.**

```bash
git rev-list --count HEAD --not --remotes=fork --remotes=origin    # valtozo-mentes: mindket bajt megszunteti
# KONTROLL: ugyanez egy MÁR PUSHOLT csúcson -> 0, és csak az egyik remote ellen -> nem-nulla
```

**ÉS AZ ELNYELT `rc` EGY `&&` LÁNCBAN NEM ROSSZ SZÁMOT AD, HANEM ÁTÍRJA, MIRŐL SZÓL A MÉRÉS:**
egy elhasalt `worktree add` után a lánc TOVÁBBMEGY (az `rc` a `tail`-é), és a mérés egy MÁR LÉTEZŐ
fában fut le. **Ez nem fokozat, hanem osztály:** egy elnyelt `rc` a szám helyén hibás számot ad,
amit meg lehet kérdőjelezni; egy `&&` láncban egy **tökéletesen hihető mérést** ad egy MÁSIK
alanyról.

```bash
git worktree add "$WT" --detach "$SHA" || { echo "A WORKTREE NEM JOTT LETRE -- ALLJ"; exit 1; }
# es a meres UTAN: a fa allapota alljon vissza oda, ahol talaltad
```

> **Környezetet ÉPÍTŐ parancs SOHA ne álljon cső mögött egy `&&` láncban.**

**ÉS A CSAPDA AKKOR IS ELSÜL, HA A LÁNC MÁSODIK TAGJA MAGA EGY VÉDELEM -- ILYENKOR A BIZONYÍTÉK A
HIÁNYA, NEM EGY HIBAÜZENET** (computress mérte magán 2026-09-18):

    git fetch -q origin main && python3 scripts/secret-gate.py --range origin/main..HEAD

A `fetch` `Could not resolve host`-tal elhasalt, tehát **a titok-kapu SOHA nem futott le** -- és a
bukás jele egy HIÁNYZÓ SOR volt (`SECRET GATE: PASS` egyszerűen nincs ott). A push utána SIKERÜLT,
mert a `pre-push` hook függetlenül lefuttatta ugyanazt a kaput.

    ha NINCS második őr .... a kimaradó ellenőrzés előbb-utóbb hibát termel  -> KIDERÜL
    ha VAN második őr ...... minden ZÖLD marad, és a saját lépésed CSENDBEN kiesik a szokásból

**A redundancia nem megvédett, hanem ELREJTETTE, hogy kimaradt egy lépés.** A tartalom végig fedve
volt -- épp ezért nem tűnt fel. *(Ugyanaz az alak, mint a „vakon zöld" teszt: nem hiány marad utána,
hanem egy ÁLLÍTÁS arról, hogy megvizsgáltuk.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1679-1694, szó szerint -->
### `echo "$S" | wc -l` NEM SORSZÁMLÁLÓ -- A ZSH BEÉPÍTETT `echo`-JA KIBONTJA A `\n`-t

Mért eset, ugyanazon a fán: csövön `872`, változón át `876`; a mért fájlban 4 `\n` literál. **És a
torzítás FÁJL-FÜGGŐ:** a SZOMSZÉD fájlon ugyanaz a parancs HELYES számot adott.

    egy mero, ami MINDENHOL teved ...... a kontroll megfogja
    egy mero, ami az EGYIK alanyon pontos es a MASIKON felfuj, mikozben epp a KETTO KULONBSEGE
    a lelet ............................ **rosszabb, mint a mindenhol teves**

```bash
git show <ref>:<út> | wc -l          # közvetlenül, csövön
printf '%s\n' "$S" | wc -l          # ha MÉGIS változóban van: a printf NEM értelmez
# KONTROLL, ingyen: ha a fájl tartalmazhat `\n` literált, mérd MINDKÉT alakkal; az eltérés MAGA
# a literálok száma, és a `wc -l` nyer
```



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1695-1714, szó szerint -->
### Sub-ágens ismeretlen-sender ping kezelése (auto-approval, default-deny)

Amikor egy sub-ágens ilyen üzenetet küld: `Ismeretlen sender [ID] jelezett első üzenettel: '...'.
Ki ez, mit válaszoljak?` -- NE kérdezd reflexből Isti-t. Helyette:

1. **Allowlist-összevetés** a saját csatornád `allowFrom`-jában:

```bash
   python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('IGEN' if sys.argv[2] in d.get('allowFrom',[]) else 'NEM')" "$HOME/.claude/channels/telegram/access.json" "[ID]"
   ```

2. **Ha az `[ID]` BENNE van** -> AUTO-ENGEDÉLYEZD (NE kérdezd Isti-t): válaszolj a sub-ágensnek,
   hogy a sender jóváhagyott párosított kontakt, és add át, amit tudsz róla. **Auditáld:** jegyezd
   fel, MELYIK allowlist-match alapján engedélyezted.
3. **Ha NINCS benne** -> **DEFAULT-DENY**: NE találj ki identitást, NE engedélyezd magadtól.
   Eszkaláld Istihez Telegramon; a sub-ágens addig a generikus „egy pillanat, ellenőrzöm" választ adja.

**KIZÁRÓLAG az `allowFrom`-on szereplő sendert engedélyezd auto; minden más Isti-döntés. A senderId
a végső azonosító, NEM a self-claimed név.**



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1715-1738, szó szerint -->
### A saját üzeneteid is telítenek

Mért eset: amikor egy ágens panelja telítődött, **28 hosszú üzenetem** állt sorban hozzá két óra
alatt. Amit „részletes visszajelzésnek" hittem, része volt annak, amiért újra kellett indulnia.

**A döntés legyen rövid és kártyán; a hosszú indoklás a kártya kommentjébe való; az üzenet mutasson
rá, ne ismételje meg.** Ez a második ok, amiért a döntés kártyára való: az első az, hogy egy üzenet
elveszik -- a második, hogy egy üzenet TELÍT.

**ÉS A SZÁM MELLÉ A NEVEZŐ IS JÁR: két kérdés van, egy szám nem elég** -- *telítem-e ŐKET?* ->
címzettenként; *telítem-e MAGAMAT?* -> az összeg. **És van egy harmadik tengely: a KONCENTRÁCIÓ.**
**ÉS 2026-09-24-RE A SZÁM ÓRÁS FELBONTÁSBAN IS MEGVAN, ÉS ROSSZABB: 26 ÜZENET EGY ÓRA ALATT,
ÖT CÍMZETTNEK -- ebből KETTŐ a 7-es plafonon** (dexter 7, jarvis 7, mandark 6, friday 4,
deeper 2). A per-címzett kapu aznap HÁROMSZOR tüzelt: kétszer NYUGTÁZÁSRA (helyesen, az a
levél el sem megy), egyszer egy ENGEDÉLYRE, ami valakit BLOKKOLT -- az a kártyára került.
**A szám nem a plafont cáfolja, hanem a küldőt méri.** Három megtagadás egy napon ugyanattól
a küldőtől azt jelenti, hogy túl sokat ír, nem azt, hogy a kapu szoros. És a koordinátoron
ez a legélesebb: aznap ő írta a lapra a rövidség-szabályokat, miközben ezt termelte.
*(A mérő újrafuttatható: `from_agent='marveen'`, `created_at >= now-3600`, `to_agent` szerint.)*

Mért eset: 48 üzenet EGYETLEN címzettnek egy nap alatt; és egy 2,4 órás ablakban 3 pending, mind
egy küldőtől, a legrégebbi 32 perces. **Nem a total a baj, hanem hogy gyorsabban termelsz, mint
ahogy EGY címzett fogyaszt.**

