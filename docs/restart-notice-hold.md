# A rutin restart-értesítő visszatartása (`RESTART_NOTICE_SWALLOW_MODE`)

Ez a lap az ÉLESÍTÉS és a VISSZAÁLLÁS sorrendjét rögzíti. A kapcsoló leírása a Beállítások
oldalon áll (`src/config-registry.ts`), a működés a `src/web/restart-notice-hold.ts` fejlécében.

## Mit csinál, egy bekezdésben

Egy rutin context-guard restart (handoff megírva és friss, háttérmunka nem veszett el) értesítője
`live` állásban nem megy el azonnal: az értesítő üzenete LEZÁRUL (`done`), a tartalma a
`restart_notice_holds` táblába kerül `held` állapotban, és egy percenként futó feloldó dönti el,
hogy elnyelhető-e (a restart ablakában kézbesített minden sornak van nyoma), vagy ki kell
küldeni (15 perc után is van nyom nélküli sor). `dry-run` állásban minden értesítő megy, mint
korábban, a tábla és a napló csak azt mutatja, mi történt volna.

Csak az a restart tartható vissza, amelyiknek a megsemmisített panele POZITÍVAN felismert, befejezett
válasszal végződik. Minden más panelvég (API-hiba, ismeretlen, olvashatatlan) KÉZBESÍT, és a
kézbesített értesítő első sora megnevezi az okot (`[CONTEXT-GUARD] PANELVEG: ...`; front-desk
fejléc esetén a fejléc marad az első sor, benne a `pane_tail` kulccsal, az ok a második sor).

## Bekapcsolás sorrendje

1. `dry-run`, legalább egy teljes napi restart-körön át.
2. A táblából olvasd ki, mi történt volna: a `detail` JSON `why`, `tail_why` és `tail_line` mezője
   megmondja, melyik értesítő miért ment volna ki. Ha a `tail_why` nagy része
   `start-not-in-capture` (a válasz eleje a rögzített panel fölött van), a visszatartás keveset
   fog el, és ez mérhető, mielőtt bármi élesedne.
3. Csak ezután `live`.

## VISSZAÁLLÁS RÉGEBBI BUILDRE: a sorrend kötelező

Miért: `live` állásban a visszatartott értesítő üzenete már LE VAN ZÁRVA, és egyedül ennek a
buildnek a feloldója küldi ki később. Egy régebbi buildben nincs feloldó. Ami a visszaálláskor
`held` állapotban van, az senkihez nem jut el, és semmi nem jelzi.

1. A kapcsolót állítsd `off`-ra (Beállítások; újraindítás nélkül él).
2. Várj egy feloldó kört: 60 másodperc (`RESTART_NOTICE_RESOLVE_MS`). A feloldó a kapcsoló
   elhagyása után minden `live` módú tartott értesítőt kiküld (a főkönyvben `switch-left-live`).
   FLOTTA-FAGYASZTÁS ALATT A FELOLDÓ NEM FUT: előbb a fagyasztást oldd fel.
3. MÉRD MEG, ne a várakozásra építs. Csak olvasva (`file:<store>/claudeclaw.db?mode=ro`):

       SELECT COUNT(*) FROM restart_notice_holds WHERE state = 'held' AND mode = 'live';

   Az eredmény legyen `0`. A `dry-run` módú `held` sor nem számít: az soha nem zárt le és nem
   tart vissza semmit, legfeljebb 15 percig áll.
4. Csak nulla után állj vissza a régi buildre.

Ha két kör után sem nulla: NE állj vissza. A naplóban a `restart notice: resolving a hold failed`
sor megnevezi az ügynököt és a tartott sort; a sor `held` marad, amíg ki nem megy.

## Amit ez a lap NEM állít

- A feloldó egy tartott soronként percenként egyszer végigolvassa a `kanban_comments` táblát
  (mérve 2026-11-11 00:16 CET, élő adatbázis, csak olvasva: 58 289 sor, 24,5 ms). Sok egyidejű
  tartott sornál ez a dashboard eseményhurkát terheli; index vagy ritkább kör javítja.
- Bármely hívó `done` lezárása az ablak egy során nyomnak számít, nem csak az újraindított ügynöké.
