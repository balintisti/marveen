# A generált CLAUDE.md-szakaszok indoklása és korábbi teljes szövege

*(Kiszervezve a generált szakaszokból 2026-10-30-án, a `06874086` kártya szerint: minden ágens-lap
38-47 ezer karakter volt, a cél 25 ezer, és a generált szakaszokat csak a generátor
(`src/web/agent-scaffold.ts`) rövidítheti, mert a kézi szerkesztés a következő ágens-indulásnál
elvész. A lapon a SZABÁLY és minden PARANCS maradt; itt áll az egyes szakaszok TELJES, rövidítés
előtti szövege, szó szerint, a friday lapjáról véve (a curl-példákban az ágens neve és a telepítés
útja ágensenként más). A BEGIN/END jelölők és a beszúrási figyelmeztetés nélkül.)*

---

## `autonomy-wiring`

A második vágás (kártya `134bff2f`, a `c6cbfcb1` terv V4-e, 2026-11-12): a két curl-recept a lapról ide, a lenti "Autonómia: curl-recept" szakaszba került, mert a blokk minden ágens minden indulásakor betöltődik, a recept viszont csak egy Level 1 jelzés vagy Level 2 kérés előtt kell. A lapon maradt, ami egy Level 2 kéréshez recept nélkül is elég: a végpont (`POST /api/approvals`), a payload az ágens saját nevével, a `GET /api/approvals/<id>` 60 mp-enként, a három kimenet; és a dashboard címe meg a token útja, amivel a recept kitölthető. A recept fejlécét a generátor `AUTONOMY_RECIPE_HEADING` konstansa nevezi meg, és teszt olvassa ezt a fájlt: az egyik oldal átnevezése piros.

Az első vágás után (2026-10-30) a lapon maradt: a három szint és jelentésük, a `store/autonomy-config.json` út, a level 1 értesítő curl (idézett heredoc), a jóváhagyás POST/GET receptje (60 mp, approved/rejected/timeout, az ok naplózása), és a payload-szabály teherhordó mondatai (a `-d "{...}"` tilos, idézett határoló vagy `--data-binary @fájl`, változóhoz `python3` + `json.dumps`, a header `$(cat ...)`-ja maradhat, csak a visszaolvasás fogja meg). Ide került: a payload-szabály hatókörének felsorolása (memória-PATCH, napi napló, eset-jegyzet) és a `python3 -c` eset részletes leírása ("command not found", némán kiesett mezőnevek).

A Level 3 sora (kártya `074149c2`, C11, 2026-11-10): a művelet utáni jelentés RIPORT, ezért beállított front
desk mellett a sor a front desket nevezi meg (`jelented a front desknek (<id>)`), ugyanazzal a próbával,
amivel a `report-routing` szakasz dönt. A front desk saját lapján, a koordinátor lapján és front desk nélkül
a régi mondat áll. A Level 1 jelzés határ-ügy, az a koordinátornál marad.

~~~~markdown
## Autonómia és jóváhagyás

Az autonóm műveletek fokozatait a store/autonomy-config.json szabályozza (level: 1=csak jelez, 2=javasol+jóváhagyás, 3=autonóm+jelent). Mielőtt önállóan cselekszel, nézd meg az adott kategória szintjét.

**Level 1 (csak jelez)**: küldj inter-agent értesítést a főágensnek, de NE végezd el a műveletet. Ezután ÁLLJ MEG.
```bash
curl -s -X POST http://localhost:3420/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" \
  --data-binary @- <<'JSON'
{"from":"friday","to":"marveen","content":"[FELHÍVÁS] CATEGORY_KEY: MIT akartam elvégezni, de level 1 miatt csak jelzek."}
JSON
```
FIGYELEM, a `-d "{...}"` DUPLA idézőjeles alak TILOS **MINDEN API-payloadnál** -- inter-agent
üzenet, memória-mentés és -PATCH, napi napló, eset-jegyzet, kanban egyaránt: a shell a backtickot
és a `$(...)`-t végrehajtja a payloadon belül, a szöveg helyére a parancs KIMENETE kerül, és a
küldés HTTP 200-at ad -- semmi nem jelzi. Idézett heredoc (fent) vagy `--data-binary @fájl`.
A header `$(cat ...)`-ja szándékosan interpolál, az maradhat.
A védelem az IDÉZETT határoló, nem maga a heredoc: a `<<JSON` alak ugyanúgy behelyettesít,
mint a dupla idézőjel, csak a `<<'JSON'` nem. És mivel az idézettben semmit nem lehet
behelyettesíteni, ha a payloadba EGY változó is kell, ne a shell állítsa össze: `python3` +
`json.dumps` (vagy `jq`) írja fájlba, és `curl --data-binary @fájl` küldje.
Nem az üzenet-típus számít, hanem hogy a szöveg BACKTICKET vagy `$(...)`-t tartalmaz-e: egy
`python3 -c "..."` dupla idézőjeles parancsban a backtickkel körbevett mezőnevek parancsként futnak le
("command not found"), és némán kiesnek a mentett szövegből, miközben a mentés HTTP 200-at ad.
Ezért csak az ÍRÁS UTÁNI VISSZAOLVASÁS fogja meg.

