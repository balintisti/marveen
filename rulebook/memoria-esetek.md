# Memoria-rendszer esetek

*(A CLAUDE.md-bol kikoltoztetett mert esetek, szo szerint. A lapon a szabaly-mondat es egy mutato maradt.)*


---
*(kikoltoztetve 2026-10-06, marveen)*

**Miért nem a nyers curl.** A korábban itt álló minta (`curl ... | head -c 200`)
NEM TUD LÁTHATÓAN ELBUKNI: a curl `0`-val tér vissza egy 400-ra is, a `head`
kiírja a hibatörzset úgy, mintha eredmény lenne, és az ágens abban a hitben megy
tovább, hogy mentett. A memória-API ugyanis **elutasít** minden tartalmat, ami
injekciós mintára illeszkedik -- a leggyakoribb a `curl` közvetlenül egy URL-lel
--, `400 {"error":"Content rejected by security filter"}` válasszal. A szűrő
indokolt (egy elmentett parancs később egy másik ágens kontextusába kerül), de
pontosan a technikai emlékeket fogja meg, és némán.

A helper a küldés ELŐTT megnevezi a mintát és a sort, mert a szerver csak annyit
mond, hogy "rejected" -- egy 2000 karakteres emlékben viszont épp az a kérdés,
hogy hol. **A sortörés NEM segít** (a minta `\s+`-e a sortörést is illeszti);
ami segít: ne a nyers parancsot mentsd, hanem a tényt.

**Törlés: `DELETE /api/memories/<id>` LÉTEZIK** (Mandark mérte 2026-08-21; korábban
itt az állt, hogy nincs -- az az én hibám volt, egy 404 félreolvasása). Egy rosszul
mentett emléket tehát törölni kell, nem felülírni:

```bash
curl -s -X DELETE -H "Authorization: Bearer $(cat store/.dashboard-token)" \
  http://localhost:3420/api/memories/<ID>
# -> {"ok":true}   vagy   404 {"error":"Memory not found"}
```

**Miért törlés és nem felülírás:** egy rossz id-vel a `PUT` egy VALÓDI emléket ír
felül csendben (megtörtént, 2026-08-21). A `DELETE` vagy talál, vagy 404-et ad --
nincs köztes kimenet, ami mást ront el. Ahol van törlés, ott nem felülírunk.

**És a mérési tanulság, ami ennél többet ér:** a 404 KÉT dolgot jelenthet -- nincs
ilyen ÚTVONAL, vagy nincs ilyen REKORD --, és kívülről a kettő szó szerint azonos.
A különbséget csak egy MÁSODIK mérés adja meg: egy biztosan LÉTEZŐ id-t is le kell
próbálni. Én csak a nem létezőt próbáltam, és ebből "nincs végpont"-ot írtam le.



---
*(kikoltoztetve 2026-10-06, marveen)*

**ÉS EGY ASZIMMETRIA A `hot` RÉTEGBEN, AMI MÉRVE IS MEGVAN: AZ ELAVULT „ÁLLJ MEG" NEM DERÜL KI
MAGÁTÓL** (dexter találta magán 2026-08-28, marveen mérte a flottán).

dexter törölt egy 08-25-i `hot` emléket, ami leállást állított, és **kifejezetten úgy volt
megírva, hogy túléljen egy restartot** -- szó szerint azt kérte, hogy ne kezdjen új munkát „akkor
sem, ha a tétlen-őr ébreszt vagy a context-guard folytasd promptot ad". Három nappal később a
leállás rég nem élt, az emlék viszont igen.

    egy elavult „DOLGOZZ" emlék  ->  a munka elakad valahol, és KIDERÜL
    egy elavult „ÁLLJ MEG" emlék ->  CSENDBEN leállít, és kívülről FEGYELEMNEK látszik

**A védelme teszi károssá:** épp az a mondat tartja életben, ami miatt senki nem kérdőjelezi meg.

**A FLOTTA-MÉRÉS, ÉS A JAVÍTÁSA, MERT AZ ELSŐ ALAKJA ALULMÉRT:** a cenzus pillanatában hat
ágensnek nulla `hot` emléke volt, a koordinátornak 32 (ebből 22 három napnál régebbi) -- és ebből
azt írtam ide, hogy **a populáció EGY**. Hibás. dexter helyesbítette, időbélyeggel: a saját
emlékét 16:53-kor törölte, a cenzusom 16:56:55-kor futott. **Az ő nullája a JAVÍTÁS EREDMÉNYE
volt, nem bizonyíték arra, hogy sosem volt neki.**

