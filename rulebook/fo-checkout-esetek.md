# A fő checkout mint futó rendszer -- a MÉRT ESETEK teljes szövege

*(Kiszervezve a `CLAUDE.md`-ből 2026-09-17-én, marveen, a `2028900e` kártya kritériuma szerint.
A lapon a TÖRVÉNY, mind a 11 PARANCS, a két táblázat és a teherhordó mondatok maradtak; itt áll a
szakasz TELJES, bontás előtti szövege, szó szerint.)*

---

## A FŐ CHECKOUT RÉSZBEN MAGA A FUTÓ RENDSZER (mérve 2026-08-22)
*(A mért esetek -- a hook-kézbesítés három egymást váltó állítása, a `web/` sáv jelölő-mérése, a
launchd TEMP-foglalás, az őr-halmaz öt szivárgása, a `--show-toplevel` visszavonás és a két
gate-szkript átvételi csapdája -- `rulebook/telepitesi-savok-esetek.md`.)*

A `/Users/isti/marveen` egyszerre a telepítés gyökere és a fejlesztés helye, és ez **két külön
telepítési modellt** takar, amiből csak az egyiken van kapu:

| mi | hogyan kerül élesbe | kapu |
|---|---|---|
| `dist/` | `npm run build` + `.built-commit` + `launchctl kickstart` + egészség-mérés | VAN |
| `scripts/` | a futó kód FUTÁSIDŐBEN hívja a munkafa fájlját | **NINCS** |

Amit a `scripts/`-be írsz, az **azonnal éles** -- build nélkül, restart nélkül, ellenőrzés nélkül.

**A gyakorlati következmény, amit 2026-08-22-ig nem mondtunk ki:** egy `git checkout` a fő
checkoutban nem „a következő telepítéskor" hat, hanem **abban a pillanatban** -- a `scripts/` fele
azonnal átvált. Ezért: **minden ügynök a saját git worktreejében fejleszt**, és a `scripts/`
szerkesztése ugyanolyan súlyú, mint egy telepítés. Kártya: `a1c5d6ca`.

### A LÉTEZÉS ÉS AZ ELÉRÉS KÉT KÜLÖN ÁLLÍTÁS -- ÉS MI AZ ELSŐT SZOKTUK MÉRNI

*(computress fogalmazta meg 2026-08-28-án, négy egynapi előfordulásból. Ez a keret az alatta
következő szakaszokhoz: a sáv-táblázat, az ÖTÖDIK ÁLLAPOT és a hook-sáv mind EGY-EGY mechanizmusa
ugyanennek. **A HAT MÉRT ESET TELJES SZÖVEGE: `rulebook/letezes-es-eleres-esetek.md`.**)*

    skills-snapshot hook ....... BEKÖTVE, és egyetlen ágens konfigjába sem jutott el
    quota-ceiling-guard ........ FUT, tíz percenként, és nem volt verziózva
    dexter guard-fájlja ........ MEGÍRVA, teszttel, és egy be nem olvasztott ágon állt
    `timeout-minutes: 25` ...... COMMITOLVA négy napja, és a törzsön ma is 15 áll

Négy különböző mechanizmus, egy hiba: **megmértük, hogy MEGVAN, és nem mértük meg, hogy ODAÉR.**
És mind a négy ugyanúgy néz ki kívülről, mint a kész munka -- a kártya „kész"-t mutat, mert a munka
tényleg kész.

**A KÉRDÉS, AMI MEGFOGJA:** nem az, hogy megírtuk-e, hanem hogy **KI OLVASSA, ÉS MIKOR.** Egy hook a
konfigból, egy szabály a beolvasztott fából, egy küszöb a törzsről. Ha a válasz „a következő
telepítéskor", akkor ma nem hat; ha „senki", akkor sosem.

**A HÁROM RÉTEG, AMIT A „KÉSZ" ÖSSZEMOS -- ez a szakasz legtöbbet használt darabja:**

    MERGED ..... a tartalom a törzsön van
    BUILT ...... a tartalom a `dist/`-ben van    <- EZT méri a `.built-commit`, és igazat mond
    RUNNING .... a tartalom abban a FOLYAMATBAN van, amit a felhasználó használ

**A marker nem hazudik: MÁS kérdésre válaszol.** Mért eset: nyolc `marker == HEAD` ellenőrzés, mind
a nyolc igaz, miközben a futó folyamat **41 perccel** a saját buildje mögött állt.

**A MÉRŐ A RUNNING-RÉTEGHEZ, ÉS NE A `build.status` MEZŐ LEGYEN:** az EGY mezőben KÉT független
feltételt hordoz, és a `stale-source` ág ELŐBB tér vissza. Ha mindkettő áll, a mező ELHALLGATJA a
RUNNING-rést -- épp azt az esetet, amikor fordítani ÉS újraindítani is kell.

```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/overview \
  | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; \
      print('RUNNING elavult?' , b['startedAt'] < b['builtAt'], '| status:', b['status'])"
# a `status` EMBERNEK szol, a ket idobelyeg OSSZEHASONLITASA a gepi valasz
```

**ÉS EZ A MÉRŐ IS EGY SZŰKEBB KÉRDÉSRE VÁLASZOL, MINT AMIT AZ EMBER FELTESZ** (friday mérte
2026-09-11, egy FRISS merge-en, ahol a mérő ZÖLDET adott és a munka mégsem futott):

    `startedAt < builtAt` = FALSE  ->  „a FOLYAMAT nem maradt le a SAJAT buildjétől"   <- IGAZ
    amit az ember kérdez ......... „a FUTÓ KÓD tartalmazza-e, amit ma beolvasztottam?"

A kettő EGYÜTT is lehet zöld egy MÁSIK build mellett: a folyamat 19:07-kor indult, a build 15:36-kor
készült, tehát a folyamat naprakész -- azzal a builddel, amit kapott. **Hogy a BUILD naprakész-e a
TÖRZZSEL, arra a `src/`-számláló válaszol** (lentebb), és ugyanazt mondja el egy `ls` is:

```bash
ls dist/web/<az-uj-modul>.js    # "No such file or directory" = a merge NINCS a futo fában
```

**A HÁROM KÉRDÉS, ÉS MINDHÁRMAT KÜLÖN KELL FELTENNI:**

    lemaradt-e a FOLYAMAT a sajat buildjetol? .... `startedAt < builtAt`
    lemaradt-e a BUILD a torzstol? ............... `git rev-list --count <builtCommit>..HEAD -- src/`
    ott van-e a KONKRET valtozas a dist-ben? ..... `ls dist/<ut>` -- parancs nelkul is olvashato


