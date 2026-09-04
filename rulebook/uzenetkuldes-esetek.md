# INTER-AGENT UZENETKULDES -- ESET-ARCHIVUM

Ez a `CLAUDE.md` `## Uzenet kuldese masik agensnek` szakaszanak KISZERVEZETT bizonyitek-anyaga
(kartya `c5fcc2b5`). A lapon a MUKODESI SZABALYOK es a CSAPDAK allnak; itt a MERT ESETEK:
ki, mikor, milyen szoveggel, es mi lett a kovetkezmenye.

**A tartalom BETURE az eredeti szakasz, valtoztatas nelkul.**

**ES EGY KIKOTES, AMI EZT A SZAKASZT MEGKULONBOZTETI:** ez nem eset-gyujtemeny volt, hanem
MUKODESI recept, amit minden agens naponta hasznal, es amiben VEGREHAJTASI veszely van (egy
visszaperjeles szoveg nem elharapodik, hanem LEFUT). Ezert a magban TOBB maradt, mint a
mutacios szakasznal: a recept, minden csapda es minden megkulonbozteto -- csak az ESET-TORTENET
jott ide.

---

### Üzenet küldése másik ágensnek

Ha delegálni akarsz egy feladatot másik ágensnek, használd az API-t:

```bash
curl -s -X POST http://localhost:3420/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"from": "marveen", "to": "TARGET_AGENT", "content": "Feladat leírása."}'
```

**MEGBÍZHATÓ KÜLDÉS (verify + retry) — KÖTELEZŐ:** a gyakori `curl -s ... >/dev/null && echo sent` minta VESZÉLYES: a curl `0`-val tér vissza akkor is, ha a szerver ELUTASÍTOTTA a kérést (401/400/5xx), így NÉMA küldés-hiba keletkezik — a címzett sosem kapja meg az üzenetet, és két ágens végtelenül várhat egymásra. Egy üzenet CSAK akkor számít elküldöttnek, ha a válaszban visszajött egy `id` (`{"id":<n>,"status":"pending",...}` HTTP 200-zal). Vagy használd a `scripts/agent-msg.sh` helpert (HTTP-státusz + `id` ellenőrzés + 3x újraküldés + hiba-napló), vagy nyers curl-nél KÖTELEZŐ ellenőrizni a HTTP-kódot ÉS az `id`-t, és újraküldeni ha nincs:

```bash
bash scripts/agent-msg.sh marveen TARGET_AGENT "Feladat leírása."
# -> OK id=<n> queue=<hányan várnak> (~<perc> késés)   vagy   FAIL
# nagy/soktoros üzenethez a content jöhet STDIN-en:  echo "..." | bash scripts/agent-msg.sh marveen TARGET_AGENT -
```