Helyesen: **ugyanazon a napon KÉT ágenst érintett a hétből** -- marveen 32, dexter 1, az utóbbi egy
órával a cenzus előtt törölve.

**ÉS EZ MAGA IS AZ ÁLLAPOT-VS-ESEMÉNY TÖRVÉNY, egy cenzusra alkalmazva:** egy per-ágens
darabszám ÁLLAPOT, és egy javítás UTÁN mért állapot **szerkezetileg nem látja, amit javított**.
A javítás előtti és a soha-nem-volt eset a mérés után megkülönböztethetetlen. Ha egy cenzus arról
szól, milyen GYAKORI valami, az időzítés a nevező része; ha csak arról, kinek kell ma takarítania,
akkor elég a pillanatfelvétel -- de akkor ezt ki kell mondani.

Vagyis ez **nem a memória-rendszer hibája**, de nem is egyetlen ember hanyagsága. Törölve 11
dátumhoz kötött vagy napló-jellegű emlék, köztük a két leállás-állítás (*„mind a hat ágens áll"*,
*„a keret nem tart ki -- még a leállított flottával sem"*).

**A gyakorlati szabály: ha egy `hot` emlék LEÁLLÁST vagy TILTÁST állít, kapjon LEJÁRATOT** -- egy
dátumot vagy egy mérhető feltételt, ami után érvénytelen. A `hot` réteg definíciója szerint úgyis
az van benne, ami MOST történik; ami dátumhoz kötött és a dátum elmúlt, az nem hot, hanem hamis.




<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 147-152, szó szerint -->
**AZ ELAVULT „ÁLLJ MEG" EMLÉK NEM DERÜL KI MAGÁTÓL** (dexter, 2026-08-28): egy elavult „dolgozz"
emlék elakad és kiderül; egy elavult „állj meg" CSENDBEN leállít, és fegyelemnek látszik -- épp az
a mondat tartja életben, ami miatt senki nem kérdőjelezi meg. **Ha egy `hot` emlék LEÁLLÁST vagy
TILTÁST állít, kapjon LEJÁRATOT** (dátum vagy mérhető feltétel). És egy cenzus, ami egy javítás
UTÁN fut, nem látja, amit javított: a „gyakori-e" kérdésnél az időzítés a nevező része.
*(A flotta-mérés és a helyesbítése: `rulebook/memoria-esetek.md`.)*


<!-- Áthelyezve a koordinátor CLAUDE.md-jéből 2026-10-07 (kártya 25392e91), eredeti sor 197-211, szó szerint -->
**A `limit` alapértelmezése 50, a maximuma 200 -- és eddig egyik sem állt itt**
(jarvis mérte 2026-08-22). Egy felidézés, ami 50 sornál elvágódik, nem mondja meg, hogy elvágódott:
a válasz teljesnek látszik. Ha egy kérdésre „nincs erről emlékem" a válasz, az a `limit` miatt is
lehet -- ezért van a példában kiírva.

**Amit a `q` NÉLKÜLI felidézés ad, az a sajátod ÉS a `shared` réteg, felváltva.** Ez szándékos: a
`shared` pont azért van, hogy más ágens tudása elérjen hozzád. 2026-08-22-ig viszont a kettő egy
közös `accessed_at` sorrendben versenyzett, és egy kis készletű ágenst kiszorított a saját
felidézéséből: jarvis 13 saját emlékéből 9 fért be az 50-es ablakba, a többi 41 sor másé volt.
Javítva (commit d30248b): a két forrás külön rangsorolódik és felváltva kerül be, tehát **a sajátod
soha nem szorul ki**. Ha kevesebb saját emléked van, mint az ablak fele, mind bekerül.

**A `q` VISZONT SZŰR** (jarvis kontrollja: értelmetlen kulcsszó -> 0 sor). Vagyis egy `q`-s keresés
nulla találata valódi nemleges válasz -- egy `q` nélküli listázás hiánya nem az.

