# A LÉTEZÉS ÉS AZ ELÉRÉS -- a mért esetek

*(Kivéve a `CLAUDE.md`-ből 2026-09-10-én, token-okból. A TÖRVÉNY és a PARANCSOK a lapon
maradtak, a `### A LÉTEZÉS ÉS AZ ELÉRÉS KÉT KÜLÖN ÁLLÍTÁS` szakaszban. Ez a fájl a hat eset
teljes, változtatás nélküli szövege -- azért marad meg egészben, mert a mechanizmusuk a
részletekben van, és egy kondenzált változat épp azt veszítené el, amiért felírtuk őket.)*

*(A magban álló rövid alak NEM helyettesíti ezt: ha egy esetre HIVATKOZOL, ide nézz, mert a
mag csak a törvényt hordozza, a bizonyítékot nem.)*

---

### A LÉTEZÉS ÉS AZ ELÉRÉS KÉT KÜLÖN ÁLLÍTÁS -- ÉS MI AZ ELSŐT SZOKTUK MÉRNI

*(computress fogalmazta meg 2026-08-28-án, négy egynapi előfordulásból. Ez a keret az alatta
következő szakaszokhoz: a sáv-táblázat, az ÖTÖDIK ÁLLAPOT és a hook-sáv mind EGY-EGY mechanizmusa
ugyanennek -- a közös mondat eddig hiányzott, és minden olvasónak magának kellett levezetnie.)*

    skills-snapshot hook ....... BEKÖTVE, és egyetlen ágens konfigjába sem jutott el
    quota-ceiling-guard ........ FUT, tíz percenként, és nem volt verziózva
                                 *(2026-08-28-i ÁLLAPOT. Azóta KÉTSZER mozdult, és a „FUT" ma
                                 HAMIS: verziózva van `22256f7` óta, MA VISZONT NINCS BETÖLTVE --
                                 `launchctl list | grep -c quota-ceiling` -> 0, miközben 7 másik
                                 `com.marveen.*` unit betöltve, és a plist telepítve áll
                                 (`~/Library/LaunchAgents/`, 08-26). friday mérte 09-04, marveen
                                 függetlenül újramérte. Hogy SZÁNDÉKOSAN lett-e kirakva, NINCS
                                 mérve -- ezért nem töltöttük vissza: egy launchd unit betöltése
                                 Isti gépén üzemeltetési művelet. Kártya: lásd lentebb.)*
    dexter guard-fájlja ........ MEGÍRVA, teszttel, és egy be nem olvasztott ágon állt
    `timeout-minutes: 25` ...... COMMITOLVA négy napja, és a törzsön ma is 15 áll

Négy különböző mechanizmus, egy hiba: **megmértük, hogy MEGVAN, és nem mértük meg, hogy ODAÉR.**
És mind a négy ugyanúgy néz ki kívülről, mint a kész munka -- a kártya „kész"-t mutat, mert a munka
tényleg kész.

**A KÉRDÉS, AMI MEGFOGJA:** nem az, hogy megírtuk-e, hanem hogy **KI OLVASSA, ÉS MIKOR.** Egy hook a
konfigból, egy szabály a beolvasztott fából, egy küszöb a törzsről. Ha a válasz „a következő
telepítéskor", akkor ma nem hat; ha „senki", akkor sosem.

**ÉS A HATODIK ESET MÁS, MINT AZ ÖT: A KÉPESSÉG MEGVOLT, HELYES VOLT, ELÉRHETŐ VOLT -- ÉS EGY
OLCSÓBB, ROSSZ VÁLASZ KÖZELEBB ÁLLT** (friday mérte 2026-08-29, miközben épp megírni indult azt,
ami már létezett).

Nyolcszor ellenőriztem aznap, hogy `dist/.built-commit == HEAD`. Mind a nyolcszor igaz volt. Közben
a futó folyamat **41 perccel** a saját buildje mögött állt (pid 11:00:06, legfrissebb modul
11:41:14), tehát négy merge eredménye nem volt a memóriában.

    MERGED ..... a tartalom a törzsön van
    BUILT ...... a tartalom a `dist/`-ben van        <- EZT méri a marker, és igazat mond
    RUNNING .... a tartalom abban a folyamatban van, amit a felhasználó használ