**Level 2 (jóváhagyás szükséges)**: kérj jóváhagyást az API-n MIELŐTT cselekszel.

Jóváhagyás kérése (POST):
curl -s -X POST http://localhost:3420/api/approvals -H "Content-Type: application/json" -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" -d '{"agent_id":"friday","category":"CATEGORY_KEY","action_description":"Mit tervezel elvégezni és miért","timeout_seconds":3600}'
A válaszban kapott id-vel kérdezheted le a döntést.

Döntés lekérdezése (GET, 60 mp-enként ismételve):
curl -s -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" "http://localhost:3420/api/approvals/<id>"
status=approved -> végezd el a műveletet. status=rejected vagy status=timeout -> ne csináld, naplózd az okot.

**Level 3 (autonóm)**: elvégzed a műveletet, majd utána jelented a főágensnek.
~~~~

## Autonómia: curl-recept

A lapod "Autonómia és jóváhagyás" blokkjából töltsd ki: `<DASHBOARD>` a dashboard címe, `<TOKEN>` a token útja,
`<NEVED>` a saját ágens-azonosítód, `<FOAGENS>` a főágens azonosítója. A payload IDÉZETT határolóban vagy
egyszeres idézőjelben áll: a shell semmit nem helyettesít be benne, ezért a helyőrzőket kézzel cseréld.
A header `$(cat ...)`-ja szándékosan helyettesít be (az olvassa a tokent), az maradhat.

Level 1 (csak jelez): értesítés a főágensnek, utána NEM végzed el a műveletet, és megállsz.
```bash
curl -s -X POST <DASHBOARD>/api/messages -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat <TOKEN>)" --data-binary @- <<'JSON'
{"from":"<NEVED>","to":"<FOAGENS>","content":"[FELHÍVÁS] CATEGORY_KEY: MIT akartam elvégezni, de level 1 miatt csak jelzek."}
JSON
```

Level 2 (jóváhagyás szükséges): MIELŐTT cselekszel, kérés, majd a kapott id-vel lekérdezés 60 mp-enként.
```bash
curl -s -X POST <DASHBOARD>/api/approvals -H "Content-Type: application/json" -H "Authorization: Bearer $(cat <TOKEN>)" -d '{"agent_id":"<NEVED>","category":"CATEGORY_KEY","action_description":"Mit tervezel elvégezni és miért","timeout_seconds":3600}'
curl -s -H "Authorization: Bearer $(cat <TOKEN>)" "<DASHBOARD>/api/approvals/<id>"
```
status=approved -> végezd el. status=rejected vagy status=timeout -> ne csináld, naplózd az okot.
Ha az `action_description` szövegében aposztróf van, az egyszeres idézőjeles `-d` eltörik: akkor `python3` +
`json.dumps` írja fájlba a payloadot, és `--data-binary @fájl` küldje.

---

## `skills-path-trap`

A lapon maradt: a symlink ténye mindkét névvel (`.claude-config/skills`, `.channels-config/skills`), a saját skill helye (`.claude/skills/`), a relatív út megjegyzése, a "ne a nevét, hanem hova mutat" szabály és a realpath-parancs. Ide került: a 2026-08-25-i hiányos javítás, a 2026-09-04-i KILENC symlinkes mérés és a koordinátor esete, valamint a mai populáció felsorolása.

~~~~markdown
## Skill-útvonal csapda (KÖTELEZŐ elolvasni skill-írás előtt)

A `.claude-config/skills` NEM a saját mappád: symlink a globális
`~/.claude/skills`-re, tehát ami oda kerül, az a TELJES flottánál megjelenik
-- akkor is, ha a skill-futtatás base directory-ja ezt az utat mutatja.
A saját, csak neked szóló vagy kipróbálatlan külső skill a munkakönyvtárad
`.claude/skills/` mappájába megy. A globálisba írás tudatos, flotta-szintű
döntés legyen, ne alapértelmezés.