**ES VAN EGY HARMADIK KERDES UGYANEBBEN A CSALADBAN, AMI ELLENTETES VALASZT AD: A `stale-source`
UTVONAL-FUGGETLEN** (marveen merte 2026-09-10, friday jelzesere, majd friday ujramerte kontrollal
mindket iranyban).

    build.status ......... `stale-source`         -> "elmozdult a forras?"  IGEN, es ez IGAZ
    a valodi kerdes ...... "lemaradt a FUTO kod?"  -> es a valasz NEM volt
    a range: 18 commit, ebbol **0** erinti a `src/`-t

**Ket kerdes, ellentetes valasz, ugyanazon a fan.** A `status` nem hazudik -- pontosan es helyesen
valaszol arra, hogy a forras mozdult-e. Csak nem ez az a kerdes, amitol barki buildel es ujraindit.

```bash
B=$(curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/overview \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['build']['builtCommit']['commit'])")
git rev-list --count $B..HEAD -- src/     # 0 = egy build SEMMIT nem valtoztatna
# KONTROLL, mindket iranyba: HEAD..HEAD -> 0, es ugyanez a mero a teljes tortenetre -> nem-nulla
```

**AMIT EZ NEM MOND: hogy soha nem tartozunk buildel.** Amint egy `src/`-t erinto ag beolvad,
ugyanez a mero NEM-NULLAT ad. A recept ertelme epp ez: a valasz naprol napra valtozik, tehat MERNI
kell, nem emlekezni ra.

**AZ ÖTÖDIK ESET NEM KÓD, HANEM EGY „IGEN", ÉS EZ A LEGPONTOSABB ALAKJA AZ EGÉSZ SZAKASZNAK**
(friday): *egy jóváhagyás is DÖNTÉS, és egy döntés, ami sosem ért el egy dologhoz,
megkülönböztethetetlen attól, amit meg sem hoztak.* Miért a legnehezebben észrevehető: a jóváhagyó
abban a pillanatban KÉSZNEK könyveli el (számára a döntés maga a munka), a végrehajtó pedig egy
hiányzó előfeltételbe fut, ami nem az ő kártyája. **Egyik oldalon sem keletkezik nyitott tétel.**

**A HATODIK MÁS, MINT AZ ÖT: SEMMI NEM HIÁNYZOTT.** A helyes válasz elérhető volt, és a rossz
egyszerűen KÖZELEBB volt a kézhez. friday mondatával: *„`marker == HEAD` egy sor bash; a
`build.status` egy curl és egy token. Az olcsóbb ellenőrzés nyert -- és rossz kérdésre válaszolt."*

**A GYAKORLATI KÖVETKEZMÉNY KÉT IRÁNYBA:**
1. **Mielőtt őrt írsz, kérdezd meg, MI VÁLASZOL MÁR erre a kérdésre** -- ne csak azt, hogy létezik-e
   ág róla.
2. **Ha egy helyes, elérhető képességet nem használnak, a hiba a HELYÉN van, nem a tudásban.** A
   javítás nem oktatás, hanem hogy a jó ellenőrzés kerüljön be abba a szokásba, ami már fut.

**A SZOKÁS, AMI OLCSÓ, ÉS EGY HAJNALON HÁROM ÓRÁT SPÓROLT VOLNA:**

```bash
git log --all --oneline --grep=<kulcsszó>     # MIELŐTT védelmet írsz, nézd meg, megírták-e
```

**ÉS A TÖRVÉNY NEM REPÓK KÖZÖTT A LEGÉLESEBB, HANEM EGY REPÓN BELÜL.** A mért eset: egy PONTOSAN
erre a hibaalakra írt, KÖVETETT helyi fájl (`src/__tests__/helpers/strip-comments.ts`)
használatlanul állt HÁROM KÖNYVTÁRRA attól a spectől, ami ugyanabba a hibába futott. Ott a
„megvan-e egyáltalán" kérdésre a válasz IGEN, tehát fel sem merül, hogy megkérdezzük.

**ÉS A ZÁRÓ TANULSÁG, AMI MEGDÖNTÖTTE A SAJÁT INDOKLÁSUNKAT:** a kész védelem beolvasztása NEM
zárta be a rést, mert a SZOMSZÉD kérdésre válaszolt, és `current` állapotban a jelzése REJTVE van.
**Két jelzés, ami külön-külön helyes, együtt sem fedi le a kérdést, amit az ember ténylegesen
feltesz.**

### TÖBB TELEPÍTÉSI SÁV VAN, MINT AHÁNYRA SZÁMÍTASZ -- ÉS A „KÉSZ" MINDEGYIKBEN MÁST JELENT
(kártya `576a4b21`, mérve 2026-08-23.)

*A cím szándékosan nem mond számot: egy szám a címben pontosan addig igaz, amíg valaki hozzá nem
tesz egy újabb sávot. A táblázat a mérvadó -- számold meg a sorokat.*

