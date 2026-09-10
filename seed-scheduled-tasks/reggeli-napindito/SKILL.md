---
name: reggeli-napindito
description: Reggeli összefoglaló: email, naptár, AI hírek, plus Dream Engine top-of-message
---

Reggeli napindítót a CLAUDE.md formátum szerint. A beállított csatornára -- a chat_id-t a
wrapper adja meg. A `0` NEM működik: a csatorna allowlistes, és a küldés elhal.

**FONTOS — Dream Engine override**: a napindító ELEJÉRE (még az email/naptár szekciók ELŐTT) tedd be a `{{INSTALL_DIR}}/DREAM.md` fájl tartalmából az 5 bucket-et — `💡 Skill-javaslatok`, `🧹 Memória-egészség`, `🎯 Top-3 holnapi javaslat`, `🌐 External opportunity`, `🛠 Skill-flotta health`. Ha a DREAM.md nem létezik vagy üres (pl. a Dream Engine valamiért nem futott le), kihagyod ezt a szekciót.

A `cat {{INSTALL_DIR}}/DREAM.md` parancs visszaadja a tartalmat, abból emeld ki a kulcs-szekciókat MarkdownV2-formátumra escape-elve.

A többi szekció (email, naptár, AI hírek) maradnak a CLAUDE.md-ben leírt formátum szerint.

**A HÁROM ÚJ SZEKCIÓ EGYETLEN PARANCSBÓL JÖN** (Isti kérte 2026-09-10, kártya `b5981bdb`):

```bash
python3 {{INSTALL_DIR}}/scripts/napindito-sections.py
```

A kimenetét **szó szerint** vedd át (a Dream-bucketek UTÁN, az email/naptár ELŐTT), ne fogalmazd
át és ne számolj hozzá semmit. A szkript négy blokkot ad: *mi vár rád*, *változás tegnap óta*,
*mi tört el az éjjel*, és a *keret* egysoros kihagyás-indoka.

**MIÉRT PARANCS ÉS NEM UTASÍTÁS:** mind a három szekció számlálás. Ha a prompt kérné meg, minden
reggel újra levezetnéd ugyanazt, fordulónként más eredménnyel -- és a `kanban_cards` időbélyege
MÁSODPERC, a `task_runs`-é EZREDMÁSODPERC, ami ezredmásodpercként olvasva 20 685 napos kort ad.
A szkript ezt futásidőben ellenőrzi és inkább megáll.

**A SZERZŐDÉSE, ÉS EZ A LÉNYEG:** egy szekció SOHA nem marad el némán. Vagy tartalma van, vagy
EGY SOR arról, hogy az ellenőrzés miért nem futott le. Két dolgot külön is kimond, mert mindkettő
a megnyugtató irányba tévedne:
- ha nincs tegnapi alapvonal, azt írja ki, hogy **ez az első mérés** -- nem azt, hogy nulla a delta,
- a "mi tört el" szekció **kimarad, ha nincs mit mondani**, de ha maga az ellenőrzés bukott el,
  arról egy sort ír, az okkal.

Ha a parancs egyáltalán nem fut le (`No such file or directory`, vagy nem nulla kilépés), írd ki
egy sorban, hogy *"a napindító három új szekciója nem futott le: <a hibaüzenet>"* -- ugyanaz a
szabály, mint az emailnél és a naptárnál: az ÜRES és a NEM MÉRHETŐ nem ugyanaz.

*(A `waiting` + gazda=Isti metszetet számolja, mert egyik mező sem elég önmagában: a `waiting`
blokkoltat jelent, a gazda-mező a VÉGREHAJTÓT nevezi meg. Mérve 2026-09-10: 19 élő kártya áll
Istin, ebből 14 `waiting`.)*

**AZ EMAIL ÉS A NAPTÁR KÉT PARANCS. NE KERESS HOZZÁJUK ESZKÖZT** (javítva 2026-08-22,
friday):

```bash
python3 {{INSTALL_DIR}}/scripts/gmail-recent.py --minutes 720 --limit 15
bash    {{INSTALL_DIR}}/scripts/calendar-agenda.sh --hours 24
```