AZ ÚT A TE MUNKAKÖNYVTÁRADHOZ KÉPEST RELATÍV. A repó gyökeréből nézve nem
létezik -- és az NEM azt jelenti, hogy ez a figyelmeztetés elavult. Mérve
2026-09-04: KILENC ilyen symlink van, és a gyökérből egy sem látszik. Aki
onnan ellenőrzi, egy IGAZ mondatot javít hamisra -- ez egyszer már megtörtént,
és a javítás konkrét volt és hiányos.

ÉS A KILENCEDIKET A NEVE REJTETTE EL: A KOORDINÁTORÉ `.channels-config/skills`.
Ez a bekezdés 2026-08-25 óta NYOLCAT mondott, és a hiányzó a `marveen/`
`.channels-config/skills` volt -- ugyanaz a symlink ugyanarra a globális fára,
MÁS KÖNYVTÁRNÉVEN. 2026-09-04-én pontosan azon sétált be marveen: a szabályt
ISMERTE, csak a szabály a `.claude-config` NEVET nevezte meg, és az övé nem az.

EZÉRT NE A NEVET KERESD, HANEM KÉRDEZD MEG, HOVA MUTAT. Egy sor, és bárhol áll
a válasz, ahol épp vagy:

```bash
python3 -c "import os,sys;print(os.path.realpath(sys.argv[1]))" <a skills út>
# ha /Users/<te>/.claude/skills jön vissza, az a FLOTTA fája, nem a tiéd
```

A teljes mai populáció: hat `agents/<ágens>/.claude-config/skills`, két
worker-home `.claude-config/skills`, és a koordinátor `.channels-config/skills`-e.
A szám ELAVUL, az ellenőrzés nem -- ha listát olvasol a parancs helyett, a
következő új konfig-fa megint hiányozni fog belőle.
~~~~

---

## `evidence-rule`

A lapon maradt minden szabály (tény / tipp / nem tudom, a négy tiltás, a konkrétum forrása, a kimenő levél kapujának igaz leírása); csak a megfogalmazás tömörebb. Ide került: semmi tartalmi, a teljes korábbi szöveg összevetéshez.

~~~~markdown
## Tények és találgatás

Ez a legfontosabb szabályod, fontosabb a gyorsaságnál. Minden állításodról derüljön ki, melyik:
1. **Tény.** Ellenőrizted; fél mondatban mondd meg, honnan tudod.
2. **Tipp.** Jelöld annak, ugyanabban a mondatban.
3. **Nem tudom.** Teljes értékű válasz; ha van rá mód, nézd meg.

- Nem találsz ki magyarázatot egy hibára, amit nem néztél meg.
- Nem mondod, hogy valami lehetetlen, nem elérhető, lejárt vagy leállt, amíg meg nem nézted.
- Dátumot, időtartamot vagy számot nem becsülsz emlékezetből.
- Ha terv, levél vagy külső kérés RÁÉPÜL egy állításra, előtte ellenőrizd.

Előbb a saját forrásainkban ellenőrizz (fájl, config, API, git), a gazda ideje utoljára. Ha
tévedtél: javítsd röviden, és mondd meg, mi épült rá közben.

### A konkrétum mindig forrásból jön

Email cím, telefonszám, URL, ügyszám, azonosító, számlaszám, verzió, ár: vagy megvan a forrása,
vagy nincs meg az adat. Email cím: a tőlük kapott levél From fejléce vagy az élő oldaluk, SOHA nem a
`support@`, `info@`, `hello@` szokásból, és nem névből összerakva. Ha nincs forrás, a válasz:
"ezt nem találom sehol".

Kimenő levélnél a gépi kapu a KÜLDÉST tiltja (csak piszkozat, a levél a fő ügynökön át megy). A CÍMET nem ellenőrzi, címzett-ledger nincs: ez szabály, nem gép, ne olvasd védelemnek ott, ahol nincs.
~~~~

---

## `fleet-auth`

A lapon maradt: a token-út, a fő agent eltérése, a `claudeConfigDir` támogatottsága, a "Not logged in" javítása és a másolási tilalom. Ide került: a tilalom indoka ("A másolás auditálhatatlan, és más adatához is hozzáférést ad.") és a "döntés, nem tilalom" megfogalmazás.

~~~~markdown
## Flotta-szintű AUTH-szabály (MEGSZEGHETETLEN)

A sub-agentek a `CLAUDE_CODE_OAUTH_TOKEN` úton hitelesítenek (`store/.claude-oauth-token`), saját
`CLAUDE_CONFIG_DIR`-rel. A fő channels-agent szándékosan eltérhet (`MAIN_AGENT_ISOLATED_CONFIG`,
`MAIN_AGENT_CONFIG_DIR`). A per-agent `claudeConfigDir` támogatott mező: döntés, nem tilalom.

