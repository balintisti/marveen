# KARTYA KONTRA UZENET, ES A TABLA MEZOI -- ESET-ARCHIVUM

Ez a `CLAUDE.md` `### Ami egy het mulva is szamit, az kartyara megy` szakaszanak KISZERVEZETT
bizonyitek-anyaga (kartya `c5fcc2b5`). A lapon a SZABALYOK es a RECEPTEK allnak; itt a MERT
ESETEK -- koztuk egy VISSZAVONT meres, ami a lap egyik legdragabb tanulsagat hordozza.

**A tartalom BETURE az eredeti szakasz, valtoztatas nelkul.**

---

### Ami egy hét múlva is számít, az kártyára megy (Isti kérdésére, 2026-08-18)

Az inter-agent üzenet NEM nyilvántartás. Egy nap alatt háromszor bukott meg: négy üzenetem
állt `pending`-ben, miközben a címzett azt hitte, döntésre vár; egyszer elavult állapotra
válaszolt, mert a válaszom későn ért oda; és egy téves context-guard jelzés miatt én adtam
neki hibás képet arról, hol tart. **Egy üzenet elveszik. Egy kártya marad.**

A szabály, és a határa is:

- **Feladat** → kártya. (Ez eddig is így volt.)
- **Döntés**, ami a feladatot érinti → a kártyára is, kommentként, az indoklással együtt.
  Akkor is, ha üzenetben már elmondtad. Az üzenet a beszélgetés, a komment a nyom.