Mindkettő ugyanazt a szerződést tartja: **mindig 0-val lép ki, mindig JSON-t ad**, és a
JSON vagy `{"ok":true, ...}` (megnéztük, ez van), vagy `{"ok":false,"error":"..."}`.
Harmadik JSON-**alak** nincs, és üres naptárt vagy postafiókot **nem lehet `ok:true` nélkül
kapni**. A naptár-JSON `via` mezője megmondja, melyik példány válaszolt (`dist` vagy
`tsx-source`); ha `warning` mező van benne, azt is írd ki.

**DE AZ `ok:false` NEM AZT JELENTI, HOGY „nem tudtuk megnézni" -- KÉT KÜLÖNBÖZŐ OKOT FED**
(jarvis mérte forrásból, 2026-08-24). Három ág van, és csak KETTŐ megkülönböztethető:

    (a) üres                -> `{"ok":true,"count":0}`                 megkülönböztethető
    (b) ELÉRHETETLEN        -> `{"ok":false,"error":"..."}`  a wrapperből
    (c) ELÉRT, de HIBÁZOTT  -> `{"ok":false,"error":"..."}`  a CLI fail()-jéből

A (b) és a (c) **bájt-azonos**: nincs `kind`, nincs `stage`, csak szabad szöveges `error`.
A korábbi „harmadik alak nincs" mondat a JSON ALAKJÁRA igaz volt, de úgy olvasódott, mintha az
OKOKRA is állna -- és ez a különbség 2026-08-24-ig **háromszor** termelt hamis mondatot Istinek.

**EZÉRT, HA `ok:false` JÖN:** NE írd ki, hogy „nincs naptár" vagy „nincs bekötve naptár-eszköz".
Írd ki, hogy a lekérdezés HIBÁVAL tért vissza, és **idézd az `error` szövegét szó szerint**.
Ha az `error` 5000 ms körüli időtúllépést említ, az majdnem biztosan a Google **token-csere**
(kártya `f4c59571`), NEM a naptár: a token-lépés örökli a naptár 5s-os korlátját, és a hibaszöveg
félrevezetően a Calendar API-t nevezi meg.

**HA A PARANCS NEM LÉTEZIK** (`No such file or directory`): az azt jelenti, hogy a javítás még
NINCS BEOLVASZTVA az éles ágba -- a `{{INSTALL_DIR}}` fő checkout telepítési fa, és csak a
beolvasztott állapotot tartalmazza. Ez NEM "nincs naptár" és NEM "nincs levél": írd ki egy sorban
pontosan így, hogy *"naptár: a lekérdező szkript nincs beolvasztva (fix/6e6e40ce-napindito-adatforras)"*.
A különbség ugyanaz, mint mindenhol máshol ezen a lapon: az ÜRES és a NEM MÉRHETŐ nem ugyanaz.

A szabály, amit ez kikényszerít: **az ÜRES kategóriát hagyd ki, a NEM ELÉRHETŐT írd ki**
egy sorban, az okkal. A kettő nem ugyanaz.

**MIÉRT NEM `ToolSearch`, ÉS MIÉRT NEM `ls tokens.json`** -- ez a két sor 2026-08-22-ig itt
állt, és rossz választ adott. Aznap reggel a napindító MCP-naptáreszközt keresett, nem
talált, és azt írta ki Istinek, hogy "nincs bekötve naptár-eszköz". Ugyanaznap este megmérve
a szolgáltatásfiók HTTP 200-at adott ugyanarra a naptárra, `accessRole: writer`-rel. Vagyis
egy MŰKÖDŐ adatforrást jelentett elérhetetlennek, és a szabály ("a nem elérhetőt írd ki")
közben helyesen tüzelt -- csak hamis állítást írt ki. A hiba nem a szabályban volt, hanem
abban, hogy a napindítónak MEG KELLETT TALÁLNIA egy mechanizmust három, egymásnak
ellentmondó leírásból, ahelyett hogy FUTTATOTT volna egyet.

A Mail.app AppleScripten át: NE használd. A fenti IMAP-parancs a mai út, headless gépen is
megbízható, és nem függ Automation-engedélytől.

**AI hírek szekció -- CSAK a fő-ágensnél (marveen)**: ha NEM a fő-ágensként futsz (azaz sub-agentként), HAGYD KI az "🤖 AI HÍREK" szekciót -- sub-agenteknek nem releváns. Az email és naptár szekció marad mindenkinél.