1. "Not logged in" esetén a javítás a TOKEN-FORRÁS, nem egy kézzel elhelyezett vagy symlinkelt
   `.credentials.json`: a lejárt fájl az érvényes env-tokennel szemben is nyer, és minden
   alkalommal ez hozta vissza a 401-kaszkádot.
2. SOHA ne másold át másik agent tokenjét vagy credentialjét: új agent saját tokent és saját
   külső-szolgáltatás setupot kap. A másolás auditálhatatlan, és más adatához is hozzáférést ad.
~~~~

---

## `message-close`

A lapon maradt minden szabály és a curl. Ide került: semmi tartalmi, a teljes korábbi szöveg összevetéshez.

~~~~markdown
## Üzenet lezárása: bejövő riportnál `notify:false`

A `PUT /api/messages/<id>` lezárás alapból `[Eredmény]` nyugtát küld a feladónak.
- DELEGÁLT FELADAT (a feladó az eredményre vár): zárd a szokásos módon, a `result` mezőben az eredménnyel.
- BEJÖVŐ RIPORT vagy ÉRTESÍTÉS: zárd `"notify":false`-szal, mert ott a nyugta csak a feladó sorát növeli.
```bash
curl -s -X PUT http://localhost:3420/api/messages/<id> -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(cat /Users/isti/marveen/store/.dashboard-token)" --data-binary '{"status":"done","notify":false}'
```
A `notify` csak JSON boolean lehet: a `"false"` string 400-at kap, és a lezárás sem történik meg.
~~~~

---

## `mcp-list-channel`

A lapon maradt minden állítás, a dátum és a dokumentum-mutató. Ide került: semmi tartalmi, a teljes korábbi szöveg összevetéshez.

~~~~markdown
## `claude mcp list` egy csatornát birtokló ügynökben

Ha ez az ügynök csatornát birtokol, a saját sessionjében NE futtasd a `claude mcp list`-et:
mérve 2026-09-21-én, leállítja a csatorna-plugint (reply, react, edit_message elérhetetlen), közben
`Connected`-et ír és 0-val tér vissza, tehát a hibát semmi nem jelzi. A session
újraindítása visszahozza. Máshol hasznos diagnosztika. A BEJÖVŐ üzenetek sorsát nem mértük; részletek:
`docs/mcp-list-channel-plugin.md`.
~~~~

---

## `report-routing`

Nem rövidített szakasz, hanem új (kártya `074149c2`, 3. szakasz, 2026-11-10). Az indok: a koordinátor
bejövő sorának nagy része gépi értesítő és ügynöki riport volt, és mindegyik egy teljes koordinátor-kört
indított. A 2. szakasz a gépi értesítőket viszi át a beállított front deskre (`FRONT_DESK_AGENT_ID`); ez a
szakasz az ügynökök saját riportjait: kész, státusz, átadás, tájékoztatás a front deskhez megy, a
koordinátorhoz csak döntés (`DECISION:` első sor), átlépett határ, vagy ami a tulajdonoshoz kell jusson.

Miért generált: a szabálynak körüzenet nélkül, az ügynök következő indulásakor kell életbe lépnie.
Miért van ott a blokk akkor is, ha nincs front desk: a `scripts/agent-core-check.py` minden lapon minden
generált nevet keres, egy eltűnő blokk kézzel átírt lapnak látszana. Front desk nélkül (üres, hibás
alakú, maga a koordinátor, vagy nem a flotta ügynöke) a blokk egyetlen sor, és NEM ad szabályt.
Az elsőbbségi mondat (`THIS SECTION WINS ...`, marveen döntése, kártya-komment 57560): a lapokon kézzel
írt, a koordinátort megnevező riport-sorok is állnak, és azok soronként, később kerülnek ki. Addig a
szakasz maga mondja ki, hogy a négy riport-fajtára ő nyer, a döntés, az átlépett határ és a tulajdonosnak
szóló ügy pedig a koordinátornál marad. Front desk nélkül a mondat sincs a lapon.
Korlát: a lap az ügynök indulásakor íródik, a beállítás menet közben is állítható. A `FRONT_DESK_AGENT_ID`
írása (POST `/api/settings`) ezért azonnal újraírja a koordinátor és minden ügynök lapján a két, front
desktől függő szakaszt (ezt és az `autonomy-wiring` Level 3 sorát; `src/web/front-desk-sheets.ts`), és a
válasz `sheets` mezője megnevezi azt a lapot, amit nem sikerült újraírni. Ami megmaradt: egy már futó
munkamenet a régi szöveget olvasta be, az újat a következő indulásakor látja; és csak ez az út frissít, a
felülíró-fájl kézi szerkesztése nem.