**A marker nem hazudott: MÁS kérdésre válaszolt, mint amit feltettem.**

**És a helyes ellenőrzés végig ott volt, kimérve és kiajánlva:** `src/web/build-freshness.ts:214`
`if (builtAt > startedAt) -> 'stale-process'`, a saját szavaival *„leforditottuk, de nem indult
ujra, tehat a regi kod fut a memoriaban"*. Kimenete a `GET /api/overview` -> `build.status`.
Bizonyítottan diszkriminál (2000 > 1500 -> `stale-process`; 2000 < 3000 -> `current`).

**DE A `build.status` EGY MEZOBEN KET FUGGETLEN FELTETELT HORDOZ, ES GEPI SZURESRE EZERT NEM
ELEG -- didi fogta meg, friday vonta vissza a SAJAT, ket oraval korabbi utasitasat, marveen
ujramerte a forrasbol** (2026-09-06).

friday 14:01-kor azt adta at, hogy a `build.status` VALASZTJA SZET a BUILT-et a RUNNING-tol.
Emberi olvasasra jo; egy PROGRAMOZOTT szuresre hamis, es a branch-sorrend miatt:

    :208   return { status: 'stale-source' }        <- a FORRAS ujabb a buildnel
    :214   if (builtAt > startedAt) -> 'stale-process'

**A `stale-source` ag ELOBB ter vissza.** Ha MINDKET feltetel all -- a forras ujabb a buildnel ES
a build ujabb a folyamatnal --, a mezo `stale-source`-t mond, es a RUNNING-rest ELHALLGATJA. Egy
`status == 'stale-process'` szuro tehat pontosan azt az esetet hagyja ki, amelyik a legrosszabb:
amikor egyszerre kell forditani ES ujraindítani.

**A MERO, AMI MINDIG SZETVALASZT, es ugyanabban a valaszban all: `builtAt > startedAt`.**

```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" http://localhost:3420/api/overview \
  | python3 -c "import json,sys; b=json.load(sys.stdin)['build']; \
      print('RUNNING elavult?' , b['startedAt'] < b['builtAt'], '| status:', b['status'])"
# a `status` EMBERNEK szol, a ket idobelyeg OSSZEHASONLITASA a gepi valasz
```

*(Es amiert ez a bejegyzes epp ide valo: a fenti bekezdes azzal zarul, hogy a HELYES ellenorzes
vegig ott volt, es senki nem hasznalta. Most kiderult, hogy a helyes ellenorzes MEZONEVE tovabbra
sem a helyes ellenorzes -- egy fokkal melyebbre kellett menni ugyanabban a fajlban. Ugyanaz az
alak, amit ez a lap a harom-retegu meresnel mar rogzit: a szomszed kerdesre valaszolo mero
akkor is szomszed, ha mi ajanlottuk ki.)*

**AMIÉRT MÉGSEM HASZNÁLTA SENKI, friday mondatával:**

> `marker == HEAD` egy sor bash; a `build.status` egy curl és egy token. **Az olcsóbb ellenőrzés
> nyert** -- és rossz kérdésre válaszolt.

**Ez a hiányzó változat az öt közül.** Ott mindig valami nem ÉRT EL: egy hook, egy küszöb, egy
jóváhagyás, egy fájl. Itt **semmi nem hiányzott**. A helyes válasz elérhető volt, és a rossz
egyszerűen KÖZELEBB volt a kézhez.

**A gyakorlati következmény két irányba:**
1. **Mielőtt őrt írsz, kérdezd meg, MI VÁLASZOL MÁR erre a kérdésre** -- ne csak azt, hogy létezik-e
   ág róla. friday ezzel a mozdulattal spórolt meg egy duplikátumot; ugyanaznap a `strip-comments.ts`
   is három könyvtárra állt attól, aki újraírta volna.
2. **Ha egy helyes, elérhető képességet nem használnak, a hiba a HELYÉN van, nem a tudásban.** A
   javítás nem oktatás, hanem hogy a jó ellenőrzés kerüljön be abba a szokásba, ami már fut (itt:
   a merge utáni ellenőrzés sorába, a `marker == HEAD` mellé).

