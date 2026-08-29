---
name: kanban-audit
description: 4 óránkénti kanban-tábla audit. Tisztítás (7+ napos done archiválás) + beakadt task-ok számon kérése (előző audit óta nem mozdult in_progress -> ping az assignee-nek).
---

# Kanban 4 órás audit

## Mikor fut
- 8:00, 12:00, 16:00, 20:00 (kanban-audit cron 0 8,12,16,20)

## Autonómia-szint (config-vezérelt, KÖTELEZŐ ELŐSZÖR)

Olvasd be (python3-mal, mert `jq` NINCS telepítve egy átlagos Linux gépen):
```bash
python3 -c "
import json
d=json.load(open('{{INSTALL_DIR}}/store/autonomy-config.json'))
for c in d.get('categories',[]):
    if c.get('key') in ('kanban_archive_done','kanban_stuck_nudge'):
        print(c['key'], c.get('level'))
" 2>/dev/null
```

A két kategória szintje szabályozza a 2. és 4. lépést:
- **`kanban_archive_done`** (2. lépés): level 3 → archiváld magától (alapért). level 2 → NE archiválj, Telegramon javasold ("X db 7+ napos done archiválásra vár, mehet?") és várj jóváhagyást. level 1 → csak jelezd a számot.
- **`kanban_stuck_nudge`** (4. lépés): level 3 → pingeld az assignee-t magától, és CSAK 2 eredménytelen audit-kör után eszkalálj a tulajdonoshoz ({{OWNER_NAME}}) (a komment-történetből látod hányszor pingelted). level 2 → ne pingelj magadtól, Telegramon javasold a tulajdonosnak ({{OWNER_NAME}}). level 1 → csak listázd a beakadt taskokat.

Ha a config hiányzik vagy a kulcs nincs benne → default level 3 (régi viselkedés).

## Eljárás

1. **State-fájl beolvasás**: `store/kanban-audit-state.json` tartalmazza `last_audit_at` Unix timestampet. Első futáskor null -> ne pingelj senkit, csak állítsd be a state-et.

   A tábla eléréséhez a dashboard API-t használd, NE a `sqlite3` CLI-t (lásd a Buktatókat).
   A port a `.env`-ből jön, hogy nem-alapértelmezett porton is működjön:
   ```bash
   PORT="$(sed -n 's/^WEB_PORT=//p' {{INSTALL_DIR}}/.env 2>/dev/null | head -1 | tr -d '"')"; PORT="${PORT:-3420}"
   TOKEN="$(cat {{INSTALL_DIR}}/store/.dashboard-token)"
   ```

2. **Tisztítás**: 7+ napos done kártyák archiválása (előbb listázd, aztán archiváld egyesével):
   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/kanban" | python3 -c "
import json,sys,time
cut=int(time.time())-7*86400
for c in json.load(sys.stdin):
    if c.get('status')=='done' and not c.get('archived_at') and (c.get('updated_at') or 0) < cut:
        print(c['id'])
" | while read -r id; do
     curl -s -X POST -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/kanban/$id/archive" >/dev/null
   done
   ```

3. **Beakadt task detection** (előző audit óta nem mozdult): in_progress kártyák amik `updated_at < last_audit_at`:
   ```bash
   LAST="$(python3 -c "
import json
try: print(json.load(open('{{INSTALL_DIR}}/store/kanban-audit-state.json')).get('last_audit_at') or 0)
except Exception: print(0)
")"
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/kanban" | python3 -c "
# AUDIT-SNIPPET: beakadt
import json,sys,time
last=int('''$LAST''' or 0); now=int(time.time())
# ALLANDO SOR: egy kartya, ami SZANDEKOSAN all in_progress-en orokke (egy agens
# folyamatos munkasora, nem befejezendo feladat). Minden audit beakadtnak latja,
# tehat 4 oraankent pingelne az assignee-t ugyanazzal, amire nincs mit valaszolni --
# es a zaj pont azt tanitja meg, hogy a kanban-audit pingjet figyelmen kivul kell hagyni.
def allando_sor(c):
    t=(c.get('title') or '').upper()
    return 'ALLANDO SORA' in t or '\u00c1LLAND\u00d3 SORA' in t