**A HÉJ ELHARAPJA AZ ÜZENETET, ÉS AZ `OK id=` UTÁNA IS KIÍRÓDIK (2026-08-20, három eset egy nap).**
A `bash scripts/agent-msg.sh ... "szöveg"` alakban a szöveg egy héj-idézőjelen megy át. Ha visszaperjel
(`` ` ``) vagy `$` van benne -- például egy kódrészlet vagy egy szó, amit ki akartál emelni --, a héj
azt **parancshelyettesítésnek** olvassa: lefuttatja, és a helyére a *kimenetét* teszi. Az üzenet
elmegy, az `id` visszajön, tehát **sikeresnek látszik** -- csak épp hiányzik belőle egy szó, vagy a
fele. Mérve: Didi 12:58-kor egy backtickes kódrészleten veszítette el az üzenete végét
(„bad substitution"); nálam 14:35-kor a `` `failure` `` szó tűnt el pont abból a mondatból, ami a
`failure` és a `cancelled` közti különbséget magyarázta.

**Ezért a szabály nem az, hogy „vigyázz a backtickre", és nem is az, hogy „a HOSSZABB üzenet
menjen STDIN-en": A HOSSZ NEM SZEMPONT -- A TARTALOM AZ.** Ha van benne visszaperjel, `$`,
idézőjel vagy bármi, amit nem te írtál szó szerint, STDIN-en megy. Ott nincs héj-értelmezés:

```bash
f=$(mktemp)          # NE fix nevet: a /tmp KOZOS, lasd a munkafajl-szakaszt
cat > "$f" <<'EOF'
Ide jöhet bármi: `backtick`, $valtozo, "idezojel".
EOF
bash scripts/agent-msg.sh marveen TARGET_AGENT - < "$f"
```

A `<<'EOF'` (aposztrófos!) heredoc azért kell, mert aposztróf nélkül a heredoc IS behelyettesít.

**ÉS A MUNKAFÁJL A SESSION-SCRATCHPADBE MENJEN, NE A `/tmp`-BE -- ez ma egy MÁS ÁGENS SZÖVEGÉT
postázta valakinek a saját neve alatt** (mandark mérte 2026-08-28, marveen függetlenül újramérte;
kártya `af193b10`). A lánc: egy összetett parancs PARSE-hibával elhalt, tehát a heredoc SOSEM
írta meg a `/tmp/msg26.txt`-t -- csakhogy a fájl OTT VOLT, öt órával korábbról, egy másik
ágenstől. Az újraküldés beolvasta, és az ő szövegét postázta, `OK id=`-vel.

    /tmp/msg*.txt ... 358      /tmp/*.txt ... 3339      több ágens, EGY névtér

**A KETTŐS CSEND a lecke:** a parse-hiba HANGOS volt és el is kapták. A KÖVETKEZMÉNYE néma -- a
fájl nem íródott meg, de LÉTEZETT, más tartalommal. A helper a HTTP-kódot és az `id`-t
ellenőrzi; a TÖRZSET nem tudja. **Egy sikeres küldés semmit nem állít a tartalomról** -- és épp
ez a helper egyetlen értelme, egy szinttel arrébb.

Két szerkezeti javítás, figyelem nélkül:
1. Munkafájl a SESSION-SCRATCHPADBE (`/private/tmp/claude-501/.../<session>/scratchpad`) --
   konstrukcióból izolált, két ágens nem tud ugyanoda írni. Egy `msgNN.txt` egy megosztott
   névtérben nem azonosító, és a mért nevek fele ilyen.
2. Ha egy összetett parancs ELHAL, a benne lévő fájl-írásokat tekintsd MEG NEM TÖRTÉNTNEK.
   Írd újra a fájlt; ne csak a küldést ismételd meg.

**A „hosszabb" szó volt a hiba, és mérve fogott meg valakit** (friday, 2026-08-27). A régi alak a
HOSSZRA kötötte a szabályt, az ítéletet tehát az emberre bízta -- és egy rövid üzenetnél a
kézenfekvő döntés a `printf`. Aznap egy három bekezdéses levél ment így, benne EGY kiemelt szó
visszaperjelek között: a héj parancshelyettesítésnek olvasta, kiírta, hogy `command not found`, a
szó kiesett, és az `OK id=` utána is megjött. **Épp abban a levélben, amelyik egy másik mérési
hibát vont vissza** -- a figyelem oda ment, ahol a tartalom nehéz volt, és a MECHANIKA csúszott
meg. Ez nem irónia, hanem adat: a hosszra kötött szabály pont akkor enged el, amikor máson jár az
eszed.
Egysoros, BIZTOSAN sima szöveghez maradhat az idézőjeles alak -- de a kérdés ilyenkor is az, hogy
mi VAN benne, nem az, hogy milyen hosszú.

**ÉS A PONTOS MEGKÜLÖNBÖZTETŐ: DUPLA IDÉZŐJEL vs. APOSZTRÓF, nem `printf` vs. heredoc** (mérve
ugyanaznap). A fenti eset azért történt, mert a sorok `"..."` közt mentek: dupla idézőjelben a
héj BEHELYETTESÍT, aposztrófban nem. Két sor, egy fájlból futtatva:

```bash
printf '%s\n' "dupla:     egy `status` szuro"    # -> `command not found: status`, a szó KIESIK
printf '%s\n' 'aposztrof: egy `status` szuro'    # -> ép marad
```

*(Az első próbám ehhez ÉRVÉNYTELEN volt: a dupla idézőjeles sorban leescape-eltem a
visszaperjeleket, tehát mindkét alak épen jött ki, és majdnem azt írtam le, hogy „nincs
különbség". A kontroll akkor mér, ha a vizsgált karaktert NEM véded le előle.)*

**ÉS EZ NEM AZ `agent-msg.sh` SAJÁTOSSÁGA -- BÁRMILYEN IDÉZŐJELES HÉJ-ARGUMENTUMRA ÁLL
(Dexter mérte 2026-08-22, `git commit -m`-ben).** Ez a szakasz évekig úgy olvasódott, mintha az
üzenetküldés hibája lenne. Nem az: a héj az, ami behelyettesít, és nem érdekli, mi a parancs.
Dexter egy commit-üzenetbe írt bele visszaperjeles parancsnevet, a héj **lefuttatta**, és az
üzenetből kiesett két szó. Ugyanaz az alak, más parancs -- és a commit-üzenetnél még csendesebb,
mert ott nincs `id`, amit vissza lehetne olvasni: a hibás szöveg egyszerűen a történelem része lesz.

**ÉS A ROSSZABBIK KIMENET NEM AZ ELVESZETT SZÖVEG, HANEM A LEFUTOTT PARANCS** (jarvis mérte magán,
2026-08-27 22:34 -- ma HATODSZOR ugyanabba a héj-hibába, és ELŐSZÖR úgy, hogy parancs hajtódott
végre).

Egy `git add -f` alakot írt le `echo`-ban, visszaperjelek között. A héj parancshelyettesítésnek
olvasta, és **ténylegesen lefuttatott egy `git add -f`-et a KÖZÖS Delta-CRM checkoutban.**

    kimenet: `Nothing specified, nothing added`   -> nulla kár, ellenőrizve
    (git status --porcelain üres, git diff --cached üres, mindkét repóban)

**Ártalmatlan volt, de nem érdemből: az argumentum véletlenül üres maradt.** Egy
`` `git add -f .env` `` alakú sztring ugyanígy lefutott volna -- és pont az a fájl, amit a
titok-kapunk keres.

    eddig a lapon:   a héj ELHARAPJA a szöveget  -> egy szó kiesik, az `OK id=` megjön
    a rosszabb fele: a héj VÉGREHAJTJA a szöveget -> egy parancs fut le, ott, ahol állsz

A kettő között nem fokozat van, hanem kategóriakülönbség. Az első az üzenetet rontja el; a második
a MUNKAFÁT -- és egy megosztott checkoutban valaki MÁS munkafáját. A backtick nem idézőjel: a héj
számára utasítás.

**Ez a legerősebb érv a heredoc mellett, és nem a hosszra vonatkozik.** Ha a szövegben visszaperjel
van, nem azt kockáztatod, hogy csonka lesz -- hanem hogy lefut. `<<'EOF'`, aposztróffal.

A szabály tehát: **ahol szabad szöveget adsz át héj-argumentumként, ott heredoc**, ne idézőjel.
`git commit -F -` aposztrófos heredoccal, `agent-msg.sh ... -` STDIN-nel. Az egysoros, biztosan
sima szöveg a kivétel, nem a szabály.

A rendszer automatikusan:
1. Beírja az üzenetet a célpont ágens tmux session-jébe
2. A célpont ágens megkapja mint "[Üzenet @marveen-tól]: ..." formátumban
3. A célpont ágens feldolgozza és a saját Telegram csatornáján válaszol

**AZ "elküldve" NEM "megérkezett" — és a helper mostantól kiírja a különbséget (2026-08-20, mérve).**
A router csak a címzett paneljének IDLE réseibe tud tmux-injektálni, tehát egy dolgozó ágens sora
annyira ürül, amennyire a fordulói véget érnek. Egy 37 perces forduló alatt nulla kézbesítés
lehetséges. Ez nem hiba: egy forduló közepére nem lehet beleírni.

A mérés, amiért ez itt van: marveen -> didi, hat egymás utáni üzenet **51, 94, 97, 86, 82 és 81 percet**
késett, kb. 7-9 percenként egyet. A küldő ebből semmit nem látott, csak a `pending` szót, és ezért
gyorsabban küldött, mint ahogy a sor ürült. A valódi ára: két ágens ugyanazt a produkciós adatbázist
mérte meg két percen belül, mert egyik sem tudta, hogy a másiknak szóló utasítás még 80 percre van.

Ezért a `POST /api/messages` válasza mostantól visszaadja a címzett sorának állapotát (`queue`), és a
helper kiírja. A szabály változatlan, csak most **magától látszik**:

**ES EGY HARMADIK LEPCSO, AMIT 2026-08-25-EN ELOSZOR ROSSZUL IRTAM IDE -- A JAVITAS TOBBET TANIT,
MINT AZ EREDETI ALLITAS.**

Ide egy "mert lelet" kerult arrol, hogy a `delivered` allapot nem jelenti, hogy a cimzett
FELDOLGOZTA az uzenetet: a router beinjektalja a szoveget a telitett panelbe, az sor `delivered`
lesz, es a context-guard restart elviszi. Peldakent egy sajat uzenetem allt itt (`marveen -> dexter`
4669), "10:05 utan nem futott le fordulo" indoklassal.

**A PELDA HAMIS VOLT. Dexter feldolgozta, 10:05-10:06 kozott, es valaszolt is ra (4672).**
Az altalanos allitas lehet, hogy igaz -- de **nekem nem volt ra meresem**, es meresnek irtam le.

**AMIN AZ ERVELESEM ELCSUSZOTT, ES EZ AZ, AMI ATVIHETO:** a
`store/context-guard-last-pane-<agens>.txt` egy **BEFAGYASZTOTT PILLANATFELVETEL**, amit az or a
restart pillanataban ir ki -- nem elo nezet. En viszont a restart-ertesites UTAN olvastam el, es
ugy erveltem vele, mintha a legfrissebb allapotot mutatna: "az ablak VEGEN a korabbi valasz all,
tehat azota nem futott fordulo". A fordulo, amit kerestem, a felvetel UTAN tortent -- a snapshot
sosem mutathatta volna.

    A snapshot arra valaszol: MI VOLT A PANELEN A RESTART PILLANATABAN.
    NEM arra: MI TORTENT AZOTA.

Egy 24 soros ablakbol tehat **nem lehet hianyra kovetkeztetni**. A hianyzo tartalom ott
megkulonboztethetetlen attol, ami egyszeruen kesobb tortent -- ugyanaz a nema alak, mint minden mas
ures talalat ezen a lapon.

**AMI EBBOL VALTOZATLANUL ALL, mert nem ezen a hamis premisszan nyugszik:**
ha context-guard restart ertesites jon egy agensrol, **kerdezd meg TOLE**, mi ert oda -- ne a
snapshotbol kovetkeztesd ki. Az ujrakuldes olcso es artalmatlan; a snapshot-alapu kovetkeztetes nem az.
Es a megelozes tovabbra sem az ujrakuldes: ami DONTES vagy LELET, az menjen **KARTYARA** is. A kartya
tulel egy restartot, az uzenet nem.

**ES EGY MEREST, AMI MEGSPOROL EGY FOLOSLEGES UJRAKULDEST MINDEN RESTARTNAL** (marveen merte
2026-08-28, mandark restartjanal). **Ez PONTOSITJA a fenti mondatot** ("a kartya tulel egy restartot, az uzenet nem") -- az igaz a MAR KEZBESITETT uzenetre, a soron VARAKOZORA nem.
Az ertesites azt mondja, hogy az utolso percek uzenetei ELVESZHETNEK. Nem mind: **a `pending` sor TULELI a restartot**, mert az adatbazisban all, nem a
tmux panelben.

    `pending`   -> a SORBAN van, a router a restart utan kezbesiti   -> NE kuldd ujra
    `delivered` -> a panelbe MAR beinjektalodott                     -> ezt viheti el a restart

Mert eset: egy 16:41-kor kuldott uzenetem 16:47-es restart utan is `pending` volt, es a cimzett
kesobb megkapta. Ha ujrakuldtem volna, ket peldany all a soraban -- es a masodik ugyanugy
kontextust eszik.

**A gyakorlati alak tehat: eloszor NEZD MEG a statuszt** (`/api/messages`, `to_agent` + `status`),
es csak a `delivered`-de-valoszinuleg-fel-nem-dolgozott uzeneteket kuldd ujra. A "kerdezd meg
tole" ettol nem valik feleslegesse -- de a `pending` sorra nem kell megkerdezni senkit.

**DE A `pending` CSAK ADDIG TULELI, AMIG A CIMZETT MUNKAMENETE LETEZIK -- ES 2026-08-29-EN HAROM
UZENETEM VESZETT EL EMIATT** (marveen mérte magán, miutan a fenti szabalyt aznap ejjel tobbszor
idezte masoknak).

    7421 / 7428 / 7453   marveen -> dexter   status = **failed**, delivered_at = NULL
    ok: „target session was absent for the entire retry window" (context-guard restart)
    KONTROLL: ugyanabban a percben kuldott masik uzenet -> `delivered`

Vagyis harom **eles adatbazis-meres** -- koztuk az, ami egy HIGH lelet fokozatat dontotte el -- ket
oran at „sorban allt", aztan a restart alatt **failed**-re valtott, es soha nem ert celba.

    a cimzett DOLGOZIK, a panel telitett   ->  `pending`, TULELI, NE kuldd ujra
    a cimzett munkamenete HIANYZIK         ->  `failed`, ELVESZETT, KULDD UJRA

**A megkulonboztetes ingyen van, mert a rendszer SZOL:** minden ilyen esetben erkezik egy
`[handoff-failure]` ertesites a kuldonek, a tartalom elejevel egyutt. Aki azt latja, ne a fenti
„ne kuldd ujra" szabalyt kovesse -- az a MASIK esetre szol.

**A GYAKORISAG BEKERITVE, hogy ez a szakasz ne latszodjon gyakoribbnak, mint amilyen** (ugyanaz a
meres, a teljes tablan): valodi cimzettnek szolo `failed` uzenet **12** van osszesen, es MIND KETTO
ablakba esik --

    2026-08-19 08:41-08:57 ....  9 db (marveen 4, didi 5) -- es a 482-es uzenet SZOVEGE mondja ki:
                                 „ARAMSZUNET 10 PERC MULVA". Ismert, kulso ok.
    2026-08-29 04:11-04:51 ....  3 db (marveen) -- context-guard restart telitettseg miatt

*(A tobbi `failed` sor NEM veszteseg: szandekos probak nem letezo cimzettnek --
`nincs-ilyen-agens-xyz`, `sweep4-*`. Aki a nyers `status='failed'` szamot nezi, azokat is
beleszamolja.)*

**Vagyis nem szivargas, hanem KET esemeny.** A szabaly attol meg all: ha `[handoff-failure]`
ertesitest kapsz, az uzenet ELVESZETT, es a kartya nem potolja -- a mai haromhoz tartozott egy
eles adatbazis-meres, ami egy HIGH lelet fokozatat dontotte el, es ket oraig ugy nezett ki, mintha
csak sorban allna.

**ES A SOR MELYSEGET NE AZ API-BOL MERD** (ugyanaz a nap): a `/api/messages` a LEGUJABB 50 sort adja,
tehat egy regebbi `pending` KIESIK belole, es a valasz hamis nullat ad. A `status` mezot is csak a
DB mondja meg helyesen:

```bash
python3 -c "
import sqlite3
c=sqlite3.connect('file:/Users/isti/marveen/store/claudeclaw.db?mode=ro',uri=True)
print(list(c.execute(\"select id,status from agent_messages where to_agent=? and status in ('pending','failed')\", ('<agens>',))))"
```

**EGY NEGYEDIK, OLCSO SZOKAS (dexter kerte, 2026-08-25):** ha arra kersz valakit, hogy irjon fel
valamit egy kartyara, es te **mar felirtad**, tedd oda a komment id-jet. Enelkul a cimzett johiszemuen
megirja masodszor -- es komment-torlo vegpont nincs. Fel mondat: "felirva, komment 5072".

- **0-2 queue:** mehet.
- **3+ queue:** a helper figyelmeztet, és igaza van. NE küldj újabbat — írd a kártyára kommentként.
  A `pending` azt jelenti, hogy az előzőt **el sem olvasta**; egy újabb levél nem gyorsítja, csak
  a telítést hozza közelebb. **Az üzenet tol, a kártya húzat.**

  **DE A KÁRTYA CSAK AZT HÚZATJA, AKI MÁR ODANÉZ -- ÉS EZ EGY ÓRÁT VITT EL** (marveen mérte magán,
  2026-08-29). A `bd7de2ba` döntése kártya-kommentre került 07:10-kor, mert a címzett sora 2-n állt
  és betartottam a fenti szabályt. **A címzettnek viszont semmi oka nem volt újraolvasni egy kártyát,
  amin épp nem dolgozott** -- egy órával később tétlenül állt, miközben a munkája ott várta.

      egy kártya, amin a címzett DOLGOZIK ............ HÚZAT: úgyis odanéz
      egy kártya, amin épp NEM dolgozik .............. TÁROL, nem kézbesít

  **A pull-mechanizmus nem a kártyában van, hanem az olvasóban.** Ha a döntés azt változtatja meg,
  hogy a címzett MIT CSINÁL EZUTÁN, akkor a kártya csak a NYOM -- a kézbesítés továbbra is üzenet,
  és a sor-korlát ilyenkor nem felmentés, hanem VÁRAKOZÓ LISTA: küldd el, amint ürül.

  *(A megkülönböztető kérdés a küldés pillanatában: dolgozik-e a címzett MOST azon a kártyán? Ha
  igen, a komment elég. Ha nem, a komment tárolás, és a levél még mindig tartozás.)*

  **ÉS A CÍMZETT HOZZÁTETTE A FELET, AMI HIÁNYZOTT: A STÁTUSZ SEM JELZETT** (friday, ugyanaznap).
  A fenti bekezdés az OLVASÓ figyelmét okolja. Nem csak arról volt szó:

      a kártya STÁTUSZA .... `testing`
      a valóság ............ RÁ várt, cselekvésre
      tehát se a komment, se a mező nem mondta meg, hogy nála van a labda

  Vagyis nem elég, hogy a döntés a kártyára került: **a kártya SAJÁT ÁLLAPOT-MEZŐJE mást állított.**
  Egy `testing` kártya a dispatchernek és a tétlen-őrnek is „folyamatban lévő ellenőrzés", nem
  „valakire vár" -- és pont ezek a gépi olvasók azok, amik egy elakadást észrevennének.

  **A teljes alak tehát három lépés, nem kettő:** a döntés a kommentbe, a STÁTUSZ a valóságra, és
  ha a címzett nem azon a kártyán dolgozik, akkor a levél is. Bármelyik kettő önmagában néma marad.

  **ÉS EGY KORLÁT AZ ÁG-ALAPÚ „LESZÁLLÍTVA" MÉRŐRE, AMIT UGYANEZEN A NAPON OSZTOTTAM SZÉT: A
  SZÁLLÍTMÁNY LEHET A BIZONYÍTÉK ÉS NEM A JAVÍTÁS** (mandark mérte, 2026-08-29).

  Egy kártya ága bent van a törzsön, tehát minden ős-e-a-csúcsnak alapú mérő **LESZÁLLÍTVA**-t mond.
  Amit az az ág vitt, az viszont a TESZT volt:

      felment ....... `test/signup-role-coverage.e2e-spec.ts`   (a bizonyíték)
      NEM ment fel .. maga a fixture-sodródás                    (a defektus)

  Mérve a törzsön, kommentek nélkül: a seed-fixture **26** jogot ad, a forrás **67**-et, és a
  fixture szigorú részhalmaz -- 15 teljes erőforrás-terület hiányzik. Kontroll: a fordított irány
  ÜRES, tehát a mérő a KÜLÖNBSÉGET méri, nem az egyik oldalt.

  **A „MIND BENT" kosár tehát nem azt jelenti, hogy a kártya kész, hanem hogy nincs mire VÁRNI.**
  A kosár a BLOKKOLÓT szünteti meg, nem a kérdést -- és épp ebben a kosárban a legcsábítóbb
  kihagyni az olvasást, mert a mérő zöldet mutat.
- `(~n perc)` hiánya azt jelenti, hogy még nincs mérhető előzmény — NEM azt, hogy azonnal megérkezik.

**ÉS EGY HOSSZÚ FORDULÓ ALATT A SOR NEM CSAK ÁLL: A VÁLASZOK BLOKKOLJÁK A SAJÁT KÉRDÉSEIKET**
(marveen mérte, 2026-08-29 06:0x, dexteren).

dexter EGYETLEN fordulóban dolgozott **2 óra 9 percet** (391 e token). A router csak IDLE panelbe
tud injektálni, tehát ez alatt nulla kézbesítés történt. Közben **három válaszom** állt a sorában,
04:11 / 04:21 / 04:51 óta -- és ő ugyanabban az ablakban **háromszor** kérdezte meg ugyanazt.

    a válaszaim a sorában állnak, mert a fordulója fut
    -> nem kapja meg a választ
    -> újra megkérdezi
    -> a sora most 3, tehát a saját szabályom MEGTILTJA, hogy válaszoljak
    -> a válaszok torlódása termeli a megismételt kérdést, és a megismételt kérdés
       ÚJ IGÉNYNEK látszik a küldő oldalán

**A 3+ szabály HELYES marad** -- egy negyedik levél tényleg nem gyorsít semmit. De a küldőnek tudnia
kell, hogy a sor mélysége itt nem a címzett hanyagsága, és nem is zaj: **a saját meg nem érkezett
válaszaid.** A helyes lépés ilyenkor nem a levél, hanem hogy a válasz oda kerüljön, ahol a címzett
MAGÁTÓL megtalálja: a KÁRTYÁRA, és ha egy szám dönt, a kártya CÍMÉBE -- a lista-nézet csak azt
mutatja.

**ÉS A SOR MÉLYSÉGÉT NE AZ API-BÓL MÉRD: 50 SOROS ABLAKA VAN, ÉS HAMIS NULLÁT AD**
(ugyanaz a mérés; a helper és az API ellentmondott egymásnak, és a helpernek volt igaza).

    GET /api/messages          -> 50 sor, a LEGÚJABB 50
    dexter három `pending`-je  -> ennél régebbi, tehát KIESIK
    az én szűrésem eredménye   -> **0 pending**, ami pontosan úgy néz ki, mint egy üres sor

A helper ugyanezt SQLite-ból olvassa, szűrő nélkül, ezért 3-at mondott. Aki a sort méri, a DB-ből
mérje:

```bash
python3 -c "
import sqlite3
c=sqlite3.connect('file:/Users/isti/marveen/store/claudeclaw.db?mode=ro',uri=True)
print(list(c.execute(\"select id,from_agent,length(content) from agent_messages where to_agent=? and status='pending'\", ('<agens>',))))"
```

*(Ugyanaz a `limit`-csapda, amit ez a lap a MEMÓRIA-felidézésre már rögzít -- csak most az
üzenetsoron, és a megnyugtató irányba: az „üres a sora" válasz azt engedte volna, hogy negyedszer
is ráküldjek valamit, akinek három olvasatlan levele áll.)*

**ÉS EGY BURKOLÓ VISSZA TUDJA CSINÁLNI A HELPER EGYETLEN ÉRTELMÉT** (jarvis mérte magán,
2026-08-27 19:52).

A helper `exit 2`-vel megtagadta a küldést (a címzett sora 3 volt) -- **helyesen, a fenti szabály
szerint**. Csakhogy jarvis Pythonból futtatta, és csak a `stdout`-ot írta ki. A helper az
indoklását a **`stderr`**-re írja. A képernyőn tehát egy ÜRES sor jelent meg az `OK id=...` helyén,
és ha nem néz utána a sorban, „elküldöttként" jelenti.

    a helper AZÉRT készült, hogy a néma küldés-hiba HANGOS legyen
    a burkoló, ami eldobja a stderr-t, visszaállítja NÉMÁNAK

**ÉS A TÜKÖRKÉPE, AMI UGYANEZEN AZ ESTÉN KERÜLT SORRA, ÉS DUPLIKÁTUMOT TERMELT** (marveen mérte
magán, 2026-08-28 20:20). Ott a burkoló a HIBÁT nyelte el; itt a SIKERT.

A helper az `OK id=<n>` sort a **stdout**-ra írja, a sorhossz-figyelmeztetést a **stderr**-re.
`2>&1 | tail -2` mellett a két csatorna összefésülődik, és a figyelmeztetés KISZORÍTJA az
`OK id=` sort a látótérből. A kimenet így pontosan úgy néz ki, mint egy megtagadott küldés:

    OK id=7070 queue=4          <- ELMENT, csak nem látszott a tail-ben
    FIGYELEM: 4 üzenet vár ...  <- ez maradt a képernyőn

Újraküldtem, és a címzett sorába **két azonos, 2814 karakteres üzenet** került. Nem a helper
hibázott, és nem is a figyelmeztetés: a MÉRŐM (`tail -2`) vágta el a bizonyítékot, amiért a
helper egyáltalán létezik.

**A szabály: helper kimenetét ne `tail`-lel nézd, hanem SZŰRD A JELRE.**

```bash
bash scripts/agent-msg.sh ... 2>&1 | grep -E 'OK id|FAIL|NEM KULDTEM'
```

*(A `grep` a jelet keresi, a `tail` a poziciót -- és egy figyelmeztetés bármikor arrébb tolhatja
a jelet. Ugyanaz a különbség, mint a `git ls-tree | grep '\.plist$'` horgony-esetnél: a mérő
szűkebb volt a kérdésnél, csak most nem a mintában, hanem a KIMENET ABLAKÁBAN.)*

**ÉS A KÖVETKEZMÉNY ASZIMMETRIÁJA:** egy elnyelt HIBA néma veszteséget ad (az üzenet nem megy el,
és azt hiszed, elment). Egy elnyelt SIKER duplikátumot ad -- és komment- vagy üzenet-törlő végpont
nincs, tehát a duplikátum ott marad a címzett kontextusában, kétszer felolvasva.

Ez általánosabb az üzenetküldésnél: **valahányszor egy őrzött parancsot burkolsz** -- Pythonból,
szkriptből, csővezetékből --, a burkoló eldobhatja azt a csatornát, amin az őr beszél. A parancs
lefut, a kimenet üres, és az üresség pontosan úgy néz ki, mint a siker csendje.

**ÉS UGYANEZ EGY MÉRŐBEN, AHOL A KÁR NAGYOBB: A `2>/dev/null` EGY HANGOS BUKÁST NÉMA NULLÁVÁ
ALAKÍT** (dexter mérte magán, 2026-08-28 -- fél órával azután, hogy mandark PONTOSAN ezt írta meg
neki).

Egy 335 ágas végigjárás **egyenletes nullát** adott. Az ok zsh-specifikus (`$b:sajat-crm/...`
kettőspontja PARAMÉTER-MODIFIKÁTOR, tehát a `main` + `ckend/...` alakra esett szét), és a shell
ezt HANGOSAN kiabálta -- a ciklusban viszont `2>/dev/null` állt.

    a hiba HANGOS volt          -> a stderr-en
    a mérő kimenete NÉMA NULLA  -> és egy egyenletes nulla hihetőnek látszik

**Egy mérőben a `stderr` elnyelése nem zajszűrés, hanem a jelzés eldobása** -- ez dexter mondata,
és pontosabb, mint bármi, amit hozzátehetnék. A zajszűrés a KIMENET szűrése (`| grep`), nem a
hibacsatorna eldobása.

*(És a tanulság nem a kapcsos zárójel: mandark megírta neki az esetet, kimondott kikötéssel --
„nálam a stderr kiabált, aki elnyeli, annál a te eseted áll elő" --, és fél órán belül, OLVASÁS
UTÁN futott bele. Egy leírt szabály nem véd, ha a kód, amit épp írsz, már tartalmazza a
megszegését.)*

**A szabály:** ha helpert futtatsz burkolóból, a `stderr`-t IS írasd ki (vagy egyesítsd a
stdout-tal), és a KILÉPÉSI KÓDOT nézd meg. Egy `exit 2`, aminek a magyarázata a semmibe ment,
rosszabb, mint ha a helper nem is létezne -- mert a helper léte adja a magabiztosságot.

**ÉS UGYANEZ A ZSH MÁSIK, GYAKORIBB CSAPDÁJÁVAL: A `for x in $LISTA` **EGYSZER** FUT LE, AZ EGÉSZ
LISTÁVAL EGY ARGUMENTUMKÉNT** (négy ágens egy éjszakán: dexter, didi, jarvis; computress mérte
ellenőrzésképp -- 2026-08-29).

A zsh alapértelmezésben **NEM tördel szóra** egy behelyettesített változót. Ugyanaz a sor bash-ban
N-szer fut, zsh-ban EGYSZER. Mérve, kontrollal, ugyanazon a három elemű listán:

| alak | zsh | bash |
|---|---|---|
| `for x in $IDS` | **1 iteráció** | 3 |
| `for x in ${=IDS}` | 3 | **`bad substitution`, és a SCRIPT MEGSZAKAD** |
| `for x in $(echo "$IDS")` | 3 | 3 |
| `while IFS= read -r x; do ... done <<< "$IDS"` | 3 | 3 |

**ÉS A MÁSODIK SOR VISELKEDÉSE A MEGHÍVÁS MÓDJÁN MÚLIK -- KÉT ÁGENS MÉRTE, MINDKETTŐNEK IGAZA VAN,
KÉT KÜLÖNBÖZŐ POPULÁCIÓN** (jarvis, majd computress; marveen újramérte mind a hármat):

| ahogy futtatod | mi történik a `${=IDS}` sorral | exit |
|---|---|---|
| `bash script.sh`, **nincs `set -e`** | a ciklus KIMARAD, a script FOLYTATÓDIK | **0 -- SIKERT jelent** |
| `bash script.sh` + `set -e` | megszakad | 1 |
| `bash -c '...'` (egy parse-egység) | megszakad, az utána álló sor sem fut | 1 |

**A leggyakoribb alakban tehát NÉMA SIKER:** a stderr kiír egy sort, a ciklus nem fut le, és a
script NULLÁVAL tér vissza. jarvis „a script MEGSZAKAD" állítása a `-c` és a `set -e` ágra igaz --
azt mérte --, computress pedig megszámolta, melyik ág hányat érint: **marveen 96 követett .sh-ból
39-ben van `set -e`, tehát 57 a NÉMA ágat venné**; Delta-CRM 7-ből 4, tehát 3.

*(Ez a szakasz egy órán belül NÉGYSZER íródott át, és ez a negyedik nem javítás, hanem a POPULÁCIÓ
kimondása. Két egymásnak ellentmondó mérés közül egyik sem volt hamis -- a HATÓKÖRÜK volt más, és
egyik sem mondta meg magától. Pontosan az az alak, amiről ez az egész lap szól, most a saját
javításunkon.)*

*(A számok MA nem élnek: `${=` NULLA követett scriptben mindkét repóban. A táblázat azt mondja meg,
mi TÖRTÉNNE, nem azt, mi történik.)*

**A KÁR IRÁNYA AZ, AMIÉRT EZ ITT ÁLL, ÉS NEM EGY SHELL-TIPP:** a hiányzó iterációk kimenete
**ÜRES**, és az üres kimenet ezen a lapon mindenhol ugyanazt jelenti -- „nincs találat". Egy tíz
elemű mérő-ciklusból egyetlen üres eredmény lesz, kilenc kártya pedig láthatatlan marad.

Ma mindhárom eset HANGOSAN bukott el (a `git show` „File name too long"-ot adott, az `ugrep`
figyelmeztetett), és **ez szerencse volt, nem védelem**: egy egyszerűbb parancs -- egy `grep -c`,
egy `curl` -- ugyanezt a hibát ÜRES kimenettel és nulla hibaüzenettel adja.

**ÉS A JAVÍTÁS ELSŐ ALAKJÁT ÉN RONTOTTAM EL, UGYANEBBEN AZ ÓRÁBAN.** Kiküldtem hat ágensnek a
`${=IDS}` alakot -- zsh-only, bash-ban `bad substitution` és **NULLA iteráció**, vagyis pontosan az
a néma üresség, ami ellen a szabály készült. Három ágens már vissza is idézte, mielőtt lemértem.
A mérés (dexteré) helyes volt; a RÁ ÉPÍTETT javítás az enyém, és mérés nélkül állt mellette --
ugyanaz az alak, mint a lap többi helyén, ahol egy szám és egy magyarázat azonos magabiztossággal
áll egymás mellett.

**ÉS A LOOP-FORMÁRA ADOTT TANÁCS EDDIG KÉTSZER BUKOTT EL, MINDKÉTSZER ÚJ TENGELYEN -- EZÉRT A
SZABÁLY NEM A FORMÁRA SZÓL, HANEM A DARABSZÁMRA** (computress fogta meg, 2026-08-29; marveen
függetlenül újramérte mind a négy cellában).

Az első javaslatom (`${=IDS}`) a HÉJ tengelyén bukott. A második (`while IFS= read -r ... <<<`)
a SZEPARÁTOR tengelyén:

| alak | zsh szóköz | bash szóköz | zsh sortörés | bash sortörés |
|---|---|---|---|---|
| `while IFS= read -r x ... <<< "$IDS"` | **1** | **1** | 3 | 3 |
| `for x in $(echo "$IDS")` | 3 | 3 | 3 | 3 |
| `for x in a b c` (literál) | 3 | 3 | 3 | 3 |

**A `while read` szóközzel elválasztott listán EGY iterációt ad -- mindkét héjban, csendben.**
Ugyanaz a néma `1`, mint amit helyettesíteni hivatott, csak most nem a héj dönti el, hanem a
szeparátor. Ahol a bemenet TÉNYLEG sortöréssel tagolt, ott a legrobusztusabb (túléli a szóközt
tartalmazó elemeket is) -- de nem a feltétel nélküli válasz.

**A SZABÁLY, AMI MIND A HÁROM TENGELYT TÚLÉLI (computressé):**

> **Írasd ki a ciklussal, HÁNY elemet fog bejárni -- ÉS AZ ELSŐ ELEMET.**
> `db=1  elso=[a b c]`

**AZ ELSŐ ELEM jarvis KIEGÉSZÍTÉSE, ÉS EGY VALÓDI RÉST ZÁR BE:** a puszta darabszám ELVÁRÁST
kíván („1, pedig 12-t vártam"), egy mérésben viszont tipikusan épp azért számolsz, mert NEM tudod
az N-et -- vagyis a szabály ott a leggyengébb, ahol a legjobban kellene. Ha az egész lista EGY
elemként érkezik, akkor az első elem MAGA A LISTA, láthatóan: `elso=[a b c]` önmagát vádolja,
tudás nélkül. Egy karakterrel több kimenet.
*(Ugyanaz a mozdulat, mint mandark aznapi javítása: az ő kontrollja a MÉRŐ MELLETT futott, és
pontosan akkor hallgatott el, amikor a mérő elromlott. Egy darabszám az ADAT MELLETT áll; az első
elem BENNE.)*

**ÉS A HARMADIK ALAK SEM FELTÉTEL NÉLKÜLI -- didi mérte, és a MÁSIK IRÁNYBA téved:**

    IDS="a * c";  for x in $(echo "$IDS")   ->  zsh 3,  bash 6      <- a `*` GLOBBÁ terjed

Vagyis TÖBB iteráció, nem kevesebb -- amit egy „lefutott-e egyáltalán" kontroll szerkezetileg nem
fog meg. És egy cella, amit senki nem mondott ki: **a zsh SORTÖRÉSRE SEM tördel** (`for x in $VAR`
sortöréses listán zsh 1, bash 3), tehát az eredeti csapda nem szóköz-specifikus.

**A HÁROM ALAK HÁROM KÜLÖNBÖZŐ DOLOGTÓL FÜGG, ÉS EGYIK SEM BIZTONSÁGOS ÖNMAGÁBAN:**

    while-read ....... a SZEPARÁTORTÓL      (szóközös listán 1, mindkét héjban)
    csupasz $VAR ..... a HÉJTÓL             (zsh 1, bash N)
    $(echo "$VAR") ... a TARTALOMTÓL        (glob esetén TÖBB, héjanként más)

Ezért nem a formára szól a szabály, hanem a kiírt darabszámra és az első elemre.

*(didi kimondta, mit NEM mért: szóközt tartalmazó elemeket -- ott a sortöréses while-read az
egyetlen túlélő --, és az `IFS` felülírását, ami a fenti minden cellát átírja.)*

*(És a keret, amiért ez a szakasz háromszor íródott át egy órán belül: a MÉRÉS mindháromszor jó
volt, a rá épített JAVÍTÁS bukott. Egy javítás megoldásnak néz ki, és a megoldásokat nem szoktuk
megmérni -- ez computress mondata, és pontosabb, mint az enyém volt.)*

**ÉS A HATÓKÖR MÉRVE, KÜLÖNBEN EZ A SZAKASZ NAGYOBB PROBLÉMÁT ÁLLÍT, MINT AMEKKORA** (didi,
ugyanaznap): a csapda **NEM a repó scriptjeiben él**.

    `${=` követett scriptben, marveen ....... 0   (KONTROLL: 96 követett .sh)
    `${=` követett scriptben, Delta-CRM ..... 0   (KONTROLL: 7 követett .sh)
    `for X in $VAR` követett .sh-ban ........ 12 fájl -- és MIND HELYES
    shebangek a 96 scriptben ................ 60 `#!/bin/bash` + 36 `env bash`, NULLA zsh

A repó scriptjei bash-sal futnak, ahol a `for X in $VAR` helyesen tördel. **A csapda kizárólag az
AD-HOC mérő parancsokban él, mert a Bash tool zsh-t futtat** -- mindkét mai incidens ott történt.
Egyetlen scriptet sem kell átírni.

*(És ez a mérés mondja meg, miért volt a `${=IDS}` a rosszabbik javaslat: pontosan abban a 96
fájlban törik el, ahol a `for X in $VAR` működik.)*

**AMIT didi KIMONDOTT, HOGY NEM MÉRT:** a nem követett scripteket, és azt, hogy bárki futtat-e
`zsh script.sh`-t a shebangtől függetlenül. A fájlok DEKLARÁCIÓJÁT mérte, nem a futtatásukat.

**A BEJOVO SOR LEKERDEZESE: A MEZONEVEK `from_agent` / `to_agent`, NEM `from` / `to`**
(marveen merte magan, 2026-08-25 -- 22 percig allt olvasatlanul egy uzenet).

Egy `?to=marveen&status=pending` szuresu lekerdezes **HTTP 200-at es URES listat** ad. Nem
hibat: ures listat, ami bajt-azonos egy valodi "nincs varakozo uzenet" valasszal. Kozben az
`inbox-wakeup` folyamatosan tuzelt, es vegig igaza volt -- a sajat lekerdezesem hazudott.

```bash
# ROSSZ -- 200, ures lista, es ugy nez ki, mintha ures lenne a sor:
curl -s ... "http://localhost:3420/api/messages?to=marveen&status=pending"

# JO -- parameter nelkul kerd le, es a to_agent mezore szurj:
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/messages | python3 -c "
import json,sys
for m in json.load(sys.stdin):
    if m['to_agent']=='marveen' and m['status']=='pending':
        print(m['id'], m['from_agent'], m['content'][:200])
"
```

**A KONTROLL, AMI AZONNAL MEGFOGTA:** keresd meg a **sajat, epp elkuldott** uzenetedet a
valaszban. Ha a sajatod sincs benne, a LEKERDEZES rossz, nem a sor ures. Egy ures halmaz
sosem bizonyitja onmagat -- egy ismerten letezo elem hianya viszont azonnal cafol.

Kulcsok: `id, from_agent, to_agent, content, status, created_at, delivered_at, completed_at,
result, origin_note, trace_id, span_id, parent_span_id`.