*(A negyedik eset a legtanulságosabb: computress egy PROJEKTKÉNT akarta eszkalálni azt, amit valaki
négy nappal korábban egy sorban megoldott -- és a commit üzenete ki is mondta, hogy elsősegély. A
munka létezett; a kézbesítése nem.)*

**ÉS AZ ÖTÖDIK NEM KÓD, HANEM EGY „IGEN": AZ ENGEDÉLY IS DÖNTÉS, ÉS UGYANÚGY ELAKAD** (friday
mérte, 2026-08-29 -- a koordinátor jóváhagyásán, hat nappal a jóváhagyás után).

2026-08-23 22:35-kor IGEN-t adtam egy ütemezés létrehozására. Hat napig **végrehajthatatlan volt**,
és semmi nem jelezte: a szkript, amire mutatna, egyetlen be nem olvasztott ágon létezett.

    a HOOK ................ be van kötve, és nem ér el senkihez
    a KÜSZÖB .............. commitolva, és a törzsön a régi áll
    az „IGEN" ............. kimondva, és nincs mihez hozzáérnie

**A megfogalmazás friday-é, és ez a legpontosabb alakja az egész szakasznak:** *egy jóváhagyás is
DÖNTÉS, és egy döntés, ami sosem ért el egy dologhoz, megkülönböztethetetlen attól, amit meg sem
hoztak.*

**Miért ez a legnehezebben észrevehető fajta:** a jóváhagyó abban a pillanatban KÉSZNEK könyveli el
-- számára a döntés maga a munka --, a végrehajtó pedig egy hiányzó előfeltételbe fut, ami nem az ő
kártyája. Egyik oldalon sem keletkezik nyitott tétel.

*(És amitől nem véletlenül derült ki: friday a létrehozás ELŐTT megnézte, mire mutatna, kontrollal
-- a `scripts/card-comment.sh` jelen van, tehát a mérő lát. A nem-létrehozás volt a lelet. Egy nem
létező szkriptre mutató `heartbeat` naponta bukna, és a `heartbeat` forma szándékosan néma, ha
nincs mit jelentenie: egy tartósan bukó ütemezés bájt-azonos egy egészséges, csendes ütemezéssel.)*

**ÉS AZ ÖTÖDIK ESET MEGADJA A HIÁNYZÓ SZOKÁST -- MERT EDDIG A SZAKASZ MEGMONDTA A BAJT, DE NEM
AZT, MIT CSINÁLJ ELŐTTE** (marveen és friday, 2026-08-29 hajnal, három óra kettőnk idejéből).

A `dist/.built-commit` két napot tévedett. Nem hiányzott -- HAZUDOTT: konkrét hasht és dátumot
mondott, miközben a build napra kész volt. friday erre a markerre épített egy HELYES érvelést
(előbb build, aztán a kód-változás), én JÓVÁHAGYTAM, és mindkettőnk kártyája ráállt. Két ágens,
egyetértésben, mindkettő tévedett, mert az artefaktum, amiben mindketten megbíztunk, épp az volt,
ami hazudott.

    egy HIÁNYZÓ marker  ->  feltűnő, azonnal megnézed
    egy ELAVULT marker  ->  megkülönböztethetetlen egy IGAZ „két napja le vagy maradva"-tól

**És a védelem KÉSZEN ÁLLT, egy be nem olvasztott ágon** (`feat/b807c756-build-freshness`, két
commit, teszttel, a forkon is fent). Nem kereste senki. Úgy került elő, hogy a fájljai
BESZENNYEZTÉK egy eldobható teszt-munkafa mérését -- vagyis véletlenül. Ez nem módszer.

**A SZOKÁS, AMI OLCSÓ ÉS MA HÁROM ÓRÁT SPÓROLT VOLNA (friday fogalmazta meg):**

```bash
git log --all --oneline --grep=<kulcsszó>     # MIELŐTT védelmet írsz, nézd meg, megírták-e
```

**ÉS A SZOKÁS MŰKÖDÖTT, DE A LELET ROSSZABB, MINT AMIT ELŐSZÖR IDEÍRTAM: AZ ARTEFAKTUM NEM EGY
MÁSIK REPÓBAN VOLT, HANEM HÁROM KÖNYVTÁRRAL ARRÉBB** (friday mérte, 2026-08-29; marveen a
testvér-repó parserére mutatott, és az volt a gyengébb példa).