rows=[c for c in json.load(sys.stdin)
      if c.get('status')=='in_progress' and not c.get('archived_at')
      and (c.get('updated_at') or 0) < last and not allando_sor(c)]
rows.sort(key=lambda c: c.get('updated_at') or 0)
for c in rows:
    print(c['id'], '|', (c.get('assignee') or '-'), '|', round((now-(c.get('updated_at') or now))/3600.0,1), 'h |', c.get('title'))
"
   ```

4. **Beakadt task -> ping**: minden beakadt kártyához küldj inter-agent message-t az assignee-nek (kivéve a SAJÁT ágens-azonosítódra szóló kártyáknak és az üres assignee-nek -- a szabály a feladat FUTTATÓJÁRA vonatkozik, nem egy névre):
   ```
   "Kanban-audit: a {card_id} ({title}) {hours_stale}h-ja in_progress mozgás nélkül (előző audit óta). Frissítsd a státuszt (done/waiting) vagy adj komment-et hogy mit blokkol."
   ```

5. **State-fájl frissítés** (a futás VÉGÉN): `store/kanban-audit-state.json` -> `{"last_audit_at": <current Unix timestamp>}`.

6. **Gazdátlan kártyák -- OSZLOPONKÉNT MÁS, ne egy számra riassz.**

   Egy `planned` + gazdátlan kártya nem hiba: épp azt jelenti, hogy BÁRKI FELVEHETI.
   Egy őr, ami erre riaszt, a helyes állapotot jelöli meg hibaként -- és ezzel megtanítja
   az olvasót, hogy a jelzése zaj. (Mérve egy élő telepítésen: egy „3+ gazdátlan" szabály
   8 találatot adott, amiből 6 aznap SZÁNDÉKOSAN gazdátlanul nyitott `planned` kártya volt.)

   | oszlop | gazdátlan = | teendő |
   |---|---|---|
   | `planned` | felvehető, bárki elviheti | **rendben, NE számold találatnak** |
   | `in_progress` | senki nem dolgozik rajta, pedig azt állítja | találat |
   | `testing` | SENKIÉ -- nincs, aki összesítse az ellenőrzést és lezárja | találat |

   **A `high`/`urgent` gazdátlan `planned` kártyát NEVEZD MEG -- de HÚZÓ-LISTAKÉNT, nem
   riasztásként.** Ha a nyilvántartásban a lelet alapértelmezésben gazdátlan (mert helyesen az),
   akkor SENKI sorában nem látszik: egy `normal` nyugodtan várhat, egy `high` viszont
   láthatatlanul áll. A forma egy sor a jelentésben -- *„ezt bárki elviheti, és sürgős: <id>
   <cím>"* --, nem defektus-jelzés. A `normal`/`low` gazdátlanokra továbbra is NULLA riasztás.

7. **Várakozó kártyák: a >48h MECHANIKUS SZŰRŐ, NEM TALÁLAT.**

   Egy `waiting` kártya lehet SZÁNDÉKOSAN leparkolt megfigyelés, kiírt újranyitási feltétellel --
   az nem rothad, hanem VÁR, és pontosan azt csinálja, amit kell. **Mielőtt blokkolónak jelented,
   olvasd el a kártya UTOLSÓ KOMMENTJÉT ÉS a LEÍRÁSÁT.** Ha bármelyik megmondja, MIÉRT vár és MI
   nyitná újra, akkor NEM blokkoló: maradj csendben.

   A nulla komment önmagában NEM jel: egy kártya, ami első megírásakor teljes volt, sosem kap
   kommentet, és épp ezért néz ki elhagyottnak. A kérdés nem az, hogy van-e komment, hanem hogy a
   kártya BÁRHOL megmondja-e, mire vár.

   Az osztályozás mind a hármat egyszerre adja (a `TALALAT` sorok számítanak a 8. lépés
   küszöbébe, a `HUZO` és az `ELLENORZENDO` SOHA nem riaszt magától):

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:$PORT/api/kanban" | python3 -c "
# AUDIT-SNIPPET: osztalyozas
import json,sys,time
now=int(time.time()); cards=[c for c in json.load(sys.stdin) if not c.get('archived_at')]
def gazdatlan(c): return not (c.get('assignee') or '').strip()
talalat=0
for c in cards:
    st=c.get('status'); pr=(c.get('priority') or 'normal')
    if gazdatlan(c) and st in ('in_progress','testing'):
        talalat+=1; print('TALALAT gazdatlan-%s %s %s' % (st, c['id'], c.get('title')))
    elif gazdatlan(c) and st=='planned' and pr in ('high','urgent'):
        print('HUZO %s %s %s' % (pr, c['id'], c.get('title')))
    if st=='waiting' and (now-(c.get('updated_at') or now)) > 48*3600:
        print('ELLENORZENDO varakozo %s %.0fh %s' % (c['id'], (now-(c.get('updated_at') or now))/3600.0, c.get('title')))
print('TALALAT-OSSZESEN %d' % talalat)
"
   ```