| sáv | mikor hat | mérve |
|---|---|---|
| `scripts/` | a beolvasztással **AZONNAL** | **18** `dist/` modul futásidőben a munkafát hívja (a korábbi „nyolc" elavult volt) |
| `web/` | a beolvasztással **AZONNAL** | `src/web.ts:111`: `WEB_DIR = join(PROJECT_ROOT, 'web')`, és egyedi jelölővel élesben igazolva |
| `src/` | csak `npm run build` + újraindítás után | a szolgáltatás a `dist/`-ből megy |
| `*.plist` / launchd | csak KÜLÖN telepítéssel (`launchctl`) | a repó `scripts/*.plist.template` fájlokat követ (8 db), a TELEPÍTETT példány a `~/Library/LaunchAgents/` alatt él |
| `.claude/settings.json` hookjai | **ÁGENSENKÉNTI MÁSOLÁSSAL, a következő provisioningkor** (nem rétegződés, és nem is „sehogy") | minden ágens SAJÁT `CLAUDE_CONFIG_DIR`-rel fut; a `provisionIsolatedConfigDir` a MEGOSZTOTT settingset olvassa BE ALAPNAK, és az ágens régi settingséből csak a MÉG NEM létező kulcsokat húzza át (`!(key in settings)`). **MÉG NEM MÉRT: lefut-e a provisioning MINDEN ágens-indulásnál, vagy csak bizonyos utakon.** |
| `.git/hooks/` | csak `bash scripts/sync-hooks.sh` után | a telepítő MÁSOLJA a tartalmat, tehát DRIFTELHET |

**EZ A HOOK-SOR MA HÁROMSZOR ÁLLT MÁSKÉPP, ÉS EGYIK ÁLLÍTÁS SEM VOLT HAMIS** (marveen: „a következő
indulástól" -> jarvis: „méretlen, vagy sehogy" -> friday: „másolással"). friday fogalmazta meg,
miért, és ez többet ér a végeredménynél:

> mindhárom állítás EGY-EGY RÉTEGGEL mért mélyebbre (a viselkedést, a konfig-dirt, majd a kódot és
> a másolat-aláírást), és egyik sem volt hamis a SAJÁT rétegében. Ami változott, az nem az igazság,
> hanem hogy MEDDIG mentünk le.

**A „TELEPÍTVE VAN-E" KÉRDÉS CSAK AZ EGYIK HOOK-SÁVRA ÉRTELMES:**

    git-hook (`.git/hooks/`) ....... a telepito MASOLJA -> **DRIFT**: egy regi, telepitett hook
                                     ugyanolyan nema, mint egy hianyzo, csak megtevesztobb
    Claude Code hook (`scripts/hooks/`) . a settings UTVONALLAL hivatkozik a munkafa fajljara
                                     -> nem tud driftelni, DE minden szerkesztes AZONNAL eles

**ES A GIT-HOOK HATOKORE SZELESEBB, MINT A FO CHECKOUT: A `.git/hooks` MEGOSZTOTT A LINKELT
WORKTREE-KKEL** (friday merte 2026-09-10, VALODI pusholassal). Egy worktree-bol inditott push a FO
CHECKOUT hookjat futtatta le.

    egy telepites  ->  MINDEN agens worktree-jere hat, kulon telepites nelkul
    es a hook a WORKTREE cwd-jevel fut (merve, nem levezetve)

**Ket iranyba szamit.** Vedelemnel jo hir: nem kell hatszor telepiteni, es senki ne is probalja.
Kockazatnal viszont a robbanasi sugar a TELJES flotta: egy rossz hook egyszerre tori el mindenki
pusholasat.

**ES EBBOL EGY SORREND-SZABALY KOVETKEZIK, AMI NEM A HOOK MINOSEGEROL SZOL: HOOK-TELEPITES SOHA NE
ALLJON KOZVETLENUL AZ ELE AZ ESEMENY ELE, AMIT VEDENI HIVATOTT** (marveen dontese 2026-09-12,
friday leletere). Egy `pre-push` hook ujratelepitese a het EGYETLEN push-esemenye ELOTT azt jelenti,
hogy egy rossz telepites pontosan azt blokkolja, amiert az egesz koteg van -- es az EGESZ flottara
egyszerre, mert a `.git/hooks` megosztott. Radasul ugy nezne ki, mintha a KOTEG lenne rossz, nem a
hook, tehat a hibakereses is rossz helyen indulna.

    a koteg megy fel ELOSZOR, a bizonyitottan mukodo hookokkal
    UTANA a telepites, es az ellenorzese scratch repoval + HELYI bare remote-tal (halozat nelkul)

*(A `pre-commit` lane-re ez nem all -- az nem erinti a pusht. De ket elavult hookot egy muveletben
telepiteni egyszerubb, mint sav szerint szetvalasztani oket.)* Es ami ebbol a hook MEGIRASARA kovetkezik: **ami a worktree cwd-jebol olvas, az az
AGENS agat latja, nem a telepitesi agat** -- a fo checkoutban tesztelve viszont helyesnek latszik.

**A HELYES ALAK HORGONY NELKULI** (a `--show-toplevel`-horgonyos alak, ami itt 2026-09-10-ig allt,
MERVE ROSSZ: alkonyvtarbol nem letezo utat ad; a git MAGA szamol a cwd-vel):

```bash
COMMON="$(cd "$(git rev-parse --git-common-dir)" && pwd)"    # nem kell horgony
cat "$COMMON/HEAD"                                            # a FO worktree aga, barhonnan
```

**ES EGY OR-HALMAZNAK IS LEHET LYUKA, ANELKUL HOGY BARMELYIK OR HIBAS LENNE -- ES A LYUK HELYE
ELORE MEGJOSOLHATO** (friday, 2026-09-10, ot identitas-szivargas utan). Harom identitas-or futott,
mind HELYES, mind ZOLD -- es ot szivargas allt a fabol. Az ok nem az egyik or hibaja: **mindharom
PER-FELADAT, es mindegyiket a SAJAT feladataval EGYUTT irtak.**

    a halmaz igy feladatonkent EGY orrel no  ->  es SOHA nem no egy ORREL AZ OSZTALYRA
    egy uj feladat or nelkul erkezik         ->  es minden meglevo or ZOLD marad
    a zold pedig LEFEDETTSEGNEK olvasodik

**A PROBA, ES AZERT ER TOBBET A TOBBINEL, MERT MEGMONDJA, HOL KERESS:** amikor egy ort a vedett
dologgal EGYUTT irsz, kerdezd meg, hogy a KOVETKEZO ilyen dolog hozza-e majd a sajat oret. Ha a
valasz az, hogy „csak ha valaki emlekszik ra", akkor az or az OSZTALY szintjere valo.

**A 18-as szám parancsa** (a fájl saját szabálya szerint: ha ide szám kerül, jöjjön vele a
parancs). A `__tests__` KIMARAD -- egy lefordított teszt nem futó kód:

```bash
grep -rlE "scripts/[a-z0-9_-]+\.(sh|py|ts|mjs)" dist/ | grep -v '__tests__' | wc -l   # 18 (KONKRET hivas)
grep -rl  "scripts/" dist/ | grep -v '__tests__' | wc -l                              # 23 (barmilyen emlites)
```

A két szám KÉT KÉRDÉSRE válaszol; a különbség nem hiba, hanem a populáció.

**ÉS A `scripts/` FEJLÉCEI DÖNTÉSEKET HORDOZNAK -- a kereshető listájuk GENERÁLT:
`docs/scripts-decisions.md`; újragenerálás `python3 scripts/decision-index.py`, elavulás-ellenőrzés
`--check` (exit 3, és a vitest is futtatja), a „lapon nevezik-e" oszlop pedig ÉLŐ lekérdezés
(`--unnamed`), mert a bemenete a repón kívüli, követetlen fájl. Kártya: `72edf070`.**

**A TELEPÍTÉSI ÁLLAPOT IS MÉRÉS, NEM PREMISSZA.** A „nincs telepítve" ugyanolyan állítás, mint egy
szám: mérni kell, és a mérés a VISELKEDÉS, nem a fájl megléte. Egy `dist/…js` létezése nem
bizonyítja, hogy a futó folyamat betöltötte. *(Az ára már meg is volt: 2026-08-23-án egy ügynök
többször leírta a kártyáira és a gazdának, hogy „nincs telepítve" -- olyan munkára, ami a `web/`
sávon MÁR ÉLESBEN FUTOTT. Nem hanyagság: két sávval számolt, mert csak kettő volt leírva. **Egy
hiányzó sor a dokumentációban ugyanúgy hamis állítást termel, mint egy hibás mérés.**)*

**ÉS A `launchctl list | grep -c` HAMIS ZÖLDET AD EGY ELFOGLALT LABELRE** (mérve 2026-09-05): a
`grep -c` a label JELENLÉTÉT számolja, és a label ott van akkor is, ha egy TÖRÖLT temp-könyvtárból
származó plist foglalja el. A három mérő közül csak a harmadik diszkriminál:

    grep -c <label> ............... csak JELENLET -> egy elfoglalt labelre EGESZSEGESET mond
    a `launchctl list` STATUSZ oszlopa .. JEL, de nem diszkriminator: egy buko LEGITIM unit is `2`
    launchctl print ... | grep 'path =' .. **EZ dont**: ha nem a /Users/<user>/Library/LaunchAgents/
                                  ala mutat, a label FOGLALT

```bash
# a helyes ellenőrzés, kontrollal együtt (a kontroll a lényeg: a mérő tudjon IGENT is mondani)
for L in $(launchctl list | awk '/com\.(marveen|testbot)/{print $3}'); do
  P=$(launchctl print "gui/$(id -u)/$L" 2>/dev/null | grep -m1 'path =' | sed 's/.*path = //')
  case "$P" in /Users/*/Library/LaunchAgents/*) echo "OK   $L";; *) echo "TEMP $L -- $P";; esac
done
# MÉRVE 2026-09-05: 8 betöltött unitból 6 OK, 2 TEMP -- tehát a mérő tud egészségeset mondani
```

### AZ ÖTÖDIK ÁLLAPOT: ÉL ÉS FUT, DE NINCS VERZIÓZVA (friday mérte, 2026-08-27)
*(A négy mért eset -- a quota-guard két példánya, a két ágens egyidejű írása, a `scratch` ág és
mandark követetlen bizonyítéka -- `rulebook/otodik-allapot-esetek.md`.)*

A fenti táblázat SÁVOKAT sorol: hol tart egy változás a telepítés felé. Ez nem sáv, hanem ÁLLAPOT,
és a táblázat egyik sorába sem fér bele -- mert nem „még nem ért oda", hanem **már ott van, csak nem
lehet visszahozni**. A fájl HAT, és egy `git clean -fd` vagy egy új gép nyomtalanul elviszi --
miközben a kártya késznek mutatja a munkát, mert a munka tényleg kész.

**A KÉRDÉS, AMI EZT MEGFOGJA:** nem az, hogy „beolvadt-e", hanem hogy `git ls-files <fájl>` ad-e
sort.

**ÉS EZ A KÉRDÉS A MARVEEN REPÓRA ÉRVÉNYES, NEM MINDEN FÁRA -- didi szűkítette 2026-09-11, marveen
újramérte.** A `~/.claude/skills/` fa a `git ls-files` szerint követetlen, és MÉGIS van diffje,
története és bájtra pontos visszaállítása:

    /Users/isti/Backups/rulebooks   **1018 commit**, 84 kovetett skill-fajl
    a `rulebook-snapshot.sh` verziozza oda, es a `skills-snapshot-on-write.sh` PostToolUse hook
    futtatja MINDEN Bash-hivas utan
    egy mert szerkesztes: `1 file changed, 9 insertions(+)`
    KONTROLL, hogy a differ nem vak: ugyanaz a ket commit a TELJES fan -> 61 fajl / 3715 / 1037

```bash
git -C /Users/isti/Backups/rulebooks show <commit>:store/skills/<skill>/<fajl>   # visszaallitas = MASOLAS
```

**A HELYES KÉRDÉS TEHÁT KÉT LÉPCSŐS:** követi-e a repó, ÉS ha nem, fedi-e egy PILLANATFELVÉTEL.
*(Miért élte túl a szűkebb alak: egy MECHANIZMUS -- a `git ls-files` -- beállt a KÉRDÉS helyére, és
a repón BELÜL ugyanazt a választ adja. Ugyanaz az alak, mint a `marker == HEAD`, a
`grep -c <label>` és az `is-ancestor` -- most a saját, verziózatlan fájlokról szóló törvényünkön.)* Ha nem, akkor a fájl a fenti táblázat EGYIK sorában sincs benne. *(Két külön ok ugyanarra a
tünetre: hiányzó `git add`, vagy szándékos `.gitignore`. A `CLAUDE.md` maga a második -- vagyis a
szabálykönyv, ami ezt kimondja, maga is az a fajta fájl, amiről szól.)*

**A SZABÁLY EHHEZ A FÁJLHOZ: olvasás-módosítás-írás CSAK `fcntl.flock` alatt, és a csere legyen
HORGONYOS asserttel** (a horgony PONTOSAN egyszer illeszkedjen), ne sorszám vagy teljes újraírás.
Egy `git ls-files` itt 0-t ad, tehát a szokásos háló nincs alattad, és egy csendes felülírásnak
nincs diffje, nincs története és nincs visszaállítása. *(Mért eset: 2026-09-10 20:0x, két ágens
percen belül.)*

**ÉS A HARMADIK PÉLDÁNY MÁS OKBÓL LÁTHATATLAN: A CÍMKE AZT MONDTA, NE NÉZD MEG.**

    egy `scratch` nevű ág ......... úgy olvasódik, hogy „nincs itt semmi"
    egy `planned`-ként ARCHIVÁLT kártya .. ugyanígy: a mező azt mondja, ne is listázd
    egy `git clean -fd` ........... mindkettőt nyomtalanul elviszi

**A KÖZÖS ALAK: egy CÍMKE, ami az olvasónak azt üzeni, hogy ne nézzen bele.** Nem hiányzik semmi,
nem hibás semmi -- a jelölés maga tereli el a figyelmet. Ez ugyanaz a mechanizmus, ami az elavult
„ÁLLJ MEG" emléket életben tartja: **épp az a mondat védi, ami miatt senki nem kérdőjelezi meg.**

**A gyakorlati szabály: egy adatvesztés-kérdésnél (mi létezik csak egy lemezen?) a NÉV ne legyen
szűrő.** Mérj mindenre, és a besorolást a TARTALOM adja.

**ÉS UGYANEZ A BIZONYÍTÉKON, NEM A KÓDON -- EZ A DRÁGÁBB PÉLDÁNY:**

    a KÓD elvesztése:        egy funkció eltűnik -- előbb-utóbb valakinek feltűnik
    a BIZONYÍTÉK elvesztése: a kártya TOVÁBBRA IS azt állítja, hogy megvolt

A második rosszabb, mert nem hiány marad utána, hanem egy **igazolatlan állítás, ami igazoltnak
látszik**. **A szabály:** amikor egy kártyára azt írod, hogy a bizonyíték futtatható, előbb
`git ls-files` a fájlra. Egy commit-hash a kártyán ezt magától megoldja.

**ÉS A TÜKÖRKÉPE PRÓZÁRA: EGY DÖNTÉS, AMI KÁRTYÁT NEVEZ, HELYREÁLLÍTHATÓ -- AMI CSAK DÁTUMOT, AZ
EGYETLEN PÉLDÁNY** (friday mérte 2026-09-10, 99 soron):

    A PASSZUS NEVEZ-E KÁRTYÁT, ÉS MI ÁLL AZON A KÁRTYÁN?
      KIMONDOTT DÖNTÉS -> a szöveg elvesztése bosszantó, de HELYREÁLLÍTHATÓ
      JAVASLAT         -> a TARTALOM túlél, a TEKINTÉLY NEM. Mondd ki, hogy csak javaslat áll ott.
      NINCS HORGONY    -> az a szöveg az EGYETLEN PÉLDÁNY, és ez a sürgős eset

**ÉS OLVASNI KELL, NEM GREPELNI:** egy kulcsszó-cenzus azt bizonyítja, hogy a SZAVAK ott vannak, nem
azt, hogy a DÖNTÉS ki van mondva -- jelenlét kontra megfelelés.

*(A hordozható rész nem a szűrő, hanem az irány: egy ítéletet kérő kérdésre a jó válasz gyakran egy
MECHANIKUS PRÓBA, ami ugyanazt a halmazt adja. Aki ítéletet kér, kérdezze meg, van-e helyette próba.)*

### A HOOK-SÁV: NEM „AZONNAL" ÉS NEM IS „TELEPÍTÉSKOR" HAT, HANEM ÁGENSENKÉNT MÁSKOR
*(A teljes eset -- a három egymást váltó állítás, a hook-készletek összevetése és a passzív mérés
aszimmetriája -- `rulebook/letezes-es-eleres-esetek.md`.)*

A `~/.claude/settings.json` hookjai a munkamenet INDULÁSAKOR töltődnek be. Egy bekötött hook tehát
nem akkor kezd hatni, amikor beírtuk, hanem amikor az adott ágens legközelebb újraindul -- és ez
**ágensenként külön időpont**. Itt a változás KÉSZ, és a kézbesítésének **nincs EGY időpontja**.

**ÉS EGY SZINTTEL MÉLYEBBEN: MINDEN ÁGENS SAJÁT `CLAUDE_CONFIG_DIR`-REL FUT**, nem a
`~/.claude`-dal (`agents/<név>/.claude-config`, a workereknél `~/.marveen-worker*/.claude-config`).
Vagyis egy KIZÁRÓLAG a megosztott fájlba írt hook nem „a következő indulástól" hat, hanem
**SEHOGY** -- egy újraindítás önmagában nem kézbesíti. A kézbesítés útja egy ÁGENSENKÉNTI MÁSOLÁS
provisioningkor, és a verziózott forrása az `ensure*` család (lásd a következő szakaszt).

**A PARANCS, amivel bármikor újramérhető:**

```bash
stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' ~/.claude/settings.json      # a bekötés ideje
for a in dexter didi friday jarvis mandark computress; do
  pid=$(tmux list-panes -t "agent-$a" -F '#{pane_pid}' 2>/dev/null | head -1)
  [ -n "$pid" ] && printf '%-12s %s\n' "$a" "$(ps -o lstart= -p "$pid" | sed 's/^ *//')"
done
```

**ÉS A CSAPDA A SAJÁT PARANCSUNKBAN: A KOORDINÁTOR NEM `agent-<név>`.** A fenti ciklus
`marveen`-re ÜRESET ad (a session-jei `marveen-channels`, `marveen-worker`, `marveen-worker-fast`),
és az üres találat pontosan úgy néz ki, mint egy „nincs ilyen ágens" -- miközben épp a leghosszabb
ideje futó példány esik ki belőle. Aki a koordinátort is méri, `tmux list-sessions`-ből induljon.

**A KÖVETKEZMÉNY, AMIVEL SZÁMOLNI KELL:** egy ágens újraindítása **nem a mi döntésünk** -- a
context-guard telítettségre indít. Ennek a sávnak a kézbesítési ideje tehát NEM TERVEZHETŐ. Aki
hook-alapú mechanizmust épít, ne feltételezze, hogy a bekötés napján bárkinél hat; és ha a
mechanizmus fontos, legyen mellette egy munkamenettől FÜGGETLEN út (a skills-pillanatfelvételnél ez
a 30 perces poll -- ezért NEM védelmi rés a fenti).

**ÉS A PASSZÍV MÉRÉS ASZIMMETRIÁJA, KÜLÖNBEN A NEGATÍVJA FÉLREVEZET:** ha egy bélyeg-fájl a
bizonyíték, akkor a MOZDULÁSA bizonyít (a hook tüzelt), a NEM-MOZDULÁSA viszont nem -- lehet, hogy
el sem indult, de lehet, hogy elindult és nem volt mit mentenie. A helyes alak: *„a bélyeg nem
mozdult, PEDIG X ágens írt a figyelt fába a restart óta."* Egy nulla addig nem állítás, amíg nem
tudjuk, hogy a kérdés egyáltalán fel lett-e téve.

### ÉS VAN EGY NEGYEDIK BEKÖTÉSI HELY -- ÉS ÉPP AZ AZ EGYETLEN, AMI KÖVETETT
(marveen mérte 2026-09-06, friday jelzésére.)

A fenti szakasz KÉT helyről beszél: a megosztott `~/.claude/settings.json`-ről és az ágensek
`CLAUDE_CONFIG_DIR`-jéről. **Van egy harmadik fájl, és a lap eddig nem tudott róla.**

    ~/.claude/settings.json ......................... outgoing-copy 0 | db-destructive 1
    **/Users/isti/marveen/.claude/settings.json** ... **outgoing-copy 3** | db-destructive 1
    .channels-config/settings.json .................. 0 | 1
    mind a 12 ágens-fájl (`.claude` ÉS `.claude-config`) 0

A PROJEKT-SZINTŰ fájl volt a hiányzó, KILENC repo-hookot hordoz, **és KÖVETETT:
`git ls-files .claude/settings.json` -> 1.** (KONTROLL: `package.json` -> 1, `CLAUDE.md` -> 0.)

**A HATÓKÖRE VISZONT CSAK A KOORDINÁTOR.** Az ágensek saját projekt-könyvtárban futnak
(`~/.claude/projects/-Users-isti-marveen-agents-<név>`), tehát ez a fájl rájuk NEM hat.
**Követett, és nem elég.**

    a KÖVETETT hely ....... csak a koordinatort eri el
    ami MIND A HATOT eléri  `agents/` a `.gitignore`-ban -> konstrukcióból verziózatlan
    -> **NINCS olyan settings-fájl, ami egyszerre éri el a flottát ÉS verziózott**

**AMI EBBŐL A BEKÖTÉSI DÖNTÉSRE KÖVETKEZIK:** a valódi precedens az `ensureEgressGate`
(`src/web/agent-scaffold.ts`), ami minden ágens configjába ABSZOLÚT úton írja be a kapuját, KÓDBÓL.
Az `ensure*` család a bekötés verziózott forrása: `ensureAgentHooks`, `ensureAgentStalenessHook`,
`ensureEgressGate`, `ensureGovernanceGateCommands`, `ensureQuarantineReader`, ...

> **Egy új fleet-hookot ne settings-fájlba írj, hanem `ensure*` függvénybe.** A kimenet
> verziózatlan marad -- de a FORRÁS nem, tehát egy `git clean` vagy egy új gép után újraáll,
> és mind a hatra ugyanaz kerül, nem hat kézi szerkesztés.

**KIMONDOTT HATÁR:** MÉRETLEN, hogy az `ensure*` család MINDEN ágens-induláskor lefut-e, vagy csak
bizonyos utakon. Aki bekötést csinál, mondja meg, MI hívja meg, és MIKOR.

*(A megtalálás módja a hordozható rész: nem cenzusból jött, hanem egy ELLENTMONDÁSBÓL -- egy kapu
0-t mutatott mindenhol, ahol néztük, és közben bizonyítottan tüzelt. Nem hiányzó adat volt, hanem
egy hely, amit senki nem kérdezett meg.)*

### KÉT GATE-SZKRIPT NÁLUNK VAN, A BEKÖTÉSÜK NINCS -- ÉS A DOCBLOCKJUK AZ ELLENKEZŐJÉT MONDJA
(mandark lelete, friday döntötte meg a premisszát, marveen újramérte, 2026-09-05.)

A `scripts/kanban-write-gate.mjs` és a `scripts/digest-provenance-gate.mjs` docblockja azt mondja,
hogy be van kötve (`agentGetsKanbanWriteGate`) -- a MI fánkon az a szimbólum **0 előfordulás**.

**A DOCBLOCK NEM HAZUDIK -- UPSTREAM IGAZ.** Mindkét fájl BÁJT-AZONOS az `origin/develop`-pal, és
ott a bekötés létezik. **A hordozó commit `929fb40`, NEM a `49af469`** (az utóbbi egy KÉSŐBBI
boot-túlélési javítás, az `agent-scaffold.ts`-t **0**-szor érinti). **Aki a `49af469`-et veszi át,
semmit nem állít helyre** -- megméri, a szimbólum továbbra is 0, és a józan következtetés az, hogy
az átvételi út nem működik. **Egy rossz hordozó rosszabb, mint a hordozó hiánya: a helyes
eljárásból ad magabiztos negatív eredményt.**

**AMIT EBBŐL TENNI KELL, ÉS AMIT SOHA:** a docblockot NE írd át. Egy igaz dokumentációt tennél
hamissá azon a fán, ahol érvényes, kettéválasztanál két bájt-azonos fájlt, és mivel a főkönyv
COMMIT-AZONOSSÁGRA illeszt, örökre át-nem-vettként mutatná őket. A javítás az ÁTVÉTEL.

**ÉS A MECHANIZMUS, AMI HÁRMUNKAT MEGFOGOTT: a `git show <sha>:<út>` BÁRMELY objektumot olvassa,
amit a repó tartalmaz -- beleértve egy IDEGEN upstreamről fetchelt commitot is.** A tévedés iránya
a legrosszabb: „nálunk volt és elveszett" (=> keressük meg) ahelyett, hogy „soha nem volt nálunk"
(=> vegyük át). **Egy `git show`, ami sikerül, nem állítás arról, hogy a commit a te fádon van.**

```bash
git merge-base --is-ancestor <sha> HEAD; echo $?     # 0 = a te fádon van, 1 = NINCS
# KONTROLL: a gyökér-commit ugyanezzel -> 0, különben a mérő nem tud igent mondani
```

**ÉS A CSAPDA NEM UPSTREAM-SPECIFIKUS -- HÁROM HELYI PÉLDÁNY EGY NAPON, HÁROM KÜLÖNBÖZŐ ÁGENSNÉL**
(didi gyűjtötte össze 2026-09-11): cherry-pickelt commitok, egy félig igaz hordozó-sor, és egy
megnevezett SHA, amire az `is-ancestor` rc=1-et ad, miközben a munka MÁS SHA alatt leszállt.
**Mindhárom esetben a HELYES eljárás adott magabiztos NEGATÍVAT olyan munkára, ami VALÓJÁBAN KÉSZ.**
A mérő nem romlott el: a kérdése az, hogy „ez a SHA a fán van-e", és a válasza igaz. Csak nem az a
kérdés, amit az ember feltesz -- az úgy hangzik, hogy „leszállt-e a MUNKA".

**AMITŐL HELYI LESZ:** cherry-pick, rebase, squash-merge és újraírt ág mind ÚJ SHA-t ad ugyanannak
a tartalomnak. Nem kell hozzá idegen upstream; elég egy sajat merge-munkafolyamat.

**A PRÓBA, ÉS OLCSÓ: ha az `is-ancestor` NEMET mond, kérdezd meg a TARTALMAT, mielőtt leletet írsz.**
Egy `git log --all --oneline --grep=<kártya-azonosító>` vagy a tárgy keresése a törzsön eldönti,
hogy a munka MÁS SHA alatt leszállt-e. A `landed-check.py` ezt már két lábbal csinálja
(`LANDED_UNDER_ANOTHER_SHA` külön rekesz) -- de aki KÉZZEL mér, annak ez a második lépés nem jut
eszébe, mert az első helyes választ adott.

### ÉS A REPO-BELI KERESÉS VAK A LAUNCHD-FOGYASZTÓRA (két mért eset egy napon)

    grep -rl '<szkript>' dist/ src/ scripts/ web/   ->   csak önmaga és a saját tesztje
    launchctl list | grep <unit>                    ->   BETÖLTVE, tíz percenként fut

A grep IGAZAT mond arról, amit megnézett: a repóról. A `~/Library/LaunchAgents/` nem a repó
része, tehát egy repo-hatókörű keresés SZERKEZETILEG nem láthatja -- és a hiánya **bájt-azonos**
egy valódi „semmi nem hívja" válasszal. Ebből 2026-08-27-én kétszer született hamis premissza
(`ci-watch`, `quota-ceiling-guard`), mindkétszer úgy, hogy a szkript közben rendben futott.

**Aki azt kérdezi, hogy „hívja-e valami", három helyen nézzen:** a repó, a
`~/Library/LaunchAgents/` (+ `launchctl list`), és a `~/.claude/scheduled-tasks/`. A repó
egyedül nem válasz.

**ÉS A `git ls-files | grep '\.plist$'` ITT ÜRESET AD, PEDIG MIND A NYOLC KÖVETVE VAN.** A követett
fájlok neve `scripts/com.marveen.<unit>.plist.template` -- a `$` horgony tehát SZERKEZETILEG kizárja
őket, és az üres találatból egy fél percig az következett, hogy nyolc futó launchd egység áll
fedezet nélkül.

    git ls-files | grep '\.plist$'   ->  ÜRES        <- a horgony kizárja a .template végződést
    git ls-files | grep -i plist      ->  8 sor       <- ugyanaz a kérdés, tágabb mérővel

**A megnyugtató és a riasztó irány itt EGYBEESETT, és ez a ritkább, veszélyesebb eset:** a hamis
eredmény egy *súlyosabb* leletet állított, tehát a „ne dőlj be a kényelmes válasznak" reflex nem
fogta meg. Ami megfogta: ugyanaz a kérdés, MÁSIK mérővel.

### EGY `scripts/` MERGE UTAN FUSSON LE A DECISION-INDEX ŐRE -- ÉS A „FUTTASD AZ ÉRINTETT
### TESZTEKET" HEURISZTIKA SZERKEZETILEG NEM LÁTJA (friday mérte, 2026-09-11)

Két `scripts/`-et érintő merge után a KÉT érintett shell-teszt lefutott, mind a három ellenőrzés
helyes volt -- **és a törzs közben PIROS volt.** A `decision-index --check` `rc=3`-at adott, és
semmi nem szólt: az őr csak akkor tüzelt, amikor valaki lefuttatta a teljes készletet.

**ÉS EZ NEM ALAPOSSÁG KÉRDÉSE, HANEM SZERKEZET:** egyik merge sem érinti sem a
`src/__tests__/decision-index.test.ts`-t, sem a `docs/scripts-decisions.md`-t (**0** és **0**). Az
őr egy olyan fájlt olvas, amit egyik ág sem érint, és pontosan AZOKTÓL a fájloktól avul el, amiket
érintenek. **A heurisztika és a bukás diszjunkt, tervezésből.**

> **Bármely merge, ami `scripts/` alatt ÚJ fájlt ad vagy átnevez, elavít egy GENERÁLT indexet
> máshol a fában.**

```bash
python3 scripts/decision-index.py --check    # 0 = friss, 3 = ELAVULT (javitas: ugyanez --check nelkul)
# KONTROLL mindkét irányba: szándékosan törd el -> 3, állítsd vissza -> 0
```

*(A mért irány itt is a megnyugtató: a merge sikeres, a két futtatott teszt zöld, a commit
létrejön -- a piros törzs pedig addig áll, amíg valaki más rá nem fut.)*

### HA EGY KÁRTYA COMMITOT TERMEL, A LEZÁRÁSI FELTÉTELE NEVEZZE MEG A SÁVOT
Ugyanez a lecke a táblán. A mai köteg 14 érintett kártyájából, aminek saját beolvadt ága van,
HÁRMON állt kimondott lezárási feltétel; a többi tizenegyen nem. Ott a „teljesült-e" kérdés a
KÁRTYÁRÓL nem dönthető el, csak a repóból -- vagyis a kártya nem tudja megmondani a saját állapotát.

Nem „beolvadt", hanem:
- „beolvadt a törzs-ágba (`scripts/` vagy `web/`) -- **AZONNAL HAT**",
- „beolvadt, **BUILDRE VÁR**",
- „beolvadt, **TELEPÍTÉSRE VÁR** (`launchctl`)".

Három szó, és utána a kártya önmagában eldönthető. Enélkül a „beolvadt" mindhárom esetben igaznak
látszik, és csak az elsőben jelenti azt, hogy a felhasználó számára megtörtént.



<!-- kivive a kozos CLAUDE.md-bol 2026-09-18 22:04 (kartya 2028900e) -->
### A HÁROM RÉTEG, AMIT A „KÉSZ" ÖSSZEMOS

    MERGED ..... a tartalom a torzson van
    BUILT ...... a tartalom a `dist/`-ben van    <- EZT meri a `.built-commit`, es igazat mond
    RUNNING .... a tartalom abban a FOLYAMATBAN van, amit a felhasznalo hasznal

**ÉS A DELTA-CRM-BEN A RUNNING RÉTEG MÉRŐJE MÁS, A RÉS HORDOZÓJA PEDIG NÉMA** (marveen mérte magán
2026-09-17, egy ÉLES biztonsági javításon, amiről MÁR MEGÍRTA a gazdának, hogy kiszállt).

A `deploy.yml` a `github.sha`-val címkézi a képet, tehát **a kép-címke MAGA a commit SHA** -- ez a
RUNNING réteg olvasható mérője, és nem kell hozzá se marker, se build-mező:

```bash
gcloud run services describe delta-crm-backend --region europe-west1 --project delta-crm-483922 \
  --format='value(spec.template.spec.containers[0].image)'        # a cimke = a FUTO commit
gh api repos/balintisti/Delta-CRM/compare/<az a sha>...main --jq '.ahead_by'   # 0 = KI VAN SZALLITVA
# KONTROLL: compare(<sha>, UGYANAZ) -> "identical", kulonben a mero nem tud nullat mondani
```

**A HORDOZÓ, AMIÉRT EZ NEM A FENTI ISMÉTLÉSE: a `Deploy to Cloud Run` `workflow_run`-ra fut, tehát
egy PIROS CI mellett `skipped` lesz.** Nem bukik, nem riaszt, és nem hagy nyomot a kártyán: a merge
megtörtént, a merge-commit ott ül a törzsön, és a telepítés SOHA nem indult el.

    egy BUKO deploy ....... van futas, van piros, valaki ranez
    egy SKIPPED deploy .... nincs mit megnezni, es egy SIKERES merge mellett all

**A MÉRT ESET ÁRA:** a tenant-határ javítása 14:37-kor olvadt be, 14:40-kor azt írtam a gazdának,
hogy az éles rés bezárult, és 16:0x-kor az éles kép MÉG MINDIG a 12:32-es commité volt. EGY teszt
bukott 802-ből (bájt-azonos fán két órával korábban ÁTMENT, tehát flake), és az az egy teszt
tartotta élesen kívül a biztonsági javítást.

> **Egy `main`-re való merge után a kérdés nem az, hogy ZÖLD-E A CI, hanem hogy MOZDULT-E A
> KÉP-CÍMKE.** A kettő között egy némán kihagyható munkafolyamat áll.

**ÉS NE ÍRJ RÁ DETEKTORT A `skipped`-RE: AZ A GYAKORI ESET.** Mérve ugyanaznap, 100 `Deploy to
Cloud Run` futáson a `main`-en: **45 skipped, 50 success, 3 failure, 2 cancelled**. És a kihagyás
ÖNMAGÁT GYÓGYÍTJA, mert a telepítés KUMULATÍV -- három mintavett kihagyott commit (852933b02,
d5d7a1912, 0183f20be) MIND benne van a rá következő sikeres telepítésben.

    a `skipped` sorok 45%-a ..... RUTIN, es a kovetkezo sikeres deploy lefedi -> NEM jel
    a res, ami SZAMIT ........... kizarolag a CSUCSON: main feje kontra az ELES kep-cimke

**Vagyis a mai eset nem azért maradt észrevétlen, mert rejtve volt, hanem mert a jelzés alakja a
LEGGYAKORIBB kimenettel azonos.** A kérdés ezért ÁLLAPOT, nem esemény: nem „kihagyott-e egy
deploy", hanem „ELŐTTE ÁLL-E MA a törzs az éles képnek".

**A marker nem hazudik: MÁS kérdésre válaszol.** Mért eset: nyolc `marker == HEAD` ellenőrzés, mind a
nyolc igaz, miközben a futó folyamat **41 perccel** a saját buildje mögött állt.

**ÉS NE A `build.status` MEZŐ LEGYEN A MÉRŐ:** az EGY mezőben KÉT független feltételt hordoz, és a
`stale-source` ág ELŐBB tér vissza. Ha mindkettő áll, a mező ELHALLGATJA a RUNNING-rést -- épp azt
az esetet, amikor fordítani ÉS újraindítani is kell.

```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/overview \
  | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; \
      print('RUNNING elavult?' , b['startedAt'] < b['builtAt'], '| status:', b['status'])"
# a `status` EMBERNEK szol, a ket idobelyeg OSSZEHASONLITASA a gepi valasz
```

**ÉS EZ A MÉRŐ IS SZŰKEBB KÉRDÉSRE VÁLASZOL, MINT AMIT AZ EMBER FELTESZ:** a `startedAt < builtAt`
azt mondja meg, hogy „a FOLYAMAT nem maradt le a SAJÁT buildjétől" -- nem azt, hogy „a FUTÓ KÓD
tartalmazza-e, amit ma beolvasztottam". A kettő EGYÜTT is lehet zöld egy MÁSIK build mellett.

**A HÁROM KÉRDÉS, ÉS MINDHÁRMAT KÜLÖN KELL FELTENNI:**

    lemaradt-e a FOLYAMAT a sajat buildjetol? .... `startedAt < builtAt`
    lemaradt-e a BUILD a torzstol? ............... `git rev-list --count <builtCommit>..HEAD -- src/`
    ott van-e a KONKRET valtozas a dist-ben? ..... `ls dist/<ut>` -- parancs nelkul is olvashato

```bash
ls dist/web/<az-uj-modul>.js    # "No such file or directory" = a merge NINCS a futo fában
```

**ÉS A `stale-source` ÚTVONAL-FÜGGETLEN, tehát ELLENTÉTES választ ad:** a `status` pontosan és
helyesen válaszol arra, hogy a forrás mozdult-e (mért eset: 18 commit, ebből **0** érinti a `src/`-t)
-- csak nem ez az a kérdés, amitől bárki buildel és újraindít.

```bash
B=$(curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/overview \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['build']['builtCommit']['commit'])")
git rev-list --count $B..HEAD -- src/     # 0 = egy build SEMMIT nem valtoztatna
# KONTROLL, mindket iranyba: HEAD..HEAD -> 0, es ugyanez a mero a teljes tortenetre -> nem-nulla
```

**AMIT EZ NEM MOND: hogy soha nem tartozunk builddel.** Amint egy `src/`-t érintő ág beolvad,
ugyanez a mérő NEM-NULLÁT ad. A recept értelme épp ez: a válasz naponta változik, tehát MÉRNI kell.

**A SZOKÁS, AMI OLCSÓ, ÉS EGY HAJNALON HÁROM ÓRÁT SPÓROLT VOLNA:**

```bash
git log --all --oneline --grep=<kulcsszó>     # MIELŐTT védelmet írsz, nézd meg, megírták-e
```

**ÉS A TÖRVÉNY NEM REPÓK KÖZÖTT A LEGÉLESEBB, HANEM EGY REPÓN BELÜL.** A mért eset: egy PONTOSAN
erre a hibaalakra írt, KÖVETETT helyi fájl használatlanul állt HÁROM KÖNYVTÁRRA attól a spectől,
ami ugyanabba a hibába futott. Ott a „megvan-e egyáltalán" kérdésre a válasz IGEN, tehát fel sem
merül, hogy megkérdezzük.
