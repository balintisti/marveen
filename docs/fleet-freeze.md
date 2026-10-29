# Piros gomb: a flotta fagyasztása

## 🎯 Mit tud

Egy mozdulattal megállítja az egész flottát, ha valami elszabadult. Ilyen lehet egy ügynök, amely levelet küldöz vagy pénzes API-t hív hurokban, egy prompt-injekció után furcsán viselkedő ügynök, vagy egy hibás ütemezett feladat.

- **Fagyasztás:** egyik ügynök sem futtathat eszközt: nem ír fájlt, nem futtat parancsot, nem küld levelet, nem válaszol a csatornán. A sessionök és a kontextusuk megmaradnak. A dashboard háttér-ciklusai (üzenet-kézbesítés, ütemező, auto-restart, context-guard és a többi) állnak. A sorban álló üzenetek a feloldás után mennek ki.
- **Leállítás:** a fagyasztáson túl az al-ügynökök sessionjeit is leállítja, és megjegyzi, melyeket. Feloldáskor pontosan ezek indulnak újra. A fő ügynök csak fagyasztva van, nem áll le.

**Ki nyomhatja meg:** bárki, akinek dashboard-hozzáférése van, egy ügynök is (önfék). Egy tévedésből megnyomott fék a gazdának egy percébe kerül.

**Ki oldhatja fel:** csak a gazda, a dashboard-jelszóval bejelentkezve (böngészőben, a Bridge-ben is; egy eszközkulcs, például a Bridge párosító kulcsa, nem elég). A szabály a `mayLiftFleetFreeze` (routes/fleet-freeze.ts). FIGYELEM, ebben a telepítésben az upstream #2163 (felhasználó-létrehozás és eszközkulcs-kiadás csak a gazda munkamenetével) nincs átvéve, tehát a token még létrehozhat egy dashboard-felhasználót és azzal bejelentkezhet: a feloldás védelme annyit ér, amennyit ez az út. A közös tokennel nem lehet feloldani, így egy eltévedt vagy rávett ügynök nem oldhatja fel magát. Egyetlen kivétel van: amíg nincs dashboard-felhasználó (első telepítés), a token az egyetlen gazda-hitelesítés.

## Hol

- **Dashboard:** piros gomb az oldalsávban; fagyasztás alatt piros sáv van a tetején a Feloldás gombbal.
- **Telefonról, a gazda csatornáján:**
  - `/stop <indok>` fagyaszt;
  - `/resume` megmondja, hol lehet feloldani. Ez az út a közös tokennel fut, ezért innen nem lehet feloldani.
- **API:**
  - `GET /api/fleet/freeze`;
  - `POST /api/fleet/freeze {"reason": "...", "mode": "freeze"|"stop"}`;
  - `POST /api/fleet/unfreeze`.

A gazda minden kapcsoláskor értesítést kap a gazda-csatornán. A változás a config-naplóba is bekerül (`fleet.freeze`).

## 🛠 Hogyan működik

- **A kapcsoló egy fájl:** `store/fleet-freeze.json`. Amíg létezik, a flotta fagyasztva van. Egy olvashatatlan fájl is fagyasztást jelent.
- **Az ügynököknél:** egy PreToolUse hook (matcher `*`) minden eszközhívást 2-es kóddal elutasít, amíg a fájl létezik. Az al-ügynökök a `templates/settings.json.template`-ből kapják, a fő ügynök a projekt `.claude/settings.json`-jából. A hook (`scripts/hooks/fleet-freeze-gate.sh`) egy rövid shell-szkript: egyetlen fájl-ellenőrzés, nincs benne értelmező, ami elromolhatna.
- **A dashboardon:** a háttér-ciklusok a `whileNotFrozen` / `frozenSkip` kapun mennek át (`src/web/fleet-freeze.ts`). A dashboard saját Claude-hívásai (`runAgent`: napi napló, ütemező-segéd, képesség-összefoglalók) fagyasztva el sem indulnak, és az interaktív worker-session `settings.json`-jában is ott a hook. A HTTP-szerver, a belépés, ez az API, az adatbázis és a naplók futnak tovább.
- **Ebben a telepítésben az al-ügynököknél** a sablon (`templates/settings.json.template`) csak az ÚJ ügynökök magja; a meglévők a dashboard indulásakor az `ensureAgentHooks`-on át kapják meg a hookot (`src/__tests__/fleet-freeze-agent-hooks.test.ts` pinneli).
- **Az első (egyszeri) tick is kapun megy:** ha a dashboard fagyasztás közben indul újra, a ciklusok első, késleltetett ticke sem fut le (a channel-monitor 30 mp-es ticke különben újraindítaná a leállított ügynököket).
- **NEM fagy a dashboardon:** a tétlen-őr (`idle-agent-watcher`: csak üzenetet tesz a sorba, a kézbesítés áll), a naplóforgatás, a memória-lebomlás, a kanban-archiváló, és a riasztó figyelők (uptime, Sentry, frissítés-ellenőrző, csatorna-kérés/-meghívó figyelők): ezek nem nyúlnak ügynök-sessionhöz, a riasztásnak pedig fagyasztás alatt is menni kell.
- **Vészkijárat a gépen:** a `store/fleet-freeze.json` törlése feloldja a fagyasztást (a leállított ügynököket ilyenkor kézzel, vagy a desired-state figyelő indítja újra).

**Mitől NEM véd:**
- egy kiszivárgott kulcs gépen kívüli használatától: azt a kulcs visszavonása állítja meg;
- attól, ami már kiment;
- egy ügynök által korábban háttérben indított folyamattól: arra a Leállítás fokozat való;
- attól, aki a gépen shellt kapott.

**Telepítés után (FONTOS):** a Claude Code a hookokat a session indulásakor olvassa be. A hook ezért egy már futó ügynöknél csak a következő indulása után él. A frissítés után egy flotta-újraindítás kell, különben a fagyasztás a régi sessionökben csak a háttér-ciklusokat és a dashboard saját Claude-hívásait állítja meg, az eszközhívásokat nem.

**Másik gépen futó ügynök** (`remote.host` az agent-config-ban): a hookja azon a gépen fut, és ott nem látja ennek a telepítésnek a fagyasztás-fájlját. A fagyasztás ezért az ő eszközhívásait NEM állítja meg; a válasz (`notFrozen`) és a gazda-értesítés felsorolja őket. Rájuk a Leállítás fokozat, vagy a gépükön külön leállítás való.