8. **Telegram csak akkor írj ha**:
   - 3+ beakadt task van (kritikus), VAGY
   - `TALALAT-OSSZESEN` >= 3, VAGY
   - egy `ELLENORZENDO` kártya elolvasva TÉNYLEG nem mondja meg, mire vár (ez az „új blokkoló")
   - Egyébként csendben (heartbeat-stílus). A `HUZO` sorok a naplóba/jelentésbe mennek, nem Telegramra.

## Buktatók
- **NE `sqlite3` CLI-t és NE `jq`-t használj.** Egyik sincs telepítve egy átlagos Linux
  gépen (a telepítő függőségei: ffmpeg, git, tmux, lsof, curl, python3, pipx, unzip), és a
  hívás ott `exit 127`-tel elhal -- ez a lépés némán kimarad, miközben az audit sikeresnek
  látszik. Élő gépen mérve 2026-08-04: két külön Linux telepítésen `sqlite3` és `jq`
  egyaránt hiányzott, `python3` mindkettőn ott volt. A macOS gépeken azért nem tűnt fel,
  mert ott a `sqlite3` gyárilag van.
- Az "előző audit óta nem mozdult" feltétel azt jelenti: `updated_at < last_audit_at`. NE használj abszolút 24h-os küszöböt.
- Ne archiválj done-t ha <7 nap (a felhasználó még látni akarja).
- NE pingelj saját magadat (skip, ha az assignee a te SAJÁT ágens-azonosítód -- a szabály a
  feladat FUTTATÓJÁRA vonatkozik, nem egy konkrét névre: a futtató telepítésenként más lehet).
- Ne re-pingelj 4 órán belül ugyanazt: a state-fájlban tárolt `last_audit_at` automatikusan kezeli ezt.
- Első futáskor (state-fájl üres) -> ne pingelj, csak inicializáld a state-et.
- A státuszváltozás (in_progress -> done) is updated_at frissítést jelent, így a következő audit nem fogja megfogni a most-még-aktív taskokat.
- **Egy őr, ami a HELYES állapotot is megjelöli, rosszabb a semminél.** Ez a lap három helyen
  alkalmazza ugyanazt (gazdátlan `planned`, parkoló `waiting`, állandó sor-kártya), és mindhárom
  ugyanabból a mért hibából jött: a riasztás igaz volt a szabály betűje szerint, és hamis
  a valóságra. Ha egy új szabályt veszel fel ide, előbb kérdezd meg: **melyik EGÉSZSÉGES alak
  ütközik bele?**
- **A csend nem bizonyítja, hogy futott.** Egy `heartbeat`-típusú feladat sikere és a
  teljes kimaradása kívülről azonos: mindkettő néma. Ezért írja a 3. lépés a state-fájlt a futás
  VÉGÉN -- a `last_audit_at` az egyetlen nyom, ami megkülönbözteti a kettőt.

## Ellenőrzés
- A state-fájl frissült a futás végén.
- Inter-agent message-ek sikeresek: a 200 önmagában NEM elég, a válaszban legyen `id`. (A curl
  `0`-val tér vissza egy elutasított kérésre is, tehát a néma küldés-hiba sikernek látszik.)
- **Az osztályozás pozitív kontrollja:** egy EGÉSZSÉGES tábla (gazdátlan `planned` + kiírt
  indokkal parkoló `waiting`) `TALALAT-OSSZESEN 0`-t adjon. Ha nem nulla, a szűrő a helyes
  állapotra riaszt. És fordítva: egy gazdátlan `in_progress`/`testing` kártyán MEG KELL szólalnia --
  e nélkül csak elnémítottuk.