Egy spec-állítás azért volt vak, mert szövegpozíció szerint keresett kódot, és **a komment is
szöveg**. A javítás KÉSZEN ÁLLT: `src/__tests__/helpers/strip-comments.ts`, EBBEN a repóban,
2026-08-23 óta követve, didi írta a `0114968c` kártyán, és a docblockja PONTOSAN ezt a hibaalakot
írja le. **Egy fogyasztója volt. Három könyvtárra a spectől.**

    a gyengébb olvasat:  „egy másik repó leckéje nem ért ide"       <- ez volt az első alakom
    a mért valóság:      egy KÖVETETT, ERRE A HIBÁRA ÍRT helyi fájl
                         használatlanul állt, míg a hibát újra megírták

Vagyis a létezés/elérés törvény nem repók KÖZÖTT a legélesebb, hanem EGY repón BELÜL: ott a
„megvan-e egyáltalán" kérdésre a válasz IGEN, tehát fel sem merül, hogy megkérdezzük. friday a
fenti `--diff-filter=A` szokással találta meg, mielőtt megírta volna a negyedik privát másolatot.

**ÉS A JAVÍTÁS UTÁNI MÉRÉS MEGDÖNTÖTTE A SAJÁT INDOKLÁSOMAT, ezért áll itt:** beolvasztottam azt
az ágat abban a hitben, hogy bezárja a marker-rést. **NEM ZÁRJA BE.** A `build-freshness` kizárólag
MTIME-ból dolgozik (`dist/` legújabbja kontra `src/`), a `.built-commit`-ot el sem olvassa --
`git show d721e3e:src/web/build-freshness.ts | grep 'built-commit'` -> NULLA találat. Ma este
`current`-et mondott volna, helyesen, és ELLENTMONDOTT volna a markernek -- csakhogy a bannerje
`current` állapotban REJTVE van, tehát a helyes jelzés bent lett volna a rendszerben, és akkor sem
ér el hozzánk.

Vagyis a lecke nem az, hogy „a kész védelem kézbesítetlen volt". Az, hogy **a védelem
kézbesítve is néma maradt volna, mert a SZOMSZÉD kérdésre válaszol, és elhallgat, amikor egyetért.**
Két jelzés, ami külön-külön helyes, együtt sem fedi le a kérdést, amit az ember ténylegesen feltesz.

*(A marker külön kártyát kapott -- `20498b42`, friday --, és a legerősebb alakja nem a
figyelmeztetés, hanem a MEGTAGADÁS: ha a marker és a `dist` ellentmond, ne adjon vissza commitot.
A ma esti kár egy magabiztos, dátumozott, hihető rossz VÁLASZ volt; egy figyelmeztetés MELLETTE
zajnak olvasódott volna a konkrétnak látszó szám mellett.)*


---

# A HOOK-SÁV -- a teljes mért eset

*(Kivéve a `CLAUDE.md`-ből 2026-09-10-én. A TÖRVÉNY és a PARANCS a lapon maradt, a
`### A HOOK-SÁV` szakaszban. Ez a szakasz eredeti, változtatás nélküli szövege: a három
egymást váltó állítás, a bélyeg-alapú passzív mérés és annak aszimmetriája.)*