- **Lelet** → kártya, a bizonyítékkal (fájl:sor, forgatókönyv), nem csak a beszélgetésben.
- **Koordináció** (sorrend, „most ezt csináld", visszajelzés, biztatás) → marad üzenet.
  Ha ez is kártya lenne, a tábla egy hét alatt olvashatatlan zaj lenne, és pont az veszne
  el benne, ami számít.

Az önellenőrző kérdés: *ha holnap elveszne a beszélgetés, ez a tudás megmaradna?* Ha nem,
akkor kártya vagy komment.

**AZ `updated_at` AZT MÉRI, HOGY A KÁRTYA MOZDULT-E -- NEM AZT, HOGY A LELET NYITOTT-E**
(jarvis mérte, majd HÁROM ÓRÁN BELÜL VISSZAVONTA, 2026-08-28. A visszavonás a lelet, nem a mérés.)

Ide reggel egy szabály került, jarvis számára építve: egy cenzus hat leletéből kettő magától
megoldódott, négy 22 órája nem mozdult -- és a négy mind egy lezáró komment végén állt, saját
kártya nélkül. Ebből az következett volna, hogy a lelet sorsát a HORDOZÓJA dönti el.

**A szám hibás volt, és a hibája a mérőben ült.** `updated_at`-tel mérte, ami arra válaszol, hogy
a KÁRTYA MOZDULT-E. A kérdés az volt, hogy a LELET NYITOTT-E MÉG. Az utolsó kommenteket
elolvasva mind a négy le volt zárva: egynek már volt hordozó-kártyája, egyet megmértek és
cáfoltak, egyről kimondott döntés született, hogy NEM kap kártyát, egy pedig a merge-kötegre vár
az akadály nevesítésével.

    egy nem mozduló kártya  ->  lehet ELAKADT, és lehet KÉSZ
    és az `updated_at` a kettőt BÁJT-AZONOSAN mutatja

**ÉS 2026-09-03 ÓTA VAN RÁ VÁLASZ, CSAK EDDIG NEM ÁLLT ITT: `GET /api/kanban/<id>/events`**
(mandark mérte ki használat közben). Az átmeneteket adja vissza -- `to_status` + időbélyeg +
`actor` --, tehát arra válaszol, hogy a kártya MIKOR LÉPETT BE egy oszlopba, nem arra, hogy mikor
mozdult rajta bármi.

    `updated_at` ................. „mozdult-e a kártya"  (egy KOMMENT is mozdítja)
    `/api/kanban/<id>/events` .... „mikor LÉPETT BE az oszlopba", actorral együtt

**A mért ár, amiért ez nem stílus:** mandark egy 20:57-es időhatárra válogatott `updated_at`-tel. A
proxy TÚL-válogatott egy LEFEDETT kártyára (a `c7041687` 21:05-ös `updated_at`-je egy komment volt;
ténylegesen 20:19-kor lépett `testing`-be, az ablakon BELÜL) -- és közben KIHAGYOTT hármat, ami
tényleg később érkezett. Ráadásul a 17 „mozdult" kártya nagy része azért mozdult, mert ő maga
kommentelt rájuk: **a mérő a saját tevékenységét mérte.**

*(Ugyanaz az alak, mint a fenti visszavonás, csak most van hozzá eszköz. A szakasz többi része
változatlanul áll: a PROXY észrevétlenül átveszi a VALÓDI kérdés helyét -- a különbség az, hogy erre
a kérdésre ma már nem kell proxy.)*

**A HORDOZÓ-MECHANIZMUS EZZEL NEM DŐLT MEG, DE MÉRETLEN.** Hihető, hogy egy kártya alján álló
mondat nem tud sorra kerülni, mert a dispatcher KÁRTYÁKAT oszt, nem bekezdéseket -- de erre ma
NINCS mérésünk, és a fenti szám nem támasztja alá. Aki használni akarja, mérje meg olyan
eseteken, amik tényleg ezt mutatják.

**AMIÉRT EZ A BEKEZDÉS ITT MARAD, ÁTÍRVA ÉS NEM TÖRÖLVE:** a szerző a saját, MÁR ELFOGADOTT
mérését vonta vissza, három órán belül, azután hogy szabály lett belőle -- a saját szavaival:
*inkább most mondom, mint hogy holnap a nevemmel idézzék.* A törlés eltüntetné a legdrágább
felét: hogy egy PROXY-metrika (mozdult-e) észrevétlenül átveszi a VALÓDI kérdés (nyitott-e)
helyét, és a különbség csak akkor derül ki, ha valaki elolvassa az egyes eseteket.

*(Ugyanaz a törvény, mint a lap többi helyén: a mérő hatóköre szűkebb -- itt MÁS -- volt, mint a
kérdés. És a koordinátor, aki a szabályt beírta, ugyanúgy nem vette észre: a szám hihető volt, a
mechanizmus tetszetős, és egyik sem elég.)*

**ÉS EGY HARMADIK HELY, AMIT A KOMMENT NEM PÓTOL: A STÁTUSZ** (jarvis mérte a saját tábláján,
2026-08-27 19:41).

Egy kártyáról az a döntés született -- üzenetben --, hogy MARAD ZÁRVA. A komment felkerült rá.
A kártya viszont `planned`-en állt, tehát **a tábláról továbbra is felvehető, nyitott munkának
látszott** -- és a tétlen-őr bármikor kioszthatta volna. Valaki egy MÁR ELDÖNTÖTT kérdésen kezdett
volna dolgozni, és a döntés ott lett volna a kártyán, két kattintással lejjebb.

    a KOMMENT azt őrzi meg, hogy MIT döntöttünk
    a STÁTUSZ azt mondja meg, hogy VAN-E MÉG ITT MUNKA
    és a dispatcher meg a tétlen-őr a MÁSODIKAT olvassa

**A szabály:** ha egy döntés azt változtatja meg, hogy egy kártyát fel kell-e venni, akkor a
STÁTUSZT is át kell írni -- a komment nem pótolja. Egy komment, amit senki nem olvas el a
felvétel előtt, pontosan annyit ér, mint egy nem létező.

*(jarvis megfogalmazása, és ez a tágabb: „az állapot és az állítás KÜLÖN úton avul. A döntés
üzenetben született, a kártya státusza nem tud magától róla." Ugyanaz a rés, mint a kártya-cím
és a kártya-tartalom között, csak most a tábla GÉPI olvasói felé.)*

**ÉS EGY HARMADIK CÍMZETT, AMI ROSSZABB MINDKETTŐNÉL: A DÖNTÉS EGY MÁSIK DOKUMENTUMBA KERÜLT**
(mandark fogta meg marveenen, 2026-08-29 -- ugyanazon az éjszakán kétszer).

    `c099f018`  a döntés a SZABÁLYKÖNYVBE került („nem javítjuk, a védelem a push-szokás"),
                a kártyához soha -- két napig állt `waiting`-ben a mérője nevén
    `dd6ba79c`  a komment azt mondta, vár; a státusz azt, hogy `planned`

**A második a már ismert rés. Az első új, és alattomosabb:** a döntés nem elveszett, hanem
LESZÁLLÍTÓDOTT -- csak abba az artefaktumba, amit egy MÁSIK olvasó néz. A szabálykönyvet a
következő munkamenet olvassa; a kártyát az, aki most vár rá.

    a KOMMENT ..... azt őrzi meg, MIT döntöttünk
    a STÁTUSZ ..... azt mondja meg, VAN-E MÉG ITT MUNKA
    a SZABÁLYKÖNYV  azt mondja meg, MIT CSINÁLJUNK LEGKÖZELEBB
    és a döntés MINDHÁRMAT igényelheti -- de a VÁRAKOZÓT csak az első kettő szabadítja fel

**A gyakorlati szabály: ha egy döntés a lapra kerül, a KÁRTYÁRA is oda kell kerülnie, akkor is, ha
a lapon részletesebben áll.** Egy hivatkozás elég. A lap nem értesít senkit.

**ÉS A VÉGREHAJTHATÓ ALAK, MERT A FENTI SZABÁLY MEGMONDJA A BAJT, DE NEM AZT, MIKOR MOZGASS**
(computress mérte magán, 2026-08-28 -- két kártyája állt KÉSZ munkával `planned`-en, és a
dispatcher aznap KÉTSZER küldte vissza már elvégzett munkára). A saját megfogalmazása a horgony:

> **a kártya-mozgatás a COMMIT lépéséhez tartozik, nem a jelentéshez.**

Ez azért működik, ahol a szándék nem: a jelentés a kör VÉGÉN van, amikor a munka a fejedben már
lezárult, és pont ott a legkönnyebb kihagyni egy lépést. A commit viszont egy MECHANIKUS pont,
amit úgysem hagysz ki -- ha a státusz oda van kötve, együtt mozdul.

**ÉS EGY MÉRŐ, AMI EBBŐL NÉGY HAMIS LEZÁRÁST TERMELT VOLNA** (ugyanaz a kör, és ő MEGÁLLT vele).
A kézenfekvő sweep: *melyik `planned` kártyámra van commit, ami NEVEZI?* 14-ből 4 találat.
Elolvasva mind a négyet: **NULLA volt kész.** A commitok a kártyát KONTEXTUSKÉNT vagy
RÉSZESETKÉNT említik -- egy másik felület javítása, egy nem is rokon modul, egy felmérés-kártya
két konkrét esete, és egy teszt, ami a kétértelműséget RÖGZÍTI ahelyett, hogy megszüntetné.

Ugyanaz a NÉV-EGYEZÉS vs. HASZNÁLAT-EGYEZÉS hiba, mint a `useOptimisticMutation` kommentnél és a
`seedRolesForOrganization` három azonos nevénél -- csak most a COMMIT-ÜZENETEKEN. **Egy kártya-id
egy commit-üzenetben nem azt jelenti, hogy a commit elvégezte a kártyát.** A státusz-mozgatás
ezért soha nem sweepelhető: kártyánként el kell olvasni, mi történt.


A kanban adatai a `store/claudeclaw.db` SQLite fájlban vannak, de **NE a `sqlite3`
parancssori eszközzel nyúlj hozzá, és `jq`-t se feltételezz**: egyik sincs telepítve egy
átlagos Linux gépen (a telepítő függőségei: ffmpeg, git, tmux, lsof, curl, python3, pipx,
unzip), és ott a hívás `exit 127`-tel elhal. A tábla útja a dashboard API -- ugyanaz a
Bearer token, mint a memóriánál. Szűréshez/számoláshoz `python3` van mindig kéznél.

Kártyák listázása (JSON tömb: id, title, status, assignee, priority, updated_at, archived_at):
```bash
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/kanban
```

Új kártya:
```bash
curl -s -X POST http://localhost:3420/api/kanban \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"title":"CÍM","status":"planned","assignee":"marveen","priority":"normal","project":"marveen","actor":"marveen"}'
```

**AZ `actor` MEZŐ UGYANAZON AZ ÚTON HIÁNYZIK, MINT ANNAK IDEJÉN A `project`** (friday mérte
2026-09-03, kártya `8c03ef29`). A tábla mostantól KELETKEZÉSI eseményt is ír (NULL `from_status`
jelöli; a 2655 meglévő sorból nullának van ilyen, tehát egy régi mozgatás nem olvasható
létrehozásnak) -- de a MEZŐ csak akkor telik meg, ha a hívó elküldi. **És a mérés pillanatában
EGYETLEN dokumentált példa sem küldte, sem itt, sem az ágens-lapokon.** Ezért került bele fent.

*(Amíg friday ága be nem olvad, a futó API az `actor`-t létrehozáskor figyelmen kívül hagyja --
nem hibázik: a kezelők konkrét mezőket destrukturálnak a törzsből, nincs whitelist. Vagyis a
példa MA ártalmatlan, a beolvadás pillanatában pedig azonnal hat. Ez a `scripts/`-sáv fordítottja:
a dokumentáció megy előre, a kód utána.)*

**Az esemény AKKOR IS íródik, ha nincs `actor`** -- és ez szándékos: egy null aktorú esemény azt
mondja, hogy „létrehozva, a létrehozó nem jelentette", míg a NULLA esemény azt, hogy „az egész
mechanizmus előtt keletkezett". Két különböző tény, és egy számláló, ami összemosná őket, épp ezt
a kártyát ismételné meg.

**A `project` mezőt MINDEN új kártyánál küldd el** (`marveen` vagy `delta-crm`). Enélkül később
nem lehet megmondani, MELYIK repóról szól a kártya, és a hiány NÉMA: a létrehozás sikerül.
Mérve 2026-08-23-án: 794 kártyából 445-nek üres volt ez a mezője (56%), és a legnagyobb forrás
maga EZ A PÉLDA volt, amiből a mező hiányzott. Egy szabály, amit a példa nem mutat, nem szabály.

**ÉS A HIÁNY MA IS 27%, ÉS PONT A LEGDRÁGÁBB KÁRTYÁN HIÁNYZOTT** (didi mérte 2026-08-29, miután
dexter KÉTSZER mért egy kártyát a rossz repóban):

    delta-crm 740  |  marveen 230  |  **ÜRES 351**   =  351/1321 = **27%**

A szabály, amit ebből kimondtunk -- *„a kártya `project` mezőjét olvasd el, MIELŐTT fát választasz"*
-- helyes, és **a tábla negyedére NÉMA**. A némasága pedig pont azt hagyja a következő olvasóra,
amibe dexter belefutott: egy fát tippel, és nincs mihez ellenőriznie. Egy rossz repóban mért nulla
tökéletesen hihető, és soha nem hibaüzenet.

**A mért eset a legrosszabb helyen volt: az `e5f46eb1`** -- az `urgent` kártya, az élő
adatvesztéssel --, épp azon hiányzott a mező.

**A SZABÁLY TELJES ALAKJA (didi kiegészítése), és egy API-hívásba kerül:**

> Olvasd el a `project` mezőt, mielőtt fát választasz. **HA ÜRES, a TARTALOM dönti el -- és akkor
> ÁLLÍTSD IS BE.** A meghatározás munkáját úgyis elvégezted; a következő ember ne végezze el újra.

Ez egy egyszeri következtetést TÉNNYÉ tesz a kártyán. **Amit viszont NEM jelent: söprést.** didi a
351-ből egyet állított be -- azt, amelyiken dolgozott --, és kimondta, hogy a többit nem söpri.
A tartalom-alapú besorolás kártyánként olvasást kíván; egy minta-alapú tömeges kitöltés pontosan
azt a hibát termelné, ami ellen a mező van.

Kártya mozgatása:
```bash
curl -s -X POST http://localhost:3420/api/kanban/KARTYA_ID/move \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  -d '{"status":"in_progress","actor":"marveen"}'
```

**Az `actor` mezőt MINDEN mozgatásnál küldd el** (a saját ágens-azonosítód). Ez mondja
meg a táblának, hogy TE mozgattad a kártyát. Nélküle a saját kártyád felvétele
megkülönböztethetetlen egy kiosztástól, és a dispatcher visszadobja neked feladatként
azt a munkát, amit épp elkezdtél (`[Kanban feladat #ID]` üzenet magadtól magadnak).

**A KOMMENT-VÉGPONT MA MÁR ELLENŐRZI A KÁRTYA LÉTEZÉSÉT -- de a tanulság megmarad.**
2026-08-22-ig a `POST /api/kanban/<id>/comments` BÁRMILYEN azonosítót elfogadott: egy elgépelt id
**200-at adott és valódi `id`-t**, a komment eltárolódott, a táblán soha nem jelent meg, és törölni
sem lehetett (komment-törlő végpont ma sincs). Két teljes munkajelentés veszett el így egyetlen
napon. Javítva (commit `cee465c`): a nem létező kártya mostantól `404`.

**AMIÉRT EZ ITT MARAD, PEDIG JAVÍTVA VAN -- a mérés, ami a hibát megfogta, MÁS RENDSZEREKNÉL IS KELL:**
a POST válasza **visszhangozza a beküldött `card_id`-t**. Aki a válaszból írta ki, hogy
`card=<id>`, megnyugtató visszaigazolást kapott, ami **semmit nem bizonyított** -- a szerver azt
adta vissza, amit ő küldött. A repó szabálya (nézd a HTTP-kódot ÉS az `id`-t) sem védett: mindkettő
valódi volt.

> **A 200 nem azt jelenti, hogy megtörtént; a VISSZAOLVASÁS igen.** (didi, 2026-08-22)

Egy fontos írás után -- és minden olyan végpontnál, ahol a válasz a te bemenetedet tükrözi vissza --
olvasd vissza MÁSIK hívással, hogy tényleg ott van-e:

```bash
# a komment-id-t a POST valasza adja; a VISSZAOLVASAS a bizonyitek
curl -s -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/kanban/KARTYA_ID/comments | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"
```

*(Flotta-szintű ellenőrzés 2026-08-22 16:15: 2263 komment, ebből 5 árva -- kettő szándékos próba
volt, három Dexteré a hiba idejéből, és ő már újraküldte. Didi, mandark, jarvis: nulla.)*

Komment a kártyára -- **a helperrel, mert az teszi ki az IDŐBÉLYEGET is:**
```bash
# a sorrend: AGENS, KÁRTYA, FÁJL -- és FÁJLBÓL, nem STDIN-ről (lásd alább, mérve)
f=$(mktemp)          # NE fix nevet: a /tmp KOZOS, lasd a munkafajl-szakaszt
cat > "$f" <<'EOF'
__STAMP__ -- a helper a valódi mért időt írja a helyére.
AZ EREDMÉNY RÖVIDEN
EOF
bash scripts/card-comment.sh marveen KARTYA_ID "$f"
```

**A DOKUMENTÁLT `-` (STDIN) ALAK SZERKEZETILEG NEM MŰKÖDIK** (computress mérte 2026-08-28 07:09-kor,
marveen A/B-vel újramérte 07:11-kor). A script `python3 - "$AGENT" ... <<'PY'` alakban hív, tehát
**a python a PROGRAMOT olvassa a stdin-ről** (a heredocból), és a `sys.stdin.read()` üresre fut:

    (a) fájl-alak  -> `OK kartya=... komment=...`
    (b) `-` alak, UGYANAZ a tartalom -> `NEM KULDTEM: HTTP 400 {"error":"Szerző és tartalom kötelező"}`

Minimális repró, ami a mechanizmust mutatja:
`printf 'kilenc bajt' | python3 - <<'PY'` -> a python a becsövezett szöveget a program ELSŐ
sorának veszi: `kilenc bajtimport sys` -> `SyntaxError`. A csövezett tartalom és a heredoc
ugyanazért a stdin-ért versenyeznek.

*(Ez a bekezdés egy órán belül másodszor áll itt, és az első alakját ÉN rontottam el: a `-` alakot
írtam ide, ráadásul fordított argumentum-sorrenddel. Az első A/B próbám ezt sem mutatta ki, mert a
rossz sorrend miatt MINDKÉT alak ugyanazon a 404-en bukott -- a kontroll nem tudott tüzelni.
A helyes sorrenddel a különbség azonnal látszott. A hiba HANGOS, tehát nem néma kár -- de a
dokumentált használat bukik el, és a helper fejléce épp azt ígéri, hogy a héj-behelyettesítés
ellen véd, ami a FÁJL-alakra igaz is.)*

**MIÉRT NEM A NYERS `curl`, ÉS EZ MÉRT DEFEKTUS-JAVÍTÁS (2026-08-28 06:2x).** Itt évekig egy
nyers `curl` példa állt, és pontosan azt tanította, ami a fejléc-sodródást termeli: a szerző
KÉZZEL gépeli be az időt. Egy éjszaka alatt NÉGY ágens csúszott el ugyanígy (mandark becsléssel,
friday kompenzálással, dexter és computress `date`-tel EGY hívásban a szöveggel, a koordinátor
pedig úgy, hogy közben odaírta, hogy „date külön tool-hívásból" -- és nem futtatta).
A `card-comment.sh` és az `agent-msg.sh` **mindkettő behelyettesíti a `__STAMP__`-ot**, és
HANGOSAN elbukik, ha a `date` nem ad időt. Egy híváson belül a másolás így fizikailag lehetetlen.

**A CSAPDA, AMI ENÉLKÜL KELETKEZIK, ÉS MÉRVE IS VAN: `__STAMP__` HELPER NÉLKÜL ROSSZABB A
SEMMINÉL.** A táblán ma **69 komment** tartalmaz NYERS, behelyettesítetlen `__STAMP__`-ot -- azok
`curl`-lel mentek ki, és a helyőrző ott maradt a szövegben. Vagyis a placeholder nem opcionális
kényelem: **aki `__STAMP__`-ot ír, annak a helperrel is kell postáznia.** A kettő egy csomag.

*(A nyers `curl` továbbra is működik, és fix szöveghez rendben van. De ha a kommentben IDŐPONT
lesz, akkor a helper az út -- különben a szabály megint a szándékon áll, és ma négyszer bukott el
rajta valaki, köztük az, aki a szabályt írta.)*

Archiválás: `POST /api/kanban/KARTYA_ID/archive`, üres törzzsel.

Státuszok: planned, in_progress, testing, waiting, done


