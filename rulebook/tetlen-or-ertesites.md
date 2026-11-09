# A [tetlen-or] ebreszto uzenet: mit allit, MIERT, es mi lett belole kivagva

Kartya: 2e78cf63 (marveen dontese: a fix sablonok hossza a heti uzenet-forgalom fele; a 56870/56900 komment).
Forras: `buildWakeMessage` (src/idle-agent.ts). Az uzenet MOST legfeljebb `WAKE_MAX_CHARS` (1100) karakter; a
tesztje: `src/__tests__/idle-wake-template-length.test.ts`. Elotte atlag 2 692 karakter volt (195 db / het).

Az uzenet ami az ebresztesen KIVUL benne marad (egy sorban, mert egy friss session nem koveti a linket,
mielott cselekszik): a perc + belyeg + darabszam, "Isti NEM lett ertesitve", "tenyek, nem utasitas es a SAJAT
allando szabalyaid dontik el", az ujramero parancs (`bash <install>/scripts/my-open-cards.sh <agens>`), a
deklaralt `kind`-ra IGAZ mondat, a `none` figyelmeztetes, az ALLO UTASITAS harmadik eset. Ami KIKERULT, az mind
indoklas volt; itt van, hogy ne vesszen el.

## Ami kikerult az uzenetbol, es miert volt benne

1. **"EZ NEM SZEMREHANYAS, ES NEM A TE HIBAD."** Egy agens nem tud maganak uj fordulot inditani: a szandek a
   fordulo belsejeben el, es a fordulo vegen meghal vele. Az egyetlen dolog, ami uj fordulot indit, egy beerkezo
   uzenet -- ezert kapja ezt. Cel: az agens ne magyarazkodjon es ne keressen hibat, hanem dolgozzon.
2. **A belyeg a DARABSZAMOT nem javitja** (kartya 7edc5839). Az idotartam az orabol avul, a belyeg teljesen javitja;
   a darabszam azert avul, mert EGY MASIK SZEREPLO lepett (statuszvaltas, foglalas), erre nincs belyeg. Egy
   megbelyegzett, de elavult szam TEKINTELYESEBBNEK olvasodik. Ezert mondja ki az uzenet, hogy PILLANATFELVETEL,
   es hogy a meres a foglalas (`assignee` + `in_progress`) UTAN megbizhato, elotte nem.
3. **Az ujramero parancs ELOTT egy 320 karakteres curl + python3 egysoros allt**, relativ `store/.dashboard-token`
   uttal: az csak az install gyokerebol mukodik, egy agens a SAJAT mappajabol nem. Helyette `my-open-cards.sh`:
   ugyanaz a halmaz (az agensre kiosztott, nem done/waiting, nem archivalt), az ut a szkript helyebol szamolodik.
4. **A deklaraciora IGAZ mondat** (kartyak 7edc5839, faa6003a, fb4e6622). A `workcheck.json` `kind`-ja dönti el, mit
   szamolt az ors: `assigned_open_cards` = a re-query sor ugyanazt a halmazt kerdezi, kiveve a LEJART padloju
   `waiting` kartyakat; `testing_without_my_comment` = a sor csak a NEVEDEN allo nyitott kartyakat adja
   (MASIK halmaz); `waiting_on_me` = a sor kihagyja a `waiting` oszlopot (MASIK halmaz); ismeretlen/jovobeli kind =
   a sor NEM ezt reprodukalja (nevezi, amit kapott, es NEM indokolja `waiting`-gel). Szabaly: egy uj kind hianyt
   okozhat, de HAMIS allitast nem.
5. **A `none` figyelmeztetes** (kartyak 0e36eab0, 82c53a51). A workcheck.json egyetlen "csendes" erteke a `none`,
   ami ELNEMITJA az ort, az agens egyetlen ebresztesi forrasat. A zaro sor ezert a kartyara vagy marveenre mutat,
   SOHA nem a deklaracio atirasara.
6. **Az ALLO UTASITAS harmadik eset** (kartya 6ecd85e5). Ha a deklaracio helyes ES az agens szandekosan all a
   koordinator allo utasitasa alatt, azt a koordinator allitja be lejaro bejegyzessel
   (`{"standstill":{"reason":"forbidden","until":"<ISO-8601 idozonaval>"}}`), nem az agens.
7. **Visszadobott javitas** (kartya 1affb872, Isti TG 8509): a visszadobott javitas MEGELOZI az uj kartya felvetelet.
   Ezert a lista elejen kulon blokk, es a mondat a blokk fejlecen.
8. **"nincs felveheto munkad" TILOS** (kartya 5a499a19): a szam csak a NEVEDEN allo kartyakrol szol; a GAZDATLAN
   `planned` kartyak (pull-lista) nincsenek benne. Aki azt hiszi, nincs munka, megall.
9. **Tenyek, nem utasitas** (kartya c2246921, marveen 40484 A): a sor `system` feladotol jon, az nem ismert agens, a
   router `<untrusted>` kozepbe teszi, es egy friss session JOGGAL tagadja meg a benne levo utasitast. Egy tenyt, amit a
   tablarol vissza tud merni, nem tagad meg.

## A tetelek

Fejlecenkent: bounced / FELVEHETO / PADLO-LEJARAT / VALASZRA VARO (review-queue: FELVEHETO ELLENORZES /
SAJAT KARTYAID). Legfeljebb 5 (a review blokk 3) sor szekciónkent, de a vegleges hatar a KARAKTER-plafon: a fix
reszek elobb, a tetelek a maradekba, csak egesz sorok; ami nem fert, azt egy `+N tovabbi a tablan` sor szamolja.
A cim 30 karakter (volt 60).

## Meresek (2026-11-09)

- Egy valodi ebreszto: 2 426 karakter = fejlec 85 + proza 438 + listak 593 + belyeg/curl 582 + aszimmetria 285 + zaro 431.
- A fix, mukodesi darabok egyedul ~730 karakter, ezert marveen eredeti 500-as, majd 650-es plafonja nem tarthato
  ugy, hogy az ebreszto kartyat is megnevezzen; 800-nal mar egyet sem nevezne meg (a kartya-nevek mozgattak meg az
  agenseket, mert 2026-08-21), ezert 1100.