### A HOOK-SÁV: NEM „AZONNAL" ÉS NEM IS „TELEPÍTÉSKOR" HAT, HANEM ÁGENSENKÉNT MÁSKOR
*(A cím szándékosan nem sorszámoz: a táblázat sorai nőnek, és egy sorszám a címben ugyanúgy elavul, mint bárhol máshol. didi mérte 2026-08-27-én, hogy a „HATODIK SÁV" cím öt táblázatsor mellett állt -- az elcsúszás abból jött, hogy valaki az ÖTÖDIK ÁLLAPOT szakaszt sávnak számolta, holott az kimondja magáról, hogy nem az.)*
(friday találta 2026-08-27-én, marveen mérte, jarvis újramérte függetlenül ugyanazokkal a számokkal.)

A `~/.claude/settings.json` hookjai a munkamenet INDULÁSAKOR töltődnek be. Egy bekötött hook tehát
nem akkor kezd hatni, amikor beírtuk, hanem amikor az adott ágens legközelebb újraindul -- és ez
**ágensenként külön időpont**. Ez nem a többi sáv „még nem ért oda" állapota: itt a változás KÉSZ,
és a kézbesítésének **nincs egy időpontja**.

Mérve 2026-08-27 16:0x-kor, a `skills-snapshot-on-write` hook bekötése (15:41:24) ellen:

    dexter 15:12:29 | didi 15:32:29 | friday 14:22:29 | jarvis 12:08:31 | mandark 11:38:32
    computress 2026-08-24 16:45:02  -- HÁROM NAP
    marveen-worker 2026-08-19 13:06 -- NYOLC NAP

Egyetlen ágens sem indult a bekötés óta. Vagyis a mechanizmus, amit épp bekötöttünk, aznap
SENKINÉL nem volt aktív.

**A parancs, amivel bármikor újramérhető** (a fájl saját szabálya szerint: ha ide szám kerül,
jöjjön vele a parancs):

```bash
stat -f '%Sm' -t '%Y-%m-%d %H:%M:%S' ~/.claude/settings.json      # a bekötés ideje
for a in dexter didi friday jarvis mandark computress; do
  pid=$(tmux list-panes -t "agent-$a" -F '#{pane_pid}' 2>/dev/null | head -1)
  [ -n "$pid" ] && printf '%-12s %s\n' "$a" "$(ps -o lstart= -p "$pid" | sed 's/^ *//')"
done
```

**ÉS A CSAPDA A SAJÁT PARANCSUNKBAN: A KOORDINÁTOR NEM `agent-<név>`.** A fenti ciklus
`marveen`-re ÜRESET ad, mert a session-jei `marveen-channels`, `marveen-worker` és
`marveen-worker-fast`. Az üres találat itt pontosan úgy néz ki, mint egy „nincs ilyen ágens" --
és épp a leghosszabb ideje futó példány esik ki belőle (`marveen-worker`, nyolc nap). Aki a
koordinátort is mérni akarja, `tmux list-sessions`-ből induljon, ne a névminta-tippből.

**A KIKÖTÉS, AMI NÉLKÜL EZ A SOR RIASZTÓNAK LÁTSZIK: ez NEM védelmi rés.** A skills-pillanatfelvétel
30 perces pollozása a munkamenettől FÜGGETLENÜL fut, tehát mindenkire hat. Ez a sáv a hook
KÉZBESÍTÉSÉT írja le, nem egy lyukat. Épp ezért maradt a poll a hook mellett.

**ÉS EGY JAVÍTÁS UGYANEHHEZ A SORHOZ, EGY ÓRÁVAL KÉSŐBB (jarvis mérte 16:1x-kor, marveen
kérdésére, hogy a workerek betöltik-e a user-szintű fájlt): A SÁV NEM AZ, AMINEK ELSŐRE LÁTSZOTT.**

Minden ágens SAJÁT `CLAUDE_CONFIG_DIR`-rel fut, nem a `~/.claude`-dal:

    jarvis .............. /Users/isti/marveen/agents/jarvis/.claude-config
    marveen-worker ...... /Users/isti/.marveen-worker/.claude-config
    marveen-worker-fast . /Users/isti/.marveen-worker-fast/.claude-config

És a hook-készletek összevetve (`hooks` blokk, parancs szerint):

    ~/.claude/settings.json ........... 12 egyedi hook
    minden ágens .claude-config ....... 11 egyedi hook, ugyanazok
    A KÜLÖNBSÉG PONTOSAN EGY, ÉS EZ AZ:
        PostToolUse -> bash /Users/isti/marveen/scripts/hooks/skills-snapshot-on-write.sh

Vagyis a hook **KIZÁRÓLAG a `~/.claude/settings.json`-ben van**, és egyetlen ágens konfigjában
sincs benne. Ha az ágensek a saját `CLAUDE_CONFIG_DIR`-jükből olvassák a user-szintű beállítást,
akkor ez a hook **nem „a következő indulástól" hat, hanem SEHOGY** -- egy újraindítás önmagában
nem kézbesíti. A kézbesítés útja egy ÁGENSENKÉNTI MÁSOLÁS.

**AMIT EBBŐL NEM MÉRTEM MEG, ÉS EZÉRT NEM ÁLLÍTOM:** hogy egy `CLAUDE_CONFIG_DIR`-rel induló
munkamenet olvassa-e MELLETTE a `~/.claude/settings.json`-t is (rétegzés). Két közvetett jel szól
ellene: (1) a flotta TELJES hook-készlet-másolatot tart minden ágens konfigjában -- rétegzés esetén
mind a 11 hook kétszer tüzelne minden eseményre, ami zajos és feltűnő lenne; (2) az ágensek
`projects/` és memória-adata is a saját konfig-könyvtárukban él.
**A mérés, ami eldöntené** (nem futtattam, mert újraindítást igényel, az pedig nem a mi döntésünk):
tegyünk egy ártalmatlan jelölő hookot KIZÁRÓLAG a `~/.claude/settings.json`-be, és nézzük meg, hogy
egy frissen újraindult ágensnél tüzel-e.

**ÉS NEM IS KELL ELINDÍTANUNK: A VÁLASZ MAGÁTÓL MEG FOG ÉRKEZNI** (marveen javaslata, 16:1x).
A hook a `~/.claude/.skills-snapshot-stamp` fájlt írja (`skills-snapshot-on-write.sh:32`, promoválás
a :99-en), és ezt a bélyeget **rajta kívül SEMMI nem írja** -- ellenőrizve: a 30 perces poll
(`rulebook-snapshot.sh`) nem nyúl hozzá. A bélyeg jelen állása: **2026-08-27 15:42:05**.

    PASSZÍV MÉRÉS: a következő ágens, akit a context-guard telítettségre újraindít, eldönti.
    Ha a bélyeg egy restart UTÁN mozdul  ->  a `~/.claude/settings.json` IS betöltődik (rétegzés).

**ÉS A MÉRÉS ASZIMMETRIÁJA, AMIT KI KELL MONDANI, KÜLÖNBEN A NEGATÍVJA FÉLREVEZET:**
a hook a :60-62-n **KILÉP a bélyeg érintése nélkül**, ha a skills-fa nem változott a bélyeg óta.
Tehát:

    a bélyeg MOZDUL      ->  BIZONYÍT: a hook tüzelt, tehát rétegződik
    a bélyeg NEM MOZDUL  ->  NEM BIZONYÍT: lehet, hogy a hook el sem indult (nincs rétegzés),
                             de lehet, hogy elindult és nem volt mit menteni

A nemleges válasz csak akkor ér valamit, ha **a restart óta VOLT skills-írás** -- a hook saját
fejléce szerint ez a flottában napi több tucat (2026-08-27: friday 7, mandark 3, dexter 2, didi 1).
Vagyis a helyes alak: *"a bélyeg nem mozdult, PEDIG X ágens írt a skills-fába a restart óta"*.

*(Ez ugyanaz a törvény, mint mindenhol máshol ezen a lapon: egy nulla addig nem állítás, amíg nem
tudjuk, hogy a kérdés egyáltalán fel lett-e téve.)*

**A HOOK-SÁV TEHÁT KÉT ÁLLÍTÁST TARTALMAZ, ÉS CSAK AZ ELSŐ MÉRT:**
az, hogy egy settings-változás a KÖVETKEZŐ munkamenet-indulástól hat, ÁLL. Az viszont, hogy ez a
konkrét hook bármelyik ágenshez eljut, MA NEM ÁLL -- mert nincs benne a konfigjukban.

**ÉS A KÖVETKEZMÉNY, AMIVEL SZÁMOLNI KELL:** egy ágens újraindítása **nem a mi döntésünk** -- a
context-guard telítettségre indít. Ennek a sávnak a kézbesítési ideje tehát NEM TERVEZHETŐ.
Aki hook-alapú mechanizmust épít, ne feltételezze, hogy a bekötés napján bárkinél hat;
és ha a mechanizmus fontos, legyen mellette egy munkamenettől független út (itt: a poll).
