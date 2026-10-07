# Az MCP-eszkoz-veszes mert esetei

*(A `CLAUDE.md` „EGY `claude mcp` PARANCS..." szakaszabol kiemelve 2026-09-19-en, Isti
kimondott keresere: a lap az o szavaival „csak azokat a reszeket hagyd amik kellenek neked a
munkahoz". A MAGBAN maradt a tiltas, a hatokore, a biztonsagos alternativa es a vesz-kijarat;
IDE kerult a bizonyitek-anyag. A teljes eredeti szoveg valtozatlanul all alabb -- nem
atfogalmazva, hogy a mert reszletek es a szamok pontosan visszakereshetok legyenek.)*

---

## EGY `claude mcp` PARANCS A SESSIONBŐL ELVISZI A SESSION ÖSSZES MCP-ESZKÖZÉT (marveen mérte magán kétszer, 2026-08-25)

**JAVÍTVA 13:34-kor, ugyanazon a napon: az első magyarázatom hiányos volt.** Először azt írtam ide
(és mondtam a gazdának), hogy a kiváltó ok az `~/.mcp.json` **szerkesztése**. Aznap másodszor is
elvesztettem az összes MCP-eszközt, és akkor **nem nyúltam a konfighoz** -- csak lefuttattam egy
`claude mcp list`-et.

    1. eset (10:59):  konfig-szerkesztés  ÉS  `claude mcp list`   -> minden eszköz eltűnt
    2. eset (13:3x):  CSAK `claude mcp list`                      -> minden eszköz eltűnt

A második eset **elkülöníti a változót**: a `claude mcp list` önmagában elég. Az első
megfigyelésben a szerkesztés **összezavaró tényező** volt, és én azt neveztem meg oknak.
Hogy a konfig-szerkesztés ÖNMAGÁBAN is kiváltja-e, azt **nem tudom** -- soha nem mértem külön,
és nem is fogom élesben, mert a próba maga a kár.

Az MCP-kapcsolatok tehát egy futó munkamenetből lebomlanak és újraépülnek. Az ablak alatt az
eszközök nem elérhetők, és a hiba alakja megtévesztő: a `claude mcp list` -- épp az a parancs,
ami kiváltja -- közben `✔ Connected`-et mond, mert a szerver tényleg fut.

Mért eset: 10:59:26-kor felvettem a sentry szervert a `~/.mcp.json`-be, és ugyanabban a
pillanatban **80 deferred eszköz tűnt el** (telegram, desktop-commander, playwright, memory,
postgres, supabase, tavily, cloudflare). A `reply` tool is, vagyis az egyetlen út a gazdához.

**A KIZÁRÁSOS BIZONYÍTÉK, ami a diagnózist megalapozza:** a kézenfekvő magyarázat az lenne, hogy
a plugin-folyamat összeomlott. Nem az. A telegram plugin folyamatok indulási ideje mérve: az,
amelyik a munkamenetet szolgálta (PID 63075, 10:05:03), **végig futott**, és 10:59-kor egyetlen
folyamat sem indult újra. A szakadás a KLIENS oldalán volt.

    A szerver `Connected`. Az eszköz nincs. A kettő nem ugyanaz az állítás.

**⚠ ÉS 2026-09-18-AN A HATOKOR TAGULT: NEM CSAK A `claude mcp` ALPARANCS -- EGY `claude -p`
ALFOLYAMAT IS ELVISZI** (didi merte magan, veletlenul, egy alapvonal-meres kozben).

    `claude -p ...` egy futo sessionbol  ->  a proba EL SEM INDULT („Not logged in"),
                                             es kozben **4 MCP-eszkoz eltunt didi sessionjebol**
    a `~/.mcp.json` mtime ...............  VALTOZATLAN (08-26 08:35:34 elotte ES utana)
                                             -> nem a konfig mozdult, a KLIENS-oldali kapcsolat szakadt

**Vagyis a kar akkor is bekovetkezik, ha a parancs MAGA elbukik.** A tiltas tehat nem a `mcp`
alparancsra szol, hanem arra, hogy egy MCP-fuggo sessionbol `claude`-ot inditasz ALFOLYAMATKENT --
barmilyen kapcsoloval.

**A KOORDINATORRA EZ A LEGELESEBB: az egyetlen utja Istihez EGY MCP-eszkoz (`reply`).** Egy
alapvonal-meres kedveert elveszitett `reply` tool azt jelenti, hogy a gazda nem ertesul semmirol.

**A SZABÁLY, A JAVÍTOTT ALAKJÁBAN: ne futtass `claude mcp` parancsot olyan munkamenetből, ami
azoktól a szerverektől függ**, és ugyanígy ne szerkeszd a konfigot sem. Ez a fő-ágensre a
legélesebb: az egyetlen csatornája a gazda felé EGY MCP-eszköz.

**ÉS A KIÚT, MERT EGY TILTÁS KIÚT NÉLKÜL ADDIG TART, AMÍG VALAKI TÉNYLEG KÍVÁNCSI LESZ** (didi
mérte és mérte meg magán, 2026-08-27; a kártyán ott állt, ezen a lapon nem -- `grep` szerint nulla
találat). A tiltás egy VALÓDI igényt tilt: látni akarod, mi fut. Ha nincs helyette semmi, aki épp
tudni akarja, a tiltott parancsot futtatja -- nem dacból, hanem mert nem tud másról.

```bash
# BIZTONSÁGOS: fájl-olvasás, nem kapcsolat-művelet -- az MCP-eszközök érintetlenek maradnak
python3 -c "import json; d=json.load(open('$HOME/.mcp.json')); print(sorted(d.get('mcpServers',{})))"
```

**HÁROM FÜGGETLEN FUTTATÁS, KÜLÖN-KÜLÖN, AZONOS EREDMÉNNYEL** (2026-08-27): didi, marveen, majd
didi újra -- mindháromszor 7 szerver, nulla eszköz-veszteség. Ezt azért írjuk ki, mert a szám
egyetlen névvel egyforrásúnak látszik; didi találta meg, hogy a lap az ellenkező hibát követte el,
mint amiről szól (több független mérés, egynek mutatva).

**ÉS A "NEM NYÚL A KAPCSOLATOKHOZ" NE ÁLLÍTÁS LEGYEN, HANEM BIZONYÍTÉK.** Épp ez a szakasz szól
arról, hogy egy ártalmatlannak látszó OLVASÓ lekérdezés vitte el az eszközöket -- ott az "olvasó"
jelző önmagában kevés:

```bash
stat -f '%Sm %N' "$HOME/.mcp.json"   # futtatás ELŐTT és UTÁN: változatlan mtime
```

**A tiltás mondja meg, MI HELYETTE** -- különben nem a döntés tárolódik, csak a tilalom.

**És ez a javított alak SOKKAL fontosabb, mint az eredeti**, mert a `claude mcp list` egy
ártalmatlannak látszó, OLVASÓ állapot-lekérdezés. A konfig szerkesztése ritka és megfontolt; egy
állapot-lekérdezést az ember gondolkodás nélkül futtat. A veszélyesebb kiváltó ok volt az, amit
elsőre nem vettem észre.

**És amiért ez mégsem katasztrófa:** a tartalék út a `scripts/notify.sh` (repó saját küldője, a
tokent a `.env`-ből olvassa). 2026-08-25-ig ez maga is néma volt (`ALLOWED_CHAT_ID=0` + a választ
`>/dev/null`-ba dobta + feltétel nélkül sikert jelentett); aznap javítva, mindkét fele. Tehát a
lekapcsolódás kockázata megmarad, a következménye viszont már nem néma.

*(A harmadik védelem a Stop hook, ami észreveszi, ha egy Telegram-üzenetre nem a `reply` toollal
válaszoltál, és kikényszeríti. Aznap ténylegesen megfogott.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1813-1839, szó szerint -->
## NE INDÍTS `claude`-OT ALFOLYAMATKÉNT EGY MCP-FÜGGŐ MUNKAMENETBŐL
*(Mérve 2026-08-25 (marveen, kétszer) és 2026-09-18 (didi). A mért esetek, a kizárásos
bizonyíték és a három független futtatás: `rulebook/mcp-eszkoz-veszes.md`. 5 279 karakter volt itt.)*

Egy `claude mcp list` vagy egy `claude -p` a munkamenet ÖSSZES MCP-eszközét leviszi. A tiltás
nem a `mcp` alparancsra szól, hanem arra, hogy MCP-függő sessionből `claude`-ot indítasz
alfolyamatként -- bármilyen kapcsolóval.

    a kar akkor is bekovetkezik, ha a parancs MAGA elbukik (didi: „Not logged in", es kozben
      negy eszkoz eltunt)
    a `~/.mcp.json` mtime VALTOZATLAN -> nem a konfig mozdul, a KLIENS-oldali kapcsolat szakad
    a `claude mcp list` kozben `✔ Connected`-et mond, mert a szerver tenyleg fut
    **A szerver `Connected`. Az eszkoz nincs. A ketto nem ugyanaz az allitas.**

**A KOORDINÁTORRA EZ A LEGÉLESEBB: az egyetlen utam Istihez EGY MCP-eszköz (`reply`).**

**ÉS A KIÚT, MERT EGY TILTÁS KIÚT NÉLKÜL ADDIG TART, AMÍG VALAKI KÍVÁNCSI LESZ.** A tiltás egy
VALÓDI igényt tilt: látni akarod, mi fut. Fájl-olvasás, nem kapcsolat-művelet:

```bash
python3 -c "import json; d=json.load(open('$HOME/.mcp.json')); print(sorted(d.get('mcpServers',{})))"
stat -f '%Sm %N' "$HOME/.mcp.json"   # futtatás ELŐTT és UTÁN: változatlan mtime a bizonyíték
```

*(Három független futtatás, három ágens, nulla eszköz-veszteség. A tartalék út Istihez:
`bash scripts/notify.sh "..."` -- lásd a vész-kijárat szakaszt.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1853-1883, szó szerint -->
**MIERT ITT VAN LEIRVA ES NEM SKILLBEN** (dontes 2026-08-29, friday kikotese alapjan): a
`~/.claude/skills/` fa NINCS verziozva, tehat egy vesz-kijarat leirasa, ami maga is eltunhet egy
`git clean`-nel vagy egy uj gepen, pontosan azt a hibat ismetli, ami ellen keszult. A lap sem
verziozott (`git ls-files CLAUDE.md` -> 0, sajat kartya: 47a638d8) -- de a lap MINDEN munkamenet
elejen betoltodik ANNAK, AKIHEZ ELJUT, a skillt viszont csak az hivja meg, aki mar tudja, hogy
letezik. **Egy vesz-kijaratot nem hiv meg senki, aki nem tudja, hogy van.**

**ES A "AKIHEZ ELJUT" 2026-09-18 OTA EGY OLVASO** (a levalasztas; lasd a napindito-szakaszt).
A hetnek ez az ut a SAJAT lapjukon all, es a `scripts/notify.sh` kanari-mondat orzi -- vagyis az
ERVELES all, de MAS mechanizmuson: nem ez a lap viszi at nekik, hanem az `agent-core-check.py`.

**~~AMIT VISZONT MA NEM CSINAL: NEM IR A LEDGERBE.~~ EZ 2026-09-03 06:27 OTA HAMIS, es a lapon
egy napig jelen idoben allt** (jarvis talalta 09-04 18:38, marveen ujramerte):

    2026-09-03 08:0x  `grep -cE 'conversation_log|ledger' scripts/notify.sh` -> **0**   <- akkor IGAZ
    2026-09-04 18:3x  ugyanaz a parancs ......................................... **5**   <- MA
    `merge-base --is-ancestor fa809dc HEAD` -> **rc=0**, a javitas A FUTO FAN VAN
    KONTROLL: HEAD onmagara rc=0 | a `TELEGRAM_BOT_TOKEN` ugyanabban a fajlban 2 -> a mero lat

**A `fix/44730c4c-notify-ledger` BEOLVADT. A kijarat MA NYOMOT HAGY:** ami ezen az uton megy ki,
megjelenik a `conversation_log`-ban.

**AMIERT A REGI SZOVEG ITT MARAD ATHUZVA, ES NEM TOROLVE:** ez a lap sajat, tobbszor rogzitett
alakja -- egy JELEN IDEJU mondat egy MAR JAVITOTT fan a legolcsobb modja annak, hogy valaki egy nem
letezo defektusra epitsen. Aki ma reggel ezt olvasta, pont az ELLENKEZOJET tervezte annak, ami igaz.
Az elavulas nem hibauzenet: a mondat valtozatlan maradt, csak a vilag mozdult alatta.

*(Es a mechanizmus, amiert egy NAPIG allt: a `scripts/` az AZONNAL-ELO sav, tehat a beolvasztas
pillanataban hatott -- de a LAPON nincs semmi, ami a beolvasztaskor mozdulna. A javitas eseménye
nem ir vissza a lapra, ugyanugy, ahogy egy fix nem ir vissza a kartya statuszara.)*



<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 1884-1887, szó szerint -->
**UJRANYITASI FELTETEL, GATE alakban:** ha valaki a `notify.sh`-t modositja, ez a NEGY ujramerendo
-- a fajl futtathato, a ket env-kulcs jelen van, a hibaag `exit 1`-et ad, es ir-e a ledgerbe. Egy
elkuldott TESZT-UZENET nem szukseges es nem is kivanatos: a gazda telefonjara megy.

